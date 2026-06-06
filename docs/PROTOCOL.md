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
| `temperature` | `SetTem` | integer °C or °F | Target setpoint (send with `temperatureUnit`). |
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

This client applies the offset in
[`src/property-transformer.js`](../src/property-transformer.js): `TemSen` is
decoded to the real temperature on the way out, and `currentTemperature` is
read-only (attempting to set it throws).

---

This document is the human-readable companion to the implementation in
[`src/property-transformer.js`](../src/property-transformer.js) (codes/values),
[`src/encryption-service.js`](../src/encryption-service.js) (encryption) and
[`src/client.js`](../src/client.js) (message flow).
