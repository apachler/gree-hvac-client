const dgram = require('dgram');

const { Client } = require('../src/client');
const { EcbCipher, GcmCipher } = require('../src/encryption-service');
const { ClientNotConnectedError } = require('../src/errors');
const device = require('./support/device');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

const GATEWAY = fixtures.device.cid;
const INDOOR = 'c0000001a2b3c4';

/**
 * A multi-split outdoor unit's WiFi module (the gateway) lists its indoor
 * units on a subList request and relays status/cmd requests to the one named
 * in the pack, routed by the outer tcid.
 */
describe('Multi-split sub-units', () => {
    let SUT;
    let ecb;
    let feedClient;
    let sent;

    const decryptSent = (message, cipher = ecb) =>
        cipher.decrypt(message).payload;
    const lastSent = () => sent.at(-1);
    const feed = (pack, cipher = ecb) =>
        feedClient(
            JSON.stringify({
                ...fixtures.pack(pack),
                pack: cipher.encrypt(pack).payload,
            })
        );

    const connect = async (options = {}) => {
        SUT = new Client({ autoConnect: false, poll: false, ...options });
        SUT.on('error', () => {});
        SUT.connect().catch(() => {});
        feedClient(device.scan(ecb).payload);
        await jest.advanceTimersByTimeAsync(0);
        feedClient(device.bind(ecb).payload);
        await jest.advanceTimersByTimeAsync(0);
    };

    beforeEach(() => {
        ecb = new EcbCipher();
        sent = [];
        dgram.createSocket.mockReturnValue(
            createSocketMock({
                on: (event, cb) => event === 'message' && (feedClient = cb),
                send: (buff, start, length, port, host, cb) => {
                    sent.push(JSON.parse(String(buff)));
                    cb();
                },
            })
        );
    });

    afterEach(async () => {
        await SUT.disconnect().catch(() => {});
        jest.restoreAllMocks();
    });

    describe('getSubUnits()', () => {
        it('rejects before the client is connected', async () => {
            SUT = new Client({ autoConnect: false });
            await expect(SUT.getSubUnits()).rejects.toBeInstanceOf(
                ClientNotConnectedError
            );
        });

        it('lists the indoor units from the device-key answer', async () => {
            await connect();

            const units = SUT.getSubUnits();
            await jest.advanceTimersByTimeAsync(0);

            const request = lastSent();
            expect(request).toMatchObject({
                cid: 'app',
                i: 0,
                t: 'pack',
                tcid: GATEWAY,
            });
            expect(decryptSent(request)).toEqual({
                mac: GATEWAY,
                t: 'subList',
                i: 0,
            });

            feed({
                t: 'subList',
                mac: GATEWAY,
                c: 2,
                list: [
                    { mac: INDOOR, mid: '1' },
                    { mac: 'c0000002' },
                    { mac: INDOOR, mid: '1' },
                ],
            });

            await expect(units).resolves.toEqual([
                { mac: INDOOR, mid: '1' },
                { mac: 'c0000002' },
            ]);
        });

        it('falls back to the generic-key form', async () => {
            await connect();

            const units = SUT.getSubUnits({ timeout: 100 });
            await jest.advanceTimersByTimeAsync(100);

            const request = lastSent();
            expect(request).toMatchObject({
                cid: 'app',
                i: 1,
                t: 'subList',
                tcid: GATEWAY,
            });
            const generic = new EcbCipher();
            expect(decryptSent(request, generic)).toEqual({
                mac: GATEWAY,
                i: 1,
            });

            feed({ t: 'subList', list: [{ mac: INDOOR }] }, generic);

            await expect(units).resolves.toEqual([{ mac: INDOOR }]);
        });

        it('resolves with no units when the device answers neither', async () => {
            await connect();

            const units = SUT.getSubUnits({ timeout: 100 });
            await jest.advanceTimersByTimeAsync(200);

            await expect(units).resolves.toEqual([]);
        });

        it('skips the generic-key form on an AES-GCM module', async () => {
            const gcm = new GcmCipher();
            SUT = new Client({ autoConnect: false, poll: false });
            SUT.on('error', () => {});
            SUT.connect().catch(() => {});
            feedClient(device.scan(gcm).payload);
            await jest.advanceTimersByTimeAsync(0);
            feedClient(device.bind(gcm).payload);
            await jest.advanceTimersByTimeAsync(0);
            const before = sent.length;

            const units = SUT.getSubUnits({ timeout: 100 });
            await jest.advanceTimersByTimeAsync(200);

            await expect(units).resolves.toEqual([]);
            expect(sent.slice(before)).toHaveLength(1);
        });
    });

    describe('subUnit option', () => {
        it('names the indoor unit in status requests', async () => {
            await connect({ subUnit: INDOOR });

            // the bind request before it is encrypted with the generic key
            const status = sent.find(msg => msg.tcid);
            expect(status.tcid).toBe(GATEWAY);
            expect(decryptSent(status)).toMatchObject({
                t: 'status',
                mac: INDOOR,
            });
        });

        it('names the indoor unit in commands', async () => {
            await connect({ subUnit: INDOOR });

            await SUT.setProperty('power', 'on');

            expect(lastSent().tcid).toBe(GATEWAY);
            expect(decryptSent(lastSent())).toEqual({
                opt: ['Pow'],
                p: [1],
                t: 'cmd',
                sub: INDOOR,
            });
        });

        it('leaves requests of a single unit as they were', async () => {
            await connect();

            await SUT.setProperty('power', 'on');

            expect(lastSent()).not.toHaveProperty('tcid');
            expect(decryptSent(lastSent())).not.toHaveProperty('sub');
        });
    });
});
