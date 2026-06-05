# CLAUDE.md

Guidance for Claude Code sessions in this repo.

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
```

## Conventions

- **Node 16+** (`engines.node`); CI matrix also runs 18/20/22.
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

## Gree protocol

Full spec (transport, encryption, every property + value, the TemSen +40
quirk): **[`docs/PROTOCOL.md`](docs/PROTOCOL.md)**. Key points:

- Transport is UDP on port **7000**. Discovery + bind use **vendor-fixed generic
  keys**: ECB `a3K8Bx%2r8Y7#xDh`, GCM `{yxAHAY_Lm6pbC/<`. After `bindok` both
  sides switch to a per-device key. These generic keys are public protocol
  constants, not secrets (see [SECURITY.md](SECURITY.md)).
- Cipher defaults to AES-ECB; AES-GCM is supported for newer firmware (the
  client probes ECB first, GCM on the second bind attempt).

## Releasing

Fully automated via **semantic-release** (`release.yml` on push to `master`,
config in `.releaserc.json`). It reads Conventional-Commit history, computes the
next version, updates `CHANGELOG.md` + `package.json` and commits them back with
`[skip ci]` (so the bot commit doesn't re-trigger a release — only your merges
do), creates the **git tag** and the **GitHub Release**, and attaches the packed
`.tgz`. **This fork does not publish to npm** — `@semantic-release/npm` runs with
`npmPublish: false` only to bump the version and pack the tarball. **Do not
hand-edit `version` or `CHANGELOG.md`** — semantic-release owns them. A
`commit-msg` hook runs commitlint locally.

Consumers install the tarball asset (`npm install <release>/…tgz`) or a Git ref
(`github:apachler/gree-hvac-client#vX.Y.Z`) — see the README.

## Gotchas

- The npm name `gree-hvac-client` belongs to the upstream project (inwaar); this
  fork (`apachler/gree-hvac-client`) is **not** published to npm and is consumed
  via Git/GitHub Releases. The `repository`/`bugs`/`homepage` fields point here.
- `package-lock.json` and `README.md` are marked `linguist-generated` in
  `.gitattributes` — `README.md` is regenerated, don't hand-edit it.
- Workflow triggers: CI runs on every push/PR; releases only on push to master.
