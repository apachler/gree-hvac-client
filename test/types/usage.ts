// Compile-time checks of index.d.ts (`npm run typecheck`), never run. The
// `@ts-expect-error` lines must fail to compile; the rest must compile.

import {
    Client,
    ClientInvalidPropertyError,
    ClientNoResponseError,
    PROPERTY,
    VALUE,
    PropertyMap,
} from '../../index';
// The runtime source, typed by inference from the JS (allowJs)
import * as runtime from '../../src/client';

type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
        ? true
        : false;
const assert = <T extends true>(): T => true as T;

// index.d.ts lists exactly the properties and values of the source
assert<Equal<keyof typeof PROPERTY, keyof typeof runtime.PROPERTY>>();
assert<Equal<keyof typeof VALUE, keyof typeof runtime.VALUE>>();
type ValueKeys<V> = { -readonly [P in keyof V]: keyof V[P] };
assert<Equal<ValueKeys<typeof VALUE>, ValueKeys<typeof runtime.VALUE>>>();

const client = new Client({ host: '192.168.1.42', poll: false });

client.on('update', (updated: PropertyMap, properties) => {
    const temperature: number | undefined = properties.temperature;
    const mode: 'auto' | 'cool' | 'dry' | 'fan_only' | 'heat' | undefined =
        updated.mode;
    void temperature;
    void mode;
});
client.on('error', error => void error.origin);
client.on('reconnecting', ({ attempt, delayMs, reason }) => {
    const known: 'connect_timeout' | 'no_response' | 'socket_error' = reason;
    void (attempt + delayMs);
    void known;
});
void new Client({ recoveryDelay: 30000, reopenSocket: true });
// @ts-expect-error not a client option
void new Client({ rebindDelay: 1 });
client.once('disconnect', () => {});
// @ts-expect-error unknown event
client.on('connected', () => {});

void client.setProperty(PROPERTY.fanSpeed, VALUE.fanSpeed.high);
void client.setProperty('temperature', 24);
void client.setProperties({ power: 'on', mode: 'cool', targetHumidity: 50 });
// @ts-expect-error not a fanSpeed value
void client.setProperty('fanSpeed', 'max');
// @ts-expect-error read-only property
void client.setProperty('currentTemperature', 20);

void (async () => {
    await client.connect();
    try {
        const properties = await client.getProperties();
        const outdoor: number | undefined = properties.outdoorTemperature;
        void outdoor;
    } catch (error) {
        if (error instanceof ClientInvalidPropertyError) {
            void error.props;
        }
        if (error instanceof ClientNoResponseError) {
            void error.message;
        }
    }

    const info = await client.getDeviceInfo();
    const warning: string | undefined = info.upgradeWarning;
    void warning;
    const raw = await client.getVendorProperties(['UvcControl']);
    await client.setVendorProperties({ UvcControl: raw.UvcControl ?? 0 });
    await client.setClock();
    await client.setProperties({ humidityMode: 'smart', lightSensor: 'on' });
    const { confirmed } = await Client.configureWifi({
        ssid: 'home',
        password: 'secret',
    });
    void confirmed;
    // @ts-expect-error a password is needed
    void Client.configureWifi({ ssid: 'home' });

    const devices = await Client.discover({ host: '192.168.1.255' });
    const gateways = devices.filter(device => device.subUnits > 0);
    for (const unit of await client.getSubUnits()) {
        new Client({ host: gateways[0].address, subUnit: unit.mac });
    }
})();
