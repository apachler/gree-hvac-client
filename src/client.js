'use strict';

const dgram = require('dgram');
const EventEmitter = require('events');
const clone = require('clone');

const { EncryptionService } = require('./encryption-service');
const { PROPERTY } = require('./property');
const { PROPERTY_VALUE } = require('./property-value');
const { CLIENT_OPTIONS, createOptions } = require('./client-options');
const {
    PropertyTransformer,
    OPTIONAL_VENDOR_CODES,
} = require('./property-transformer');
const {
    // Imported only for the {ClientError} type in the Client#error JSDoc below.
    // ESLint 9's eslint-plugin-jsdoc no longer marks JSDoc-referenced imports
    // as used, and jsdoc-to-markdown can't parse an inline import('...') type,
    // so this narrow disable keeps both the generated docs and lint happy.
    // eslint-disable-next-line no-unused-vars
    ClientError,
    ClientMessageParseError,
    ClientMessageUnpackError,
    ClientSocketError,
    ClientSocketSendError,
    ClientUnknownMessageError,
    ClientNotConnectedError,
    ClientConnectTimeoutError,
    ClientCancelConnectError,
    ClientNoResponseError,
} = require('./errors');
const { createLogger } = require('./logger');
const { randomUUID } = require('crypto');

/**
 * How long Client.discover() waits for scan answers by default (ms)
 *
 * @private
 */
const DISCOVERY_TIMEOUT = 3000;

/**
 * How long getSubUnits() waits for the answer to each subList request (ms)
 *
 * @private
 */
const SUB_LIST_TIMEOUT = 2000;

/**
 * Control GREE HVAC device by getting and setting its properties
 *
 * @augments EventEmitter
 */
class Client extends EventEmitter {
    /**
     * @typedef {Object<PROPERTY, PROPERTY_VALUE | number>} PropertyMap
     */

    /**
     * A device that answered a discovery scan
     *
     * @typedef {object} DiscoveredDevice
     * @property {string} mac Device MAC-address (`cid`), usable as the `mac` client option
     * @property {string} name Device name as configured in the vendor app
     * @property {string} address IP-address the device answered from, usable as the `host` client option
     * @property {string} [version] Firmware version, e.g. `V1.1.13`
     * @property {number} subUnits Number of indoor units behind it when it is the WiFi module of a multi-split outdoor unit, else `0` (list them with `getSubUnits()`)
     * @property {object} pack The full decrypted scan answer (brand, model, ...)
     */

    /**
     * An indoor unit of a multi-split system, as listed by the outdoor unit
     *
     * @typedef {object} SubUnit
     * @property {string} mac Indoor unit MAC-address, usable as the `subUnit` client option
     * @property {string} [mid] Model id, when the outdoor unit reports one
     */

    /**
     * Emitted when successfully connected to the HVAC, and again after every
     * automatic re-bind (see the `maxNoResponse` option)
     *
     * @event Client#connect
     */

    /**
     * Emitted when the HVAC did not answer a status request within
     * `pollingTimeout`
     *
     * @param {Client} client
     * @event Client#no_response
     */

    /**
     * Emitted when properties successfully updated after calling setProperties or setProperty
     *
     * @param {PropertyMap} updated The properties and their values that were updated
     * @param {PropertyMap} properties All the properties and their values managed by the Client
     * @event Client#success
     */

    /**
     * Emitted when properties successfully updated from HVAC (e.g. by a remote control)
     *
     * @param {PropertyMap} updated The properties and their values that were updated
     * @param {PropertyMap} properties All the properties and their values managed by the Client
     * @event Client#update
     */

    /**
     * Emitted when an error happens
     *
     * It is important to subscribe to the `error` event, otherwise the process will be terminated
     *
     * @param {ClientError} error
     * @event Client#error
     */

    /**
     * Emitted when disconnected from the HVAC
     *
     * @event Client#disconnect
     */

