# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

`gree-hvac-client` — a Node.js library that controls Gree air-conditioners over
their UDP/AES LAN protocol. It is the protocol client that downstream
integrations (e.g. `node-red-contrib-gree-hvac`, Home Assistant add-ons) build
on. Pure library: no CLI, no server, no UI.

## Layout

```
index.js                     entry — re-exports src/client
index.d.ts                   hand-written TypeScript types (`npm run typecheck` checks them)
src/
  client.js                  the Client class: discover/bind/poll, get/set properties (EventEmitter)
  client-options.js          option defaults + GREE_HVAC_* env overrides
  firmware.js                hid parsing + known cloud-only firmware table
  encryption-service.js      AES-ECB (default) + AES-GCM cipher; the bind key exchange
  property.js                PROPERTY (friendly property names)
  property-value.js          VALUE / PROPERTY_VALUE (friendly value enums)
  property-vendor-value.js   vendor-side value maps
  property-transformer.js    friendly ↔ vendor name/value translation
  errors.js                  ClientError subclasses
  logger.js                  Winston logger
test/                        Jest specs; test/support/ has the dgram mock, device fixtures
                             and fake-unit.js (a fake unit on a real UDP socket)
test/types/usage.ts          compile-time checks of index.d.ts (never run)
example/                     usage scripts; probe.js is a hardware check shipped in the package
docs/PROTOCOL.md             the wire protocol and every vendor code
README.hbs                   Handlebars template; README.md is GENERATED from it
```

Public API (`require('gree-hvac-client')`): `Client`, `PROPERTY`, `VALUE`, and
the error classes from `src/errors.js`. **Changing the API or adding a
property/option/error means updating `index.d.ts` too**; `npm run typecheck`
(CI lint job) fails when its `PROPERTY`/`VALUE` keys drift from the source,
and `test/types/usage.ts` holds the compile-time usage checks.

## Daily commands

```
npm test               # Jest unit tests
npm run test:coverage  # Jest with coverage summary
npm run lint           # ESLint + Prettier
npm run lint:fix       # auto-fix
npm run typecheck      # tsc: index.d.ts vs. the source
npm run lint:lockfile  # lockfile-lint: registry host, HTTPS, package names
npm run docs           # regenerate README.md from README.hbs + JSDoc (scripts/docs.js)
npm run audit          # npm audit on prod deps, fail on HIGH/CRITICAL

npx jest test/connection-recovery.spec.js   # one spec file
npx jest -t "re-bind"                       # tests whose name matches
```

**Node version:** ESLint (and so the pre-push hook) needs Node ≥ 20.19 —
`eslint-plugin-jsdoc` is ESM-only and Node 18 cannot `require()` it. `.nvmrc`
pins 20, so `nvm use` first. The library and its tests still support Node 18.

## Conventions

- **Node 18+** (`engines.node`); CI matrix runs 18/20/22/24.
- **Tests:** Jest, in `test/`. `test/support/device.js` mocks the UDP device
  (tests use fake timers), so no hardware is needed. Add a test with new behaviour.
- **Style:** ESLint + Prettier — single quotes, 4-space JS, 2-space JSON/YAML.
  The pre-push hook runs `eslint --fix`; `GREE_SKIP_LINT=1 git push` to skip.
  The commit-msg hook enforces Conventional-Commit subjects (Merge/Revert/
  fixup! pass; `GREE_SKIP_LINT=1` skips).
- **README is generated.** Edit prose in `README.hbs`; the API section is JSDoc
  from `src/*.js`. Run `npm run docs` and commit `README.md` — the `docs`
  workflow fails CI if it's stale.

## Client behaviour worth knowing

- Constructor **auto-connects and starts polling by default** (`autoConnect`,
  `poll`). Options can be set via the constructor or `GREE_HVAC_*` env vars
  (see `client-options.js`).
- Events: `connect`, `update` (state changed on the device, e.g. by a remote),
  `success` (a set we issued was confirmed), `no_response`, `error`, `disconnect`.
  **Always attach an `error` handler** — an unhandled `error` event terminates
  the process (Node EventEmitter semantics).
- `setProperty` / `setProperties` take friendly `PROPERTY` keys and `VALUE`
  enums (or their raw vendor numbers; numeric strings become numbers). Anything
  else — unknown/read-only properties, other values, out-of-range setpoints —
  throws `ClientInvalidPropertyError` before anything is sent.
  `PropertyTransformer` maps them to/from the vendor wire names. It is
  built with the client options (`halfDegree`, `encodedTargetHumidity` change
  the encoding) and `toVendor`/`fromVendor` take the current vendor properties
  as `state`: a °F `temperature` is `SetTem` (°C) + `TemRec`, a half °C one
  `SetTem` + `Add0.5`, and either may come in a different packet than `SetTem`.
