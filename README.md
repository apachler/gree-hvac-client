# Gree HVAC client

![GitHub release](https://img.shields.io/github/v/release/apachler/gree-hvac-client?sort=semver)
![CI status](https://img.shields.io/github/actions/workflow/status/apachler/gree-hvac-client/ci.yml?label=ci)
![CodeQL status](https://img.shields.io/github/actions/workflow/status/apachler/gree-hvac-client/codeql.yml?label=codeql)
![Release status](https://img.shields.io/github/actions/workflow/status/apachler/gree-hvac-client/release.yml?label=release)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/apachler/gree-hvac-client/badge)](https://securityscorecards.dev/viewer/?uri=github.com/apachler/gree-hvac-client)
![License](https://img.shields.io/github/license/apachler/gree-hvac-client)
![Code style: prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)

A client for communicating with Gree air conditioners.

## Requirements

- NodeJS (>=18)

## Installation

This fork is distributed via **Git + GitHub Releases** (not the npm registry,
where the `gree-hvac-client` name belongs to the upstream project). Pin a release
tag.

**Recommended — install the packed tarball** from the GitHub Release (a
self-contained npm tarball; needs no git, no build step, ideal for Docker /
air-gapped builds):

```shell
npm install https://github.com/apachler/gree-hvac-client/releases/download/v4.3.0/gree-hvac-client-4.3.0.tgz
```

**Or install the Git ref** (npm clones the repo at the tag):

```shell
npm install github:apachler/gree-hvac-client#v4.3.0
```

Either way you can pin it in `package.json`:

```json
{
  "dependencies": {
    "gree-hvac-client": "https://github.com/apachler/gree-hvac-client/releases/download/v4.3.0/gree-hvac-client-4.3.0.tgz"
  }
}
```


## Simple usage

Set device properties:

```javascript
const Gree = require('gree-hvac-client');

const client = new Gree.Client({host: '192.168.7.60'});

client.on('connect', () => {
    client.setProperty(Gree.PROPERTY.temperature, 25);
    client.setProperty(Gree.PROPERTY.lights, Gree.VALUE.lights.off);
});
```


Poll device properties:

```javascript
const Gree = require('gree-hvac-client');

const client = new Gree.Client({host: '192.168.7.60'});

client.on('connect', (client) => {
    console.log('connected to', client.getDeviceId());
});
client.on('update', (updatedProperties, properties) => {
    console.log(updatedProperties, properties);
});
client.on('no_response', () => {
    console.log('no response');
});

```

Find devices on the network:

```javascript
const Gree = require('gree-hvac-client');

Gree.Client.discover({host: '192.168.7.255'}).then(devices => {
    // [{mac: 'f4911e000001', name: '1e000001', address: '192.168.7.60', version: 'V1.1.13', subUnits: 0, pack: {...}}]
    console.log(devices);
});
```

Read the current state on demand (instead of waiting for the next poll):

```javascript
const client = new Gree.Client({host: '192.168.7.60', autoConnect: false, poll: false});
client.on('error', error => console.error(error.message));

await client.connect();
const properties = await client.getProperties();
console.log(properties.temperature, properties.currentTemperature);
```

`getProperties()` rejects with `ClientNoResponseError` when the unit does not
answer within `pollingTimeout`. The error classes are exported
(`Gree.ClientNoResponseError`, ...) for `instanceof` checks.

### Multi-split systems

On a multi-split system one WiFi module in the outdoor unit (the gateway)
serves several indoor units; `discover()` reports it with `subUnits` > 0.
List the indoor units, then create one client per indoor unit with the
`subUnit` option — `host` stays the gateway's address:

```javascript
const gateway = new Gree.Client({host: '192.168.7.70', poll: false});
gateway.on('connect', async () => {
    const units = await gateway.getSubUnits(); // [{mac: 'c0000001a2b3c4'}, ...]
    await gateway.disconnect();

    const bedroom = new Gree.Client({host: '192.168.7.70', subUnit: units[0].mac});
    bedroom.on('update', (updated, properties) => console.log(properties));
});
```

> Not verified on hardware by this project: the message format follows the
> [Home Assistant Gree integration](https://github.com/RobHofmann/HomeAssistant-GreeClimateComponent),
> and some gateways are reported to answer status requests for indoor units
> with zeros (upstream [inwaar#30](https://github.com/inwaar/gree-hvac-client/issues/30)).
> Run `example/probe.js` against your gateway and report what you see.

### TypeScript

Type definitions ship with the package (`index.d.ts`): property names, their
values, events, options and errors are typed, and `setProperty` rejects
read-only properties and unknown values at compile time.

### Check your unit

`example/probe.js` connects to one unit and prints every vendor code it
reports, raw and decoded, which optional sensors it answered and its indoor
units — handy to check a value that looks wrong, and to attach to an issue:

```shell
node node_modules/gree-hvac-client/example/probe.js 192.168.7.60
```

### Connection loss and reconnect

The client recovers from the device dropping off WiFi on its own:

- A short outage heals by itself: polling continues and the device answers
  again with the same key.
- After `maxNoResponse` (default 3) consecutive `no_response` events the client
  starts over with scan + bind. This recovers a device that came back
  re-paired with a **new key** (MODE+WIFI resets it), which silently drops
  requests encrypted with the old one. `connect` is emitted again once bound.
- While the device stays unreachable, connect attempts back off exponentially
  from `connectTimeout` up to `reconnectMaxDelay`, emitting a
  `ClientConnectTimeoutError` per attempt.
- With a broadcast `host` plus the device `mac`, the device is rediscovered by
  its MAC on every reconnect, so a DHCP address change is followed. With a
  unicast `host`, give the AC a fixed address (DHCP reservation).

```javascript
const client = new Gree.Client({
    host: '192.168.7.255',
    mac: 'f4911e000001',
});
client.on('error', error => console.error(error.message));
```

## Properties

> For the full protocol — encryption, message flow, vendor codes and the
> `TemSen +40` quirk — see [docs/PROTOCOL.md](docs/PROTOCOL.md).

| Command | Values | Description |
|-|-|-|
| **temperature** | any integer |Target setpoint, in `temperatureUnit` (whole °F are encoded exactly, see [Fahrenheit setpoints](docs/PROTOCOL.md#fahrenheit-setpoints-temrec)) |
| **currentTemperature** | any integer |Indoor sensor in °C. (Read-only) |
| **outdoorTemperature** | any integer |Outdoor sensor in °C, `0` if the unit has none. (Read-only, optional) |
| **humidity** | any integer |Indoor relative humidity in %. (Read-only, optional) |
| **errorCode** | any integer |Fault code, `0` = no fault. (Read-only, optional) |
| **temperatureUnit** | _celsius_, _fahrenheit_ | Unit for `temperature` |
| **mode** | _auto_, _cool_, _heat_, _dry_, _fan_only_|Operation mode |
| **fanSpeed** | _auto_, _low_, _mediumLow_, _medium_, _mediumHigh_, _high_ | Fan speed |
| **swingHor** | _default_, _full_, _fixedLeft_, _fixedMidLeft_, _fixedMid_, _fixedMidRight_, _fixedRight_, _fullAlt_ | Horizontal Swing |
| **swingVert** | _default_, _full_, _fixedTop_, _fixedMidTop_, _fixedMid_, _fixedMidBottom_, _fixedBottom_, _swingBottom_, _swingMidBottom_, _swingMid_, _swingMidTop_, _swingTop_ | Vertical swing |
| **power** | _off_, _on_ | Turn device on/off |
| **health** | _off_, _on_ | Health ("Cold plasma") mode, only for devices equipped with "anion generator", which absorbs dust and kills bacteria |
| **powerSave** | _off_, _on_ | Power Saving mode |
| **lights** | _off_, _on_ | Turn on/off device lights |
| **quiet** | _off_, _mode1_, _mode2_, _mode3_ | Quiet modes |
| **blow** | _off_, _on_ | Keeps the fan running for a while after shutting down (also called "X-Fan", only usable in Dry and Cool mode) |
| **air** | _off_, _inside_, _outside_, _mode3_ | Fresh air valve |
| **sleep** | _off_, _on_ | Sleep mode |
| **turbo** | _off_, _on_ | Turbo mode |
| **safetyHeating** | _off_, _on_ | 8°C heating / freeze protection — holds an unoccupied space just above freezing |
| **antiDirectBlow** | _off_, _on_ | Keeps the air flow from blowing directly at people (optional) |
| **targetHumidity** | any integer | Target relative humidity in % (dehumidifiers, optional) |
| **waterFull** | _off_, _on_ | Water tank is full. (Read-only, dehumidifiers, optional) |
| **cleanFilter** | _off_, _on_ | Filter needs cleaning. (Read-only, dehumidifiers, optional) |

_Optional_ properties exist only on some units: the client probes for them
after connecting and only reports the ones the unit answers. To stop the unit
beeping on every command, use the `silent` option.

## Configuring HVAC WiFi

1. Make sure your HVAC is running in AP mode. You can reset the WiFi config by pressing MODE +WIFI (or MODE + TURBO) on the AC remote for 5s.
2. Connect with the AP wifi network (the SSID name should be a 8-character alphanumeric, e.g. "u34k5l166").
3. Run the following in your UNIX terminal:

```shell
echo -n "{\"psw\": \"YOUR_WIFI_PASSWORD\",\"ssid\": \"YOUR_WIFI_SSID\",\"t\": \"wlan\"}" | nc -cu 192.168.1.1 7000
````

Note: This command may vary depending on your OS (e.g. Linux, macOS, CygWin). If facing problems, please consult the appropriate netcat manual.

## API Reference
## Classes

<dl>
<dt><a href="#Client">Client</a> ⇐ <code>EventEmitter</code></dt>
<dd><p>Control GREE HVAC device by getting and setting its properties</p>
</dd>
<dt><a href="#ClientError">ClientError</a> ⇐ <code>Error</code></dt>
<dd></dd>
<dt><a href="#ClientSocketSendError">ClientSocketSendError</a> ⇐ <code><a href="#ClientError">ClientError</a></code></dt>
<dd><p>Connectivity problems while communicating with HVAC</p>
</dd>
<dt><a href="#ClientSocketError">ClientSocketError</a> ⇐ <code><a href="#ClientError">ClientError</a></code></dt>
<dd><p>The UDP socket failed (e.g. it could not be bound)</p>
</dd>
<dt><a href="#ClientMessageParseError">ClientMessageParseError</a> ⇐ <code><a href="#ClientError">ClientError</a></code></dt>
<dd><p>The message received from HVAC cannot be parsed</p>
</dd>
<dt><a href="#ClientMessageUnpackError">ClientMessageUnpackError</a> ⇐ <code><a href="#ClientError">ClientError</a></code></dt>
<dd><p>The package from the message received from HVAC cannot be decrypt</p>
</dd>
<dt><a href="#ClientUnknownMessageError">ClientUnknownMessageError</a> ⇐ <code><a href="#ClientError">ClientError</a></code></dt>
<dd><p>A message having an unknown format was received from HVAC</p>
</dd>
<dt><a href="#ClientNotConnectedError">ClientNotConnectedError</a> ⇐ <code><a href="#ClientError">ClientError</a></code></dt>
<dd><p>Request operations on not connected to the HVAC client</p>
</dd>
<dt><a href="#ClientConnectTimeoutError">ClientConnectTimeoutError</a> ⇐ <code><a href="#ClientError">ClientError</a></code></dt>
<dd></dd>
<dt><a href="#ClientCancelConnectError">ClientCancelConnectError</a> ⇐ <code><a href="#ClientError">ClientError</a></code></dt>
<dd><p>Connecting was cancelled by calling disconnect</p>
</dd>
<dt><a href="#ClientNoResponseError">ClientNoResponseError</a> ⇐ <code><a href="#ClientError">ClientError</a></code></dt>
<dd><p>The HVAC did not answer a status request within <code>pollingTimeout</code></p>
</dd>
</dl>

## Constants

<dl>
<dt><a href="#CLIENT_OPTIONS">CLIENT_OPTIONS</a> : <code>object</code></dt>
<dd><p>Client options</p>
</dd>
<dt><a href="#PROPERTY_VALUE">PROPERTY_VALUE</a></dt>
<dd><p>Device properties value constants</p>
</dd>
<dt><a href="#PROPERTY">PROPERTY</a></dt>
<dd><p>Device properties constants</p>
</dd>
</dl>

## Typedefs

<dl>
<dt><a href="#PropertyMap">PropertyMap</a> : <code>Object.&lt;PROPERTY, (PROPERTY_VALUE|number)&gt;</code></dt>
<dd></dd>
<dt><a href="#DiscoveredDevice">DiscoveredDevice</a> : <code>object</code></dt>
<dd><p>A device that answered a discovery scan</p>
</dd>
<dt><a href="#SubUnit">SubUnit</a> : <code>object</code></dt>
<dd><p>An indoor unit of a multi-split system, as listed by the outdoor unit</p>
</dd>
</dl>

<a name="Client"></a>

## Client ⇐ <code>EventEmitter</code>
Control GREE HVAC device by getting and setting its properties

**Kind**: global class  
**Extends**: <code>EventEmitter</code>  
**Emits**: [<code>connect</code>](#Client+event_connect), [<code>update</code>](#Client+event_update), [<code>error</code>](#Client+event_error), [<code>disconnect</code>](#Client+event_disconnect)  

* [Client](#Client) ⇐ <code>EventEmitter</code>
    * [new Client(options)](#new_Client_new)
    * _instance_
        * [.connect()](#Client+connect) ⇒ <code>Promise</code>
        * [.disconnect()](#Client+disconnect) ⇒ <code>Promise</code>
        * [.setProperties(properties)](#Client+setProperties) ⇒ <code>Promise</code>
        * [.setProperty(property, value)](#Client+setProperty) ⇒ <code>Promise</code>
        * [.getProperties()](#Client+getProperties) ⇒ [<code>Promise.&lt;PropertyMap&gt;</code>](#PropertyMap)
        * [.getSubUnits([options])](#Client+getSubUnits) ⇒ <code>Promise.&lt;Array.&lt;SubUnit&gt;&gt;</code>
        * [.getDeviceId()](#Client+getDeviceId) ⇒ <code>string</code> \| <code>null</code>
        * ~~[.setDebug(enable)](#Client+setDebug)~~
        * ["connect"](#Client+event_connect)
        * ["no_response" (client)](#Client+event_no_response)
        * ["success" (updated, properties)](#Client+event_success)
        * ["update" (updated, properties)](#Client+event_update)
        * ["error" (error)](#Client+event_error)
        * ["disconnect"](#Client+event_disconnect)
    * _static_
        * [.discover([options])](#Client.discover) ⇒ <code>Promise.&lt;Array.&lt;DiscoveredDevice&gt;&gt;</code>

<a name="new_Client_new"></a>

### new Client(options)
Creates a new client, connect to device and start polling by default.


| Param | Type |
| --- | --- |
| options | [<code>CLIENT\_OPTIONS</code>](#CLIENT_OPTIONS) \| <code>Object</code> | 

**Example**  
```js
const Gree = require('gree-hvac-client');

const client = new Gree.Client({host: '192.168.1.69'});
client.on('connect', () => {
    client.setProperty(Gree.PROPERTY.lights, Gree.VALUE.lights.off);
    client.setProperty(Gree.PROPERTY.temperature, 25);
});
```
<a name="Client+connect"></a>

### client.connect() ⇒ <code>Promise</code>
Connect to a HVAC device and start polling status changes by default

**Kind**: instance method of [<code>Client</code>](#Client)  
**Emits**: [<code>connect</code>](#Client+event_connect), [<code>error</code>](#Client+event_error)  
<a name="Client+disconnect"></a>

### client.disconnect() ⇒ <code>Promise</code>
Disconnect from a HVAC device and stop status polling

**Kind**: instance method of [<code>Client</code>](#Client)  
**Emits**: [<code>disconnect</code>](#Client+event_disconnect)  
<a name="Client+setProperties"></a>

### client.setProperties(properties) ⇒ <code>Promise</code>
Set a list of device properties at once by one request

**Kind**: instance method of [<code>Client</code>](#Client)  
**Emits**: [<code>success</code>](#Client+event_success), [<code>error</code>](#Client+event_error)  

| Param | Type |
| --- | --- |
| properties | [<code>PropertyMap</code>](#PropertyMap) | 

**Example**  
```js
// use library constants

const properties = {};
properties[Gree.PROPERTY.lights] = Gree.VALUE.lights.off;
properties[Gree.PROPERTY.blow] = Gree.VALUE.blow.off;
properties[Gree.PROPERTY.fanSpeed] = Gree.VALUE.fanSpeed.high;
properties[Gree.PROPERTY.temperature] = 25;
client.setProperties(properties);
```
**Example**  
```js
// use plain objects

client.setProperties({
 lights: 'off',
 blow: 'off',
 fanSpeed: 'high',
 temperature: 25
});
```
<a name="Client+setProperty"></a>

### client.setProperty(property, value) ⇒ <code>Promise</code>
Set device property

**Kind**: instance method of [<code>Client</code>](#Client)  
**Emits**: [<code>success</code>](#Client+event_success), [<code>error</code>](#Client+event_error)  

| Param | Type |
| --- | --- |
| property | [<code>PROPERTY</code>](#PROPERTY) | 
| value | [<code>PROPERTY\_VALUE</code>](#PROPERTY_VALUE) | 

**Example**  
```js
// use library constants

client.setProperty(Gree.PROPERTY.swingHor, Gree.VALUE.swingHor.fixedLeft);
client.setProperty(Gree.PROPERTY.temperature, 25);
```
**Example**  
```js
// use plain values

client.setProperty('swingHor', 'fixedLeft');
client.setProperty('temperature', 25);
```
<a name="Client+getProperties"></a>

### client.getProperties() ⇒ [<code>Promise.&lt;PropertyMap&gt;</code>](#PropertyMap)
Ask the device for its current properties now, instead of waiting for
the next poll

**Kind**: instance method of [<code>Client</code>](#Client)  
**Returns**: [<code>Promise.&lt;PropertyMap&gt;</code>](#PropertyMap) - all the properties, once the device answered  
**Throws**:

- [<code>ClientNotConnectedError</code>](#ClientNotConnectedError) when not connected (yet), or disconnected before the answer
- [<code>ClientNoResponseError</code>](#ClientNoResponseError) when the device did not answer within `pollingTimeout`

**Example**  
```js
await client.connect();
const properties = await client.getProperties();
console.log(properties.temperature, properties.currentTemperature);
```
<a name="Client+getSubUnits"></a>

### client.getSubUnits([options]) ⇒ <code>Promise.&lt;Array.&lt;SubUnit&gt;&gt;</code>
List the indoor units of a multi-split system. Connect to the outdoor
unit's WiFi module (a device that `discover()` reports with
`subUnits` > 0), then pass one of the listed MACs as the `subUnit`
option of a client per indoor unit.

**Kind**: instance method of [<code>Client</code>](#Client)  
**Returns**: <code>Promise.&lt;Array.&lt;SubUnit&gt;&gt;</code> - empty when the device is no multi-split gateway  
**Throws**:

- [<code>ClientNotConnectedError</code>](#ClientNotConnectedError) when not connected (yet)


| Param | Type | Description |
| --- | --- | --- |
| [options] | <code>object</code> |  |
| [options.timeout] | <code>number</code> | How long to wait for each of the two request forms (ms), 2000 by default |

**Example**  
```js
const gateway = new Gree.Client({host: '192.168.1.42', poll: false});
gateway.on('connect', async () => {
    const units = await gateway.getSubUnits();
    // [{mac: 'c0000001a2b3c4', mid: '...'}, ...]
    const bedroom = new Gree.Client({host: '192.168.1.42', subUnit: units[0].mac});
});
```
<a name="Client+getDeviceId"></a>

### client.getDeviceId() ⇒ <code>string</code> \| <code>null</code>
Returns devices MAC-address

**Kind**: instance method of [<code>Client</code>](#Client)  
<a name="Client+setDebug"></a>

### ~~client.setDebug(enable)~~
***Deprecated***

Override log level to `debug`
Use the client `logLevel` option instead

**Kind**: instance method of [<code>Client</code>](#Client)  

| Param | Type |
| --- | --- |
| enable | <code>Boolean</code> | 

<a name="Client+event_connect"></a>

### "connect"
Emitted when successfully connected to the HVAC, and again after every
automatic re-bind (see the `maxNoResponse` option)

**Kind**: event emitted by [<code>Client</code>](#Client)  
<a name="Client+event_no_response"></a>

### "no_response" (client)
Emitted when the HVAC did not answer a status request within
`pollingTimeout`

**Kind**: event emitted by [<code>Client</code>](#Client)  

| Param | Type |
| --- | --- |
| client | [<code>Client</code>](#Client) | 

<a name="Client+event_success"></a>

### "success" (updated, properties)
Emitted when properties successfully updated after calling setProperties or setProperty

**Kind**: event emitted by [<code>Client</code>](#Client)  

| Param | Type | Description |
| --- | --- | --- |
| updated | [<code>PropertyMap</code>](#PropertyMap) | The properties and their values that were updated |
| properties | [<code>PropertyMap</code>](#PropertyMap) | All the properties and their values managed by the Client |

<a name="Client+event_update"></a>

### "update" (updated, properties)
Emitted when properties successfully updated from HVAC (e.g. by a remote control)

**Kind**: event emitted by [<code>Client</code>](#Client)  

| Param | Type | Description |
| --- | --- | --- |
| updated | [<code>PropertyMap</code>](#PropertyMap) | The properties and their values that were updated |
| properties | [<code>PropertyMap</code>](#PropertyMap) | All the properties and their values managed by the Client |

<a name="Client+event_error"></a>

### "error" (error)
Emitted when an error happens

It is important to subscribe to the `error` event, otherwise the process will be terminated

**Kind**: event emitted by [<code>Client</code>](#Client)  

| Param | Type |
| --- | --- |
| error | [<code>ClientError</code>](#ClientError) | 

<a name="Client+event_disconnect"></a>

### "disconnect"
Emitted when disconnected from the HVAC

**Kind**: event emitted by [<code>Client</code>](#Client)  
<a name="Client.discover"></a>

### Client.discover([options]) ⇒ <code>Promise.&lt;Array.&lt;DiscoveredDevice&gt;&gt;</code>
Find GREE devices on the network: broadcast a scan and collect every
device that answers within `timeout`. Opens its own socket, so no client
(and no binding) is needed.

**Kind**: static method of [<code>Client</code>](#Client)  
**Returns**: <code>Promise.&lt;Array.&lt;DiscoveredDevice&gt;&gt;</code> - one entry per device, in order of answer  

| Param | Type | Description |
| --- | --- | --- |
| [options] | <code>object</code> |  |
| [options.host] | <code>string</code> | Address to send the scan to — your network's broadcast address. Defaults to the `host` client option. |
| [options.port] | <code>number</code> | Defaults to the `port` client option |
| [options.timeout] | <code>number</code> | How long to wait for answers (ms), 3000 by default |
| [options.logLevel] | <code>string</code> | Defaults to the `logLevel` client option |

**Example**  
```js
const devices = await Gree.Client.discover({host: '192.168.1.255'});
// [{mac: 'f4911e000001', name: '1e000001', address: '192.168.1.42', version: 'V1.1.13', pack: {...}}]

const client = new Gree.Client({host: devices[0].address});
```
<a name="ClientError"></a>

## ClientError ⇐ <code>Error</code>
**Kind**: global class  
**Extends**: <code>Error</code>  
<a name="new_ClientError_new"></a>

### new ClientError(message, origin, props)

| Param | Type |
| --- | --- |
| message | <code>string</code> | 
| origin | <code>Error</code> \| <code>undefined</code> | 
| props | <code>Object.&lt;string, unknown&gt;</code> | 

<a name="ClientSocketSendError"></a>

## ClientSocketSendError ⇐ [<code>ClientError</code>](#ClientError)
Connectivity problems while communicating with HVAC

**Kind**: global class  
**Extends**: [<code>ClientError</code>](#ClientError)  
<a name="new_ClientSocketSendError_new"></a>

### new ClientSocketSendError(cause)

| Param | Type |
| --- | --- |
| cause | <code>Error</code> | 

<a name="ClientSocketError"></a>

## ClientSocketError ⇐ [<code>ClientError</code>](#ClientError)
The UDP socket failed (e.g. it could not be bound)

**Kind**: global class  
**Extends**: [<code>ClientError</code>](#ClientError)  
<a name="new_ClientSocketError_new"></a>

### new ClientSocketError(cause)

| Param | Type |
| --- | --- |
| cause | <code>Error</code> | 

<a name="ClientMessageParseError"></a>

## ClientMessageParseError ⇐ [<code>ClientError</code>](#ClientError)
The message received from HVAC cannot be parsed

**Kind**: global class  
**Extends**: [<code>ClientError</code>](#ClientError)  
<a name="new_ClientMessageParseError_new"></a>

### new ClientMessageParseError(cause, props)

| Param | Type |
| --- | --- |
| cause | <code>Error</code> | 
| props | <code>Object.&lt;string, unknown&gt;</code> | 

<a name="ClientMessageUnpackError"></a>

## ClientMessageUnpackError ⇐ [<code>ClientError</code>](#ClientError)
The package from the message received from HVAC cannot be decrypt

**Kind**: global class  
**Extends**: [<code>ClientError</code>](#ClientError)  
<a name="new_ClientMessageUnpackError_new"></a>

### new ClientMessageUnpackError(cause, props)

| Param | Type |
| --- | --- |
| cause | <code>Error</code> | 
| props | <code>Object.&lt;string, unknown&gt;</code> | 

<a name="ClientUnknownMessageError"></a>

## ClientUnknownMessageError ⇐ [<code>ClientError</code>](#ClientError)
A message having an unknown format was received from HVAC

**Kind**: global class  
**Extends**: [<code>ClientError</code>](#ClientError)  
<a name="new_ClientUnknownMessageError_new"></a>

### new ClientUnknownMessageError(props)

| Param | Type |
| --- | --- |
| props | <code>Object.&lt;string, unknown&gt;</code> | 

<a name="ClientNotConnectedError"></a>

## ClientNotConnectedError ⇐ [<code>ClientError</code>](#ClientError)
Request operations on not connected to the HVAC client

**Kind**: global class  
**Extends**: [<code>ClientError</code>](#ClientError)  
<a name="ClientConnectTimeoutError"></a>

## ClientConnectTimeoutError ⇐ [<code>ClientError</code>](#ClientError)
**Kind**: global class  
**Extends**: [<code>ClientError</code>](#ClientError)  
<a name="ClientCancelConnectError"></a>

## ClientCancelConnectError ⇐ [<code>ClientError</code>](#ClientError)
Connecting was cancelled by calling disconnect

**Kind**: global class  
**Extends**: [<code>ClientError</code>](#ClientError)  
<a name="ClientNoResponseError"></a>

## ClientNoResponseError ⇐ [<code>ClientError</code>](#ClientError)
The HVAC did not answer a status request within `pollingTimeout`

**Kind**: global class  
**Extends**: [<code>ClientError</code>](#ClientError)  
<a name="CLIENT_OPTIONS"></a>

## CLIENT\_OPTIONS : <code>object</code>
Client options

**Kind**: global constant  
**Read only**: true  
**Properties**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| host | <code>string</code> | <code>&quot;192.168.1.255&quot;</code> | GREE device ip-address |
| port | <code>number</code> | <code>7000</code> | GREE device UDP port |
| mac | <code>string</code> \| <code>null</code> | <code>null</code> | Only bind to the device with this MAC-address (`cid`), with or without colons. Recommended when `host` is a broadcast address: the device is then rediscovered by its MAC on every reconnect, so a DHCP address change is followed automatically. |
| subUnit | <code>string</code> \| <code>null</code> | <code>null</code> | Control one indoor unit of a multi-split system: its MAC as listed by `getSubUnits()`. `host`/`mac` then address the outdoor unit's WiFi module (the gateway), which relays status and set requests to this indoor unit. |
| connectTimeout | <code>number</code> | <code>3000</code> | Reconnect to device if no success timeout |
| reconnectMaxDelay | <code>number</code> | <code>30000</code> | Upper bound for the reconnect back-off: each consecutive failed attempt doubles the wait (starting at `connectTimeout`) up to this value. Set it to `connectTimeout` to retry at a fixed rate. |
| bindTimeout | <code>number</code> | <code>1000</code> | Wait for a bind confirmation before retrying the bind with the other cipher (AES-GCM) |
| autoConnect | <code>boolean</code> | <code>true</code> | Automatically connect to device when client is created. Alternatively method `connect()` can be used. |
| poll | <code>boolean</code> | <code>true</code> | Poll device properties |
| pollingInterval | <code>number</code> | <code>3000</code> | Device properties polling interval |
| pollingTimeout | <code>number</code> | <code>1000</code> | Device properties polling timeout, emits `no_response` events in case of no response from HVAC device for a status request |
| maxNoResponse | <code>number</code> | <code>3</code> | Re-scan and re-bind the device after this many consecutive `no_response` events (the device may have dropped off WiFi, been re-paired with a new key or moved to another address). `0` disables it. |
| silent | <code>boolean</code> | <code>false</code> | Ask the unit not to beep when it receives a command (sends the `Buzzer_ON_OFF`/`BuzzerCtrl` flags with every set request; units without a controllable beeper ignore them) |
| logLevel | <code>string</code> | <code>&quot;error&quot;</code> | Logging level (debug, info, warn, error) |
| debug | <code>boolean</code> | <code>false</code> | Override logLevel to debug, deprecated, use logLevel option |

<a name="PROPERTY_VALUE"></a>

## PROPERTY\_VALUE
Device properties value constants

**Kind**: global constant  
**Read only**: true  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| power.on | <code>string</code> |  |
| power.off | <code>string</code> |  |
| mode.auto | <code>string</code> |  |
| mode.dry | <code>string</code> |  |
| mode.fan_only | <code>string</code> |  |
| mode.heat | <code>string</code> |  |
| temperatureUnit.celsius | <code>string</code> |  |
| temperatureUnit.fahrenheit | <code>string</code> |  |
| fanSpeed.auto | <code>string</code> |  |
| fanSpeed.low | <code>string</code> |  |
| fanSpeed.mediumLow | <code>string</code> | Not available on 3-speed units |
| fanSpeed.medium | <code>string</code> |  |
| fanSpeed.mediumHigh | <code>string</code> | Not available on 3-speed units |
| fanSpeed.high | <code>string</code> |  |
| air.off | <code>string</code> |  |
| air.inside | <code>string</code> |  |
| air.outside | <code>string</code> |  |
| air.mode3 | <code>string</code> |  |
| blow.off | <code>string</code> |  |
| blow.on | <code>string</code> |  |
| health.off | <code>string</code> |  |
| health.on | <code>string</code> |  |
| sleep.off | <code>string</code> |  |
| sleep.on | <code>string</code> |  |
| lights.off | <code>string</code> |  |
| lights.on | <code>string</code> |  |
| swingHor.default | <code>string</code> |  |
| swingHor.full | <code>string</code> | Swing in full range |
| swingHor.fixedLeft | <code>string</code> | Fixed in leftmost position (1/5) |
| swingHor.fixedMidLeft | <code>string</code> | Fixed in middle-left position (2/5) |
| swingHor.fixedMid | <code>string</code> | Fixed in middle position (3/5) |
| swingHor.fixedMidRight | <code>string</code> | Fixed in middle-right position (4/5) |
| swingHor.fixedRight | <code>string</code> | Fixed in rightmost position (5/5) |
| swingHor.fullAlt | <code>string</code> | Swing in full range (seems to be same as full) |
| swingVert.default | <code>string</code> |  |
| swingVert.full | <code>string</code> | Swing in full range |
| swingVert.fixedTop | <code>string</code> | Fixed in the upmost position (1/5) |
| swingVert.fixedMidTop | <code>string</code> | Fixed in the middle-up position (2/5) |
| swingVert.fixedMid | <code>string</code> | Fixed in the middle position (3/5) |
| swingVert.fixedMidBottom | <code>string</code> | Fixed in the middle-low position (4/5) |
| swingVert.fixedBottom | <code>string</code> | Fixed in the lowest position (5/5) |
| swingVert.swingBottom | <code>string</code> | Swing in the downmost region (5/5) |
| swingVert.swingMidBottom | <code>string</code> | Swing in the middle-low region (4/5) |
| swingVert.swingMid | <code>string</code> | Swing in the middle region (3/5) |
| swingVert.swingMidTop | <code>string</code> | Swing in the middle-up region (2/5) |
| swingVert.swingTop | <code>string</code> | Swing in the upmost region (1/5) |
| quiet.off | <code>string</code> |  |
| quiet.mode1 | <code>string</code> |  |
| quiet.mode2 | <code>string</code> |  |
| quiet.mode3 | <code>string</code> |  |
| turbo.off | <code>string</code> |  |
| turbo.on | <code>string</code> |  |
| powerSave.off | <code>string</code> |  |
| powerSave.on | <code>string</code> |  |
| safetyHeating.off | <code>string</code> |  |
| safetyHeating.on | <code>string</code> |  |
| antiDirectBlow.off | <code>string</code> |  |
| antiDirectBlow.on | <code>string</code> |  |
| waterFull.off | <code>string</code> |  |
| waterFull.on | <code>string</code> |  |
| cleanFilter.off | <code>string</code> |  |
| cleanFilter.on | <code>string</code> |  |

<a name="PROPERTY"></a>

## PROPERTY
Device properties constants

**Kind**: global constant  
**Read only**: true  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| power | <code>string</code> | Power state of the device |
| mode | <code>string</code> | Mode of operation |
| temperatureUnit | <code>string</code> | Temperature unit (must be together with set temperature) |
| temperature | <code>string</code> | Set temperature (must be together with temperature unit) |
| currentTemperature | <code>string</code> | Get current temperature from the internal (?) sensor (This value can not be set, only received. HVAC must support this feature otherwise the value is 0) |
| fanSpeed | <code>string</code> | Fan speed |
| air | <code>string</code> | Fresh air valve |
| blow | <code>string</code> | Keeps the fan running for a while after shutting down (also called "X-Fan", only usable in Dry and Cool mode) |
| health | <code>string</code> | Controls Health ("Cold plasma") mode, only for devices equipped with "anion generator", which absorbs dust and kills bacteria |
| sleep | <code>string</code> | Sleep mode, which gradually changes the temperature in Cool, Heat and Dry mode |
| lights | <code>string</code> | Turns all indicators and the display on the unit on or off |
| swingHor | <code>string</code> | Controls the swing mode of the horizontal air blades (not available on all units) |
| swingVert | <code>string</code> | Controls the swing mode of the vertical air blades |
| quiet | <code>string</code> | Controls the Quiet mode which slows down the fan to its most quiet speed. Not available in Dry and Fan mode |
| turbo | <code>string</code> | Sets fan speed to the maximum. Fan speed cannot be changed while active and only available in Dry and Cool mode |
| powerSave | <code>string</code> | Power saving mode |
| safetyHeating | <code>string</code> | 8 °C heating / freeze protection |
| antiDirectBlow | <code>string</code> | Keeps the air flow from blowing directly at people (not available on all units) |
| outdoorTemperature | <code>string</code> | Get the outdoor unit's temperature sensor in °C (read-only; `0` when the unit has no such sensor) |
| humidity | <code>string</code> | Get the indoor relative humidity in % (read-only; only units with a humidity sensor report it) |
| errorCode | <code>string</code> | Get the unit's fault code, `0` when there is no fault (read-only) |
| targetHumidity | <code>string</code> | Target relative humidity in % (dehumidifiers only) |
| waterFull | <code>string</code> | Get whether the water tank is full (read-only, dehumidifiers only) |
| cleanFilter | <code>string</code> | Get whether the filter needs cleaning (read-only, dehumidifiers only) |

<a name="PropertyMap"></a>

## PropertyMap : <code>Object.&lt;PROPERTY, (PROPERTY\_VALUE\|number)&gt;</code>
**Kind**: global typedef  
<a name="DiscoveredDevice"></a>

## DiscoveredDevice : <code>object</code>
A device that answered a discovery scan

**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| mac | <code>string</code> | Device MAC-address (`cid`), usable as the `mac` client option |
| name | <code>string</code> | Device name as configured in the vendor app |
| address | <code>string</code> | IP-address the device answered from, usable as the `host` client option |
| [version] | <code>string</code> | Firmware version, e.g. `V1.1.13` |
| subUnits | <code>number</code> | Number of indoor units behind it when it is the WiFi module of a multi-split outdoor unit, else `0` (list them with `getSubUnits()`) |
| pack | <code>object</code> | The full decrypted scan answer (brand, model, ...) |

<a name="SubUnit"></a>

## SubUnit : <code>object</code>
An indoor unit of a multi-split system, as listed by the outdoor unit

**Kind**: global typedef  
**Properties**

| Name | Type | Description |
| --- | --- | --- |
| mac | <code>string</code> | Indoor unit MAC-address, usable as the `subUnit` client option |
| [mid] | <code>string</code> | Model id, when the outdoor unit reports one |


## Configuration

Every client option can also be set via a `GREE_HVAC_*` environment variable.
See [`.env.example`](.env.example) for the full list and defaults.

## Development

```bash
git clone https://github.com/apachler/gree-hvac-client.git
cd gree-hvac-client
npm install        # also installs the git hook (pre-push lint)
npm test           # Jest unit tests
npm run lint       # ESLint + Prettier
npm run typecheck  # check index.d.ts against the source
npm run docs       # regenerate README.md from README.hbs
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, coding standards
and the [Gree protocol reference](docs/PROTOCOL.md).

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md). Commits follow
[Conventional Commits](https://www.conventionalcommits.org/); releases are
automated with semantic-release.

## Security

Found a vulnerability? Please follow [SECURITY.md](SECURITY.md) — do **not** open
a public issue.

## License

This project is licensed under the GNU GPLv3 - see the [LICENSE](LICENSE) file for details

## Acknowledgments

- [tomikaa87](https://github.com/tomikaa87) for reverse-engineering the Gree protocol
- [oroce](https://github.com/oroce) for inspiration
- [arthurkrupa](https://github.com/arthurkrupa) for inspiration
