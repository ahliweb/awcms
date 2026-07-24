import { defineModule } from "../_shared/module-contract";

/**
 * Single source of truth for this module's `dataLifecycle` descriptor key,
 * shared with `application/retention-purge.ts` (ADR-0037) so the actual purge
 * function and the registry entry a legal hold is created against can never
 * drift apart: a hold created against this key must be checked by
 * `purgeVisitorAnalyticsData` using this SAME literal.
 */
export const VISITOR_ANALYTICS_VISIT_EVENTS_LIFECYCLE_KEY =
  "visitor_analytics.visit_events";

/**
 * `visitor_analytics` — privacy-first human visitor statistics, ported from
 * awcms-micro (epic #617-#624) as a standalone, additive module. Ships: the
 * tenant-scoped session/event/rollup schema (migrations 049 permissions, 050
 * schema, 051 session-lookup index), the identity/UA/bot classification +
 * path-sanitization + salted-hashing domain helpers, the additive PUBLIC
 * visit-ingest endpoint (`POST /api/v1/analytics/collect`), the authenticated
 * `/api/v1/analytics/*` read API (ABAC-guarded), the on-demand retention
 * purge endpoint (`POST /api/v1/analytics/retention/purge`), the scheduled
 * rollup + retention-purge jobs (`bun run analytics:rollup` /
 * `analytics:purge`), and the `/admin/analytics` dashboard.
 *
 * `type: "system"` (mirrors awcms-micro, NOT `"domain"`): human visitor
 * telemetry is platform/observability infrastructure every tenant shares the
 * mechanism of (same reasoning as `reporting`/`logging`), not a tenant-facing
 * business feature. Higher volume and different retention/privacy needs than
 * `reporting`/`logging` is exactly why it is its own module.
 *
 * PORT ADAPTATIONS (documented, not silent):
 *  - COLLECTION IS A PUBLIC INGEST ENDPOINT, NOT MIDDLEWARE. awcms-micro
 *    collected via `src/middleware.ts` (observing every request). This base
 *    keeps `src/middleware.ts` UNTOUCHED (login/Turnstile/CSP guarantees
 *    unchanged) and exposes the same collector logic via an additive public
 *    beacon endpoint that resolves the tenant from the request's `tenantCode`
 *    (the RLS-free `awcms_tenants` table, ADR-0009 — same as the existing
 *    `/blog/{tenantCode}` public routes, so NO SECURITY DEFINER is needed).
 *    The beacon is anonymous-only: `identity_id`/`login_identifier_snapshot`
 *    are always null.
 *  - data_lifecycle COUPLING RE-WIRED (ADR-0037). The `data_lifecycle` module
 *    was ported to this base, so the `dataLifecycle` descriptor
 *    (`visitor_analytics.visit_events`, delegated) and the `LegalHoldGuardPort`
 *    gate on step 1's `awcms_visit_events` DELETE are RE-ADDED, exactly as
 *    awcms-micro: an active legal hold on this descriptor now blocks the events
 *    purge. Steps 2-4 (session raw-detail clearing, session deletion, rollup
 *    deletion) stay ungated (not covered by any registered descriptor).
 *  - NEWS PORTAL PRESET WIRING DEFERRED. awcms-micro's
 *    `news_portal_full_online_r2` preset enables this module. This base's
 *    `news_portal` was ported without that wiring and is NOT modified here
 *    (this module ships standalone).
 *  - NO `reporting` LIFECYCLE DEPENDENCY. awcms-micro lists `reporting` in
 *    `dependencies`, but `dependencies` governs enable/disable LIFECYCLE
 *    ORDERING only (see `_shared/module-contract.ts`) and neither micro nor
 *    this base consumes any `reporting` capability, port, table, or projection
 *    from `visitor_analytics` (no `capabilities.consumes` entry, no import).
 *    `reporting` is a conceptual PEER (both `type: "system"` observability),
 *    not a runtime prerequisite — visitor telemetry has its own schema and
 *    rollup and functions with `reporting` disabled. Declaring the edge would
 *    force `reporting` to stay enabled for no functional reason and wrongly
 *    make it a non-leaf. Dropped here (kept `tenant_admin`/`identity_access`/
 *    `logging`, which ARE used for tenant context, ABAC, and audit).
 */
