'use strict';

const PROPERTY_VENDOR_VALUE = require('./property-vendor-value').PROPERTY_VALUE;
const PROPERTY_VENDOR_CODES = {
    power: 'Pow',
    mode: 'Mod',
    temperatureUnit: 'TemUn',
    temperature: 'SetTem',
    currentTemperature: 'TemSen',
    fanSpeed: 'WdSpd',
    air: 'Air',
    blow: 'Blo',
    health: 'Health',
    sleep: 'SwhSlp',
    lights: 'Lig',
    swingHor: 'SwingLfRig',
    swingVert: 'SwUpDn',
    quiet: 'Quiet',
    turbo: 'Tur',
    powerSave: 'SvSt',
    safetyHeating: 'StHt',
    antiDirectBlow: 'AntiDirectBlow',
    outdoorTemperature: 'OutEnvTem',
    humidity: 'DwatSen',
    errorCode: 'AllErr',
    targetHumidity: 'Dwet',
    waterFull: 'DwatFul',
    cleanFilter: 'Dfltr',
    humidityMode: 'Dmod',
    lightSensor: 'LigSen',
};

/**
 * Vendor codes that only some units report. A unit without the feature may
 * answer a status request naming one of them with an empty `dat`, so instead
 * of adding them to every poll the client probes each one once after binding
 * and only polls the ones the unit answered.
 *
 * @private
 */
const OPTIONAL_VENDOR_CODES = [
    'AntiDirectBlow',
    'OutEnvTem',
    'DwatSen',
    'AllErr',
    'Dwet',
    'DwatFul',
    'Dfltr',
    'Dmod',
    'LigSen',
];

/**
 * Vendor codes polled on top of the friendly properties' codes: `TemRec` has
 * no friendly name of its own but is needed to decode a Fahrenheit setpoint.
 *
 * @private
 */
const EXTRA_STATUS_VENDOR_CODES = ['TemRec'];

/**
 * Some Celsius firmwares carry a half-degree setpoint in `Add0.5` (opt-in,
 * see the `halfDegree` client option): `SetTem` 23 + `Add0.5` 1 is 23.5 °C.
 *
 * @private
 */
const HALF_DEGREE_CODE = 'Add0.5';

/**
 * Some friendly properties map to more than one vendor code that must be
 * written together. `sleep` is the known case: many units gate the sleep
 * function behind a *pair* of fields — `SwhSlp` (the switch) and `SlpMod`
 * (the mode) — that have to move in lockstep. Writing only `SwhSlp` leaves
 * `SlpMod` untouched, so `{sleep: 'off'}` is silently ignored by the unit
 * (upstream inwaar/node-red-contrib-gree-hvac#7). When a primary property
 * here is set, every companion code is written with the same vendor value.
 *
 * @private
 */
const PROPERTY_VENDOR_COMPANIONS = {
    sleep: ['SlpMod'],
};

// Most firmwares report the internal sensor `TemSen` offset by +40 (the field
// is an unsigned type, so the offset avoids negative values): real = TemSen − 40.
const TEMSEN_OFFSET = 40;

// …but some firmwares report `TemSen` already in real °C with no offset
// (upstream inwaar/node-red-contrib-gree-hvac#10). There, the blind subtraction
// produces an impossible reading — a real room of 31 °C arrives as `31` and
// `31 − 40 = −9 °C` is the exact bogus value users reported. An internal AC
// sensor never legitimately reads below freezing in service, so if subtracting
// the offset would drop below this floor we conclude the firmware did NOT apply
// the offset and pass the raw value through unchanged. A genuinely sub-zero
// reading on an offset firmware (rare for an indoor sensor) is the only case
// this mis-handles; the configurable-offset escape hatch is the fallback there.
const MIN_PLAUSIBLE_DECODED_C = 0;

/**
 * Decode the raw `TemSen` vendor value to a real °C reading, accounting for the
 * +40 quirk and its firmware-dependent variants. Exported so the simulator and
 * tests can assert the exact rule.
 *
 * @param {number} value Raw `TemSen` as reported by the device
 * @returns {number} Real °C, or `0` when the sensor is unsupported/unavailable
 * @private
 */
const decodeCurrentTemperature = value => {
    // `0` means the unit has no internal sensor / the feature is unsupported —
    // keep it as "unavailable", never decode it to −40.
    if (value === 0) {
        return 0;
    }
    const decoded = value - TEMSEN_OFFSET;
    if (decoded < MIN_PLAUSIBLE_DECODED_C) {
        return value;
    }
    return decoded;
};

/**
 * Decode the raw outdoor sensor `OutEnvTem` to a real °C reading. It carries
 * the same +40 offset as `TemSen`, but without its plausibility guard: an
 * outdoor sensor legitimately reads below 0 °C.
 *
 * @param {number} value Raw `OutEnvTem` as reported by the device
 * @returns {number} Real °C, or `0` when the sensor is unsupported/unavailable
 * @private
 */
const decodeOutdoorTemperature = value =>
    value === 0 ? 0 : value - TEMSEN_OFFSET;

