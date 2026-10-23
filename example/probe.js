/**
 * Hardware check: connect to one unit and print every vendor code it reports,
 * raw and decoded, which optional sensors it answered, and its indoor units
 * when it is a multi-split gateway. Paste the output into an issue when a
 * value looks wrong.
 *
 *     node example/probe.js 192.168.1.42
 *
 * Reads internals of the client (`_properties`, `_supportedOptionalCodes`) to
 * show the raw values: fine for a diagnostic, not for an application.
 */
const Gree = require('gree-hvac-client');
const {
    PropertyTransformer,
    OPTIONAL_VENDOR_CODES,
} = require('gree-hvac-client/src/property-transformer');

const host = process.argv[2];
if (!host) {
    console.error('Usage: node example/probe.js <device-ip>');
    process.exit(1);
}

// How long to give the optional-code probes to come back after the bind
const PROBE_WAIT = 2000;

// What to compare by hand, per vendor code
const CHECK = {
    TemSen: 'should match the room temperature',
    OutEnvTem: 'should match the outdoor temperature (0 = no sensor)',
    SetTem: 'should match the setpoint on the remote / app',
    TemRec: 'with TemUn 1: should give the °F setpoint shown on the remote',
    AllErr: 'should be 0 unless the unit shows a fault code',
    DwatSen: 'should match the humidity shown in the app',
};

const client = new Gree.Client({
    host,
    autoConnect: false,
    poll: false,
    logLevel: 'warn',
});
client.on('error', error => console.error('error:', error.message));

const transformer = new PropertyTransformer();
// friendly name of a vendor code, '' for codes without one (e.g. TemRec)
const propertyOf = (code, value) =>
    Object.keys(transformer.fromVendor({ [code]: value }))[0] || '';

(async () => {
    try {
        await client.connect();
        console.log(`Connected to ${host}, device id ${client.getDeviceId()}`);

        await new Promise(resolve => setTimeout(resolve, PROBE_WAIT));
        const decoded = await client.getProperties();
        const raw = client._properties;

        const rows = Object.entries(raw).map(([code, value]) => {
            const property = propertyOf(code, value);
            return {
                code,
                raw: value,
                property,
                decoded: property ? decoded[property] : '',
                check: CHECK[code] || '',
            };
        });
        console.table(rows);

        const supported = [...client._supportedOptionalCodes];
        console.log(
            'Optional codes answered:',
            supported.length ? supported.join(', ') : 'none'
        );
        console.log(
            'Optional codes not answered:',
            OPTIONAL_VENDOR_CODES.filter(c => !supported.includes(c)).join(
                ', '
            ) || 'none'
        );

        const units = await client.getSubUnits();
        console.log(
            units.length
                ? `Multi-split gateway, indoor units: ${units.map(u => u.mac).join(', ')}`
                : 'No indoor units listed (not a multi-split gateway)'
        );
        console.log(
            'Beeper: run any example with GREE_HVAC_SILENT=true and listen' +
                ' whether the unit still beeps on a command.'
        );
    } catch (error) {
        console.error('Probe failed:', error.message);
        process.exitCode = 1;
    } finally {
        await client.disconnect().catch(() => {});
    }
})();
