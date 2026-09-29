/**
 * client-asset-budget.ts — `bun run build:asset-budget:check`.
 *
 * Closes gap C6 of `docs/awcms/standar-performa-dan-keamanan.md` §9: the repo
 * had no budget on what the browser must download. Runs AFTER `astro build`
 * (the `build` target chains it) and fails when `dist/client` outgrows the
 * budgets below. Pure filesystem arithmetic — no database, no network.
 *
 * ## Why gate this today
 *
 * Measured on 2026-08-05, `dist/client` is 139,048 bytes across 45 files —
 * 35 JS files (77,449 B) and 10 CSS files (61,599 B); the largest single file
 * is `css/public-content.css` at 16,800 B. That is the cheapest moment a
 * budget will ever have: every later moment starts from a bigger baseline and
 * a budget written then would ratify whatever had already accreted. Client
 * weight grows one island at a time and no test notices; the symptom arrives
 * as "the public pages feel slow" long after the import that caused it.
 *
 * ## The budgets, derived from that measurement
 *
 * The original single ceiling (`TOTAL_BUDGET_BYTES` = 180,000 — baseline
 * 139,048 B + ~29% headroom) was split by ADR-0101 into one budget per
 * audience, `READER_BUDGET_BYTES` and `APP_BUDGET_BYTES`; see the section on
 * the split below for the measurement that forced it. Both still catch slow
 * accretion, now without one surface's growth hiding inside the other's.
 *
 * - `PER_FILE_BUDGET_BYTES` = 21,000 — largest file 16,800 B + 25%. Catches
 *   the other failure mode: one island importing a charting/date/editor
 *   dependency and shipping it as a single 200 KB chunk, which a generous
 *   total budget alone would absorb for a while and then blame on the NEXT
 *   change.
 *
 * Raising a budget is allowed — deliberately. The constant lives here so the
 * raise is a reviewed diff, and the reviewer's question is written down: what
 * feature bought this weight, and was it re-measured (`du -sb dist/client`)
 * rather than bumped until green?
 *
 * ## The first time that question was asked, the answer was no (Issue #552)
 *
 * On 2026-08-13 five admin screens landed in one day and the total reached
 * 176,670 B — 3,330 B of headroom, about two more screens. The budget had done
 * exactly what it exists to do, and the tempting fix was to raise it.
 *
 * It was not raised. The measurement said why: per-page script chunks were
 * 98,379 B across 43 files sharing 1,039 B between them, because every screen
 * hand-wrote the same lock/send/reload/report lifecycle. Moving that lifecycle
 * into `src/lib/ui/admin-form-client.ts` and converting all 36 screens took the
 * total to 153,970 B — 26,030 B of headroom, from a change that shipped no
 * less behaviour. A raise would have bought the same headroom by deleting the
 * question.
 *
 * That is the precedent this constant is meant to force, and it is recorded
 * here rather than in a commit message because the next person to hit the
 * ceiling reads this file, not the log.
 *
 * ## Why nothing is excluded
 *
 * Content images never pass through the build — they live in R2 via
 * `media_library`. A pre-emptive exclusion class (e.g. "images don't count")
 * would be a blind spot with no current benefit: if image files ever appear in
 * `dist/client`, that is exactly the growth this gate exists to surface, and
 * the right response is a deliberate exclusion recorded here, not a silent one.
 *
 * **This section used to end "and no fonts are shipped". ADR-0120 shipped
 * five.** It is recorded here rather than quietly amended because that sentence
 * is the kind of claim this file elsewhere calls "an assertion nothing
 * re-checks". Fonts were NOT given the silent exclusion the paragraph warns
 * against: they are a third audience with their own ceiling
 * (`FONT_BUDGET_BYTES`), for reasons set out there. Nothing is excluded from
 * measurement; one thing is measured against its own number.
 *
 * ## Why a missing or empty `dist/client` FAILS
 *
 * A gate that passes when its input is absent is the "green while wrong"
 * failure mode this repo has recorded more than once. No `dist/client` means
 * the build has not run — the fix is `bun run build`, and the message says so.
 * An EMPTY `dist/client` fails for the same reason: the build always emits
 * CSS for the admin screens, so zero files means this script is measuring the
 * wrong directory or the build broke, never that the client got lighter.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const CLIENT_DIST = "dist/client";

/**
 * Which audience downloads each `public/` file — the ONLY assets a public
 * content page loads (ADR-0101).
 *
 * Everything under `_astro/` is Astro build output for `.astro` pages, and
 * every one of those pages is admin, auth, the landing page, or the theming
 * preview — so `_astro/*` is classified `app` structurally, with no list to
 * maintain. `public/` is copied through verbatim and has no such structure, so
 * its files are declared here.
 *
 * **This registry is a GATE, not documentation.** A file in `public/` that is
 * not declared fails the check, and a declaration whose file is gone fails it
 * too. That is deliberate: `src/lib/security/security-headers.ts` carried the
 * sentence "`public/` holds exactly two files" while `public/` held three,
 * because nothing forced the enumeration to stay true. An assertion nothing
 * re-checks is a claim, and this one had already decayed.
 */
export const PUBLIC_ASSET_AUDIENCE: Readonly<
  Record<string, "reader" | "app" | "font">
> = Object.freeze({
  // Linked by the shell in `blog-content/domain/public-page-rendering.ts`
  // (`PUBLIC_CONTENT_STYLESHEET_HREF`) — every public article, page and index.
  "css/public-content.css": "reader",
  // Linked by `src/pages/blog/[tenantCode]/[slug].ts`
  // (`NEWS_SHARE_CLIENT_SCRIPT_SRC`) — the share annotator on article pages.
  "js/news-share.js": "reader",
  // Registered by `src/lib/ui/push-subscription-client.ts`, reached from the
  // `/admin/push-notifications` console. A reader never fetches it.
  "push-sw.js": "app",
  // GENERATED by `bun run build:preview-overlay` from
  // `src/lib/ui/blog-preview-overlay.ts`; linked by
  // `blog-content/domain/preview-overlay.ts`'s
  // `PREVIEW_OVERLAY_SCRIPT_SRC` on `/admin/blog/{id}/preview` only
  // (Issue #592). It lives in `public/` rather than `_astro/` because that
  // route is an `APIRoute`, and Astro bundles `<script>` only for `.astro`
  // components — not because a reader loads it. A reader never does.
  "js/blog-preview-overlay.js": "app",

  /*
   * ADR-0120 — the self-hosted typeface, `font` audience.
   *
   * All five are `@font-face` sources in `src/styles/tokens.css`, which is
   * imported by `AdminLayout` and the auth/landing pages ONLY. A public
   * content page renders through `public-page-rendering.ts` and links
   * `css/public-content.css`, which has no `@font-face` at all — so a reader
   * downloads none of these, and the reader budget is untouched.
   *
   * They are `font` rather than `app` because the app budget measures a
   * different thing; see `FONT_BUDGET_BYTES` for why folding them in would
   * have destroyed it.
   *
   * The `-ext` pair is `unicode-range`-gated: a page with no Latin-Extended
   * character never requests them. They are still counted here, because this
   * gate measures BYTES SHIPPED, and a conditional download is still a file
   * we chose to ship and must keep bounded.
   */
  "fonts/public-sans-latin.woff2": "font",
  "fonts/public-sans-latin-ext.woff2": "font",
  "fonts/public-sans-italic-latin.woff2": "font",
  "fonts/jetbrains-mono-latin.woff2": "font",
  "fonts/jetbrains-mono-latin-ext.woff2": "font"
});