    /**
     * Creates a new client, connect to device and start polling by default.
     *
     * @param {CLIENT_OPTIONS | {}} options
     * @fires Client#connect
     * @fires Client#update
     * @fires Client#error
     * @fires Client#disconnect
     * @example
     * const Gree = require('gree-hvac-client');
     *
     * const client = new Gree.Client({host: '192.168.1.69'});
     * client.on('connect', () => {
     *     client.setProperty(Gree.PROPERTY.lights, Gree.VALUE.lights.off);
     *     client.setProperty(Gree.PROPERTY.temperature, 25);
     * });
     */
    constructor(options = {}) {
        super();

        /**
         * Device MAC-address
         *
         * @type {string|null}
         * @private
         */
        this._cid = null;

        /**
         * Address the device answered the scan from; bind and status requests
         * go there, so a broadcast `host` only carries the scan
         *
         * @type {string|null}
         * @private
         */
        this._deviceAddress = null;

        /**
         * A device answered the scan of the current connect attempt
         *
         * @type {boolean}
         * @private
         */
        this._handshaken = false;

        /**
         * The current connect attempt got its binding confirmation
         *
         * @type {boolean}
         * @private
         */
        this._bound = false;

        /**
         * Consecutive status requests without a response
         *
         * @type {number}
         * @private
         */
        this._noResponseCount = 0;

        /**
         * Optional vendor codes (see OPTIONAL_VENDOR_CODES) the bound device
         * answered a probe for; only these are polled
         *
         * @type {Set<string>}
         * @private
         */
        this._supportedOptionalCodes = new Set();

        /**
         * getProperties() calls waiting for the next status response
         *
         * @type {Array<{resolve: Function, reject: Function}>}
         * @private
         */
        this._statusWaiters = [];

        /**
         * The subList request awaiting its answer (see _requestSubList)
         *
         * @type {{resolve: Function, timer: number}|null}
         * @private
         */
        this._subListRequest = null;

        /**
         * @type {dgram.Socket|null}
         * @private
         */
        this._socket = null;

        /**
         * @type {number}
         * @private
         */
        this._reconnectAttempt = 1;

        /**
         * Socket connection timeout reference
         *
         * @type {number|null}
         * @private
         */
        this._socketTimeoutRef = null;

        /**
         * Bind response timeout reference
         *
         * @type {number|null}
         * @private
         */
        this._bindTimeoutRef = null;

        /**
         * Status polling interval reference
         *
         * @type {number|null}
         * @private
         */
        this._statusIntervalRef = null;

        /**
         * Status polling timeout reference
         *
         * @type {number|null}
         * @private
         */
        this._statusTimeoutRef = null;

        /**
         * Device properties, are updated by polling the devices
         *
         * @type {PropertyMap}
         * @private
         */
        this._properties = {};
        /**
         * @type {PropertyTransformer}
         * @private
         */
        this._transformer = new PropertyTransformer();

        /**
         * Client options
         *
         * @type {CLIENT_OPTIONS}
         * @private
         */
        this._options = createOptions(options);

        /**
         * @private
         */
        this._logger;
        this.setDebug(this._options.debug);

        /**
         * @type {EncryptionService}
         * @private
         */
        this._encryptionService = new EncryptionService(this._logger);

        this._logger.info('Init', { options: this._options });

        if (this._options.autoConnect) {
            process.nextTick(() => {
                this._logger.info('Auto-connect');
                this.connect().catch(error => this.emit('error', error));
            });
        }
    }

    /**
     * Find GREE devices on the network: broadcast a scan and collect every
     * device that answers within `timeout`. Opens its own socket, so no client
     * (and no binding) is needed.
     *
     * @param {object} [options]
     * @param {string} [options.host] Address to send the scan to — your network's broadcast address. Defaults to the `host` client option.
     * @param {number} [options.port] Defaults to the `port` client option
     * @param {number} [options.timeout] How long to wait for answers (ms), 3000 by default
     * @param {string} [options.logLevel] Defaults to the `logLevel` client option
     * @returns {Promise<DiscoveredDevice[]>} one entry per device, in order of answer
     * @example
     * const devices = await Gree.Client.discover({host: '192.168.1.255'});
     * // [{mac: 'f4911e000001', name: '1e000001', address: '192.168.1.42', version: 'V1.1.13', pack: {...}}]
     *
     * const client = new Gree.Client({host: devices[0].address});
     */
    static discover(options = {}) {
        const { host, port, logLevel } = createOptions(options);
        const timeout = options.timeout ?? DISCOVERY_TIMEOUT;
        const logger = createLogger(logLevel).child({ service: 'discovery' });
        const encryptionService = new EncryptionService(logger);
        const devices = new Map();

        return new Promise((resolve, reject) => {
            const socket = dgram.createSocket('udp4');
            let timer = null;
            let done = false;

            const finish = error => {
                if (done) {
                    return;
                }
                done = true;
                clearTimeout(timer);
                logger.info('Discovery done', { devices: devices.size });
                try {
                    socket.close(() =>
                        error ? reject(error) : resolve([...devices.values()])
                    );
                } catch {
                    // already closed by a socket error
                    error ? reject(error) : resolve([...devices.values()]);
                }
            };

            socket.on('error', error => finish(new ClientSocketError(error)));
            socket.on('message', (buffer, rinfo) => {
                let message = null;
                let pack = null;
                try {
                    message = JSON.parse(String(buffer));
                    pack = encryptionService.decryptGeneric(message);
                } catch {
                    // not JSON: not a device answer
                }
                if (!pack || pack.t !== 'dev') {
                    logger.debug('Not a scan answer, ignoring', {
                        address: rinfo.address,
                    });
                    return;
                }

                // Some firmwares leave cid/mac of the scan answer empty; the
                // enclosing message still carries it (see
                // _handleHandshakeResponse).
                const mac = pack.cid || pack.mac || message.cid || '';
                const key = normalizeMac(mac) || rinfo.address;
                if (devices.has(key)) {
                    return;
                }
                logger.info('Device found', { mac, address: rinfo.address });
                devices.set(key, {
                    mac,
                    name: pack.name,
                    address: rinfo.address,
                    version: pack.ver,
                    subUnits: Number(pack.subCnt) || 0,
                    pack,
                });
            });

            socket.bind(() => {
                if (done) {
                    return;
                }
                socket.setBroadcast(true);
                const scan = Buffer.from(JSON.stringify({ t: 'scan' }));
                logger.info('Discovery scan', { host, port, timeout });
                socket.send(scan, 0, scan.length, port, host, error => {
                    if (error) {
                        finish(new ClientSocketSendError(error));
                    }
                });
                timer = setTimeout(() => finish(), timeout);
            });
        });
    }

