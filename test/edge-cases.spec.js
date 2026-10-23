const dgram = require('dgram');

const { Client } = require('../src/client');
const { EcbCipher } = require('../src/encryption-service');
const {
    ClientConnectTimeoutError,
    ClientMessageParseError,
    ClientSocketSendError,
    ClientUnknownMessageError,
} = require('../src/errors');
const device = require('./support/device');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * Paths that only run when something goes wrong: unparsable or unknown
 * messages, sends failing from timers, and disconnect() racing a connect step.
 * None of them may end in an unhandled rejection.
 */
describe('Edge cases', () => {
    let SUT;
    let ecb;
    let feedClient;
    let errors;
    // decides per outgoing message: true = fail, 'hold' = never call back
    let sendPolicy;
    let held;

    const decrypted = msg => {
        try {
            return msg.t === 'scan' ? msg : ecb.decrypt(msg).payload;
        } catch {
            return msg;
        }
    };
    const feed = pack =>
        feedClient(
            JSON.stringify({
                ...fixtures.pack(pack),
                pack: ecb.encrypt(pack).payload,
            })
        );

    const connect = async () => {
        SUT.connect().catch(() => {});
        feedClient(device.scan(ecb).payload);
        await jest.advanceTimersByTimeAsync(0);
        feedClient(device.bind(ecb).payload);
        await jest.advanceTimersByTimeAsync(0);
    };

    beforeEach(() => {
        ecb = new EcbCipher();
        errors = [];
        sendPolicy = () => false;
        held = [];
        dgram.createSocket.mockReturnValue(
            createSocketMock({
                on: (event, cb) => event === 'message' && (feedClient = cb),
                send: (buff, start, length, port, host, cb) => {
                    const policy = sendPolicy(
                        decrypted(JSON.parse(String(buff)))
                    );
                    if (policy === 'hold') {
                        held.push(cb);
                    } else {
                        cb(policy ? new Error('ENETUNREACH') : undefined);
                    }
                },
            })
        );
        SUT = new Client({
            autoConnect: false,
            poll: false,
            pollingInterval: 1000,
            pollingTimeout: 500,
            connectTimeout: 1000,
        });
        SUT.on('error', error => errors.push(error));
    });

    afterEach(async () => {
        await SUT.disconnect().catch(() => {});
        jest.restoreAllMocks();
    });

    describe('bad input', () => {
        it('reports a message that is no JSON', async () => {
            await connect();
            feedClient('not json');
            await jest.advanceTimersByTimeAsync(0);

            expect(errors).toEqual([expect.any(ClientMessageParseError)]);
            expect(errors[0].props).toEqual({ jsonBuffer: 'not json' });
        });

        it('reports a message of unknown type, with the pack', async () => {
            await connect();
            feed({ t: 'weird', mac: fixtures.device.cid });
            await jest.advanceTimersByTimeAsync(0);

            expect(errors).toEqual([expect.any(ClientUnknownMessageError)]);
            expect(errors[0].props.pack).toEqual({
                t: 'weird',
                mac: fixtures.device.cid,
            });
        });

        it('ignores a scan answer after binding', async () => {
            await connect();
            feedClient(device.scan(new EcbCipher()).payload);
            await jest.advanceTimersByTimeAsync(0);

            expect(errors).toEqual([]);
            expect(SUT._bound).toBe(true);
        });

        it('ignores a scan answer in the device key after binding', async () => {
            await connect();
            feed({ ...fixtures.device });
            await jest.advanceTimersByTimeAsync(0);

            expect(errors).toEqual([]);
            expect(SUT._bound).toBe(true);
        });

        it('takes over only the values a confirmation carries', async () => {
            await connect();
            const successes = [];
            SUT.on('success', updated => successes.push(updated));

            feed({ t: 'res', opt: ['Pow', 'Mod'], val: [1] });

            expect(successes).toEqual([{ power: 'on' }]);
        });
    });

    describe('failing sends are reported, never thrown', () => {
        it('from the polling interval', async () => {
            SUT = new Client({
                autoConnect: false,
                pollingInterval: 1000,
                pollingTimeout: 500,
                maxNoResponse: 0,
            });
            SUT.on('error', error => errors.push(error));
            await connect();
            sendPolicy = msg => msg.t === 'status';

            await jest.advanceTimersByTimeAsync(1000);

            expect(errors).toContainEqual(expect.any(ClientSocketSendError));
        });

        it('from the reconnect after a connect timeout', async () => {
            SUT.connect().catch(() => {});
            await jest.advanceTimersByTimeAsync(0);
            sendPolicy = msg => msg.t === 'scan';

            await jest.advanceTimersByTimeAsync(1000);

            expect(errors).toEqual([
                expect.any(ClientConnectTimeoutError),
                expect.any(ClientSocketSendError),
            ]);
        });

        it('from the re-bind after maxNoResponse', async () => {
            SUT = new Client({
                autoConnect: false,
                poll: false,
                pollingTimeout: 500,
                maxNoResponse: 1,
            });
            SUT.on('error', error => errors.push(error));
            await connect();
            sendPolicy = msg => msg.t === 'scan';

            await jest.advanceTimersByTimeAsync(500);

            expect(errors).toEqual([expect.any(ClientSocketSendError)]);
        });

        it('as the rejection of getProperties()', async () => {
            await connect();
            sendPolicy = msg => msg.t === 'status';

            await expect(SUT.getProperties()).rejects.toBeInstanceOf(
                ClientSocketSendError
            );
        });

        it('as the rejection of getVendorProperties()', async () => {
            await connect();
            sendPolicy = msg => msg.t === 'status';

            await expect(
                SUT.getVendorProperties(['UvcControl'])
            ).rejects.toBeInstanceOf(ClientSocketSendError);
            expect(
                SUT._statusRequests.filter(r => r.cols.includes('UvcControl'))
            ).toEqual([]);
        });

        it('as the rejection of getSubUnits()', async () => {
            await connect();
            sendPolicy = msg => msg.t === 'subList';

            await expect(SUT.getSubUnits()).rejects.toBeInstanceOf(
                ClientSocketSendError
            );
            expect(SUT._subListRequest).toBeNull();
        });
    });

    describe('disconnect() racing a connect step', () => {
        it('stops before polling when it raced the first status request', async () => {
            SUT = new Client({ autoConnect: false, pollingInterval: 1000 });
            SUT.on('error', error => errors.push(error));
            sendPolicy = msg => (msg.t === 'status' ? 'hold' : false);
            await connect();

            const disconnected = SUT.disconnect();
            held.forEach(cb => cb());
            await disconnected;
            await jest.advanceTimersByTimeAsync(5000);

            expect(SUT._statusIntervalRef).toBeNull();
            expect(errors).toEqual([]);
        });

        it('stops probing', async () => {
            let probes = 0;
            sendPolicy = msg => {
                if (msg.t === 'status' && msg.cols.length === 1) {
                    probes++;
                    return 'hold';
                }
                return false;
            };
            await connect();
            expect(probes).toBe(1);

            await SUT.disconnect();
            held.forEach(cb => cb());
            await jest.advanceTimersByTimeAsync(0);

            expect(probes).toBe(1);
        });

        it('makes a pending re-initialize do nothing', async () => {
            await connect();
            await SUT.disconnect();
            const send = jest.fn();
            sendPolicy = send;

            await SUT._initialize();

            expect(send).not.toHaveBeenCalled();
        });
    });
});