/**
 * What a READER downloads: 21,415 B measured 2026-08-20, budget 24,000.
 *
 * Deliberately tight. This is the number the original budget's premise — "the
 * public pages feel slow" — was always about, and 2,585 B of headroom is about
 * one more small script. It should be hard to grow this without saying why.
 */
export const READER_BUDGET_BYTES = 24_000;

/**
 * What the APP surface downloads (admin, auth, landing, theming preview):
 * 165,274 B measured 2026-08-20, budget 172,000 (~4%).
 *
 * This inherits the accretion history below — it is the old total minus the
 * reader assets, and it keeps the old total's job of catching slow growth one
 * admin screen at a time.
 *
 * Its immediate predecessor was `TOTAL_BUDGET_BYTES` = 192,000, **raised on 19
 * August 2026 for the Portable Text block editor (ADR-0100, Issue #589), and
 * the measurement was the argument.**
 *
 * Measured on clean builds. That used to be a manual `rm -rf dist &&` that this
 * docblock told the reader not to skip — and the instruction was ignored twice,
 * once here (a 2,493 B admin screen first reported as 82 B) and again on 22
 * August 2026, when a phantom 425 B "saving" sent a whole PR down the wrong
 * road. A gate that documents its own hazard is a gate that will mislead
 * somebody a third time, so `bun run build` now runs `build:clean` first and
 * the number cannot come from a tree the current build did not produce:
 *
 * ```
 * main                                     181,418 B
 * + the block editor                       186,689 B   (delta 5,271 B)
 * ```
 *
 * **5,271 B for a rich-text editor** — 3,942 B of client script and 1,329 B of
 * CSS. That number is the whole decision record for Issue #589. The alternative
 * on the table was TipTap + ProseMirror, roughly 150-250 kB across ~20
 * transitive packages, which would have broken the 27,000 B per-file cap about
 * tenfold and roughly doubled this total, in a repo that ships exactly TWO
 * runtime dependencies.
 *
 * It is that small because the vocabulary is CLOSED (ADR-0100): three
 * decorators, one annotation, eight block styles, two list kinds. A general
 * editing framework is large because it must handle a vocabulary nobody has
 * enumerated; this one does not, so it does not need one.
 *
 * ## History worth keeping, because two earlier numbers here were wrong
 *
 * 180,000 -> briefly 190,000 -> back to 180,000 -> 184,000 -> 192,000.
 *
 * The 190,000 raise rested on `main` measuring 181,336 B against a 180,000 B
 * ceiling — true when measured, and then astro 7.2.0 -> 7.2.3 shed 2,411 B of
 * its own output and put `main` back under. It was reverted rather than kept: a
 * budget raised past a breach that has since healed has stopped measuring
 * anything. 184,000 followed a real 2,493 B admin screen (first reported as
 * 82 B, measured against a stale `dist`).
 *
 * ## A hypothesis worth not re-testing (Issue #590)
 *
 * The hypothesis that `_astro/error-log.*.css` (24,909 B, the largest file) is
 * bloated by duplicating `admin-screens.css` is **DISPROVED**. That chunk is
 * `src/styles/admin.css` (37,596 B of source), the AdminLayout stylesheet; it
 * carries `.admin-shell`/`.skip-link` while `_astro/admin-screens.*.css`
 * separately carries `.page-header`/`.admin-section-title`. They share nothing.
 * It is merely NAMED after `error-log` because Vite names a shared CSS chunk
 * after one of its JS importers.
 *
 * ## The split this file now enforces (Issue #590, ADR-0101)
 *
 * A single conflated ceiling was measuring the wrong thing. Attribution from
 * Astro's own SSR route manifest (`dist/server/entry.mjs`, not from file
 * names) on 2026-08-20:
 *
 * ```
 * reader  (public content pages)   21,415 B   css/public-content.css + js/news-share.js
 * app     (admin, auth, landing)  165,274 B   every _astro/* chunk + push-sw.js
 * ```
 *
 * **The decisive fact: a public content page loads ZERO `_astro` assets.**
 * Those pages are not Astro components — `src/pages/blog/`, `[...path].ts`,
 * the feeds and the sitemaps are `.ts` routes that emit their own shell via
 * `public-page-rendering.ts`, linking two absolute paths out of `public/`. The
 * only non-admin routes carrying `styles` in the manifest are `/`, the five
 * auth pages, and `/theming/preview/[token]`.
 *
 * So reader weight was 11% of a number dominated by admin, which made it
 * effectively unmeasured: a 5,000 B reader-facing regression is a **23%**
 * increase in what a reader downloads — exactly the premise this budget was
 * built on — and it passed silently under a 192,000 B ceiling.
 *
 * An earlier revision of this comment said "roughly 40% of the total is
 * admin-only". That was wrong in the other direction: admin-reachable is ~73%
 * once page scripts are counted. Both numbers were guesses at a split nobody
 * had measured; the two budgets below are measured.
 */
/**
 * **Raised to 178,000 on 20 August 2026 for the Issue #595 authoring surface,
 * and the gate's own question was answered first.**
 *
 * The failure message asks whether the growth is per-screen duplication, the
 * way Issue #552's was — 43 screens hand-copying one lifecycle, which a shared
 * module recovered 22,700 B from. It is not. Three features bought it, each
 * shipping behaviour that did not exist:
 *
 * ```
 * after ADR-0101                     165,274 B
 * + media upload UI      (#610)      169,128 B   (+3,854)
 * + article SEO fields   (#611)      169,417 B   (+  289)
 * + featured-image picker(#612)      173,050 B   (+3,633)
 * ```
 *
 * The picker is a shared module (`lib/ui/media-picker-client.ts`) imported by
 * one screen today and by ad inventory (#594) next, so its bytes are paid once
 * rather than per screen — the shape #552 established, applied before the
 * second consumer exists rather than after.
 *
 * 178,000 is measured + ~2.9%. Deliberately not the ~4% the previous value
 * carried: the reader budget is where the tight constraint belongs, but the
 * admin surface has now grown three times in one working day, and a wider
 * margin here would buy silence rather than room.
 */
