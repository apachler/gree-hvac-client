# HAPPY-CODING.md — Engineering Backlog

A persistent, prioritized backlog of worthwhile improvements for
`gree-hvac-client`. Items implemented in the OSS-maturity pass (2026-06-05,
porting practices from the downstream `node-red-contrib-gree-hvac` project) are
listed at the bottom for reference.

Priority legend: **P1** = do soon · **P2** = nice to have · **P3** = optional.
Effort: **S** (< 1h) · **M** (a few hours) · **L** (a day+).

---

## P2 — Tooling & developer experience

### 1. Upgrade ESLint 8 → 9 (flat config) and Prettier 2 → 3
- **Priority:** P2 · **Effort:** M
- **Rationale:** ESLint 8 is end-of-life; Prettier 2 is a major behind. Flat
  config (`eslint.config.js`) is the supported path forward.
- **Implementation:** Migrate `.eslintrc.js` → `eslint.config.js`; bump
  `eslint@9`, `eslint-plugin-jsdoc`, `eslint-config-prettier@9`,
  `eslint-plugin-prettier@5`, `prettier@3`. Prettier 3 changes defaults (e.g.
  `trailingComma: "all"`) — run `lint:fix` and review the reformat in an
  isolated commit, separate from feature work.

### 2. Reconcile the CI Node matrix with `engines.node`
- **Priority:** P3 · **Effort:** S
- **Rationale:** `package.json` declares `engines.node >= 16` but `ci.yml` still
  tests Node **14**. Either drop 14 from the matrix or lower `engines` — they
  should agree.

---

## P2 — Quality & observability

### 3. Coverage gate + badge
- **Priority:** P2 · **Effort:** M
- **Rationale:** CI now runs `jest --coverage` (the `coverage` job), but there's
  no enforced threshold or visible badge, so coverage can erode silently.
- **Implementation:** Either (a) add Jest `coverageThreshold` (e.g. lines 70%,
  tuned to current numbers) to fail CI on regressions, token-free; or (b) upload
  `coverage/lcov.info` to Codecov and add the badge. Surface the text summary in
  `$GITHUB_STEP_SUMMARY` for reviewer ergonomics.

### 4. Ship TypeScript type definitions
- **Priority:** P2 · **Effort:** M
- **Rationale:** A protocol client is frequently consumed from TypeScript. There
  are no `.d.ts` files today, so consumers get `any`.
- **Implementation:** Either hand-write `index.d.ts` (Client, PROPERTY, VALUE,
  options, events) or generate from JSDoc with `tsc --declaration --allowJs
  --emitDeclarationOnly`. Add `"types"` to `package.json` and to the `files`
  allowlist.

---

## P2 — Security & supply chain

### 5. SHA-pin GitHub Actions
- **Priority:** P2 · **Effort:** M
- **Rationale:** Actions are pinned to major tags (`@v4`). A compromised/retagged
  action could run arbitrary code in CI.
- **Implementation:** Pin every `uses:` to a full commit SHA with a trailing
  `# vX.Y.Z` comment; Dependabot's `github-actions` ecosystem keeps them current.
  (Tradeoff: noisier Dependabot PRs — deferred on that basis.)

### 6. npm publish provenance
- **Priority:** P3 · **Effort:** S
- **Status:** `release.yml` already grants `id-token: write`. To emit provenance,
  ensure `@semantic-release/npm` publishes with `--provenance` (or set
  `NPM_CONFIG_PROVENANCE=true`) once the npm package is linked to this repo.
- **Impact:** Verifiable build origin on npm; supply-chain friendly.

---

## P3 — Documentation & community

### 7. FUNDING.yml
- **Priority:** P3 · **Effort:** S
- Add `.github/FUNDING.yml` if the maintainer wants a "Sponsor" button.

---

## Deliberately NOT ported from node-red-contrib-gree-hvac

These exist downstream but don't fit a pure library and were intentionally left
out:

- **Docker / docker-compose / devcontainer-docker** — nothing to containerize.
- **The Gree simulator (`sim/`) + e2e harness + Trivy image scanning** — the
  library already mocks the UDP device in `test/support/device.js`; a full
  simulator is overkill here. (If hardware-free *integration* tests are ever
  wanted, a small in-process fake would be a separate initiative.)
- **Tag-driven release (`release.yml`/`auto-tag.yml`) + manual CHANGELOG** —
  this project uses `semantic-release` (npm-first), which owns versioning,
  changelog, and publish. The downstream project moved to tag-driven only
  because it ships GitHub-Release `.tgz` assets with npm publish disabled.
- **`.github/release.yml` (GitHub native release notes)** — would be dead config,
  since semantic-release generates the release notes.

---

## Already implemented (OSS-maturity pass, 2026-06-05)

- **Community docs:** `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  `SUPPORT.md`, `CLAUDE.md`, this backlog.
- **`.github/`:** `CODEOWNERS`, `PULL_REQUEST_TEMPLATE.md`, issue forms
  (`bug_report.yml`, `feature_request.yml`, `config.yml`), `dependabot.yml`
  (npm weekly grouped dev-deps + github-actions monthly), `labeler.yml`
  (Conventional-Commit PR labels for triage).
- **Config files:** `.editorconfig`, `.gitattributes`, `.nvmrc` (20).
- **Git hooks:** `.githooks/pre-push` (eslint --fix gate) and
  `.githooks/commit-msg` (commitlint), installed via the `prepare` script;
  `GREE_SKIP_LINT=1` escape hatch.
- **CI:** least-privilege `permissions` + `concurrency` on `ci`/`docs`/`release`;
  added `coverage` (`jest --coverage`) and `audit` jobs; added `codeql.yml`
  (SAST).
- **Release:** `.releaserc.json` adds `@semantic-release/changelog` +
  `@semantic-release/git` so `CHANGELOG.md` is generated and committed back;
  `release.yml` granted the scopes semantic-release needs.
- **`package.json`:** fixed stale `repository.url` (`inwaar` → `apachler`), added
  `bugs`/`homepage`, `prepare`/`lint:fix`/`test:coverage`/`audit` scripts,
  commitlint + semantic-release plugin devDeps, `CHANGELOG.md` in `files`.
