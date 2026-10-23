const { createLogger, guardLogger, formats } = require('../src/logger');

const MESSAGE = Symbol.for('message');

describe('logger guard (upstream #28)', () => {
    it('swallows a throw from a log level method instead of propagating', () => {
        const fake = {
            error: () => {
                throw new RangeError('Maximum call stack size exceeded');
            },
            child() {
                return fake;
            },
        };

        const guarded = guardLogger(fake);

        expect(() => guarded.error('boom')).not.toThrow();
    });

    it('guards loggers created via child() too', () => {
        const fake = {
            error: () => {
                throw new RangeError('Maximum call stack size exceeded');
            },
            child() {
                return {
                    error: () => {
                        throw new RangeError(
                            'Maximum call stack size exceeded'
                        );
                    },
                    child() {
                        return this;
                    },
                };
            },
        };

        const guarded = guardLogger(fake);

        expect(() =>
            guarded.child({ service: 'x' }).error('boom')
        ).not.toThrow();
    });

    it('still logs normally when nothing throws', () => {
        const calls = [];
        const fake = {
            info: (...args) => calls.push(args),
            child() {
                return fake;
            },
        };

        guardLogger(fake).info('hello', { a: 1 });

        expect(calls).toEqual([['hello', { a: 1 }]]);
    });

    it('preserves dynamic `this` so winston-style children keep their metadata', () => {
        // Winston creates children via Object.create(parent) overriding only
        // `write` to inject the child metadata; level methods are inherited
        // and must dispatch through `this.write`. A guard that hard-binds
        // level methods to the parent bypasses the child's `write`, drops the
        // metadata (service/sid), makes the console format throw on every
        // line — and then swallows the throw, silencing all client logging.
        const written = [];
        const parent = {
            error(message) {
                return this.write({ message });
            },
            write(info) {
                written.push(info);
                return this;
            },
            child(meta) {
                const base = this;
                return Object.create(base, {
                    write: {
                        value(info) {
                            return base.write({ ...meta, ...info });
                        },
                    },
                });
            },
        };

        const guarded = guardLogger(parent);
        guarded.child({ service: 'client' }).error('boom');

        expect(written).toEqual([{ service: 'client', message: 'boom' }]);
    });

    it('produces a usable real winston logger', () => {
        const logger = createLogger('error');
        expect(typeof logger.error).toBe('function');
        expect(() =>
            logger.child({ service: 'test' }).error('ok')
        ).not.toThrow();
    });
});

describe('log line format', () => {
    const info = metadata => ({
        timestamp: '2026-10-23T18:47:48.766Z',
        ms: '+0ms',
        level: 'warn',
        service: 'client',
        sid: 'cfbbe12a-0000-4000-8000-000000000000',
        version: '4.3.0',
        message: 'Status request timeout',
        metadata,
    });

    it('prints time, level, service, version and session id', () => {
        expect(formats.print.transform(info({}))[MESSAGE]).toBe(
            '[2026-10-23T18:47:48.766Z +0ms] warn CLIENT:4.3.0/cfbbe12a> Status request timeout'
        );
    });

    it('appends the metadata', () => {
        const line = formats.print.transform(info({ timeout: 1000 }))[MESSAGE];
        expect(line).toMatch(/Status request timeout \n/);
        expect(line).toMatch(/timeout/);
        expect(line).toMatch(/1000/);
    });

    it('logs through the console transport outside of tests', () => {
        jest.isolateModules(() => {
            const env = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            const write = jest
                .spyOn(process.stderr, 'write')
                .mockImplementation(() => true);
            const consoleError = jest
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            try {
                const { createLogger: create } = require('../src/logger');
                create('error')
                    .child({ service: 'test', sid: 'abcdefgh' })
                    .error('visible', { a: 1 });
                const output = [
                    ...write.mock.calls,
                    ...consoleError.mock.calls,
                ].join('');
                expect(output).toMatch(/TEST:.*abcdefgh> visible/);
            } finally {
                process.env.NODE_ENV = env;
                write.mockRestore();
                consoleError.mockRestore();
            }
        });
    });

    it("prints the same line format when the app's NODE_ENV is development", () => {
        jest.isolateModules(() => {
            const env = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';
            const write = jest
                .spyOn(process.stdout, 'write')
                .mockImplementation(() => true);
            const consoleLog = jest
                .spyOn(console, 'log')
                .mockImplementation(() => {});
            try {
                const { createLogger: create } = require('../src/logger');
                create('info')
                    .child({ service: 'test', sid: 'abcdefgh' })
                    .info('one line');
                const output = [
                    ...write.mock.calls,
                    ...consoleLog.mock.calls,
                ].join('');
                expect(output).toMatch(/TEST:.*abcdefgh> one line/);
            } finally {
                process.env.NODE_ENV = env;
                write.mockRestore();
                consoleLog.mockRestore();
            }
        });
    });
});
