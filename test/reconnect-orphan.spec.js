const dgram = require('dgram');

const { Client } = require('../src/client');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * A reconnect timer must never outlive the client.
 *
 * `_scheduleReconnect()` used to overwrite `_socketTimeoutRef` without clearing
 * the timer already stored there, and `_dispose()` cleared only the reference it
 * could still see. Two concurrent `_initialize()` chains — one resuming from
 * `await this._scheduleReconnect()`, one started by the timer callback — were
 * therefore enough to strand a timer that nothing could ever clear.
 *
 * A stranded timer fires `connectTimeout` after `disconnect()`, fails in
 * `_socketSend()` with `ClientNotConnectedError` because the socket is gone,
 * and re-arms itself from `_initialize()`'s catch block. That loop never ends:
 * downstream consumers (homey com.gree, Node-RED) saw one error every
 * `connectTimeout` for hours, delivered as unhandled rejections because the
 * emitter had already been detached.
 */
describe('Reconnect timer lifecycle', () => {
    const CONNECT_TIMEOUT = 1000;

    let SUT;
    let errors;
    let socketMock;

    beforeEach(() => {
        socketMock = createSocketMock();
        dgram.createSocket.mockReturnValue(socketMock);

        SUT = new Client({
            autoConnect: false,
            connectTimeout: CONNECT_TIMEOUT,
        });
        errors = [];
        SUT.on('error', e => errors.push(e));

        // Constructing the client queues logger flushes (setImmediate) that
        // jest.getTimerCount() would report. Drop them so the counts asserted
        // below reflect only the timers the client itself arms.
        jest.clearAllTimers();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should clear a previously armed reconnect instead of stranding it', () => {
        SUT._scheduleReconnect();
        const first = SUT._socketTimeoutRef;

        SUT._scheduleReconnect();

        // The second call replaced the first timer rather than leaving it armed
        // behind an unreachable reference.
        expect(SUT._socketTimeoutRef).not.toBe(first);
        expect(jest.getTimerCount()).toBe(1);

        // ...so _dispose() can still reach every timer this client armed.
        SUT._dispose();
        expect(SUT._socketTimeoutRef).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('should not reconnect once the socket is gone', async () => {
        // A reconnect that survived disconnect(): socket already released.
        SUT._socket = null;
        SUT._scheduleReconnect();

        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT * 10);

        expect(errors).toHaveLength(0);
        expect(SUT._socketTimeoutRef).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('should not arm a reconnect when disconnect lands during the scan send', async () => {
        // capture the scan send's callback so the send stays in flight
        let sendCallback;
        socketMock.send = (buff, start, length, port, host, cb) => {
            sendCallback = cb;
        };

        SUT.connect().catch(() => {});

        // disconnect() races the in-flight send, then the send completes
        await SUT.disconnect();
        sendCallback();
        await jest.advanceTimersByTimeAsync(0);

        expect(SUT._socketTimeoutRef).toBeNull();
        expect(jest.getTimerCount()).toBe(0);

        // no connect-timeout error ever fires on the disconnected client
        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT * 10);
        expect(errors).toHaveLength(0);
    });

    it('should not emit an error when a reconnect scan send fails after disconnect', async () => {
        SUT.connect().catch(() => {});

        // the first window elapses -> one timeout error; the reconnect starts
        // attempt #2, whose scan send stays in flight
        let sendCallback = null;
        socketMock.send = (buff, start, length, port, host, cb) => {
            sendCallback = cb;
        };
        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT);
        expect(errors).toHaveLength(1);
        expect(sendCallback).not.toBeNull();

        // disconnect() races attempt #2, then its send fails on the released
        // socket
        await SUT.disconnect();
        sendCallback(new Error('socket is closed'));
        await jest.advanceTimersByTimeAsync(0);

        // the failure is discarded: no 'error' after 'disconnect', no retry
        expect(errors).toHaveLength(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('should settle the initialize promise even when its reconnect is superseded', async () => {
        SUT.connect().catch(() => {});

        // _initialize used to stay parked on a promise that only the armed
        // reconnect timer could resolve — clearing that timer froze the chain
        // (and whoever awaited it) forever
        const settled = jest.fn();
        SUT._initialize().then(settled, settled);
        await jest.advanceTimersByTimeAsync(0);

        // the armed reconnect is cleared without ever firing
        SUT._dispose();
        await jest.advanceTimersByTimeAsync(0);

        expect(settled).toHaveBeenCalled();
    });

    it('should tolerate disconnect landing before the socket bind completes', async () => {
        let bindCallback;
        socketMock.bind = jest.fn(cb => {
            bindCallback = cb;
        });

        SUT.connect().catch(() => {});
        await SUT.disconnect();

        // the UDP bind completes only after the socket has been released;
        // the callback used to throw on the nulled socket (setBroadcast)
        expect(() => bindCallback()).not.toThrow();

        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT * 10);
        expect(errors).toHaveLength(0);
        expect(jest.getTimerCount()).toBe(0);
    });

    // The full reconnect-then-disconnect flow lives in test/reconnect.spec.js
    // ("should keep timing out and reconnecting while unreachable, then stop
    // on disconnect"), which also asserts no timer survives disconnect().
});
