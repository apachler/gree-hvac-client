'use strict';

/**
 * WiFi-module firmwares whose later builds were found to be cloud-only (no
 * local UDP control), by firmware code: the last build verified to still
 * work locally, and the earliest cloud-only build found. From
 * cmroche/greeclimate docs/CLOUD_ONLY_FIRMWARE.md (17 October 2026); versions
 * are not monotonic across all codes, so this only warns before an upgrade.
 *
 * @private
 */
const CLOUD_ONLY_FIRMWARE = {
    362001066300: { module: '4MWB05DF13', lastLan: '3.05', cloudOnly: '3.27' },
    // not monotonic: 2.04 is cloud-only, 2.06 works locally again
    362001067540: { module: 'WB05WR13', lastLan: '2.06', cloudOnly: '2.04' },
    362001067541: { module: 'WB05WR11', lastLan: '2.04', cloudOnly: '2.08' },
    362001068254: { module: '4MWB65VR', lastLan: '2.11', cloudOnly: '2.12' },
    362001068295: { module: '4MWB05UR', lastLan: '2.02', cloudOnly: '2.04' },
    362001068411: { module: 'WB05HR13', lastLan: null, cloudOnly: '1.02' },
    362001071519: { module: '4MWB65AR11', lastLan: null, cloudOnly: '2.00' },
};

/**
 * Split a firmware id like `362001000762+U-CS532AE(LT)V3.31.bin`
 *
 * @param {string} [hid]
 * @returns {object} `{firmwareCode, moduleType, firmwareVersion}`, each only when present
 * @private
 */
const parseHid = hid => {
    if (typeof hid !== 'string' || !hid) {
        return {};
    }
    const match = /^(\d+)\+?(.*?)(?:V([\d.]+)\.bin)?$/.exec(hid);
    if (!match) {
        return {};
    }
    const [, firmwareCode, moduleType, firmwareVersion] = match;
    return {
        firmwareCode,
        ...(moduleType && { moduleType }),
        ...(firmwareVersion && { firmwareVersion }),
    };
};

/**
 * @param {object} firmware as parsed by parseHid()
 * @param {string} [firmware.firmwareCode]
 * @param {string} [firmware.firmwareVersion]
 * @returns {string|undefined} a warning when builds of this firmware are known to have dropped local control
 * @private
 */
const firmwareWarning = ({ firmwareCode, firmwareVersion } = {}) => {
    const known = CLOUD_ONLY_FIRMWARE[firmwareCode];
    if (!known) {
        return undefined;
    }
    const current = firmwareVersion ? ` (this unit: ${firmwareVersion})` : '';
    const lastLan = known.lastLan
        ? `; ${known.lastLan} is the last build verified to work locally`
        : '';
    return (
        `Firmware ${firmwareCode} (${known.module})${current}: build ` +
        `${known.cloudOnly} was found to be cloud-only, without local ` +
        `control${lastLan}. Do not upgrade the WiFi module firmware.`
    );
};

module.exports = {
    CLOUD_ONLY_FIRMWARE,
    parseHid,
    firmwareWarning,
};
