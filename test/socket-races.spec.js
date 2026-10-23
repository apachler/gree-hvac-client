const dgram = require('dgram');

const { Client } = require('../src/client');
const { ClientSocketError } = require('../src/errors');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

// discover() and configureWifi() open their own socket; a socket error may
// arrive before the bind completes, twice, or close the socket itself.
describe.each([
    ['discover', options => Client.discover(options)],
    [
        'configureWifi',
        options =>
            Client.configureWifi({ ssid: 'home', password: 'pw', ...options }),
    ],
])('Client.%s() socket races', (name, run) => {
    let listeners;
    let bindCallback;
    let socket;

    beforeEach(() => {
        listeners = {};
        socket = createSocketMock({
            on: jest.fn((event, cb) => (listeners[event] = cb)),
            bind: jest.fn(cb => (bindCallback = cb)),
            send: jest.fn((buff, start, length, port, host, cb) => cb()),
        });
        dgram.createSocket.mockReturnValue(socket);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('rejects on a socket error before the bind, and sends nothing', async () => {
        const result = run({ timeout: 100 });

        listeners.error(new Error('EADDRINUSE'));
        listeners.error(new Error('again'));
        bindCallback();

        await expect(result).rejects.toBeInstanceOf(ClientSocketError);
        expect(socket.send).not.toHaveBeenCalled();
    });

    it('settles when the socket is already closed', async () => {
        socket.close = () => {
            throw new Error('Not running');
        };
        const result = run({ timeout: 100 });
        bindCallback();

        await jest.advanceTimersByTimeAsync(100);

        await expect(result).resolves.toBeDefined();
    });
});

describe('Client.configureWifi() password length', () => {
    it('warns about passwords longer than 31 characters, and sends them', async () => {
        const socket = createSocketMock({
            send: jest.fn((buff, start, length, port, host, cb) => cb()),
        });
        dgram.createSocket.mockReturnValue(socket);

        const result = Client.configureWifi({
            ssid: 'home',
            password: 'x'.repeat(40),
            timeout: 100,
        });
        await jest.advanceTimersByTimeAsync(100);

        await expect(result).resolves.toEqual({ confirmed: false });
        expect(
            JSON.parse(String(socket.send.mock.calls[0][0])).psw
        ).toHaveLength(40);
    });
});