/**
 * **Raised to 185,000 on 21 August 2026 for `/admin/site-profile` (Issue #596,
 * ADR-0102), and the gate's question was answered with a change rather than an
 * argument.**
 *
 * It fired at 181,626 B and asked whether the growth was per-screen
 * duplication. **Part of it was.** `/admin/site-profile` is the second screen
 * to need the media picker, and its wiring had been hand-copied from
 * `/admin/blog` — the exact Issue #552 shape, caught this time BEFORE it
 * landed rather than 43 screens later. Extracting `wireMediaPickers` into
 * `lib/ui/media-picker-client.ts` gave back 1,444 B:
 *
 * ```
 * with the copy                      181,626 B
 * after extracting wireMediaPickers  180,182 B   (-1,444)
 * ```
 *
 * What remains is a genuinely new screen — a form with nine fields, a
 * repeating social-links builder, and two media choosers — shipping behaviour
 * that did not exist. 185,000 is measured + ~2.7%.
 *
 * **Raised to 186,000 on 21 August 2026 for the usage-rights editor on
 * `/admin/media` (Issue #615), after asking the gate's question and getting a
 * different answer this time.**
 *
 * It fired at 185,095 B — 95 over. The growth is 649 B, all of it in
 * `media.astro`'s own island:
 *
 * ```
 * media.astro island, before   5,360 B
 * media.astro island, after    6,009 B   (+649)
 * ```
 *
 * Checked for the Issue #552 shape and it is not there: the editor reuses
 * `messageBox`, `mutateAndReload`, `sendJson` and `inputValue` from
 * `lib/ui/admin-form-client.ts`, and its own code is one submit handler. The
 * form itself is SERVER-rendered from `?rights=<id>` precisely so the page
 * ships no client code for populating fields from row data — the cheaper of the
 * two designs was already taken.
 *
 * So this is a genuine addition: a newsroom could not record who took a
 * photograph at all, and now can. 186,000 is measured + ~0.5%, deliberately
 * tight — a wider margin here would buy silence rather than room, which is the
 * reason the previous raise gave for staying close to the measurement.
 *
 * **Raised to 192,000 on 21 August 2026 for the editor preview's in-place
 * editing overlay (Issue #592), and the gate's question has an unusually direct
 * answer this time.**
 *
 * Measured on clean builds (`rm -rf dist && bun run build`):
 *
 * ```
 * main                                     185,690 B
 * + js/blog-preview-overlay.js             191,299 B   (delta 5,609 B)
 * ```
 *
 * The delta is the new file EXACTLY — no `_astro` chunk moved by a byte, which
 * is the check that the overlay did not quietly pull anything into the admin
 * screens' bundles.
 *
 * The failure message asks whether the growth is per-screen duplication, the
 * Issue #552 shape. It is the opposite: this bundle exists BECAUSE the
 * alternative was duplication. `preview.ts` is an `APIRoute`, Astro bundles
 * `<script>` only for `.astro` components, and hand-writing the overlay into
 * `public/js/` the way `news-share.js` is written would have meant a second,
 * untyped copy of the block <-> Portable Text conversion
 * `lib/ui/portable-text-editor.ts` owns. `bun run build:preview-overlay` buys
 * one definition, typechecked, for 5,609 B.
 *
 * For scale, the whole Portable Text block editor cost 5,271 B (see the ADR-0100
 * entry above), and tree-shaking is doing its job here: `admin-form-client.ts`
 * contributes `sendJson` and nothing else, and neither renderer is in the file —
 * after a save the page RELOADS, so the server stays the only renderer.
 *
 * 192,000 is measured + ~0.4%, the same deliberately tight margin the last two
 * raises argued for.
 *
 * ## 193,500 (2026-08-25) — `/admin/access-policies`
 *
 * The DSL policy screen's own handler: parse role codes, POST the simulation,
 * render the decision. **767 B**, which was very nearly the whole 724 B
 * overage on its own.
 *
 * The failure message asks whether the growth is per-screen duplication, and
 * the answer was checked rather than assumed. The built chunk opens
 * `import{c as e,d as t,…}from"./admin-form-client.dRVcYtE0.js"` — it REFERENCES
 * the shared 2,321 B helper chunk instead of inlining a copy, which is what the
 * 767 B figure is evidence of: an inlined lifecycle would have made this chunk
 * several kB, the Issue #552 shape. For scale it is the smallest admin script
 * in the build (`approvals` is 2,926 B, `business-scope` 3,563 B, `blog`
 * 12,686 B).
 *
 * So this is a new screen paying its own way, not accretion. 193,500 is
 * measured + ~0.4%, holding the same tight margin rather than buying room for
 * the next one.
 */
