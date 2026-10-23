const dgram = require('dgram');

const { Client } = require('../src/client');
const { ClientSocketSendError } = require('../src/errors');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

/**
 * Client.configureWifi() sends the unencrypted `wlan` packet to a unit in AP
 * mode and waits for its `ret` confirmation.
 */
describe('Client.configureWifi()', () => {
    let feed;
    let socket;

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

    it('sends the credentials to the unit in AP mode', async () => {
        const result = Client.configureWifi({ ssid: 'home', password: 'pw' });

        const [payload, , , port, host] = socket.send.mock.calls[0];
        expect(JSON.parse(String(payload))).toEqual({
            psw: 'pw',
            ssid: 'home',
            t: 'wlan',
        });
        expect([port, host]).toEqual([7000, '192.168.1.1']);

        feed(JSON.stringify({ t: 'ret', r: 200, mac: 'f4911e000001' }));

        await expect(result).resolves.toEqual({
            confirmed: true,
            mac: 'f4911e000001',
        });
    });

    it('resolves unconfirmed when the unit does not answer', async () => {
        const result = Client.configureWifi({
            ssid: 'home',
            password: 'pw',
            host: '192.168.4.1',
            timeout: 1000,
        });
        expect(socket.send.mock.calls[0][4]).toBe('192.168.4.1');

        feed('not json');
        await jest.advanceTimersByTimeAsync(1000);

        await expect(result).resolves.toEqual({ confirmed: false });
    });

    it('rejects without credentials', async () => {
        await expect(Client.configureWifi({ ssid: 'home' })).rejects.toThrow(
            TypeError
        );
    });

    it('rejects when the packet cannot be sent', async () => {
        socket.send.mockImplementation((buff, start, length, port, host, cb) =>
            cb(new Error('ENETUNREACH'))
        );

        await expect(
            Client.configureWifi({ ssid: 'home', password: 'pw' })
        ).rejects.toBeInstanceOf(ClientSocketSendError);
    });
});
