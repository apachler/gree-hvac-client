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

    beforeEach(() => {
        dgram.createSocket.mockReturnValue(createSocketMock());

        jest.clearAllTimers();

        SUT = new Client({
            autoConnect: false,
            connectTimeout: CONNECT_TIMEOUT,
        });
        SUT.on('error', () => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should clear a previously armed reconnect instead of stranding it', () => {
        const baseline = jest.getTimerCount();

        SUT._scheduleReconnect();
        const first = SUT._socketTimeoutRef;

        SUT._scheduleReconnect();

        // The second call replaced the first timer rather than leaving it armed
        // behind an unreachable reference.
        expect(SUT._socketTimeoutRef).not.toBe(first);
        expect(jest.getTimerCount()).toBe(baseline + 1);

        // ...so _dispose() can still reach every timer this client armed.
        SUT._dispose();
        expect(SUT._socketTimeoutRef).toBeNull();
        expect(jest.getTimerCount()).toBe(baseline);
    });

    it('should not reconnect once the socket is gone', async () => {
        const errors = [];
        SUT.removeAllListeners('error');
        SUT.on('error', e => errors.push(e));

        // A reconnect that survived disconnect(): socket already released.
        SUT._socket = null;
        SUT._scheduleReconnect();

        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT * 10);

        expect(errors).toHaveLength(0);
        expect(SUT._socketTimeoutRef).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('should stop reconnecting after disconnect', async () => {
        const errors = [];
        SUT.removeAllListeners('error');
        SUT.on('error', e => errors.push(e));

        SUT.connect().catch(() => {});

        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT * 2);
        expect(errors).toHaveLength(2);
        expect(SUT._socketTimeoutRef).not.toBeNull();

        await SUT.disconnect();
        expect(SUT._socketTimeoutRef).toBeNull();

        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT * 10);

        expect(errors).toHaveLength(2);
        expect(SUT._socketTimeoutRef).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });
});