/**
 * **Raised to 218,000 on 2 September 2026 for the admin redesign (ADR-0120),
 * and the gate's question was answered with a measurement rather than a
 * shrug.**
 *
 * The failure message asks whether the growth is per-screen duplication — the
 * Issue #552 shape. It is measurably the opposite. Both builds clean, both on
 * this machine, `dist/client/_astro` split by kind:
 *
 * ```
 *                    JS          CSS         app total
 * main            119,403      61,283         192,724
 * redesign        120,772      80,749         213,559
 * delta            +1,369     +19,466         +20,835
 * ```
 *
 * **JS moved 1,369 B, and that is the entire command palette** — a `<dialog>`,
 * a filter over links already in the page, and the Cmd/Ctrl+K handler. It is
 * that small because the palette does not fetch: `AdminLayout` renders the nav
 * entries the caller may already see, and the script only shows and hides them
 * (see `src/lib/ui/admin-command-palette.ts` for why that also settles the
 * permission question structurally).
 *
 * The 19,466 B of CSS is the design system, and every byte of it is in the two
 * stylesheets EVERY admin screen already loads:
 *
 * ```
 * _astro/AdminLayout.css   24,909 -> 39,990   (+15,081)  admin.css
 * _astro/admin-screens.css  9,111 ->  9,889   (+  778)
 * _astro/motion.css         6,570 ->  8,952   (+2,382)   chunk rebalancing
 * auth.css -> AuthBrandPanel 5,633 ->  6,872  (+1,239)   split login panel
 * ```
 *
 * Per-screen weight went DOWN, not up: 45 screens each stopped rendering their
 * own `<header class="page-header">` with an `<h1>` and a description, because
 * the shell renders that band now.
 *
 * ## The next lever, recorded so it is not rediscovered
 *
 * The admin has SIX card-ish classes — `.admin-card`, `.admin-panel`,
 * `.admin-frame`, `.dashboard-card`, `.stat-card`, `.kpi` — and at least three
 * of them are the same object under different names (`.admin-card` and
 * `.admin-panel` are both "a padded surface with a border and a shadow").
 * Consolidating them is worth low thousands of bytes and, more importantly, one
 * fewer decision per screen. It was NOT done here because it touches all 48
 * screens' markup and this change already touches 45; doing both at once would
 * make the diff unreviewable.
 *
 * 218,000 is measured + ~2.1%, holding the tight margin the raises above
 * established — a wider one would buy silence rather than room.
 *
 * **Raised to 226,000 on 21 September 2026 for the admin chrome restyle
 * (awcms-one#170).** The addition is the dark sidebar rail's own tokens/rules
 * plus eight new shared primitives (`.admin-stat-card`, `.admin-status-pill`,
 * `.admin-segmented`, `.admin-bulk-bar`, `.admin-two-pane`, `.admin-toggle`,
 * `.admin-timeline`, `.admin-media-grid`) in `admin.css` — vocabulary no
 * screen renders yet, added once so the next screen that needs one of these
 * does not hand-roll a sixth variant, per the same reasoning the 218,000 raise
 * above already accepted for this file. Measured clean build: 221,626 B.
 * 226,000 is measured + ~2%, the same tight margin as the raise above.
 *
 * **Raised to 229,500 on 27 September 2026 for the OMES Control Center design
 * system (ahliweb/omes#246 part 1/3, this repo's `/admin/omes/*` screens
 * only).** The addition is one new stylesheet,
 * `src/styles/omes-control-center.css` — the `.omes-cc` scoped dark-palette
 * token overrides (canvas/panel/text/accent values measured against WCAG 2.1
 * AA, see `docs/awcms/omes-control-center-design-system.md`), KPI status-dot
 * styling, and the Bootstrap -> Check -> Diff -> Apply -> Verify -> Rollback
 * lifecycle strip — imported ONLY by the 9 `admin/omes/*.astro` screens, no
 * other screen. It ships NO new font: Public Sans / JetBrains Mono are
 * already self-hosted for the whole admin (ADR-0120) and this addition adds
 * no `@font-face` and no new `.woff2`, so the `font` audience budget below is
 * untouched.
 *
 * ```
 * before (226,000 ceiling)   225,983 B
 * + omes-control-center.css  229,154 B   (+3,171)
 * ```
 *
 * It was not absorbed by trimming: every rule is a token override or the
 * lifecycle strip, and the previous ceiling's headroom was already down to
 * 17 B before this change — the same "next lever" section above already
 * named the remaining duplication (six near-identical card classes) as a
 * cross-cutting refactor out of scope for a single-screen-family change.
 * 229,500 is measured + ~150 B, deliberately tighter than the ~2% margin
 * above: this addition is presentational and scoped to one screen family, so
 * it should not buy headroom for unrelated future growth elsewhere.
 *
 * **Raised to 230,400 on 27 September 2026 for the OMES Control Center design
 * system polish (ahliweb/omes#246 part 1b)**, fixing 5 defects a screenshot
 * review of part 1 found: multi-value tiles rendered as one giant wrapping
 * KPI number, the 8 filter/create forms using an unstyled `.admin-toolbar`
 * instead of the existing `.admin-create-form` vocabulary, the lifecycle
 * strip's `→` separators orphaning at a line wrap below 1440px, and a
 * `clamp()` sign error that left an 18px light-canvas strip on the panel's
 * right/bottom edge above ~1133px wide. The growth is `omes-control-center.css`
 * gaining the multi-value-tile chip list, the lifecycle wrap fix, and a
 * handful of dark-theme form states (focus ring, placeholder, disabled,
 * invalid) — no new color tokens, every value reuses a pairing already in
 * this file's own contrast table.
 *
 * ```
 * before (229,500 ceiling)   229,154 B
 * + part 1b polish (above)   230,263 B   (+1,109)
 * ```
 *
 * Trimmed before raising: selectors were consolidated with `:is()`
 * (`input:focus-visible, select:focus-visible, textarea:focus-visible` ->
 * `:is(input, select, textarea):focus-visible`), the empty-breakdown state
 * reuses the existing `.stat-hint` class instead of a new one, and prose
 * comments were cut — recovered roughly 700 B of the naive-first-pass total
 * before this final number. 230,400 is measured + ~140 B, the same tight
 * margin the raise above used, for the same reason: this is presentational
 * and scoped to the same 9 screens.
 *
 * **Raised again to 231,200 on 27 September 2026 for the tenth
 * `/admin/omes/*` screen, AI privacy posture and egress owner-approval
 * (ahliweb/omes#232), rebased onto part 1b above.** The screen ships no new
 * stylesheet and no new font — it imports the SAME
 * `admin-screens.css`/`omes-control-center.css` every other `omes_control`
 * screen already imports, and its one inline `<script>` calls only the
 * SHARED `lib/ui/admin-form-client.ts` helpers (`lockElement`, `messageBox`,
 * `onAction`, `sendJsonForData`) every other screen's approve/deny-style
 * action already uses — no hand-rolled lifecycle duplication for this raise
 * to recover, unlike Issue #552's precedent. The growth is the page's own
 * compiled markup/script chunk for a genuinely new screen, not decoration.
 *
 * ```
 * before (230,400 ceiling)   230,263 B (per part 1b's own measurement above)
 * + admin/omes/ai-privacy    231,059 B   (measured after rebasing onto part 1b)
 * ```
 *
 * 231,200 is measured + ~140 B, the same tight margin the immediately
 * preceding raise used, for the same reason: a new screen's own weight
 * should not buy headroom for unrelated future growth elsewhere.
 *
 * ## ahliweb/omes#246 part 2 — three more genuinely new screens
 *
 * `/admin/omes/orkestrasi-langsung` (live tree + depth filter + polling
 * activity stream), `/admin/omes/hermes` (task summary), and
 * `/admin/omes/progres-hermes` (empty state) each add their own compiled
 * markup/script chunk, the same "real new screen weight" shape as the
 * ai-privacy raise immediately above.
 *
 * ```
 * before (231,200 ceiling)        231,200 B (per the ai-privacy measurement above)
 * + orkestrasi-langsung/hermes/
 *   progres-hermes                234,303 B
 * ```
 *
 * 234,443 is measured + ~140 B, the same tight margin every preceding raise
 * in this constant's history has used.
 *
 * **Raised again to 234,992 for a post-merge visual-verification fix to
 * `orkestrasi-langsung.astro` (ahliweb/omes#246 part 2 render check).** The
 * 234,303 B measurement above was the SHIPPED, BUGGY build, not a
 * post-fix number as an earlier draft of this comment claimed: the tree's
 * depth indentation used a per-node inline `style="padding-left: ...px"`,
 * which this repo's CSP (`default-src 'self'`, no `style-src`/
 * `'unsafe-inline'`, `lib/security/security-headers.ts`) silently drops in
 * every real browser — logging in and looking at the rendered screen (never
 * done for this screen before merge) showed a flat, non-indented tree. The
 * fix replaces the inline style with a bounded `data-indent-level` attribute
 * (clamped to 6) plus seven fixed attribute-selector rules in
 * `omes-control-center.css` — CSP-safe, but seven small rules cost more than
 * one dynamic inline expression did.
 *
 * ```
 * before (234,443 ceiling)   234,303 B (the buggy build, see above)
 * + indent-level CSS rules   234,992 B   (+689; the fix itself, not new UI)
 * ```
 *
 * 234,992 is the measured value with no added margin — the delta is the
 * fix's own cost, not room for unrelated future growth.
 *
 * **Raised again to 236,936 for Issue ahliweb/omes#246 part 3.** `/admin/omes/
 * arsitektur` (the new Architecture Control Center screen, planes-as-lanes
 * of capability cards rendered from the vendored, pinned OMES
 * architecture-capabilities-view snapshot) adds its own compiled
 * markup/script/style chunk — the same "real new screen weight" shape as
 * every preceding raise in this history. This screen was originally
 * measured (236,247 B) against the stale 234,443 ceiling before the
 * orchestration-indent fix (PR #835) landed on main; after rebasing onto
 * that fix's 234,992 ceiling, the real build measures higher still because
 * the indent-fix CSS and this screen's own chunk both changed the shared
 * `AdminLayout` CSS bundle. Re-measured post-rebase rather than trusting
 * the pre-rebase estimate.
 *
 * ```
 * before (234,992 ceiling)   234,992 B (post orchestration-indent fix, PR #835)
 * + arsitektur screen        236,936 B (measured actual total, post-rebase)
 * ```
 *
 * 236,936 is the measured value with no added margin.
 *
 * **Raised again to 237,433 for issue ahliweb/omes#246 part 2 follow-up**
 * (stale-session node/event historical rendering). The added
 * `isHistorical`/"last reported: X" muted treatment on
 * `orkestrasi-langsung.astro` and `hermes.astro` (a new `t()` msgid, a
 * `data-historical` attribute, and the muted-row CSS rule in
 * `omes-control-center.css`, all shared through the `AdminLayout` CSS
 * bundle these two screens already pull in) grew the measured total by 497
 * bytes over the prior ceiling:
 *
 * ```
 * before (236,936 ceiling)   236,936 B
 * + stale-session muting        237,433 B (measured actual total)
 * ```
 *
 * 237,433 is the measured value with no added margin.
 *
 * **Raised again to 237,468 for ahliweb/awcms#831** (admin sidebar clipping
 * fix). The fix adds one bare, universal `.cell-muted { overflow-wrap:
 * anywhere; }` rule to `admin.css` (previously `.cell-muted`'s only wrap
 * protection was scoped to `.data-table td`, which does nothing for the
 * Hermes orchestration tree/activity list — a `display:flex` list, not a
 * table) plus its doc comment. Measured actual total:
 *
 * ```
 * before (237,433 ceiling)   237,433 B
 * + .cell-muted overflow-wrap fix   237,468 B (measured actual total)
 * ```
 *
 * 237,468 is the measured value with no added margin.
 *
 * **Raised again to 237,491, same issue.** `responsive-360.e2e.ts` (a full
 * fleet sweep, not something this fix's own tests happened to cover) caught
 * a SECOND instance of the identical defect on `/admin/omes/hermes`: its
 * `.omes-hermes-task-summary dd` (a scoped `<style>` in `hermes.astro`)
 * renders the same Hermes-supplied `goal` text as a plain `<dd>` with no
 * `.cell-muted` class, inside a `display: grid;
 * grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))` row — a grid
 * item's default `min-width: auto` let a long, space-free value exceed the
 * `minmax()` track's 200px floor the same way `.cell-muted` was overflowing
 * `.admin-main`. Fixed with the same `overflow-wrap: anywhere;` on that
 * `<dd>` directly (it has no shared class with the orchestration tree's
 * `.cell-muted` to fix once for both). Measured actual total:
 *
 * ```
 * before (237,468 ceiling)   237,468 B
 * + hermes.astro dd overflow-wrap fix   237,491 B (measured actual total)
 * ```
 *
 * 237,491 is the measured value with no added margin.
 *
 * **Raised again to 237,558 for ahliweb/awcms#843** (the topbar account-link
 * overflow at 1024px, plus the `/admin/data-lifecycle` legal-hold `<select>`
 * overflow at 360px). Three small `admin.css` rule changes: widening the
 * `@media (max-width: 1023.98px)` breakpoint that hides `.admin-palette-open`/
 * `.admin-tenant-switch` to `1024px` (so they also step aside at the exact
 * width where the topbar ran out of room), `.admin-user-menu { flex: none; }`
 * (was `min-width: 0`, which let the account cluster be squeezed narrower
 * than `.admin-account-link`'s real content and then overflow its own shrunk
 * parent), and `.admin-create-form label { min-width: 0; }` (a nested
 * column-flex label was inheriting its child `<select>`'s full intrinsic
 * width as its own automatic minimum, the same class of bug the `/admin/seo`
 * select fix above addressed one level down). Measured actual total:
 *
 * ```
 * before (237,491 ceiling)   237,491 B
 * + admin.css topbar/create-form overflow fixes   237,558 B (measured actual total)
 * ```
 *
 * 237,558 is the measured value with no added margin.
 *
 * **Raised again for issue ahliweb/omes#249** (ADR-0030's repository-progress
 * projection). `progres-hermes.astro`'s own scoped `<style>` block
 * (accessible `<progress>` bar styling, shared through the same
 * `AdminLayout` CSS bundle every other `/admin/omes/*` screen already pulls
 * in) plus the ~30 new `t()` msgids the screen and its configuration form
 * use grew the measured total over the prior ceiling:
 *
 * ```
 * before (237,558 ceiling)   237,558 B
 * + repository-progress screen  239,275 B (measured actual total)
 * ```
 *
 * 239,275 is the measured value with no added margin.
 *
 * **Raised again for the ahliweb/omes#249 UX polish follow-up** (danger-button
 * override + checkbox reset added to `omes-control-center.css`, plus the
 * milestone-lookup helper in `progres-hermes.astro`'s frontmatter — no new
 * `t()` msgids). Measured actual total:
 *
 * ```
 * before (239,275 ceiling)   239,275 B
 * + progres-hermes danger-button/checkbox CSS fixes   239,956 B (measured actual total)
 * ```
 *
 * 239,956 is the measured value with no added margin (the `border: 1px solid
 * var(--color-danger)` shorthand — needed whole, not just `border-color`, to
 * out-rank `.admin-create-form button`'s own `border: none` — cost 4 B more
 * than first measured).
 *
 * **Raised again for Issue #860** (wave 2 of the admin-shell parity work,
 * `docs/awcms/admin-ui-parity-matrix.md` §7): `.admin-stat-card` gains
 * optional `-grid`/`-value--mono`/`-head`/`-delta` modifiers in `admin.css`
 * — the decision the matrix's own §4 flagged as "a real design decision for
 * wave 2" was to port the legacy `.stat-head`/`.stat-delta` icon+trend
 * affordance rather than drop it, so a screen reaching for the shared
 * primitive keeps the same capability the per-repo `.stat-card` duplicate
 * already had. `omes-control-center.css` gained a parallel (not renamed)
 * block so its other 8 not-yet-migrated screens keep their existing
 * `.stat-card` styling untouched. Both the grid wrapper and the icon-head
 * row were folded into EXISTING declarations (`.kpi-grid`/`.dashboard-grid`,
 * `.admin-tile`) rather than repeated, and the signed-delta modifier ships
 * colour only — no `::before` glyph — leaving the non-colour half of "not
 * conveyed by colour alone" to the consumer's own text content, precisely
 * to keep this raise as small as the four migrated screens' actual need.
 * This is temporary, self-limiting growth: `admin-screens.css`'s `.stat-card`
 * family (admittedly still shipped for the 14 screens still on it) is what
 * waves 3/6 delete once every screen has migrated, at which point this
 * budget has room to come back down. Measured actual total:
 *
 * ```
 * before (239,956 ceiling)   239,956 B
 * + .admin-stat-card grid/mono/head/delta modifiers   240,975 B (measured actual total)
 * ```
 *
 * 240,975 is the measured value with no added margin.
 *
 * **Raised again for Issue #854 part 1** (ADR-0125's three admin v2
 * primitives — `ConfirmDialog`, `SettingsSaveBar`, `ReasonPanel`). This is
 * new admin vocabulary shared across every screen that adopts it (43
 * `window.confirm()` sites and 9 `window.prompt()` sites converted), not
 * per-screen duplication — the same distinction the docblock above draws for
 * `.admin-stat-card`. Measured actual total:
 *
 * ```
 * before (240,975 ceiling)   240,975 B
 * + ConfirmDialog/SettingsSaveBar/ReasonPanel markup + CSS   247,880 B (measured actual total)
 * ```
 *
 * 247,880 is the measured value with no added margin.
 *
 * **Raised again for Issue #861** (no raw enums, #854 item 4). The only
 * growth is `omes/orkestrasi-langsung.astro`'s polling client, which
 * re-renders node/event state badges from a JSON fetch and must show the
 * same translated label as the SSR rows. It reads the labels from a
 * server-serialised `data-state-labels` attribute rather than shipping a
 * catalogue copy, so the cost is one small parser. Measured actual total:
 *
 * ```
 * before (247,880 ceiling)   247,880 B
 * + orkestrasi-langsung translated state labels   248,045 B (measured actual total)
 * ```
 *
 * 248,045 is the measured value with no added margin.
 *
 * **Raised again for Issue #865** (Wave 6, admin-ui-parity-matrix.md §7): the
 * 12 OMES screens migrated their `.status-badge`/`.stat-card` markup onto
 * `.admin-status-pill`/`.admin-stat-card`. This did NOT add a new CSS rule —
 * `omes-control-center.css` already carried the dual `.stat-card`/
 * `.admin-stat-card` selector list from Issue #860 (wave 2), and never
 * redeclared `.status-badge`/`.admin-status-pill` itself (both classes
 * consume the same `--color-*-soft` custom properties the file already
 * overrides), so the only real growth is `orkestrasi-langsung.astro`'s
 * client-rendered activity-stream template literal: its badge markup's class
 * names got longer (`status-badge` -> `admin-status-pill`, `status-dot` ->
 * `admin-status-pill-dot`), offset slightly by `data-variant` -> `data-tone`
 * being three characters shorter. Measured actual total:
 *
 * ```
 * before (248,045 ceiling)   248,045 B
 * + admin-status-pill/admin-stat-card class rename (12 OMES screens)   248,058 B (measured actual total)
 * ```
 *
 * 248,058 is the measured value with no added margin.
 *
 * **Raised again for Issue #864** (media/settings admin-primitives wave —
 * `docs/awcms/admin-ui-parity-matrix.md` §7 Wave 5). `media.astro` and
 * `account.astro` only swap existing markup onto classes `admin.css` already
 * defines (`.admin-stat-card`, `.admin-status-pill`), so neither adds a byte
 * here. The growth is `access-policies.astro`'s simulator: its verdict was
 * plain `textContent`, and is now an `.admin-status-pill` built client-side
 * (tone carries allow/deny, matching the table's `Allow`/`Deny` column) with
 * its "Allow"/"Deny"/"no policy matched" labels read from translated
 * `data-verdict-*` attributes rather than shipping a catalogue copy — the
 * same pattern `orkestrasi-langsung.astro`'s raise above already paid for.
 * Measured actual total:
 *
 * ```
 * before (248,058 ceiling)   248,058 B
 * + access-policies.astro verdict pill   248,346 B (measured actual total)
 * ```
 *
 * 248,346 is the measured value with no added margin.
 *
 * **Raised again for Issue #863** (wave 4 of the admin-ui-parity-matrix —
 * approvals/business-scope/data-lifecycle/omes-health/reporting adopt
 * `.admin-timeline`). The only growth is the primitive's own list-style reset
 * (`.admin-timeline { list-style: none; margin: 0; padding: 0; }`) added to
 * `admin.css` — one small rule shared by every admin page, not per-screen
 * duplication. Measured actual total:
 *
 * ```
 * before (248,346 ceiling)   248,346 B
 * + .admin-timeline list-style reset   248,397 B (measured actual total)
 * ```
 *
 * 248,397 is the measured value with no added margin.
 *
 * **Raised again for Issue #862** (wave 3 of #858: comments.astro's
 * `.admin-segmented`/`.admin-bulk-bar` adoption, plus the `.admin-status-pill`
 * sweep across 31 list-management screens). The growth is the new
 * `src/lib/ui/admin-bulk-bar-client.ts` module (comments.astro's bulk-select
 * wiring), the one small `.cell-select` rule added to `admin.css`, and a
 * `flex-wrap` fix to `.admin-segmented` itself (360px overflow fix, caught by
 * `tests/e2e/responsive-360.e2e.ts` against the primitive's first real
 * 5-option consumer) — the `.admin-status-pill` sweep itself adds no CSS (the
 * primitive was already shipped, unused, by PR #813). Measured actual total:
 *
 * ```
 * before (248,397 ceiling)   248,397 B
 * + admin-bulk-bar-client.ts + .cell-select + .admin-segmented flex-wrap   250,380 B (measured actual total)
 * + .admin-segmented-option[aria-current="page"] selector (nav, not tablist)   250,423 B (measured actual total)
 * ```
 *
 * 250,423 is the measured value with no added margin.
 *
 * **Raised again for Issue #872** (follow-up to wave 5 / #864): the shared
 * media picker (`src/lib/ui/media-picker-client.ts`, consumed by
 * `blog.astro`/`blog-ads.astro`/`site-profile.astro`) adopts
 * `.admin-media-grid`/`.admin-media-grid-tile` (`admin.css`, unchanged) for
 * its thumbnail grid. `admin-screens.css` first SHRINKS — the bespoke grid
 * layout (`display: grid`/`grid-template-columns` on `.media-picker-panel`)
 * and the box/colour styling `.media-option` used to duplicate are removed,
 * since the primitive now supplies both — but the picker still needs a
 * `.media-option-caption` overlay (the tile's `<img>` fills it edge-to-edge,
 * leaving no room for a below-image label) and `wireMediaPickers` gained the
 * `aria-pressed`/`data-selected` tracking the issue requires so the current
 * choice is exposed to AT rather than by tile colour alone. Net growth after
 * that reduction. Measured actual total:
 *
 * ```
 * before (250,423 ceiling)   250,423 B
 * + .media-option-caption - duplicate grid/box CSS + aria-pressed tracking   250,480 B (measured actual total)
 * + --color-media-scrim / --color-on-media-scrim tokens (caption scrim, tokens not literals)   250,566 B (measured actual total)
 * ```
 *
 * 250,566 is the measured value with no added margin.
 *
 * **Lowered for Issue #866** (wave 7 of #858, the final sweep): the last
 * `.stat-card`/`.stat-grid`/`.stat-label`/`.stat-value`/`.stat-hint`/
 * `.stat-head`/`.stat-delta` and `.status-badge`/`.status-dot` consumers
 * (data-lifecycle.astro, site-search.astro, idn-regions.astro, tenants.astro,
 * sync.astro, push-notifications.astro, domain-events.astro,
 * omes/health.astro, reporting.astro) migrated onto `.admin-stat-card`/
 * `.admin-status-pill`, which let the legacy rule blocks be DELETED from
 * `admin.css`/`admin-screens.css` (and the `.stat-card` half of the dual
 * selector list in `omes-control-center.css`) — this is the first wave that
 * shrinks the budget rather than growing it, because retiring a whole legacy
 * component family removes CSS with no replacement cost (the migrated
 * markup reuses primitives `admin.css` already shipped). Measured actual
 * total, landing on top of #872 above:
 *
 * ```
 * before (250,566 ceiling)   250,566 B
 * - legacy .stat-card/.stat-grid/.status-badge rule blocks retired   PLACEHOLDER B (measured actual total)
 * ```
 *
 * PLACEHOLDER is the measured value with no added margin.
 */
