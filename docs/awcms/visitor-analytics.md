🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](visitor-analytics.id.md)

# Visitor Analytics — operational and compliance guide

> **Document status (AWCMS, foundation-rebuild stage).** The
> `visitor_analytics` module described below is a mechanism that on the
> `awcms-mini` base has already been fully implemented and verified (Issue
> #617-#624: session/event/rollup schema, collector, API, dashboard, geo
> enrichment, rollup/retention purge job, 17 env vars, complete integration
> tests). In AWCMS, **there is no code implementation for this module yet** —
> `ls src/modules` does not contain `visitor-analytics`, and `sql/` does not
> contain any `awcms_visitor_*` table. This document describes the
> **target architecture and contracts** that will be ported from the base
> (see `.claude/skills/awcms-visitor-analytics/SKILL.md`, which already
> marks this module "READ-ONLY... NOT YET ported") once this module is
> rebuilt in AWCMS — read the claims "already implemented"/"what already
> exists" below as a specification that must be met again during the
> port, not as the current running status.

This document complements the visitor analytics epic (Issue #617-#624) with
practice-level operational guidance: deployment modes, privacy-first
defaults, data retention per column/table, and a mapping of the controls
already implemented onto the relevant compliance frameworks (UU PDP, PP PSTE,
ISO/IEC 27001/27002/27005/27701, OWASP ASVS, OWASP Logging Cheat Sheet).

Related references:

- `src/modules/visitor-analytics/README.md` — implementation detail per
  issue (schema, collector, API, dashboard, geo enrichment, rollup/purge).
- `.claude/skills/awcms-visitor-analytics/SKILL.md` — cross-issue
  context, decisions already made, what must not be
  re-derived.
- `18_configuration_env_reference.md` §Visitor analytics — full
  reference for the 17 env vars.
- `20_threat_model_security_architecture.md` §Additional standards triggered by
  the visitor analytics epic — threat model.
- `04_erd_data_dictionary.md` §Visitor Analytics and §Initial retention —
  table schema and a compact retention table.

## Module summary

The `visitor_analytics` module (`type: "system"`) collects **privacy-first**
human visitor statistics for admin and public routes — unique visitor
counts, pageviews, browser/device/country breakdowns, bot traffic —
without storing raw personal data unless the operator
explicitly enables it. Three tenant-scoped tables
(`awcms_visitor_sessions`, `awcms_visit_events`,
`awcms_visitor_daily_rollups`), all `ENABLE`+`FORCE ROW LEVEL
SECURITY`.

The core principles binding every operating mode below:

1. **OFF by default with no configuration at all (Issue #624 audit addendum,
   2026-07-11).** A fresh install collects no telemetry whatsoever
   until the operator explicitly sets
   `VISITOR_ANALYTICS_ENABLED=true` — see §Opt-in default and upgrade
   path below. Once enabled, the three most sensitive sub-features —
   raw IP, raw user-agent, geolocation — remain off by default and
   independent of one another. `bun run config:validate` always passes
   with not a single `VISITOR_ANALYTICS_*` set.
2. **Shorter retention for more sensitive data.** Raw detail (30
   days default) < event (90 days default) < aggregate rollup (730 days
   default). The anonymous `awcms_visitor_key` cookie is also far
   shorter than before (30 days default, previously ~2 years) — see
   §Anonymous cookie below. See §Retention for per-column detail.
3. **`raw_detail.read` is separate from `dashboard.read`.** An operator can
   grant aggregate dashboard access without granting access to raw
   IP/user-agent.
4. **Never an external network call.** Geolocation comes from the
   Cloudflare header (`CF-IPCountry`) already present on the request, not a
   third-party API — consistent with a module that runs fully
   offline/LAN.
5. **A software setting is not a legal basis.** Setting
   `VISITOR_ANALYTICS_ENABLED=true` is a technical switch, not a
   substitute for the legal-basis/processing-purpose decision the
   operator must take themselves under UU PDP before enabling any
   collection.

## Opt-in default and upgrade path (Issue #624 audit addendum, 2026-07-11)

`VISITOR_ANALYTICS_ENABLED` now defaults to `false` (previously
`true` in Issue #617). Summary of the impact:

- **Fresh installs**: collect nothing by default. The operator
  must consciously set `VISITOR_ANALYTICS_ENABLED=true`, ideally
  after establishing the legal basis/processing purpose (internal
  operational statistics) that satisfies UU PDP — this software is not and
  cannot be that legal basis itself.
- **Existing deployments that already set `VISITOR_ANALYTICS_ENABLED=true`
  explicitly** in their own environment: **not affected
  at all**. An explicit value always beats the default —
  `resolveVisitorAnalyticsConfig` (`src/modules/visitor-analytics/domain/visitor-analytics-config.ts`)
  only falls back to the default when the var is genuinely not set.
- **Existing deployments relying on the old implicit default** (never
  set this var, relying on Issue #617's `true` default): will
  LOSE collection after upgrading to this version. Add
  `VISITOR_ANALYTICS_ENABLED=true` explicitly in the environment to
  preserve the previous behaviour — historical data already stored
  (`awcms_visitor_sessions`/`awcms_visit_events`/
  `awcms_visitor_daily_rollups`) is not deleted/modified by this
  default change; only forward collection stops until the
  var is set explicitly.
- **There is no data migration for this change** — the default change is
  purely at the configuration layer (`.env.example`/`src/lib/config/registry.ts`),
  touching no schema/table whatsoever.

## Anonymous cookie: lifetime, rotation, and revocation (Issue #624 audit addendum)

The `awcms_visitor_key` cookie (anonymous, `httpOnly`+`sameSite=lax`,
used to dedupe visitor sessions without a real identity):

- **Configurable lifetime, far shorter than before** —
  `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS` (default 30 days,
  previously hardcoded ~2 years/`63_072_000` seconds). The operator can
  shorten it further as needed; `bun run security:readiness`'s
  `checkVisitorAnalyticsVisitorKeyCookieTtlReady` (warning) flags
  values exceeding 400 days (roughly following the order of magnitude of
  general guidance on consent-cookie lifetimes, e.g. ~13 months under
  the EU ePrivacy Directive) as configuration that should be narrowed.
- **Natural rotation** — once the cookie expires in the browser, the next
  visit carries no old value at all; `resolveVisitorKey`
  (Issue #619) sees "no existing value" and mints a new anonymous
  identifier. There is no extra server bookkeeping for this — the cookie
  TTL itself governs the rotation cycle.
- **Revocation when the module is disabled** — `shouldRevokeVisitorKeyCookie`
  (`domain/visitor-key-cookie.ts`), called by `src/middleware.ts` BEFORE
  the path/area gate, actively deletes any cookie still present as soon as
  `VISITOR_ANALYTICS_ENABLED` is not `"true"` — whether because the operator
  disabled the module deliberately, or because of the upgrade to this new
  default-off (see §Opt-in default and upgrade path). A browser already
  carrying an old identifier does not keep it indefinitely just
  because nothing refreshes it any more.
- **No cookie/write at all while the module is off** — `shouldCollectRequest`
  (called after the revocation check) and the `config.enabled` gate in
  `src/middleware.ts`'s `collectRequestAnalytics` guarantee that no new
  `Set-Cookie` AND no session/event row is ever written
  while the module is disabled — verified by
  `tests/unit/visitor-analytics-visitor-key-cookie.test.ts` and
  `tests/unit/visitor-analytics-collector.test.ts`.

## Operating modes

### Offline/LAN mode

Deployments that are never connected to the public internet — or are
deliberately LAN-only — can run this module by turning on just
one var (`VISITOR_ANALYTICS_ENABLED=true`) on top of the other
privacy-first defaults. Basic statistics (the `/admin/analytics` dashboard:
unique visitors, pageviews, top paths/browsers/devices, bot traffic) work fully:

- `VISITOR_ANALYTICS_ENABLED=true` — **must be set explicitly since
  Issue #624** (it now defaults to `false`, see §Opt-in default and
  upgrade path above) — collection is a purely local database operation (INSERT
  into `awcms_visit_events` via middleware, never leaving the
  process) once enabled.
- `VISITOR_ANALYTICS_RAW_IP_ENABLED=false`,
  `_RAW_USER_AGENT_ENABLED=false`, `_GEO_ENABLED=false` (all defaults)
  — no raw IP, raw user-agent, or visitor country is ever
  stored. The `ip_address` column in `awcms_visitor_sessions`
  stays `NULL` forever in this mode.
- `VISITOR_ANALYTICS_TRUST_PROXY`/`_TRUST_CLOUDFLARE=false` (default) —
  the client IP is resolved from the direct connection's `clientAddress` only, never
  from a header a LAN client could forge.
- The scheduled jobs (`analytics:rollup`, `analytics:purge`) are safe to run
  here — both are pure database operations with no external provider
  dependency whatsoever (see §Rollup and §Purge below).

### Full online mode (without a trusted proxy)

A public online deployment that does **not** put the origin behind a
trusted proxy/CDN must leave `VISITOR_ANALYTICS_TRUST_PROXY`/
`_TRUST_CLOUDFLARE` at `false` — trusting the
`X-Forwarded-For`/`CF-Connecting-IP` headers without a real trusted proxy means
any client can forge its own IP in the analytics data
(spoofing, not merely noise). Basic statistics still work exactly the same
as in offline/LAN mode; only client IP resolution is less accurate behind
a generic load balancer/reverse proxy (`clientAddress` is the proxy's
IP, not the real client IP) — a trade-off accepted in order not to
trust forgeable headers.

### Trusted proxy / Cloudflare mode

Only when the origin **genuinely** can only be reached through a trusted
proxy/CDN (e.g. the origin firewall allows only Cloudflare IP ranges):

- `VISITOR_ANALYTICS_TRUST_PROXY=true` — trust `X-Forwarded-For` for
  client IP resolution behind a generic reverse proxy.
- `VISITOR_ANALYTICS_TRUST_CLOUDFLARE=true` — trust `CF-Connecting-IP`
  (client IP) **and** `CF-IPCountry` (country) at once, specifically
  behind the Cloudflare edge.
- `VISITOR_ANALYTICS_GEO_ENABLED=true` **and**
  `VISITOR_ANALYTICS_TRUST_CLOUDFLARE=true` (both mandatory) to
  enable the visitor country breakdown in the dashboard. Only one of them
  active produces all geo fields `null` (fail-safe) —
  `bun run security:readiness`'s `checkVisitorAnalyticsGeoTrustedSourceReady`
  (Issue #624, critical) rejects the "geo active without Cloudflare
  trust" combination before go-live, so the operator does not think the feature is active
  while it is silently empty.

**Mandatory operational contract**: the trusted proxy must OVERWRITE the
`X-Forwarded-For`/`CF-Connecting-IP`/`CF-IPCountry` headers on every
request, never forward (append) the client's value as-is.
`resolveAnalyticsClientIp` rejects a header carrying >1 comma-separated
value (an anomaly, falls back to the next source + logs a warning) —
a correctly configured proxy never produces that.

### Raw IP / raw user-agent (optional, all modes)

Independent of the modes above — only turn these on when genuinely
needed (e.g. a short-term security investigation, abuse debugging):

- `VISITOR_ANALYTICS_RAW_IP_ENABLED=true` — populates
  `awcms_visitor_sessions.ip_address` (an `inet` column). Must be accompanied by
  a short `VISITOR_ANALYTICS_RAW_DETAIL_RETENTION_DAYS` (default 30
  days, must not exceed `VISITOR_ANALYTICS_EVENT_RETENTION_DAYS`) —
  `bun run security:readiness`'s `checkVisitorAnalyticsRawIpRetentionReady`
  (critical) fails go-live if this ordering is violated.
- `VISITOR_ANALYTICS_RAW_USER_AGENT_ENABLED=true` — **currently a no-op**:
  there is no raw-user-agent column yet (only `user_agent_hash` +
  the parsed `user_agent_parsed` are stored). It is still validated
  (`checkVisitorAnalyticsRawUserAgentRetentionReady`, warning) for
  retention readiness on the day this flag is genuinely wired to a real column.

## Data retention (per table/column)

| Data                                                                            | Default retention                                        | Env var                                         | Purge mechanism                                                                                       |
| ------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `awcms_visit_events` (whole row)                                                | 90 days                                                  | `VISITOR_ANALYTICS_EVENT_RETENTION_DAYS`        | Hard delete (`bun run analytics:purge`)                                                               |
| `awcms_visitor_sessions.ip_address`/`login_identifier_snapshot`                 | 30 days (from `last_seen_at`)                            | `VISITOR_ANALYTICS_RAW_DETAIL_RETENTION_DAYS`   | Cleared in place (row remains)                                                                        |
| `awcms_visitor_sessions` (whole row)                                            | 90 days (from `last_seen_at`, same as the event)         | `VISITOR_ANALYTICS_EVENT_RETENTION_DAYS`        | Hard delete, only when no events remain (`NOT EXISTS`)                                                |
| `awcms_visitor_daily_rollups` (whole row)                                       | 730 days                                                 | `VISITOR_ANALYTICS_ROLLUP_RETENTION_DAYS`       | Hard delete (`bun run analytics:purge`)                                                               |
| Anonymous `awcms_visitor_key` cookie (in the visitor's browser, not a DB table) | 30 days (Issue #624 audit addendum, previously ~2 years) | `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS` | Browser expiry (natural rotation) + active revocation when the module is disabled (§Anonymous cookie) |

The retention ordering (raw detail ≤ event ≤ rollup) is an invariant
enforced by `bun run security:readiness`'s
`checkVisitorAnalyticsRetentionOrderingReady` (warning — configuration
hygiene, not a direct security violation) and
`checkVisitorAnalyticsRawIpRetentionReady` (critical — specific to
raw IP that is genuinely active). "Unless explicitly justified" (the wording of
the original issue): an operator with a legitimate reason to invert this ordering (e.g.
a long-term investigation need) can accept that warning
consciously — `security:readiness` does not block go-live for
`warning`-severity violations, only `critical`.

## Rollup (`bun run analytics:rollup`, Issue #624)

`scripts/visitor-analytics-rollup.ts` aggregates raw
`awcms_visit_events` into
`awcms_visitor_daily_rollups`, one row per `(tenant, date,
area)`, for every `active` tenant:

- **Idempotent by construction** — each run recomputes the full totals
  from the raw events and UPSERTs (`ON CONFLICT (tenant_id, date, area) DO
UPDATE SET ... = EXCLUDED...`), never adding to the old value.
  Re-running the same date produces an identical row,
  verified by `tests/integration/visitor-analytics-rollup.integration.test.ts`.
- **Columns populated**: `human_unique_visitors`, `human_pageviews`,
  `bot_pageviews`, `authenticated_unique_users`,
  `public_unique_visitors` (only on `area='public'` rows),
  `admin_unique_users` (only on `area='admin'` rows), and four
  top-10 arrays (`top_paths`/`top_browsers`/`top_devices`/`top_countries`,
  `jsonb`).
- **An area with no events on that date gets no row** — not a
  zero-valued row; the same as the source `awcms_visit_events`
  table itself.
- **CLI arguments**: `--date=YYYY-MM-DD` (a single date), or
  `--start-date=.../--end-date=...` (inclusive range, for backfill).
  With no arguments, it defaults to summarising "yesterday" (UTC) — suitable for a
  daily cron after UTC midnight, when the previous day is already
  final/no longer changing.
- **Does not touch sensitive raw data** — the rollup only counts and
  summarises (count, top-N by name), never copying
  `ip_address`/`login_identifier_snapshot`/any other raw value into the aggregate
  table.

## Purge (`bun run analytics:purge`, Issue #624)

`scripts/visitor-analytics-purge.ts` calls
`purgeVisitorAnalyticsData` (`src/modules/visitor-analytics/application/retention-purge.ts`)
directly for every `active` tenant — the SAME function used by
`POST /api/v1/analytics/retention/purge` (Issue #621) for on-demand
purge. This scheduled job never re-derives its own purge
rules separately.

Four independent cutoffs per run (full detail in
`application/retention-purge.ts`'s doc comment):

1. `awcms_visit_events` older than `eventRetentionDays` — hard
   delete.
2. `ip_address`/`login_identifier_snapshot` in
   `awcms_visitor_sessions` older than `rawDetailRetentionDays`
   — cleared in place, the row remains (the aggregate
   browser/device/OS fields stay useful long after the raw detail
   should be gone).
3. `awcms_visitor_sessions` older than `eventRetentionDays` —
   hard delete, only when no `awcms_visit_events` still
   references it (`NOT EXISTS`, preventing an FK violation from the
   collector's write throttle).
4. `awcms_visitor_daily_rollups` older than
   `rollupRetentionDays` — hard delete.

**Audit**: only tenants that genuinely had rows
deleted/cleared get a new audit event
(`module_key='visitor_analytics'`, `action='retention_purged'`,
`severity='critical'`, `resourceType='visitor_analytics_data'`) —
the attributes contain only four summary numbers (`eventsDeleted`,
`sessionsRawDetailCleared`, `sessionsDeleted`, `rollupsDeleted`), never
raw data/a list of the deleted rows. Tenants with no expired
data produce no audit noise.

**There is no extra batching layer** on top of what
`purgeVisitorAnalyticsData` already does (one set of statements per tenant
per run, already reviewed+tested in Issue #621) — adding a second, different
batching scheme would be exactly the form of re-derivation that
function's doc comment forbids.

**Schedule recommendation**: run `analytics:purge` after
`analytics:rollup` (see `deployment-profiles.md` §Other job
registry) — so that the data about to be purged has already been aggregated into
the rollup first.

## Config and readiness checks (Issue #624)

Two validation layers, consistent with the pattern of every other gated
feature in this repo (`checkOnlineAuthSecurityConfig`/`Ready`,
`checkTurnstileConfig`/`Ready`, etc.):

- **`bun run config:validate`** (`scripts/validate-env.ts`'s
  `checkVisitorAnalyticsConfig`, Issue #617) — SHAPE validation only:
  the `VISITOR_ANALYTICS_MODE` enum is a known one, the five retention/window/TTL vars
  (including `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS`, audit
  addendum) are positive integers when filled in. There is no cross-field rule
  here (and deliberately none added in Issue #624 — see the design decision
  below).
- **`bun run security:readiness`** (`scripts/security-readiness.ts`,
  Issue #624) — six new cross-field checks, all reusing
  `resolveVisitorAnalyticsConfig` (never reading `process.env`
  directly):

  | Check                                             | Severity | Fail condition                                                                                       |
  | ------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
  | `checkVisitorAnalyticsRawIpRetentionReady`        | critical | Raw IP active and raw detail retention > event retention                                             |
  | `checkVisitorAnalyticsRawUserAgentRetentionReady` | warning  | Raw user-agent active and raw detail retention > event retention (this flag itself is still a no-op) |
  | `checkVisitorAnalyticsGeoTrustedSourceReady`      | critical | Geo active without `VISITOR_ANALYTICS_TRUST_CLOUDFLARE`                                              |
  | `checkVisitorAnalyticsRetentionOrderingReady`     | warning  | Raw detail retention > event, OR rollup retention < event                                            |
  | `checkVisitorAnalyticsHashSaltReady`              | warning  | Module active and `VISITOR_ANALYTICS_HASH_SALT` empty                                                |
  | `checkVisitorAnalyticsVisitorKeyCookieTtlReady`   | warning  | Module active and `VISITOR_ANALYTICS_VISITOR_KEY_COOKIE_TTL_DAYS` > 400 days (audit addendum)        |

  Only `critical` blocks go-live (non-zero exit); `warning` is
  reported but does not block — the privacy-first default (no var
  set at all) always passes CLEAN with not a single finding from these six
  checks.

**Design decision — why the cross-field rules live in `security-readiness.ts`,
not `validate-env.ts`'s `checkVisitorAnalyticsConfig`**: the pattern already
established in this repo (`checkOnlineAuthSecurityConfig` vs
`checkOnlineAuthSecurityReady`, etc.) separates "is this var's SHAPE
valid" (`validate-env.ts`, needs no security judgment call) from
"is this COMBINATION of vars safe for go-live" (`security-readiness.ts`,
which has `CheckSeverity` critical/warning/info and `OUT_OF_SCOPE_ITEMS`
for honesty about coverage). The six Issue #624 rules above are all
cross-field security judgment calls (raw IP + retention, geo + trust,
rollup vs event retention, salt + active status, anonymous cookie lifetime) —
not single-var shape validation — so following the same pattern
avoids duplicating the `CheckSeverity` concept into `validate-env.ts`, which
never had it.

## Compliance mapping

The table below maps the controls **already implemented**
(not an aspirational list) onto the articles/practice controls of each
framework. Practice-level — referring to concrete functions/files, not general
statements.

### UU PDP (the Personal Data Protection Law, Law No. 27/2022)

| UU PDP principle                                                                                     | Implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data minimisation** (Article 16 — processing in line with purpose, not excessive)                  | Raw IP/user-agent/geolocation (the data classes that most easily identify an individual) are all off by default; only hashes (`ip_hash`/`user_agent_hash`, HMAC-SHA256 keyed with a deployment salt) and aggregate fields (browser/device/country) are stored by default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Storage limitation** (Article 16 — data kept only as long as needed)                               | Tiered retention (raw detail 30 days < event 90 days < rollup 730 days), enforced by the scheduled `analytics:purge` job + re-verified on every `security:readiness` (§Retention above).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Processing security** (Article 39 — technical measures protecting the data)                        | RLS `ENABLE`+`FORCE` per tenant (cross-tenant isolation at the database level, not just an application filter), ABAC default-deny for every read endpoint (`authorizeInTransaction`), the `raw_detail.read` permission separate from `dashboard.read`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Data subject rights — access restricted to authorised parties only**                               | The `/admin/analytics` dashboard and the `GET /api/v1/analytics/*` endpoints (Issue #621) are for actors with an explicit permission only; public visitors have no interface to view their own data (out of scope — this module is internal observability).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Data subject rights — erasure/anonymisation** (Article 16/26 — the right to destroy personal data) | Anonymous visitor data has no identity that could be asked to be deleted individually (there is no login/email/phone number linked to a public visitor) — erasure works through automatic tiered retention (`analytics:purge`, §Retention above), not per-individual requests. For visitors who HAPPEN to be authenticated (`/admin/*`), `identity_id` is deleted only together with its parent event/session row through the same retention — there is no separate analytics table/column that survives longer than its parent identity. The anonymous cookie itself can effectively be "deleted" by the visitor at any time (clear browser cookies) or by the operator (disable the module → `shouldRevokeVisitorKeyCookie` deletes it automatically, see §Anonymous cookie). |
| **Processing accountability** (Article 44 — processing documentation)                                | This document + `src/modules/visitor-analytics/README.md` + the skill document the entire data flow: what is collected, when, how long it is stored, who can access it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **A legal basis is not a software setting** (Article 20 — consent/other lawful basis)                | `VISITOR_ANALYTICS_ENABLED=true` is the operator's technical switch, not a substitute for establishing the legal basis/processing purpose the operator must do themselves before enabling any collection — documented explicitly in §Opt-in default and upgrade path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Tenant-admin controls**: each tenant only sees/manages its own
visitor data (RLS `FORCE` per `tenant_id`, no cross-tenant
view). The `visitor_analytics.retention.purge` permission gives the
tenant-admin explicit control to trigger an on-demand purge
(`POST /api/v1/analytics/retention/purge`, Issue #621) outside the automatic
`analytics:purge` schedule — e.g. to respond to an erasure request
faster than the scheduled retention cycle. No tenant-admin
can extend retention beyond what
`security:readiness`'s `critical` check (raw IP) allows without changing the
deployment env var (not through the runtime UI) — preventing one tenant from silently
loosening the privacy controls of the whole deployment.

### PP PSTE (the Operation of Electronic Systems and Transactions, Government Regulation No. 71/2019 + its derivatives)

The relevant general obligations of an electronic system provider are already
covered by the same technical controls used by other modules (RLS, ABAC,
audit, secret hygiene — see `20_threat_model_security_architecture.md`)
— no additional analytics-specific PSTE obligation has been
identified beyond that for this generic base:

- **Electronic system reliability**: telemetry collection is fail-open (it never
  fails the actual admin/public request — a collection
  error is only recorded as `log("warning", ...)`, never thrown
  into the response).
- **Protection of system users' data**: the same as the UU PDP controls
  above (minimisation, retention, RLS, ABAC).
- PSE certification/registration obligations (where applicable to a given
  operator's scale) remain the responsibility of the operational layer of the derived
  application, not something that can be proven from the code.

### ISO/IEC 27001:2022 Annex A (code-relevant controls)

| Annex A control                          | Implementation                                                                                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A.5.12 Classification of information** | IP/user-agent/geolocation are treated as a sensitive data class separate from aggregate data — with their own `raw_detail.read` permission.                                                |
| **A.8.10 Information deletion**          | `analytics:purge` (hard delete + in-place clear) per the configured retention; no raw row survives indefinitely.                                                                           |
| **A.8.15 Logging**                       | The purge itself is audited (`retention_purged`, critical) — data deletion is not a silent operation.                                                                                      |
| **A.8.16 Monitoring activities**         | The dashboard/API provide visitor/bot-traffic visibility for the tenant's own data; there is no external SIEM integration (out of scope).                                                  |
| **A.8.24 Use of cryptography**           | `ip_hash`/`user_agent_hash`/`visitor_key_hash` = HMAC-SHA256 keyed with `VISITOR_ANALYTICS_HASH_SALT` (not plain SHA256) — preventing cross-deployment correlation via precomputed tables. |
| **A.5.34 Privacy and protection of PII** | The pervasive privacy-first default (§Module summary above) is a direct implementation of this control.                                                                                    |

### ISO/IEC 27002:2022 (implementation guidance for the controls above)

The 27002 guidance for the same Annex A controls above is already reflected
directly at code level, not just as written policy: control 8.10
(deletion) is implemented as an automatic scheduled job (not a
manual process that can be missed), control 5.12 (classification) as a
permission constraint enforced by the database (not a naming
convention), and control 8.24 (cryptography) as a shared hash function
reused at every write point (`hashIpAddress`/
`hashUserAgent`/`hashVisitorKey`, one implementation, not scattered).

### ISO/IEC 27005:2023 (risk management)

The risk-treatment approach this epic uses: every high-risk
sub-feature (raw IP, raw user-agent, geolocation) is treated with
**avoidance-by-default** (off unless explicitly enabled) rather than
mitigation after it is on — a stronger choice than mere
"risk mitigation" because the risk is never realised unless the
operator consciously chooses the trade-off. Residual risks
accepted explicitly (not ignored silently):

- Region/city/timezone are always `null` (there is no local GeoIP) — the risk of
  "incomplete location data", accepted because the alternative (a
  third-party GeoIP database) introduces a new dependency outside the
  scope of this epic.
- An empty `VISITOR_ANALYTICS_HASH_SALT` still passes `security:readiness`
  (warning, not critical) — the risk of "cross-deployment hash correlation
  via a precompute table", accepted because raising it to critical would
  fail every existing default deployment without proportional
  benefit (see the severity table in §Config and readiness checks).

### ISO/IEC 27701:2025 (privacy extension to ISO 27001, PIMS)

Version note: this document previously referenced ISO/IEC 27701:2019; the
repository audit of 2026-07-11 (Issue #624 addendum) updated the reference to
the newer 2025 edition — the control mapping below still holds
because the core principles (a PIMS on top of the ISMS, privacy by design/default,
visitor/data-subject controls) do not change between editions for this module's
practical scope.

This module operates as a **PII controller** for the tenant's own visitor
data (not a third-party PII processor — no data is
sent to any external provider):

- **6.2 Conditions for collection and processing** — collection is limited to a purpose
  (operational statistics), never used for profiling
  individuals beyond the module's scope (no targeting/personalisation).
  Since the Issue #624 addendum, collection also never starts at all
  without an explicit operator opt-in decision (§Opt-in default and upgrade
  path) — reinforcing this "conditions for collection" requirement at the earliest
  point of the data lifecycle (before the first row is ever written).
- **7.4 PII minimisation (privacy by design)** — the privacy-first
  default is a direct application of the "privacy by design and by default"
  that is the core of 27701 — not opt-out, but explicit opt-in per
  sensitive flag, including the master flag (`VISITOR_ANALYTICS_ENABLED`)
  itself since this audit addendum.
- **7.9 PII deletion** — the scheduled purge job + tiered retention
  (§Retention/§Purge above), plus automatic anonymous cookie revocation when
  the module is disabled (§Anonymous cookie) — the visitor identifier stops
  surviving as soon as its collection purpose ends, not just the data on
  the server.
- **7.3.9/7.2.8 Data subject controls (practical access/correction/erasure
  rights)** — for anonymous visitors, the equivalent practical controls
  are: (a) clearing their own browser cookie at any time, (b) automatic
  tiered retention that limits how long the data survives without
  needing an explicit request. For the tenant as controller, administrative
  controls are available through `visitor_analytics.retention.purge`
  (on-demand purge) — see §Compliance mapping UU PDP above for
  tenant-admin control detail.

### OWASP ASVS (Application Security Verification Standard, the relevant L1/L2 levels)

| ASVS control                                                            | Implementation                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **V1.8 (data classification), V8.3 (sensitive data not cached/logged)** | Sensitive query strings (`token`/`password`/`secret`/etc., 11 parameters) are stripped by `sanitizePath` before the path ever enters `path_sanitized` — fail-safe for input that fails to parse. |
| **V4.1/V4.2 (function/data access control)**                            | ABAC default-deny per endpoint, `raw_detail.read` separate from `dashboard.read`, RLS `FORCE` per tenant.                                                                                        |
| **V7.4 (error handling does not leak sensitive info)**                  | Telemetry collection is fail-open — a failure is only logged as `warning`, never leaked into the client response.                                                                                |
| **V9.1/V9.2 (communication, trusted header validation)**                | `resolveAnalyticsClientIp` only trusts forwarded headers when the trust flag is explicitly `true`; ambiguous headers (>1 value) are rejected.                                                    |
| **V14.3 (secure configuration by default)**                             | Every sensitive sub-feature defaults to `false`; `config:validate`/`security:readiness` enforce a safe combination before go-live.                                                               |

### OWASP Logging Cheat Sheet

| Recommendation                                                                                                                                          | Implementation                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Do not log raw sensitive data**                                                                                                                       | Sensitive query strings are filtered out (`sanitizePath`); the two catch-all `jsonb` columns (`user_agent_parsed`/`geo`) contain only parsed values, never a raw request body/header/cookie/Authorization.                                              |
| **Log administrative/high-risk actions**                                                                                                                | The purge (hard-deleting data) is always audited (`retention_purged`, critical) with a numeric summary, plus a correlation ID for cross-hop tracing.                                                                                                    |
| **Reasonable log retention, not unlimited**                                                                                                             | §Retention above — tiered by sensitivity, enforced by a scheduled job, not manually.                                                                                                                                                                    |
| **Log integrity — cannot be altered by arbitrary actors**                                                                                               | All tables are `ENABLE`+`FORCE ROW LEVEL SECURITY`; only server-side code (not the client) ever writes, through the centralised collector/rollup/purge.                                                                                                 |
| **Fail-safe, not fail-open for security decisions** (note: telemetry collection itself is deliberately fail-OPEN, not fail-closed — see the note below) | Collection (not an authorization decision) is fail-open by design so that a logging failure never blocks a real business request — an explicit trade-off, not an oversight; in contrast to ABAC/RLS, which are always fail-closed for access decisions. |

## Limitations recorded, not ignored

- **The rollup does not include the area/visitor-type parameters on the
  aggregate endpoint** — out of scope for Issue #624 (an API change, not a job),
  consistent with the limitation already recorded in Issue #622.
- **There is no external SIEM integration** — out of scope for this epic;
  the `AuditExportHook` extension point (`src/modules/logging/application/audit-log.ts`)
  is already available for a derived application that wants to wire one up itself.
- **There is no local/offline GeoIP** — region/city/timezone are always
  `null`; only the country code from the Cloudflare header is ever filled in.
- **`VISITOR_ANALYTICS_RAW_USER_AGENT_ENABLED` is still a no-op** — see
  §Raw IP / raw user-agent above.
