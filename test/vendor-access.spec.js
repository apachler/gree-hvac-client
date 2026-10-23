const dgram = require('dgram');

const { Client } = require('../src/client');
const { EcbCipher } = require('../src/encryption-service');
const {
    ClientNotConnectedError,
    ClientNoResponseError,
} = require('../src/errors');
const device = require('./support/device');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

const HID = '362001068254+U-4MWB65VRV2.11.bin';

/**
 * Status batching, raw vendor codes, the firmware id, the clock and the name.
 */
describe('Vendor access', () => {
    const POLLING_TIMEOUT = 500;

    let SUT;
    let ecb;
    let feedClient;
    let sent;

    const packs = () =>
        sent
            .filter(msg => msg.t === 'pack' && msg.i === 0)
            .map(msg => ecb.decrypt(msg).payload);
    const lastPack = () => packs().at(-1);
    const feed = pack =>
        feedClient(
            JSON.stringify({
                ...fixtures.pack(pack),
                pack: ecb.encrypt(pack).payload,
            })
        );

    const connect = async (options = {}) => {
        SUT = new Client({
            autoConnect: false,
            poll: false,
            pollingTimeout: POLLING_TIMEOUT,
            ...options,
        });
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

    describe('status batching', () => {
        it('splits a poll over requests of at most statusBatchSize codes', async () => {
            await connect({ statusBatchSize: 5 });

            const polls = packs().filter(
                pack => pack.t === 'status' && pack.cols.length > 1
            );
            expect(polls.length).toBeGreaterThan(1);
            expect(polls.every(pack => pack.cols.length <= 5)).toBe(true);
            expect(polls.flatMap(pack => pack.cols)).toEqual(
                SUT._transformer.statusColumns()
            );
        });

        it('takes the poll as answered once every batch is', async () => {
            await connect({ statusBatchSize: 10 });
            const [first, second] = packs().filter(
                pack => pack.t === 'status' && pack.cols.length > 1
            );
            let noResponse = 0;
            SUT.on('no_response', () => noResponse++);
            let settled = false;
            const properties = SUT.getProperties().finally(
                () => (settled = true)
            );
            await jest.advanceTimersByTimeAsync(0);
            // the batches of the getProperties() poll
            const [third, fourth] = packs()
                .filter(pack => pack.t === 'status' && pack.cols.length > 1)
                .slice(2);
            expect(third).toEqual(first);
            expect(fourth).toEqual(second);

            feed({ t: 'dat', cols: first.cols, dat: first.cols.map(() => 0) });
            await jest.advanceTimersByTimeAsync(0);
            expect(settled).toBe(false);

            feed({
                t: 'dat',
                cols: second.cols,
                dat: second.cols.map(() => 0),
            });
            await expect(properties).resolves.toMatchObject({
                power: 'off',
                temperatureUnit: 'celsius',
            });
            await jest.advanceTimersByTimeAsync(POLLING_TIMEOUT);
            expect(noResponse).toBe(0);
        });

        it('ignores a column without a name in a cut-short answer', async () => {
            await connect();
            const updates = [];
            SUT.on('update', updated => updates.push(updated));

            feed({ t: 'dat', cols: ['Pow', ''], dat: [1, 5] });

            expect(updates).toEqual([{ power: 'on' }]);
            expect(SUT._properties).not.toHaveProperty('');
        });
    });

    describe('getVendorProperties() / setVendorProperties()', () => {
        it('rejects before the client is connected', async () => {
            SUT = new Client({ autoConnect: false });
            await expect(
                SUT.getVendorProperties(['UvcControl'])
            ).rejects.toBeInstanceOf(ClientNotConnectedError);
        });

        it('reads raw codes, apart from polls and probes', async () => {
            await connect();
            const updates = [];
            SUT.on('update', updated => updates.push(updated));

            const values = SUT.getVendorProperties([
                'UvcControl',
                'CompressorFqy',
            ]);
            await jest.advanceTimersByTimeAsync(0);
            expect(lastPack()).toEqual({
                cols: ['UvcControl', 'CompressorFqy'],
                mac: fixtures.device.cid,
                t: 'status',
            });

            feed({ t: 'dat', cols: ['UvcControl', 'CompressorFqy'], dat: [1] });

            await expect(values).resolves.toEqual({ UvcControl: 1 });
            expect(updates).toEqual([]);
        });

        it('rejects when the device does not answer', async () => {
            await connect();
            const values = SUT.getVendorProperties(['UvcControl']);
            const assertion = expect(values).rejects.toBeInstanceOf(
                ClientNoResponseError
            );
            await jest.advanceTimersByTimeAsync(POLLING_TIMEOUT);
            await assertion;
        });

        it('rejects on disconnect', async () => {
            await connect();
            const values = SUT.getVendorProperties(['UvcControl']);
            const assertion = expect(values).rejects.toBeInstanceOf(
                ClientNotConnectedError
            );
            await SUT.disconnect();
            await assertion;
        });

        it('sets raw codes', async () => {
            await connect();
            await SUT.setVendorProperties({ UvcControl: 1, AutoClean: 0 });
            expect(lastPack()).toEqual({
                opt: ['UvcControl', 'AutoClean'],
                p: [1, 0],
                t: 'cmd',
            });
        });
    });

    describe('getDeviceInfo()', () => {
        it('reports the scan answer and the firmware id', async () => {
            await connect();
            // the hid query follows the probes after binding
            const query = packs().find(
                pack => pack.t === 'status' && pack.cols[0] === 'hid'
            );
            expect(query.cols).toEqual(['hid']);
            feed({ t: 'dat', cols: ['hid'], dat: [HID] });
            await jest.advanceTimersByTimeAsync(0);

            const info = await SUT.getDeviceInfo();

            expect(info).toEqual(
                expect.objectContaining({
                    mac: fixtures.device.cid,
                    name: fixtures.device.name,
                    version: 'V1.1.13',
                    hid: HID,
                    firmwareCode: '362001068254',
                    moduleType: 'U-4MWB65VR',
                    firmwareVersion: '2.11',
                })
            );
            expect(info.upgradeWarning).toMatch(/2\.12.*cloud-only/);
        });

        it('leaves the firmware fields out when the unit has no hid', async () => {
            await connect();
            await jest.advanceTimersByTimeAsync(POLLING_TIMEOUT);

            const info = await SUT.getDeviceInfo();

            expect(info).not.toHaveProperty('hid');
            expect(info).not.toHaveProperty('upgradeWarning');
        });
    });

    describe('clock and name', () => {
        it('reads the clock', async () => {
            await connect();
            const clock = SUT.getClock();
            await jest.advanceTimersByTimeAsync(0);
            feed({ t: 'dat', cols: ['time'], dat: ['2026-10-23 19:42:01'] });

            await expect(clock).resolves.toBe('2026-10-23 19:42:01');
        });

        it('sets the clock to the local time', async () => {
            await connect();
            await SUT.setClock(new Date(2026, 9, 3, 7, 5, 9));
            expect(lastPack()).toEqual({
                opt: ['time'],
                p: ['2026-10-03 07:05:09'],
                t: 'cmd',
                sub: fixtures.device.cid,
            });
        });

        it('renames the device', async () => {
            await connect();
            await SUT.setName('Bedroom');
            expect(lastPack()).toEqual({
                opt: ['name'],
                p: ['Bedroom'],
                t: 'cmd',
            });
        });
    });
});
