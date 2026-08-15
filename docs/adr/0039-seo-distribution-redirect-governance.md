🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0039-seo-distribution-redirect-governance.id.md)

# ADR-0039 — `seo_distribution` redirect governance scope: redirect rules + URL change capture + 404 telemetry

- **Status:** Accepted
- **Date:** 2026-07-25
- **Decision maker:** @ahliweb
- **Adapts:** the awcms-micro `src/modules/seo-distribution/` redirect scope (ADR-0028 §8 + the ADR-0010 deferral; in awcms-micro those migrations are numbered 083/084 — that repo's numbering, not this one) onto the `awcms` base, completing the discovery half that already landed in [ADR-0038](0038-seo-distribution-module-admission-discovery-scope.md). In `awcms` the redirect schema+permissions land in `sql/060`/`sql/061`.
- **Related:** ADR-0038 (the discovery half of `seo_distribution` — companion), ADR-0037 (`data_lifecycle`, the 404 descriptor is registered into it), ADR-0036 (`media_library`), ADR-0009 (public tenant resolution by host/tenant-code), ADR-0035 (the awcms-micro absorption programme), [`docs/awcms/absorb-awcms-micro-roadmap.md`](../awcms/absorb-awcms-micro-roadmap.md) §5.

## Context

ADR-0038 admitted the **discovery** half of `seo_distribution` (metadata renderer + sitemap/robots/feed + tenant config), and **explicitly deferred** the **redirect governance** half to a follow-up PR (ADR-0038 §Deferred): exact-path redirect rules + the `src/middleware.ts` redirect hook, privacy-minimized 404 telemetry + the `dataLifecycle` descriptor, the `redirect.*`/`not_found.*` permissions, and the frozen redirect guards (`classifyRedirectTarget`/`assertSafeRedirectTarget`) that were deliberately EXCLUDED from awcms's `seo_facts` port (see the `_shared/ports/seo-facts-port.ts` header, lines 14-20). This ADR settles that deferral.

Redirects are the most abuse-prone SEO surface: an unbounded target = open redirect, pattern rules = ReDoS, admin/API/auth paths = hijack targets. awcms-micro already settled this with a schema that makes the safe path the only path; this ADR ports that schema semantically as-is onto the `awcms` base, with three adaptations documented below.

## Decision

### 1. Exact-path redirect rules + 404 telemetry, three tenant-scoped tables (migrations 060/061)

- `awcms_seo_redirects` (exact-path rules), `awcms_seo_not_found_observations` (aggregated 404 telemetry), `awcms_seo_redirect_settings` (per-tenant policy) — all **`ENABLE` + `FORCE ROW LEVEL SECURITY`** + a `tenant_isolation` policy (`sql/060`). `sql/061` seeds 6 permissions (`redirect.{read,create,update,delete}`, `not_found.{read,update}`) into `awcms_permissions` (the backfill reaches new tenants only, the same as every other permission seed).
- **Exact-path only** — `normalized_source_path` is an already-normalized literal, matched by equality. There is NO pattern/regex/rewrite column in the schema, so ReDoS is impossible. Prefix/pattern rules are deferred to a future ADR.
- Chain resolution is **bounded + non-recursive** in application code (`domain/redirect-chain.ts`, hop cap 5, one indexed point-query per hop), NEVER a recursive SQL CTE. The tables have no self-referential FK and no triggers.
- The `dataLifecycle` descriptor (`seo_distribution.not_found_observations`, class `analytics_telemetry`, `hard_delete`, `executionMode: "generic"`, default retention 30 days) is registered in `module.ts` and validated by `data-lifecycle:registry:check`; `requiredIndexes` refers to `awcms_seo_not_found_tenant_last_seen_idx` (the purge cursor). `SELECT, DELETE ... TO awcms_worker` is granted on the 404 table (least-privilege purge engine).

### 2. Open-redirect defence is encoded in the frozen guards (on write AND on every resolve)

The frozen guards `classifyRedirectTarget`/`assertSafeRedirectTarget` — deliberately EXCLUDED from awcms's `seo_facts` port in ADR-0038 — are **re-homed as standalone domain helpers** in `src/modules/seo-distribution/domain/redirect-target-classification.ts`, NOT returned to the port (the port stays a pure content-fact contract). Only the `same_tenant_internal` classification is ever emitted; `//evil.com`, `/\evil.com`, `javascript:`, `data:`, cross-tenant hosts, and every C0/DEL control-character bypass are rejected in the guard, not by a DB constraint. Every target is passed through the guard **on write (create/update/import/capture) AND on every resolve** (re-validated against the tenant's CURRENT verified hosts — a `verified_external` target pointing at a domain that has since been revoked fails closed). Normalization (`domain/redirect-path.ts`) rejects CRLF/traversal/Unicode-confusion/protocol-relative; the eligibility predicate (`domain/redirect-eligibility.ts`) excludes admin/API/auth/static/system/**discovery** paths (robots/sitemap/feed) on write AND on resolve, so a tenant redirect can never hijack an admin route or shadow the discovery routes ADR-0038 shipped. Loops/over-long chains fail **closed** (no redirect), are surfaced for operator remediation, and are never bounced back.

### 3. One invasive edit to `src/middleware.ts` — a resolve-then-serve public branch, FAIL-OPEN

The middleware's non-`/admin` branch (previously just `return applyResponseHeaders(await next(), ...)`) is replaced with a resolve-then-serve block: (a) resolve the public redirect BEFORE `next()`, (b) serve, (c) record a best-effort 404 observation AFTER the response is produced. Ordering: after `correlationId` + the API body ceiling, before `next()`. **FAIL-OPEN by construction**: `resolvePublicRedirectForRequest` swallows ALL faults into `null` (a redirect-subsystem error never becomes a 500 and never blocks the page), and the 404 capture runs post-response and never throws. The `/admin` login guard and the API body ceiling logic are NOT touched. This is the only risky change; the wiring composition lives in `src/lib/seo/redirect-middleware.ts` (importable, unit-testable) following the existing SEO composition-root pattern (`discovery-route.ts`).

### 4. Tenant resolution = host-based-only first cut (path-tenant deferred)

Host-based redirect rules (Strategy 2) are resolved via `resolvePublicTenantFromRequest` → correct ONLY for tenants with a verified custom domain (the request host maps to a tenant). Under a shared host, the resolver yields the default tenant. **DECISION: host-based-only first cut (matching awcms-micro exactly, the least invasive).** The path-tenant strategy (deriving the tenant from the `/blog/{tenantCode}` segment for exact-path rules) is DEFERRED as a documented follow-up — not built now. Both resolvers already exist in awcms.

## Adaptations (documented, not silent)

- **Legacy `/blog/{tenantCode}` → `/news` is INERT.** awcms does not ship the `/news` route family, so even though `legacy-blog-redirect.ts` + the `legacy_blog_redirect_enabled` column (DEFAULT `false`) are ported for schema/behaviour parity with awcms-micro and with a future `/news` port, the legacy auto-redirect NEVER lights up on this base: the policy is off by default, and were an operator to switch it on, the computed `/news...` destination has no content route. Kept so that a future `/news` port inherits an already-guarded mechanism instead of re-deriving it.
- **No i18n/locale seam — `locale = null`.** awcms has no i18n/locale seam; the middleware passes `locale = null` to the redirect resolver. Locale-scoped rules therefore never match a locale — only all-locale rules (`locale_scope IS NULL`) resolve. The `locale` parameter is kept for signature parity and a future locale port.
- **The frozen guards are homed as domain helpers, not in the port** (§2) — inverting awcms-micro's location (which put them in `_shared/ports/seo-facts-port.ts`) because awcms deliberately keeps the `seo_facts` port a pure content-fact contract (ADR-0038). The behaviour is semantically byte-for-byte identical.

## Consequences

- Positive: tested tenant-contained redirect governance with open-redirect/loop/hijack defence encoded in the guards + eligibility, privacy-minimized 404 telemetry (sanitized path + bare referrer domain only) with bounded retention via `data_lifecycle`, and a complete admin API (`/api/v1/seo/redirects/*` + `/api/v1/seo/not-found/*`) that is idempotency-keyed + audited.
- Cost: one invasive edit to `src/middleware.ts` (fail-open, non-`/admin` branch only); `seo_distribution` goes up to `0.2.0`; three tables + 6 permissions + one new `dataLifecycle` descriptor; every eligible public request now runs one `withTenant` transaction (the "tenant with no rules" short-circuit is deferred as a perf follow-up — it is not correctness-safe, because the 404 capture still needs the server-derived host and the legacy auto-redirect still comes from settings).
- Limitations (see `src/modules/seo-distribution/README.md`): host-based-only tenant resolution (path-tenant deferred); legacy-blog inert (no `/news`); `locale` is always null; the admin UI (chain preview + 404 dashboard) is deferred (the surface stays API-only); URL change capture is an audited synchronous hook, not yet a published domain event; the permission backfill reaches new tenants only.

## Rejected alternatives

- **Returning the frozen guards to the `seo_facts` port** — that pollutes a pure content-fact contract with the redirect concept; awcms deliberately excluded them in ADR-0038. Rejected; homed as standalone domain helpers.
- **Building the path-tenant strategy now** — it enlarges the PR and adds a second tenant-resolution surface before any consumer needs it; host-based-only matches awcms-micro and is enough for tenants with a custom domain. Rejected; deferred.
- **Redirects as an `/api/v1` endpoint (instead of middleware)** — public redirect resolution MUST happen before content routing for every public request; making it an API endpoint would mis-model it. The redirect admin API (write/manage) IS `/api/v1`; public resolution (reading a 3xx `Location`) really is middleware. Rejected for public resolution.
- **Enabling the legacy-blog `/news`** — there is no `/news` route family on this base; enabling it would produce redirects into a 404. Rejected; kept inert for parity.
