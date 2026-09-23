const dgram = require('dgram');

const { Client } = require('../src/client');
const { EncryptionService, EcbCipher } = require('../src/encryption-service');
const {
    ClientConnectTimeoutError,
    ClientMessageUnpackError,
    ClientSocketError,
} = require('../src/errors');
const { createOptions } = require('../src/client-options');
const device = require('./support/device');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

const GENERIC_KEY = 'a3K8Bx%2r8Y7#xDh';
const DEVICE_ADDRESS = { address: '10.0.0.42', port: 7000 };

/**
 * Build a device message encrypted with the given key
 *
 * @param {object} pack payload
 * @param {string} key AES-ECB key
 * @param {string} [cid] cid of the enclosing message
 * @returns {string}
 */
const message = (pack, key, cid = '-CLIENT-ID-') =>
    JSON.stringify({
        ...fixtures.pack(pack),
        cid,
        pack: new EcbCipher(key).encrypt(pack).payload,
    });

/**
 * Recovery from connection loss: the device drops off WiFi, comes back
 * re-paired with a new key or at another address, answers slowly or twice.
 */
describe('Connection recovery', () => {
    let SUT;
    let feedClient;
    let socketMock;
    let sent;
    let events;
    let ecb;

    const requests = type =>
        sent.filter(({ request }) => request.t === type).length;
    const encrypted = type =>
        EncryptionService.prototype.encrypt.mock.calls.filter(
            ([msg]) => msg.t === type
        ).length;

    /**
     * @param {object} [options] client options on top of the test defaults
     */
    const createClient = options => {
        SUT = new Client({
            autoConnect: false,
            host: '10.0.0.255',
            pollingInterval: 1000,
            pollingTimeout: 500,
            ...options,
        });

        events = { connect: 0, no_response: 0, update: 0, errors: [] };
        SUT.on('connect', () => events.connect++);
        SUT.on('no_response', () => events.no_response++);
        SUT.on('update', () => events.update++);
        SUT.on('error', e => events.errors.push(e));

        SUT.connect().catch(() => {});
    };

    /**
     * Drive scan -> bind -> bindok -> status with the default device key
     *
     * @param {object} [options] client options on top of the test defaults
     */
    const connect = async (options = {}) => {
        createClient(options);
        // device.bind() switches the cipher to the device key, so the status
        // reply must use the same instance
        ecb = new EcbCipher();
        feedClient(device.scan(ecb).payload, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);
        feedClient(device.bind(ecb).payload, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);
        feedClient(device.status(ecb).payload, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);
    };

    beforeEach(() => {
        sent = [];
        socketMock = createSocketMock({
            on: (event, cb) => {
                if (event === 'message') {
                    feedClient = cb;
                }
                if (event === 'error') {
                    socketMock.emitError = cb;
                }
            },
            send: (buff, start, length, port, host, cb) => {
                sent.push({ request: JSON.parse(buff), host });
                cb();
            },
        });
        dgram.createSocket.mockReturnValue(socketMock);

        jest.spyOn(EncryptionService.prototype, 'encrypt');
    });

    afterEach(async () => {
        await SUT.disconnect().catch(() => {});

        // nothing keeps running after disconnect (jest.getTimerCount() would
        // also count the logger's setImmediate writes)
        const sentAtDisconnect = sent.length;
        await jest.advanceTimersByTimeAsync(60000);
        expect(sent).toHaveLength(sentAtDisconnect);
        jest.restoreAllMocks();
    });

    it('should re-scan and re-bind with the new key after maxNoResponse missed polls', async () => {
        await connect({ maxNoResponse: 3 });
        expect(events.connect).toBe(1);
        expect(requests('scan')).toBe(1);

        // the device drops off WiFi: polls at 1000, 2000, 3000 go unanswered
        await jest.advanceTimersByTimeAsync(3000);
        expect(events.no_response).toBe(2);
        expect(requests('scan')).toBe(1);

        // third consecutive miss -> rebind starts with a fresh scan
        await jest.advanceTimersByTimeAsync(1000);
        expect(events.no_response).toBe(3);
        expect(requests('scan')).toBe(2);

        // the device is back, re-paired with a new key
        const newKey = 'NEW-DEVICE-KEY--';
        feedClient(message(fixtures.device, GENERIC_KEY), DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);
        feedClient(
            message({ ...fixtures.bindOk, key: newKey }, GENERIC_KEY),
            DEVICE_ADDRESS
        );
        await jest.advanceTimersByTimeAsync(0);
        expect(events.connect).toBe(2);

        feedClient(message(fixtures.status, newKey), DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);
        expect(events.update).toBe(2);
        expect(events.errors).toHaveLength(0);
    });

    it('should not rebind when the device answers again in time', async () => {
        await connect({ maxNoResponse: 3 });

        await jest.advanceTimersByTimeAsync(2600); // two misses
        feedClient(device.status(ecb).payload, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(2600); // two more, count restarted

        expect(events.no_response).toBe(4);
        expect(requests('scan')).toBe(1);
    });

    it('should never rebind with maxNoResponse 0', async () => {
        await connect({ maxNoResponse: 0 });

        await jest.advanceTimersByTimeAsync(20000);

        expect(events.no_response).toBeGreaterThan(10);
        expect(requests('scan')).toBe(1);
    });

    it('should back off exponentially while the device stays unreachable', async () => {
        createClient({ connectTimeout: 1000, reconnectMaxDelay: 4000 });
        const timeouts = [];
        SUT.on('error', e => {
            if (e instanceof ClientConnectTimeoutError) {
                timeouts.push(Date.now());
            }
        });
        const start = Date.now();

        await jest.advanceTimersByTimeAsync(15000);

        // 1000, +2000, +4000, +4000 (capped), +4000
        expect(timeouts.map(t => t - start)).toEqual([
            1000, 3000, 7000, 11000, 15000,
        ]);
    });

    it('should survive a failing first status request after bind', async () => {
        createClient();
        feedClient(device.scan(new EcbCipher()).payload, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);

        // the network drops right when the bind is confirmed
        socketMock.send = (buff, start, length, port, host, cb) =>
            cb(
                Object.assign(new Error('send ENETUNREACH'), {
                    code: 'ENETUNREACH',
                })
            );
        feedClient(device.bind(new EcbCipher()).payload, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);

        // still connected and polling instead of an unhandled rejection
        expect(events.connect).toBe(1);
        expect(events.errors.length).toBeGreaterThan(0);
        expect(SUT._statusIntervalRef).not.toBeNull();

        // unsent requests count as unanswered
        await jest.advanceTimersByTimeAsync(600);
        expect(events.no_response).toBe(1);
    });

    it('should ignore a duplicate binding confirmation', async () => {
        await connect();
        const interval = SUT._statusIntervalRef;

        // the device confirms both bind attempts, or retransmits its bindok
        await SUT._handleBindingConfirmationResponse();

        expect(events.connect).toBe(1);
        expect(SUT._statusIntervalRef).toBe(interval);
    });

    it('should ignore a scan response once bound', async () => {
        await connect();

        // e.g. a retransmission, or a broadcast scan by another controller
        feedClient(device.scan(new EcbCipher()).payload, DEVICE_ADDRESS);
        // past bindTimeout: a re-bind would have retried with GCM by now
        await jest.advanceTimersByTimeAsync(1500);

        // no re-bind, and polling still uses the device key
        expect(encrypted('bind')).toBe(1);
        feedClient(device.status(ecb).payload, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);
        expect(events.errors).toHaveLength(0);
    });

    it('should not report a late reply to the first bind attempt as an error', async () => {
        createClient({ bindTimeout: 500 });
        feedClient(device.scan(new EcbCipher()).payload, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(600); // second (GCM) attempt sent
        expect(encrypted('bind')).toBe(2);

        // slow WiFi: the reply to attempt 1 arrives, then a retransmission
        const bindOk = message(fixtures.bindOk, GENERIC_KEY);
        feedClient(bindOk, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);
        feedClient(bindOk, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);

        expect(events.connect).toBe(1);
        expect(events.errors).toHaveLength(0);
    });

    it('should still report undecryptable messages that are no bind reply', async () => {
        await connect();

        feedClient(
            message(fixtures.status, 'SOME-OTHER-KEY--'),
            DEVICE_ADDRESS
        );
        await jest.advanceTimersByTimeAsync(0);

        expect(events.errors).toHaveLength(1);
        expect(events.errors[0]).toBeInstanceOf(ClientMessageUnpackError);
    });

    it('should take the cid from the message when the scan response has none', async () => {
        createClient();
        feedClient(
            message(
                { ...fixtures.device, cid: '', mac: '' },
                GENERIC_KEY,
                'f4911e000001'
            ),
            DEVICE_ADDRESS
        );
        await jest.advanceTimersByTimeAsync(0);
        feedClient(message(fixtures.bindOk, GENERIC_KEY), DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);

        expect(SUT.getDeviceId()).toBe('f4911e000001');
        expect(events.connect).toBe(1);
    });

    it('should scan the configured host but talk to the device address', async () => {
        await connect();

        const hosts = type =>
            sent.filter(({ request }) => request.t === type).map(s => s.host);
        expect(hosts('scan')).toEqual(['10.0.0.255']);
        expect(new Set(hosts('pack'))).toEqual(new Set(['10.0.0.42']));
    });

    it('should stick to the first device answering a broadcast scan', async () => {
        createClient();
        feedClient(device.scan(new EcbCipher()).payload, DEVICE_ADDRESS);
        await jest.advanceTimersByTimeAsync(0);
        feedClient(
            message(
                { ...fixtures.device, cid: 'other', mac: 'other' },
                GENERIC_KEY
            ),
            { address: '10.0.0.43', port: 7000 }
        );
        await jest.advanceTimersByTimeAsync(0);

        expect(SUT.getDeviceId()).toBe('-CLIENT-ID-');
        expect(encrypted('bind')).toBe(1);
    });

    it('should only bind to the configured mac', async () => {
        createClient({ mac: 'F4:91:1E:00:00:02' });
        feedClient(
            message(
                {
                    ...fixtures.device,
                    cid: 'f4911e000001',
                    mac: 'f4911e000001',
                },
                GENERIC_KEY
            ),
            { address: '10.0.0.41', port: 7000 }
        );
        await jest.advanceTimersByTimeAsync(0);
        expect(encrypted('bind')).toBe(0);

        feedClient(
            message(
                {
                    ...fixtures.device,
                    cid: 'f4911e000002',
                    mac: 'f4911e000002',
                },
                GENERIC_KEY
            ),
            DEVICE_ADDRESS
        );
        await jest.advanceTimersByTimeAsync(0);

        expect(SUT.getDeviceId()).toBe('f4911e000002');
        expect(encrypted('bind')).toBe(1);
    });

    it('should report socket errors as error events', async () => {
        createClient();

        socketMock.emitError(new Error('bind EADDRINUSE'));

        expect(events.errors).toHaveLength(1);
        expect(events.errors[0]).toBeInstanceOf(ClientSocketError);
    });
});

describe('Client options from the environment', () => {
    afterEach(() => {
        delete process.env.GREE_HVAC_POLL;
        delete process.env.GREE_HVAC_MAX_NO_RESPONSE;
    });

    it('should convert environment strings to the option type', () => {
        process.env.GREE_HVAC_POLL = 'false';
        process.env.GREE_HVAC_MAX_NO_RESPONSE = '5';

        const options = createOptions({});

        expect(options.poll).toBe(false);
        expect(options.maxNoResponse).toBe(5);
    });
});
