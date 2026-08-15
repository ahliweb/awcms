---
name: awcms-tenant-domain-routing
description: The tenant_domain module HAS ALREADY been ported into this repo (from awcms-micro epic #555). Hostname/subdomain → tenant mapping for host-based public routing, living side by side with path-based routing `/blog/{tenantCode}` (ADR-0009) without regressing it. Use when changing the tenant domain schema/API/UI, the host-based tenant resolver, the `SECURITY DEFINER` lookup function, the optional Cloudflare DNS adapter, serving-record reconciliation `bun run tenant-domain:dns:sync` (`ensureServingRecord` desired-state + `sql/069` GRANT SELECT to `awcms_worker`), or when wiring host-resolved public content routes (still deferred). It summarises the binding design decisions so follow-up changes do not repeat or contradict them.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Tenant Domain & Host-Based Public Routing

The `tenant_domain` module maps public hostnames/subdomains to a tenant, proves
ownership (manual-first), and selects one active **primary** domain per tenant.
It is the data seam + resolver that future host-resolved public content routes
will read in order to answer "which tenant does this Host header belong to?"
WITHOUT a `tenantCode` in the path.

**Additive, not a replacement.** Path-based routing `/blog/{tenantCode}`
(ADR-0009) stays intact and remains the mechanism for that route.
`src/middleware.ts` is NOT touched — host resolution is a per-public-route
concern, not a middleware concern, so the login/Turnstile/CSP guarantees are
unchanged.

## When to use this skill vs the generic skills

It complements (does not replace) `awcms-new-endpoint`, `awcms-new-migration`,
`awcms-new-module`, `awcms-abac-guard`, `awcms-idempotency`. This skill provides
`tenant_domain`-specific cross-file context so follow-up changes do not regress
the binding design decisions.

## Code map (what ALREADY exists in this repo — reuse it, do not re-derive)

| Part            | Location                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------- |
| Descriptor      | `src/modules/tenant-domain/module.ts` (`type: "domain"`, registered in `src/modules/index.ts`) |
| Schema          | `sql/046_awcms_tenant_domain_schema.sql` — `awcms_tenant_domains`                              |
| Permission seed | `sql/047_awcms_tenant_domain_permissions.sql` — `tenant_domain.domains.*`                      |
| Lookup function | `sql/048_awcms_tenant_domain_lookup_function.sql` — `awcms_resolve_tenant_domain_lookup(text)` |
| Validation      | `src/modules/tenant-domain/domain/tenant-domain-validation.ts`                                 |
| DNS config      | `src/modules/tenant-domain/domain/tenant-domain-dns-config.ts`                                 |
| Directory       | `src/modules/tenant-domain/application/tenant-domain-directory.ts`                             |
| Cloudflare      | `src/modules/tenant-domain/infrastructure/cloudflare-dns-adapter.ts` (optional, not yet wired) |
| Public resolver | `src/lib/tenant/public-host-tenant-resolver.ts`                                                |
| API             | `src/pages/api/v1/tenant/domains/index.ts`, `[id].ts`, `[id]/verify.ts`, `[id]/set-primary.ts` |
| Admin UI        | `src/pages/admin/tenant/domains.astro` (+ nav in `src/layouts/AdminLayout.astro`)              |
| OpenAPI         | `openapi/modules/tenant-domain.openapi.yaml`                                                   |

## Schema (`awcms_tenant_domains`, migration 046)

- `hostname` (raw, case preserved) + `normalized_hostname`
  (`lower(btrim(hostname))`, enforced by CHECK
  `awcms_tenant_domains_normalized_hostname_matches_check`). The unique index
  `awcms_tenant_domains_normalized_hostname_dedup` on `normalized_hostname
WHERE deleted_at IS NULL` is **GLOBAL (cross-tenant)** — one hostname may
  belong to exactly one tenant. Soft delete frees it for reuse.
- `domain_type` (`subdomain`|`custom_domain`), `route_mode`
  (`canonical`|`legacy_blog` — the column is prepared, not yet consumed by the
  resolver).
- `status` (`pending_verification`|`active`|`suspended`|`failed`); soft delete
  (`deleted_at`/`deleted_by`/`delete_reason`) is a separate "does not resolve"
  state, not folded into the enum.
- `is_primary` + `redirect_to_primary`; one active primary per tenant
  (`awcms_tenant_domains_primary_dedup`, partial unique index).
- `verification_method` + `verification_record_name`/`verification_record_value`
  (PUBLIC DNS values the tenant publishes — NOT secrets).
  `verification_token_hash` is an internal bearer-token hash and is **never**
  `SELECT`ed/returned by any module code.
- RLS `ENABLE` + `FORCE` + the standard `tenant_isolation` policy. **Do not drop
  FORCE** to work around the resolver's bootstrap gap — that is what function
  048 is for.
- GRANT to `awcms_app` happens automatically via `ALTER DEFAULT PRIVILEGES`
  (sql/019); there is no `<worker-role>` grant (this module has no background
  job).

**No column stores DNS provider credentials.** Cloudflare token/zone come only
from the `TENANT_DOMAIN_CLOUDFLARE_*` env vars.

## `SECURITY DEFINER` lookup function (migration 048)

`awcms_resolve_tenant_domain_lookup(p_normalized_hostname text)` — the only
sanctioned bootstrap read path for host→tenant resolution BEFORE a tenant
context exists (the `app.current_tenant_id` GUC). Why it is safe — **DO NOT**
rely on the assumption "the migration owner is superuser → the function bypasses
RLS": that is WRONG under this repo's hardened posture. A `SECURITY DEFINER`
function runs with **its owner's rights at call time**, and sql/019–022
deliberately run the runtime as a NON-superuser NOBYPASSRLS role; a
role-separated deployment (and the integration harness, which demotes the
migration owner to `NOSUPERUSER NOBYPASSRLS` right after migrating) leaves no
superuser owning this function. A non-superuser owner is fully subject to
`FORCE RLS` → the function will resolve **0 rows** for every host. So bootstrap
security is **not** from a bypass, but from:

- **A dedicated owner role `awcms_domain_bootstrap`** — `NOLOGIN NOSUPERUSER
NOBYPASSRLS`, created idempotently (same pattern as sql/019/022,
  cluster-scoped). The function is `ALTER FUNCTION ... OWNER TO
awcms_domain_bootstrap` → it executes as this role. NOLOGIN + **no members**
  (in particular `awcms_app` is not a member; reassigning the owner uses the
  SUPERUSER migration owner, **without** granting membership to anyone) → nobody
  can `SET ROLE` into it; the only code that runs as this role is this function.
- **A scoped read policy** `awcms_tenant_domains_bootstrap_read` — permissive
  `FOR SELECT TO awcms_domain_bootstrap USING (true)`, OR-ed with (not replacing)
  `tenant_isolation`. RLS matches policy roles through membership, so this policy
  applies ONLY when the role is/is a member of `awcms_domain_bootstrap` — that
  is, ONLY inside this function. A direct `SELECT` by `awcms_app` still only hits
  `tenant_isolation` → fail-closed. `FORCE RLS` + the `tenant_isolation` policy
  from sql/046 are **not** touched. `awcms_domain_bootstrap` also needs an
  explicit `GRANT SELECT` on `awcms_tenant_domains` + `awcms_tenants` (table
  privileges are separate from RLS policies).
- Additional fences (not the primary source of security, but mandatory): (1) the
  function body is static SQL, returning only 8 non-sensitive columns for a
  single parameterised `normalized_hostname` + `deleted_at IS NULL` — that
  **column list** is the boundary, it cannot read raw
  `verification_token_hash`/`verification_record_value`/`hostname` even if the
  policy allowed SELECT over the whole table; (2) `EXECUTE` is `REVOKE`d from
  `PUBLIC` and `GRANT`ed only to `awcms_app`. `awcms_app` still cannot `SELECT`
  directly from the table without `withTenant`.
- `SET search_path = public, pg_temp` + `STABLE`.
- JOIN to `awcms_tenants` (already RLS-free, ADR-0003) inside the same function
  so the resolver needs **exactly one round-trip** for every outcome — avoiding a
  timing side-channel between "unknown host" and "host exists but tenant is
  inactive". **Do not** split this into a conditional second query.

Verified against a real Postgres (docker `psql`, replicating the demoted
`NOSUPERUSER NOBYPASSRLS` owner like the harness does): a direct `SELECT` on
`awcms_tenant_domains` as `awcms_app` with a fail-closed GUC → 0 rows;
`awcms_resolve_tenant_domain_lookup(...)` → 1 row (non-superuser function owner);
dropping the bootstrap policy → the function goes back to 0 rows (proof the
policy is load-bearing); `awcms_app` still cannot read
`verification_token_hash`.

## Public resolver (`public-host-tenant-resolver.ts`)

`resolvePublicTenantFromRequest(sql, request|host, config, deps?)` — order:

0. `mode === "tenant_code_legacy"` → immediately `null` (the operator explicitly
   opted out of guessing a default tenant). Mode `undefined` (the offline/LAN
   default) is **NOT** the same — it still runs the full fallback.
1. host lookup (`resolvePublicTenantByHost`) — ONLY when
   `mode === "host_default"`, via function 048.
2. `PUBLIC_DEFAULT_TENANT_ID` → 3. `PUBLIC_DEFAULT_TENANT_CODE` → 4.
   `awcms_setup_state.tenant_id` → 5. `null` (generic 404).

Steps 2-4 (the safe fallback) run for every mode EXCEPT `tenant_code_legacy`.
Only `domain_status === 'active' && tenant_status === 'active'` resolves — every
other combination returns an identical `null`. `X-Forwarded-Host` is read only
when `config.trustProxy === true`; a multi-value header is treated as an anomaly
→ log + fall back to the plain `Host`. `normalizePublicHost()` is reused by the
API validation (not a second opinion on shape) and only throws for an empty
string (a caller contract violation).

## Management API (`/api/v1/tenant/domains`)

Authenticated, tenant-scoped, guarded at the identity-access chokepoint
(`authorizeInTransaction`, default-deny ABAC) inside `withTenant`. Every query
runs under `FORCE` RLS (defense-in-depth on top of the `tenant_id` filter) — it
**never** goes through the `SECURITY DEFINER` function (that is exclusive to the
public resolver).

```txt
GET    /api/v1/tenant/domains              list, keyset-paginated (limit 100)
POST   /api/v1/tenant/domains              create
GET    /api/v1/tenant/domains/{id}         read one
PATCH  /api/v1/tenant/domains/{id}         partial update
DELETE /api/v1/tenant/domains/{id}         soft delete (reason required)
POST   /api/v1/tenant/domains/{id}/verify        manual-first verify (Idempotency-Key)
POST   /api/v1/tenant/domains/{id}/set-primary   atomic primary swap (Idempotency-Key)
```

Binding decisions:

- `hostname` is **immutable** after create (re-pointing = delete + create again);
  `is_primary` is never settable through the generic `PATCH` (the only path is
  `set-primary`); `PATCH` can never set `status: "active"` (use verify).
- A duplicate normalized hostname → a generic `409 HOSTNAME_CONFLICT`, never
  leaking whether it belongs to another tenant. Unknown/cross-tenant/deleted id →
  a generic `404` (the `tenant_id`/`deleted_at IS NULL` filter + FORCE RLS).
- `verify`/`set_primary` require `Idempotency-Key` (scopes
  `tenant_domain_verify`/`tenant_domain_set_primary`) and are audited, even
  though neither is **`HIGH_RISK`** (the `AccessAction` union is extended with
  `set_primary`; `verify` already existed from news_portal — that module is now
  merged into `blog_content`, ADR-0044/#300). `verify` is manual-first, with no
  outbound DNS/HTTP call.
- ⚠️ **RESIDUAL RISK M1 (dangling-DNS takeover) — gate it before untrusted
  self-service custom domains.** `verify` activates a domain without outbound
  proof of ownership; a soft-deleted hostname can be re-registered by another
  tenant (unique index `WHERE deleted_at IS NULL`). For shared `custom_domain`:
  keep activation **operator/manual gated**, OR wire DNS-token proof
  (`verification_token_hash` + a TXT/CNAME check via `checkVerificationStatus`)
  before allowing self-service verification. See the module README §Security
  residual risk + the follow-up in `docs/awcms/absorb-awcms-micro-roadmap.md`.
- `set-primary` is atomic (unset-old-then-set-new in a single transaction); a
  concurrent first-time-primary race maps to `409 CONCURRENT_UPDATE`
  (`setPrimaryTenantDomain` catches violations of
  `awcms_tenant_domains_primary_dedup`).

## Keyset pagination — the µs vs ms trap

`listTenantDomains` BUILDS the cursor ITSELF (not in the route) via
`to_char(created_at AT TIME ZONE 'UTC', ...)` as `created_at_cursor` and then
`encodeKeysetCursor(created_at_cursor, id)`. This is because `timestamptz` stores
MICROSECONDS while a JS `Date` only has milliseconds — a cursor built from a
`Date` skips rows sharing that millisecond (Issue #158). Do not build the cursor
from `view.createdAt`.

## Cloudflare DNS adapter (optional, NOW wired for serving records)

`infrastructure/cloudflare-dns-adapter.ts` — `resolveTenantDomainDnsProvider(env)`

- `createCloudflareDnsProvider`. No route calls it. Without
  `TENANT_DOMAIN_DNS_PROVIDER=cloudflare`, the resolver returns a clean
  misconfigured-result provider (it never throws) — awcms builds & runs without
  Cloudflare credentials. `validateDnsRecordInput` rejects a recordName outside
  `TENANT_DOMAIN_PLATFORM_ROOT_DOMAIN`, CR/LF injection, and non-host CNAME
  targets. The `recordName` shape deliberately does NOT reuse
  `normalizePublicHost()` (DNS record names are commonly underscore-prefixed,
  e.g. `_acme-challenge.example.com`); `normalizePublicHost` is still used for
  the CNAME target. Timeout via `resolveTenantDomainCloudflareTimeoutMs` (env
  `TENANT_DOMAIN_CLOUDFLARE_TIMEOUT_MS`, default 8 seconds, never fails boot).
  Cloudflare secrets come only from env — never in the DB/response.

### Serving-record reconciliation (`bun run tenant-domain:dns:sync`)

**CORRECTION:** this section previously read "NOT yet wired / no route calls it".
That is still true for **verification** records (TXT, create-only), but no longer
for **serving** records.

- The `TenantDomainDnsProvider` port now has `ensureServingRecord`
  (`A`/`CNAME`). The difference from `createDnsRecord`: it is **desired-state** —
  when a record with that name already exists but its contents differ, it `PUT`s
  on the existing id, it **never `POST`s a second one**. Two records for one
  hostname is silent round-robin to the wrong destination half the time.
- `application/dns-serving-reconciler.ts` — `reconcileServingRecords()` processes
  rows **sequentially** (Cloudflare rate-limits per token; a parallel burst
  across tenants throttles the whole pass) and **one failure does not abort the
  pass**.
- `scripts/tenant-domain-dns-sync.ts` — the worker entrypoint, never exposed over
  HTTP, run it on a schedule. `--dry-run` reports without writing.
- Reads as the **SELECT-only** `awcms_worker` role (`sql/069`); FORCE RLS applies
  to that role too, so the queries are wrapped in `withTenant`.
- **Only `domain_type = 'subdomain'`.** Custom domains live in a zone owned by
  the tenant — writing to it is not merely impolite, it is impossible.
- **It never deletes anything.** Soft-deleted/suspended domains are skipped,
  leaving a stale record pointing at the platform — visible and harmless —
  rather than letting an automated job perform destructive DNS writes.
- **There is no default target.** `resolveServingTarget()` returns `null` when
  `TENANT_DOMAIN_SERVING_TARGET` is empty, and the job no-ops. Guessing here
  means pointing ALL tenant subdomains at the wrong address — a platform-wide
  outage, not a small bug.
- **A green exit ≠ every record landed.** Per-domain failures are recorded and
  the pass continues; what states the result is the `failed=` count on the
  summary line.
- Two environments **must not** both be `TENANT_DOMAIN_DNS_PROVIDER=cloudflare`
  on the same zone — they will overwrite each other's serving records for the
  same hostname. This repo itself deploys only one environment
  ([ADR-0083](../../../docs/adr/0083-this-template-deploys-to-one-environment.md),
  see [`docs/awcms/environments.md`](../../../docs/awcms/environments.md)), so
  this rule protects installations that DO run a second environment: exactly one
  may be `cloudflare`, the rest `manual`.

## What does NOT exist yet (deferred, documented)

- **Host-resolved public content routes** (a `/news`-style surface). The
  resolver + lookup function + directory + admin API are complete & tested, but
  no public route consumes `resolvePublicTenantFromRequest` yet — it needs the
  `blog_content` public render route plumbed through it (the `/news/**` routes
  remain deferred; since ADR-0044/#300 their owner is `blog_content`, not a
  separate module). The wiring is a clean follow-up; the seam is stable. The env
  vars `PUBLIC_TENANT_RESOLUTION_MODE`/`PUBLIC_TRUST_PROXY`/
  `PUBLIC_DEFAULT_TENANT_ID`/`PUBLIC_DEFAULT_TENANT_CODE` are not yet validated
  by `scripts/validate-env.ts` (no runtime consumer yet) — add them when wiring
  the public routes.
- **Cloudflare DNS automation for VERIFICATION records** (TXT `_acme-challenge`
  etc.) — still create-only/additive, no route calls it. **Serving** records are
  already automated; see `tenant-domain:dns:sync` above.

## Binding rules across changes

1. **Backward compatibility**: an offline/LAN deployment that never sets any
   `PUBLIC_*` must keep working exactly as before — do not make these config vars
   mandatory by default.
2. **`X-Forwarded-Host` only when `trustProxy` is explicitly true** — the safe
   default is `false` at every new layer.
3. **`/blog/{tenantCode}` (ADR-0009) is NOT removed** — host routing is additive,
   not a replacement.
4. **Tenant existence must not leak**: unknown/failed/suspended/inactive must
   produce identical responses (the resolver already returns an identical `null`;
   the public routes that use it must map to the same generic 404).
5. **Provider secrets (the Cloudflare token) are never in the DB/descriptor** —
   env only, like Mailketing/R2.
6. **Every domain mutation is audited** (`tenant_domain.domain.<verb>`); the
   anonymous read-only public resolver is NOT audited (same as
   `resolvePublicTenantByCode`).
7. **The tenant-scoped management API uses plain `withTenant`**, NEVER the
   `SECURITY DEFINER` function (that is purely public pre-tenant-context
   bootstrap).

## Tests

- Unit (no DB): `tests/tenant-domain-module.test.ts`,
  `tests/tenant-domain-validation.test.ts`,
  `tests/tenant-domain-dns-config.test.ts`,
  `tests/cloudflare-dns-adapter.test.ts`,
  `tests/public-host-tenant-resolver.test.ts`,
  `tests/tenant-domain-dns-serving.test.ts` (serving reconciliation; a fake
  Cloudflare API via `Bun.serve`, proving drift → `PUT` and not a second
  `POST`).
- Integration (DB-gated): `tests/integration/tenant-domain.integration.test.ts`
  — CRUD/verify/set-primary, cross-tenant uniqueness, soft-delete reuse,
  one-primary-per-tenant, and **RLS proven under `awcms_app`** (a direct SELECT
  returns 0 rows without a tenant context; the `SECURITY DEFINER` function
  resolves the active domain without leaking the secret columns).
