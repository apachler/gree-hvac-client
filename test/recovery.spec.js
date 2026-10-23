const dgram = require('dgram');

const { Client } = require('../src/client');
const { EcbCipher } = require('../src/encryption-service');
const {
    ClientConnectTimeoutError,
    ClientNotConnectedError,
    ClientSocketError,
} = require('../src/errors');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

const GENERIC_KEY = 'a3K8Bx%2r8Y7#xDh';
const DEVICE_KEY = '---BINDED-KEY---';
const MAC = 'f4911e000002';
const DEVICE_ADDRESS = { address: '10.0.0.42', port: 7000 };

/**
 * Build a device message encrypted with the given key
 *
 * @param {object} pack payload
 * @param {string} key AES-ECB key
 * @returns {string}
 */
const message = (pack, key) =>
    JSON.stringify({
        ...fixtures.pack(pack),
        cid: pack.cid || pack.mac || MAC,
        pack: new EcbCipher(key).encrypt(pack).payload,
    });

const scanReply = (mac = MAC) =>
    message({ ...fixtures.device, cid: mac, mac }, GENERIC_KEY);
const bindReply = () => message({ ...fixtures.bindOk, mac: MAC }, GENERIC_KEY);
const statusReply = (dat = fixtures.status.dat) =>
    message({ ...fixtures.status, mac: MAC, dat }, DEVICE_KEY);

/**
 * Lifecycle of a long-running client: unresponsive re-bind on a new socket,
 * the recovery pause, socket errors, the `reconnecting` event, what
 * disconnect() guarantees, and following a unit by its MAC.
 */