    /**
     * Connect to a HVAC device and start polling status changes by default
     *
     * @returns {Promise}
     * @fires Client#connect
     * @fires Client#error
     */
    connect() {
        this._logger.info('Connecting');

        return new Promise((resolve, reject) => {
            this.once('connect', resolve);
            this.once('disconnect', () => {
                process.nextTick(() => reject(new ClientCancelConnectError()));
            });

            this._socket = dgram.createSocket('udp4');
            // Without a listener a socket 'error' (e.g. a failing bind) is
            // thrown and terminates the process.
            this._socket.on('error', error => {
                this._logger.error('Socket error', error);
                this.emit('error', new ClientSocketError(error));
            });
            this._socket.on('message', (message, rinfo) => {
                this._handleResponse(message, rinfo).catch(error => {
                    this._logger.error('Response handle error', error);
                    this.emit('error', error);
                });
            });

            this._socket.bind(() => {
                if (!this._socket) {
                    // disconnect() raced connect() before the bind completed;
                    // the 'disconnect' handler above already rejects this
                    // promise with ClientCancelConnectError.
                    return;
                }

                this._socket.setBroadcast(true);
                this._initialize().catch(reject);
            });
        });
    }

    /**
     * Initialize connection
     *
     * @private
     */
    async _initialize() {
        this._dispose();

        if (!this._socket) {
            // The client was disconnected before this attempt ran. Going ahead
            // would fail in _socketSend() with ClientNotConnectedError and then
            // arm another attempt from the catch block below, so the client
            // would keep retrying — and emitting — forever after disconnect().
            this._logger.info('Skip initialize, client is disconnected');
            return;
        }

        try {
            this._encryptionService = new EncryptionService(this._logger);
            this._deviceAddress = null;
            this._handshaken = false;
            this._bound = false;
            this._noResponseCount = 0;
            this._supportedOptionalCodes = new Set();

            this._logger.info('Scan start', {
                attempt: this._reconnectAttempt,
            });
            await this._socketSend({ t: 'scan' });

            // disconnect() may have raced the in-flight send: its timers are
            // already cleared, so arming one now would let it outlive the
            // client (mirror of the guard above).
            if (!this._socket) {
                this._logger.info(
                    'Skip reconnect scheduling, client is disconnected'
                );
                return;
            }

            this._scheduleReconnect();
        } catch (err) {
            // Only retry while a socket is still around: disconnect() may have
            // released it while this attempt was in flight.
            if (this._socket) {
                this._scheduleReconnect();
                throw err;
            }

            // disconnect() raced this attempt: 'disconnect' has already been
            // emitted and consumers may have detached their listeners, so
            // rethrowing would surface an 'error' event after 'disconnect'.
            this._logger.info(
                'Discard initialize error, client is disconnected',
                { error: err }
            );
        }
    }

    /**
     * Maintain auto-reconnect: arm (or re-arm) the connect-timeout timer that
     * reports the timed-out attempt and starts the next one.
     *
     * Deliberately fire-and-forget: a promise resolved from the timer callback
     * would never settle once the timer is cleared (superseded or disposed),
     * freezing whatever chain awaits it.
     *
     * @private
     */
    _scheduleReconnect() {
        // Overwriting the reference without clearing it strands the timer
        // it points at: _dispose() and disconnect() can only clear what is
        // still referenced here, so a stranded one keeps firing for the
        // lifetime of the process.
        this._clearTimer('_socketTimeoutRef');

        // Exponential back-off: connectTimeout, 2x, 4x, ... capped at
        // reconnectMaxDelay. Devices rate-limit scan/bind requests, and a unit
        // that is off WiFi for hours needs no scan every few seconds.
        const timeout = Math.min(
            this._options.connectTimeout * 2 ** (this._reconnectAttempt - 1),
            Math.max(
                this._options.reconnectMaxDelay,
                this._options.connectTimeout
            )
        );

        this._socketTimeoutRef = setTimeout(() => {
            this._socketTimeoutRef = null;

            if (!this._socket) {
                this._logger.info('Skip reconnect, client is disconnected');
                return;
            }

            this._logger.warn('Connect timeout, reconnect', { timeout });
            this.emit('error', new ClientConnectTimeoutError());
            this._reconnectAttempt++;

            this._initialize().catch(error => {
                this.emit('error', error);
                this._logger.error('Initialize error', error);
            });
        }, timeout);
    }

