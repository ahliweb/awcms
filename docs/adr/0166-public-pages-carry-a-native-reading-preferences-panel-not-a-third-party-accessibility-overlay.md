🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0166-public-pages-carry-a-native-reading-preferences-panel-not-a-third-party-accessibility-overlay.id.md)

# ADR-0166 — Public pages carry a native reading-preferences panel, not a third-party accessibility overlay

- **Status:** Accepted
- **Date:** 2026-11-18
- **Decision maker:** ahliweb (owner; Definition-of-Ready gate passed for this slice on 2026-11-18)
- **Related:** Issue #1369; ADR-0095 (the interface speaks the reader's language); ADR-0098 (locale in the path); ADR-0101 (client asset budget splits by audience, amended below); `src/lib/security/security-headers.ts`; `tests/security-headers-csp.test.ts`

## Context

Public pages (`/blog/**`, `/{locale}/blog/**`, `/search`, the theme preview) are hand-rendered HTML shells. A reader can change what the browser offers — zoom, `prefers-color-scheme`, `prefers-contrast`, `prefers-reduced-motion` — but the page itself gives them no way to say "larger text", "stronger contrast", "stop the animation" or "make links obvious" once and have it remembered.

A product asked for a floating accessibility panel on a news-style site. The market answer is an **overlay widget**: one `<script>` from a vendor that injects a toolbar and rewrites the page. That route has three problems here:

- **Privacy and CSP.** It loads remote code on every page, and most such products report usage. This repo's policy is `default-src 'self'`, no `'unsafe-inline'`, one hash, zero third-party origins on the public surface. A widget needs at least a new `script-src` origin, usually `connect-src` and `img-src` too.
- **Claims it cannot back.** Overlays advertise conformance. Conformance is a property of the markup, not of a script that patches it afterwards. The public statement signed by accessibility practitioners (the Overlay Fact Sheet) records that overlays do not make a site conformant and commonly interfere with assistive technology.
- **Control.** The widget decides what the page does, and a vendor outage or a vendor change is a change to our public pages we did not review.

## Decision

**The public pages carry a native, same-origin reading-preferences panel. It is a set of display preferences the reader chooses, stored only on the reader's device. It is not an overlay.**

1. **Not an overlay.** The panel never rewrites content, never injects ARIA, never loads third-party code and never claims conformance. The pages must meet WCAG 2.2 AA in their own markup; the panel is supplementary, and no copy on it cites a law or a standard.
2. **No server, no tracking.** Preferences live in the visitor's `localStorage` under `awcms-a11y` and nowhere else: no cookie, no request, no analytics event, no table, no endpoint. The panel says so ("saved on this device only, never sent to the server").
3. **OS preferences are the default.** With nothing stored, `prefers-reduced-motion: reduce` and `prefers-contrast: more` decide those two settings. Under `forced-colors: active` the high-contrast palette sets no colour at all.
4. **Progressive enhancement.** The panel's HTML is rendered by the server in the page's language, with the floating button `hidden`. Only the script reveals it, so without JavaScript there is no control that does nothing, and the OS media queries still apply through CSS.
5. **Strict CSP untouched.** Two same-origin scripts and one same-origin stylesheet under `public/`; no inline script, no inline `style=""`, no new origin, no new hash.

### What the panel offers

Text size (normal, large 120 %, extra large 140 % of the root size), and six switches: high contrast, monochrome, dyslexia-friendly text, underline all links, highlight links, reduce motion. Plus "reset to defaults" and the device-only note.

| Preference             | Attribute on `<html>`             | Effect                                                                                                                                                       |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text size              | `data-a11y-text="large\|x-large"` | root font size 120 % / 140 %; all text is `rem`-based                                                                                                        |
| High contrast          | `data-a11y-contrast`              | colour tokens overridden with a palette of at least 7:1 text contrast (light: black on white; dark scheme: white on black); not applied under forced colours |
| Monochrome             | `data-a11y-mono`                  | `filter: grayscale(1)` on the **root element** only, because a filter on `body` would break `position: fixed`                                                |
| Dyslexia-friendly text | `data-a11y-dyslexia`              | system sans stack, WCAG 1.4.12 spacing (letter 0.12em, word 0.16em, line at least 1.5, paragraph 2em), start-aligned text; **no bundled "dyslexia font"**    |
| Underline links        | `data-a11y-underline`             | every `a[href]` underlined                                                                                                                                   |
| Highlight links        | `data-a11y-highlight`             | yellow `#ffeb3b` background with `#111` text (15.5:1)                                                                                                        |
| Reduce motion          | `data-a11y-motion="reduce"`       | `animation`, `transition` and smooth scrolling off                                                                                                           |

Storage value: `{"v":1,"text":"normal|large|x-large","contrast":bool,"mono":bool,"dyslexia":bool,"underline":bool,"highlight":bool,"motion":bool}`, where `motion: true` means _reduce_. Anything unreadable — blocked storage, invalid JSON, another version, an unknown value — is "nothing stored". A change dispatches `awcms-a11y-change` on `document` so a future ticker or carousel can stop itself.

### Where the code lives

| Piece                                                                                                                       | File                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Early-apply script (classic, blocking, in `<head>`; **the only owner of the storage contract**, exposes `window.awcmsA11y`) | `public/js/a11y-early.js`                                                      |
| Panel script (deferred; wires the dialog, no storage code of its own)                                                       | `public/js/a11y-panel.js`                                                      |
| Preferences and panel styles                                                                                                | `public/css/public-a11y.css`                                                   |
| Markup + head tags, Indonesian by default and English for `en`                                                              | `src/lib/ui/reading-preferences-panel.ts`                                      |
| Callers                                                                                                                     | `renderPublicPageShell`, `renderSearchPageDocument`, `PublicThemeLayout.astro` |

