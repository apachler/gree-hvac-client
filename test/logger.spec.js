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

    it('produces a usable real winston logger', () => {
        const logger = createLogger('error');
        expect(typeof logger.error).toBe('function');
        expect(() =>
            logger.child({ service: 'test' }).error('ok')
        ).not.toThrow();
    });
});