    /**
     * Disconnect from a HVAC device and stop status polling
     *
     * @returns {Promise}
     * @fires Client#disconnect
     */
    disconnect() {
        this._logger.info('Disconnecting');

        this._dispose();
        this._rejectStatusWaiters(new ClientNotConnectedError());

        return new Promise((resolve, reject) => {
            if (this._socket) {
                this._socket.close(() => {
                    this._logger.info('Disconnected');
                    this.emit('disconnect');
                    resolve();
                });
                this._socket = null;
            } else {
                reject(new ClientNotConnectedError());
            }
        });
    }

    /**
     * Clear the referenced timer (if armed) and null the reference, so no
     * timer is ever left behind a reference _dispose() cannot see.
     *
     * @param {string} refName property holding the timer reference
     * @param {Function} clear matching clear function, clearTimeout by default
     * @private
     */
    _clearTimer(refName, clear = clearTimeout) {
        if (this[refName]) {
            clear(this[refName]);
            this[refName] = null;
        }
    }

    /**
     * Cancel interval and timeout resources
     *
     * @private
     */
    _dispose() {
        this._clearTimer('_statusIntervalRef', clearInterval);
        this._clearTimer('_socketTimeoutRef');
        this._clearTimer('_statusTimeoutRef');
        this._clearTimer('_bindTimeoutRef');
        this._settleSubList(null);
    }

    /**
     * Set a list of device properties at once by one request
     *
     * @param {PropertyMap} properties
     * @returns {Promise}
     * @fires Client#success
     * @fires Client#error
     * @example
     * // use library constants
     *
     * const properties = {};
     * properties[Gree.PROPERTY.lights] = Gree.VALUE.lights.off;
     * properties[Gree.PROPERTY.blow] = Gree.VALUE.blow.off;
     * properties[Gree.PROPERTY.fanSpeed] = Gree.VALUE.fanSpeed.high;
     * properties[Gree.PROPERTY.temperature] = 25;
     * client.setProperties(properties);
     * @example
     * // use plain objects
     *
     * client.setProperties({
     *  lights: 'off',
     *  blow: 'off',
     *  fanSpeed: 'high',
     *  temperature: 25
     * });
     */
    setProperties(properties) {
        const vendorProperties = this._transformer.toVendor(
            properties,
            this._properties
        );

        if (this._options.silent) {
            // Per-command flags, not device state: older firmwares read
            // Buzzer_ON_OFF (1 = silent), newer ones BuzzerCtrl (0 = silent).
            vendorProperties.Buzzer_ON_OFF = 1;
            vendorProperties.BuzzerCtrl = 0;
        }

        this._logger.info('Update request');
        return this._sendRequest({
            opt: Object.keys(vendorProperties),
            p: Object.values(vendorProperties),
            t: 'cmd',
            // A multi-split gateway relays the command to this indoor unit
            ...(this._options.subUnit && { sub: this._options.subUnit }),
        });
    }

    /**
     * Set device property
     *
     * @param {PROPERTY} property
     * @param {PROPERTY_VALUE} value
     * @returns {Promise}
     * @fires Client#success
     * @fires Client#error
     * @example
     * // use library constants
     *
     * client.setProperty(Gree.PROPERTY.swingHor, Gree.VALUE.swingHor.fixedLeft);
     * client.setProperty(Gree.PROPERTY.temperature, 25);
     * @example
     * // use plain values
     *
     * client.setProperty('swingHor', 'fixedLeft');
     * client.setProperty('temperature', 25);
     */
    async setProperty(property, value) {
        const properties = {};
        properties[property] = value;
        return this.setProperties(properties);
    }

    /**
     * Ask the device for its current properties now, instead of waiting for
     * the next poll
     *
     * @returns {Promise<PropertyMap>} all the properties, once the device answered
     * @throws {ClientNotConnectedError} when not connected (yet), or disconnected before the answer
     * @throws {ClientNoResponseError} when the device did not answer within `pollingTimeout`
     * @example
     * await client.connect();
     * const properties = await client.getProperties();
     * console.log(properties.temperature, properties.currentTemperature);
     */
    getProperties() {
        if (!this._bound || !this._socket) {
            return Promise.reject(new ClientNotConnectedError());
        }

        return new Promise((resolve, reject) => {
            this._statusWaiters.push({ resolve, reject });
            this._requestStatus().catch(error =>
                this._rejectStatusWaiters(error)
            );
        });
    }