- Optional codes (`OPTIONAL_VENDOR_CODES`) exist only on some units: probed
  one per request after each bind, polled only once answered. Then the `hid`
  (firmware id) is queried once.
- `Client.discover()` and `Client.configureWifi()` are static and open their
  own socket (no bind).
- `getSubUnits()` keeps one pending `subList` request in `_subListRequest`
  (its timer is not one of the timer refs below; `_dispose()` settles it).
- Every `cmd` goes through `_sendCommand()`, which keeps `commandInterval` ms
  between commands (queue + `_commandTimerRef`). Specs that send several
  commands in a row with fake timers must advance the clock or set
  `commandInterval: 0`.
- Multi-split (`subUnit` option): envelope gets `tcid:<gateway cid>`, status
  packs name the indoor unit in `mac`, cmd packs in `sub`. Unverified on
  hardware — see docs/PROTOCOL.md.
- `example/probe.js` ships in the package (hardware check for users); it reads
  client internals on purpose.
- **Adding an option** touches `CLIENT_OPTIONS` + `ENV_OPTIONS` in
  `client-options.js` (env strings are coerced to the default's type),
  `.env.example`, the inline snapshot in `test/client-options.spec.js`,
  `ClientOptions` in `index.d.ts`, then `npm run docs`.
- **Adding a property** touches `property.js` (name + JSDoc),
  `property-value.js` and `property-vendor-value.js` (value maps, also `{}`
  for numeric ones), `PROPERTY_VENDOR_CODES` in `property-transformer.js`
  (plus `OPTIONAL_VENDOR_CODES` if not every unit has it, `readOnly()` if it
  can't be set), `PROPERTY`/`VALUE` in `index.d.ts`, and the property tables
  in `README.hbs` and `docs/PROTOCOL.md`.

## Status requests and their answers

A status answer carries no request id. `_statusRequests` holds what is
pending — `poll` batches, `probe`s, `query`s (getVendorProperties, getClock,
the `hid` query) — and `_matchStatusRequest` gives an answer to the oldest
request that asked for all of its columns. An answer **without columns** goes
to the oldest probe/query (units answer unknown codes that way; taking it for
the poll's would hide a unit that stopped answering polls); any other
unmatched answer counts as the poll's. Polls are split into `statusBatchSize`
batches, and the status timeout clears (and `getProperties()` waiters resolve)
only once every batch is answered. Query timers live on the request;
`_dispose()` clears them and rejects the queries.

Once bound, `_handleResponse` drops messages from any address but the unit's
(`_deviceAddress`). Logs pass through a redacting format in `logger.js`:
fields named `key`, `psw` or `password` never reach the output.

## Connection lifecycle (`client.js` + `encryption-service.js`)

- `_initialize()` starts every (re)connect: fresh `EncryptionService`, scan to
  `host`, arm the connect timeout. A `dev` reply → bind, sent to the address
  the device answered from (`mac` pins one device on a broadcast `host`).
  Bind attempt 1 uses the active cipher; after `bindTimeout` attempt 2 forces
  GCM. `bindok` sets the device key and starts status polling.
- Back to `_initialize()` on a connect timeout (exponential back-off up to
  `reconnectMaxDelay`) or after `maxNoResponse` consecutive `no_response`
  events — the device may be back with a new key (re-paired) or address.
- `decrypt` tries the active cipher, then the other, and makes whichever
  works active — so a GCM scan reply means a GCM bind on attempt 1. Once
  bound, late generic-key `dev`/`bindok` replies are dropped via
  `decryptGeneric`, not reported as errors.
- Five timer refs (`_socketTimeoutRef`, `_bindTimeoutRef`, `_statusIntervalRef`,
  `_statusTimeoutRef`, `_commandTimerRef`): set them only after `_clearTimer()`,
  and `_dispose()` clears all (and rejects queued commands). Overwriting a ref strands a timer `disconnect()` can't reach.
- `disconnect()` can race any `await`: re-check `this._socket` after awaits.
  Promises started from timers or the message handler must be caught and
  emitted as `error` — an unhandled rejection kills the host process.

## Test gotchas

- `test/end-to-end.spec.js` is the one spec without `jest.mock('dgram')`: it
  runs the client against `test/support/fake-unit.js` over real UDP on
  127.0.0.1 (random port, real timers). Add a case there for anything that
  changes the wire format.
- `test/fuzz.spec.js` holds fast-check property tests: arbitrary bytes, JSON
  and encrypted packs into `_handleResponse` must only ever fail with a
  `ClientError`. A counterexample is printed with its seed to replay.
- Coverage floors in `jest.config.js` sit just below the actual numbers
  (≈99.8% lines): new code needs tests or `npm run test:coverage` fails.
- Specs mock `dgram` with `test/support/socket-mock.js`. Capture only the
  `'message'` listener (`on: (event, cb) => event === 'message' && …`) — the
  client registers an `'error'` listener too.
- `device.bind(cipher)` switches that cipher instance to the device key: reuse
  the same instance for `device.status(cipher)`.
- `jest.getTimerCount()` also counts winston's `setImmediate` writes once
  something logs at `error`; assert on the client's timer refs or on "nothing
  more sent" instead.

## Gree protocol

Full spec (transport, encryption, every property + value, the TemSen +40
quirk): **[`docs/PROTOCOL.md`](docs/PROTOCOL.md)**. Key points:

- Transport is UDP on port **7000**. Discovery + bind use **vendor-fixed generic
  keys**: ECB `a3K8Bx%2r8Y7#xDh`, GCM `{yxAHAY_Lm6pbC/<`. After `bindok` both
  sides switch to a per-device key. These generic keys are public protocol
  constants, not secrets (see [SECURITY.md](SECURITY.md)).
- Cipher defaults to AES-ECB; AES-GCM is supported for newer firmware — both
  auto-detected from the scan reply and probed on the second bind attempt.

## Releasing

Fully automated via **semantic-release** (`release.yml` on push to `master`,
config in `.releaserc.json`). It reads Conventional-Commit history, computes the
next version, updates `CHANGELOG.md` + `package.json` and commits them back with
`[skip ci]` (so the bot commit doesn't re-trigger a release — only your merges
do), creates the **git tag** and the **GitHub Release**, and attaches the packed
`.tgz`. **This fork does not publish to npm** — `@semantic-release/npm` runs with
`npmPublish: false` only to bump the version and pack the tarball. **Do not
hand-edit `version` or `CHANGELOG.md`** — semantic-release owns them.

`feat` → minor, `fix` → patch, `build(deps-dev)` (Dependabot) → no release.
`master` is the only branch: work on a feature branch, squash-merge the PR.

The `master` ruleset blocks deletion and force-pushes and requires a PR with
passing CI; repo admins bypass it. semantic-release's commit-back gets through
only because it runs as the owner via the `RELEASE_TOKEN` secret (fine-grained
PAT, `release` environment) — the built-in `GITHUB_TOKEN` can't bypass rulesets
on a user-owned repo. **When that PAT expires, releases fail** at the
"Check RELEASE_TOKEN" step or on push; rotate the secret.

After a release the same job signs build provenance for the tarball
(`actions/attest-build-provenance`, verify with `gh attestation verify`) and
uploads it as `<tgz>.sigstore.json`, plus a CycloneDX SBOM (`npm sbom`).
`badges.yml` publishes the README coverage badge: it force-pushes
`coverage.json` (a shields.io endpoint file) to the orphan `badges` branch
via `RELEASE_TOKEN` — don't delete that branch or protect it.

Consumers install the tarball asset (`npm install <release>/…tgz`) or a Git ref
(`github:apachler/gree-hvac-client#vX.Y.Z`) — see the README.

## Gotchas

- The npm name `gree-hvac-client` belongs to the upstream project (inwaar); this
  fork (`apachler/gree-hvac-client`) is **not** published to npm and is consumed
  via Git/GitHub Releases. The `repository`/`bugs`/`homepage` fields point here.
- `package-lock.json` and `README.md` are marked `linguist-generated` in
  `.gitattributes` — `README.md` is regenerated, don't hand-edit it.
- Workflow triggers: CI runs on every push/PR; releases only on push to master.
- With the `upstream` remote (inwaar) present, bare `gh` commands resolve to
  the upstream repo. The SessionStart hook (`scripts/set-git-identity.sh`)
  pins the fork as gh's default; if `gh repo set-default --view` still shows
  inwaar, run `gh repo set-default apachler/gree-hvac-client`. Passing
  `-R apachler/gree-hvac-client` is the safe habit either way.
- jsdoc's type parser rejects TypeScript-only syntax such as optional members
  (`{{a?: string}}`): use `{object}` and describe the fields. `npm run docs`
  (`scripts/docs.js`) then fails and leaves `README.md` untouched.
- CI installs with `npm ci --ignore-scripts` (no dependency install scripts)
  and every job starts with `step-security/harden-runner` in audit mode: its
  run summary lists the outbound connections. A new dev dependency that
  needs an install script will break CI — check first.
