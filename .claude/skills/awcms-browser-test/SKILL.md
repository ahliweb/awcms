---
name: awcms-browser-test
description: Write/run AWCMS browser E2E tests with Playwright on top of Bun. Use when you need real cross-layer verification in a browser (page render, form submit, navigation, SSR + client script state together) — not a replacement for the unit/integration/API contract tests from the `awcms-testing` skill, but the top of its testing pyramid (doc 07). Also the reference when no interactive browser tool is available and UI verification has to be run through the CLI.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Browser E2E Test (Playwright + Bun)

The top of the doc 07 testing pyramid (`docs/awcms/07_sprint_testing_production_readiness.md`
§Pyramid: "a few end-to-end at the top"). The `awcms-testing` skill governs the
unit/integration/API-contract/security/performance tests that are run
through `bun test`; this skill governs the E2E layer based on a real browser
which is **not** run through `bun test` — different test runner, different purpose.

## When to use this skill

- Adding/changing an Astro page (SSR + inline client `<script>`) whose
  behaviour is only really tested through a real browser — initial
  render, event handlers, fetch to the API, state after reload.
- Before a PR for a non-trivial UI change, as a complement to
  `tests/integration/*.integration.test.ts` which (by this repo's convention,
  see `tests/integration/menu-widget-response-shape.integration.test.ts`)
  does **not** render markup — integration tests exercise the data-layer functions
  called by SSR, not the resulting HTML or the client `<script>`. The markup
  side is covered instead by the flat `tests/admin-*-page-contract.test.ts`
  files, which assert against page source without a browser.
- Situations without an interactive browser tool (e.g. a headless CLI session) that need
  "try it in a real browser" to verify a feature — run a
  Playwright spec instead of hand-running `curl` one by one.

## When this skill is NOT needed

- Pure logic (validator, calculator, state machine) → an ordinary unit test.
- API endpoint contracts (status code, response shape, auth/tenant header) →
  an integration test that calls the `APIRoute` handler directly, far
  faster and needing no browser at all.
- The SSR data layer of an admin page (functions called from the frontmatter) →
  an integration test like `tests/integration/tenant-domain.integration.test.ts`,
  not a Playwright spec — do not duplicate coverage that already exists there
  with slower E2E.

## Setup (once per checkout)

```bash
bun add -d @playwright/test   # already in this repo's devDependencies
bun run test:e2e:install      # bun --bun playwright install --with-deps chromium — needs root/apt-get
```

`--with-deps` installs the OS shared libraries headless Chromium needs
(`libnss3`, `libgtk`, etc.) via `apt-get` — **needs root**. In a
sandbox without root access (`sudo` fails because of `no new privileges`), skip
`playwright install` and use the already-installed system browser via the
env var `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (see `playwright.config.ts` —
it is read automatically, e.g. `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome`).
Empirically verified to work in this development environment (Bun 1.3.14,
Linux, system `google-chrome`) without any extra `--no-sandbox`.

## Running the tests

E2E needs an app that is actually running (not Playwright's `webServer`
auto-start — this app needs a live Postgres connection to boot at all,
and `webServer` cannot provide that):

```bash
# Terminal 1 — DATABASE_URL must be set, same as for integration tests
bun run dev     # or: bun run build && bun run preview

# Terminal 2
bun run test:e2e
```

`E2E_BASE_URL` overrides the target away from the default `http://localhost:4321`
(`playwright.config.ts`). **Since Issue #685** (epic #679,
platform-hardening) it is a CI job of its own —
`.github/workflows/ci.yml`'s `e2e-smoke` — which orchestrates an isolated Postgres
service, `db:migrate`, `bun run build`, `bun run start`, a health
check, then a real `bun run test:e2e` (not skip-if-the-server-is-not-
running, because CI does provide a live server+DB). It is **still not**
part of the local `bun run check` (`check` does not boot a server/DB itself) —
locally it stays manual as above.

The job is **one phase**: start the server, wait for the catch-all 404 to
answer, seed one tenant + owner + head office through the real
`POST /api/v1/setup/initialize`, export the returned `E2E_TENANT_ID`, then
`bun run test:e2e` once. (A previous version of this section described a
two-phase job with `--grep-invert "@full-online-gate"` and
`admin-security-enabled.e2e.ts` / `admin-security-disabled.e2e.ts`. **That is
`awcms-mini`, not this repo** — no such specs exist here and `ci.yml` has no
second phase. Corrected 2026-08-24.) A spec needing a non-default boot-time
env var would need a second phase adding — read `ci.yml`'s `e2e-smoke` job
before writing one, and note that the wave projects
(`setup` → `read` → `write`) would have to be re-run in that phase too.