    /**
     * List the indoor units of a multi-split system. Connect to the outdoor
     * unit's WiFi module (a device that `discover()` reports with
     * `subUnits` > 0), then pass one of the listed MACs as the `subUnit`
     * option of a client per indoor unit.
     *
     * @param {object} [options]
     * @param {number} [options.timeout] How long to wait for each of the two request forms (ms), 2000 by default
     * @returns {Promise<SubUnit[]>} empty when the device is no multi-split gateway
     * @throws {ClientNotConnectedError} when not connected (yet)
     * @example
     * const gateway = new Gree.Client({host: '192.168.1.42', poll: false});
     * gateway.on('connect', async () => {
     *     const units = await gateway.getSubUnits();
     *     // [{mac: 'c0000001a2b3c4', mid: '...'}, ...]
     *     const bedroom = new Gree.Client({host: '192.168.1.42', subUnit: units[0].mac});
     * });
     */
    async getSubUnits({ timeout = SUB_LIST_TIMEOUT } = {}) {
        // Modules differ in which form they answer: the device-key form, or
        // the classic generic-key form (AES-ECB modules only).
        const forms = this._encryptionService.isGcm()
            ? ['device']
            : ['device', 'generic'];

        for (const form of forms) {
            if (!this._bound || !this._socket) {
                throw new ClientNotConnectedError();
            }
            const list = await this._requestSubList(form, timeout);
            if (list) {
                const units = new Map();
                for (const unit of list) {
                    if (unit && unit.mac && !units.has(String(unit.mac))) {
                        units.set(String(unit.mac), {
                            ...unit,
                            mac: String(unit.mac),
                        });
                    }
                }
                return [...units.values()];
            }
        }

        return [];
    }

    /**
     * Send one form of the subList request and wait for its answer
     *
     * @param {'device'|'generic'} form
     * @param {number} timeout
     * @returns {Promise<object[]|null>} the listed units, or null without an answer
     * @private
     */
    async _requestSubList(form, timeout) {
        // One request at a time: the answer carries no request id.
        this._settleSubList(null);

        const answer = new Promise(resolve => {
            this._subListRequest = {
                resolve,
                timer: setTimeout(() => this._settleSubList(null), timeout),
            };
        });

        this._logger.info('Sub-unit list request', { form });
        try {
            if (form === 'device') {
                await this._sendRequest(
                    { mac: this._cid, t: 'subList', i: 0 },
                    { tcid: this._cid }
                );
            } else {
                const encrypted = this._encryptionService.encryptGeneric({
                    mac: this._cid,
                    i: 1,
                });
                await this._socketSend({
                    cid: 'app',
                    i: 1,
                    t: 'subList',
                    tcid: this._cid,
                    uid: 0,
                    pack: encrypted.payload,
                });
            }
        } catch (error) {
            this._settleSubList(null);
            throw error;
        }

        return answer;
    }

    /**
     * Settle the pending subList request, if any
     *
     * @param {object[]|null} list
     * @private
     */
    _settleSubList(list) {
        const request = this._subListRequest;
        if (request) {
            this._subListRequest = null;
            clearTimeout(request.timer);
            request.resolve(list);
        }
    }

    /**
     * @param {Error} error
     * @private
     */
    _rejectStatusWaiters(error) {
        const waiters = this._statusWaiters;
        this._statusWaiters = [];
        waiters.forEach(waiter => waiter.reject(error));
    }

    /**
     * Returns devices MAC-address
     *
     * @returns {string|null}
     */
    getDeviceId() {
        return this._cid;
    }

    /**
     * Override log level to `debug`
     * Use the client `logLevel` option instead
     *
     * @param enable {Boolean}
     * @deprecated
     */
    setDebug(enable) {
        this._createLogger(enable ? 'debug' : this._options.logLevel);
    }

    /**
     * Create logger
     *
     * @param level {string}
     * @private
     */
    _createLogger(level) {
        /**
         * Logger without the device `cid`, so every handshake derives its
         * child from here instead of nesting one more child per reconnect
         *
         * @private
         */
        this._baseLogger = createLogger(level).child({
            service: 'client',
            sid: randomUUID(),
        });
        this._logger = this._baseLogger;
        this._encryptionService = new EncryptionService(this._logger);
    }

    /**
     * Send binding request to device
     *
     * @param {number} attempt
     * @private
     */
    async _sendBindRequest(attempt) {
        this._logger.info('Binding start', { attempt });

        const encrypted = this._encryptionService.encrypt({
            mac: this._cid,
            t: 'bind',
            uid: 0,
        });

        await this._socketSend({
            cid: 'app',
            i: 1,
            t: 'pack',
            uid: 0,
            pack: encrypted.payload,
            tag: encrypted.tag,
        });
    }

    /**
     * Send a request to device thorough UPD socket
     *
     * @param request
     * @private
     */
    _socketSend(request) {
        return new Promise((resolve, reject) => {
            this._logger.debug('Socket send', { request });
            const toSend = Buffer.from(JSON.stringify(request));

            if (this._socket) {
                this._socket.send(
                    toSend,
                    0,
                    toSend.length,
                    this._options.port,
                    request.t === 'scan'
                        ? this._options.host
                        : this._deviceAddress || this._options.host,
                    error => {
                        if (!error) {
                            resolve();
                        } else {
                            reject(new ClientSocketSendError(error));
                        }
                    }
                );
            } else {
                reject(new ClientNotConnectedError());
            }
        });
    }

    /**
     * Send request to device
     *
     * @param {object} message
     * @param {string[]} message.opt
     * @param {number[]} message.p
     * @param {string} message.t
     * @param {object} [envelope] extra fields of the enclosing message
     * @private
     */
    async _sendRequest(message, envelope = {}) {
        this._logger.debug('Send request', { request: message });

        const encrypted = this._encryptionService.encrypt(message);
        await this._socketSend({
            cid: 'app',
            i: 0,
            t: 'pack',
            uid: 0,
            // A multi-split gateway routes by tcid; the pack names the indoor unit
            ...(this._options.subUnit && { tcid: this._cid }),
            ...envelope,
            pack: encrypted.payload,
            tag: encrypted.tag,
        });
    }

