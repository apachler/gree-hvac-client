const dgram = require('dgram');

const { Client } = require('../src/client');
const { EncryptionService, EcbCipher } = require('../src/encryption-service');
const {
    PropertyTransformer,
    encodeFahrenheit,
    decodeFahrenheit,
} = require('../src/property-transformer');
const device = require('./support/device');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * `SetTem` is always °C on the wire; a °F setpoint travels as the rounded °C
 * value plus the `TemRec` bit that tells apart the two whole-°F values
 * sharing it (75 °F and 76 °F both round to 24 °C).
 */
describe('Fahrenheit setpoint', () => {
    describe('encodeFahrenheit() / decodeFahrenheit()', () => {
        it('tells 75 °F and 76 °F apart by TemRec', () => {
            expect(encodeFahrenheit(75)).toEqual({ SetTem: 24, TemRec: 0 });
            expect(encodeFahrenheit(76)).toEqual({ SetTem: 24, TemRec: 1 });
            expect(decodeFahrenheit(24, 0)).toBe(75);
            expect(decodeFahrenheit(24, 1)).toBe(76);
        });

        it('round-trips every whole °F from 32 to 104', () => {
            for (let f = 32; f <= 104; f++) {
                const { SetTem, TemRec } = encodeFahrenheit(f);
                expect(decodeFahrenheit(SetTem, TemRec)).toBe(f);
            }
        });

        it('rounds a SetTem/TemRec pair no °F setpoint encodes to', () => {
            // 0 °C is exactly 32 °F, so it never comes with TemRec 1
            expect(decodeFahrenheit(0, 1)).toBe(32);
        });

        it('passes a SetTem that is already °F through unchanged', () => {
            expect(decodeFahrenheit(75, 0)).toBe(75);
        });
    });

    describe('PropertyTransformer', () => {
        const SUT = new PropertyTransformer();

        it('encodes a °F setpoint sent together with the unit', () => {
            expect(
                SUT.toVendor({ temperatureUnit: 'fahrenheit', temperature: 76 })
            ).toEqual({ TemUn: 1, SetTem: 24, TemRec: 1 });
        });

        it("encodes a setpoint in °F when the device's unit is °F", () => {
            expect(SUT.toVendor({ temperature: 75 }, { TemUn: 1 })).toEqual({
                SetTem: 24,
                TemRec: 0,
                TemUn: 1,
            });
        });

        it('leaves a °C setpoint as it was', () => {
            expect(SUT.toVendor({ temperature: 24 })).toEqual({ SetTem: 24 });
            expect(SUT.toVendor({ temperature: 24 }, { TemUn: 0 })).toEqual({
                SetTem: 24,
            });
            expect(
                SUT.toVendor(
                    { temperatureUnit: 'celsius', temperature: 24 },
                    {
                        TemUn: 1,
                    }
                )
            ).toEqual({ TemUn: 0, SetTem: 24 });
        });

        it('decodes a °F setpoint', () => {
            expect(SUT.fromVendor({ TemUn: 1, SetTem: 24, TemRec: 1 })).toEqual(
                { temperatureUnit: 'fahrenheit', temperature: 76 }
            );
        });

        it('decodes a °F setpoint with the unit and TemRec from state', () => {
            expect(
                SUT.fromVendor({ SetTem: 24 }, { TemUn: 1, TemRec: 0 })
            ).toEqual({ temperature: 75 });
        });

        it('decodes a °C setpoint as it was', () => {
            expect(SUT.fromVendor({ TemUn: 0, SetTem: 24, TemRec: 1 })).toEqual(
                { temperatureUnit: 'celsius', temperature: 24 }
            );
        });
    });

    describe('Client', () => {
        let SUT;
        let ecb;
        let feedClient;
        let clientEncrypt;
        let updates;
        let successes;

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
            SUT = new Client({ autoConnect: false, poll: false });
            clientEncrypt = jest.spyOn(EncryptionService.prototype, 'encrypt');
            updates = [];
            successes = [];
            SUT.on('update', updated => updates.push(updated));
            SUT.on('success', updated => successes.push(updated));
            SUT.on('error', () => {});

            SUT.connect().catch(() => {});
            feedClient(device.scan(ecb).payload);
            await jest.advanceTimersByTimeAsync(0);
            feedClient(device.bind(ecb).payload);
            await jest.advanceTimersByTimeAsync(0);
            feed({
                t: 'dat',
                cols: ['TemUn', 'SetTem', 'TemRec'],
                dat: [1, 24, 0],
            });
        });

        afterEach(async () => {
            await SUT.disconnect().catch(() => {});
            jest.restoreAllMocks();
        });

        it('reports the °F setpoint', () => {
            expect(updates).toEqual([
                { temperatureUnit: 'fahrenheit', temperature: 75 },
            ]);
        });

        it('reports a setpoint change carried by TemRec alone', () => {
            feed({
                t: 'dat',
                cols: ['TemUn', 'SetTem', 'TemRec'],
                dat: [1, 24, 1],
            });

            expect(updates[1]).toEqual({ temperature: 76 });
        });

        it('sends a °F setpoint as SetTem + TemRec + TemUn', async () => {
            await SUT.setProperty('temperature', 76);

            const cmd = clientEncrypt.mock.calls
                .map(([msg]) => msg)
                .find(msg => msg.t === 'cmd');
            expect(cmd).toEqual({
                opt: ['SetTem', 'TemRec', 'TemUn'],
                p: [24, 1, 1],
                t: 'cmd',
            });
        });

        it('reports the confirmed °F setpoint', () => {
            feed({
                t: 'res',
                opt: ['SetTem', 'TemRec', 'TemUn'],
                val: [24, 1, 1],
            });

            expect(successes).toEqual([
                { temperature: 76, temperatureUnit: 'fahrenheit' },
            ]);
        });
    });
});
