// Type definitions for gree-hvac-client. Hand-written: keep them in step with
// src/*.js; `npm run typecheck` fails when PROPERTY or VALUE drift apart.

import { EventEmitter } from 'events';

export declare const PROPERTY: {
    readonly power: 'power';
    readonly mode: 'mode';
    readonly temperatureUnit: 'temperatureUnit';
    readonly temperature: 'temperature';
    readonly currentTemperature: 'currentTemperature';
    readonly fanSpeed: 'fanSpeed';
    readonly air: 'air';
    readonly blow: 'blow';
    readonly health: 'health';
    readonly sleep: 'sleep';
    readonly lights: 'lights';
    readonly swingHor: 'swingHor';
    readonly swingVert: 'swingVert';
    readonly quiet: 'quiet';
    readonly turbo: 'turbo';
    readonly powerSave: 'powerSave';
    readonly safetyHeating: 'safetyHeating';
    readonly antiDirectBlow: 'antiDirectBlow';
    readonly outdoorTemperature: 'outdoorTemperature';
    readonly humidity: 'humidity';
    readonly errorCode: 'errorCode';
    /** % on dehumidifiers; ACs with humidity control (e.g. Airy Pro) send Dwet = (% − 15) / 5, see the encodedTargetHumidity option */
    readonly targetHumidity: 'targetHumidity';
    readonly waterFull: 'waterFull';
    readonly cleanFilter: 'cleanFilter';
    readonly humidityMode: 'humidityMode';
    readonly lightSensor: 'lightSensor';
};

type OnOff = { readonly off: 'off'; readonly on: 'on' };
// a property without named values (a number)
type NoValues = {};

export declare const VALUE: {
    readonly power: OnOff;
    readonly mode: {
        readonly auto: 'auto';
        readonly cool: 'cool';
        readonly dry: 'dry';
        readonly fan_only: 'fan_only';
        readonly heat: 'heat';
    };
    readonly temperatureUnit: {
        readonly celsius: 'celsius';
        readonly fahrenheit: 'fahrenheit';
    };
    readonly temperature: NoValues;
    readonly currentTemperature: NoValues;
    readonly fanSpeed: {
        readonly auto: 'auto';
        readonly low: 'low';
        readonly mediumLow: 'mediumLow';
        readonly medium: 'medium';
        readonly mediumHigh: 'mediumHigh';
        readonly high: 'high';
    };
    readonly air: {
        readonly off: 'off';
        readonly inside: 'inside';
        readonly outside: 'outside';
        readonly mode3: 'mode3';
    };
    readonly blow: OnOff;
    readonly health: OnOff;
    readonly sleep: OnOff;
    readonly lights: OnOff;
    readonly swingHor: {
        readonly default: 'default';
        readonly full: 'full';
        readonly fixedLeft: 'fixedLeft';
        readonly fixedMidLeft: 'fixedMidLeft';
        readonly fixedMid: 'fixedMid';
        readonly fixedMidRight: 'fixedMidRight';
        readonly fixedRight: 'fixedRight';
        readonly fullAlt: 'fullAlt';
    };
    readonly swingVert: {
        readonly default: 'default';
        readonly full: 'full';
        readonly fixedTop: 'fixedTop';
        readonly fixedMidTop: 'fixedMidTop';
        readonly fixedMid: 'fixedMid';
        readonly fixedMidBottom: 'fixedMidBottom';
        readonly fixedBottom: 'fixedBottom';
        readonly swingBottom: 'swingBottom';
        readonly swingMidBottom: 'swingMidBottom';
        readonly swingMid: 'swingMid';
        readonly swingMidTop: 'swingMidTop';
        readonly swingTop: 'swingTop';
    };
    readonly quiet: {
        readonly off: 'off';
        readonly mode1: 'mode1';
        readonly mode2: 'mode2';
        readonly mode3: 'mode3';
    };
    readonly turbo: OnOff;
    readonly powerSave: OnOff;
    readonly safetyHeating: OnOff;
    readonly antiDirectBlow: OnOff;
    readonly outdoorTemperature: NoValues;
    readonly humidity: NoValues;
    readonly errorCode: NoValues;
    readonly targetHumidity: NoValues;
    readonly waterFull: OnOff;
    readonly cleanFilter: OnOff;
    readonly humidityMode: {
        readonly off: 'off';
        readonly target: 'target';
        readonly continuous: 'continuous';
        readonly smart: 'smart';
    };
    readonly lightSensor: OnOff;
};

