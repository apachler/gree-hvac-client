const dgram = require('dgram');

const { Client } = require('../src/client');
const {
    ClientConnectTimeoutError,
    ClientCancelConnectError,
} = require('../src/errors');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * Deterministic replacement for the previously flaky
 * "should reconnect if not connected" test (#3a). The original drove a real
 * localhost socket with `connectTimeout: 1` ms and asserted three consecutive
 * timeouts — timing-racy. Here the device is mocked and silent (no response is
 * ever fed back), and Jest fake timers advance the connect windows explicitly,
 * so the reconnect sequence is reproducible.
 */
describe('Reconnect', () => {
    const CONNECT_TIMEOUT = 1000;

    let SUT;
    let errors;

    beforeEach(() => {
        // the default `on` mock is never invoked -> the mocked device stays
        // silent, forcing timeouts
        dgram.createSocket.mockReturnValue(createSocketMock());

        errors = [];
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should keep timing out and reconnecting while unreachable, then stop on disconnect', async () => {
        SUT = new Client({
            autoConnect: false,
            connectTimeout: CONNECT_TIMEOUT,
        });
        SUT.on('error', e => errors.push(e));

        // never resolves (silent device); ultimately rejects with
        // ClientCancelConnectError once we disconnect. The rejection is
        // delivered via process.nextTick (frozen under fake timers), so capture
        // it instead of awaiting the promise directly.
        let cancelError;
        SUT.connect().catch(e => (cancelError = e));

        // each silent connect window elapses -> one timeout error + an
        // automatic reconnect that arms the next window
        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT);
        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT);
        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT);

        expect(errors).toHaveLength(3);
        expect(errors.every(e => e instanceof ClientConnectTimeoutError)).toBe(
            true
        );

        // disconnect cancels the in-flight connect and clears the reconnect timer
        await SUT.disconnect();
        await jest.advanceTimersByTimeAsync(0); // drain the nextTick rejection
        expect(cancelError).toBeInstanceOf(ClientCancelConnectError);

        // no further reconnect fires after disconnect
        await jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT * 3);
        expect(errors).toHaveLength(3);
    });
});
