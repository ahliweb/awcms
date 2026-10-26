🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0149-the-admin-data-page-is-a-server-rendered-keyset-paged-pattern-with-shared-primitives.id.md)

# ADR-0149 — The admin data page is a server-rendered, keyset-paged pattern with four shared primitives

- **Status:** Proposed
- **Review:** becomes Accepted once a maintainer reviews it. The primitives and the first adopter (`/admin/users`) land in the same change as this record because a standard no screen uses is a claim, not a standard; the pattern binds new screens only after acceptance.
- **Date:** 2026-10-26
- **Decision maker:** ahliweb (maintainer review pending)
- **Resolves:** Issue #1196 (adopting the data-page pattern from the October 2026 admin redesign proposal).
- **Extends, does not supersede:** [ADR-0120](0120-the-admin-redesign-splits-one-hue-into-three-roles.md) (tokens, shell, the contrast gate) and [`docs/awcms/14_ui_ux_design_system.md`](../awcms/14_ui_ux_design_system.md) §Component library (its Table, Pagination and `FilterBar` rows). It changes **no token name and no contrast-measured value**.
- **Related:** [ADR-0095](0095-the-interface-speaks-the-readers-language.md) (gettext catalogues), [ADR-0125](0125-admin-v2-primitives-confirm-dialog-save-bar-reason-panel.md) (the sibling component decision), [`design/redesain-ui-ux-2026-10/`](../../design/redesain-ui-ux-2026-10/README.md) (`PolaData.dc.html`, `AwcmsUsers.dc.html`, `AwcmsAudit.dc.html` — reference only), `src/modules/_shared/keyset-pagination.ts`, `src/lib/ui/admin-data-page.ts`, `src/components/admin/`.

## Context

Verified on `main` at 26 October 2026:

- Doc 14 says lists use **keyset** pagination "not large offsets", and lists a `Pagination` component and a `FilterBar`. Neither exists: `src/components/` has no pager, no filter bar and no `src/components/ui`. The sentence is a promise with no shared implementation behind it.
- Each list screen therefore builds its own. `audit-trail.astro` has a GET `role="search"` form but "NO cursor" (its own docblock: it shows the newest N up to 100 and says so). `users.astro` rendered every user the loader returned — `listTenantUsers` is `LIMIT 100`, ordered by login identifier — with no search, no sort and no paging, and an empty state that could not tell "nobody exists" from "nothing matches".
- The redesign proposal in `design/redesain-ui-ux-2026-10/` settles the anatomy once (`PolaData.dc.html`): a labelled search, removable filter chips, a result summary, sortable headings, and a keyset footer with Previous/Next and a page size. It is reference-only and explicitly says a change to the shell or a standard needs its own issue and, where it changes a standard, an ADR. This is that ADR.
- The repo's constraints on any such component are already fixed by earlier decisions: `default-src 'self'` with no `'unsafe-inline'` (an import-free `<script>` is inlined and silently blocked), server-rendered Astro pages, gettext catalogues with the English sentence as the msgid, the three-roles colour tokens, and a per-surface client-asset budget.

## Decision

### 1. The data-page pattern

A list screen in `/admin/*` that shows rows a reader searches, narrows or pages through follows this anatomy. Items 1–6 are the normative surface; each is a primitive in §2.

1. **Search** — one labelled text box inside a `<form method="get" role="search">` that has an accessible name. The label is visible text tied to the input with `for`/`id`. The form is a plain GET form: it works with JavaScript disabled.
2. **Filters** — one labelled `<select>` per filter, in the same form. Sort key and direction are also offered as selects, because a stacked table hides its header row on a phone.
3. **Active filters as chips** — when anything is applied, one removable chip per active filter (a real link to "this page without that filter", named by what it removes), plus a "Clear filters" link and a polite live-region summary of the result count.
4. **Empty state that names the query** — "No results for “rina”" with what to try and a one-click clear, distinct from the genuinely empty list ("No users yet"). The first must never read as the second.
5. **Sortable headings** — a `<th scope="col">` containing a link; `aria-sort="ascending|descending"` on the sorted column only; the direction is also shape-coded (▲/▼), never colour alone. First activation sorts ascending; activating the sorted column flips it. There is no unsorted state, because a keyset cursor needs a total order.
6. **Keyset footer** — a `<nav aria-label>` with the range ("Showing 1–25 of 80"), a page-size group (**10 / 25 / 50**, default 25, `aria-current` on the active one) and **Previous / Next**. An unavailable direction stays in the layout and carries `aria-disabled="true"`; it is not a tab stop. **No page numbers and no "jump to page N".**

