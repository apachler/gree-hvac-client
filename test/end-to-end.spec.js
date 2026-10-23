// No jest.mock('dgram') here: client and fake unit talk over real UDP
// sockets on 127.0.0.1, with real timers, so the wire format is exercised
// end to end.
const { Client } = require('../src/client');
const { ClientNoResponseError } = require('../src/errors');
const { startFakeUnit } = require('./support/fake-unit');

jest.setTimeout(10000);

const STATE = {
    Pow: 1,
    Mod: 1,
    TemUn: 0,
    SetTem: 24,
    TemRec: 0,
    TemSen: 63,
    WdSpd: 0,
    Lig: 1,
    OutEnvTem: 35,
    hid: '362001068254+U-4MWB65VRV2.11.bin',
};

describe('End to end (real UDP)', () => {
    let unit;
    let client;

    const connect = async (unitOptions = {}, clientOptions = {}) => {
        unit = await startFakeUnit({ state: STATE, ...unitOptions });
        client = new Client({
            host: '127.0.0.1',
            port: unit.port,
            autoConnect: false,
            poll: false,
            pollingTimeout: 1000,
            ...clientOptions,
        });
        client.on('error', () => {});
        await client.connect();
    };

    afterEach(async () => {
        await client?.disconnect().catch(() => {});
        await unit?.close();
        client = unit = null;
    });

    it.each(['ecb', 'gcm'])(
        'binds to an AES-%s unit and reads its properties',
        async cipher => {
            await connect({ cipher });

            expect(client.getDeviceId()).toBe(unit.mac);
            await expect(client.getProperties()).resolves.toMatchObject({
                power: 'on',
                mode: 'cool',
                temperature: 24,
                currentTemperature: 23,
                lights: 'on',
            });
        }
    );

    it('sets properties and reports the confirmation', async () => {
        await connect();
        const success = new Promise(resolve => client.once('success', resolve));

        await client.setProperties({ power: 'off', fanSpeed: 'high' });

        await expect(success).resolves.toEqual({
            power: 'off',
            fanSpeed: 'high',
        });
        expect(unit.state).toMatchObject({ Pow: 0, WdSpd: 5 });
    });

    it('reports a change made on the unit', async () => {
        await connect({}, { poll: true, pollingInterval: 200 });
        await client.getProperties();
        const update = new Promise(resolve =>
            client.on(
                'update',
                updated => 'temperature' in updated && resolve(updated)
            )
        );

        unit.state.SetTem = 26;

        await expect(update).resolves.toEqual({ temperature: 26 });
    });

    it('sends a °F setpoint as SetTem + TemRec', async () => {
        unit = null;
        await connect({ state: { ...STATE, TemUn: 1 } });
        await client.getProperties();

        await client.setProperty('temperature', 76);
        await new Promise(resolve => client.once('success', resolve));

        expect(unit.state).toMatchObject({ SetTem: 24, TemRec: 1, TemUn: 1 });
        await expect(client.getProperties()).resolves.toMatchObject({
            temperature: 76,
            temperatureUnit: 'fahrenheit',
        });
    });

    it('splits polls for a unit that goes silent on long requests', async () => {
        await connect({ maxColumns: 10 }, { statusBatchSize: 10 });

        await expect(client.getProperties()).resolves.toMatchObject({
            power: 'on',
        });
    });

    it('reports no response when a poll is too long for the unit', async () => {
        await connect({ maxColumns: 10 }, { statusBatchSize: 40 });

        await expect(client.getProperties()).rejects.toBeInstanceOf(
            ClientNoResponseError
        );
    });

    it('probes optional sensors and reads the firmware id', async () => {
        await connect();

        const info = await client.getDeviceInfo();
        expect(info).toMatchObject({
            name: 'fake-unit',
            firmwareCode: '362001068254',
            firmwareVersion: '2.11',
        });
        expect(info.upgradeWarning).toMatch(/2\.12/);

        await new Promise(resolve => setTimeout(resolve, 100));
        expect([...client._supportedOptionalCodes]).toEqual(['OutEnvTem']);
        await expect(client.getProperties()).resolves.toMatchObject({
            outdoorTemperature: -5,
        });
    });

    it('lists and addresses the indoor units of a gateway', async () => {
        const indoor = ['c0000001a2b3c4', 'c0000002a2b3c4'];
        await connect({ subUnits: indoor });

        await expect(client.getSubUnits()).resolves.toEqual(
            indoor.map(mac => ({ mac }))
        );

        const bedroom = new Client({
            host: '127.0.0.1',
            port: unit.port,
            autoConnect: false,
            poll: false,
            subUnit: indoor[0],
        });
        bedroom.on('error', () => {});
        try {
            await bedroom.connect();
            const success = new Promise(resolve =>
                bedroom.once('success', resolve)
            );
            await bedroom.setProperty('power', 'off');
            await success;

            const cmd = unit.received.filter(m => m.pack?.t === 'cmd').at(-1);
            expect(cmd.tcid).toBe(unit.mac);
            expect(cmd.pack.sub).toBe(indoor[0]);
        } finally {
            await bedroom.disconnect();
        }
    });

    it('discovers the unit', async () => {
        unit = await startFakeUnit({ subUnits: ['c0000001a2b3c4'] });

        const devices = await Client.discover({
            host: '127.0.0.1',
            port: unit.port,
            timeout: 300,
        });

        expect(devices).toEqual([
            expect.objectContaining({
                mac: unit.mac,
                name: 'fake-unit',
                address: '127.0.0.1',
                version: 'V1.2.3',
                subUnits: 1,
            }),
        ]);
    });

    it('sends the WiFi credentials to a unit in AP mode', async () => {
        unit = await startFakeUnit();

        await expect(
            Client.configureWifi({
                ssid: 'home',
                password: 'secret',
                host: '127.0.0.1',
                port: unit.port,
            })
        ).resolves.toEqual({ confirmed: true, mac: unit.mac });
        expect(unit.received).toContainEqual({
            psw: 'secret',
            ssid: 'home',
            t: 'wlan',
        });
    });
});
