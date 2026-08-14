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
  see `tests/integration/blog-content-admin-ui.integration.test.ts`)
  does **not** render markup — integration tests exercise the data-layer functions
  called by SSR, not the resulting HTML or the client `<script>`.
- Situations without an interactive browser tool (e.g. a headless CLI session) that need
  "try it in a real browser" to verify a feature — run a
  Playwright spec instead of hand-running `curl` one by one.

## When this skill is NOT needed

- Pure logic (validator, calculator, state machine) → an ordinary unit test.
- API endpoint contracts (status code, response shape, auth/tenant header) →
  an integration test that calls the `APIRoute` handler directly, far
  faster and needing no browser at all.
- The SSR data layer of an admin page (functions called from the frontmatter) →
  an integration test like `tests/integration/tenant-domain-admin.integration.test.ts`,
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
locally it stays manual as above. Its CI job runs in **two phases**
(separate server lifecycles): phase 1 with the default config runs
every spec EXCEPT `admin-security-enabled.e2e.ts` (which is tagged
`@full-online-gate` on its own `test.describe`, not matched through a
prose title — `--grep-invert "@full-online-gate"`, resilient to future title
renames), phase 2 restarts the server
with `AUTH_ONLINE_SECURITY_ENABLED=true`/`AUTH_ONLINE_SECURITY_PROFILE=full_online`
then runs only that spec — it was found empirically while wiring this job
that `admin-security-disabled.e2e.ts` and `admin-security-enabled.e2e.ts`
test CONTRADICTORY renders of the same page gated by a boot-time env
var, so they cannot run against one and the same server instance.
A new spec that needs some other non-default server config (a new env var, etc.)
will likely need a similar third phase — see `ci.yml`'s `e2e-smoke` job
for the full pattern before adding one.

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

## Reference files

- `playwright.config.ts` — the main config (testDir, testMatch, baseURL,
  launchOptions with the `PLAYWRIGHT_CHROMIUM_EXECUTABLE` escape hatch).
- `tests/e2e/login.e2e.ts` — a real working example (not a placeholder),
  already run and passing against a dev server + a real Postgres
  as part of adding this skill.

## Status

Besides `login.e2e.ts`, there are already specs for `/admin/analytics`,
`/admin/security` (both gate profiles), and — since Issue #693 (epic #679
platform-hardening) — `admin-responsive-nav.e2e.ts` (responsive
sidebar/drawer: toggle, scrim, Escape, focus management, skip link),
`admin-access-users-migrated.e2e.ts`/`admin-tenant-domains-migrated.e2e.ts`
(migration to the `DataTable`/`StatusBadge`/`ConfirmDialog` primitives), and
`admin-a11y-smoke.e2e.ts` (an automated accessibility smoke test based on
`@axe-core/playwright`, added as a devDependency specifically for
this issue — see that file's docblock for why this is not a violation of
"Bun-only", AGENTS.md #14: that rule is about the runtime/build tooling, not about a dependency
used from inside the `bun --bun playwright test` process that is already
running on Bun). There is no spec yet for the other admin pages (`blog/*`, etc.) —
add them as the issue at hand requires, do not retrofit every admin page
at once without a concrete reason (see this repo's principle: do not build
coverage outside the scope of the issue being worked on).
