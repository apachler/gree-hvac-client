const dgram = require('dgram');

const { Client } = require('../src/client');
const { EcbCipher, GcmCipher } = require('../src/encryption-service');
const { ClientSocketSendError } = require('../src/errors');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * Client.discover() broadcasts one scan and collects every device that
 * answers, with either generic key, until the timeout.
 */
describe('Client.discover()', () => {
    let feed;
    let socket;

    /**
     * @param {object} pack scan answer
     * @param {EcbCipher|GcmCipher} cipher generic-key cipher
     * @param {string} [cid] cid of the enclosing message
     * @returns {string}
     */
    const answer = (pack, cipher, cid = pack.cid) => {
        const encrypted = cipher.encrypt(pack);
        return JSON.stringify({
            ...fixtures.pack(pack),
            cid,
            pack: encrypted.payload,
            tag: encrypted.tag,
        });
    };

    beforeEach(() => {
        socket = createSocketMock({
            on: jest.fn((event, cb) => event === 'message' && (feed = cb)),
            send: jest.fn((buff, start, length, port, host, cb) => cb()),
        });
        dgram.createSocket.mockReturnValue(socket);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('collects every device that answers before the timeout', async () => {
        const discovered = Client.discover({
            host: '10.0.0.255',
            timeout: 2000,
        });

        const living = {
            ...fixtures.device,
            cid: 'aa:01',
            mac: 'aa:01',
            name: 'living',
        };
        const bedroom = {
            ...fixtures.device,
            cid: '',
            mac: '',
            name: 'bedroom',
        };
        feed(answer(living, new EcbCipher()), { address: '10.0.0.11' });
        feed(answer(bedroom, new GcmCipher(), 'bb02'), {
            address: '10.0.0.12',
        });
        // the same device answering twice, and noise
        feed(answer(living, new EcbCipher()), { address: '10.0.0.11' });
        feed('not json', { address: '10.0.0.13' });

        await jest.advanceTimersByTimeAsync(2000);
        const devices = await discovered;

        expect(socket.setBroadcast).toHaveBeenCalledWith(true);
        const [payload, , , port, host] = socket.send.mock.calls[0];
        expect(JSON.parse(String(payload))).toEqual({ t: 'scan' });
        expect([port, host]).toEqual([7000, '10.0.0.255']);
        expect(devices).toEqual([
            expect.objectContaining({
                mac: 'aa:01',
                name: 'living',
                address: '10.0.0.11',
                version: 'V1.1.13',
            }),
            expect.objectContaining({
                mac: 'bb02',
                name: 'bedroom',
                address: '10.0.0.12',
                version: 'V1.1.13',
            }),
        ]);
        expect(devices[0].pack.brand).toBe('gree');
    });

    it('resolves with no devices when nobody answers', async () => {
        const discovered = Client.discover({ timeout: 500 });
        await jest.advanceTimersByTimeAsync(500);

        await expect(discovered).resolves.toEqual([]);
    });

    it('rejects when the scan cannot be sent', async () => {
        socket.send.mockImplementation((buff, start, length, port, host, cb) =>
            cb(new Error('ENETUNREACH'))
        );

        await expect(Client.discover()).rejects.toBeInstanceOf(
            ClientSocketSendError
        );
    });
});
