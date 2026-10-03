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
   `<style>`, and **never an inline `style=` attribute** — `default-src 'self'`
   has no `'unsafe-inline'`, so the browser drops it silently and nothing in the
   build says so.

   Run E2E and any screenshot pass against the production build
   (`bun run build`, then `dist/standalone-entry.mjs`), **not** `dev`. Under
   Vite the stylesheets are served as `<script type="module" src="…css">`,
   which this CSP blocks — so a dev-server screenshot is not "slightly
   different", it is a **completely unstyled page**, and it looks like a broken
   redesign rather than a broken harness.

   Two harness traps that produce confidently wrong passes:
   - **`newContext({viewport: …})`, not `viewportSize`.** The latter is not a
     valid option, is silently ignored, and every "mobile" screenshot is then a
     1280px desktop one wearing a mobile label. Assert the width you asked for.
   - **Assert the page, not the status.** A 200 can be a rendered refusal, and
     an Astro component that throws renders as a 404 with the `ReferenceError`
     only in the server log. Check for the element, and check
     `document.documentElement.scrollWidth <= innerWidth` for overflow.

   The overflow sweep (`tests/e2e/responsive-360.e2e.ts`, Issue #884) does
   exactly that for every static admin screen at four viewports: **360px**
   (narrowest phone), **640×360** (a 1280×720 desktop at 200% browser zoom —
   WCAG 2.1 SC 1.4.10 measures reflow in CSS px and Playwright has no real
   zoom API, so the equivalent CSS viewport stands in; the HEIGHT matters
   too), **768px** (tablet portrait) and **1024px**. Add a width as a
   `{width, height, why}` entry in its `VIEWPORTS` table — one `test()` each,
   same assertion, never an exemption or a larger tolerance.

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

## Accessibility smoke (`@axe-core/playwright`, Issue #877)

`@axe-core/playwright` **is now a devDependency of this repo**
(`bun add -d @axe-core/playwright`) — the paragraph that used to live in this
section claiming otherwise was corrected once the harness actually shipped.
`tests/e2e/a11y-axe.e2e.ts` runs `AxeBuilder` (WCAG 2.0/2.1 A+AA tags) against
eight representative admin routes — `/admin`, `/admin/comments`,
`/admin/users`, `/admin/approvals`, `/admin/media`, `/admin/omes`,
`/admin/omes/jobs`, `/admin/site-profile` — in light AND dark theme (via the
real `localStorage["awcms_theme"]` mechanism `theme-init-script.ts` reads, not
a CSS override or `prefers-color-scheme` emulation), at 360px and desktop, and
fails on any `critical`/`serious` violation. It also opens the ADR-0125
`ConfirmDialog` (`/admin/offices`' delete button — the seeded head office row
always exists) and `ReasonPanel` (`/admin/modules`' disable button — a
non-core module is enabled by default), scans each while open, then
CANCELS — never confirms/submits — so nothing is mutated through the app.
That is what makes it READ_WAVE rather than WRITE_WAVE (see
`support/e2e-waves.ts`).

**It runs under `test.use({ reducedMotion: "reduce" })`, and that is load-
bearing, not incidental.** `src/styles/motion.css`'s `.fade-in-up` entrance
animation (240ms, applied to every `.admin-section`) genuinely lowers
`opacity` on its ancestor while it plays, and axe samples RENDERED pixel
colour rather than trusting computed style — a scan mid-animation reports a
real but transient contrast dip (measured while diagnosing this spec: an
ancestor at `opacity: 0.617` mid-fade turned a 5.19:1 token pair into 3.11:1
briefly). `reducedMotion: "reduce"` uses the app's own already-implemented
WCAG 2.3.3 mode rather than an ad hoc `waitForTimeout` — every scan runs
against the same settled state a reduced-motion user always sees, and the run
stays fast and deterministic regardless of machine speed.

**Run for real while this spec was written**, it found five shipped
`critical`/`serious` defects `bun run design:token-contrast:check` (a
pure-CSS registry check, necessary but not sufficient — see that script's own
header) could not see, because none of them was a wrong token VALUE:

1. `.admin-brand`'s wordmark losing its accessible name below 768px —
   `admin.css` hides `.admin-brand-text` with `display: none` at phone
   widths, and `display: none` removes an element from the accessible-name
   computation exactly as much as from the layout (`link-name`, serious).
   Fixed with `aria-label="AWCMS"` on the link itself, independent of which
   child is visible.
2. `ReasonPanel`'s reason label being a bare `<span>` with no programmatic
   association to its `<textarea>` (`label`, critical). Fixed by making it a
   real `<label for>`.
3. `.reason-panel { display: flex }` applying UNCONDITIONALLY rather than
   scoped to `.reason-panel[open]`. A native `<dialog>`'s "hidden while
   closed" behaviour lives in the user-agent cascade origin, which loses to
   ANY author-origin rule of equal or lower specificity regardless of
   `!important` — so the panel stayed visually laid out and on-screen
   (Playwright's `isVisible()` reported `true`) even after `.close()` cleared
   its `open` attribute. The same class of bug as `[hidden]` losing to a
   `display` rule — the memory note `html-hidden-loses-to-display-rule`
   generalises past `[hidden]` specifically.
4. `.admin-logout` using the theme-aware `--color-text-muted` on the
   always-dark sidebar background instead of `--color-sidebar-text`
   (`color-contrast`, serious, 3.07:1 measured against the 4.5:1 floor for
   normal-size text — `--color-text-muted` is tuned for the light/dark admin
   card surfaces, not the sidebar's own always-dark surface family).
5. The dashboard's `.dd-alert` (deny-count and sync-health alerts on `/admin`)
   using `--color-danger-strong` as TEXT on `--color-surface` (`color-contrast`,
   serious, dark theme only: 3.81:1 against the 4.5:1 floor). `-strong` is the
   solid-fill-under-white-text role; text on a plain surface is the job of
   plain `--color-danger` (5.81:1 dark; light unchanged at 4.83:1 since both
   tokens are `#dc2626` there). Fixed by the token swap, and
   `design-token-contrast-check.ts`'s existing `color-danger`/`color-surface`
   pair now lists `.dd-alert` as a consumer.

See `docs/awcms/admin-ui-parity-matrix.md` §7 and
`scripts/client-asset-budget.ts`'s own ledger comment (`APP_BUDGET_BYTES`
raised 248,033 → 248,055) for the full accounting.

## Status

What exists (18 spec files under `tests/e2e/`):

- **Read wave** — `login.e2e.ts` (the login flow itself), `not-found.e2e.ts`,
  `cwv-lab.e2e.ts` (env-gated on `E2E_CWV_LAB`), `admin-offices.e2e.ts`,
  `a11y-axe.e2e.ts` (see above), and three whole-fleet sweeps that discover
  their own targets from `src/pages/admin/**.astro`:
  `admin-screens-render.e2e.ts` (every screen renders for the owner),
  `admin-deny-path.e2e.ts` (every gated screen refuses a user holding
  nothing), `admin-read-only-access.e2e.ts` (a tenant read-only operator —
  the ADR-0053 platform-scope check at run time).
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
