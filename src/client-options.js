'use strict';

/**
 * Client options
 *
 * @type {object}
 * @readonly
 * @property {string} host=192.168.1.255 - GREE device ip-address
 * @property {number} port=7000 - GREE device UDP port
 * @property {string|null} mac=null - Only bind to the device with this MAC-address (`cid`), with or without colons. Recommended when `host` is a broadcast address: the device is then rediscovered by its MAC on every reconnect, so a DHCP address change is followed automatically.
 * @property {number} connectTimeout=3000 - Reconnect to device if no success timeout
 * @property {number} reconnectMaxDelay=30000 - Upper bound for the reconnect back-off: each consecutive failed attempt doubles the wait (starting at `connectTimeout`) up to this value. Set it to `connectTimeout` to retry at a fixed rate.
 * @property {number} bindTimeout=1000 - Wait for a bind confirmation before retrying the bind with the other cipher (AES-GCM)
 * @property {boolean} autoConnect=true - Automatically connect to device when client is created. Alternatively method `connect()` can be used.
 * @property {boolean} poll=true - Poll device properties
 * @property {number} pollingInterval=3000 - Device properties polling interval
 * @property {number} pollingTimeout=1000 - Device properties polling timeout, emits `no_response` events in case of no response from HVAC device for a status request
 * @property {number} maxNoResponse=3 - Re-scan and re-bind the device after this many consecutive `no_response` events (the device may have dropped off WiFi, been re-paired with a new key or moved to another address). `0` disables it.
 * @property {string} logLevel=error - Logging level (debug, info, warn, error)
 * @property {boolean} debug=false - Override logLevel to debug, deprecated, use logLevel option
 */
const CLIENT_OPTIONS = {
    host: '192.168.1.255',
    port: 7000,
    mac: null,
    connectTimeout: 3000,
    reconnectMaxDelay: 30000,
    bindTimeout: 1000,
    autoConnect: true,
    poll: true,
    pollingInterval: 3000,
    pollingTimeout: 1000,
    maxNoResponse: 3,
    logLevel: 'error',
    debug: false,
};

/**
 * Environment variables mapped to the option they override
 *
 * @private
 */
const ENV_OPTIONS = {
    host: 'GREE_HVAC_HOST',
    port: 'GREE_HVAC_PORT',
    mac: 'GREE_HVAC_MAC',
    connectTimeout: 'GREE_HVAC_CONNECT_TIMEOUT',
    reconnectMaxDelay: 'GREE_HVAC_RECONNECT_MAX_DELAY',
    bindTimeout: 'GREE_HVAC_BIND_TIMEOUT',
    autoConnect: 'GREE_HVAC_AUTO_CONNECT',
    poll: 'GREE_HVAC_POLL',
    pollingInterval: 'GREE_HVAC_POLLING_INTERVAL',
    pollingTimeout: 'GREE_HVAC_POLLING_TIMEOUT',
    maxNoResponse: 'GREE_HVAC_MAX_NO_RESPONSE',
    logLevel: 'GREE_HVAC_LOG_LEVEL',
    debug: 'GREE_HVAC_DEBUG',
};

/**
 * Environment variables are always strings; convert them to the type of the
 * option's default so e.g. `GREE_HVAC_POLL=false` really disables polling
 * (the string 'false' is truthy).
 *
 * @param {string} name option name
 * @param {string} value raw environment value
 * @returns {string|number|boolean}
 * @private
 */
const fromEnv = (name, value) => {
    switch (typeof CLIENT_OPTIONS[name]) {
        case 'boolean':
            return !['false', '0', 'no', 'off', ''].includes(
                value.trim().toLowerCase()
            );
        case 'number': {
            const number = Number(value);
            return Number.isNaN(number) ? CLIENT_OPTIONS[name] : number;
        }
        default:
            return value;
    }
};

/**
 * Build effective options
 *
 * @param {CLIENT_OPTIONS} options
 * @returns {CLIENT_OPTIONS}
 * @private
 */
const createOptions = options => {
    const envOptions = {};
    for (const [name, variable] of Object.entries(ENV_OPTIONS)) {
        if (process.env[variable] !== undefined) {
            envOptions[name] = fromEnv(name, process.env[variable]);
        }
    }

    return {
        ...CLIENT_OPTIONS,
        ...envOptions,
        ...options,
    };
};

module.exports = {
    CLIENT_OPTIONS,
    createOptions,
};
