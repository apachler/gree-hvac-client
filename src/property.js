'use strict';

/**
 * Device properties constants
 *
 * @readonly
 * @property {string} power - Power state of the device
 * @property {string} mode - Mode of operation
 * @property {string} temperatureUnit - Temperature unit of `temperature` and of the unit's display
 * @property {string} temperature - Target setpoint in `temperatureUnit` (the unit's current one unless set in the same call): whole °F, whole °C, or half °C with the `halfDegree` option
 * @property {string} currentTemperature - Get the indoor temperature sensor in °C (read-only; `0` when the unit has no such sensor)
 * @property {string} fanSpeed - Fan speed
 * @property {string} air - Fresh air valve
 * @property {string} blow - Keeps the fan running for a while after shutting down (also called "X-Fan", only usable in Dry and Cool mode)
 * @property {string} health - Controls Health ("Cold plasma") mode, only for devices equipped with "anion generator", which absorbs dust and kills bacteria
 * @property {string} sleep - Sleep mode, which gradually changes the temperature in Cool, Heat and Dry mode
 * @property {string} lights - Turns all indicators and the display on the unit on or off
 * @property {string} swingHor - Controls the swing mode of the horizontal air blades (not available on all units)
 * @property {string} swingVert - Controls the swing mode of the vertical air blades
 * @property {string} quiet - Controls the Quiet mode which slows down the fan to its most quiet speed. Not available in Dry and Fan mode
 * @property {string} turbo - Sets fan speed to the maximum. Fan speed cannot be changed while active and only available in Dry and Cool mode
 * @property {string} powerSave - Power saving mode
 * @property {string} safetyHeating - 8 °C heating / freeze protection
 * @property {string} antiDirectBlow - Keeps the air flow from blowing directly at people (not available on all units)
 * @property {string} outdoorTemperature - Get the outdoor unit's temperature sensor in °C (read-only; `0` when the unit has no such sensor)
 * @property {string} humidity - Get the indoor relative humidity in % (read-only; only units with a humidity sensor report it)
 * @property {string} errorCode - Get the unit's fault code, `0` when there is no fault (read-only)
 * @property {string} targetHumidity - Target relative humidity in % (dehumidifiers, and air conditioners with humidity control — set the `encodedTargetHumidity` option for those, e.g. Airy Pro)
 * @property {string} humidityMode - Humidity control of air conditioners that have it (e.g. Airy Pro): `continuous` only in dry mode, `smart` only in cool mode
 * @property {string} lightSensor - Dims the display automatically by the room light (not available on all units; turning it on also turns the `lights` on)
 * @property {string} waterFull - Get whether the water tank is full (read-only, dehumidifiers only)
 * @property {string} cleanFilter - Get whether the filter needs cleaning (read-only, dehumidifiers only)
 */
const PROPERTY = {
    power: 'power',
    mode: 'mode',
    temperatureUnit: 'temperatureUnit',
    temperature: 'temperature',
    currentTemperature: 'currentTemperature',
    fanSpeed: 'fanSpeed',
    air: 'air',
    blow: 'blow',
    health: 'health',
    sleep: 'sleep',
    lights: 'lights',
    swingHor: 'swingHor',
    swingVert: 'swingVert',
    quiet: 'quiet',
    turbo: 'turbo',
    powerSave: 'powerSave',
    safetyHeating: 'safetyHeating',
    antiDirectBlow: 'antiDirectBlow',
    outdoorTemperature: 'outdoorTemperature',
    humidity: 'humidity',
    errorCode: 'errorCode',
    targetHumidity: 'targetHumidity',
    waterFull: 'waterFull',
    cleanFilter: 'cleanFilter',
    humidityMode: 'humidityMode',
    lightSensor: 'lightSensor',
};

module.exports = {
    PROPERTY,
};