    /**
     * @returns {string|null} MAC a status request names: the indoor unit's
     *     with the `subUnit` option, else the device's
     * @private
     */
    _statusMac() {
        return this._options.subUnit || this._cid;
    }

    /**
     * Send properties status request to device
     *
     * @private
     */
    async _requestStatus() {
        this._logger.info('Status request');

        // Armed before sending, so a request that cannot even be sent (e.g.
        // ENETUNREACH while the network is down) counts as unanswered too.
        this._armStatusTimeout();

        await this._sendRequest({
            cols: this._transformer.statusColumns(this._supportedOptionalCodes),
            mac: this._statusMac(),
            t: 'status',
        });
    }

    /**
     * Ask the device once for each optional vendor code, one per request: a
     * unit without the feature may answer with an empty `dat`, and a code it
     * does answer is added to the polled columns (see _handleStatusResponse).
     *
     * @private
     */
    async _probeOptionalCodes() {
        for (const code of OPTIONAL_VENDOR_CODES) {
            if (!this._socket) {
                return;
            }
            this._logger.debug('Probe optional property', { code });
            await this._sendRequest({
                cols: [code],
                mac: this._statusMac(),
                t: 'status',
            });
        }
    }

    /**
     * Arm the status timeout unless one is already armed
     *
     * @fires Client#no_response
     * @private
     */
    _armStatusTimeout() {
        // Keep at most one status timeout armed. Re-arming on every poll would
        // orphan the previous timer when pollingTimeout >= pollingInterval
        // (spurious no_response despite valid replies, issue #7), while
        // clearing + re-arming would keep pushing the deadline so a dead
        // device never triggers no_response. Instead the timer measures the
        // time since the oldest unanswered request.
        if (this._statusTimeoutRef) {
            return;
        }

        this._statusTimeoutRef = setTimeout(() => {
            this._statusTimeoutRef = null;

            this._logger.warn('Status request timeout', {
                timeout: this._options.pollingTimeout,
            });

            this._properties = {};
            this._noResponseCount++;
            this._rejectStatusWaiters(new ClientNoResponseError());
            this.emit('no_response', this);

            this._rebindIfUnresponsive();
        }, this._options.pollingTimeout);
    }

    /**
     * Start over with scan + bind once the device has missed `maxNoResponse`
     * status requests in a row.
     *
     * Polling alone recovers from a short WiFi drop, but not when the device
     * comes back re-paired with a new key (it silently drops requests
     * encrypted with the old one) or with another DHCP address; both need a
     * fresh scan and bind.
     *
     * @private
     */
    _rebindIfUnresponsive() {
        const max = this._options.maxNoResponse;
        if (!max || this._noResponseCount < max || !this._socket) {
            return;
        }

        this._logger.warn('Device unresponsive, rebind', {
            noResponse: this._noResponseCount,
        });

        this._initialize().catch(error => {
            this.emit('error', error);
            this._logger.error('Initialize error', error);
        });
    }

    /**
     * Handle UDP response from device
     *
     * @param {Buffer} buffer Serialized JSON string with message
     * @param {dgram.RemoteInfo} [rinfo] Sender of the message
     * @fires Client#error
     * @private
     */
    async _handleResponse(buffer, rinfo) {
        const message = this._parse(buffer);

        this._logger.debug('Handle response', { request: message });

        let pack;
        try {
            // Extract encrypted package from message using device key (if available)
            pack = this._unpack(message);
        } catch (error) {
            // A late scan or bind reply arriving after the bind succeeded is
            // encrypted with a generic key: not an error.
            const late = this._bound
                ? this._encryptionService.decryptGeneric(message)
                : null;
            // ...as is the answer to the generic-key subList request
            if (late && Array.isArray(late.list)) {
                this._handleSubListResponse(late);
                return;
            }
            if (late && ['dev', 'bindok'].includes(late.t)) {
                this._logger.debug('Late scan/bind response, ignoring', {
                    t: late.t,
                });
                return;
            }

            throw error;
        }

        // If package type is response to handshake
        if (pack.t === 'dev') {
            await this._handleHandshakeResponse(pack, message, rinfo);
            return;
        }

        if (this._cid) {
            // If package type is binding confirmation
            if (pack.t === 'bindok') {
                await this._handleBindingConfirmationResponse();
                return;
            }

            // If package type is device status
            if (pack.t === 'dat') {
                this._handleStatusResponse(pack);
                return;
            }

            // If package type is response, update device properties
            if (pack.t === 'res') {
                this._handleUpdateConfirmResponse(pack);
                return;
            }

            // Multi-split indoor unit list
            if (Array.isArray(pack.list)) {
                this._handleSubListResponse(pack);
                return;
            }
        }

        throw new ClientUnknownMessageError({ message, pack });
    }

