import { defineModule } from "../_shared/module-contract";
import {
  SITE_SEARCH_DIAGNOSTICS_ACTIVITY_CODE,
  SITE_SEARCH_INDEX_ACTIVITY_CODE,
  SITE_SEARCH_MODULE_KEY,
  SITE_SEARCH_SETTINGS_ACTIVITY_CODE
} from "./domain/site-search-permissions";

/** data_lifecycle registry keys for `site_search`'s two purgeable telemetry tables. */
export const SITE_SEARCH_QUERY_LOG_LIFECYCLE_KEY = "site_search.query_log";
export const SITE_SEARCH_INDEX_FAILURES_LIFECYCLE_KEY =
  "site_search.index_failures";

/**
 * `site_search` — Official Optional Module admitted by ADR-0040 (ported from
 * awcms-micro Issue #270, epic #261 Wave 2). Admission + first runtime code land
 * together in this PR.
 *
 * ## What this module OWNS
 *
 * A tenant-scoped, cross-content PostgreSQL full-text search index (projection)
 * over PUBLISHED website content — `awcms_site_search_documents` (sql/064, RLS
 * FORCE'd, `tsvector`/GIN + `pg_trgm` on title for suggestions) — plus its tenant
 * config (`awcms_site_search_settings`), run ledger
 * (`awcms_site_search_index_runs`), failed-item diagnostics
 * (`awcms_site_search_index_failures`), and opt-in minimized query log
 * (`awcms_site_search_query_log`). It serves the public `/search` page + bounded
 * JSON `/api/v1/site-search/query` and `/suggest` endpoints, and the admin
 * index/settings/diagnostics API.
 *
 * ## Direction of the arrow (ADR-0040 §2) — depends on nothing but Core
 *
 * `site_search` is the CONSUMER/aggregator: content modules PROVIDE reviewed,
 * pure-data `SearchSourceDescriptor`s via `ModuleDescriptor.searchSources`
 * (declarative table/column mapping + publication filter — never an executable
 * extractor), which this module's generic engine reads through `listModules()`.
 * It does NOT declare a `search_source` capability `provides` (that would trip
 * `capability_provider_conflict` with >1 content-module provider) — the
 * descriptor-list riding `listModules()` is the multi-provider seam
 * (`reporting`/`data_lifecycle` precedent). No existing module depends on
 * `site_search`, and its lifecycle `dependencies` are ONLY the two Core modules,
 * so the DAG is intact.
 *
 * ## Security spine (ADR-0040 threat model)
 *
 * Publication-state is enforced at the source→index boundary (the index holds
 * public content only; it is NEVER an authorization source); every query is
 * tenant + locale scoped (RLS FORCE + explicit predicates + tenant-first cache
 * key); the query text is always a bound parameter into `websearch_to_tsquery`
 * (SQL injection impossible); snippets are `ts_headline` sentinels escaped in
 * `renderSafeSnippet` (XSS impossible); anonymous search has per-IP rate limits,
 * query-length bounds, and result caps.
 *
 * ## Deliberately NOT here yet
 *
 * `navigation` is undeclared: the index/settings/diagnostics ADMIN API exists,
 * not an admin screen — the dashboard UI is a documented follow-up (same posture
 * as `seo_distribution`). `capabilities` is undeclared (the search-source seam is
 * the descriptor list, not a capability). `events` stays undeclared: index
 * lifecycle events (`awcms.site-search.*`) are documented log lines, not yet
 * published through `domain_event_runtime`. Indexing blog PAGES (no public route
 * in this base) and media metadata is a follow-up — the descriptor seam already
 * supports them.
 */