describe('Recovery', () => {
    let SUT;
    let sockets;
    let sent;
    let events;

    const current = () => sockets.at(-1);
    const feed = (payload, rinfo = DEVICE_ADDRESS) =>
        current().feed(payload, rinfo);
    const scans = () => sent.filter(({ request }) => request.t === 'scan');

    /**
     * @param {object} [options] client options on top of the test defaults
     */
    const createClient = options => {
        SUT = new Client({
            autoConnect: false,
            host: '10.0.0.255',
            mac: MAC,
            pollingInterval: 1000,
            pollingTimeout: 500,
            ...options,
        });

        events = [];
        for (const name of [
            'connect',
            'no_response',
            'update',
            'reconnecting',
            'disconnect',
        ]) {
            SUT.on(name, info =>
                events.push(name === 'reconnecting' ? { [name]: info } : name)
            );
        }
        SUT.on('error', error => events.push(error));

        SUT.connect().catch(() => {});
    };

    /**
     * Drive scan -> bind -> bindok -> status
     *
     * @param {object} [rinfo] where the device answers from
     */
    const bindDevice = async (rinfo = DEVICE_ADDRESS) => {
        feed(scanReply(), rinfo);
        await jest.advanceTimersByTimeAsync(0);
        feed(bindReply(), rinfo);
        await jest.advanceTimersByTimeAsync(0);
        feed(statusReply(), rinfo);
        await jest.advanceTimersByTimeAsync(0);
    };

    const connect = async options => {
        createClient(options);
        await bindDevice();
    };

    const reconnecting = () =>
        events.filter(e => e.reconnecting).map(e => e.reconnecting);

    beforeEach(() => {
        sockets = [];
        sent = [];
        // a socket of its own per createSocket(), to tell them apart
        dgram.createSocket.mockImplementation(() => {
            const socket = { closed: false };
            socket.mock = createSocketMock({
                on: (event, cb) => {
                    if (event === 'message') {
                        socket.feed = cb;
                    }
                    if (event === 'error') {
                        socket.emitError = cb;
                    }
                },
                send: (buff, start, length, port, host, cb) => {
                    sent.push({
                        request: JSON.parse(buff),
                        host,
                        socket: sockets.indexOf(socket),
                        at: Date.now(),
                    });
                    cb();
                },
                close: jest.fn(cb => {
                    socket.closed = true;
                    cb?.();
                }),
            });
            sockets.push(socket);
            return socket.mock;
        });
    });

    afterEach(async () => {
        await SUT.disconnect().catch(() => {});

        const sentAtDisconnect = sent.length;
        await jest.advanceTimersByTimeAsync(600000);
        expect(sent).toHaveLength(sentAtDisconnect);
        jest.restoreAllMocks();
    });

    describe('reopenSocket', () => {
        it('re-binds an unresponsive device from a new socket', async () => {
            await connect({ maxNoResponse: 3 });
            expect(sockets).toHaveLength(1);

            await jest.advanceTimersByTimeAsync(4000);

            expect(reconnecting()).toEqual([
                { attempt: 1, delayMs: 0, reason: 'no_response' },
            ]);
            expect(sockets).toHaveLength(2);
            expect(sockets[0].closed).toBe(true);
            expect(scans().map(s => s.socket)).toEqual([0, 1]);

            await bindDevice();
            expect(events.filter(e => e === 'connect')).toHaveLength(2);
            expect(events.filter(e => e === 'update')).toHaveLength(2);
        });

        it('ignores what still arrives on the replaced socket', async () => {
            await connect({ maxNoResponse: 3 });
            await jest.advanceTimersByTimeAsync(4000);
            await bindDevice();
            const updates = events.filter(e => e === 'update').length;

            sockets[0].feed(statusReply([1]), DEVICE_ADDRESS);
            await jest.advanceTimersByTimeAsync(0);

            expect(events.filter(e => e === 'update')).toHaveLength(updates);
        });

        it('keeps its socket with reopenSocket false', async () => {
            await connect({ maxNoResponse: 3, reopenSocket: false });

            await jest.advanceTimersByTimeAsync(4000);

            expect(sockets).toHaveLength(1);
            expect(scans()).toHaveLength(2);
            await bindDevice();
            expect(events.filter(e => e === 'connect')).toHaveLength(2);
        });

        it('starts every connect attempt on a new socket', async () => {
            createClient({ connectTimeout: 1000 });

            await jest.advanceTimersByTimeAsync(1000);

            expect(sockets).toHaveLength(2);
            expect(sockets[0].closed).toBe(true);
            expect(scans().map(s => s.socket)).toEqual([0, 1]);
        });
    });

    describe('reconnecting event', () => {
        it('follows each connect timeout error', async () => {
            createClient({ connectTimeout: 1000, reconnectMaxDelay: 4000 });

            await jest.advanceTimersByTimeAsync(3000);

            expect(events).toEqual([
                expect.any(ClientConnectTimeoutError),
                {
                    reconnecting: {
                        attempt: 2,
                        delayMs: 0,
                        reason: 'connect_timeout',
                    },
                },
                expect.any(ClientConnectTimeoutError),
                {
                    reconnecting: {
                        attempt: 3,
                        delayMs: 0,
                        reason: 'connect_timeout',
                    },
                },
            ]);
        });

        it('is not emitted when an error listener disconnects', async () => {
            createClient({ connectTimeout: 1000 });
            SUT.once('error', () => SUT.disconnect());

            await jest.advanceTimersByTimeAsync(5000);

            expect(reconnecting()).toEqual([]);
            expect(scans()).toHaveLength(1);
        });
    });

    describe('recoveryDelay', () => {
        it('pauses before re-scanning, then backs off from the pause', async () => {
            await connect({
                maxNoResponse: 1,
                recoveryDelay: 10000,
                connectTimeout: 1000,
                reconnectMaxDelay: 40000,
            });
            const boundAt = Date.now();

            // poll at 1000 unanswered: no_response at 1500, then the pause
            await jest.advanceTimersByTimeAsync(1500);
            expect(reconnecting()).toEqual([
                { attempt: 1, delayMs: 10000, reason: 'no_response' },
            ]);
            const pausedAt = sent.length;

            await jest.advanceTimersByTimeAsync(130000);

            // nothing at all is sent during the pause
            expect(sent[pausedAt].request.t).toBe('scan');
            // 10000 pause, then 10000, 20000, 40000, 40000 (capped)
            expect(scans().map(s => s.at - boundAt)).toEqual([
                0, 11500, 21500, 41500, 81500, 121500,
            ]);
        });

        it('rejects getProperties() during the pause', async () => {
            await connect({ maxNoResponse: 1, recoveryDelay: 10000 });
            await jest.advanceTimersByTimeAsync(1500);

            await expect(SUT.getProperties()).rejects.toBeInstanceOf(
                ClientNotConnectedError
            );
        });

        it('starts over at the pause once bound again', async () => {
            await connect({
                maxNoResponse: 1,
                recoveryDelay: 10000,
                connectTimeout: 1000,
            });
            await jest.advanceTimersByTimeAsync(1500 + 10000 + 10000);
            await bindDevice();

            await jest.advanceTimersByTimeAsync(1500);

            expect(reconnecting().at(-1)).toEqual({
                attempt: 1,
                delayMs: 10000,
                reason: 'no_response',
            });
        });

        it('waits for the longer of recoveryDelay and reconnectMaxDelay', async () => {
            await connect({
                maxNoResponse: 1,
                recoveryDelay: 20000,
                connectTimeout: 1000,
                reconnectMaxDelay: 5000,
            });
            const boundAt = Date.now();

            await jest.advanceTimersByTimeAsync(1500 + 20000 + 40000);

            expect(scans().map(s => s.at - boundAt)).toEqual([
                0, 21500, 41500, 61500,
            ]);
        });
    });

    describe('socket errors', () => {
        it('recover on a new socket after the connect back-off', async () => {
            await connect({ connectTimeout: 1000 });
            const pending = SUT.getProperties();

            current().emitError(new Error('recv ECONNREFUSED'));

            await expect(pending).rejects.toBeInstanceOf(
                ClientNotConnectedError
            );
            expect(events).toContainEqual(expect.any(ClientSocketError));
            expect(reconnecting()).toEqual([
                { attempt: 2, delayMs: 1000, reason: 'socket_error' },
            ]);

            await jest.advanceTimersByTimeAsync(1000);
            expect(sockets).toHaveLength(2);
            expect(scans().map(s => s.socket)).toEqual([0, 1]);

            await bindDevice();
            expect(events.filter(e => e === 'connect')).toHaveLength(2);
        });

        it('back off when the new socket fails at once', async () => {
            createClient({ connectTimeout: 1000, reconnectMaxDelay: 8000 });

            for (let i = 0; i < 4; i++) {
                current().emitError(new Error('bind EADDRINUSE'));
                await jest.advanceTimersByTimeAsync(0);
            }

            expect(reconnecting().map(r => r.delayMs)).toEqual([
                1000, 2000, 4000, 8000,
            ]);
        });

        it('are only reported with reopenSocket false', async () => {
            await connect({ reopenSocket: false, maxNoResponse: 0 });

            current().emitError(new Error('recv ECONNREFUSED'));
            await jest.advanceTimersByTimeAsync(5000);

            expect(events).toContainEqual(expect.any(ClientSocketError));
            expect(reconnecting()).toEqual([]);
            expect(sockets).toHaveLength(1);
        });

        it('of a replaced socket are ignored', async () => {
            createClient({ connectTimeout: 1000 });
            await jest.advanceTimersByTimeAsync(1000);
            const before = events.length;

            sockets[0].emitError(new Error('late'));

            expect(events).toHaveLength(before);
        });
    });

    describe('disconnect()', () => {
        /**
         * @returns {Array} events emitted from now on
         */
        const recordEmits = () => {
            const emitted = [];
            const emit = SUT.emit.bind(SUT);
            SUT.emit = (name, ...args) => {
                emitted.push(name);
                return emit(name, ...args);
            };
            return emitted;
        };

        it('ends the recovery pause: nothing but disconnect after it', async () => {
            await connect({ maxNoResponse: 1, recoveryDelay: 10000 });
            await jest.advanceTimersByTimeAsync(1500);
            const emitted = recordEmits();

            await SUT.disconnect();
            await jest.advanceTimersByTimeAsync(60000);

            expect(emitted).toEqual(['disconnect']);
            expect(scans()).toHaveLength(1);
        });

        it('arms no bind retry when it races the bind request', async () => {
            createClient();
            let bindSent;
            current().mock.send = (buff, start, length, port, host, cb) => {
                sent.push({ request: JSON.parse(buff), host });
                bindSent = cb;
            };
            feed(scanReply());
            const emitted = recordEmits();

            await SUT.disconnect();
            bindSent();
            await jest.advanceTimersByTimeAsync(5000);

            expect(SUT._bindTimeoutRef).toBeNull();
            expect(emitted).toEqual(['disconnect']);
            expect(sent.filter(s => s.request.t === 'pack')).toHaveLength(1);
        });

        it('emits no error for the auto-connect it cancelled', async () => {
            SUT = new Client({ host: '10.0.0.255' });
            const errors = [];
            SUT.on('error', error => errors.push(error));
            await jest.advanceTimersByTimeAsync(0); // auto-connect starts

            await SUT.disconnect();
            await jest.advanceTimersByTimeAsync(0);

            expect(errors).toEqual([]);
        });

        it('drops a socket error that arrives after it', async () => {
            await connect();
            const socket = current();
            const emitted = recordEmits();

            await SUT.disconnect();
            socket.emitError(new Error('late'));
            await jest.advanceTimersByTimeAsync(5000);

            expect(emitted).toEqual(['disconnect']);
        });
    });

    describe('resolve by MAC', () => {
        it('follows the unit to a new DHCP address', async () => {
            await connect({ maxNoResponse: 2 });
            expect(SUT._deviceAddress).toBe('10.0.0.42');

            // the unit got another address: polls to .42 go unanswered
            await jest.advanceTimersByTimeAsync(3000);
            expect(reconnecting()).toEqual([
                { attempt: 1, delayMs: 0, reason: 'no_response' },
            ]);
            const rescan = scans().at(-1);
            expect(rescan.host).toBe('10.0.0.255');
            const sinceRescan = sent.length - 1;

            // another unit answers the broadcast scan first: not bound
            feed(scanReply('f4911e000001'), {
                address: '10.0.0.41',
                port: 7000,
            });
            await jest.advanceTimersByTimeAsync(0);
            expect(sent).toHaveLength(sinceRescan + 1);

            const moved = { address: '10.0.0.77', port: 7000 };
            await bindDevice(moved);

            expect(SUT._deviceAddress).toBe('10.0.0.77');
            expect(events.filter(e => e === 'connect')).toHaveLength(2);
            const after = sent.slice(sinceRescan + 1);
            expect(new Set(after.map(s => s.host))).toEqual(
                new Set(['10.0.0.77'])
            );

            // the old address is no longer listened to
            const updates = events.filter(e => e === 'update').length;
            feed(statusReply([1]), DEVICE_ADDRESS);
            await jest.advanceTimersByTimeAsync(0);
            expect(events.filter(e => e === 'update')).toHaveLength(updates);
        });
    });
});
