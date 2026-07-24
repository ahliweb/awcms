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
- **Identifiers are salted-hashed, never raw.** The anonymous visitor-key
  cookie, IP address, and user-agent are stored only as `HMAC-SHA256`
  (`domain/visitor-key.ts`), keyed by `VISITOR_ANALYTICS_HASH_SALT`. A real
  salt is **required** when the module is enabled (`scripts/validate-env.ts`
  enforces it) — the salt is what defeats correlation against a precomputed
  hash table.
- **Raw detail is an explicit, independent opt-in.** `ip_address` (raw) and
  `login_identifier_snapshot` are only ever populated when
  `VISITOR_ANALYTICS_RAW_IP_ENABLED=true` / for authenticated sessions; the
  public ingest path here never populates either (anonymous-only). Reading raw
  detail over the API needs the separate `visitor_analytics.raw_detail.read`
  permission — gated once, server-side, in `domain/analytics-response-shaping.ts`.
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

- **data_lifecycle coupling DROPPED.** awcms-micro registered a `dataLifecycle`
  descriptor and gated the events purge behind a `LegalHoldGuardPort` from its
  `data_lifecycle` module — not ported to this base, so the descriptor and the
  legal-hold guard are removed and the purge is unconditional. Re-introduce both
  if/when `data_lifecycle` is ported.
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