The early script is a **blocking** classic script on purpose: a saved preference has to be on `<html>` before first paint, and a deferred script would flash the default and re-flow. The shared module lives in `lib/ui`, not in a module's `domain/`, because three modules need it and none may import another's domain.

## Consequences

- **Positive:** readers get persistent text size, contrast, link emphasis and motion control with no data leaving the device; no third party sits on the public surface; CSP, cache keys and the data model are unchanged. The panel is rendered by the server and is identical for everyone, so it is exactly as cacheable as the page around it.
- **CSP impact: none.** `security-headers.ts` is not edited. The new scripts are covered by `script-src 'self'`, the stylesheet by `default-src 'self'`, and `tests/reading-preferences.test.ts` asserts that no emitted `<script>` lacks a `src` and that no asset names an origin.
- **Data and security impact: none beyond the browser.** No table, no endpoint, no permission, no RLS. Because there is no server state, the data-model, access-matrix, domain and API-contract steps of the product flow do not apply to this slice.
- **Reader weight rises, and the budget is raised on the measurement.** The three files cost 16,973 B on the reader surface (21,415 B to 38,388 B; about 5.2 kB gzipped). `READER_BUDGET_BYTES` goes from 24,000 to 39,000 and `APP_BUDGET_BYTES` from 384,870 to 385,460 (the theme preview layout, 493 B), each with the measurement written next to the constant, as ADR-0101 asks. This **amends** ADR-0101's neutral consequence that the reader budget stays below the per-file cap: the per-file rule (27,000 B) is now reachable on the reader surface too, which is the stricter direction, and the ordering test was replaced by one asserting both rules are independent.
- **Text size needed `rem`.** `public-content.css` expressed its `--fs-*` tokens in `px`, which a root font size does not scale. They are now `rem` (14, 16, 18, 20, 24, 32, 40 px at the default 16 px root: pixel-identical for everyone who does not use the panel). A tenant theme whose base size is in `px` is handled by `max(1rem, var(--_font-size))` on `body` once the reader chooses a larger size.
- **Negative / trade-off:** the preferences apply per browser and origin, not per account, and are lost if the reader clears site data. That is the price of storing nothing on a server, and the correct one.
- **Negative / trade-off:** `awcms-astro` renders its own public pages and does not get this panel from this change. The contract is the storage key and the `data-a11y-*` attributes, so the same panel can be adopted there without a server dependency; that is a decision for that repo.

## Alternatives considered

- **A third-party overlay widget.** Rejected for the three reasons in the Context: privacy and CSP, claims it cannot back, loss of control over what the public page does.
- **Rely on the browser only (zoom, OS settings).** Kept as the baseline, and the panel honours it. Rejected as the whole answer: it gives a reader no persistent, per-site choice and no way to turn links, spacing or motion on without changing every site's behaviour at once.
- **Store the choice server-side (cookie or account).** Rejected: it adds a request, a cookie and a cache variant to pages that are shared by everyone, for a preference that never needs to leave the device.
- **A bundled "dyslexia font".** Rejected: the controlled study found no reading-rate or accuracy benefit from a dedicated dyslexia font (Wery and Diliberto, _Annals of Dyslexia_, published online 2016). The measure that helps and is testable is spacing, which WCAG 1.4.12 already specifies.
- **Build the panel with the page's JavaScript framework or bundle it.** There is no client framework on public pages (ADR-0101). A hand-written classic script is the same shape as `js/news-share.js`. Minifying the three files through a generated, version-pinned bundle (the `blog-preview-overlay.js` pattern) would win part of the weight back, and is recorded as a follow-up rather than done here, because it adds a build gate.

## Gate note

The Definition-of-Ready gate for this slice was passed by the owner on **2026-11-18**. Usability testing with real readers (including assistive-technology users) is **deferred to UAT** before release readiness; automated coverage here is not a substitute for it.

## Follow-ups

- Usability test with real readers at UAT, before the release-readiness gate.
- Optional minification of the three files (a generated bundle) if the reader budget becomes the constraint.
- Eyebrow site name: list pages do not pass the site name to the shell, so the panel eyebrow shows only "Reader friendly" there and "Site · Reader friendly" on articles.
- The public shell's other strings ("Skip to content", "Previous") are still literal English; moving them and this panel to the gettext catalogue is a separate change.
- No live reaction to an OS preference changing while the page is open; a reload applies it.
- Adoption in `awcms-astro` is that repo's decision.

## Amendment (2026-11-19: usability testing moves to implementing repos)

Owner decision of **2026-11-19**: the upstream repos (`awcms`, `awcms-astro`, `awcms-one`) do not run UAT; UAT (step 14 of the development flow) is run in the implementing or derived project repos. This is consistent with [`docs/awcms/alur-pengembangan.md`](../awcms/alur-pengembangan.md) §14 and `docs/PROJECT_STATE.md` (steps 13-14 NOT APPLICABLE to this repo, owner decision of 13 August 2026).

The statements above that defer usability testing with real readers to UAT before the release-readiness gate (the "Gate note" and the first "Follow-up" bullet) are **replaced** by this: usability testing of the reading-preferences panel with real readers, including assistive-technology users, is **not a prerequisite of the release-readiness gate of this repo**. It is the responsibility of each implementing repo that adopts this feature, in its own UAT. Automated coverage here is still not a substitute for it. The decision itself (native panel, no overlay) is unchanged.
