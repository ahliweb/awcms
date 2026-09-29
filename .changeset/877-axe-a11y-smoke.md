---
"awcms": patch
---

test(a11y): add an `@axe-core/playwright` accessibility smoke to the E2E harness, fix four real WCAG violations it found (ahliweb/awcms#877, epic #858)

`@axe-core/playwright` is a new devDependency (`bun add -d`, no runtime/client bundle impact — verified by `bun run build:asset-budget:check`, which measures only shipped client assets). A new READ_WAVE spec, `tests/e2e/a11y-axe.e2e.ts`, runs `AxeBuilder` (WCAG 2.0/2.1 A+AA tags) against eight representative admin routes changed by epic #858 (`/admin`, `/admin/comments`, `/admin/users`, `/admin/approvals`, `/admin/media`, `/admin/omes`, `/admin/omes/jobs`, `/admin/site-profile`), in light AND dark theme (the app's real `localStorage["awcms_theme"]` mechanism), at 360px and desktop, plus the ADR-0125 `ConfirmDialog`/`ReasonPanel` opened then cancelled. It fails on any `critical`/`serious` violation and runs in CI's `e2e-smoke` job alongside the existing suite (no workflow change needed — `playwright.config.ts` already picks up every `*.e2e.ts`).

Run for real against a fresh Postgres 18.4 + full migration + seeded tenant, it found and this PR fixes four shipped `critical`/`serious` violations that `design:token-contrast:check` (a pure-CSS registry, necessary but not sufficient) could not see:

- `.admin-brand`'s wordmark losing its accessible name below 768px (`display: none` removes an element from accessible-name computation, not only layout) — fixed with `aria-label="AWCMS"` on the link.
- `ReasonPanel`'s reason label being a bare `<span>` with no programmatic association to its textarea (`label`, critical) — fixed with a real `<label for>`.
- `.reason-panel { display: flex }` applying unconditionally instead of scoped to `[open]` — author-origin CSS overrides the user-agent's `dialog:not([open]) { display: none }` regardless of `!important`, so a cancelled `ReasonPanel` stayed visually on-screen after `.close()`.
- `.admin-logout` using the theme-aware `--color-text-muted` on the always-dark sidebar background instead of `--color-sidebar-text` (`color-contrast`, serious, 3.07:1 measured against the 4.5:1 floor).

`APP_BUDGET_BYTES` raised 248,033 -> 248,055 (measured actual, ledgered in `scripts/client-asset-budget.ts`) for the CSS/markup these fixes added. `design-token-contrast-check.ts`'s sidebar registry entry gained `.admin-logout` as a second consumer. The spec runs under `reducedMotion: "reduce"` — `.fade-in-up`'s 240ms entrance animation genuinely lowers rendered contrast mid-transition (axe samples pixel colour, not computed style), which is not this smoke's subject.

Docs: doc 07 and doc 14 (+ .id mirrors) now describe the automated a11y check; `docs/awcms/admin-ui-parity-matrix.md` (+ .id) marks the axe acceptance criterion closed; the `awcms-browser-test` and `awcms-testing` skills (+ .id) are corrected — `awcms-browser-test` previously stated `@axe-core/playwright` was not a dependency of this repo, which was true when written and is no longer true.