export const visitorAnalyticsModule = defineModule({
  key: "visitor_analytics",
  name: "Visitor Analytics",
  version: "0.1.0",
  status: "active",
  description:
    "Privacy-first human visitor statistics for admin and public routes, in both online and offline/LAN configurations (ported from awcms-micro epic #617-#624). VISITOR_ANALYTICS_ENABLED=false by default — a fresh install collects nothing until an operator opts in; raw IP, raw user-agent, and geolocation collection are each independently disabled unless explicitly enabled (see domain/visitor-analytics-config.ts). Visitor identifiers (visitor-key cookie, IP, user-agent) are stored only as salted HMAC-SHA256 hashes, never raw, unless the operator explicitly opts into raw collection. Ships the tenant-scoped awcms_visitor_sessions/awcms_visit_events/awcms_visitor_daily_rollups schema (migrations 049/050/051, RLS FORCE), the additive PUBLIC visit-ingest endpoint POST /api/v1/analytics/collect (anonymous beacon, resolves tenant from tenantCode, src/middleware.ts untouched), the authenticated ABAC-guarded read API (GET /api/v1/analytics/summary|realtime|sessions|events|pages|devices|locations|security|settings, PATCH .../settings), the high-risk POST /api/v1/analytics/retention/purge (Idempotency-Key + critical audit), the scheduled rollup and retention-purge jobs (bun run analytics:rollup / analytics:purge), and the /admin/analytics dashboard. The visit_events retention purge is gated by an active data_lifecycle legal hold (ADR-0037): the dataLifecycle descriptor and LegalHoldGuardPort coupling, dropped at the original port because data_lifecycle did not exist here yet, are now RE-WIRED. PORT DEFERRAL: the news_portal preset that enables this module in awcms-micro is not wired here.",
  dependencies: ["tenant_admin", "identity_access", "logging"],
  type: "system",
  api: {
    openApiPath: "openapi/modules/visitor-analytics.openapi.yaml",
    basePath: "/api/v1/analytics"
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_visitor_analytics",
      path: "/admin/analytics",
      order: 70,
      requiredPermission: "visitor_analytics.dashboard.read"
    }
  ],
  permissions: [
    {
      activityCode: "dashboard",
      action: "read",
      description: "Read the visitor analytics dashboard"
    },
    {
      activityCode: "realtime",
      action: "read",
      description: "Read real-time/online visitor counts"
    },
    {
      activityCode: "sessions",
      action: "read",
      description: "Read visitor session records"
    },
    {
      activityCode: "events",
      action: "read",
      description: "Read visitor page-view/event records"
    },
    {
      activityCode: "raw_detail",
      action: "read",
      description:
        "Read raw visitor detail (IP address, user-agent) separate from aggregate dashboard access"
    },
    {
      activityCode: "settings",
      action: "read",
      description: "Read visitor analytics module settings"
    },
    {
      activityCode: "settings",
      action: "update",
      description: "Update visitor analytics module settings"
    },
    {
      activityCode: "retention",
      action: "purge",
      description: "Purge visitor analytics data past its retention window"
    }
  ],
  settings: {
    schemaVersion: 1,
    // No non-secret operational default preferences yet — collection
    // behaviour is env-driven (VISITOR_ANALYTICS_*), not per-tenant settings.
    // The settings endpoints exist to reuse Module Management's generic
    // per-tenant settings storage under this module's own permission gate.
    defaults: {}
  },
  jobs: [
    {
      command: "bun run analytics:rollup",
      purpose:
        "Recompute the previous day's awcms_visitor_daily_rollups from raw awcms_visit_events, per active tenant. Idempotent (full UPSERT recompute).",
      recommendedSchedule: "daily (shortly after UTC midnight)",
      environmentNotes:
        "Runs as the least-privilege awcms_worker role when WORKER_DATABASE_URL is set; pure PostgreSQL, no external provider.",
      safeInOfflineLan: true
    },
    {
      command: "bun run analytics:purge",
      purpose:
        "Delete/clear visitor analytics data past its retention windows (events, session raw detail, sessions, rollups), per active tenant.",
      recommendedSchedule: "daily",
      environmentNotes:
        "Runs as the least-privilege awcms_worker role when WORKER_DATABASE_URL is set; pure PostgreSQL, no external provider. Destructive — use --dry-run first.",
      safeInOfflineLan: true
    }
  ],
  // ADR-0037 (data_lifecycle) — registered as a "delegated" adopter:
  // data_lifecycle's dry-run planner may READ awcms_visit_events for backlog
  // visibility, but real purge stays owned by `purgeVisitorAnalyticsData`
  // (`bun run analytics:purge`, and `POST /api/v1/analytics/retention/purge`),
  // which now consults a LegalHoldGuardPort before step 1's DELETE.
  dataLifecycle: [
    {
      key: VISITOR_ANALYTICS_VISIT_EVENTS_LIFECYCLE_KEY,
      tableName: "awcms_visit_events",
      ownerModuleKey: "visitor_analytics",
      scope: "tenant",
      cursorColumn: "occurred_at",
      retentionClass: "analytics_telemetry",
      retentionMinDays: 7,
      retentionMaxDays: 730,
      defaultRetentionDays: 90,
      partition: {
        eligible: true,
        granularity: "daily",
        rationale:
          "One row per page-view/API call — by far the highest insert rate of any table this module registers. A strong daily range-partition candidate given the short (90d default) retention window, not automated by this port (destructive migration of an existing table is out of scope) — tracked as partitioning runbook guidance."
      },
      archive: {
        archivable: false,
        rationale:
          "Current reality: purgeVisitorAnalyticsData performs straight DELETE/UPDATE-to-null operations with no archive step (privacy-first design — raw/near-raw visitor detail is deliberately NOT retained longer than necessary, so archiving it would work against the module's own privacy posture)."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Matches purgeVisitorAnalyticsData's eventsDeleted step exactly (a straight DELETE) — visitor_sessions' separate raw-detail anonymization step is a different table/descriptor, not registered here."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "occurred_at"],
          purpose:
            "awcms_visit_events_tenant_occurred_idx (migration 050) — the same index purgeVisitorAnalyticsData's own age-based DELETE already relies on."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists (archive.archivable is false above) — by design, given the privacy-first retention posture.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run analytics:purge",
        purgeFunctionRef:
          "src/modules/visitor-analytics/application/retention-purge.ts#purgeVisitorAnalyticsData",
        description:
          "Deletes/clears four categories of visitor analytics data past their respective retention cutoffs (events, session raw detail, sessions, rollups) — the same function both the scheduled job and the on-demand POST /api/v1/analytics/retention/purge endpoint call. The step-1 events DELETE is gated by a LegalHoldGuardPort (ADR-0037)."
      }
    }
  ]
});