export type Property = keyof typeof PROPERTY;

/** Properties that are only reported by the device and cannot be set */
export type ReadOnlyProperty =
    | 'currentTemperature'
    | 'outdoorTemperature'
    | 'humidity'
    | 'errorCode'
    | 'waterFull'
    | 'cleanFilter';

export type WritableProperty = Exclude<Property, ReadOnlyProperty>;

/** The value of a property: one of its VALUE names, or a number (temperatures, humidity, fault code) */
export type PropertyValue<P extends Property = Property> = [
    keyof (typeof VALUE)[P],
] extends [never]
    ? number
    : keyof (typeof VALUE)[P];

export type PropertyMap = { [P in Property]?: PropertyValue<P> };

export type WritablePropertyMap = {
    [P in WritableProperty]?: PropertyValue<P>;
};

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ClientOptions {
    /** GREE device ip-address, or a broadcast address (192.168.1.255) */
    host: string;
    /** GREE device UDP port (7000) */
    port: number;
    /** Only bind to the device with this MAC-address (cid) */
    mac: string | null;
    /** Multi-split: the indoor unit to control, as listed by getSubUnits() */
    subUnit: string | null;
    /** Reconnect to device if no success timeout (3000 ms) */
    connectTimeout: number;
    /** Upper bound for the reconnect back-off (30000 ms) */
    reconnectMaxDelay: number;
    /** Wait for a bind confirmation before retrying with AES-GCM (1000 ms) */
    bindTimeout: number;
    /** Connect when the client is created (true) */
    autoConnect: boolean;
    /** Poll device properties (true) */
    poll: boolean;
    /** Device properties polling interval (3000 ms) */
    pollingInterval: number;
    /** Emit `no_response` when a status request is not answered within this (1000 ms) */
    pollingTimeout: number;
    /** Re-scan and re-bind after this many consecutive `no_response` events, 0 disables (3) */
    maxNoResponse: number;
    /** Most vendor codes per status request; more are split over several (20) */
    statusBatchSize: number;
    /** Celsius setpoints in half degrees, for firmwares with `Add0.5` (false) */
    halfDegree: boolean;
    /**
     * `targetHumidity` is sent as (% − 15) / 5, as air conditioners with
     * humidity control do, e.g. Airy Pro (false; dehumidifiers send plain %)
     */
    encodedTargetHumidity: boolean;
    /** Least time between two set requests, 0 disables it (100 ms) */
    commandInterval: number;
    /** Ask the unit not to beep on commands (false) */
    silent: boolean;
    /** Logging level ('error') */
    logLevel: LogLevel;
    /** @deprecated use logLevel */
    debug: boolean;
}

export interface DiscoverOptions {
    /** Address to send the scan to: your network's broadcast address */
    host?: string;
    port?: number;
    /** How long to wait for answers (3000 ms) */
    timeout?: number;
    logLevel?: LogLevel;
}

export interface DiscoveredDevice {
    /** Device MAC-address (cid), usable as the `mac` client option */
    mac: string;
    /** Device name as configured in the vendor app */
    name: string;
    /** IP-address the device answered from, usable as the `host` client option */
    address: string;
    /** Firmware version, e.g. `V1.1.13` */
    version?: string;
    /** Indoor units behind it when it is a multi-split gateway, else 0 */
    subUnits: number;
    /** The full decrypted scan answer (brand, model, ...) */
    pack: Record<string, unknown>;
}

export interface DeviceInfo {
    /** Device MAC-address (cid) */
    mac: string | null;
    name?: string;
    /** WiFi module version from the scan answer, e.g. `V1.1.13` */
    version?: string;
    mid?: string;
    model?: string;
    brand?: string;
    /** Firmware id, e.g. `362001000762+U-CS532AE(LT)V3.31.bin` */
    hid?: string;
    firmwareCode?: string;
    /** e.g. `U-CS532AE(LT)` */
    moduleType?: string;
    /** e.g. `3.31` */
    firmwareVersion?: string;
    /** Set when later builds of this firmware dropped local (LAN) control */
    upgradeWarning?: string;
}

export interface WifiSetupOptions {
    ssid: string;
    /** Some firmwares take at most 31 characters */
    password: string;
    /** The unit's address in AP mode (192.168.1.1) */
    host?: string;
    port?: number;
    /** How long to wait for the confirmation (5000 ms) */
    timeout?: number;
    logLevel?: LogLevel;
}