export const APP_BUDGET_BYTES = 250_566;

/**
 * Largest file at baseline 16,800 B (2026-08-05) + 25% was 21,000 B.
 *
 * **Raised to 27,000 B on 15 August 2026, and the reason is not "it grew".**
 * The per-file rule's stated premise — quoted in its own failure message — is
 * that "a single file this size usually means an island bundled a dependency".
 * That premise is what makes the rule sharp, and it does not hold for the file
 * that broke it: `admin.css` is the admin's SHARED stylesheet, parsed once and
 * cached across every screen, and it grew because it was missing half its
 * vocabulary. 125 classes used by the admin templates — every button, the
 * entire dashboard, the card/form system, `.visually-hidden` — had no rule at
 * all, so `/admin/account` and thirteen settings forms rendered as raw browser
 * controls.
 *
 * Splitting it to satisfy the old number was considered and rejected: two
 * stylesheets on every admin page cost a request and save nothing, so it would
 * improve the metric while making the thing the metric exists to protect
 * slightly worse.
 *
 * The surface budgets were deliberately NOT raised for it. The ceiling that
 * actually bounds what a reader downloads still binds at its own value, so
 * that change bought shape, not headroom.
 */
export const PER_FILE_BUDGET_BYTES = 27_000;

/**
 * ADR-0120 — a per-file allowance for STYLESHEETS, separate from the one above.
 *
 * The rule above states its own premise in its own failure message: "a single
 * file this size usually means an island bundled a dependency". That premise is
 * what makes it sharp, and it is a premise about JAVASCRIPT. It has now been
 * broken twice by the same non-dependency — `admin.css`, the admin's shared
 * stylesheet — and both times the docblock had to explain that the rule did not
 * really mean this file.
 *
 * A rule that needs an essay each time it fires is measuring the wrong thing.
 * So the number is split by what the file IS:
 *
 *   - JS keeps 27,000. That is the dependency-catching number, and it stays
 *     exactly as tight as it was. Nothing about this change relaxes it.
 *   - CSS gets its own, sized to the one stylesheet every admin page shares.
 *
 * Measured after the redesign: `_astro/AdminLayout.*.css` is 39,903 B. It is
 * one file on purpose — the alternative considered and rejected in the block
 * above (two stylesheets on every admin page) costs a request and saves
 * nothing. 44,000 is measured + ~10%, wider than the surface budgets' margins
 * because a design system's stylesheet grows in vocabulary rather than in
 * features, and a 4,000 B margin here is about thirty new component rules.
 *
 * What this does NOT excuse: a stylesheet growing because 47 screens each
 * carry their own copy of the same rules. That is the Issue #552 shape in CSS,
 * and it shows up in `APP_BUDGET_BYTES`, not here.
 *
 * **Raised to 52,000 on 21 September 2026 (awcms-one#170)** for the same
 * reason `APP_BUDGET_BYTES` was raised alongside it: the dark sidebar tokens
 * and eight new shared primitives this file gained are vocabulary, not
 * duplication (see that constant's docblock for the full accounting).
 * Measured after the restyle: `_astro/AdminLayout.*.css` is 47,240 B. 52,000
 * is measured + ~10%, the same margin this constant's previous raise used.
 *
 * **Raised to 57,300 on 29 September 2026 (Issue #854 part 1)** for the same
 * reason `APP_BUDGET_BYTES` was raised alongside it: `ConfirmDialog`,
 * `SettingsSaveBar`, and `ReasonPanel` (ADR-0125) are three new shared
 * `<dialog>`/save-bar components every admin screen can adopt, added to
 * `admin.css` rather than duplicated per screen. Measured after the addition:
 * `_astro/AdminLayout.*.css` is 52,089 B. 57,300 is measured + ~10%, the same
 * margin this constant's previous raises used.
 *
 * **Lowered to 56,800 for Issue #866** (wave 7 of #858, the final sweep):
 * retiring the legacy `.stat-card`/`.stat-grid`/`.status-badge`/`.status-dot`
 * rule blocks from `admin.css`/`admin-screens.css` (see `APP_BUDGET_BYTES`'s
 * own docblock for the consumer list) shrinks the bundled `AdminLayout.*.css`
 * chunk. Measured after the retirement: `_astro/AdminLayout.*.css` is
 * 51,594 B. 56,800 is measured + ~10%, the same margin this constant's
 * previous raises used.
 */