export const siteSearchModule = defineModule({
  key: SITE_SEARCH_MODULE_KEY,
  name: "Site Search",
  version: "0.1.0",
  status: "active",
  description:
    "Tenant-scoped, cross-content PostgreSQL full-text search over PUBLISHED website content (ADR-0040, ported from awcms-micro Issue #270). Owns the unified search index `awcms_site_search_documents` (sql/064 — RLS FORCE'd, `tsvector`/GIN + `pg_trgm` title index for suggestions), per-tenant config `awcms_site_search_settings`, the index run ledger, failed-item diagnostics, and an opt-in minimized query log. It is the CONSUMER/aggregator of reviewed, pure-data `SearchSourceDescriptor`s that content modules declare via `ModuleDescriptor.searchSources` (declarative table/column mapping + declarative publication filter — never an executable extractor or tenant SQL); the generic engine reads them through `listModules()`, so any content module is indexed without this module knowing a specific one and without a content module depending on `site_search`. An event-shaped incremental reindex primitive (`reindexSearchResource`) plus a deterministic, idempotent reconcile/rebuild (`site-search:reconcile`) keep the index a faithful projection: archive/delete/unpublish removes content from public results with no stale leakage, and reconciliation matches source counts/checksums. The public `/search` page + bounded JSON `/api/v1/site-search/query` and `/suggest` endpoints are host-resolved and tenant + locale scoped (RLS FORCE + explicit predicates + tenant-first cache key), query text is always a bound parameter into `websearch_to_tsquery('simple', $1)` (SQL injection impossible), snippets are `ts_headline` sentinels escaped before any HTML is emitted (XSS impossible), and anonymous search is rate-limited, length-bounded, and result-capped. The admin API under `/api/v1/site-search/*` (index status/rebuild/reconcile, settings, diagnostics) is ABAC-guarded, audited, idempotency-keyed, and observable. Public URLs are built from each descriptor's `urlTemplate` with a server-resolved `:tenantCode` — this base's public content routes are path-tenant-scoped (`/blog/{tenantCode}/{slug}`, ADR-0009) rather than awcms-micro's host-resolved `/news/:slug`. PORT-TIME DROP (documented, not silent): awcms-micro's inline suggestion-typeahead script on the `/search` page is not ported — this base's CSP forbids inline scripts and its public pages are plain APIRoute HTML with no bundling step, so the page ships the no-JS core search and `/suggest` remains available to a theme's own bundled client. The search index is a projection of public content only and is NEVER an authorization source.",
  dependencies: ["tenant_admin", "identity_access"],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/site-search.openapi.yaml",
    basePath: "/api/v1/site-search"
  },
  permissions: [
    {
      activityCode: SITE_SEARCH_INDEX_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's search index status, freshness, and recent index runs"
    },
    {
      activityCode: SITE_SEARCH_INDEX_ACTIVITY_CODE,
      action: "reconcile",
      description:
        "Run an idempotent index reconciliation (upsert current public documents, remove stale ones) — idempotency-keyed, audited"
    },
    {
      activityCode: SITE_SEARCH_INDEX_ACTIVITY_CODE,
      action: "rebuild",
      description:
        "Force a full search index rebuild (delete + re-extract every document) — high-risk, idempotency-keyed, audited"
    },
    {
      activityCode: SITE_SEARCH_SETTINGS_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's search configuration (enabled types, result limit, min query length, analytics opt-in)"
    },
    {
      activityCode: SITE_SEARCH_SETTINGS_ACTIVITY_CODE,
      action: "update",
      description:
        "Update this tenant's search configuration — changes the public search surface (high-risk, audited)"
    },
    {
      activityCode: SITE_SEARCH_DIAGNOSTICS_ACTIVITY_CODE,
      action: "read",
      description: "Read the search index failed-item diagnostics"
    }
  ],
  jobs: [
    {
      command: "bun run site-search:reconcile",
      purpose:
        "Deterministic, idempotent per-tenant search index reconciliation — upsert current public documents (checksum-gated skip) and remove stale ones so archive/delete/unpublish never leaks. The event-driven incremental path (reindexSearchResource) covers live changes where content modules publish real lifecycle events; this scheduled sweep is the authoritative backbone.",
      recommendedSchedule: "every 15 minutes (or after a bulk content change)",
      safeInOfflineLan: true
    }
  ],
  dataLifecycle: [
    {
      key: SITE_SEARCH_QUERY_LOG_LIFECYCLE_KEY,
      tableName: "awcms_site_search_query_log",
      ownerModuleKey: SITE_SEARCH_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "occurred_at",
      retentionClass: "analytics_telemetry",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "Opt-in, minimized telemetry (query HASH + counts only) — written only when a tenant enables analytics, so volume is bounded by opted-in traffic. A short retention window plus the (tenant, occurred_at) index keeps the age-based purge cheap without partitioning."
      },
      archive: {
        archivable: false,
        rationale:
          "Privacy-first, minimized telemetry (no raw query, no PII). Retaining it longer via an archive would work against the module's own privacy posture (same reasoning as visitor_analytics' visit events); it is simply purged when stale."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "A straight age-based DELETE of stale query-log rows — there is no soft-delete lifecycle for opt-in query telemetry, and nothing references these rows once purged."
      },
      legalHold: { applicable: false, precedence: "not_applicable" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "occurred_at"],
          purpose:
            "awcms_site_search_query_log_tenant_occurred_idx (sql/064) — the (tenant, cursor) composite the generic purge engine filters + orders by for its bounded age-based DELETE."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "No special backup/restore implications: opt-in, derived, purgeable, privacy-minimized telemetry. A restore that omits this table loses only historical query aggregates, never any source-of-truth data.",
      executionMode: "generic"
    },
    {
      key: SITE_SEARCH_INDEX_FAILURES_LIFECYCLE_KEY,
      tableName: "awcms_site_search_index_failures",
      ownerModuleKey: SITE_SEARCH_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "last_seen_at",
      retentionClass: "system_event",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 90,
      partition: {
        eligible: false,
        rationale:
          "Aggregate table (one upsert row per distinct tenant+source+resource+locale), so cardinality is bounded by distinct failing items, not by run count. A short retention window plus the (tenant, last_seen_at) index keeps the age-based purge cheap without partitioning."
      },
      archive: {
        archivable: false,
        rationale:
          "Operational diagnostics (sanitized error class/detail only). Once resolved or aged out, there is no value in a durable archive — the current index state and next reconcile regenerate any still-relevant failures."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "A straight age-based DELETE of stale, resolved, or superseded failure rows — each reconcile also clears its source's prior failures, so purging aged rows is safe."
      },
      legalHold: { applicable: false, precedence: "not_applicable" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "last_seen_at"],
          purpose:
            "awcms_site_search_index_failures_tenant_last_seen_idx (sql/064) — the (tenant, cursor) composite the generic purge engine filters + orders by for its bounded age-based DELETE."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "No special backup/restore implications: derived, purgeable operational diagnostics. A restore that omits this table loses only historical failure aggregates, which the next reconcile regenerates for any still-failing item.",
      executionMode: "generic"
    }
  ]
});
