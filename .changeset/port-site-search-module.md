---
"awcms": minor
---

feat(site-search): port the `site_search` module from awcms-micro (ADR-0040)

Adds a tenant-scoped, cross-content PostgreSQL full-text search index over
PUBLISHED public website content, its public host-resolved query/suggest
surface, and its ABAC-guarded admin index/settings/diagnostics API.

- **New module `site_search`** (`type: domain`, depends only on
  `tenant_admin`/`identity_access`) owning `awcms_site_search_documents` plus
  tenant config, the index run ledger, failed-item diagnostics, and an opt-in
  minimized query log (`sql/064`, `sql/065`).
- **New contribution seam** `ModuleDescriptor.searchSources` — content modules
  declare reviewed, pure-data source descriptors in their own `module.ts` and
  the aggregator discovers them through `listModules()`, so nothing depends on
  `site_search`. `MODULE_CONTRACT_VERSION` 2.1.0 → 2.2.0 (additive: a
  `module.ts` that omits `searchSources` stays valid). `blog_content`
  contributes `blog_content.post`.
- **New public endpoints** `GET /api/v1/site-search/query` and `/suggest`
  (anonymous, host-resolved, rate-limited) plus the public `/search` page, and
  **new admin endpoints** `GET|PUT /api/v1/site-search/settings` and
  `/api/v1/site-search/index/{status,reconcile,rebuild,failures}`.
- **New scheduled job** `bun run site-search:reconcile` and a new registry gate
  `bun run site-search:sources:check` (added to the `check` chain).
- **New `AccessAction` member** `reconcile` (deliberately not high-risk; the
  route is still idempotency-keyed and audited).

Public URLs are built with a server-resolved `:tenantCode` because this base's
public content routes are path-tenant-scoped (`/blog/{tenantCode}/{slug}`).
awcms-micro's inline typeahead script on `/search` is not ported: this base's
CSP forbids inline scripts and its public pages have no bundling step, so the
page ships the no-JS core search and `/suggest` stays available to a theme's own
client.

Existing tenants do not retroactively gain the six new permissions — like every
prior permission-seed migration, only tenants created after it runs get them via
setup initialization. Backfill `awcms_role_permissions` when deploying.
