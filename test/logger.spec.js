const { createLogger, guardLogger } = require('../src/logger');

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
