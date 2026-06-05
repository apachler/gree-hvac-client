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

### 2. Codecov badge + PR coverage summary
- **Priority:** P3 · **Effort:** S
- **Rationale:** A Jest `coverageThreshold` gate is now in place (token-free,
  fails CI on regression). What's still missing is a *visible* badge and an
  in-PR summary.
- **Implementation:** Either upload `coverage/lcov.info` to Codecov (needs
  `CODECOV_TOKEN`) for a trend badge, or pipe the `jest --coverage` text report
  into `$GITHUB_STEP_SUMMARY` in the `coverage` job (zero new services).
- **Impact:** Reviewer ergonomics + an at-a-glance quality signal. Raise the
  thresholds in `jest.config.js` toward the current ~88% as coverage improves.

### 3. Ship TypeScript type definitions + `tsc --checkJs`
- **Priority:** P2 · **Effort:** M
- **Rationale:** A protocol client is frequently consumed from TypeScript. There
  are no `.d.ts` files today, so consumers get `any`. Type-checking the JS via
  JSDoc would also catch a class of bugs at build time.
- **Implementation:** Add a `jsconfig.json`/`tsconfig.json` with
  `checkJs: true`, generate declarations with `tsc --declaration --allowJs
  --emitDeclarationOnly` into `dist/types`, add `"types"` to `package.json` and
  the `files` allowlist, and add a `typecheck` CI job. Expect to fix a handful
  of JSDoc type issues on first run — do it in an isolated commit.
- **Impact:** First-class TS DX; compile-time safety on the JS itself.

### 3a. De-flake the reconnect test
- **Priority:** P2 · **Effort:** S
- **Rationale:** `test/client.spec.js` → "should reconnect if not connected"
  uses `connectTimeout: 1` (ms) against a real `localhost` socket and asserts
  three consecutive timeouts. It is timing-racy and fails intermittently
  (~1 in 5 local runs) — a flaky test erodes trust in CI.
- **Implementation:** Drive it with Jest fake timers and the existing
  `test/support/device.js` mock instead of a real socket + 1 ms timeout, so the
  reconnect sequence is deterministic.
- **Impact:** Reliable CI; no spurious red builds.

### 4. Upgrade ESLint 8 → 9 (flat config) and Prettier 2 → 3
- **Priority:** P2 · **Effort:** M
- **Rationale:** ESLint 8 is end-of-life; Prettier 2 is a major behind. Flat
  config (`eslint.config.js`) is the supported path forward.
- **Implementation:** Migrate `.eslintrc.js` → `eslint.config.js`; bump
  `eslint@9`, `eslint-plugin-jsdoc`, `eslint-config-prettier@9`,
  `eslint-plugin-prettier@5`, `prettier@3`. Prettier 3 changes defaults (e.g.
  `trailingComma: "all"`) — run `lint:fix` and review the reformat in an
  isolated commit, separate from feature work.

---

## P2 — Security & supply chain

### 5. SBOM generation on release
- **Priority:** P2 · **Effort:** S
- **Rationale:** A Software Bill of Materials is increasingly expected for
  supply-chain transparency (SLSA, enterprise procurement).
- **Implementation:** Add `anchore/sbom-action` to emit a CycloneDX/SPDX SBOM.
  Because semantic-release creates the GitHub Release, the simplest path is a
  `@semantic-release/exec` step that generates the SBOM and a
  `@semantic-release/github` `assets` entry to attach it — or a separate job
  triggered on the published tag.
- **Impact:** Downstream consumers can audit the dependency tree.

### 6. SHA-pin GitHub Actions
- **Priority:** P2 · **Effort:** M
- **Rationale:** Actions are pinned to major tags (`@v4`). A compromised/retagged
  action could run arbitrary code in CI. (OpenSSF Scorecard flags this.)
- **Implementation:** Pin every `uses:` to a full commit SHA with a trailing
  `# vX.Y.Z` comment; Dependabot's `github-actions` ecosystem keeps them current.
  (Tradeoff: noisier Dependabot PRs — deferred on that basis.)

### 7. Secret scanning
- **Priority:** P2 · **Effort:** S
- **Rationale:** No automated check stops a credential from being committed.
- **Implementation:** Enable GitHub's native **secret scanning + push
  protection** (Settings → Code security — free for public repos, zero CI cost),
  and/or add a `gitleaks` CI job for defence in depth.
- **Impact:** Prevents the most common and damaging leak class.

---

## P3 — Documentation & community

### 8. ROADMAP.md / GOVERNANCE.md
- **Priority:** P3 · **Effort:** S
- **Rationale:** Useful once there are multiple maintainers or external demand.
  Low value at current single-maintainer scale — premature docs go stale.
- **Implementation:** Add when a second maintainer joins or a public roadmap is
  requested.

### 9. FUNDING.yml
- **Priority:** P3 · **Effort:** S
- Add `.github/FUNDING.yml` if the maintainer wants a "Sponsor" button.

### 10. Issue/PR triage automation (stale + lock)
- **Priority:** P3 · **Effort:** S
- **Rationale:** Keeps the tracker tidy as volume grows.
- **Implementation:** `actions/stale` (mark/close inactive issues) and
  `dessant/lock-threads` (lock very old closed threads). Tune timings to be
  non-aggressive. Only worth it once issue volume justifies it.

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
- **`docs/PROTOCOL.md`:** full Gree UDP/AES protocol reference (verified against
  `src/`), plus `.gitignore` updates (`.idea/`, `*.tmp.*`).

## Already implemented (senior-maintainer audit pass, 2026-06-05)

- **Bug fix:** corrected the `GREE_HVAC_POLL**L**ING_TIMEOUT` typo in
  `client-options.js` — the `pollingTimeout` env override was silently dead.
- **Coverage gate:** `jest.config.js` with `coverageThreshold`
  (85/70/80/85, scoped to `src/`), enforced in the CI `coverage` job; `npm test`
  stays fast (gate only runs under `--coverage`). Current ~88% lines.
- **CI matrix:** dropped EOL Node 14 (below `engines>=16`), added Node 24.
- **Supply chain:** npm publish provenance (`NPM_CONFIG_PROVENANCE=true` in
  `release.yml`, using the existing `id-token: write`); OpenSSF **Scorecard**
  workflow + README badge.
- **Onboarding:** `.env.example` documenting every `GREE_HVAC_*` override.
- **README:** added Configuration / Development / Contributing / Security
  sections and Scorecard + code-style badges (regenerated from `README.hbs`).
