---
name: awcms-site-search
description: The site_search module HAS ALREADY been ported into this repo (from awcms-micro Issue #270 / ADR-0031, here ADR-0040; migrations `sql/064` schema + `sql/065` permissions, Wave-1 `docs/awcms/absorb-awcms-micro-roadmap.md`). A per-tenant cross-content PostgreSQL FTS index over published public content — `type: domain`, deps `[tenant_admin, identity_access, module_management]` (the last one added in #251 — the public route gates on `fetchTenantModuleEntry`), five `awcms_site_search_*` tables (ENABLE+FORCE RLS), anonymous host-resolved public endpoints `GET /api/v1/site-search/{query,suggest}` + the `/search` page, admin `/api/v1/site-search/{settings,index/*}`, the job `bun run site-search:reconcile`, the gate `bun run site-search:sources:check`. The contribution seam is `ModuleDescriptor.searchSources` (MODULE_CONTRACT_VERSION 2.2.0) — content modules DECLARE their sources, the aggregator discovers them through `listModules()`. Use when adding a new search source, changing relevance/snippet/rebuild, or touching search config/diagnostics.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Cross-Content Site Search

Follow `src/modules/site-search/README.md` and
[ADR-0040](../../../docs/adr/0040-site-search-module-admission.md). This module
**exists and can be called** in this repo.

## Arrow direction: DO NOT reverse it

`site_search` is the **consumer/aggregator**. Content modules are the **providers**.
`site_search.dependencies` is ONLY `["tenant_admin", "identity_access"]`, and no
module may `dependencies`/`consumes` onto `site_search`. If the aggregator
imports a port owned by `blog_content`, it drags a dependency into every content
module that follows — which is exactly what this design avoids.

`tests/site-search-module.test.ts` enforces this invariant; a reversed edge still
passes typecheck and still passes `modules:dag:check`, so that test is the gate.

## Adding a new search source

Add a `searchSources` entry **in the `module.ts` of the module that owns the
content** — not in `site-search/`, and not by writing to the index table. The
existing example: `blog_content.post` in `src/modules/blog-content/module.ts`.

Rules enforced by `bun run site-search:sources:check` (in the
`bun run check` chain) — all of them mutation-proven red:

- `ownerModuleKey` **must** equal the `key` of the declaring module.
- `key` is unique across the registry, and `(tableName, resourceType)` is unique — two
  sources reading the same table as the same type produce duplicate documents.
- `tableName` **must** be prefixed `awcms_`; every column name snake_case.
- `privacyClassification` **must** be `"public"`.
- `urlTemplate` must be an absolute path; only the `:slug`/`:id`/`:tenantCode` placeholders.

**The descriptor is PURE DATA.** No function references, no SQL. A generic
engine builds a parameterised query from it: values are always bound, only
IDENTIFIERS are interpolated and that goes through `assertSafeIdentifier` /
`assertSafeTableName` immediately before interpolation.

## `:tenantCode` — different from awcms-micro

This base's public content routes are **tenant-path based** (`/blog/{tenantCode}/{slug}`,
ADR-0009), not host-resolved `/news/:slug` like awcms-micro. That is why
`SearchSourceDescriptor.urlTemplate` here has an additional `:tenantCode`
placeholder, resolved by the engine **once per run** from `awcms_tenants.tenant_code`.

A template that contains `:tenantCode` but is not given a tenant code will **THROW**,
rather than emit a literal `:tenantCode` — a silently broken public URL is a
defect served to every visitor. That failure is recorded as
`extract_error` in `awcms_site_search_index_failures`.

The final URL is part of `source_checksum`, so renaming `tenant_code`
automatically triggers a re-index on the next reconcile.

## Publication state: enforced at the boundary, not in the query

The index **only** contains rows that pass the descriptor's `publicationFilter`. Draft /
private / soft-deleted / scheduled-but-not-live is never read INTO the
index. Because of that:

- **The index is NOT an authorization source.** Never use the presence of a document
  to decide access — the source of truth for visibility remains the content module.
- Archive/unpublish/delete at the source + reconcile removes the document (stale
  removal via an anti-join). `reindexSearchResource` does the same
  for a single resource.

## Indexing

| Operation   | Nature                                                                             |
| ----------- | ---------------------------------------------------------------------------------- |
| `reconcile` | upsert the current public set (skip when the checksum is identical) + delete stale |
| `rebuild`   | DELETE the tenant's documents for registered sources → reconcile                   |
| `reindex`   | one resource: public → upsert, non-public → delete                                 |

All three are idempotent. Reconciling again while in sync = everything `unchanged`.
The scheduled backbone: `bun run site-search:reconcile` (`--rebuild`,
`--tenant=<uuid>`), running as `awcms_worker`.

Per-item failures are isolated by `tx.savepoint` — one broken row does not
fail the whole run, and it is recorded in the diagnostics table.

## Permissions & actions

`site_search.index.{read,reconcile,rebuild}`, `site_search.settings.{read,update}`,
`site_search.diagnostics.read` (seeded by `sql/065`).

- `rebuild` is **HIGH-RISK** (deletes + re-extracts every document).
- `reconcile` is a **NEW** member of the `AccessAction` union, deliberately **NOT**
  high-risk (synchronising a projection that is fully regenerable) — but its route
  still requires an `Idempotency-Key` and is still audited. `isHighRiskAction` is
  metadata, not the idempotency/audit gate.
- Like every permission seed before it: OLD tenants do not automatically get
  these six permissions. Backfill `awcms_role_permissions` on deploy, or the
  owner of an old tenant hits a 403 that looks like a bug.

## Security that must not be regressed

- **XSS**: `ts_headline` uses a non-HTML sentinel; `renderSafeSnippet`
  escapes the WHOLE string FIRST and only then replaces the sentinel with `<mark>`.
  Reversing that order = XSS. Never pass `<b>`/`<mark>` as
  `StartSel` to `ts_headline`.
- **SQL injection**: the query text is always a bound param to
  `websearch_to_tsquery('simple', $1)`.
- **Cache**: `buildSearchCacheKey` REJECTS a key without tenant+locale+query-hash.
- **RLS**: all five tables `ENABLE` **and** `FORCE`. `ENABLE` alone is inert for
  the table owner.
- **Query log**: opt-in (`analytics_enabled`) and stores only the sha256 of the
  normalised query + its length + locale + result count. Never store the raw
  query.
- **Metrics**: no query/tenant/host label anywhere — a search term
  is free-form user text (unbounded cardinality + privacy leak).

## What does NOT exist yet (do not claim it does)

- **Typeahead on the `/search` page.** The awcms-micro inline script was NOT ported: this
  base's CSP has no `'unsafe-inline'` for scripts, and the public page here
  is an HTML APIRoute with no bundling step. The page ships core no-JS;
  `/suggest` is still there for a theme's own bundled client.
- **i18n page labels** — `DEFAULT_SEARCH_PAGE_LABELS`, this base has no i18n
  catalogue runtime.
- **Sources other than `blog_content.post`.** Blog PAGES are not indexed (they have no
  public route in this base — the results would 404); media metadata is a follow-up.
- ~~**Admin UI**~~ — **IT EXISTS**: `/admin/site-search`
  (`src/pages/admin/site-search.astro`, a `navigation` entry in `module.ts`).
  This entry once read <!-- historis:mulai -->"(`/admin/search`) — the API exists, the screen does not yet"<!-- historis:selesai -->,
  which was wrong twice over: the screen has landed, and that is not its address.
- **`domain_event_runtime` events** — the index lifecycle is still a log line.