Ordering inside the run is not `fullyParallel` alone — see convention 7.

## Mandatory conventions

1. **File name `*.e2e.ts`, NOT `*.spec.ts`/`*.test.ts`**, under
   `tests/e2e/`. `bun test` by default recursively matches
   `*.test.*`/`*_test.*`/`*.spec.*`/`*_spec.*` — if a Playwright spec
   uses one of those patterns, `bun test` (and `bun run check`) will also
   try to run it as a `bun:test` file and fail (a Playwright spec
   imports `test`/`expect` from `@playwright/test`, a totally different
   runtime context from `bun:test`). `.e2e.ts` deliberately matches
   none of the patterns above — verify: `bun test tests/e2e` always
   reports "did not match any test files".
2. **Run the test runner via `bun run test:e2e` (→ `bun --bun playwright test`), not bare `playwright test`.** AGENTS.md rule #14
   ("Bun-only backend") forbids adding Node.js tooling unless Bun
   does not yet support the technical need, with a documented exception
   — so this is not a style choice but mandatory compliance. `@playwright/test`'s
   binary has the shebang `#!/usr/bin/env node`; without the `--bun` flag, `bun run test:e2e`
   (or `bunx playwright test`) silently runs its
   test-runner process on **real Node.js** (empirically verified:
   `process.versions` inside the test process shows `node`, not
   `bun`, without `--bun`) — a silent violation of rule #14 that
   easily passes review if not checked directly.
   `bun --bun playwright test` (used by `test:e2e`, the same pattern as the
   existing `"dev": "bun --bun astro dev"`) forces Bun to be the runtime
   of the test-runner process itself — empirically verified `isBun: true` inside
   the test process, and `chromium.launch()` plus both real tests in
   `login.e2e.ts` pass consistently under this mode (Bun 1.3.14, Linux).
   There are old reports (oven-sh/bun#15679, mostly Windows, fix PR #31932
   not merged as of the research when this skill was written) about `chromium.launch()`
   hanging under the Bun native runtime through the subprocess/IPC
   (`--remote-debugging-pipe` fd3) that Playwright uses — **not
   reproduced** on Linux/Bun 1.3.14 when this skill was verified. If
   at some point `bun --bun playwright test` hangs/fails on a particular
   platform/Bun version (e.g. Windows), that is a failure whose class is
   already known — do not rush back to Node without following the
   AGENTS.md #14 exception process (maintainer approval + an entry in
   `docs/awcms/AUDIT_STANDAR_PENGEMBANGAN_2026-07-04.md`); try a
   newer Bun version first.
3. **One `page.goto` per real scenario, assert through stable `getByRole`/`#id`
   selectors** — avoid selectors based on visible text that changes when
   an i18n string is edited; use the `id`/`name`/`data-*` that already
   exist in the markup (see `tests/e2e/login.e2e.ts` for a real example:
   `#login-form`, `#tenant-id`, `#login-identifier`, `#password`,
   `#login-submit`, `#login-error`).
4. **Pick a target that needs no seeded data** where possible
   (e.g. `/login` always renders the same form regardless of DB contents) —
   a spec that needs a real tenant/user must prepare it itself through direct
   SQL or `POST /api/v1/auth/login` at the start of the test (see the project
   memory `manual-admin-ui-smoke-test` for the manual tenant+admin bootstrap
   pattern once the setup wizard is locked).
