---
name: awcms-visitor-analytics
description: The visitor_analytics module HAS ALREADY been ported into this repo (from the awcms-micro epic #617-#624) as a standalone `type:"system"` module. Use when adding/changing `/api/v1/analytics/*`, the session/event/rollup schema (`awcms_visitor_sessions`/`awcms_visit_events`/`awcms_visitor_daily_rollups`, migrations 049/050/051), the identity/UA/bot classification helpers + path sanitisation, the public ingest endpoint `POST /api/v1/analytics/collect`, the `/admin/analytics` dashboard, geolocation enrichment, or the `analytics:rollup`/`analytics:purge` jobs. It summarises the port decisions (the data_lifecycle legal-hold coupling RE-WIRED per ADR-0037 — `purgeVisitorAnalyticsData` 5th param `legalHoldGuard`; a hold (scoped/tenant-wide) skips the WHOLE purge (events + sessions + rollups), broader than micro; the news_portal preset wiring DEFERRED; collection = a public ingest endpoint NOT middleware; there is NO SECURITY DEFINER) so that follow-up changes do not regress privacy/RLS.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Visitor Analytics (code guide)

The module **ALREADY EXISTS** in this repo: `src/modules/visitor-analytics/`,
migrations `sql/049`–`sql/051`, registered in `src/modules/index.ts`. This is a guide to
code you can call — not a target specification. Also read
`src/modules/visitor-analytics/README.md`.

## Module shape (what is in the code)

- **Descriptor** `module.ts`: `key: "visitor_analytics"`, `type: "system"`,
  `dependencies: [tenant_admin, identity_access, logging, reporting]`, 8
  permissions, `navigation` `/admin/analytics`, `jobs` (rollup+purge),
  `settings.schemaVersion:1`. The `dataLifecycle` field
  (`visitor_analytics.visit_events`, delegated) ALREADY exists — the legal-hold coupling
  was RE-WIRED (ADR-0037), see §Port.
- **domain/** (pure, unit-tested without a DB): `visitor-analytics-config.ts`
  (privacy-first env resolver), `visitor-key.ts` (salted HMAC-SHA256 +
  anonymous visitor key), `user-agent.ts`, `human-classifier.ts`,
  `path-sanitizer.ts`, `referrer.ts`, `request-area.ts`, `client-ip.ts`,
  `geo-enrichment.ts`, `analytics-range.ts`, `analytics-response-shaping.ts`
  (the raw-detail gate), `dashboard-view.ts`, `visitor-key-cookie.ts`.
- **application/**: `collector.ts` (the only writer of sessions/events, fail-open,
  `workClass:"background_sync"` `queueTimeoutMs:200`), `analytics-queries.ts`,
  `rollup.ts`, `retention-purge.ts`, `event-directory.ts`, `session-directory.ts`.
- **api**: `src/pages/api/v1/analytics/{collect,summary,realtime,sessions,events,pages,devices,locations,security,settings}.ts`
  - `retention/purge.ts`.
- **admin**: `src/pages/admin/analytics.astro` (SSR-rendered).
- **jobs**: `scripts/visitor-analytics-rollup.ts` (`bun run analytics:rollup`),
  `scripts/visitor-analytics-purge.ts` (`bun run analytics:purge`).

## Privacy invariants (DO NOT regress)

1. **Off by default.** `VISITOR_ANALYTICS_ENABLED=false`. The `collector` &
   the ingest endpoint write nothing while disabled.
2. **Identifiers are salted-hashed, never raw.** visitor-key/IP/UA →
   `hashVisitorKey/hashIpAddress/hashUserAgent` (`domain/visitor-key.ts`),
   keyed by `VISITOR_ANALYTICS_HASH_SALT`. `scripts/validate-env.ts`
   REQUIRES a real salt when the module is enabled (cross-rule) — do not loosen it.
3. **Raw detail is doubly opt-in.** A raw `ip_address` only when
   `rawIpEnabled`; `login_identifier_snapshot` never for anonymous visitors.
   The API closes raw fields via `shapeVisitorSession/shapeVisitEvent(row,
canSeeRawDetail)` — `canSeeRawDetail = grantedPermissionKeys.has(
"visitor_analytics.raw_detail.read")`. The server-side gate happens ONCE;
   the dashboard MUST NOT become a second gate.
4. **`sanitizePath` is fail-safe** (an unparseable path → drop the whole query),
   `extractReferrerDomain` returns only the hostname. Do not store raw path/query/referrer.
5. **jsonb** `user_agent_parsed`/`geo` are filled with JS OBJECTS (not
   `${JSON.stringify}::jsonb`) so a SELECT reads back an object, not a string.

## Collection = a public ingest endpoint (NOT middleware)

`POST /api/v1/analytics/collect` is public/anonymous: body `{tenantCode, path, referrer?}`.
Resolve the tenant via `resolvePublicTenantByCode` (the `awcms_tenants` table is **RLS-free**,
ADR-0009 — same as the `/blog/{tenantCode}` route), then `collectVisitorTelemetry`.
**`src/middleware.ts` is deliberately UNTOUCHED** (login/Turnstile/CSP guarantees stay).
IP/UA come from request headers (not the body). Fire-and-forget always `202`; it only
records the `public` area (an anonymous caller cannot prove admin/api). **There is NO SECURITY
DEFINER** — because `awcms_tenants` is RLS-free (unlike `tenant_domain`, which
needs sql/048). `operationId analyticsCollect` is in `ALLOWED_PUBLIC_OPERATIONS`
(`scripts/api-spec-check.ts`).

## RLS & FK (migration 050)

- All three tables are `ENABLE`+`FORCE RLS` + a `tenant_isolation` policy. `awcms_worker`
  is GRANTed explicitly (default privileges cover `awcms_app` only) — the jobs run
  as the worker; do not remove those grants.
- `awcms_visit_events` uses a **composite FK** `(tenant_id, visitor_session_id)`
  → `awcms_visitor_sessions(tenant_id, id)` (there is a `UNIQUE(tenant_id,id)`).
  `identity_id` is a plain FK (always null at ingest).

## Keyset (this base's convention, not micro's)

`event-directory.ts`/`session-directory.ts` return `{rows, nextCursor}`
with a full-precision text cursor from `to_char(occurred_at/last_seen_at ... US
...)` — DO NOT use `encodeKeysetCursor(row.date_as_JS_Date, id)` (micro
does that; here `encodeKeysetCursor` takes TEXT, and a JS `Date` throws away
microseconds → it skips rows at the page boundary, Issue #158).

## Port (decisions already taken)

- **RE-WIRED (ADR-0037)** the `dataLifecycle` descriptor
  (`visitor_analytics.visit_events`, delegated) + `LegalHoldGuardPort`.
  `data_lifecycle` has been ported, so `purgeVisitorAnalyticsData(tx, tenantId,
config, now, legalHoldGuard)` — the 5th param is MANDATORY. A hold covering
  `visitor_analytics.visit_events` (descriptor-scoped OR tenant-wide) skips
  the WHOLE purge (events + steps 2-4: session raw detail, sessions, rollups) → all
  analytics data is preserved. This is DELIBERATELY broader than awcms-micro (which only
  gated the events DELETE) because steps 2-4 also destroy
  litigation-relevant data. The `legalHoldGuardPortAdapter` adapter is injected at the composition
  root (`POST /api/v1/analytics/retention/purge`,
  `scripts/visitor-analytics-purge.ts`). The key const:
  `VISITOR_ANALYTICS_VISIT_EVENTS_LIFECYCLE_KEY` in `module.ts`.
- **DEFER** the `news_portal_full_online_r2` preset wiring. This module is standalone.
  Note (the `news_portal` module was MERGED into `blog_content` — ADR-0044/#300; its table names were kept): that preset is now `blog_content`'s business, and it is still not
  touched from here.
- **Admin** = SSR-rendered (the `admin/offices.astro` pattern), not micro's client-fetch
  SPA (this base has no i18n framework / `components/ui`).

## Gates when changing this module

The full `bun run check`. The most relevant ones: `api:spec:check` (route parity —
every route file MUST have an OpenAPI path in
`openapi/modules/visitor-analytics.openapi.yaml`, then `bun run openapi:bundle`

- commit the bundle); `modules:composition:inventory:check` (regenerate with
  `bun run modules:composition:inventory:generate`); `logging:lint:check` (logs
  use structured fields + `moduleKey`); `typecheck`; `test`. An OpenAPI fragment
  may only contribute `paths` + `components.schemas` (parameters are inlined;
  `ModuleSettingsView` is `$ref`-ed to module-management's own, do not redefine
  it). Tests: unit `tests/visitor-analytics-*.test.ts` + the DB-gated integration
  `tests/integration/visitor-analytics.integration.test.ts` (RLS under
  `awcms_app`, composite FK, purge).
