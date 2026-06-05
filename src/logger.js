const winston = require('winston');
const util = require('util');

const { version } = require('../package.json');

const formats = {
    print: winston.format.printf(info => {
        const time = `[${info.timestamp} ${info.ms}]`;
        const service = info.service.toUpperCase();
        const sid = info.sid.substr(0, 8);
        const line = `${time} ${info.level} ${service}:${info.version}/${sid}>`;

        if (Object.keys(info.metadata).length > 0) {
            const meta = util.inspect(info.metadata, {
                colors: true,
                compact: 1,
                depth: 5,
            });

            return `${line} ${info.message} \n${meta}`;
        }

        return `${line} ${info.message}`;
    }),
    vscode: winston.format.printf(info =>
        Object.fromEntries(Object.entries(info))
    ),
};

const env = process.env.NODE_ENV;
const isDevelopment = env === 'development';
const isTest = env === 'test';

const LOG_LEVELS = [
    'error',
    'warn',
    'info',
    'http',
    'verbose',
    'debug',
    'silly',
];

/**
 * Wrap a winston logger so a failure inside the logging pipeline can never crash
 * the client.
 *
 * In some host environments the console/winston write path can recurse and blow
 * the stack — most notably when Sentry/raven monkey-patches `console`, so a
 * single `logger.error(...)` re-enters logging until it throws `RangeError:
 * Maximum call stack size exceeded`. Because the client logs from inside its UDP
 * message handler, such a throw would otherwise take down the whole process.
 * Swallowing it loses one diagnostic line instead. Children created via
 * `.child()` are wrapped too, so service/cid sub-loggers are equally protected.
 *
 * Addresses upstream issue #28
 * (https://github.com/inwaar/gree-hvac-client/issues/28).
 *
 * @param {object} logger A winston logger
 * @returns {object} The same logger, with guarded log methods
 * @private
 */
const guardLogger = logger => {
    for (const level of LOG_LEVELS) {
        if (typeof logger[level] !== 'function') {
            continue;
        }
        const original = logger[level].bind(logger);
        logger[level] = (...args) => {
            try {
                return original(...args);
            } catch {
                // A logger that throws while logging is unrecoverable; drop the
                // line rather than propagate the failure into client control flow.
                return logger;
            }
        };
    }

    if (typeof logger.child === 'function') {
        const child = logger.child.bind(logger);
        logger.child = (...args) => guardLogger(child(...args));
    }

    return logger;
};

const createLogger = level =>
    guardLogger(
        winston.createLogger({
            level,
            defaultMeta: { version, pid: process.pid },
            silent: isTest,
            transports: [
                new winston.transports.Console({
                    forceConsole: true,
                    stderrLevels: ['error'],
                    consoleWarnLevels: ['warn'],
                    format: winston.format.combine(
                        winston.format.timestamp(),
                        winston.format.ms(),
                        winston.format.metadata({
                            fillExcept: [
                                'timestamp',
                                'ms',
                                'level',
                                'message',
                                'service',
                                'sid',
                                'cid',
                                'pid',
                                'version',
                            ],
                        }),
                        ...(isDevelopment
                            ? [formats.vscode]
                            : [winston.format.colorize(), formats.print])
                    ),
                }),
            ],
        })
    );

module.exports = {
    createLogger,
    guardLogger,
};