// The setpoint `SetTem` is always °C on the wire. A Fahrenheit setpoint is
// sent as the rounded °C value plus the `TemRec` bit, which tells apart the
// two whole-°F values that round to the same °C (e.g. 75 °F and 76 °F both
// round to 24 °C). Formula from tomikaa87/gree-remote.
const FAHRENHEIT_UNIT = PROPERTY_VENDOR_VALUE.temperatureUnit.fahrenheit;

// Setpoints run 16–30 °C (61–86 °F). Any `SetTem` above this while the unit
// is set to °F must already be in °F (some firmwares report it that way), so
// it is passed through instead of being converted a second time.
const MAX_CELSIUS_SETPOINT = 40;

const fahrenheitToCelsius = f => ((f - 32) * 5) / 9;

/**
 * Encode a °F setpoint to the vendor `SetTem` (°C) + `TemRec` pair.
 *
 * @param {number} fahrenheit
 * @returns {{SetTem: number, TemRec: number}}
 * @private
 */
const encodeFahrenheit = fahrenheit => {
    const celsius = fahrenheitToCelsius(fahrenheit);
    const SetTem = Math.round(celsius);
    return { SetTem, TemRec: celsius - SetTem > 0 ? 1 : 0 };
};

/**
 * Decode the vendor `SetTem` (°C) + `TemRec` pair to a whole °F setpoint.
 *
 * @param {number} setTem
 * @param {number} temRec
 * @returns {number}
 * @private
 */
const decodeFahrenheit = (setTem, temRec) => {
    if (setTem > MAX_CELSIUS_SETPOINT) {
        return setTem;
    }
    // At most two whole °F values round to one °C; TemRec picks between them.
    const approx = (setTem * 9) / 5 + 32;
    for (let f = Math.floor(approx) - 1; f <= Math.ceil(approx) + 1; f++) {
        const encoded = encodeFahrenheit(f);
        if (encoded.SetTem === setTem && encoded.TemRec === (temRec ? 1 : 0)) {
            return f;
        }
    }
    return Math.round(approx);
};

/**
 * Air conditioners with humidity control (e.g. Airy Pro) send the target
 * humidity as `Dwet` = (% − 15) / 5 instead of a plain percentage
 * (RobHofmann/HomeAssistant-GreeClimateComponent#473).
 *
 * @private
 */
const ENCODED_HUMIDITY_TRANSFORMER = {
    fromVendor: value => value * 5 + 15,
    toVendor: value => Math.round((value - 15) / 5),
};

/**
 * `object[key]` for own properties only: names come from the device and the
 * caller, and `constructor` or `__proto__` must not resolve to built-ins.
 *
 * @param {object} object
 * @param {string} key
 * @returns {unknown} the value, or undefined when not an own property
 * @private
 */
const own = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;

const readOnly = (property, fromVendor = value => value) => ({
    fromVendor,
    toVendor: function () {
        throw new Error(`Cannot set read-only property ${property}`);
    },
});

const PROPERTY_VALUE_TRANSFORMERS = {
    currentTemperature: readOnly(
        'currentTemperature',
        decodeCurrentTemperature
    ),
    outdoorTemperature: readOnly(
        'outdoorTemperature',
        decodeOutdoorTemperature
    ),
    humidity: readOnly('humidity'),
    errorCode: readOnly('errorCode'),
    waterFull: readOnly('waterFull'),
    cleanFilter: readOnly('cleanFilter'),
};

const NOOP_PROPERTY_VALUE_TRANSFORMER = {
    fromVendor: value => value,
    toVendor: value => value,
};

/**
 * Transforms device properties from vendor names to human friendly names and back
 *
 * @private
 */
class PropertyTransformer {
    /**
     * @param {object} [options] client options
     * @param {boolean} [options.halfDegree] encode °C setpoints with `Add0.5`
     * @param {boolean} [options.encodedTargetHumidity] `Dwet` is (% − 15) / 5
     */
    constructor(options = {}) {
        this._halfDegree = Boolean(options.halfDegree);
        this._encodedTargetHumidity = Boolean(options.encodedTargetHumidity);
        this._properties = PROPERTY_VENDOR_CODES;
        this._values = PROPERTY_VENDOR_VALUE;
        this._reversedProperties = this._reverseProperties();
        this._reversedValues = this._reverseValues();
    }