### 2. Four shared primitives in `src/components/admin/`

| Component               | Renders                                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DataListToolbar.astro` | items 1–3: the `role="search"` form (search, filter selects, optional sort selects, hidden `limit`), the chip list with remove links and "Clear filters", the live-region summary |
| `DataEmptyState.astro`  | item 4: the naming/clearing empty state, as a table row (`colspan`) or standalone; the page supplies the copy for the genuinely-empty case                                        |
| `SortableHeader.astro`  | item 5: `<th aria-sort>` with a sort link, an aria-hidden arrow, and a visually hidden "(sort descending)" saying what activation does                                            |
| `KeysetPager.astro`     | item 6: the footer                                                                                                                                                                |

They are **server-rendered `.astro` components that ship no script**. All state is in the URL: `?q=&<filter>=&sort=&dir=&cursor=&limit=`. The pure rules — parsing the URL, building the link for "this page with one thing changed", chip removal, and a keyset slice — live in `src/lib/ui/admin-data-page.ts` and are unit-tested without rendering. Every visible string goes through `t()`/`tn()` with `en` and `id` entries; strings that differ per screen arrive as translated props, strings common to every data page are owned by the component.

### 3. The URL contract

- Parameters: `q` (≤ 100 characters), the page's declared filter keys, `sort` and `dir` (from the page's declared sort keys), `cursor` (opaque), `limit` ∈ {10, 25, 50}.
- Anything undeclared or malformed **falls back to its default**; a data page never answers a hand-edited URL with an error.
- Defaults are **omitted**, so the unfiltered page's address is the bare path.
- **Any change other than paging drops `cursor`.** A cursor is a position in one ordering of one result set; carrying it across a changed query, filter, sort or size lands the reader mid-list of a different list.

### 4. What a cursor is, and is not

A cursor encodes the anchor row's `(sort value, id)` and a direction (after / before) and **nothing else**. The order always ends in `id`, so equal sort values neither repeat nor skip a row between pages. It is a _position_, never an _authorization_: the server authorizes every request and runs it inside `withTenant`; row-level security decides which rows exist. Forging or replaying a cursor can move a reader within data they were already allowed to read; it cannot widen what they may read. On an SSR page an unreadable cursor means **the first page, not an error**; the JSON API in `_shared/keyset-pagination.ts` keeps its stricter `400` (a machine client should be told). A SQL-backed list binds cursor values as parameters and never interpolates them; it does not need the cursor to be signed to be safe, and signing it would add a key to rotate for no change in what an attacker can reach.

### 5. Totals

The footer shows "of N" **only when N is exact and cheap**: a list already in memory, or an indexed count. `totalIsApproximate` switches the wording to "of about N". Otherwise the range stands alone. A `COUNT(*)` is never run to decorate a footer, and a log-shaped screen (audit trail) shows no total.

### 6. Progressive enhancement, and the CSP

The baseline is **no JavaScript**: search, filter, sort, page size and paging are links and a GET form. That is not a fallback for the slow case; it is the implementation, and it is why the primitives add **no byte of script** to the client budget. Enhancement (a debounced live search, focus restoration) is allowed later **only** as a script that imports a module from `src/lib/ui/` so Astro emits it as an external asset under `default-src 'self'` (the rule `admin-form-client.ts` documents), and only if the page remains fully usable without it.

### 7. Scope of this change

- Adds the four primitives, `src/lib/ui/admin-data-page.ts`, the stylesheet block in `admin.css`, and the catalogue entries.
- Moves `/admin/users` onto them as the first adopter. **No API, OpenAPI, migration, permission or audit change.** `GET /api/v1/users` and `listTenantUsers` take no query, sort or cursor; the page therefore applies search, filter, sort and paging **on the already-loaded, already-authorized, `LIMIT 100` list**, through the same URL contract and cursor shape. Two consequences are accepted and stated: the search matches what the page _shows_ — the masked login identifier and the role codes — never the raw identifier (PII that this page does not load); and totals are exact for the loaded rows, not for a tenant with more than 100 users. Pushing the query into SQL is a follow-up that changes the data source and nothing a reader or a bookmark can see.
- Adds no token, renames none, and changes no contrast-measured value. The new rules use only pairings the registry in `scripts/design-token-contrast-check.ts` already measures.

## Consequences

### Positive

- One implementation of the part of a list screen that has been rebuilt per screen, with the accessibility behaviour decided once.
- The URL is the state: reload, share, Back and bookmarks work, and a page can be tested by fetching a URL.
- Keyset paging is the default for new lists, as doc 14 already said.

### Negative / trade-offs

- **Keyset vs offset under FORCE RLS.** `OFFSET n` evaluates the row-level-security predicate and the sort for every row it then discards, so cost grows with the page number, and it shows a row twice or skips one when data changes between pages. A keyset predicate on `(tenant_id, sort key, id)` seeks through the index and costs the same on every page; stable order is guaranteed by the `id` tiebreak. The price is real and accepted: **no random access** ("page 37") and no cheap total. Screens that genuinely need numbered pages — the proposal names the public channel and category archives — are a different pattern and are out of scope here.
- **Accessibility.** Links for sorting and paging keep the page keyboard- and screen-reader-complete with no script, and `aria-disabled` keeps the footer's geometry stable. The costs: every sort or filter is a navigation (a full page load, and focus returns to the document start), a mouse-first admin gets no instant feedback, and `aria-disabled` on a non-link is a convention that screen readers announce but a browser does not enforce — which is why the unavailable control is rendered with no `href` rather than a disabled-looking link. Target size: ADR-0120 keeps pointer-first controls at 36–38px (WCAG 2.2 AA 2.5.8 asks 24px); the new controls reach **44px under a coarse pointer** and keep compact metrics for a mouse. If the maintainers want 44px everywhere, that is an ADR-0120 amendment, not a quiet change here.
- **SSR-first progressive enhancement.** Nothing is lost when a script fails to load, but a debounced "search as you type" is a later, optional layer rather than part of this one. The size select is three links, not a `<select>`, because a select needs a script to submit on change.
- **i18n.** Strings common to every data page live in the components, so a wording change is one catalogue edit; strings specific to a screen are props, and a screen that forgets them gets English from the msgid fallback. A chip's text is a translated sentence assembled on the server ("Status: Active"), so it cannot be rebuilt on the client without shipping the catalogue (ADR-0095). The 100-character search bound is counted in characters, not bytes.
- **Interim in-memory slicing.** Slicing a loaded list is exactly right for a bounded config list and exactly wrong for an unbounded table. `sliceKeyset` documents that it is not a licence to load a large table and page it in the page.

### Neutral

- The mobile stacked table hides its `<thead>`; the sort links inside it are removed from the tab order (`visibility: hidden`) and the toolbar's Sort select is the control at that width.
- The client-asset budget for the app audience rose by the measured stylesheet growth (see `scripts/client-asset-budget.ts`); no script was added.

## Alternatives considered

- **Numbered pages (offset).** Familiar, and it gives "page 37", but it fails exactly where lists grow and under concurrent writes (§Consequences). Rejected for admin lists; the public archive case remains open.
- **A client-side data grid island.** Instant sort and filter, but a bundle on every list screen, a second source of truth beside the URL, and a CSP-bound script that must work before the page is usable. Rejected as the baseline; not forbidden as an enhancement (§6).
- **Leaving each screen to build its own.** Is how several hand-built filter forms and no shared pager exist today. Rejected.
- **Signed cursors.** The cursor carries a position, not a right; signing buys no authorization and adds a secret to rotate. Rejected (§4).
- **Adopting the proposal's canvas wholesale (11px→12px headings, collapsed sidebar sections, "Simpan tampilan").** Out of scope: those change shell decisions ADR-0120 recorded, and one concern per ADR.
