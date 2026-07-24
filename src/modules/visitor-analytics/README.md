# visitor_analytics

Privacy-first human visitor statistics for admin and public routes, in both
online and offline/LAN configurations. Ported from **awcms-micro** (epic
#617-#624) as a standalone, additive module.

`type: "system"` — like `reporting`/`logging`, human visitor telemetry is
platform/observability infrastructure every tenant shares the mechanism of, not
a tenant-facing business feature. Higher volume and different retention/privacy
needs than `reporting`/`logging` are exactly why it is its own module.

## Privacy posture (the whole point of this module)

- **Off by default.** A fresh install collects nothing until an operator sets
  `VISITOR_ANALYTICS_ENABLED=true`. That software switch is never itself the
  lawful-basis/consent decision required by UU PDP — it only enables the
  mechanism.
- **Identifiers are per-tenant salted-hashed, never raw.** The anonymous
  visitor-key cookie, IP address, and user-agent are stored only as
  `HMAC-SHA256` (`domain/visitor-key.ts`), keyed by `VISITOR_ANALYTICS_HASH_SALT`
  **and bound to the tenant id** (a `\0` domain separator folds `tenantId` into
  the HMAC). Two properties fall out: cross-DEPLOYMENT rainbow-table resistance
  (the salt), and cross-TENANT unlinkability (the tenant binding) — the same
  browser/IP/user-agent yields DIFFERENT hashes across tenants sharing one
  origin, so the raw hash columns of two tenants cannot be correlated at the
  storage layer. A real salt of **≥ 16 chars** is **required** when the module
  is enabled (`scripts/validate-env.ts` enforces both non-placeholder and the
  minimum length).
- **Raw detail is an explicit, independent opt-in, gated through ABAC.**
  `ip_address` (raw) and `login_identifier_snapshot` are only ever populated
  when `VISITOR_ANALYTICS_RAW_IP_ENABLED=true` / for authenticated sessions; the
  public ingest path here never populates either (anonymous-only). Reading raw
  detail over the API / dashboard needs the separate
  `visitor_analytics.raw_detail.read` permission, and that field decision is
  routed through the **ABAC evaluator** (`evaluateFieldAccessInTransaction`),
  not a bare permission-set membership check — so a `deny` DSL policy on
  `raw_detail.read` is honored (deny-overrides-allow). Applied uniformly across
  `GET /sessions`, `GET /events`, and `/admin/analytics`; the actual field
  omission happens once, server-side, in `domain/analytics-response-shaping.ts`.
- **Nothing sensitive is ever persisted.** `domain/path-sanitizer.ts` strips
  token/secret query params (fail-safe: an unparseable path drops its whole
  query string) before a path reaches `path_sanitized`; `domain/referrer.ts`
  keeps only a bare hostname. No request body, cookie, Authorization header, or
  query-string secret is stored, including the two `jsonb` catch-alls
  (`user_agent_parsed`, `geo`), which hold only derived/parsed values.
- **Retention-based lifecycle.** These are log-like, high-volume rows (no soft
  delete). Retention purge (`application/retention-purge.ts`) deletes events
  past `eventRetentionDays`, clears session raw detail past
  `rawDetailRetentionDays`, deletes orphaned sessions, and deletes rollups past
  `rollupRetentionDays`.

## Schema (migrations 049 / 050 / 051)

- `049` — permission catalog seed (8 permissions).
- `050` — `awcms_visitor_sessions`, `awcms_visit_events`,
  `awcms_visitor_daily_rollups`. All `ENABLE`+`FORCE ROW LEVEL SECURITY` with a
  `tenant_isolation` policy, tenant_id-first composite indexes, and least-
  privilege `awcms_worker` grants for the scheduled jobs. `awcms_visit_events`
  carries a **cross-tenant-safe composite FK** `(tenant_id, visitor_session_id)`
  → `awcms_visitor_sessions (tenant_id, id)` (a plain `id` FK would silently
  cross tenants). `identity_id` stays a plain nullable FK — the public ingest
  never populates it.
- `051` — the `(tenant_id, visitor_key_hash, area, last_seen_at)` session
  find-or-create lookup index (deliberately NOT unique: one visitor accumulates
  multiple sessions over time).

## Collection: a PUBLIC ingest endpoint (not middleware)

**Port adaptation.** awcms-micro collected telemetry from `src/middleware.ts`
(observing every server request). This base keeps `src/middleware.ts`
**untouched** (its login/Turnstile/CSP guarantees are unchanged) and exposes the
same collector logic as an additive, opt-in **public beacon**:

`POST /api/v1/analytics/collect` (anonymous, no auth) — the client posts
`{ tenantCode, path, referrer? }`. The endpoint resolves the tenant from
`tenantCode` against the **RLS-free** `awcms_tenants` root (ADR-0009, exactly
like the `/blog/{tenantCode}` public routes — so **no SECURITY DEFINER** is
needed), then records a privacy-preserving page view via
`application/collector.ts`. IP/user-agent come from the request's own headers
(never the body). It is fire-and-forget (always `202`) and records **public-area
page views only** — an anonymous beacon cannot prove an admin/API request, so it
is not allowed to pollute admin/api analytics.

**Abuse backstop.** Because it is an unauthenticated DB write, the beacon is
fronted by a **per-IP rate limit** (the shared `checkRateLimit` in-process
fixed-window limiter, the same one `auth/login.ts` and `setup/initialize.ts`
use) before any database work — so a client holding a public `tenantCode`
cannot flood unbounded session/event rows or poison a tenant's aggregates. The
key is the client IP only (never the tenant), so a `429` reveals nothing about
tenant existence; a `path` over `MAX_PATH_LENGTH` (2048) is rejected before
storage. Tunable via `VISITOR_ANALYTICS_COLLECT_RATE_LIMIT_MAX` /
`_WINDOW_SEC` (defaults 120 req / 60 s per IP).

## API (authenticated, ABAC-guarded)

All under `/api/v1/analytics`, gated at the identity-access chokepoint
(`authorizeInTransaction`):

| Endpoint                                            | Permission                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /summary\|pages\|devices\|locations\|security` | `visitor_analytics.dashboard.read`                                      |
| `GET /realtime`                                     | `visitor_analytics.realtime.read`                                       |
| `GET /sessions`                                     | `visitor_analytics.sessions.read` (+ `raw_detail.read` for raw fields)  |
| `GET /events`                                       | `visitor_analytics.events.read` (+ `raw_detail.read` for raw fields)    |
| `GET\|PATCH /settings`                              | `visitor_analytics.settings.read` / `.update`                           |
| `POST /retention/purge`                             | `visitor_analytics.retention.purge` (Idempotency-Key, `critical` audit) |

List endpoints use this base's full-precision text keyset cursor
(`_shared/keyset-pagination.ts`) — the directories build the cursor from the
row's own `to_char(... US ...)` microsecond text, never a floored JS `Date`.

## Jobs

- `bun run analytics:rollup` (`scripts/visitor-analytics-rollup.ts`) —
  idempotently recomputes the previous UTC day's `awcms_visitor_daily_rollups`
  per active tenant.
- `bun run analytics:purge` (`scripts/visitor-analytics-purge.ts`) — enforces
  retention per active tenant.

Both run on the shared job runner (advisory lock, timeout, cancellation, JSON
telemetry) as the least-privilege `awcms_worker` role; pure PostgreSQL, safe in
offline/LAN. Use `--dry-run` first for the purge.

## Admin screen

`/admin/analytics` (`visitor_analytics.dashboard.read`). **Port adaptation:**
awcms-micro's client-`fetch` SPA dashboard is rendered **server-side** here (the
same SSR-read-then-render pattern `admin/offices.astro` uses) — this base has no
i18n framework or `components/ui/` library. No client script, no CSP surface.

## Port drops / deferrals (documented, not silent)

- **data_lifecycle coupling RE-WIRED (ADR-0037).** The `data_lifecycle` module
  is now ported to this base, so the `dataLifecycle` descriptor
  (`visitor_analytics.visit_events`, delegated) and the `LegalHoldGuardPort` gate
  are RE-ADDED. An active hold covering `visitor_analytics.visit_events`
  (descriptor-scoped or tenant-wide) skips the **entire** purge — events AND
  steps 2-4 (session raw-detail clearing, session deletion, rollup deletion) —
  preserving all analytics data. This is deliberately broader than awcms-micro
  (which gated only the events DELETE): steps 2-4 also destroy litigation-relevant
  data (IP/login snapshot, aggregates), so over-preserving under a hold is the
  safe default. The concrete adapter is injected at the two composition roots
  (`POST /api/v1/analytics/retention/purge` and `scripts/visitor-analytics-purge.ts`).
- **news_portal preset wiring DEFERRED.** awcms-micro's
  `news_portal_full_online_r2` preset enables this module. This base's
  `news_portal` was ported without that wiring and is **not modified** here;
  this module ships standalone.
- **Geolocation** is country-only from Cloudflare's `CF-IPCountry`
  (`domain/geo-enrichment.ts`), only when both `VISITOR_ANALYTICS_GEO_ENABLED`
  and `VISITOR_ANALYTICS_TRUST_CLOUDFLARE` are true; region/city/timezone are
  always null (no paid/local GeoIP source). Never makes an external network
  call.

## Configuration

See `domain/visitor-analytics-config.ts` and the `# Visitor Analytics` block in
`.env.example`. All vars are `VISITOR_ANALYTICS_*`, optional, privacy-first
off-by-default.
