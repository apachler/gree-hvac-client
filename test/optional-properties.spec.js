const dgram = require('dgram');

const { Client } = require('../src/client');
const { EncryptionService, EcbCipher } = require('../src/encryption-service');
const {
    PropertyTransformer,
    OPTIONAL_VENDOR_CODES,
} = require('../src/property-transformer');
const device = require('./support/device');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * Outdoor temperature, humidity, fault code and anti-direct-blow exist only on
 * some units. Each is probed once after binding and polled only if the unit
 * answered it.
 */
describe('Optional properties', () => {
    describe('PropertyTransformer', () => {
        const SUT = new PropertyTransformer();

        it('decodes the sensors', () => {
            expect(
                SUT.fromVendor({
                    OutEnvTem: 35,
                    DwatSen: 48,
                    AllErr: 0,
                    AntiDirectBlow: 1,
                })
            ).toEqual({
                outdoorTemperature: -5,
                humidity: 48,
                errorCode: 0,
                antiDirectBlow: 'on',
            });
        });

        it('keeps an outdoor reading of 0 as unavailable', () => {
            expect(SUT.fromVendor({ OutEnvTem: 0 })).toEqual({
                outdoorTemperature: 0,
            });
        });

        it('decodes the dehumidifier codes', () => {
            expect(SUT.fromVendor({ Dwet: 55, DwatFul: 1, Dfltr: 0 })).toEqual({
                targetHumidity: 55,
                waterFull: 'on',
                cleanFilter: 'off',
            });
        });

        it('sets targetHumidity', () => {
            expect(SUT.toVendor({ targetHumidity: 50 })).toEqual({
                Dwet: 50,
            });
        });

        it.each([
            'outdoorTemperature',
            'humidity',
            'errorCode',
            'waterFull',
            'cleanFilter',
        ])('refuses to set read-only %s', property => {
            expect(() => SUT.toVendor({ [property]: 1 })).toThrow(
                `Cannot set read-only property ${property}`
            );
        });

        it('sets antiDirectBlow', () => {
            expect(SUT.toVendor({ antiDirectBlow: 'on' })).toEqual({
                AntiDirectBlow: 1,
            });
        });

        it('polls optional codes only once supported', () => {
            const all = SUT.statusColumns();
            for (const code of OPTIONAL_VENDOR_CODES) {
                expect(all).not.toContain(code);
            }
            expect(all).toContain('TemRec');
            expect(SUT.statusColumns(['DwatSen'])).toContain('DwatSen');
        });
    });

    describe('Client', () => {
        const POLLING_INTERVAL = 1000;
        const POLLING_TIMEOUT = 500;

        let SUT;
        let ecb;
        let feedClient;
        let clientEncrypt;
        let updates;
        let noResponses;

        const statusRequests = () =>
            clientEncrypt.mock.calls
                .map(([msg]) => msg)
                .filter(msg => msg.t === 'status');
        const feed = pack =>
            feedClient(
                JSON.stringify({
                    ...fixtures.pack(pack),
                    pack: ecb.encrypt(pack).payload,
                })
            );

        beforeEach(async () => {
            ecb = new EcbCipher();
            dgram.createSocket.mockReturnValue(
                createSocketMock({
                    on: (event, cb) => event === 'message' && (feedClient = cb),
                })
            );
            SUT = new Client({
                autoConnect: false,
                pollingInterval: POLLING_INTERVAL,
                pollingTimeout: POLLING_TIMEOUT,
            });
            clientEncrypt = jest.spyOn(EncryptionService.prototype, 'encrypt');
            updates = [];
            noResponses = 0;
            SUT.on('update', updated => updates.push(updated));
            SUT.on('no_response', () => noResponses++);
            SUT.on('error', () => {});

            SUT.connect().catch(() => {});
            feedClient(device.scan(ecb).payload);
            await jest.advanceTimersByTimeAsync(0);
            feedClient(device.bind(ecb).payload);
            await jest.advanceTimersByTimeAsync(0);
        });

        afterEach(async () => {
            await SUT.disconnect().catch(() => {});
            jest.restoreAllMocks();
        });

        it('probes each optional code once after binding', () => {
            const probes = statusRequests().slice(1);
            // ...followed by the firmware id query
            expect(probes.map(msg => msg.cols)).toEqual([
                ...OPTIONAL_VENDOR_CODES.map(code => [code]),
                ['hid'],
            ]);
        });

        it('polls only the codes the unit answered', async () => {
            feed({ t: 'dat', cols: ['OutEnvTem'], dat: [45] });
            feed({ t: 'dat', cols: ['DwatSen'], dat: [] });

            expect(updates).toEqual([{ outdoorTemperature: 5 }]);

            await jest.advanceTimersByTimeAsync(POLLING_INTERVAL);
            const poll = statusRequests().at(-1);
            expect(poll.cols).toContain('OutEnvTem');
            expect(poll.cols).not.toContain('DwatSen');
        });

        it('does not take a probe answer for the answer to a poll', async () => {
            // the first poll is still unanswered when a probe answer arrives
            feed({ t: 'dat', cols: ['AllErr'], dat: [0] });
            await jest.advanceTimersByTimeAsync(POLLING_TIMEOUT);

            expect(noResponses).toBe(1);
        });

        it('forgets the supported codes on a re-bind', async () => {
            feed({ t: 'dat', cols: ['OutEnvTem'], dat: [45] });
            expect(SUT._supportedOptionalCodes.size).toBe(1);

            await SUT._initialize();

            expect(SUT._supportedOptionalCodes.size).toBe(0);
        });
    });
});