5. **Error messages in the UI must not leak internal detail** — if a
   spec tests an error path, assert that the message does NOT contain keywords
   such as "stack"/"postgres"/an internal function name, not merely assert
   "there is an error message" (see the example in `login.e2e.ts`'s second test).
6. **CSP on `.astro` pages: scripts MUST be external, never inline
   or conditional** (Issue #166, memory `awcms-admin-ui-notes`). CSP
   `default-src 'self'` (middleware) blocks all inline script/style.
   Because of that every page `<script>` **must import** from
   `src/lib/ui/admin-form-client.ts` — that import is what forces Astro
   to bundle it into an external file; a script without an import is inlined by
   Astro and **blocked by CSP** (silently dead behaviour, still passes the build).
   AND: Astro hoists `<script>` at **build** time, so DO NOT wrap it
   in a runtime conditional `{cond && (<script>…)}` — that is pointless (the bundle
   ships anyway) AND it makes `prettier`/the Astro parser fail (`SyntaxError`).
   Put `<script>` as a top-level element with no conditional; guard in JS
   (`const el = getElementById(...); el?.addEventListener(...)`). CSS: use
   an external stylesheet (`build.inlineStylesheets: "never"`), not an inline
   `<style>`. Run E2E against the production build (`build && start`), not
   `dev` (the dev server injects inline HMR which this CSP blocks).

7. **Every new spec must be classified into a WAVE, and the read wave is
   enforced at run time.** All specs share ONE seeded tenant, so a spec that
   writes changes what a spec that reads observes. `playwright.config.ts` runs
   `setup` → `read` → `write`, and `tests/e2e/support/e2e-waves.ts` says which
   spec is which. A new file that is in neither list **does not run at all**,
   and `tests/e2e-wave-classification.test.ts` fails until it is added — so the
   decision cannot be skipped, only made. Ask: does this spec change tenant-wide
   state (roles, module enablement, ABAC policies, assignments)? Then
   `WRITE_WAVE`. Otherwise `READ_WAVE`, and it must import `test` from
   `./support/e2e-read-wave` rather than from `@playwright/test` — that fixture
   fails the test if it issues any mutating `/api/` request, so the wave label
   is checked rather than trusted. This is not bureaucracy: interleaving cost
   three diagnoses (two of them wrong) and kept a working spec off `main` for a
   full round.

## Reference files

- `playwright.config.ts` — the main config (testDir, testMatch, baseURL,
  launchOptions with the `PLAYWRIGHT_CHROMIUM_EXECUTABLE` escape hatch), and
  the `setup` → `read` → `write` project chain.
- `tests/e2e/support/e2e-waves.ts` — the wave classification and the reasoning
  behind it, including the two concrete interference cases.
- `tests/e2e/login.e2e.ts` — a real working example (not a placeholder),
  already run and passing against a dev server + a real Postgres
  as part of adding this skill.

## Status

**This section previously described specs that do not exist in this repo**
(`admin-responsive-nav.e2e.ts`, `admin-a11y-smoke.e2e.ts`, a
`@axe-core/playwright` devDependency, `/admin/analytics` and `/admin/security`
gate profiles). They were inherited from `awcms-mini` when the skill was ported.
None of them is here, and `@axe-core/playwright` is not a dependency of this
repo. Corrected on 2026-08-24 — a skill that describes the wrong repo is worse
than no skill, because an agent follows it instead of looking.

What actually exists (17 spec files under `tests/e2e/`):

- **Read wave** — `login.e2e.ts` (the login flow itself), `not-found.e2e.ts`,
  `cwv-lab.e2e.ts` (env-gated on `E2E_CWV_LAB`), `admin-offices.e2e.ts`, and
  three whole-fleet sweeps that discover their own targets from
  `src/pages/admin/**.astro`: `admin-screens-render.e2e.ts` (every screen
  renders for the owner), `admin-deny-path.e2e.ts` (every gated screen refuses
  a user holding nothing), `admin-read-only-access.e2e.ts` (a tenant read-only
  operator — the ADR-0053 platform-scope check at run time).
- **Write wave** — `admin-roles.e2e.ts`, `admin-users.e2e.ts`,
  `admin-abac-policies.e2e.ts`, `admin-modules-toggle.e2e.ts`, the
  `admin-*-create` / `admin-offices-edit` CRUD specs, and
  `api-body-auth-boundary.e2e.ts` (every body-accepting API route must refuse a
  bogus bearer token before reading anything) and
  `api-authorization-first.e2e.ts` (a session holding ZERO permissions must get
  `403`, not a validator's answer — the debt is ledgered in
  `support/authorization-first-ledger.ts` and may only shrink). Both are
  classified by what they ATTEMPT, since nothing they send is meant to succeed.

The three sweeps cover every admin screen already, so a new screen needs no new
spec to be _loaded_ — only a spec of its own if it has behaviour worth
asserting. Do not retrofit per-page specs without a concrete reason (this
repo's principle: do not build coverage outside the scope of the issue being
worked on).