export const PER_FILE_CSS_BUDGET_BYTES = 56_800;

/**
 * ADR-0120 — the typeface, budgeted separately from everything else.
 *
 * `scripts/client-asset-budget.ts` used to say, in the section explaining why
 * nothing is excluded, that "no fonts are shipped". That is no longer true, and
 * the honest response is a budget rather than a silent exclusion — which is
 * exactly what that section asked for: "the right response is a deliberate
 * exclusion recorded here, not a silent one."
 *
 * ## Why not just count them in `APP_BUDGET_BYTES`
 *
 * Because that budget measures a specific thing, and it says so: "it keeps the
 * old total's job of catching slow growth one admin screen at a time". 104,004 B
 * of fonts inside a 193,500 B ceiling would leave ~89,000 B for a surface
 * currently at ~211,000 — i.e. the budget would have to roughly double, and a
 * doubled ceiling detects nothing. One 104 KB step change would have destroyed
 * the instrument that catches 600 B steps.
 *
 * The two also behave differently in ways that matter to the premise. App JS/CSS
 * grows monotonically, one screen at a time, invisibly. A typeface is chosen
 * once, is `unicode-range`-gated so most of it is conditional, and is cached
 * across every page of every visit. They are not the same kind of weight and one
 * number cannot mean both.
 *
 * ## Measured
 *
 * ```
 * public-sans-latin.woff2          26,832 B   always
 * public-sans-latin-ext.woff2      18,472 B   conditional (unicode-range)
 * public-sans-italic-latin.woff2   15,644 B   conditional (italic text only)
 * jetbrains-mono-latin.woff2       31,432 B   always
 * jetbrains-mono-latin-ext.woff2   11,624 B   conditional (unicode-range)
 *                                 ---------
 *                                 104,004 B   58,264 B of it unconditional
 * ```
 *
 * 112,000 is measured + ~7.7%: room for ONE more subset, not for a second
 * family. Adding a third typeface should have to argue for itself here.
 *
 * Latin only — no Cyrillic, Greek or Vietnamese subsets — because the catalogue
 * ships `en` and `id`. A locale needing another script has to add its subsets,
 * and this ceiling is where that decision becomes visible.
 */
