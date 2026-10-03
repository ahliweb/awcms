🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](admin-ui-parity-matrix.id.md)

# AWCMS ↔ awcms-one admin UI/UX parity matrix

> Audit for [Issue #858](https://github.com/ahliweb/awcms/issues/858). Wave 1
> was the inventory + parity matrix (docs only). Waves 2–7 recomposed screens
> on top of this matrix and are all **DONE** (§7) — this document now
> describes the FINAL state, not a plan.

## 1. Purpose and method

[PR #813](https://github.com/ahliweb/awcms/pull/813) /
`ahliweb/awcms-one#170` upstreamed a shared admin chrome and eight reusable
primitives into `src/styles/admin.css`: `.admin-stat-card`,
`.admin-status-pill`, `.admin-segmented`, `.admin-bulk-bar`,
`.admin-two-pane`, `.admin-toggle`, `.admin-timeline`, `.admin-media-grid`.
Nothing under `src/pages/admin/**/*.astro` in this repo consumes them yet —
confirmed below by grep, not just repeated from the issue text. This
document is the "which screen gets which primitive, and why" mapping the
issue's acceptance criteria requires before any screen is touched.

**Method.** Every file in the inventory (§4) was read at the `class=`/markup
level via targeted `grep` across the whole screen (data tables, status
markup, filter forms, toggle/button controls, ordered/history lists, media
grids), then spot-verified by reading the surrounding markup for every
ambiguous signal (all `.module-toggle` sites, `.filter-bar`/`.admin-filter-*`
sites, the account/subject-requests/sidebar-menu/module-detail screens with
no grep signal at all). It is **not** a line-by-line read of all 63 files;
where confidence is lower than "confirmed by reading the markup", the
Required change column says so and defers the final call to whichever wave
package actually touches that screen.

**Rules applied throughout (from the issue), restated so they are checkable
against each row below:**

- never force a primitive onto a screen that does not fit it;
- `.admin-bulk-bar` only where a safe bulk endpoint already exists (verified
  against `src/pages/api/**`, §5);
- `.admin-toggle` only for a real boolean already backed by server-side
  authorization, not for a button that triggers a high-risk POST;
- `.admin-segmented` only for a real mutually-exclusive filter/tab, not a
  `<select>` filter form;
- use real data only; omit a widget rather than fabricate a metric.

## 2. Validated baseline

Independently re-verified on this branch against
`/home/data/dev_bun/awcms-one` (local checkout of `ahliweb/awcms-one`,
`apps/cms` embeds this repo's admin surface):

| File                                                           | Result                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/styles/tokens.css`                                        | `diff -q` reports **identical** to `apps/cms/src/styles/tokens.css`                                                                                                                                                                                     |
| `src/styles/admin.css` (3,402 lines)                           | `diff -q` reports **identical** to `apps/cms/src/styles/admin.css` — all eight primitives are defined there, byte-for-byte the same in both repos                                                                                                       |
| `src/styles/admin-screens.css` (721 lines here)                | awcms-one's copy is a **superset**: identical for the first 721 lines, then 253 additional lines, all under an explicit `/* commerce (awcms-one #171) ... */` banner that states the primitives are never redeclared there, only screen-specific layout |
| Primitive consumption in `src/pages/admin/**/*.astro`          | **zero** files reference any of the eight `.admin-*` primitive classes (`grep -rl` across all 63 files returns nothing)                                                                                                                                 |
| Primitive consumption in `apps/cms/src/pages/admin/**/*.astro` | **9** files, all named `commerce*` (§3)                                                                                                                                                                                                                 |

This confirms the issue's stated baseline exactly: the gap is
screen-composition, not tokens or chrome.

## 3. How awcms-one composes each primitive (reference, not a copy source)

`awcms-one` embeds this repo under `apps/cms` and adds nine commerce-only
screens on top of the identical `admin.css`. Composition patterns worth
reusing, and what must **not** move with them:

| Primitive            | awcms-one usage (file)                                                                                          | Composition pattern                                                                                                                                                                                                                                                                                 | Commerce-specific parts to leave behind                                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.admin-stat-card`   | `commerce-dashboard.astro`, `commerce-affiliates.astro`, `commerce-reports.astro`, `commerce-orders/[id].astro` | Grid of 3–4 cards, `-label`/`-value`/`-caption`; a `.admin-status-pill` nested inside a card's value slot for a low-stock/at-risk count                                                                                                                                                             | none — the card markup itself is generic                                                                                                                                             |
| `.admin-status-pill` | all 9 commerce files                                                                                            | `data-tone` set from a small server-side status→tone map (never a raw enum), always paired with `.admin-status-pill-dot` for the non-colour channel                                                                                                                                                 | the tone map's _values_ (`paid`, `fulfilled`, `refunded`, …) are commerce vocabulary                                                                                                 |
| `.admin-segmented`   | `commerce-orders.astro`, `commerce-inbox.astro`, `commerce-reports.astro`, `commerce.astro`                     | `<nav role="tablist">` (or `<div>` + `role="tablist"` on the segmented itself) wrapping `.admin-segmented-option` buttons/labels with `aria-selected`; options are real mutually-exclusive states (order status, conversation filter, report tab) sourced from the same enum the backend filters on | the _options themselves_ (order-status set)                                                                                                                                          |
| `.admin-bulk-bar`    | `commerce.astro` (product list)                                                                                 | Comment in the file states the load-bearing rule directly: bulk actions are gated on the **same predicate** as the row-level Actions column, so a bulk action never appears for a row an operator could not act on individually                                                                     | product-specific bulk actions (bulk price change, bulk category)                                                                                                                     |
| `.admin-two-pane`    | `commerce-inbox.astro`                                                                                          | `.admin-two-pane-list` (scrollable thread list) + `.admin-two-pane-detail` (transcript), with an explicit empty-detail state when nothing is selected                                                                                                                                               | inbox thread transcript rendering                                                                                                                                                    |
| `.admin-toggle`      | `commerce-settings.astro`                                                                                       | One checkbox-based switch per genuinely instant, server-backed boolean setting (e.g. a payment gateway enabled flag), never for an action that needs confirmation                                                                                                                                   | the specific settings it gates                                                                                                                                                       |
| `.admin-timeline`    | `commerce-orders/[id].astro`                                                                                    | `<ol class="admin-timeline">` of `.admin-timeline-item`, each with a `data-status` label and a `-meta` line (actor + timestamp) — one order's status history                                                                                                                                        | order-event vocabulary                                                                                                                                                               |
| `.admin-media-grid`  | not used in awcms-one (no commerce screen needs it)                                                             | n/a                                                                                                                                                                                                                                                                                                 | n/a — the shared media picker (`src/lib/ui/media-picker-client.ts`, Issue #872) is the only real consumer either repo has; `/admin/media` itself deliberately does not use it (§6.6) |

**Do not upstream, ever, into this repo:** any `Commerce*` component, the
nine `commerce-*.astro` routes themselves, POS layouts, storefront CSS, or
the commerce label/status vocabularies baked into those files. They are
listed here only so the _pattern_ (segmented-tab markup shape,
bulk-bar/row-action predicate parity, timeline item shape) can be copied by
hand into the generic screens below, with AWCMS's own data and labels.

## 4. Consolidation targets — existing bespoke duplicates

These are **not** in `src/pages/admin/*.astro` per-file `<style>` blocks —
every one of them is centrally defined once in `src/styles/admin.css` or
`src/styles/admin-screens.css` and then referenced by class name from dozens
of screens. That already matches the "one definition, many consumers"
shape the `.admin-*` primitives use; the duplication is **two competing
central definitions for the same concept**, not per-screen copy-paste.

| Bespoke class                                                                              | Defined in                                | Used across                                                                                                                                                                                                                                                                 | What it actually is                                                                                           | Relationship to the new primitive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.status-badge` / `.status-dot`                                                            | `src/styles/admin.css:1366`               | 40 files, 84 sites                                                                                                                                                                                                                                                          | Tinted pill + dot, `data-variant="success\|neutral\|warning"`, per ADR-0120                                   | **Near-exact duplicate** of `.admin-status-pill`/`.admin-status-pill-dot` — same visual spec (tint fill, `--color-X-soft`/`--color-X-on-soft`, 3px/10px padding, `--radius-full`), same accessibility rationale (dot as second channel), different attribute name (`data-variant` vs `data-tone`) and a narrower tone set (no `danger`/`info`/`primary`). This is the **single highest-value consolidation**: migrating `.status-badge` markup to `.admin-status-pill` removes an entire parallel CSS block and gives every one of those 40 screens `danger`/`info`/`primary` tones they do not have today.                                                                                                                                                                                                                                                                                                                                             |
| `.stat-card` / `.stat-grid` / `.stat-label` / `.stat-value` / `.stat-head` / `.stat-delta` | `src/styles/admin-screens.css:148-220ish` | 18 files (`analytics`, `data-lifecycle`, `domain-events`, `idn-regions`, `index`, `media`, `newsletter`, `omes/backups`, `omes/deployments`, `omes/health`, `omes/index`, `omes/jobs`, `omes/servers`, `push-notifications`, `reporting`, `site-search`, `sync`, `tenants`) | Dashboard KPI tile: value-first (ADR-0120 inverted layout), optional `.stat-head` icon row and `.stat-delta`  | **Parallel duplicate system** to `.admin-stat-card`/`-label`/`-value`/`-caption`. Both encode "value-first KPI tile" but `.stat-card` additionally supports an icon head and a signed delta that `.admin-stat-card` does not have yet. Consolidating means either porting the delta/head affordance into `.admin-stat-card` before migrating these 18 screens, or accepting the loss of that affordance — a real design decision for wave 2, not something this audit should pre-decide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `.count-pill` (`.admin-section-title .count-pill`)                                         | `src/styles/admin-screens.css:103`        | 36 files                                                                                                                                                                                                                                                                    | A small neutral pill showing a section's item count next to its `<h2>` (e.g. "Users (42)")                    | Different purpose from a status pill — it is a **count badge on a heading**, not a lifecycle state. Visually close enough to `.admin-status-pill[data-tone="neutral"]` that it _could_ reuse the same CSS, but doing so is optional polish, not required consolidation; flagged low-priority in §6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `.module-toggle`                                                                           | `src/styles/admin.css:1526`               | 16 files, every site is a `<button type="button">` or `<button type="submit">` (verified — see below)                                                                                                                                                                       | A bordered row-action **button**: Enable/Disable, Save, Publish/Rollback, Verify/Set-primary, Delete, Resolve | **Not a duplicate of `.admin-toggle`.** Its name is a misnomer left over from its origin as a module enable/disable button, but every one of the 16 files uses it as a confirmed, POST-triggering action button, never a live checkbox switch. Converting any of these to `.admin-toggle` would be a **security-relevant regression**: it would make a high-risk, audited, often confirmation-gated action (module enable/disable, domain verify/primary, redirect delete, theme publish/rollback) _look_ like an instant, reversible client-side flip, which the issue explicitly forbids ("never rely on a hidden/disabled control as an authorization mechanism"). This repo has no reusable "row-action button" primitive distinct from `.module-toggle`'s own definition; that gap — not a toggle migration — is the real consolidation opportunity here, and belongs with #854 (confirm dialogs sit naturally in front of exactly these buttons). |
| `.filter-bar` / `.admin-filter-bar` / `.admin-filter-form`                                 | inline in `admin.css`/`admin-screens.css` | `comments` (`.filter-bar`, `<nav aria-label="Filter by status">` of `<a>` links), `newsletter`/`media`/`push-notifications` (`.admin-filter-form`, GET `<form>` + `<select>`), `omes/orkestrasi-langsung` (`.admin-filter-bar`, GET `<form>` + `<select>`)                  | Two different things sharing similar names                                                                    | `comments.astro`'s `.filter-bar` is a **real mutually-exclusive tab nav** (status is one of a fixed small set, each a link) — a genuine `.admin-segmented` candidate. The other four are **`<select>`-driven filter forms** (status, region depth, etc.) with no tab semantics — per the issue's own rule, these are **not** `.admin-segmented` candidates as they stand; converting them would mean redesigning the filter UI, which is out of this audit's scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## 5. Bulk endpoint audit (for `.admin-bulk-bar` eligibility)

`grep -rli bulk src/pages/api` finds 8 files. Only one is a genuine
**row-selection bulk action on an existing list screen**:

| Endpoint                                                                                                                   | Bound screen                      | Verdict                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/api/v1/comments/admin/bulk-moderate.ts`                                                                         | `comments.astro`                  | **Eligible.** Tenant-bounded, ABAC-guarded per action, `Idempotency-Key`'d, audited per applied item, bounded to 100 ids/call (ADR-0041). This is exactly the shape `.admin-bulk-bar` assumes. |
| `src/pages/api/v1/email/announcements/index.ts`, `.../preview.ts`                                                          | none (compose screen, not a list) | Not eligible — "bulk" here means "send one announcement to many recipients," not "act on many selected rows in a table."                                                                       |
| `src/pages/api/v1/comments/admin/[id]/delete.ts`                                                                           | `comments.astro`                  | Single-row delete; not a bulk endpoint despite the grep hit (matched on a doc comment).                                                                                                        |
| `src/pages/api/v1/blog/pages/public/[slug].ts`, `.../news-portal/homepage-sections/[id].ts`, `.../seo/redirects/import.ts` | —                                 | False positives (word "bulk" in a comment/description, not a bulk-action endpoint).                                                                                                            |

No other list screen in the inventory (§6) has a qualifying bulk endpoint
today. `.admin-bulk-bar` is therefore scoped to `comments.astro` for wave 3;
every other "adopt bulk bar" temptation in a list screen is a **no** until a
real bulk endpoint exists for it (out of scope for #858, which is UI-only).

## 6. Screen-by-screen classification

63 files under `src/pages/admin/**/*.astro`. Grouped by the families the
issue itself proposes (§Scope items 1–6). Classification is **adopt**
(clear, low-risk win), **partially adopt** (one or two primitives fit, or
fit only after a follow-up decision), or **no change** (no primitive fits
without forcing it, or the screen is already primitive-shaped).

Legend for "Primitive(s)": SC = `.admin-stat-card`, SP = `.admin-status-pill`,
SG = `.admin-segmented`, BB = `.admin-bulk-bar`, TP = `.admin-two-pane`,
TG = `.admin-toggle`, TL = `.admin-timeline`, MG = `.admin-media-grid`.

### 6.1 Dashboard / reporting / analytics

| Screen             | Primitive(s) | Class.          | Required change                                                                                                                                                                                                              |
| ------------------ | ------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.astro`      | SC           | adopt           | Migrate the 4 bespoke `.stat-card`/`.stat-grid` KPI tiles to `.admin-stat-card`; no status/segmented content present.                                                                                                        |
| `analytics.astro`  | SC, SP       | partially adopt | 13 `.stat-card`-family sites → SC; the 18 `data-table` sites carry raw counts, not lifecycle status, so SP applies only if/where a status column exists (needs a read at implementation time — flagged, not confirmed here). |
| `reporting.astro`  | SC, SP, TL   | partially adopt | 12 `.stat-card` sites → SC; 6 `.status-badge` sites → SP; the "Rebuild history" section (`#reporting-rebuild-history`) is a real ordered history list → TL candidate.                                                        |
| `omes/index.astro` | SC, TL       | partially adopt | 6 `.stat-card` sites → SC; already has a bespoke `<ol class="omes-lifecycle">` at line 274 that is structurally an ordered-event list — TL candidate, needs a read to confirm the item shape matches `.admin-timeline-item`. |

### 6.2 List-management screens

Real bulk-bar eligibility is limited to `comments.astro` (§5); real segmented-tab
eligibility is limited to `comments.astro` (§4, last row). Every other row's SG/BB
column is intentionally absent, not omitted by oversight.

| Screen                                                                                                                                                              | Primitive(s)      | Class.                                                 | Required change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `comments.astro`                                                                                                                                                    | SP, SG, BB        | **adopt** (flagship)                                   | Migrate `.filter-bar` status-tab nav → `.admin-segmented`; per-row status → `.admin-status-pill`; wire the existing selection UI to `.admin-bulk-bar` calling the existing `bulk-moderate` endpoint, gated on the same per-row permission as the row Actions column (mirror the `commerce.astro` predicate-parity pattern, §3).                                                                                                                                                                                                                                                    |
| `abac-policies.astro`                                                                                                                                               | SP                | partially adopt                                        | 2 `.status-badge` sites → SP. The 2 `.module-toggle` sites are enable/disable action buttons — no change (see §4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `audit-trail.astro`                                                                                                                                                 | SP, TL (eval)     | partially adopt                                        | 2 `.status-badge` sites → SP. 1 timeline-shaped signal (audit history is inherently chronological) — evaluate TL only if/when a drill-in detail view is added; the current screen is a flat table.                                                                                                                                                                                                                                                                                                                                                                                 |
| `blog-ads.astro`                                                                                                                                                    | SP                | partially adopt                                        | 3 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `blog.astro`                                                                                                                                                        | SP                | partially adopt                                        | 1 `.status-badge` site → SP (largest file in the inventory at 2,075 lines — status normalization only, no structural change).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `blog-homepage.astro`                                                                                                                                               | SP                | partially adopt                                        | 2 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `blog-institutions.astro`                                                                                                                                           | SP                | partially adopt                                        | 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `blog-pages.astro`                                                                                                                                                  | SP                | partially adopt                                        | 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `blog-presentation.astro`                                                                                                                                           | SP                | partially adopt                                        | 2 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `blog-taxonomy.astro`                                                                                                                                               | SP                | partially adopt                                        | 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `data-lifecycle.astro`                                                                                                                                              | SC, SP, TL (eval) | partially adopt                                        | 11 `.stat-card` sites → SC; 4 `.status-badge` sites → SP; "Run history" section is a real ordered history list → TL candidate. 2 `.module-toggle` sites are action buttons (legal-hold apply, dry-run) — no change.                                                                                                                                                                                                                                                                                                                                                                |
| `domain-events.astro`                                                                                                                                               | SC, SP            | partially adopt                                        | 4 `.stat-card` sites → SC; 2 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `email-suppression.astro`                                                                                                                                           | SP                | partially adopt                                        | No `.status-badge` grep hit but the screen's subject is suppression reason/status — needs a read to confirm the current markup before committing to SP; tentative.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `email-templates.astro`                                                                                                                                             | SP                | partially adopt                                        | 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `form-drafts.astro`                                                                                                                                                 | SP                | partially adopt                                        | 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `idn-regions.astro`                                                                                                                                                 | SC, SP            | partially adopt                                        | 5 `.stat-card` sites → SC; 1 `.status-badge` site → SP. 3 `.module-toggle` sites are dataset activation/rollback buttons (ADR-0046, deliberately high-friction) — no change, and specifically **must not** become a switch per the issue's own toggle rule.                                                                                                                                                                                                                                                                                                                        |
| `invitations.astro`                                                                                                                                                 | SP                | partially adopt                                        | No `.status-badge` grep hit; invitation status (pending/accepted/expired) is a plausible SP candidate — tentative, needs a read.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `machine-credentials.astro`                                                                                                                                         | SP                | partially adopt                                        | No `.status-badge` grep hit; credential status is a plausible SP candidate — tentative, needs a read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `modules.astro`                                                                                                                                                     | SP                | partially adopt                                        | 2 `.status-badge` sites → SP. 3 `.module-toggle` sites are the module enable/disable action buttons — explicitly **no change**; this is the highest-stakes `.module-toggle` site in the inventory and the clearest case for coordinating with #854's confirm-dialog work instead of a visual toggle.                                                                                                                                                                                                                                                                               |
| `newsletter.astro`                                                                                                                                                  | SC, SP            | partially adopt                                        | 2 `.stat-card` sites → SC; 1 `.status-badge` site → SP. The `.admin-filter-form` is a `<select>`, not tabs — no change for SG.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `offices.astro`                                                                                                                                                     | SP                | partially adopt                                        | 1 `.status-badge` site → SP. 3 `.module-toggle` sites are activate/deactivate buttons — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `partner-registry.astro`                                                                                                                                            | SP                | partially adopt                                        | Low signal (no `.status-badge` grep hit); tentative, needs a read. 1 `.module-toggle` site is an action button — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `partners.astro`                                                                                                                                                    | SP                | partially adopt                                        | No `.status-badge` grep hit; partner status is a plausible SP candidate — tentative, needs a read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `profiles.astro`                                                                                                                                                    | SP                | partially adopt                                        | 1 `.status-badge` site → SP. (The one "bulk" grep hit is a doc comment stating profile merge explicitly avoids a bulk list — confirms no BB candidate here.)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `push-notifications.astro`                                                                                                                                          | SC                | partially adopt                                        | 4 `.count-pill` sites suggest KPI-style counts; needs a read to confirm they are `.stat-card`-shaped before committing to SC. `.admin-filter-form` is a `<select>` — no change for SG.                                                                                                                                                                                                                                                                                                                                                                                             |
| `registrations.astro`                                                                                                                                               | SP                | partially adopt                                        | No `.status-badge` grep hit; registration status is a plausible SP candidate — tentative, needs a read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `roles.astro`                                                                                                                                                       | SP                | partially adopt                                        | 1 `.status-badge` site → SP. 3 `.module-toggle` sites are action buttons (system-role protection, activate/deactivate) — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `security.astro`                                                                                                                                                    | SP                | partially adopt                                        | 2 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `seo.astro`                                                                                                                                                         | SP                | partially adopt                                        | 3 `.status-badge` sites → SP (largest `.module-toggle` user at 7 sites, all confirmed action buttons: redirect save/lifecycle/delete, observation resolve — no change for any of them).                                                                                                                                                                                                                                                                                                                                                                                            |
| `site-search.astro`                                                                                                                                                 | SC, SP            | partially adopt                                        | 5 `.stat-card` sites → SC; 3 `.status-badge` sites → SP. 2 `.module-toggle` sites are action buttons — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `subject-requests.astro`                                                                                                                                            | SP                | partially adopt                                        | **Fixed** (#861, item 4 of #854): `{request.status}`/`{request.requestType}` no longer render raw — both now go through local `REQUEST_STATUS_LABEL`/`REQUEST_TYPE_LABEL` maps in the page's frontmatter. SP (status-badge styling) remains open.                                                                                                                                                                                                                                                                                                                                  |
| `sync.astro`                                                                                                                                                        | SC, SP            | partially adopt                                        | 4 `.stat-card` sites → SC; 3 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `tenant/domains.astro`                                                                                                                                              | SP                | partially adopt                                        | 1 `.status-badge` site → SP. 3 `.module-toggle` sites (verify, set-primary, delete) are confirmed action buttons — no change.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tenants.astro`                                                                                                                                                     | SC, SP            | partially adopt                                        | 4 `.stat-card` sites → SC; 2 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `theming.astro`                                                                                                                                                     | SP                | partially adopt                                        | 5 `.status-badge` sites → SP. 4 `.module-toggle` sites (draft submit, preview, publish, rollback) are confirmed action buttons, including the two most publish-adjacent buttons in the inventory — explicitly no change, same reasoning as `modules.astro`.                                                                                                                                                                                                                                                                                                                        |
| `user-groups.astro`                                                                                                                                                 | SP                | partially adopt                                        | No `.status-badge` grep hit; low signal, tentative — needs a read.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `users.astro`                                                                                                                                                       | SP                | partially adopt                                        | 1 `.status-badge` site → SP. 4 `.module-toggle` sites are action buttons (deactivate is a status-changing action, per the existing `awcms-admin-users-rbac-notes` pattern of "deactivate = status change", not a live switch) — no change, coordinate with #854.                                                                                                                                                                                                                                                                                                                   |
| `email-suppression.astro`, `invitations.astro`, `machine-credentials.astro`, `partner-registry.astro`, `partners.astro`, `registrations.astro`, `user-groups.astro` | —                 | _(tentative rows above; repeated here only as a flag)_ | These 7 screens had **no** `.status-badge`/`.count-pill` grep hit at all, meaning either they render status as plain text or have no status concept. **Raw-enum status now fixed** by #861 (item 4 of #854) wherever it applied — `email-suppression.astro` (`entry.reason`), `invitations.astro` (`invitation.status`), `machine-credentials.astro` (`credential.status`), and `partner-registry.astro` (`partner.status`) all now go through a translated label map. The SP `.status-badge`-styling question (this row's original subject) is unaffected and still needs a read. |

### 6.3 OMES / platform operational screens

| Screen                           | Primitive(s)      | Class.          | Required change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ----------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `omes/ai-privacy.astro`          | SP                | partially adopt | 4 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `omes/arsitektur.astro`          | SP                | partially adopt | 2 `.status-badge` sites → SP. Renders bespoke `.omes-architecture-card*` diagram cards — structurally different from a KPI tile, **no change** for SC (forcing it would misrepresent an architecture diagram as a metric).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `omes/audit.astro`               | SP                | partially adopt | 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `omes/backups.astro`             | SC, SP            | partially adopt | 3 `.stat-card` sites → SC; 3 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `omes/deployments.astro`         | SC, SP            | partially adopt | 3 `.stat-card` sites → SC; 2 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `omes/enrollments.astro`         | SP                | partially adopt | 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `omes/health.astro`              | SC, SP, TL        | **adopt**       | 3 `.stat-card` sites → SC; 3 `.status-badge` sites → SP; strongest TL signal in the inventory outside `approvals.astro` — the `mode: "history"` view (`fetchHealthHistory`, reached via each row's "View history" link) is exactly the ordered snapshot-history shape `.admin-timeline` targets.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `omes/hermes.astro`              | SP                | partially adopt | 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `omes/mission-control.astro`     | SP                | partially adopt | Multiple `.admin-status-pill` sites for object status; 3D scene is decorative (`.omes-mc-canvas`, `aria-hidden`), canonical view is the accessible object list below it. No `.stat-card` tiles or other primitives needed. History mode (ahliweb/omes#266) adds a persistent hatched banner (`.omes-mc-banner-historical`), a synchronized `<ol>` event list (`.omes-mc-event`, `aria-current="step"`) and replay transport controls, as page-scoped classes in `omes-control-center.css`; the existing `.btn`/`.admin-status-pill` primitives are reused. Contextual actions (ahliweb/omes#267) add an HUD action list, an "Approval required" badge, warning lines and a preflight panel, reusing the page-scoped rules above plus one new `.omes-mc-warning` class in `omes-control-center.css`, built on the existing `.btn` primitives and the shared `ConfirmDialog`. |
| `omes/index.astro`               | see §6.1          | —               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `omes/jobs.astro`                | SC, SP            | partially adopt | 3 `.stat-card` sites → SC; 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `omes/operations.astro`          | SP                | partially adopt | 1 `.status-badge` site → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `omes/orkestrasi-langsung.astro` | SP                | partially adopt | 4 `.status-badge` sites → SP. `.admin-filter-bar` is a `<select>` depth filter, not tabs — no change for SG.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `omes/progres-hermes.astro`      | SP                | partially adopt | 4 `.status-badge` sites → SP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `omes/servers.astro`             | SC, SP, TL (eval) | partially adopt | 3 `.stat-card` sites → SC; 3 `.status-badge` sites → SP. Doc comment at line 516 confirms decommission preserves "enrollment and audit history" — plausible TL candidate for a future history view, not present as a screen today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### 6.4 Detail / operational / history flows

| Screen                 | Primitive(s) | Class.          | Required change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | ------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approvals.astro`      | SP, TL       | **adopt**       | Strongest TL signal in the inventory: the "Instance history" section (`#instance-history`, fetched per `?instance=<id>`) is a genuine ordered `WorkflowInstanceHistoryEntry[]` list — direct `.admin-timeline` fit. 3 `data-table` sections (tasks/approvals/delegations) carry status columns → SP. `.admin-two-pane` is a plausible fit for the task-list ↔ instance-history relationship (currently a query-param drill-in, not a split view) but that is a **layout redesign**, not a class swap — flagged for wave 4 evaluation, not pre-decided as adopt here. |
| `business-scope.astro` | SP, TL       | partially adopt | "Conflict history" section (`#business-scope-conflicts-heading`) is a real ordered history list → TL. No `.status-badge` grep hit but SoD conflict state is plausibly SP-shaped — tentative. 1 `.module-toggle` site is an action button — no change.                                                                                                                                                                                                                                                                                                                |
| `domain-events.astro`  | see §6.2     | —               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `audit-trail.astro`    | see §6.2     | —               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `sync.astro`           | see §6.2     | —               | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### 6.5 Settings / configuration screens

| Screen                      | Primitive(s) | Class.          | Required change                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `account.astro`             | SP           | partially adopt | `mfaEnabled` is a real, server-verified boolean (ADR-0096) but MFA enrolment/disable is a multi-step flow (enrol with a TOTP secret, confirm a code; disable likely re-authenticates) — **not** a safe instant-flip candidate, so **no change** for TG. The MFA-enabled/disabled state and each session's current/active state are plausible SP candidates instead — tentative, needs a read of the current markup (no `.status-badge` grep hit). |
| `blog-settings.astro`       | —            | no change       | Zero grep signal on any primitive-relevant class; a plain settings form. No forced fit.                                                                                                                                                                                                                                                                                                                                                           |
| `site-profile.astro`        | —            | no change       | Zero grep signal; a plain settings form.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `sidebar-menu.astro`        | —            | no change       | A reorder/builder UI over `.admin-table` (bespoke, not `.data-table`) with no status or KPI concept — none of the eight primitives fit a menu-ordering tool.                                                                                                                                                                                                                                                                                      |
| `modules/[moduleKey].astro` | —            | no change       | Confirmed by reading the file: a settings form (`#module-settings-form.admin-form`) with `.state-notice` fallbacks, no table/status/stat markup at all.                                                                                                                                                                                                                                                                                           |
| `access-policies.astro`     | SP           | partially adopt | Confirmed by reading the file: a read + simulate tool (deliberately not an authoring screen, per its own doc comment) for the DSL policy evaluator. The simulator's allow/deny verdict is the one plausible SP use — everything else about this screen is a form, not a list.                                                                                                                                                                     |

### 6.6 Media

| Screen                                                                                                 | Primitive(s)                | Class.                                                                | Required change                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `media.astro`                                                                                          | SC, SP (not MG — see below) | **partially adopt**                                                   | `.admin-stat-card`/`.admin-status-pill` landed (wave 5, Issue #864); `.admin-media-grid` did NOT — `media.astro`'s object table deliberately renders no thumbnail (security decision documented in the file's own header), so this row's original "flagship media adoption" framing assumed markup the screen does not have.                                                                                                                                               |
| `src/lib/ui/media-picker-client.ts` (consumed by `blog.astro`, `blog-ads.astro`, `site-profile.astro`) | MG                          | **adopt** ([Issue #872](https://github.com/ahliweb/awcms/issues/872)) | The real `.admin-media-grid` consumer either repo has — its thumbnail grid was the direct migration target. `blog-homepage.astro`, the issue's fourth listed consumer, has no picker markup to migrate (verified by grep). The picker's public contract, keyboard selection, accessible names and alt text are preserved exactly; this landed as a markup/class change plus an additive `aria-pressed` current-selection indicator, not a change to any existing behavior. |

---

**Totals (Wave 1 audit-time classification — final per-screen outcome is
§7):** 63 screens audited. **Adopt: 4** (`comments.astro`,
`omes/health.astro`, `approvals.astro`, `index.astro`). **Partially adopt:
53** (SP-only normalization is the dominant pattern; a handful also carry SC
and/or a TL evaluation — `media.astro` moved here from "adopt" once wave 5
confirmed it has no `.admin-media-grid`-shaped markup, §6.6). **No change:
6**
(`blog-settings.astro`, `site-profile.astro`, `sidebar-menu.astro`,
`modules/[moduleKey].astro`, plus `omes/arsitektur.astro` and every
`.module-toggle`-only site's toggle column specifically — the _toggle_
classification is no-change on 16 files even where the _status_ column is
partially-adopt on the same file). No screen was classified **adopt** for
`.admin-toggle` — every real boolean surface found (module enable/disable,
domain verify/primary, dataset activation, theme publish) is fronted by a
confirmation-worthy, audited action, not a safe instant switch; forcing
`.admin-toggle` onto any of them would violate the issue's own toggle rule.

## 7. Proposed waves 2–6 — file-disjoint work packages

Ordered to match the issue's suggested wave numbering (§Implementation
approach). Each package lists exact files so multiple agents can run in
parallel per the issue's instruction ("multiple agents may work in parallel
only on independent screen families; shared CSS/components must be changed
serially"). **Shared files are called out per package** — any package that
touches `src/styles/admin.css` or `src/styles/admin-screens.css` must land
serially relative to every other package touching the same file, and every
package's markup change touches its own screen's locale strings only if new
translatable text is introduced (status-pill/segmented label migrations
reuse existing `t()` strings and should introduce none).

### Wave 2 — Dashboards / reporting / analytics — **DONE** ([Issue #860](https://github.com/ahliweb/awcms/issues/860))

- **Files:** `src/pages/admin/index.astro`, `src/pages/admin/analytics.astro`,
  `src/pages/admin/reporting.astro` (stat-card section only, per this wave's
  own scope — the "Rebuild history" TL evaluation stays wave 4),
  `src/pages/admin/omes/index.astro` — all four migrated onto
  `.admin-stat-card`/`.admin-stat-card-grid`/`.admin-stat-card-label`/
  `.admin-stat-card-value`/`.admin-stat-card-caption`.
- **Shared:** `src/styles/admin-screens.css` left untouched — its
  `.stat-card`/`.stat-grid` family stays defined for the ~14 screens waves
  3/6 have not migrated yet, exactly as this section originally required.
  `src/styles/admin.css`'s `.admin-stat-card-grid` was folded into the
  existing `.kpi-grid`/`.dashboard-grid` declaration (same breakpoint
  shape) instead of a new standalone rule, to keep the asset-budget cost
  down. `src/styles/omes-control-center.css` gained a selector-list
  extension (not a duplicate block) onto its existing `.stat-card`
  telemetry/dot rules, covering `.admin-stat-card` too, so the other 8
  OMES screens (still on `.stat-card`, wave 6) keep their styling.
- **Decision made:** ported `.stat-head`/`.stat-delta` into
  `.admin-stat-card` as `.admin-stat-card-head` (icon row, pairs with the
  existing `.admin-tile`) and `.admin-stat-card-delta[data-tone="positive"\|"negative"]`
  (§4) — colour-only in `admin.css` (no `::before` glyph, to hold the
  asset-budget raise this wave needed to the actual 4-screen need); the
  modifier's own doc comment requires its consumer to write the leading
  "+"/"-"/"±" character into the value text and pair a visually-hidden
  word, so "not conveyed by colour alone" (§Rules applied throughout) is
  met by the consumer contract rather than a CSS pseudo-element. Neither
  modifier has a real consumer yet — none of the four migrated screens
  computes a trend delta or KPI icon today (real data only, §Rules applied
  throughout) — so both wait for whichever future screen needs them.
  `build:asset-budget:check`'s `APP_BUDGET_BYTES` was raised from 239,956
  to 240,975 (measured actual total, no added margin — see
  `scripts/client-asset-budget.ts`'s own ledger comment).

### Wave 3 — List-management: status/filter/bulk normalization — **DONE** ([Issue #862](https://github.com/ahliweb/awcms/issues/862))

Split into two serial-safe sub-packages because they touch different file
sets but the same shared CSS:

- **3a — flagship (adopt):** `src/pages/admin/comments.astro` only.
  Segmented tabs + bulk bar + status pill, using the existing
  `bulk-moderate` endpoint. No other screen depends on this file.
- **3b — status-pill sweep (23 files):** `src/pages/admin/abac-policies.astro`,
  `audit-trail.astro`, `blog-ads.astro`, `blog.astro`, `blog-homepage.astro`,
  `blog-institutions.astro`, `blog-pages.astro`, `blog-presentation.astro`,
  `blog-taxonomy.astro`, `domain-events.astro`, `email-templates.astro`,
  `form-drafts.astro`, `idn-regions.astro`, `modules.astro`, `newsletter.astro`,
  `offices.astro`, `profiles.astro`, `roles.astro`, `security.astro`,
  `seo.astro`, `site-search.astro`, `sync.astro`, `tenant/domains.astro`,
  `tenants.astro`, `theming.astro`, `users.astro` — migrate `.status-badge`
  markup to `.admin-status-pill` (data-variant → data-tone), one predictable
  find-and-replace shape per file, no toggle/bulk/segmented changes.
- **3c — read-first (7 files, unresolved status treatment):**
  `email-suppression.astro`, `invitations.astro`, `machine-credentials.astro`,
  `partner-registry.astro`, `partners.astro`, `registrations.astro`,
  `user-groups.astro`, plus `subject-requests.astro` (raw-enum fix, §6.2) —
  each needs a read before the change is written, since this audit could not
  confirm current status markup from grep signal alone.
- **Shared:** `src/styles/admin.css` (retire `.status-badge`/`.status-dot`
  once 3a+3b+3c land, or keep both indefinitely as an alias — a decision for
  whoever lands the last of these three sub-packages, not this audit)

**Landed.** All three sub-packages shipped together in Issue #862: `comments.astro`
(3a), the 26-file status-pill sweep (3b — the file count above underlisted it by 3;
`newsletter.astro`'s `status-badge status-badge--${variant}` template-literal pattern
needed a shape-specific edit, everything else was a mechanical find-and-replace), and
the 3c reads. Of the 3c reads: `invitations.astro`, `machine-credentials.astro`,
`partner-registry.astro`, `subject-requests.astro` and `partners.astro`'s delegated-grant
state column did carry a real per-row status and adopted `.admin-status-pill`;
`email-suppression.astro` (a reason CODE, not a lifecycle status),
`registrations.astro` and `user-groups.astro` (no status concept at all) were
confirmed to have nothing to migrate and stay untouched, per the "never force a
primitive onto a screen that does not fit it" rule. `src/styles/admin.css` keeps
`.status-badge`/`.status-dot` defined — **not** retired by this issue; #866 tracks
the final retirement once every wave has landed. `APP_BUDGET_BYTES`
(`scripts/client-asset-budget.ts`) was raised by the measured growth (ledgered
there) for the new `src/lib/ui/admin-bulk-bar-client.ts`
module, one small `.cell-select` CSS rule, and a `flex-wrap` fix to `.admin-segmented`
itself — `tests/e2e/responsive-360.e2e.ts` caught the shared primitive's 5-option
track overflowing at 360px (its first real consumer), so the fix landed in the
primitive, not a per-screen workaround. The status-pill sweep itself added no CSS,
since `.admin-status-pill` already shipped, unused, with PR #813.

### Wave 4 — Detail/timeline/two-pane flows — **DONE** ([Issue #863](https://github.com/ahliweb/awcms/issues/863))

- **Files:** `src/pages/admin/approvals.astro`, `src/pages/admin/business-scope.astro`,
  `src/pages/admin/data-lifecycle.astro`, `src/pages/admin/omes/health.astro`,
  `src/pages/admin/reporting.astro` (history section only — coordinated with
  wave 2, which touched this file for its stat cards)
- **Decision made:** `approvals.astro` keeps its drill-in-by-query-param
  instance history (`?instance=<id>`) — **no** `.admin-two-pane` routing
  change. The audit deliberately left this open (§6.4); the issue itself
  pre-decided it before work started.
- **Landed:** every ordered event/history section identified in §6.4 —
  approval instance history, business-scope conflict history, data-lifecycle
  legal-hold history AND run history, OMES health snapshot history
  (`?serverId=…` mode only — the tenant-wide "latest per server" table is one
  row per server, not a history, and stays a `.data-table`), and reporting's
  projection rebuild history — now renders as a real `<ol class="admin-
timeline">` of `<li class="admin-timeline-item">`, with a genuine `<time
datetime>` per item (never colour/position alone). Every status this issue
  touched on these five screens (task/delegation status, business-scope
  assignment/exception status, SoD conflict flag, legal-hold/run status, OMES
  overall/stale/check-source status, rebuild status) moved from the legacy
  `.status-badge` onto `.admin-status-pill`, keeping each cell's `data-status`
  (or equivalent) raw-value hook for tests/CSS/JS. `reporting.astro`'s other
  sections (email queue health, projection freshness, scheduled-export runs)
  were left on `.status-badge` — out of this issue's file-ownership scope,
  same reasoning as wave 2's stat-card scoping.
- **Shared:** `src/styles/admin.css` gained a small `.admin-timeline { list-
style: none; margin: 0; padding: 0; }` reset for the `<ol>` wrapper itself
  (the pre-existing primitive only styled `-item`/`-label`/`-meta`, so a bare
  `<ol>` would otherwise show a browser bullet/number ahead of the
  primitive's own `::before` dot). `build:asset-budget:check`'s
  `APP_BUDGET_BYTES` was raised from 248,045 to 248,096 (measured actual
  total, no added margin — see `scripts/client-asset-budget.ts`'s own ledger
  comment).
- **Shared:** none beyond `reporting.astro` overlap with wave 2, noted above

### Wave 5 — Settings/toggle/media patterns — **DONE** ([Issue #864](https://github.com/ahliweb/awcms/issues/864))

- **Files:** `src/pages/admin/account.astro` (status-pill only, no toggle —
  §6.5), `src/pages/admin/media.astro` (media-grid + stat-card + status-pill,
  the flagship media adoption), `src/pages/admin/access-policies.astro`
  (simulator verdict pill only)
- **Explicitly out of scope for this wave:** every `.module-toggle` site
  (16 files, §4) — none is a `.admin-toggle` candidate; if #854's confirm-dialog
  primitive lands first, coordinate there instead of here
- **Shared:** none
- **Decision made:** `account.astro` and `access-policies.astro` landed
  exactly as scoped — `.admin-status-pill` on the SSO-connected badge, the
  current-session badge, a new two-factor state pill, and the simulator's
  Allow/Deny verdict (built client-side from translated `data-verdict-*`
  attributes on the form, since that markup lives in a `<script>`, not SSR
  Astro). `media.astro` did **not** land the "media-grid" third of its own
  scope line above: its object table deliberately renders no `<img>`
  (documented in the file's own header, tied to a security decision —
  showing a policy-violating image once more to the person removing it is
  the wrong outcome), so §6.6's "flagship media adoption" framing assumed
  markup this screen does not have. `.admin-stat-card` and
  `.admin-status-pill` landed on it as real class swaps; `.admin-media-grid`
  stays unadopted here — see doc 14's `MediaGrid` row for the usage rule
  this established. The one real `.admin-media-grid`-shaped markup in the
  repo is the shared picker (`src/lib/ui/media-picker-client.ts` +
  `.media-picker-panel`/`.media-option`), consumed by `blog.astro`,
  `blog-ads.astro`, `blog-homepage.astro` and `site-profile.astro` — all four
  outside this issue's file ownership and mid-flight under other work at the
  time. Migrating it is a follow-up scoped to that script and its four
  consumers together.

### Follow-up — shared media picker adopts `.admin-media-grid` — **DONE** ([Issue #872](https://github.com/ahliweb/awcms/issues/872))

- **Files:** `src/lib/ui/media-picker-client.ts`, `src/styles/admin-screens.css`;
  `src/pages/admin/blog.astro` (x2 pickers), `src/pages/admin/blog-ads.astro`,
  `src/pages/admin/site-profile.astro` (x2 pickers) each add `admin-media-grid`
  to their static `.media-picker-panel` markup
- **Verified by grep, not just named in the issue:** `blog-homepage.astro`
  — the issue's fourth listed consumer — has no `.media-choice`/
  `.media-picker-panel` markup at all. It mentions `wireMediaPickers` only in
  a doc comment explaining why it deliberately does NOT use the picker
  (`gallery_block` is an ordered id list, not a pick-one control; ADR-0009's
  reasoning). Nothing to migrate there.
- **Decision made:** every thumbnail `wireMediaPickers` renders is now a real
  `.admin-media-grid-tile`, and the panel that holds them carries
  `admin-media-grid` — the same primitive `/admin/media` decided NOT to
  adopt (§6.6 above). The tile's `<img>` fills it edge-to-edge per the
  primitive's contract, which leaves no room for the picker's previous
  below-image label — that label (`describePickableMedia`: alt text, then
  caption, then filename) moved to a `.media-option-caption` overlay instead,
  and doubles as the tile button's accessible name (no separate `aria-label`
  needed). The picker's own duplicate grid/box CSS — `display: grid` +
  `grid-template-columns` on `.media-picker-panel`, and the border/background/
  radius `.media-option` used to repeat — is removed from
  `admin-screens.css` now that `admin.css` supplies both; only the panel's
  bordered/scrollable chrome and the new caption overlay stay there. The
  field's current value (if any) is marked on reopen via
  `aria-pressed`/`data-selected`, never by tile colour/outline alone
  (WCAG 1.4.1) — the picker did not previously expose a "current choice"
  state in its own grid at all, so this is additive, not a behaviour change
  to anything the issue asked to preserve. `PICKER_LIST_URL`,
  `fetchPickableMedia`, `describePickableMedia` and `wireMediaPickers`'s
  signature are all unchanged.
- **Shared:** `APP_BUDGET_BYTES` (`scripts/client-asset-budget.ts`) raised
  from 250,423 to 250,480 (measured actual total after the CSS reduction
  above) — see that file's own ledger comment.

### Wave 6 — OMES-specific admin surfaces — **DONE** ([Issue #865](https://github.com/ahliweb/awcms/issues/865))

- **Files:** `src/pages/admin/omes/ai-privacy.astro`, `omes/arsitektur.astro`
  (status-pill only, no stat-card — §6.3), `omes/audit.astro`,
  `omes/backups.astro`, `omes/deployments.astro`, `omes/enrollments.astro`,
  `omes/hermes.astro`, `omes/jobs.astro`, `omes/operations.astro`,
  `omes/orkestrasi-langsung.astro`, `omes/progres-hermes.astro`,
  `omes/servers.astro` — all migrated onto `.admin-status-pill`/
  `.admin-status-pill-dot` (`data-variant` -> `data-tone`), and the four with
  a KPI tile (`backups`, `deployments`, `jobs`, `servers`) also onto
  `.admin-stat-card`/`.admin-stat-card-grid`. `orkestrasi-langsung.astro`'s
  polling client script (activity-stream re-render) migrated in lockstep so
  its client-rendered badges match the SSR rows.
- **Shared:** `src/styles/omes-control-center.css` audited — it needed no new
  CSS. It already carried the dual `.stat-card`/`.admin-stat-card` selector
  list from Issue #860 (wave 2), and it never redeclared `.status-badge`/
  `.admin-status-pill` itself: both classes consume the same
  `--color-*-soft`/`-on-soft` custom properties the file already overrides
  for the OMES dark palette, so the tone cascade (including `danger`/`info`,
  which bare `.status-badge` never defined — see below) carried over
  automatically. `omes/health.astro` (wave 4, out of scope for #865) kept
  needing the file's `.stat-card` half of each selector pair until Issue
  #866 (wave 7) migrated it — see that section.
- **Decision made:** migrating uncovered a latent styling bug rather than
  introducing one — several of these screens passed `data-variant="danger"`/
  `"info"` to `.status-badge`, which only ever defined `success`/`neutral`/
  `warning`; those badges silently rendered with the undifferentiated
  default fill. `.admin-status-pill` defines all five tones, so they now
  render as intended, with no markup logic changed. `build:asset-budget:check`'s
  `APP_BUDGET_BYTES` was raised from 248,045 to 248,058 (measured actual
  total — the only growth is `orkestrasi-langsung.astro`'s client script
  template literal, whose class names got longer).

- **Later addition:** `omes/mission-control.astro` (ahliweb/omes#265) was added after wave 6 completion and uses `.admin-status-pill` (SP) on the same design-system primitives. Its History mode (ahliweb/omes#266) adds a small set of page-scoped replay classes (banner, event list, transport) to `omes-control-center.css`; its contextual actions (ahliweb/omes#267) reuse the same page-scoped rules plus one new `.omes-mc-warning` class, and reuse `.btn` and `ConfirmDialog`; no `.stat-card`/`.status-badge` is introduced.

### Wave 7 — Final sweep, legacy class retirement, docs — **DONE** ([Issue #866](https://github.com/ahliweb/awcms/issues/866))

- **Files migrated (last `.stat-card`/`.stat-grid`/`.stat-label`/
  `.stat-value`/`.stat-hint` consumers):** `src/pages/admin/data-lifecycle.astro`,
  `site-search.astro`, `idn-regions.astro`, `tenants.astro`, `sync.astro`,
  `push-notifications.astro`, `domain-events.astro`, `omes/health.astro` — all
  onto `.admin-stat-card`/`.admin-stat-card-grid`/`.admin-stat-card-label`/
  `.admin-stat-card-value`/`.admin-stat-card-caption`. `newsletter.astro` was
  verified already migrated (wave 3) — nothing left on this file. `omes/
index.astro`'s one remaining `.stat-value` hit was a stale doc-comment
  cross-reference, corrected to `.admin-stat-card-value` (no markup change
  needed — it already rendered the primitive since wave 2).
- **Files migrated (last `.status-badge`/`.status-dot` consumer):**
  `src/pages/admin/reporting.astro`'s four remaining sections (email queue
  health, projection freshness, scheduled-export configuration, scheduled-
  export runs) — the only screen wave 3/4 had deliberately left on the
  legacy pill (both waves' own file-ownership scoping, noted above). Moved
  onto `.admin-status-pill`/`.admin-status-pill-dot` with `data-variant` ->
  `data-tone`.
  `src/layouts/AdminLayout.astro` was checked and confirmed to never have
  been a consumer of either family (`.admin-sidebar-status-dot` is an
  unrelated, pre-existing class name).
- **Legacy CSS retired:** the `.stat-card`/`.stat-grid`/`.stat-head`/
  `.stat-delta`/`.stat-label`/`.stat-value`/`.stat-hint` rule blocks were
  deleted from `src/styles/admin-screens.css`, and the `.status-badge`/
  `.status-dot` rule blocks were deleted from `src/styles/admin.css` (base
  declaration) and `src/styles/admin-screens.css` (tinted `info`/`danger`
  variant additions). `src/styles/omes-control-center.css`'s dual selector
  lists (`.stat-card X, .admin-stat-card X { … }`, wave 2's Shared note
  above) dropped their `.stat-card` half now that every OMES screen renders
  `.admin-stat-card` only.
- **Regression gate added:** `tests/admin-legacy-classes-retired.test.ts`
  walks every `.astro`/`.ts`/`.tsx`/`.css` file under `src/` and fails if any
  of the nine retired class tokens reappears as a real consumer (class
  attribute, `classList`/`querySelector` string literal, or CSS selector) —
  comments (including this document's own historical narration and the
  "ported from the legacy `.stat-grid`" provenance notes left in
  `admin.css`) are stripped first via the shared `scripts/lib/source-text.ts`
  `stripComments`, so history is never mistaken for a live consumer. The
  three wave-specific tests (`admin-stat-card-wave2.test.ts`,
  `admin-status-pill-wave3.test.ts`, `admin-timeline-wave4.test.ts`) that
  used to pin the legacy CSS as still-defined ("#866 retires it") were
  flipped to pin its absence.
- **Asset budget shrank** — the first wave of this epic to shrink it rather
  than grow it, since retiring a whole legacy component family removes CSS
  with no replacement cost. Landing on top of [Issue #872](https://github.com/ahliweb/awcms/issues/872) (which raised
  `APP_BUDGET_BYTES` to 250,566 for the shared media picker's
  `.admin-media-grid` adoption), `scripts/client-asset-budget.ts`'s
  `APP_BUDGET_BYTES` was lowered from 250,566 to 248,033 and
  `PER_FILE_CSS_BUDGET_BYTES` from 57,300 to 56,800 (both measured actual
  values — see that file's own ledger comments).
- **Responsive/E2E sweep:** `tests/e2e/responsive-360.e2e.ts` (360px/1024px
  at the time of this issue; since #884 it sweeps 360px, 640×360 = 200%
  browser zoom of a 1280×720 desktop, 768px tablet portrait and 1024px —
  no sideways scroll at any of them) and `tests/e2e/admin-screens-render.e2e.ts` (every
  admin screen renders) re-run against a fresh Postgres 18.4 + full
  migration + seeded tenant — both green, plus the full `bun run test:e2e`
  suite (33 passed, 8 skipped for env-gated specs unrelated to this issue —
  `admin-deny-path`/`admin-read-only-access` need a second seeded user,
  `cwv-lab` needs `E2E_CWV_LAB=1`). At the time of this issue this repo had
  no `@axe-core/playwright` harness under `tests/e2e/` — the acceptance
  criterion's accessibility smoke was `responsive-360`/`admin-screens-render`
  plus the manual composition rules in doc 14, not a dedicated axe spec.
  **Closed by [Issue #877](https://github.com/ahliweb/awcms/issues/877):**
  `tests/e2e/a11y-axe.e2e.ts` now runs `@axe-core/playwright` (WCAG 2.0/2.1
  A+AA tags) against the eight representative routes this epic changed —
  `/admin`, `/admin/comments`, `/admin/users`, `/admin/approvals`,
  `/admin/media`, `/admin/omes`, `/admin/omes/jobs`, `/admin/site-profile` —
  in light AND dark theme, at 360px and desktop, plus the ADR-0125
  `ConfirmDialog`/`ReasonPanel` opened (then cancelled). Run for real against
  a fresh Postgres 18.4 + full migration + seeded tenant while fixing this
  issue, it found and this repo fixed five real `critical`/`serious`
  violations this epic's own waves had shipped: `.admin-brand`'s wordmark
  losing its accessible name below 768px (`display: none` removes an element
  from the accessible-name computation, not just the layout — `link-name`,
  serious), `ReasonPanel`'s reason `<label>` never being a real `<label
for>` (`label`, critical), `.reason-panel { display: flex }` applying
  unconditionally instead of scoped to `[open]` (author-origin CSS beats the
  user-agent's `dialog:not([open]) { display: none }` regardless of
  `!important`, so a cancelled panel stayed laid out and on-screen after
  `.close()`), `.admin-logout` using the theme-aware `--color-text-muted`
  on the always-dark sidebar background instead of `--color-sidebar-text`
  (`color-contrast`, serious, 3.07:1 measured against the 4.5:1 floor), and
  the dashboard's `.dd-alert` using `--color-danger-strong` as text on
  `--color-surface` (`color-contrast`, serious, dark theme only: 3.81:1 against
  4.5:1), fixed by swapping to `--color-danger` (5.81:1 dark; light unchanged at
  4.83:1 since both tokens are `#dc2626` there). See
  `tests/e2e/a11y-axe.e2e.ts`'s own header comment for why the sweep also
  runs under `reducedMotion: "reduce"` — `.fade-in-up`'s 240ms entrance
  animation genuinely lowers rendered contrast mid-transition, which axe
  samples as pixel colour rather than trusting computed style, and that
  transient dip is not this criterion's subject.
- **Docs:** this document (all waves marked DONE, §6.6 corrected below),
  `docs/awcms/14_ui_ux_design_system.md`, and the `awcms-ui-screen` skill —
  all updated to state the composition rules as fact, not as a pending
  decision. `docs/PROJECT_STATE.md` §4 does not track epic #858 as a
  recommendation round (it was opened and worked as a GitHub issue chain,
  not a §4 round), so no entry was added there.

## 8. What Wave 1 did not do (historical — resolved by later waves)

At the end of Wave 1 (docs-only audit), this section recorded three
deliberately open questions. All three are now resolved:

- Wave 1 itself changed no `.astro`/`.ts`/`.css` file — waves 2–7 did, per
  the packages in §7, all now **DONE**.
- The `.stat-card` vs `.admin-stat-card` delta/head affordance question (§4)
  was resolved by wave 2: ported as `.admin-stat-card-head`/
  `.admin-stat-card-delta`. The `approvals.astro` two-pane question (§6.4)
  was resolved by wave 4: kept the query-param drill-in, no
  `.admin-two-pane` routing change.
- `docs/awcms/14_ui_ux_design_system.md` now states the composition rules
  this epic established as fact (§9) — the rules are no longer merely
  surveyed.

## 9. Documentation links

- [`docs/awcms/14_ui_ux_design_system.md`](14_ui_ux_design_system.md) §
  Component library documents `.admin-status-pill`/`.admin-stat-card` and
  the other composition rules this epic established (segmented as nav +
  aria-current, bulk bar only over existing bulk endpoints, timeline as
  `<ol>`+`<time>`) as the CURRENT admin vocabulary — the legacy
  `.status-badge`/`.stat-card` classes it used to also document were
  retired by Issue #866 (wave 7) and no longer exist in `src/styles/`.
- [`docs/awcms/README.md`](README.md) lists this document in the index
  table, next to `family-compatibility.md`.