export interface SubUnit {
    /** Indoor unit MAC-address, usable as the `subUnit` client option */
    mac: string;
    /** Model id, when the outdoor unit reports one */
    mid?: string;
    [field: string]: unknown;
}

export declare class ClientError extends Error {
    constructor(
        message: string,
        origin?: Error,
        props?: Record<string, unknown>
    );
    origin: Error | undefined;
    props: Record<string, unknown> | undefined;
}
/** Connectivity problems while communicating with HVAC */
export declare class ClientSocketSendError extends ClientError {}
/** The UDP socket failed (e.g. it could not be bound) */
export declare class ClientSocketError extends ClientError {}
/** The message received from HVAC cannot be parsed */
export declare class ClientMessageParseError extends ClientError {}
/** The package from the message received from HVAC cannot be decrypted */
export declare class ClientMessageUnpackError extends ClientError {}
/** A message having an unknown format was received from HVAC */
export declare class ClientUnknownMessageError extends ClientError {}
/** Request operations on a client not connected to the HVAC */
export declare class ClientNotConnectedError extends ClientError {}
export declare class ClientConnectTimeoutError extends ClientError {}
/** Connecting was cancelled by calling disconnect */
export declare class ClientCancelConnectError extends ClientError {}
/** The HVAC did not answer a status request within `pollingTimeout` */
export declare class ClientNoResponseError extends ClientError {}
/** An unknown or read-only property, or a value the unit does not take */
export declare class ClientInvalidPropertyError extends ClientError {}

export interface ClientEvents {
    connect: [client: Client];
    update: [updated: PropertyMap, properties: PropertyMap, client: Client];
    success: [updated: PropertyMap, properties: PropertyMap, client: Client];
    no_response: [client: Client];
    error: [error: ClientError];
    disconnect: [];
}

export declare class Client extends EventEmitter {
    constructor(options?: Partial<ClientOptions>);

    /** Find GREE devices on the network */
    static discover(options?: DiscoverOptions): Promise<DiscoveredDevice[]>;
    /** Connect a unit in AP (setup) mode to your WiFi network */
    static configureWifi(
        options: WifiSetupOptions
    ): Promise<{ confirmed: boolean; mac?: string }>;

    connect(): Promise<Client>;
    disconnect(): Promise<void>;
    setProperties(properties: WritablePropertyMap): Promise<void>;
    setProperty<P extends WritableProperty>(
        property: P,
        value: PropertyValue<P>
    ): Promise<void>;
    /** Ask the device for its current properties now */
    getProperties(): Promise<PropertyMap>;
    /** List the indoor units of a multi-split system */
    getSubUnits(options?: { timeout?: number }): Promise<SubUnit[]>;
    /** Read vendor codes the client has no property for, raw */
    getVendorProperties(
        codes: string[]
    ): Promise<Record<string, number | string>>;
    /** Set vendor codes the client has no property for, raw */
    setVendorProperties(
        properties: Record<string, number | string>
    ): Promise<void>;
    /** Scan answer plus firmware id, with a warning for cloud-only firmwares */
    getDeviceInfo(): Promise<DeviceInfo>;
    /** The unit's clock as `YYYY-MM-DD HH:MM:SS`, undefined without a clock */
    getClock(): Promise<string | undefined>;
    /** Set the unit's clock to the local time of `date` (now) */
    setClock(date?: Date): Promise<void>;
    /** Rename the device */
    setName(name: string): Promise<void>;
    getDeviceId(): string | null;
    /** @deprecated use the logLevel option */
    setDebug(enable: boolean): void;

    on<E extends keyof ClientEvents>(
        event: E,
        listener: (...args: ClientEvents[E]) => void
    ): this;
    once<E extends keyof ClientEvents>(
        event: E,
        listener: (...args: ClientEvents[E]) => void
    ): this;
    off<E extends keyof ClientEvents>(
        event: E,
        listener: (...args: ClientEvents[E]) => void
    ): this;
    addListener<E extends keyof ClientEvents>(
        event: E,
        listener: (...args: ClientEvents[E]) => void
    ): this;
    removeListener<E extends keyof ClientEvents>(
        event: E,
        listener: (...args: ClientEvents[E]) => void
    ): this;
    emit<E extends keyof ClientEvents>(
        event: E,
        ...args: ClientEvents[E]
    ): boolean;
}