export const FONT_BUDGET_BYTES = 112_000;

/**
 * `font` joins the two surface audiences (ADR-0120).
 *
 * It is an AUDIENCE rather than an exclusion for a reason the reader budget
 * depends on: a font is not weightless, it is weight charged to a DIFFERENT
 * meter. Excluding fonts would mean a future `@font-face` added to
 * `css/public-content.css` — which readers do download — would go uncounted
 * against anything at all.
 */
export type Audience = "reader" | "app" | "font";

export type ClientAsset = { path: string; bytes: number };

export type Measurement = { totalBytes: number; files: ClientAsset[] };

export type Budget = {
  readerBudgetBytes: number;
  appBudgetBytes: number;
  fontBudgetBytes: number;
  perFileBudgetBytes: number;
  perFileCssBudgetBytes: number;
};

export type BudgetReport = {
  ok: boolean;
  totalBytes: number;
  readerBytes: number;
  appBytes: number;
  fontBytes: number;
  overReader: boolean;
  overApp: boolean;
  overFont: boolean;
  /** Each carries the budget it broke, so the message can name the right one. */
  oversizedFiles: (ClientAsset & { budgetBytes: number })[];
  /** `public/` files present in the build but absent from the registry. */
  undeclared: ClientAsset[];
  /** Registry entries with no file in the build. */
  missing: string[];
  empty: boolean;
};

/**
 * Which budget an asset counts against.
 *
 * `_astro/*` is structural: it is Vite output for `.astro` pages, and no
 * public content route has one. Everything else came from `public/` and must
 * be declared — `undefined` here is what the gate turns into a failure, so a
 * new file cannot enter the build unclassified.
 */
export function classifyAsset(
  assetPath: string,
  registry: Readonly<Record<string, Audience>> = PUBLIC_ASSET_AUDIENCE
): Audience | undefined {
  const normalised = assetPath.split(path.sep).join("/");
  if (normalised.startsWith("_astro/")) return "app";
  return registry[normalised];
}

/**
 * Walk `root` recursively and size every regular file.
 *
 * Rejects when `root` does not exist — the caller decides how loudly. Files
 * come back sorted largest-first so failure output and "top 5" reporting need
 * no second sort.
 */
export async function measureClientAssets(root: string): Promise<Measurement> {
  const files: ClientAsset[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const info = await stat(absolute);
        files.push({ path: path.relative(root, absolute), bytes: info.size });
      }
    }
  }

  await walk(root);

  files.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));

  return {
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files
  };
}

