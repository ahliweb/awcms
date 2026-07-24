# tenant_domain

Tenant hostname/subdomain → tenant mapping for **host-based public routing**,
ported from awcms-micro (epic #555). Registered as a `type: "domain"` module in
`src/modules/index.ts`.

This module lets a tenant register the public hostnames/subdomains that resolve
to it, prove ownership (manual-first), and choose one active **primary** domain.
It is the data + resolver seam a future host-resolved public content route
family (a `/news`-style surface) will read to answer "which tenant does this
`Host` header belong to?" **without** a `tenantCode` in the path.

It is **additive**: ADR-0009's existing path-based `/blog/{tenantCode}` routing
is untouched and remains the mechanism for those routes. `src/middleware.ts` is
not modified — host resolution is a per-public-route concern, so the login /
Turnstile / CSP guarantees are unchanged.

## What shipped

| Area            | Detail                                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema          | `awcms_tenant_domains` (migration **046**) — tenant-scoped, `ENABLE`+`FORCE ROW LEVEL SECURITY`, global case-insensitive hostname uniqueness, one primary/tenant. |
| Permissions     | migration **047** — `tenant_domain.domains.{read,create,update,delete,verify,set_primary}`.                                                                       |
| Host lookup     | migration **048** — `awcms_resolve_tenant_domain_lookup(text)` `SECURITY DEFINER`, `EXECUTE` revoked from `PUBLIC`, granted only to `awcms_app`.                  |
| Management API  | `GET/POST /api/v1/tenant/domains`, `GET/PATCH/DELETE .../{id}`, `POST .../{id}/verify`, `POST .../{id}/set-primary`.                                              |
| Admin screen    | `/admin/tenant/domains` (SSR read + client-side `fetch` mutations, `tenant_domain.domains.read`-gated).                                                           |
| Public resolver | `src/lib/tenant/public-host-tenant-resolver.ts` (additive; coexists with ADR-0009).                                                                               |
| Optional DNS    | `infrastructure/cloudflare-dns-adapter.ts` — env-gated, absent-safe, **not wired into any route**.                                                                |

## Data model (`awcms_tenant_domains`)

- `hostname` (raw, case preserved) + `normalized_hostname` (`lower(btrim(...))`,
  kept in sync by a CHECK). The unique index on `normalized_hostname WHERE
deleted_at IS NULL` is **global (cross-tenant)** — a hostname maps to at most
  one tenant. A soft delete frees it for reuse.
- `domain_type` (`subdomain`|`custom_domain`), `route_mode`
  (`canonical`|`legacy_blog`, laid down for forward compatibility, not consumed
  by any resolver yet).
- `status` (`pending_verification`|`active`|`suspended`|`failed`); soft delete
  (`deleted_at`/`deleted_by`/`delete_reason`) is a separate "does not resolve"
  state, not folded into the enum.
- `is_primary` + `redirect_to_primary`; one active primary per tenant (partial
  unique index).
- `verification_method` + `verification_record_name`/`verification_record_value`
  (the **public** DNS record the tenant publishes — never a secret).
  `verification_token_hash` is an internal bearer-token hash and is **never**
  selected/returned by any code in this module.

**No column ever stores a DNS provider API credential.** The Cloudflare
adapter's token/zone come only from `TENANT_DOMAIN_CLOUDFLARE_*` env vars.

## Tenant domain management API

All endpoints are authenticated, tenant-scoped, and guarded at the
identity-access chokepoint (`authorizeInTransaction`, default-deny ABAC) inside
`withTenant`. Every query runs under RLS `FORCE` (defense in depth over the
explicit `tenant_id` filter) — **never** through the `SECURITY DEFINER` function
(that is reserved for the anonymous public resolver).

- `hostname` is **immutable** after create (re-pointing means delete + recreate)
  and `is_primary` is never settable through the generic `PATCH` — the only path
  to primary is the atomic `POST .../set-primary`. `PATCH` can never set
  `status: "active"` (use verify).
- A duplicate normalized hostname → generic `409 HOSTNAME_CONFLICT`, never
  revealing whether it belongs to another tenant. Unknown/cross-tenant/deleted
  ids → generic `404`.
- `verify` and `set-primary` require an `Idempotency-Key` and are audited, even
  though neither is classified `HIGH_RISK` (same posture as other status-flip
  actions). `verify` is manual-first — it flips `status` to `active` from the
  row's own fields, with **no outbound DNS/HTTP call**.
- `set-primary` is atomic (unset-old-then-set-new inside one transaction) and
  maps the concurrent first-time-primary race to `409 CONCURRENT_UPDATE`.

## Public host resolver (the seam)

`resolvePublicTenantFromRequest(sql, request|host, config, deps?)` orchestrates:

0. `mode === "tenant_code_legacy"` → `null` immediately (operator opted out of
   any default-tenant guess).
1. host lookup (`resolvePublicTenantByHost`) — only when `mode ===
"host_default"`, via the migration 048 `SECURITY DEFINER` function.
2. `PUBLIC_DEFAULT_TENANT_ID` → 3. `PUBLIC_DEFAULT_TENANT_CODE` → 4.
   `awcms_setup_state.tenant_id` → 5. `null`.

Steps 2–4 (the safe fallback) run for every mode **except**
`tenant_code_legacy`; an unset mode (offline/LAN default) keeps the full
fallback. Only `domain_status === 'active' && tenant_status === 'active'`
resolves — every other case returns an identical `null`, in exactly one DB round
trip (no timing side-channel). `X-Forwarded-Host` is read only when
`config.trustProxy` is true.

## Not yet available (deferred, documented)

- **Host-resolved public content routes.** The resolver + lookup function +
  directory + admin API are complete and tested, but no public route consumes
  `resolvePublicTenantFromRequest` yet — that needs the blog_content/news_portal
  public render routes plumbed through it (news_portal deferred its own
  `/news/**` routes for the same reason). Wiring it is a clean follow-up; the
  seam is stable.
- **Cloudflare DNS automation.** `resolveTenantDomainDnsProvider(env)` and
  `createCloudflareDnsProvider` exist and are unit-tested, but no route calls
  them. With no `TENANT_DOMAIN_DNS_PROVIDER=cloudflare` configured the resolver
  returns a clean misconfigured-result provider (never throws), so awcms builds
  and runs with zero Cloudflare credentials.

## Security residual risk — gate before untrusted self-service (M1)

`verify` currently activates a domain from in-row fields **without an outbound
ownership proof** (manual-first; the DNS-token machinery —
`verification_token_hash` + the Cloudflare/DNS adapter — exists but is not wired).
Because the global-unique hostname index is scoped `WHERE deleted_at IS NULL`, a
soft-deleted hostname is re-registerable by another tenant. If untrusted
multi-tenant self-service verification of shared **`custom_domain`s** is enabled,
this combination allows a **dangling-DNS domain takeover**: tenant A deletes a
mapping but leaves DNS pointed at the platform, tenant B re-registers and
`verify`s the same hostname with no proof, and traffic to the dangling host now
resolves to tenant B.

Mitigations already in place: `verify` is **default-deny** (privileged, seeded)
and **audited**; subdomains under the platform root are not affected (they are not
delegated to tenants). **Required before go-live of untrusted self-service custom
domains:** either keep `custom_domain` activation **operator/manual-gated**, or
wire real DNS-token ownership proof (write a CSPRNG token to
`verification_token_hash`, require the tenant to publish the matching TXT/CNAME,
and confirm it in `verify` via `checkVerificationStatus`). Tracked as the
tenant-domain hardening follow-up in `docs/awcms/absorb-awcms-micro-roadmap.md`.

## Tests

- `tests/tenant-domain-module.test.ts` — descriptor ↔ migration 047 parity.
- `tests/tenant-domain-validation.test.ts` — create/update validation.
- `tests/tenant-domain-dns-config.test.ts` — provider/timeout config.
- `tests/cloudflare-dns-adapter.test.ts` — DNS-record input validation + the
  absent-safe resolver.
- `tests/public-host-tenant-resolver.test.ts` — `normalizePublicHost` +
  resolution-order branching (mocked deps, no DB).
- `tests/integration/tenant-domain.integration.test.ts` — DB-gated: directory
  CRUD/verify/set-primary, cross-tenant global uniqueness, soft-delete reuse,
  one-primary-per-tenant, and **RLS proven under `awcms_app`** (direct SELECT
  returns 0 rows without tenant context; the `SECURITY DEFINER` lookup resolves
  an active domain and never exposes a secret column).
