const dgram = require('dgram');

const { Client } = require('../src/client');
const { EncryptionService, EcbCipher } = require('../src/encryption-service');
const {
    ClientNotConnectedError,
    ClientNoResponseError,
} = require('../src/errors');
const device = require('./support/device');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * getProperties() asks for a status right away and resolves with all the
 * properties once the device answered.
 */
describe('Client#getProperties()', () => {
    const POLLING_TIMEOUT = 500;

    let SUT;
    let ecb;
    let feedClient;
    let clientEncrypt;

    const statusRequests = () =>
        clientEncrypt.mock.calls
            .map(([msg]) => msg)
            .filter(msg => msg.t === 'status' && msg.cols.includes('Pow'));
    const feed = pack =>
        feedClient(
            JSON.stringify({
                ...fixtures.pack(pack),
                pack: ecb.encrypt(pack).payload,
            })
        );

    beforeEach(() => {
        ecb = new EcbCipher();
        dgram.createSocket.mockReturnValue(
            createSocketMock({
                on: (event, cb) => event === 'message' && (feedClient = cb),
            })
        );
        SUT = new Client({
            autoConnect: false,
            poll: false,
            pollingTimeout: POLLING_TIMEOUT,
        });
        clientEncrypt = jest.spyOn(EncryptionService.prototype, 'encrypt');
        SUT.on('error', () => {});
    });

    const connect = async () => {
        SUT.connect().catch(() => {});
        feedClient(device.scan(ecb).payload);
        await jest.advanceTimersByTimeAsync(0);
        feedClient(device.bind(ecb).payload);
        await jest.advanceTimersByTimeAsync(0);
    };

    afterEach(async () => {
        await SUT.disconnect().catch(() => {});
        jest.restoreAllMocks();
    });

    it('rejects before the client is connected', async () => {
        await expect(SUT.getProperties()).rejects.toBeInstanceOf(
            ClientNotConnectedError
        );
    });

    it('requests a status and resolves with all the properties', async () => {
        await connect();
        const before = statusRequests().length;

        const properties = SUT.getProperties();
        await jest.advanceTimersByTimeAsync(0);
        expect(statusRequests()).toHaveLength(before + 1);

        feed({ t: 'dat', cols: ['Pow', 'SetTem'], dat: [1, 23] });

        await expect(properties).resolves.toEqual({
            power: 'on',
            temperature: 23,
        });
    });

    it('is not resolved by the answer to a probe', async () => {
        await connect();
        let settled = false;
        const properties = SUT.getProperties().finally(() => (settled = true));

        feed({ t: 'dat', cols: ['OutEnvTem'], dat: [45] });
        await jest.advanceTimersByTimeAsync(0);
        expect(settled).toBe(false);

        feed({ t: 'dat', cols: ['Pow'], dat: [0] });
        await expect(properties).resolves.toEqual({
            power: 'off',
            outdoorTemperature: 5,
        });
    });

    it('rejects when the device does not answer', async () => {
        await connect();
        const properties = SUT.getProperties();
        const assertion = expect(properties).rejects.toBeInstanceOf(
            ClientNoResponseError
        );

        await jest.advanceTimersByTimeAsync(POLLING_TIMEOUT);

        await assertion;
    });

    it('rejects on disconnect', async () => {
        await connect();
        const properties = SUT.getProperties();
        const assertion = expect(properties).rejects.toBeInstanceOf(
            ClientNotConnectedError
        );

        await SUT.disconnect();

        await assertion;
    });
});
