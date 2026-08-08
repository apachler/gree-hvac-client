const dgram = require('dgram');

const { Client } = require('../src/client');
const { EncryptionService, EcbCipher } = require('../src/encryption-service');
const device = require('./support/device');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * Regression tests for the leaked status timeout (issue #7).
 *
 * `_requestStatus()` used to arm a new status timeout on every poll without
 * clearing the previous one. With `pollingTimeout >= pollingInterval` the
 * previous timer was still pending when the next poll overwrote
 * `_statusTimeoutRef`, orphaning it — the orphaned timer could no longer be
 * cleared by an incoming reply, so it fired a spurious `no_response` (and
 * wiped `_properties`) even though the device was answering every poll.
 *
 * The fix keeps at most one timeout armed: it measures the time since the
 * oldest unanswered status request, so a responsive device never triggers
 * `no_response` while a dead device still does.
 */
describe('Status timeout', () => {
    const POLLING_INTERVAL = 1000;
    const POLLING_TIMEOUT = 3000; // >= pollingInterval — the regime from #7

    let SUT;
    let ecb;
    let feedClient;
    let clientEncrypt;
    let noResponses;

    const statusRequests = () =>
        clientEncrypt.mock.calls.filter(([msg]) => msg.t === 'status').length;

    /** Drive scan -> bind -> bindok so polling starts */
    const connect = async () => {
        SUT.connect().catch(() => {});

        feedClient(device.scan(ecb).payload);
        await jest.advanceTimersByTimeAsync(0);
        feedClient(device.bind(ecb).payload);
        await jest.advanceTimersByTimeAsync(0);

        // connected: the initial status request has been sent
        expect(statusRequests()).toBe(1);
    };

    beforeEach(() => {
        ecb = new EcbCipher();

        dgram.createSocket.mockReturnValue(
            createSocketMock({ on: (event, cb) => (feedClient = cb) })
        );

        SUT = new Client({
            autoConnect: false,
            pollingInterval: POLLING_INTERVAL,
            pollingTimeout: POLLING_TIMEOUT,
        });

        clientEncrypt = jest.spyOn(EncryptionService.prototype, 'encrypt');

        noResponses = [];
        SUT.on('no_response', client => noResponses.push(client));
        SUT.on('error', () => {});
    });

    afterEach(async () => {
        await SUT.disconnect().catch(() => {});
        jest.restoreAllMocks();
    });

    it('should not emit spurious no_response when the device answers every poll', async () => {
        // requests go out at t=0, 1000, 2000, ...; the device answers each
        // one 1500 ms later (t=1500, 2500, ...) — within pollingTimeout, but
        // after the next poll has already gone out. Before the fix the next
        // poll overwrote the still-armed timer, orphaning it: the reply could
        // then only clear the newest timer and the orphan fired a spurious
        // no_response at t=3000 despite every request being answered in time.
        await connect(); // initial status request at t=0

        for (let t = 500; t <= 5000; t += 500) {
            await jest.advanceTimersByTimeAsync(500);
            if (t % 1000 === 500 && t >= 1500) {
                // reply to the request sent 1500 ms ago
                feedClient(device.status(ecb).payload);
            }
        }

        expect(statusRequests()).toBe(6);
        expect(noResponses).toHaveLength(0);
    });

    it('should emit no_response when the device stops responding', async () => {
        await connect();
        feedClient(device.status(ecb).payload);

        // the device goes silent; the next poll arms the status timeout,
        // which must fire pollingTimeout later despite further polls
        await jest.advanceTimersByTimeAsync(POLLING_INTERVAL + POLLING_TIMEOUT);

        expect(noResponses).toHaveLength(1);
    });
});