    /**
     * @param {Buffer} buffer Serialized JSON string with message
     * @returns {object}
     * @private
     */
    _parse(buffer) {
        const jsonBuffer = buffer + '';

        try {
            return JSON.parse(jsonBuffer);
        } catch (error) {
            throw new ClientMessageParseError(error, { jsonBuffer });
        }
    }

    /**
     * Extract encrypted package from message using device key (if available)
     *
     * @param {string} message
     * @returns {object}
     * @private
     */
    _unpack(message) {
        try {
            return this._encryptionService.decrypt(message);
        } catch (error) {
            throw new ClientMessageUnpackError(error, { message });
        }
    }

    /**
     * Handle device handshake response
     *
     * @param {object} pack decrypted scan response
     * @param {object} message the enclosing message
     * @param {dgram.RemoteInfo} [rinfo] sender of the message
     * @private
     */
    async _handleHandshakeResponse(pack, message, rinfo) {
        // Some firmwares (e.g. 1.23) leave cid/mac of the scan response empty;
        // the enclosing message still carries the device cid.
        const cid = pack.cid || pack.mac || message.cid;

        if (
            this._options.mac &&
            normalizeMac(cid) !== normalizeMac(this._options.mac)
        ) {
            this._logger.debug('Scan response from another device, ignoring', {
                cid,
            });
            return;
        }

        // A broadcast scan is answered by every device on the network: stick
        // to the first one instead of re-binding to whichever answers last.
        if (this._handshaken && cid !== this._cid) {
            this._logger.debug('Scan response from another device, ignoring', {
                cid,
            });
            return;
        }

        // Already bound: re-binding would switch the cipher back to a generic
        // key on its retry and break polling until the next rebind.
        if (this._bound) {
            this._logger.debug('Scan response after binding, ignoring');
            return;
        }

        this._handshaken = true;
        this._cid = cid;
        this._deviceAddress = rinfo?.address || null;

        this._logger = this._baseLogger.child({ cid: this._cid });
        this._logger.info('Scan success', { address: this._deviceAddress });

        const timeout = this._options.bindTimeout;

        await this._sendBindRequest(1);

        // Re-arming without clearing would strand the previous timer (e.g.
        // when a device retransmits its handshake) beyond the reach of
        // _dispose(), leaving it to fire after disconnect().
        this._clearTimer('_bindTimeoutRef');
        this._bindTimeoutRef = setTimeout(() => {
            this._bindTimeoutRef = null;
            this._logger.warn('Binding attempt timed out', { timeout });

            // A rejection inside a timer callback has no caller to bubble to;
            // unhandled it terminates the process instead of surfacing as an
            // 'error' event.
            this._sendBindRequest(2).catch(error => this.emit('error', error));
        }, timeout);
    }

    /**
     * Handle device binding confirmation response
     *
     * @fires Client#connect
     * @private
     */
    async _handleBindingConfirmationResponse() {
        // The device may confirm both bind attempts (or retransmit); a second
        // confirmation must not start a second polling interval.
        if (this._bound) {
            this._logger.debug('Duplicate binding confirmation, ignoring');
            return;
        }
        this._bound = true;
        this._reconnectAttempt = 1;

        this._logger.info('Binding success (connected)', {
            host: this._deviceAddress || this._options.host,
        });

        this._clearTimer('_socketTimeoutRef');
        this._clearTimer('_bindTimeoutRef');

        // A failing first request (e.g. the network dropped right after the
        // bind) must not abort the connect: polling and the no-response
        // rebind take it from here.
        await this._requestStatus().catch(error => this.emit('error', error));

        if (!this._socket) {
            // disconnect() raced the status request
            return;
        }

        if (this._options.poll) {
            this._logger.info('Schedule status polling');

            this._clearTimer('_statusIntervalRef', clearInterval);
            this._statusIntervalRef = setInterval(
                () =>
                    this._requestStatus().catch(error =>
                        this.emit('error', error)
                    ),
                this._options.pollingInterval
            );
        }

        // A probe that cannot be sent only means the feature stays unpolled;
        // polling reports a network that is really down.
        this._probeOptionalCodes().catch(error =>
            this._logger.warn('Probe optional properties failed', { error })
        );

        this.emit('connect', this);
    }

    /**
     * Handle device properties status response
     *
     * @param pack
     * @fires Client#update
     * @private
     */
    _handleStatusResponse(pack) {
        this._logger.info('Status response');

        // The reply to a probe (see _probeOptionalCodes) says nothing about
        // the pending poll, so it must not count as its answer.
        const probe =
            Array.isArray(pack.cols) &&
            pack.cols.every(col => OPTIONAL_VENDOR_CODES.includes(col));
        if (!probe) {
            this._clearTimer('_statusTimeoutRef');
            this._noResponseCount = 0;
        }

        try {
            this._applyStatus(pack);
        } finally {
            if (!probe) {
                const waiters = this._statusWaiters;
                this._statusWaiters = [];
                const properties = this._transformer.fromVendor(
                    this._properties,
                    this._properties
                );
                waiters.forEach(waiter => waiter.resolve(properties));
            }
        }
    }

