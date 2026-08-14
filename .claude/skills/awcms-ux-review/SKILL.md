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
- [ ] **A11y WCAG 2.1 AA** — contrast ≥4.5:1 (text) / ≥3:1 (UI/graphics) — use `--color-*-strong` (Issue #434) for white text on solid colours, the plain variants are frequently <4.5:1; visible focus, an explicit label on every input, correct `aria-*`, dialogs trap focus + `Esc`, status not conveyed by colour alone, touch targets ≥44px on mobile. **Verifying contrast/CSP/real interaction requires a real browser** (headless Chrome/CDP) — curl/static HTML does not execute JS/CSS and therefore cannot detect an element that is visually non-functional (a real example: a wrong hand-written CSP hash once made the theme button not respond to clicks at all, Issue #437 — only caught through a real CDP session, not by a mental pass).
- [ ] **Keyboard-only** — every action reachable without a mouse; POS follows the F1–F10 map (doc 14); tab order is logical; skip-link where needed (`AdminLayout.astro`, Issue #434).
- [ ] **Perceived performance** — no layout shift (reserve space for images/tables), optimistic update with rollback (POS cart), no flash of the wrong theme, <100ms feedback for local actions.
- [ ] **Motion & entrance (doc 14 §Motion)** — animate via the `motion.css` tokens/keyframes; the entrance of primary content that is ALREADY present at SSR should be `transform`-only, not from `opacity:0` (axe can flag the contrast of half-transparent text if it scans before the animation finishes — the login card uses `@keyframes auth-card-rise`, translateY-only). `prefers-reduced-motion` is honoured; the reduced-motion block in `motion.css` targets its utility classes (not `*`), so scoped animations need their own local guard. An `opacity:0` fade (`.fade-in-up`) is still right for elements revealed after load / for secondary elements.
- [ ] **Auth/login screens (doc 14 §Auth screen)** — `login.astro` follows the auth card pattern: stable DOM contract (`#login-form`/`#tenant-id`/`#login-identifier`/`#password`/`#login-submit`/`#login-error`), adaptive tenant field (single-tenant readout / `<select>` / manual), CSP-safe show/hide password toggle (`aria-pressed` + `aria-label`, wired non-inline), select caret via CSS (not a `data:` URI), `transform`-only card entrance. Do not regress the DOM contract, no inline handlers, no `opacity:0` on the card's primary text.
- [ ] **Token/markup consistency** — no hardcoded colours/sizes/spacing; use `--color-*`/`--sp-*`/`--fs-*`; follow the hand-rolled CSS classes already used by the other admin screens (`state-notice`, `admin-create-error`, `data-table`/`data-table-scroll`, `status-badge`) — this repo has no component library yet (`src/components/ui`), so consistency is enforced through identical classes/markup, not component reuse.
- [ ] **Dark/light parity** — both themes tested; equivalent contrast & readability; `data-theme` consistent.
- [ ] **Responsive** — admin is desktop-first but still usable on tablet; the customer portal is mobile-first; no accidental horizontal scroll; wide tables → scroll container (`overflow-x: auto`, Issue #434).
- [ ] **Form UX** — inline validation + a specific message per field (not just a banner), disable on submit + prevent double-submit (`lockElement` + `sendJson`/`postJson`, `src/lib/ui/admin-form-client.ts`, Issue #434 — disable the button + busy label for the duration of the request, reuse it rather than duplicating per page; importing from this module also forces Astro to bundle the script as an external file rather than inline, so it passes this repo's `default-src 'self'` CSP — see the comment at the top of the file), preserve input on error, correct autocomplete/inputmode.
- [ ] **Micro-copy & i18n-ready** — text is clear, concise, terminologically consistent (doc 19 glossary); see the `awcms-i18n` skill for the `.po` catalogue/locale/formatter detail — look for hardcoded strings that escaped an earlier extraction (small components such as the theme toggle are often missed, Issue #434).
- [ ] **Masking in the UI** — sensitive data goes through `MaskedText`; no raw PII cached in IndexedDB/localStorage.
- [ ] **Offline-first is visible** — connection status & sync queue are clear (`SyncIndicator`/`OfflineBanner`); actions are still stored locally while offline (doc 15).

## Usability heuristics (Nielsen, condensed)

Visibility of system status · match with the real world · user control & freedom (undo/cancel) · consistency & standards · error prevention (confirm destructive actions) · recognition over recall · flexibility (shortcuts) · minimalist design · error messages that help recovery · help/documentation where needed.

## Output

A ranked list of findings (a11y blocker → major → minor → polish), each finding with: location (file/component), impact on the user, and a suggested patch. Verification: the 4 states can be demonstrated, keyboard-only passes, axe/contrast passes AA (in a real browser, not just static HTML), no hardcoded strings/colours, no raw `fetch` (go through `sendJson`/`postJson` from `src/lib/ui/admin-form-client.ts` — use whatever is already on that page, do not mix patterns).

## Related skills

`awcms-ui-screen` (building screens to standard), `awcms-i18n` (`.po` catalogues, locale, formatters), `awcms-sensitive-data` (masking), `awcms-testing` (render/state tests), `awcms-performance` (load time & data fetching).
