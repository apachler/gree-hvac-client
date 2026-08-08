const dgram = require('dgram');

const { Client } = require('../src/client');
const { EncryptionService, EcbCipher } = require('../src/encryption-service');
const device = require('./support/device');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * Regression test for the dangling bind-retry timer (U4 / upstream PR #29).
 *
 * `_handleHandshakeResponse` arms `_bindTimeoutRef` — a 500 ms timer that fires
 * a second bind attempt if the first isn't confirmed. `_dispose()` must clear
 * it, otherwise a `disconnect()` landing inside that window leaves the timer to
 * fire on a closed/nulled socket (spurious second bind + unhandled
 * `ClientNotConnectedError`).
 */
describe('Bind timeout', () => {
    let SUT;
    let ecb;
    let feedClient;
    let clientEncrypt;
    let errors;

    const bindAttempts = () =>
        clientEncrypt.mock.calls.filter(([msg]) => msg.t === 'bind').length;

    beforeEach(() => {
        ecb = new EcbCipher();

        dgram.createSocket.mockReturnValue(
            createSocketMock({ on: (event, cb) => (feedClient = cb) })
        );

        SUT = new Client({ autoConnect: false });

        clientEncrypt = jest.spyOn(EncryptionService.prototype, 'encrypt');

        errors = [];
        SUT.on('error', e => errors.push(e));

        // not awaited; the connect promise rejects with ClientCancelConnectError
        // once we disconnect — expected, so swallow it
        SUT.connect().catch(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should clear the pending bind timer on disconnect and not send a second bind', async () => {
        // device answers SCAN -> client sends BIND attempt 1 and arms the
        // 500 ms bind-retry timer
        feedClient(device.scan(ecb).payload);
        await jest.advanceTimersByTimeAsync(100);
        expect(bindAttempts()).toBe(1);

        // disconnect before the 500 ms bind-retry fires
        await SUT.disconnect();

        // advance well past the bind-retry timeout
        await jest.advanceTimersByTimeAsync(1000);

        // the dangling timer must not have fired a second bind...
        expect(bindAttempts()).toBe(1);
        // ...nor produced an error (e.g. ClientNotConnectedError on a null socket)
        expect(errors).toHaveLength(0);
    });
});
