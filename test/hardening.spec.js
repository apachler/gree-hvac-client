const dgram = require('dgram');

const { Client } = require('../src/client');
const { EcbCipher } = require('../src/encryption-service');
const {
    ClientInvalidPropertyError,
    ClientNotConnectedError,
} = require('../src/errors');
const { PropertyTransformer } = require('../src/property-transformer');
const { redact } = require('../src/logger');
const device = require('./support/device');
const { fixtures } = require('./support/fixtures');
const { createSocketMock } = require('./support/socket-mock');

jest.mock('dgram');
jest.useFakeTimers();

const UNIT = { address: '10.0.0.5', port: 7000 };

/**
 * Values are checked before they are sent, keys never reach a log, a bound
 * client listens to its unit only, and commands are spaced out.
 */
describe('Hardening', () => {
    describe('value validation', () => {
        const SUT = new PropertyTransformer();
        const rejects = (properties, state) => {
            let error;
            try {
                SUT.toVendor(properties, state);
            } catch (caught) {
                error = caught;
            }
            expect(error).toBeInstanceOf(ClientInvalidPropertyError);
            return error;
        };

        it('refuses values a property does not have', () => {
            const error = rejects({ fanSpeed: 'max' });
            expect(error.message).toBe(
                'Invalid value "max" for fanSpeed, expected one of auto, low, mediumLow, medium, mediumHigh, high'
            );
            expect(error.props).toEqual({ property: 'fanSpeed', value: 'max' });
            rejects({ power: true });
            rejects({ mode: { auto: 1 } });
            rejects({ mode: 7 });
        });

        it('takes the raw vendor numbers of a property', () => {
            expect(SUT.toVendor({ fanSpeed: 3, power: 0 })).toEqual({
                WdSpd: 3,
                Pow: 0,
            });
        });

        it('refuses setpoints no unit takes', () => {
            rejects({ temperature: 99 });
            rejects({ temperature: 5 });
            rejects({ temperature: 23.5 });
            rejects({ temperature: 120 }, { TemUn: 1 });
            rejects({ temperature: NaN });
            rejects({ temperature: 'warm' });
            expect(SUT.toVendor({ temperature: 30 })).toEqual({ SetTem: 30 });
            expect(SUT.toVendor({ temperature: 86 }, { TemUn: 1 })).toEqual({
                SetTem: 30,
                TemRec: 0,
                TemUn: 1,
            });
        });

        it('takes half degrees only with the halfDegree option', () => {
            const half = new PropertyTransformer({ halfDegree: true });
            expect(half.toVendor({ temperature: 23.5 })).toEqual({
                SetTem: 23,
                'Add0.5': 1,
            });
            expect(() => half.toVendor({ temperature: 23.25 })).toThrow(
                ClientInvalidPropertyError
            );
        });

        it('refuses a target humidity outside 0–100 %', () => {
            rejects({ targetHumidity: 101 });
            rejects({ targetHumidity: 50.5 });
            expect(SUT.toVendor({ targetHumidity: 45 })).toEqual({ Dwet: 45 });
        });

        it('turns numeric strings into numbers', () => {
            expect(SUT.toVendor({ temperature: '24' })).toEqual({ SetTem: 24 });
            rejects({ temperature: '' });
        });

        it('reports unknown and read-only properties the same way', () => {
            expect(rejects({ powr: 'on' }).message).toBe(
                'Unknown property powr'
            );
            expect(rejects({ currentTemperature: 20 }).message).toBe(
                'Cannot set read-only property currentTemperature'
            );
        });
    });

    describe('log redaction', () => {
        it('replaces keys and passwords at any depth', () => {
            const circular = { key: 'k' };
            circular.self = circular;

            expect(
                redact({
                    key: 'a3K8Bx%2r8Y7#xDh',
                    payload: { t: 'bindok', key: 'device-key' },
                    list: [{ psw: 'wifi' }, 1],
                    circular,
                    error: new Error('kept'),
                })
            ).toEqual({
                key: '[redacted]',
                payload: { t: 'bindok', key: '[redacted]' },
                list: [{ psw: '[redacted]' }, 1],
                circular: { key: '[redacted]', self: '[Circular]' },
                error: new Error('kept'),
            });
        });

        it('keeps keys out of real log output', () => {
            jest.isolateModules(() => {
                const env = process.env.NODE_ENV;
                process.env.NODE_ENV = 'production';
                const out = [];
                const spies = [
                    jest
                        .spyOn(process.stdout, 'write')
                        .mockImplementation(chunk => out.push(chunk)),
                    jest
                        .spyOn(console, 'log')
                        .mockImplementation((...args) =>
                            out.push(args.join(' '))
                        ),
                ];
                try {
                    const { createLogger } = require('../src/logger');
                    createLogger('debug')
                        .child({ service: 'test', sid: 'abcdefgh' })
                        .debug('Decrypt', {
                            output: { payload: { key: 'SuperSecretKey12' } },
                        });
                    const text = out.join('');
                    expect(text).toMatch(/Decrypt/);
                    expect(text).toMatch(/\[redacted\]/);
                    expect(text).not.toMatch(/SuperSecretKey12/);
                } finally {
                    process.env.NODE_ENV = env;
                    spies.forEach(spy => spy.mockRestore());
                }
            });
        });
    });

    describe('client', () => {
        let SUT;
        let ecb;
        let feedClient;
        let sent;

        const commands = () =>
            sent
                .filter(msg => msg.t === 'pack' && msg.i === 0)
                .map(msg => ecb.decrypt(msg).payload)
                .filter(pack => pack.t === 'cmd');
        const feed = (pack, rinfo = UNIT) =>
            feedClient(
                JSON.stringify({
                    ...fixtures.pack(pack),
                    pack: ecb.encrypt(pack).payload,
                }),
                rinfo
            );

        const connect = async (options = {}) => {
            SUT = new Client({ autoConnect: false, poll: false, ...options });
            SUT.on('error', () => {});
            SUT.connect().catch(() => {});
            feedClient(device.scan(ecb).payload, UNIT);
            await jest.advanceTimersByTimeAsync(0);
            feedClient(device.bind(ecb).payload, UNIT);
            await jest.advanceTimersByTimeAsync(0);
        };

        beforeEach(() => {
            ecb = new EcbCipher();
            sent = [];
            dgram.createSocket.mockReturnValue(
                createSocketMock({
                    on: (event, cb) => event === 'message' && (feedClient = cb),
                    send: (buff, start, length, port, host, cb) => {
                        sent.push(JSON.parse(String(buff)));
                        cb();
                    },
                })
            );
        });

        afterEach(async () => {
            await SUT.disconnect().catch(() => {});
            jest.restoreAllMocks();
        });

        it('rejects an invalid value without sending anything', async () => {
            await connect();

            await expect(
                SUT.setProperty('fanSpeed', 'max')
            ).rejects.toBeInstanceOf(ClientInvalidPropertyError);
            expect(commands()).toEqual([]);
        });

        it('ignores messages from other hosts once bound', async () => {
            await connect();
            const updates = [];
            SUT.on('update', updated => updates.push(updated));

            feed(
                { t: 'dat', cols: ['Pow'], dat: [1] },
                { address: '10.0.0.66' }
            );
            feed({ t: 'dat', cols: ['Lig'], dat: [0] });

            expect(updates).toEqual([{ lights: 'off' }]);
        });

        it('keeps commandInterval between commands', async () => {
            await connect({ commandInterval: 100 });

            const first = SUT.setProperty('power', 'on');
            const second = SUT.setProperty('power', 'off');
            await first;
            expect(commands()).toHaveLength(1);

            await jest.advanceTimersByTimeAsync(99);
            expect(commands()).toHaveLength(1);
            await jest.advanceTimersByTimeAsync(1);
            await second;
            expect(commands().map(cmd => cmd.p)).toEqual([[1], [0]]);
        });

        it('sends at once with commandInterval 0', async () => {
            await connect({ commandInterval: 0 });

            await Promise.all([
                SUT.setProperty('power', 'on'),
                SUT.setProperty('power', 'off'),
            ]);

            expect(commands()).toHaveLength(2);
        });

        it('rejects queued commands on disconnect', async () => {
            await connect({ commandInterval: 100 });
            await SUT.setProperty('power', 'on');
            const queued = SUT.setProperty('power', 'off');
            const assertion = expect(queued).rejects.toBeInstanceOf(
                ClientNotConnectedError
            );

            await SUT.disconnect();

            await assertion;
            expect(SUT._commandTimerRef).toBeNull();
            expect(commands()).toHaveLength(1);
        });
    });
});
