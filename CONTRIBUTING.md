# Contributing

Thanks for your interest in improving **gree-hvac-client**! This library talks
to Gree air-conditioners over their UDP/AES LAN protocol and is consumed by
downstream integrations (Node-RED, Home Assistant add-ons, custom scripts).

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold it.

## Getting started

Requirements:

- **Node.js 16+** (matches `engines.node`; CI also tests 18/20/22)

```bash
git clone https://github.com/apachler/gree-hvac-client.git
cd gree-hvac-client
npm install
```

`npm install` runs the `prepare` script, which points `core.hooksPath` at
`./.githooks/`. The **pre-push hook** runs `eslint --fix` over the repo and
refuses the push if ESLint reports unfixable errors, or if `--fix` produced
changes you haven't committed (so the fix lands in a reviewable commit). Skip it
for an emergency push with `GREE_SKIP_LINT=1 git push ...`.

## Development workflow

```bash
npm run lint          # ESLint + Prettier
npm run lint:fix      # auto-fix
npm test              # Jest unit tests
npm run test:coverage # Jest with a coverage summary
npm run docs          # regenerate README.md from README.hbs (jsdoc2md)
```

> **README is generated.** Edit prose in `README.hbs`; the API section comes
> from JSDoc in `src/*.js`. Run `npm run docs` and commit the regenerated
> `README.md` — CI fails the build if it is out of date.

### Project layout

| Path                            | What it is                                       |
| ------------------------------- | ------------------------------------------------ |
| `index.js`                      | entry point — re-exports `src/client`            |
| `src/client.js`                 | the `Client` class (connect, bind, get/set)      |
| `src/encryption-service.js`     | AES-ECB + AES-GCM cipher (bind key exchange)     |
| `src/property-transformer.js`   | maps friendly ↔ vendor property names            |
| `src/property-value.js` etc.    | property / value definitions and vendor maps     |
| `src/logger.js`                 | Winston logger setup                             |
| `test/`                         | Jest specs (`test/support/` holds mocks/fixtures)|
| `example/`                      | runnable usage examples (promises, async, poll)  |
| `README.hbs`                    | Handlebars template; `README.md` is generated    |
| `docs/PROTOCOL.md`              | the full Gree UDP/AES protocol & property reference |

## Coding standards

- **Style:** ESLint + Prettier (single quotes, 4-space indent in JS, 2-space in
  JSON/YAML). Run `npm run lint` before pushing — the hook does this for you.
- **Tests:** Jest. Add specs next to the existing ones in `test/`. New behaviour
  should come with a test; `test/support/device.js` mocks the UDP device so you
  can test without hardware.
- **Node version:** keep changes compatible with Node 16+.

## Commit & PR conventions

Commits and PR titles **must** follow
[Conventional Commits](https://www.conventionalcommits.org/), e.g.
`feat: add quiet mode toggle` or `fix(encryption): handle GCM bind timeout`.
This is not cosmetic: **`semantic-release` derives the next version number and
the changelog directly from your commit messages** on `master`. Recognised
prefixes:

`feat:` `fix:` `docs:` `test:` `chore:` `refactor:` `perf:` `ci:` `build:` `style:`

A `feat:` triggers a minor release, `fix:` a patch; a `!` or `BREAKING CHANGE:`
footer triggers a major.

Before opening a PR:

1. `npm run lint && npm test` pass.
2. Run `npm run docs` if you changed any JSDoc or `README.hbs`, and commit the
   regenerated `README.md`.
3. Update docs when behaviour changes.

`CHANGELOG.md` is generated automatically by semantic-release — don't edit it by
hand. Just write [Conventional Commits](https://www.conventionalcommits.org/) and
the changelog and version follow.

## Releasing

Releases are fully automated. Merging Conventional-Commit history to `master`
runs [`semantic-release`](https://semantic-release.gitbook.io/): it computes the
next version, updates `CHANGELOG.md` + `package.json` and commits them back with
a `[skip ci]` message (so the bot's own commit doesn't trigger another release —
only your merges do), creates the git **tag** and the **GitHub Release**, and
attaches the packed `.tgz` as an asset. **This fork does not publish to the npm
registry** — it ships via Git + GitHub Releases. **Do not bump `version` or edit
`CHANGELOG.md` by hand**; semantic-release owns them.

## Reporting bugs & asking questions

- **Bugs / feature requests:** open an [issue](https://github.com/apachler/gree-hvac-client/issues).
- **Questions / help:** see [SUPPORT.md](SUPPORT.md).
- **Security vulnerabilities:** see [SECURITY.md](SECURITY.md) — please do
  **not** open a public issue.