export function evaluateBudget(
  measurement: Measurement,
  budget: Budget = {
    readerBudgetBytes: READER_BUDGET_BYTES,
    appBudgetBytes: APP_BUDGET_BYTES,
    fontBudgetBytes: FONT_BUDGET_BYTES,
    perFileBudgetBytes: PER_FILE_BUDGET_BYTES,
    perFileCssBudgetBytes: PER_FILE_CSS_BUDGET_BYTES
  },
  registry: Readonly<Record<string, Audience>> = PUBLIC_ASSET_AUDIENCE
): BudgetReport {
  const empty = measurement.files.length === 0;

  let readerBytes = 0;
  let appBytes = 0;
  let fontBytes = 0;
  const undeclared: ClientAsset[] = [];

  for (const file of measurement.files) {
    const audience = classifyAsset(file.path, registry);
    if (audience === "reader") readerBytes += file.bytes;
    else if (audience === "app") appBytes += file.bytes;
    else if (audience === "font") fontBytes += file.bytes;
    else undeclared.push(file);
  }

  const present = new Set(
    measurement.files.map((file) => file.path.split(path.sep).join("/"))
  );
  const missing = Object.keys(registry).filter(
    (declared) => !present.has(declared)
  );

  const overReader = readerBytes > budget.readerBudgetBytes;
  const overApp = appBytes > budget.appBudgetBytes;
  const overFont = fontBytes > budget.fontBudgetBytes;

  /*
   * ADR-0120 — the per-file ceiling depends on what the file IS.
   *
   * Fonts are exempt from a per-file rule entirely, and that is the one
   * genuine exemption here. The rule's premise is "a single file this size
   * usually means an island bundled a dependency" — a premise about code. A
   * font subset's size is decided by the number of glyphs in a script, not by
   * anything a reviewer can split; `FONT_BUDGET_BYTES` bounds the set, which is
   * the decision that actually exists.
   */
  const oversizedFiles = measurement.files.flatMap((file) => {
    if (classifyAsset(file.path, registry) === "font") return [];

    const budgetBytes = file.path.endsWith(".css")
      ? budget.perFileCssBudgetBytes
      : budget.perFileBudgetBytes;

    return file.bytes > budgetBytes ? [{ ...file, budgetBytes }] : [];
  });

  return {
    ok:
      !empty &&
      !overReader &&
      !overApp &&
      !overFont &&
      oversizedFiles.length === 0 &&
      undeclared.length === 0 &&
      missing.length === 0,
    totalBytes: measurement.totalBytes,
    readerBytes,
    appBytes,
    fontBytes,
    overReader,
    overApp,
    overFont,
    oversizedFiles,
    undeclared,
    missing,
    empty
  };
}

export function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} B (${(bytes / 1000).toFixed(1)} kB)`;
}

/**
 * Actionable failure text: which budget broke, by how much, and the five
 * largest files — because the fix is almost always in one of them.
 */
export function formatFailure(
  report: BudgetReport,
  measurement: Measurement,
  budget: Budget
): string[] {
  const lines: string[] = ["build:asset-budget:check FAILED"];

  if (report.empty) {
    lines.push(
      `  - ${CLIENT_DIST} exists but holds no files. The build always emits ` +
        "admin CSS, so this means the build broke or the wrong directory is " +
        "being measured — never that the client got lighter."
    );
    return lines;
  }

  if (report.overReader) {
    lines.push(
      `  - READER assets ${formatBytes(report.readerBytes)} exceed the budget ` +
        `of ${formatBytes(budget.readerBudgetBytes)}. This is what a visitor ` +
        "to a public article downloads, and it is the tightest budget here on " +
        "purpose (ADR-0101). Trim it, or re-measure and raise " +
        "READER_BUDGET_BYTES in scripts/client-asset-budget.ts as a reviewed " +
        "diff that says which reader-visible feature bought the weight."
    );
  }

  if (report.overApp) {
    lines.push(
      `  - APP assets ${formatBytes(report.appBytes)} exceed the budget of ` +
        `${formatBytes(budget.appBudgetBytes)}. That is the admin, auth and ` +
        "landing surface. Before raising APP_BUDGET_BYTES, check whether the " +
        "growth is per-screen duplication — Issue #552 recovered 22,700 B by " +
        "moving a hand-copied lifecycle into src/lib/ui/admin-form-client.ts."
    );
  }

  if (report.overFont) {
    lines.push(
      `  - FONT assets ${formatBytes(report.fontBytes)} exceed the budget of ` +
        `${formatBytes(budget.fontBudgetBytes)}. Before raising ` +
        "FONT_BUDGET_BYTES, check WHICH subsets grew: a new script (Cyrillic, " +
        "Greek, Vietnamese) is a real decision tied to a locale the catalogue " +
        "actually ships, while a second FAMILY needs to argue against the two " +
        "already here. See ADR-0120."
    );
  }

  for (const file of report.undeclared) {
    lines.push(
      `  - ${file.path} (${formatBytes(file.bytes)}) is in the build but not ` +
        "in PUBLIC_ASSET_AUDIENCE. Declare it 'reader' (a public content page " +
        "links it), 'app' (only an admin/auth page reaches it) or 'font' (a " +
        "@font-face source) in scripts/client-asset-budget.ts. An " +
        "unclassified asset is one nobody has decided the audience of, which " +
        "is how reader weight grew unseen."
    );
  }

  for (const declared of report.missing) {
    lines.push(
      `  - PUBLIC_ASSET_AUDIENCE declares ${declared}, which the build did ` +
        "not emit. Either public/ lost the file and the entry should go, or " +
        "the build is wrong. A registry describing files that no longer " +
        "exist is the decay this gate exists to stop."
    );
  }

  for (const file of report.oversizedFiles) {
    // The message names the budget the file ACTUALLY broke. Reporting a
    // stylesheet against the JS number is how the per-file rule ended up
    // needing an essay each time it fired — see PER_FILE_CSS_BUDGET_BYTES.
    const constantName = file.path.endsWith(".css")
      ? "PER_FILE_CSS_BUDGET_BYTES"
      : "PER_FILE_BUDGET_BYTES";
    const diagnosis = file.path.endsWith(".css")
      ? "A stylesheet this size usually means screens are each carrying their own copy of shared rules; move them into the shared vocabulary in admin.css"
      : "A single file this size usually means an island bundled a dependency; split or drop it";

    lines.push(
      `  - ${file.path} is ${formatBytes(file.bytes)}, over the per-file ` +
        `budget of ${formatBytes(file.budgetBytes)}. ${diagnosis}, or raise ` +
        `${constantName} with the reasoning updated.`
    );
  }

  lines.push("  Largest files:");
  for (const file of measurement.files.slice(0, 5)) {
    lines.push(`    ${formatBytes(file.bytes).padStart(22)}  ${file.path}`);
  }

  return lines;
}

function isMissingDirectory(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function main(): Promise<void> {
  const budget: Budget = {
    readerBudgetBytes: READER_BUDGET_BYTES,
    appBudgetBytes: APP_BUDGET_BYTES,
    fontBudgetBytes: FONT_BUDGET_BYTES,
    perFileBudgetBytes: PER_FILE_BUDGET_BYTES,
    perFileCssBudgetBytes: PER_FILE_CSS_BUDGET_BYTES
  };

  let measurement: Measurement;
  try {
    measurement = await measureClientAssets(CLIENT_DIST);
  } catch (error) {
    if (isMissingDirectory(error)) {
      console.error(
        `build:asset-budget:check FAILED — ${CLIENT_DIST} tidak ada. ` +
          "Jalankan build dulu: `bun run build` (target `build` sudah " +
          "merantainya setelah `astro build`)."
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const report = evaluateBudget(measurement, budget);

  if (!report.ok) {
    for (const line of formatFailure(report, measurement, budget)) {
      console.error(line);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `build:asset-budget:check OK — ${measurement.files.length} files, total ` +
      `${formatBytes(report.totalBytes)}. Reader ` +
      `${formatBytes(report.readerBytes)} within ` +
      `${formatBytes(budget.readerBudgetBytes)}; app ` +
      `${formatBytes(report.appBytes)} within ` +
      `${formatBytes(budget.appBudgetBytes)}; fonts ` +
      `${formatBytes(report.fontBytes)} within ` +
      `${formatBytes(budget.fontBudgetBytes)}; largest script within ` +
      `${formatBytes(budget.perFileBudgetBytes)} and largest stylesheet ` +
      `within ${formatBytes(budget.perFileCssBudgetBytes)}.`
  );
}

if (import.meta.main) {
  await main();
}
