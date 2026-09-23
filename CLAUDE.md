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
src/
  client.js                  the Client class: discover/bind/poll, get/set properties (EventEmitter)
  client-options.js          option defaults + GREE_HVAC_* env overrides
  encryption-service.js      AES-ECB (default) + AES-GCM cipher; the bind key exchange
  property.js                PROPERTY (friendly property names)
  property-value.js          VALUE / PROPERTY_VALUE (friendly value enums)
  property-vendor-value.js   vendor-side value maps
  property-transformer.js    friendly ↔ vendor name/value translation
  errors.js                  ClientError subclasses
  logger.js                  Winston logger
test/                        Jest specs; test/support/ has the device mock + fixtures
example/                     runnable usage scripts (promises, async-await, poll-status, set-properties)
README.hbs                   Handlebars template; README.md is GENERATED from it
```

Public API (`require('gree-hvac-client')`): `Client`, `PROPERTY`, `VALUE`.

## Daily commands

```
npm test               # Jest unit tests
npm run test:coverage  # Jest with coverage summary
npm run lint           # ESLint + Prettier
npm run lint:fix       # auto-fix
npm run docs           # regenerate README.md from README.hbs + JSDoc (jsdoc2md)
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
  enums; the transformer maps them to/from the vendor wire names.
- **Adding an option** touches `CLIENT_OPTIONS` + `ENV_OPTIONS` in
  `client-options.js` (env strings are coerced to the default's type),
  `.env.example`, the inline snapshot in `test/client-options.spec.js`, then
  `npm run docs`.

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
- Four timer refs (`_socketTimeoutRef`, `_bindTimeoutRef`, `_statusIntervalRef`,
  `_statusTimeoutRef`): set them only after `_clearTimer()`, and `_dispose()`
  clears all. Overwriting a ref strands a timer `disconnect()` can't reach.
- `disconnect()` can race any `await`: re-check `this._socket` after awaits.
  Promises started from timers or the message handler must be caught and
  emitted as `error` — an unhandled rejection kills the host process.

## Test gotchas

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

Consumers install the tarball asset (`npm install <release>/…tgz`) or a Git ref
(`github:apachler/gree-hvac-client#vX.Y.Z`) — see the README.

## Gotchas

- The npm name `gree-hvac-client` belongs to the upstream project (inwaar); this
  fork (`apachler/gree-hvac-client`) is **not** published to npm and is consumed
  via Git/GitHub Releases. The `repository`/`bugs`/`homepage` fields point here.
- `package-lock.json` and `README.md` are marked `linguist-generated` in
  `.gitattributes` — `README.md` is regenerated, don't hand-edit it.
- Workflow triggers: CI runs on every push/PR; releases only on push to master.
