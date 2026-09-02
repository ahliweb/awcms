---
name: awcms-ux-review
description: Audit and raise AWCMS UI/UX quality above the design system baseline. Use when asked to "review UX", "fix the look/usability", audit accessibility, or raise the quality of an existing admin/POS/portal screen. Different from awcms-ui-screen (building a new screen to standard) — this skill judges and raises the quality of screens that already exist.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — UI/UX Improvement Review

Sources of truth: **`docs/awcms/14_ui_ux_design_system.md`** (tokens, components, state pattern, a11y, i18n, theming) and **`docs/awcms/15_frontend_architecture_integration.md`** (SSR/islands, API client, offline). This skill is about **improvement** — not building from scratch (that is `awcms-ui-screen`), but finding quality gaps and closing them.

## Improvement principle

Measure first, then change: identify real problems (usability heuristics, axe/contrast results, layout shift) before touching code. A UX fix **must not** weaken a backend control (hiding in the UI is not authorization) or leak sensitive data.

## Audit checklist

- [ ] **All four states present** — every list/detail has loading (skeleton, not an empty spinner), empty (+CTA), error (hand-rolled `<p class="state-notice" role="status|alert">` — this repo does **not** have `src/components/ui`/`StateNotice.astro`, verify with `find src/components -type d`; see `offices.astro`/`roles.astro`/`users.astro` for the real pattern. Differentiate "access denied" from "temporary failure"; previously an SSR failure was a raw 500 with no render path at all on some screens), ready. Look for screens that only render "ready".
- [ ] **Contrast — run the gate first, then look.** `bun run design:token-contrast:check` measures a registry of 25 pairs across both themes; start there rather than eyeballing tokens. Then check the two things it cannot see: a pairing that exists in CSS but has **no line in `PAIRS`** (grep the rule, add the line), and anything the arithmetic does not model — text over a gradient/image, `opacity` below 1, a colour arriving from `color-mix()`. The recurring defect is picking the wrong one of `--color-X` (on surface) / `-strong` (solid fill under white) / `-on-soft` (on the matching tint) — Issue #434, PR #720, twice more in ADR-0120. Lines split the same way: `--color-border-strong` on control boundaries (WCAG **1.4.11**, 3:1), `--color-border` on decorative separators only.
- [ ] **A11y WCAG 2.1 AA, the rest** — visible focus, an explicit label on every input, correct `aria-*`, modals trap focus + `Esc` (a native `<dialog>` + `showModal()` gives both free; the CSS-only sidebar drawer deliberately has neither), status not conveyed by colour alone. Target size ≥44px on the mobile portal and on touch-first controls; admin form controls are intentionally 38px (ADR-0120) — flagging that as a violation is a false positive. **Verifying contrast/CSP/real interaction requires a real browser** (headless Chrome/CDP) — curl/static HTML does not execute JS/CSS and therefore cannot detect an element that is visually non-functional (a real example: a wrong hand-written CSP hash once made the theme button not respond to clicks at all, Issue #437 — only caught through a real CDP session, not by a mental pass). Point that browser at a **built** server (`dist/standalone-entry.mjs`), not `astro dev` — dev mode injects CSS through a module script that this CSP blocks, so every dev screenshot is an unstyled page.
- [ ] **Keyboard-only** — every action reachable without a mouse; POS follows the F1–F10 map (doc 14); tab order is logical; skip-link where needed (`AdminLayout.astro`, Issue #434).
- [ ] **Perceived performance** — no layout shift (reserve space for images/tables), optimistic update with rollback (POS cart), no flash of the wrong theme, <100ms feedback for local actions.
- [ ] **Motion & entrance (doc 14 §Motion)** — animate via the `motion.css` tokens/keyframes; the entrance of primary content that is ALREADY present at SSR should be `transform`-only, not from `opacity:0` (axe can flag the contrast of half-transparent text if it scans before the animation finishes — the login card uses `@keyframes auth-card-rise`, translateY-only). `prefers-reduced-motion` is honoured; the reduced-motion block in `motion.css` targets its utility classes (not `*`), so scoped animations need their own local guard. An `opacity:0` fade (`.fade-in-up`) is still right for elements revealed after load / for secondary elements.
- [ ] **The shell owns the page title (ADR-0120)** — a screen that renders its own `<h1>` or a `page-header` block is a defect, not a style choice: it prints the name twice, and historically in two different languages. Title/description/primary action belong to `AdminLayout`'s header band and its `page-actions` slot.
- [ ] **Auth/login screens (doc 14 §Auth screen)** — all five are a split panel (`AuthBrandPanel.astro` + `.auth-form-panel`), the brand half `aria-hidden` and not rendered below 900px. `login.astro` follows the auth card pattern: stable DOM contract (`#login-form`/`#tenant-id`/`#login-identifier`/`#password`/`#login-submit`/`#login-error`), adaptive tenant field (single-tenant readout / `<select>` / manual), CSP-safe show/hide password toggle (`aria-pressed` + `aria-label`, wired non-inline), select caret via CSS (not a `data:` URI), `transform`-only card entrance. Do not regress the DOM contract, no inline handlers, no `opacity:0` on the card's primary text.
- [ ] **Token/markup consistency** — no hardcoded colours/sizes/spacing; use `--color-*`/`--sp-*`/`--fs-*`; follow the hand-rolled CSS classes already used by the other admin screens (`state-notice`, `admin-create-error`, `data-table`/`data-table-scroll`, `status-badge`) — this repo has no component library yet (`src/components/ui`), so consistency is enforced through identical classes/markup, not component reuse.
- [ ] **Dark/light parity** — both themes tested; equivalent contrast & readability; `data-theme` consistent.
- [ ] **Responsive** — admin is desktop-first but still usable on tablet; the customer portal is mobile-first; no accidental horizontal scroll; wide tables → scroll container (`overflow-x: auto`, Issue #434).
- [ ] **Form UX** — inline validation + a specific message per field (not just a banner), disable on submit + prevent double-submit (`lockElement` + `sendJson`, `src/lib/ui/admin-form-client.ts`, Issue #434 — disable the button + busy label for the duration of the request, reuse it rather than duplicating per page; importing from this module also forces Astro to bundle the script as an external file rather than inline, so it passes this repo's `default-src 'self'` CSP — see the comment at the top of the file), preserve input on error, correct autocomplete/inputmode.
- [ ] **Micro-copy & i18n-ready** — text is clear, concise, terminologically consistent (doc 19 glossary); see the `awcms-i18n` skill for the `.po` catalogue/locale/formatter detail — look for hardcoded strings that escaped an earlier extraction (small components such as the theme toggle are often missed, Issue #434).
- [ ] **Masking in the UI** — sensitive data goes through `MaskedText`; no raw PII cached in IndexedDB/localStorage.
- [ ] **Offline-first is visible** — connection status & sync queue are clear (`SyncIndicator`/`OfflineBanner`); actions are still stored locally while offline (doc 15).

## Usability heuristics (Nielsen, condensed)

Visibility of system status · match with the real world · user control & freedom (undo/cancel) · consistency & standards · error prevention (confirm destructive actions) · recognition over recall · flexibility (shortcuts) · minimalist design · error messages that help recovery · help/documentation where needed.

## Output

A ranked list of findings (a11y blocker → major → minor → polish), each finding with: location (file/component), impact on the user, and a suggested patch. Verification: the 4 states can be demonstrated, keyboard-only passes, axe/contrast passes AA (in a real browser, not just static HTML), no hardcoded strings/colours, no raw `fetch` (go through `sendJson` from `src/lib/ui/admin-form-client.ts` — use whatever is already on that page, do not mix patterns).

## Related skills

`awcms-ui-screen` (building screens to standard), `awcms-i18n` (`.po` catalogues, locale, formatters), `awcms-sensitive-data` (masking), `awcms-testing` (render/state tests), `awcms-performance` (load time & data fetching).