    /**
     * Take over the values of a status response and report the changed ones
     *
     * @param pack
     * @fires Client#update
     * @private
     */
    _applyStatus(pack) {
        // Guard against malformed packets: some firmwares occasionally return a
        // status without the expected parallel `cols`/`dat` arrays. Iterating
        // them blindly used to throw and (when unhandled) crash the host
        // process — see inwaar/node-red-contrib-gree-hvac#11/#12. Skip the
        // packet with a warning instead.
        if (!Array.isArray(pack.cols) || !Array.isArray(pack.dat)) {
            this._logger.warn('Malformed status response, ignoring', {
                cols: pack.cols,
                dat: pack.dat,
            });
            return;
        }

        const oldProperties = clone(this._properties);
        const newProperties = {};
        pack.cols.forEach((col, i) => {
            if (i >= pack.dat.length) {
                return;
            }
            newProperties[col] = pack.dat[i];
            this._properties[col] = pack.dat[i];
            if (OPTIONAL_VENDOR_CODES.includes(col)) {
                this._supportedOptionalCodes.add(col);
            }
        });

        // Shallow strict-equality diff: keys whose value changed, with the new
        // value. Keys absent from newProperties are ignored — a partial status
        // response only reports the columns it carries.
        const updatedProperties = {};
        for (const key of Object.keys(newProperties)) {
            if (oldProperties[key] !== newProperties[key]) {
                updatedProperties[key] = newProperties[key];
            }
        }

        // Surface the raw vs decoded internal sensor at debug level. The +40
        // quirk has firmware-dependent variants (inwaar/node-red-contrib-gree-hvac#10):
        // when a unit reports a wrong `currentTemperature`, the raw `TemSen` is
        // exactly what's needed to diagnose it in the field.
        if ('TemSen' in newProperties) {
            this._logger.debug('Internal sensor (TemSen)', {
                raw: newProperties.TemSen,
                decoded: this._transformer.fromVendor({
                    TemSen: newProperties.TemSen,
                }).currentTemperature,
            });
        }

        if (Object.keys(updatedProperties).length > 0) {
            this._addSetpoint(updatedProperties);
            this.emit(
                'update',
                this._transformer.fromVendor(
                    updatedProperties,
                    this._properties
                ),
                this._transformer.fromVendor(this._properties),
                this
            );
        }
    }

    /**
     * Handle the answer to a subList request
     *
     * @param {object} pack
     * @private
     */
    _handleSubListResponse(pack) {
        this._logger.info('Sub-unit list response', {
            count: pack.list.length,
        });
        this._settleSubList(pack.list);
    }

    /**
     * A changed unit (`TemUn`) or `TemRec` changes the friendly
     * `temperature` even when `SetTem` itself did not change (75 °F → 76 °F
     * is `TemRec` 0 → 1 at `SetTem` 24), so report the setpoint along.
     *
     * @param {Object<string, number>} updatedProperties vendor properties, modified in place
     * @private
     */
    _addSetpoint(updatedProperties) {
        if (
            ('TemUn' in updatedProperties || 'TemRec' in updatedProperties) &&
            'SetTem' in this._properties
        ) {
            updatedProperties.SetTem = this._properties.SetTem;
        }
    }

    /**
     * Handle device properties update confirmation response
     *
     * @param pack
     * @fires Client#success
     * @private
     */
    _handleUpdateConfirmResponse(pack) {
        this._logger.info('Update response');

        // Guard against malformed packets. The set-confirmation carries the
        // updated values in either `val` or `p`, parallel to `opt`. A device
        // that returns `opt` without a matching value array used to throw here
        // (`Cannot read properties of undefined (reading '0')`) and, being
        // unhandled, crash the whole Node-RED process — the exact failure in
        // inwaar/node-red-contrib-gree-hvac#11/#12. Skip with a warning.
        const values = 'val' in pack ? pack.val : pack.p;
        if (!Array.isArray(pack.opt) || !Array.isArray(values)) {
            this._logger.warn('Malformed update-confirm response, ignoring', {
                opt: pack.opt,
                val: pack.val,
                p: pack.p,
            });
            return;
        }

        const updatedProperties = {};
        pack.opt.forEach((opt, i) => {
            if (i >= values.length) {
                return;
            }
            this._properties[opt] = updatedProperties[opt] = values[i];
        });

        this._addSetpoint(updatedProperties);
        this.emit(
            'success',
            this._transformer.fromVendor(updatedProperties, this._properties),
            this._transformer.fromVendor(this._properties),
            this
        );
    }
}

/**
 * @param {string} mac
 * @returns {string} lower-case MAC-address without separators
 * @private
 */
const normalizeMac = mac =>
    String(mac || '')
        .replace(/[^0-9a-f]/gi, '')
        .toLowerCase();

module.exports = {
    Client,
    PROPERTY,
    VALUE: PROPERTY_VALUE,
    // the error classes, for `instanceof` checks
    ...require('./errors'),
};
