import { defineModule } from "../_shared/module-contract";

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
 *  - NO data_lifecycle COUPLING. awcms-micro registered a `dataLifecycle`
 *    descriptor and gated the events purge behind a `LegalHoldGuardPort` from
 *    its `data_lifecycle` module. That module is not ported to this base, so
 *    the descriptor and the legal-hold guard are dropped; the purge is
 *    unconditional. Re-introduce both if/when `data_lifecycle` is ported.
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
    "Privacy-first human visitor statistics for admin and public routes, in both online and offline/LAN configurations (ported from awcms-micro epic #617-#624). VISITOR_ANALYTICS_ENABLED=false by default — a fresh install collects nothing until an operator opts in; raw IP, raw user-agent, and geolocation collection are each independently disabled unless explicitly enabled (see domain/visitor-analytics-config.ts). Visitor identifiers (visitor-key cookie, IP, user-agent) are stored only as salted HMAC-SHA256 hashes, never raw, unless the operator explicitly opts into raw collection. Ships the tenant-scoped awcms_visitor_sessions/awcms_visit_events/awcms_visitor_daily_rollups schema (migrations 049/050/051, RLS FORCE), the additive PUBLIC visit-ingest endpoint POST /api/v1/analytics/collect (anonymous beacon, resolves tenant from tenantCode, src/middleware.ts untouched), the authenticated ABAC-guarded read API (GET /api/v1/analytics/summary|realtime|sessions|events|pages|devices|locations|security|settings, PATCH .../settings), the high-risk POST /api/v1/analytics/retention/purge (Idempotency-Key + critical audit), the scheduled rollup and retention-purge jobs (bun run analytics:rollup / analytics:purge), and the /admin/analytics dashboard. PORT DROPS: the awcms-micro dataLifecycle descriptor and data_lifecycle LegalHoldGuardPort (that module is not ported here) — purge is unconditional. PORT DEFERRAL: the news_portal preset that enables this module in awcms-micro is not wired here.",
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
  ]
});
