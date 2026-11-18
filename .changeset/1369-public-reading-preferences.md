---
"awcms": minor
---

feat(public): a reading-preferences panel on every public page (Issue #1369, ADR-0166). A floating "Accessibility settings" button on `/blog/**`, `/{locale}/blog/**`, `/search` and the theme preview opens a non-modal dialog where a reader chooses text size (normal, large 120 %, extra large 140 %), high contrast, monochrome, dyslexia-friendly text, underlined links, highlighted links and reduced motion. It is a set of display preferences, not an overlay: it never rewrites content, injects ARIA, loads third-party code or claims conformance.

**Storage and privacy.** The choice lives only in the visitor's `localStorage` (`awcms-a11y`, `{"v":1,...}`) and is applied as `data-a11y-*` attributes on `<html>`. Nothing is sent to the server: no cookie, no request, no analytics event, no table, no endpoint. Unreadable storage or any invalid value means "nothing stored". With nothing stored, `prefers-contrast: more` and `prefers-reduced-motion: reduce` decide those two settings (also with JavaScript off); under `forced-colors: active` the high-contrast palette sets no colour.

**CSP unchanged.** Two same-origin scripts (`/js/a11y-early.js`, a blocking classic script that applies a saved choice before first paint, and `/js/a11y-panel.js`, deferred) and one stylesheet (`/css/public-a11y.css`); no inline script or style, no new origin, no new hash. The panel HTML is rendered by the server in the page's language (Indonesian by default, English for `en`) with the button `hidden` until the script reveals it, so a page without JavaScript is unchanged. `renderPublicPageShell`, `renderSearchPageDocument` and `PublicThemeLayout.astro` render it through `src/lib/ui/reading-preferences-panel.ts`. A change dispatches `awcms-a11y-change` on `document` for scripts that animate.

**Behaviour change for pages.** The `--fs-*` tokens in `public/css/public-content.css` are now `rem` instead of `px` so the text-size choice reaches them; at the default 16 px root they are pixel-identical.

**Budgets.** The three new files are reader weight: `READER_BUDGET_BYTES` 24,000 to 39,000 (measured 38,388 B, up 16,973 B) and `APP_BUDGET_BYTES` +590 B (the theme preview layout), with the measurement recorded beside each constant. This amends ADR-0101's ordering of the reader budget below the per-file cap; the corresponding test now asserts the two rules are independent.

**Tests.** `tests/reading-preferences.test.ts` runs the shipped early-apply script against a stand-in browser (valid, invalid, wrong version, throwing and blocked storage, OS defaults, round trip, reset) and checks the markup, the head tags and that the CSS and script agree on every attribute. `tests/e2e/public-reading-preferences.e2e.ts` covers focus, persistence across reload, each effect, axe with the panel open and with every preference on, and no horizontal overflow at 360 and 320 px with extra-large text. Usability testing with real readers is deferred to UAT.