    /**
     * Transforms device properties from vendor names to human friendly names
     *
     * @param properties Object.<string,string|number>
     * @param {Object<string, number>} [state] current vendor properties, used
     *     for the unit (`TemUn`) and `TemRec` when `properties` lacks them
     * @returns {Object<string, string | number>}
     * @example
     * const properties = transformer.fromVendor({
     *     Mod: 1,
     *     SetTem: 25
     * });
     *
     * console.log(properties);
     *
     * // {
     * //    mode: 'cool',
     * //    temperature: 25
     * // }
     */
    fromVendor(properties, state = {}) {
        const ret = {};
        for (const [property, value] of Object.entries(properties)) {
            const reversedProperty = own(this._reversedProperties, property);
            // Skip vendor codes this client doesn't model — e.g. the `SlpMod`
            // companion echoed back in a set-confirmation, or extra fields a
            // device returns. Mapping them would throw on the unknown key.
            if (reversedProperty === undefined) {
                continue;
            }
            ret[reversedProperty] = this._valueFromVendor(
                reversedProperty,
                value
            );
        }
        if ('SetTem' in properties && this._isFahrenheit(properties, state)) {
            ret.temperature = decodeFahrenheit(
                properties.SetTem,
                'TemRec' in properties ? properties.TemRec : state.TemRec
            );
        } else if ('SetTem' in properties && this._halfDegree) {
            const half =
                HALF_DEGREE_CODE in properties
                    ? properties[HALF_DEGREE_CODE]
                    : state[HALF_DEGREE_CODE];
            ret.temperature = properties.SetTem + (half === 1 ? 0.5 : 0);
        }
        return ret;
    }

    /**
     * Transforms device properties from human friendly names to vendor names
     *
     * A `temperature` is in °F when the unit is set to Fahrenheit — by a
     * `temperatureUnit` in the same call, or else by the device's current
     * `TemUn` in `state` — and is sent as `SetTem` (°C) + `TemRec`, together
     * with `TemUn`.
     *
     * @param properties Object.<string,string|number>
     * @param {Object<string, number>} [state] current vendor properties
     * @returns {Object<string, string | number>}
     */
    toVendor(properties, state = {}) {
        const ret = {};
        for (const [property, value] of Object.entries(properties)) {
            const code = own(this._properties, property);
            if (code === undefined) {
                throw new Error(`Unknown property ${property}`);
            }
            const vendorValue = this._valueToVendor(property, value);
            ret[code] = vendorValue;
            const companions = own(PROPERTY_VENDOR_COMPANIONS, property);
            if (companions) {
                for (const companion of companions) {
                    ret[companion] = vendorValue;
                }
            }
        }
        if ('SetTem' in ret && this._isFahrenheit(ret, state)) {
            Object.assign(ret, encodeFahrenheit(ret.SetTem));
            ret.TemUn = FAHRENHEIT_UNIT;
        } else if ('SetTem' in ret && this._halfDegree) {
            const whole = Math.floor(ret.SetTem);
            ret[HALF_DEGREE_CODE] = ret.SetTem - whole >= 0.5 ? 1 : 0;
            ret.SetTem = whole;
        }
        // The light sensor only acts while the display is on
        if (
            ret.LigSen === PROPERTY_VENDOR_VALUE.lightSensor.on &&
            !('Lig' in ret)
        ) {
            ret.Lig = PROPERTY_VENDOR_VALUE.lights.on;
        }
        return ret;
    }

    /**
     * Vendor codes for a status request: every property's code except the
     * optional ones, plus the extra codes and the optional ones the unit is
     * known to support.
     *
     * @param {Iterable<string>} [supportedOptional] optional vendor codes to include
     * @returns {string[]}
     */
    statusColumns(supportedOptional = []) {
        const supported = new Set(supportedOptional);
        return [
            ...Object.values(this._properties),
            ...EXTRA_STATUS_VENDOR_CODES,
            ...(this._halfDegree ? [HALF_DEGREE_CODE] : []),
        ].filter(
            code => !OPTIONAL_VENDOR_CODES.includes(code) || supported.has(code)
        );
    }

    _isFahrenheit(properties, state) {
        const unit = 'TemUn' in properties ? properties.TemUn : state.TemUn;
        return unit === FAHRENHEIT_UNIT;
    }

    _valueFromVendor(property, value) {
        const reversedValue =
            own(own(this._reversedValues, property) || {}, value) ?? value;
        return this._getValueTransformer(property).fromVendor(reversedValue);
    }

    _valueToVendor(property, value) {
        const values = own(this._values, property) || {};
        return this._getValueTransformer(property).toVendor(
            own(values, value) ?? value
        );
    }

    _getValueTransformer(property) {
        if (property === 'targetHumidity' && this._encodedTargetHumidity) {
            return ENCODED_HUMIDITY_TRANSFORMER;
        }
        return (
            own(PROPERTY_VALUE_TRANSFORMERS, property) ||
            NOOP_PROPERTY_VALUE_TRANSFORMER
        );
    }

    _reverseProperties() {
        const reversed = {};
        for (const [k, v] of Object.entries(this._properties)) {
            reversed[v] = k;
        }
        return reversed;
    }

    _reverseValues() {
        const reversed = {};
        for (const [k, v] of Object.entries(this._values)) {
            reversed[k] = {};
            for (const [valueKey, valueValue] of Object.entries(v)) {
                reversed[k][valueValue] = valueKey;
            }
        }
        return reversed;
    }
}

module.exports = {
    PropertyTransformer,
    decodeCurrentTemperature,
    decodeOutdoorTemperature,
    encodeFahrenheit,
    decodeFahrenheit,
    OPTIONAL_VENDOR_CODES,
    HALF_DEGREE_CODE,
};
