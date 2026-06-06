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
};

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

const PROPERTY_VALUE_TRANSFORMERS = {
    currentTemperature: {
        fromVendor: decodeCurrentTemperature,
        toVendor: function () {
            throw new Error(`Cannot set read-only property currentTemperature`);
        },
    },
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
    constructor() {
        this._properties = PROPERTY_VENDOR_CODES;
        this._values = PROPERTY_VENDOR_VALUE;
        this._reversedProperties = this._reverseProperties();
        this._reversedValues = this._reverseValues();
    }

    /**
     * Transforms device properties from vendor names to human friendly names
     *
     * @param properties Object.<string,string|number>
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
    fromVendor(properties) {
        const ret = {};
        for (const [property, value] of Object.entries(properties)) {
            const reversedProperty = this._reversedProperties[property];
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
        return ret;
    }

    /**
     * Transforms device properties from human friendly names to vendor names
     *
     * @param properties Object.<string,string|number>
     * @returns {Object<string, string | number>}
     */
    toVendor(properties) {
        const ret = {};
        for (const [property, value] of Object.entries(properties)) {
            const vendorValue = this._valueToVendor(property, value);
            ret[this._properties[property]] = vendorValue;
            const companions = PROPERTY_VENDOR_COMPANIONS[property];
            if (companions) {
                for (const companion of companions) {
                    ret[companion] = vendorValue;
                }
            }
        }
        return ret;
    }

    arrayToVendor(properties) {
        return properties.map(property => this._properties[property]);
    }

    _valueFromVendor(property, value) {
        const reversedValue = this._reversedValues[property][value] || value;
        return this._getValueTransformer(property).fromVendor(reversedValue);
    }

    _valueToVendor(property, value) {
        const values = this._values[property] || {};
        return this._getValueTransformer(property).toVendor(
            values[value] !== undefined ? values[value] : value
        );
    }

    _getValueTransformer(property) {
        return (
            PROPERTY_VALUE_TRANSFORMERS[property] ||
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
};
