# Gree HVAC protocol & property reference

Everything you need to talk to a Gree air-conditioner WiFi module. This package
(`gree-hvac-client`) is a reference implementation of the protocol; this
document is the human-readable companion to the code in [`src/`](../src).

The protocol is undocumented by the vendor; this reference is distilled from
this implementation and community reverse-engineering.

- [Transport](#transport)
- [Encryption](#encryption)
- [Message flow](#message-flow)
- [Envelope format](#envelope-format)
- [Properties](#properties)
- [Feature properties explained](#feature-properties-explained)
- [The TemSen +40 quirk](#the-temsen-40-quirk)

## Transport

- **UDP**, default port **7000**.
- Discovery is a UDP broadcast (or unicast) probe; control is unicast to the
  device IP.
- The device also answers on the same socket it received the request from.

## Encryption

Every payload except the discovery probe is an AES-encrypted JSON object,
base64-encoded into the `pack` field of a plain-JSON envelope.

| Cipher | Used by | Key (generic / pre-bind) | Notes |
| ------ | ------- | ------------------------ | ----- |
| **AES-128-ECB** | older firmware | `a3K8Bx%2r8Y7#xDh` | no IV, default PKCS#7 padding |
| **AES-128-GCM** | newer firmware | `{yxAHAY_Lm6pbC/<` | fixed nonce `0x5440784449675a516c5e6313`, AAD `qualcomm-test`, 16-byte auth tag carried in the envelope's `tag` field |

Both sides start with the **generic key**. After a successful bind the device
returns a per-device **16-character key**; both sides switch to it for all
subsequent `status`/`cmd` traffic.

This client probes **ECB first** and falls back to **GCM** on its second bind
attempt (see [`src/encryption-service.js`](../src/encryption-service.js)).

## Message flow

| Step | Client → Device | Device → Client |
| ---- | --------------- | --------------- |
| **Discover** | `{"t":"scan"}` (unencrypted) | `pack` ⇒ `{t:"dev", cid, mac, name, ...}` (generic key) |
| **Bind** | `pack` ⇒ `{t:"bind", mac, uid:0}` (generic key) | `pack` ⇒ `{t:"bindok", key:"<device key>"}` (generic key) |
| **Status** | `pack` ⇒ `{t:"status", mac, cols:[...]}` (device key) | `pack` ⇒ `{t:"dat", cols:[...], dat:[...]}` (device key) |
| **Set** | `pack` ⇒ `{t:"cmd", opt:[...], p:[...]}` (device key) | `pack` ⇒ `{t:"res", opt:[...], val:[...]}` (device key) |

- **status** requests a list of vendor property codes in `cols`; the device
  replies with parallel arrays `cols`/`dat` (code → value).
- **cmd** sets properties: `opt` holds vendor codes, `p` the new values; the
  device echoes them back in `res` (`opt`/`val`).
- **Discovery:** a broadcast `scan` is answered by every device on the
  network, each with its own `dev` reply (`cid`/`mac`, `name`, firmware `ver`,
  brand, model). `Client.discover()` collects them; some firmwares leave
  `cid`/`mac` empty in the `dev` pack and only the envelope's `cid` has it.
  A multi-split gateway adds `subCnt`, the number of its indoor units.

## Multi-split systems

On a multi-split (VRF) system the WiFi module of the outdoor unit is the only
device on the network — the gateway. It is scanned and bound like any unit and
reports `subCnt` > 0 in its `dev` reply. The format below follows the
[Home Assistant Gree integration](https://github.com/RobHofmann/HomeAssistant-GreeClimateComponent)
(`gree_protocol.py`, `climate.py`) and
[greeclimate#148](https://github.com/cmroche/greeclimate/pull/148); this
project has not verified it on hardware.

| Step | Client → Gateway | Gateway → Client |
| ---- | ---------------- | ---------------- |
| **List indoor units** | envelope `t:"pack"`, `i:0`, `tcid:<gateway>`; `pack` ⇒ `{t:"subList", mac:<gateway>, i:0}` (device key) | `pack` ⇒ `{t:"subList", c, list:[{mac, mid?}, ...]}` (device key) |
| ↳ fallback (AES-ECB modules) | envelope `t:"subList"`, `i:1`, `tcid:<gateway>`; `pack` ⇒ `{mac:<gateway>, i:1}` (generic key) | `pack` ⇒ `{list:[...]}` (generic key) |
| **Status** | envelope `tcid:<gateway>`; `pack` ⇒ `{t:"status", mac:<indoor unit>, cols}` | `dat` as usual |
| **Set** | envelope `tcid:<gateway>`; `pack` ⇒ `{t:"cmd", opt, p, sub:<indoor unit>}` | `res` as usual |

Modules differ in which form of the list request they answer, so
`getSubUnits()` tries the device-key form and then (on AES-ECB modules) the
generic-key one. With the `subUnit` option the client addresses status and
set requests to that indoor unit as above. Indoor-unit MACs can be longer
than 12 hex digits. Upstream
[inwaar#30](https://github.com/inwaar/gree-hvac-client/issues/30) reports a
gateway that answered status requests carrying the indoor unit in `sub`
(instead of the pack `mac`) with zeros, while commands worked.

## Envelope format

The outer, always-plain-JSON envelope:

```json
{
  "t": "pack",
  "i": 0,
  "uid": 0,
  "cid": "app",
  "tcid": "",
  "pack": "<base64 AES(JSON payload)>",
  "tag": "<base64 GCM auth tag — GCM only>"
}
```

- `i`: `1` during the handshake (scan/bind), `0` for status/cmd.
- `cid`: `"app"` from the client; the device's MAC/cid on responses.
- `pack`: the encrypted inner payload described in the flow table above.
- `tag`: present only for AES-GCM.

## Properties

Friendly name ⇄ vendor code mapping and value enums, as exposed by
`Gree.PROPERTY` and `Gree.VALUE`. Numbers are the raw on-the-wire values (see
[`src/property-transformer.js`](../src/property-transformer.js) and
[`src/property-vendor-value.js`](../src/property-vendor-value.js)).

| Friendly name | Vendor code | Values (friendly → raw) | Meaning |
| ------------- | ----------- | ----------------------- | ------- |
| `power` | `Pow` | off→0, on→1 | Unit on/off. |
| `mode` | `Mod` | auto→0, cool→1, dry→2, fan_only→3, heat→4 | Operating mode. |
| `temperature` | `SetTem` (+ `TemRec`) | integer °C or °F | Target setpoint, in `temperatureUnit`. Always °C on the wire; see [Fahrenheit setpoints](#fahrenheit-setpoints-temrec). |
| `temperatureUnit` | `TemUn` | celsius→0, fahrenheit→1 | Unit for `temperature`. |
| `currentTemperature` | `TemSen` | integer (see quirk below) | **Read-only** internal sensor. `0` = unsupported. |
| `fanSpeed` | `WdSpd` | auto→0, low→1, mediumLow→2, medium→3, mediumHigh→4, high→5 | Fan speed. `mediumLow`/`mediumHigh` are absent on 3-speed units. |
| `air` | `Air` | off→0, inside→1, outside→2, mode3→3 | Fresh-air valve (see below). |
| `blow` | `Blo` | off→0, on→1 | "X-Fan" post-run fan dry (see below). |
| `health` | `Health` | off→0, on→1 | "Cold plasma" anion generator (see below). |
| `sleep` | `SwhSlp` (+ `SlpMod`) | off→0, on→1 | Sleep mode — written as a pair (see below). |
| `lights` | `Lig` | off→0, on→1 | Unit display / indicator LEDs. |
| `swingHor` | `SwingLfRig` | default→0, full→1, fixedLeft→2, fixedMidLeft→3, fixedMid→4, fixedMidRight→5, fixedRight→6, fullAlt→7 | Horizontal louver position/swing (not on all units). |
| `swingVert` | `SwUpDn` | default→0, full→1, fixedTop→2, fixedMidTop→3, fixedMid→4, fixedMidBottom→5, fixedBottom→6, swingBottom→7, swingMidBottom→8, swingMid→9, swingMidTop→10, swingTop→11 | Vertical louver position/swing. |
| `quiet` | `Quiet` | off→0, mode1→1, mode2→2, mode3→3 | Quiet mode (see below). |
| `turbo` | `Tur` | off→0, on→1 | Turbo / jet (see below). |
| `powerSave` | `SvSt` | off→0, on→1 | Power-saving / eco (see below). |
| `safetyHeating` | `StHt` | off→0, on→1 | 8 °C freeze-protection heating (see below). |
| `antiDirectBlow` | `AntiDirectBlow` | off→0, on→1 | Keeps the air flow off people. Optional (see below). |
| `outdoorTemperature` | `OutEnvTem` | integer, `−40` offset | **Read-only** outdoor-unit sensor in °C. `0` = unsupported. Optional. |
| `humidity` | `DwatSen` | integer % | **Read-only** indoor relative humidity. Optional. |
| `errorCode` | `AllErr` | integer | **Read-only** fault code, `0` = no fault. Optional. |
| `targetHumidity` | `Dwet` | integer % | Target humidity. Dehumidifiers send a plain %; air conditioners with humidity control (e.g. Airy Pro) encode it as % = 5 × `Dwet` + 15, i.e. `Dwet` = (% − 15) / 5 ([RobHofmann#473](https://github.com/RobHofmann/HomeAssistant-GreeClimateComponent/issues/473)) — set the `encodedTargetHumidity` option for those. Optional. |
| `waterFull` | `DwatFul` | off→0, on→1 | **Read-only** dehumidifier water tank full. Optional. |
| `cleanFilter` | `Dfltr` | off→0, on→1 | **Read-only** dehumidifier filter needs cleaning. Optional. |
| `humidityMode` | `Dmod` | off→15, target→0, continuous→1, smart→2 | Humidity control of air conditioners that have it: keep `targetHumidity`, dry continuously (Dry mode only) or smart dry (Cool mode only). Dehumidifiers use `Dmod` differently (greeclimate: 0 default, 9 anion only), so unknown values pass through as numbers. Optional. |
| `lightSensor` | `LigSen` | off→1, on→0 (inverted) | Display brightness follows the room light. It only acts with the display on, so turning it on also sends `Lig` 1 unless `lights` is set too. Optional. |
| — | `Add0.5` | 0/1 | Half-degree bit of a °C setpoint on some firmwares; see [Half-degree setpoints](#half-degree-setpoints-add05). |

### Optional properties

`antiDirectBlow`, `outdoorTemperature`, `humidity`, `errorCode`,
`humidityMode`, `lightSensor` and the dehumidifier codes (`targetHumidity`,
`waterFull`, `cleanFilter`; names from
[greeclimate](https://github.com/cmroche/greeclimate)'s `Props`) exist only
on some units. A unit without the feature may answer a status request for one
of these codes with an empty `dat`, so the client doesn't put them in every
poll: after each bind it sends one `status` request per code, and polls a code
from then on only if the unit answered it with a value. Until then the
property is simply absent from `update` events.

### Status batching

Some firmwares stop answering a `status` request that asks for too much:
`U-CS532Z(LT)V3.75` answers 29 columns, returns nothing useful for 30 and
goes silent from 31, and replies stop at about 800 bytes; a cut-short reply
can carry a column with an empty name
([RobHofmann 5.0 protocol notes](https://github.com/RobHofmann/HomeAssistant-GreeClimateComponent/blob/5.0-dev/docs/protocol.md)).
greeclimate polls 20 columns per request. The client splits each poll into
requests of at most `statusBatchSize` (20) codes and takes the poll as
answered once every batch is; columns without a name are dropped.

Status answers carry no request id, so the client matches each one to the
oldest pending request (poll batch, probe or query) that asked for all of its
columns; an answer that matches none counts as the answer to the poll.

### Firmware id (`hid`)

After the probes the client asks once for the `hid` status column, e.g.
`362001000762+U-CS532AE(LT)V3.31.bin`: firmware code, WiFi module type and
version. `getDeviceInfo()` reports it, and warns for firmware codes whose
later builds were found to be cloud-only (no local control at all), from
[greeclimate's list](https://github.com/cmroche/greeclimate/blob/master/docs/CLOUD_ONLY_FIRMWARE.md)
— upgrading those modules can end local control for good. Some units report
`hid` in the scan answer already; others not at all.

### Raw vendor codes, clock and name

`getVendorProperties(codes)` / `setVendorProperties({code: value})` read and
write any code raw — the way to reach codes this client has no property for,
such as `UvcControl`, `AutoClean`, `ChildLock`, `CompressorFqy` or the
air-to-water heat-pump codes (`HeWatOutTemSet`, ...), whose meaning is only
partly known. The clock is the `time` column (`YYYY-MM-DD HH:MM:SS`, local
time; set with a `cmd` carrying `sub`, per
[gree-remote](https://github.com/tomikaa87/gree-remote#synchronizing-the-time-on-the-device)),
the device name the `name` column.

Not implemented on purpose:

- **Schedules** (`t:"setT"`): the vendor app deletes schedules it did not
  create, and frequent schedule queries are reported to stall units
  ([gree-remote#70](https://github.com/tomikaa87/gree-remote/issues/70)).
- **Changing the cloud server** (`host`): it breaks the vendor app, and the
  dummy-server approach reportedly fails from firmware 1.31 on.
- **Firmware upgrades** (`t:"upgrade"`): an upgrade can switch a module to
  cloud-only firmware (see above).

### External temperature sensor (iFeel)

There is no known way to feed an external temperature to the unit over the
LAN protocol. "iFeel" (the unit regulating on a sensor in the remote) is
sent by the IR remote only, and any WiFi command switches it off again
([RobHofmann#283](https://github.com/RobHofmann/HomeAssistant-GreeClimateComponent/issues/283),
[home-assistant/core#118221](https://github.com/home-assistant/core/issues/118221)).
`TemSen` is read-only. The workaround is a software thermostat: compare the
external sensor with the target and shift `temperature` (or switch `power`)
accordingly.

### Beeper

The beeper is not device state but a flag sent with each `cmd`: older
firmwares read `Buzzer_ON_OFF` (`1` = silent), newer ones `BuzzerCtrl`
(`0` = silent). With the `silent` client option set, the client adds both to
every set request; otherwise it sends neither and the unit beeps as usual.

## Feature properties explained

The on/off "feature" toggles are hardware-dependent — a unit silently ignores
ones it doesn't have.

- **air** — *Fresh-air valve.* Opens a damper to exchange room air with
  outside air (`inside` / `outside` / `mode3` select the exchange path).
  Only on units with a fresh-air intake.
- **blow** — *"X-Fan".* Keeps the indoor fan running for a few minutes after
  you switch the unit off, to dry condensation off the evaporator coil and
  prevent mold/odor. Only meaningful in **Cool** and **Dry**.
- **health** — *"Cold plasma" / anion generator.* An ionizer that helps trap
  dust and neutralize bacteria. Only on equipped units.
- **sleep** — *Sleep / night mode.* Gradually drifts the setpoint over time
  (warmer in Cool, cooler in Heat/Dry) for overnight comfort and efficiency.
  Many units gate this behind a **pair** of vendor fields — `SwhSlp` (the
  switch) and `SlpMod` (the mode) — that must move together: `(0,0)` to
  disable, `(1,1)` to enable. Writing only `SwhSlp` leaves `SlpMod` set, so the
  unit silently keeps sleeping and `{sleep:'off'}` appears to do nothing. The
  client therefore writes both codes from the single friendly `sleep` property
  and reads `SwhSlp` back as the canonical value.
- **lights** — Turns the unit's display and indicator LEDs on/off (handy in a
  bedroom). Does not affect operation.
- **quiet** — *Quiet mode.* Slows the fan to its quietest speeds
  (`mode1`–`mode3` are progressively quieter/different profiles). Not
  available in **Dry** or **Fan-only**.
- **turbo** — *Turbo / jet.* Runs the fan at maximum to reach the setpoint
  quickly. Fan speed is locked while active; only available in **Cool** and
  **Dry**.
- **powerSave** — *Power-saving / eco mode.* Caps power draw with a gentler
  compressor/fan duty cycle.
- **safetyHeating** (`StHt`) — *8 °C heating / freeze protection.* Holds the
  room just above freezing (~8 °C) — used to keep an unoccupied space from
  freezing without heating it to a comfort temperature.

## Fahrenheit setpoints (`TemRec`)

`SetTem` is the setpoint in **whole °C**, also when the unit displays °F
(`TemUn` = 1). One °F step is only 0.56 °C, so two whole-°F values round to the
same °C — 75 °F and 76 °F are both 24 °C. The `TemRec` bit tells them apart
(formula from [tomikaa87/gree-remote](https://github.com/tomikaa87/gree-remote)):

```text
c       = (°F − 32) × 5 / 9
SetTem  = round(c)
TemRec  = 1 if c > SetTem, else 0
```

The client does this for you when the unit is in °F — set in the same call
via `temperatureUnit`, or else the unit's current `TemUn`: `temperature` is
then in °F, sent as `SetTem` + `TemRec` + `TemUn`, and decoded back to °F in
`update`/`success` events. A °C setpoint is sent as `SetTem` alone, as before.
A `SetTem` above 40 while in °F is taken as already being °F, since some
firmwares report it that way.

## Half-degree setpoints (`Add0.5`)

Some Celsius firmwares take half degrees: `SetTem` 23 + `Add0.5` 1 is
23.5 °C. Others ignore `Add0.5`, and some use `TemRec` for it instead, so it
is opt-in (`halfDegree` option, as in the RobHofmann integration): the client
then polls `Add0.5`, sends `SetTem` = ⌊t⌋ + `Add0.5` = 1 for a .5 setpoint,
and reports `temperature` with the half degree. °F setpoints keep using
`TemRec`.

## WiFi setup (AP mode)

A unit whose WiFi was reset (MODE + WIFI, or MODE + TURBO, on the remote for
5 s) opens its own access point, named after the last digits of its MAC,
password usually `12345678`. Joined to it, send this **unencrypted** to
`192.168.1.1:7000`:

```json
{"psw": "<password>", "ssid": "<network>", "t": "wlan"}
```

The unit answers `{"t":"ret","r":200}` (some add `mac`, some send nothing)
and joins the network
([gree-remote#29](https://github.com/tomikaa87/gree-remote/issues/29)). Some
firmwares take passwords of at most 31 characters. The unit gets a new device
key, so it has to be bound again. A unit that is already on a network cannot
be moved to another one remotely: reset it on the remote first.
`Client.configureWifi()` sends the packet.

## The TemSen +40 quirk

`currentTemperature` (`TemSen`) is reported **offset by +40**: the real
temperature is `TemSen − 40`. This is widely understood to be because the
field is an unsigned type and the offset avoids negative values. A value of
**`0` means the unit has no internal sensor / does not support the reading** —
clients should treat `0` as "unavailable", not as −40 °C.

```text
real °C  = TemSen − 40        (when TemSen ≠ 0)
TemSen   = real °C + 40       (to encode)
```

### Firmware variants (the −9 °C bug)

Not every firmware applies the offset. Some report `TemSen` **already in real
°C**, so the blind `TemSen − 40` yields an impossible reading — a 31 °C room
arrives as `31` and decodes to `31 − 40 = −9 °C` (the exact value reported in
upstream `inwaar/node-red-contrib-gree-hvac#10`). This client guards against it:
an internal sensor never legitimately reads below **0 °C** in service, so when
subtracting the offset would drop below that floor, the raw value is treated as
already-real and passed through unchanged. `0` stays "unavailable".

```text
decoded = TemSen − 40
real °C = decoded            (when decoded ≥ 0)
real °C = TemSen             (when decoded < 0 — firmware did not offset)
real °C = 0 (unavailable)    (when TemSen = 0)
```

To diagnose a unit's behaviour, run at `logLevel: "debug"`: each status response
logs the **raw `TemSen`** alongside the decoded value.

This client applies the rule in
[`src/property-transformer.js`](../src/property-transformer.js)
(`decodeCurrentTemperature`): `TemSen` is decoded to the real temperature on the
way out, and `currentTemperature` is read-only (attempting to set it throws).

---

This document is the human-readable companion to the implementation in
[`src/property-transformer.js`](../src/property-transformer.js) (codes/values),
[`src/encryption-service.js`](../src/encryption-service.js) (encryption) and
[`src/client.js`](../src/client.js) (message flow).
