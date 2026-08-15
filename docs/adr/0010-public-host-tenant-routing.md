🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0010-public-host-tenant-routing.id.md)

# ADR-0010 — Host/domain-based public tenant routing (online-public extension)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Decision maker:** <maintainer>
- **Related:** `docs/adr/0009-public-tenant-scoped-routes.md`, `docs/adr/0003-postgresql-rls-multi-tenant.md`, `docs/awcms/deployment-profiles.md` §Online profile, `docs/awcms/18_configuration_env_reference.md` §Public routing, `src/modules/blog-content/README.md` §`/news` (default) vs `/blog/{tenantCode}` (legacy), `.claude/skills/awcms-tenant-domain-routing/SKILL.md`, Issue #556-#561 (epic #555)

## Context

ADR-0009 decided that public tenant-scoped routes (`/blog/{tenantCode}/...`,
Issue #540) resolve the tenant through an **explicit path segment** carrying
`tenant_code`, and explicitly rejected per-tenant subdomains/custom domains
as the _default_ base — because they need wildcard DNS/TLS and conflict
with AWCMS's default LAN-first/offline topology (doc 18).
ADR-0009 §Alternatives considered already recorded both of those alternatives
("subdomain per tenant", "custom domain per tenant") as **valid
as an optional extension for online-only deployments** — "could become a
follow-up ADR if a particular derived application needs it".

Epic #555 ("online public tenant routing, news routes, and tenant domain
management") realises that extension: the optional config
`PUBLIC_TENANT_RESOLUTION_MODE` (Issue #556), the hostname→tenant mapping
schema `awcms_tenant_domains` (Issue #557), the module descriptor
`tenant_domain` (Issue #558), the host-based resolver
`resolvePublicTenantFromRequest` (Issue #559), and the new public route `/news`
that carries no `tenantCode` segment at all (Issue #560). Issue #561
(this ADR) documents the decision already realised through those four issues,
and states its relationship to ADR-0009.

## Decision

We decide to add a **host/domain-based tenant resolution mode** as an
_additional_ capability for anonymous public routes, on top of (not
replacing) the path-segment-based resolution already decided in ADR-0009:

- The mode is chosen through the env var `PUBLIC_TENANT_RESOLUTION_MODE`
  (`host_default | env_default | setup_default | tenant_code_legacy`,
  Issue #556) — optional, opt-in per deployment. Not set at all
  (the default for every existing offline/LAN deployment) keeps the
  legacy behaviour entirely.
- Under `host_default`, `resolvePublicTenantFromRequest()` (Issue #559)
  resolves the tenant from the request `Host`/`X-Forwarded-Host` (only if
  `PUBLIC_TRUST_PROXY=true` is set explicitly) through the table
  `awcms_tenant_domains` (Issue #557), via a narrow
  `SECURITY DEFINER` lookup function (one table, four
  non-sensitive columns, `EXECUTE` revoked from `PUBLIC`). **Status:** the
  `tenant_domain` module has not been ported into this repo yet; this lookup
  migration is planned for when the port is done, with migration number
  **TBD (≠ `033`, which is now used by the `theming` schema)**.
  Besides `host_default`, there is a tiered fallback (`PUBLIC_DEFAULT_TENANT_ID`/
  `_CODE`, then `awcms_setup_state`) before finally `null` (a generic 404) — see `.claude/skills/awcms-tenant-domain-routing/SKILL.md`
  §Resolver for the full order.
- The new public route `/news` (Issue #560) consumes this resolver through
  `withNewsTenant()` — with **no** `tenantCode` segment in the path at all.
  The old route `/blog/{tenantCode}` (ADR-0009, Issue #540) is **unchanged**
  and keeps using `resolvePublicTenantByCode()` (path segment), never
  touching this host-based resolver.
- The `tenant_code_legacy` mode, when set explicitly, makes the resolver
  return `null` outright for `/news` (no guessing at any default
  tenant) — a deliberate operator decision of "an explicit `tenantCode` in the
  path stays mandatory", documented in detail in Issue #560's `SKILL.md`
  §`tenant_code_legacy` decision.

This is an **extension on top of ADR-0009**, not a replacement for it: both
resolution mechanisms (path segment vs host/domain) live side by side
permanently. `/blog/{tenantCode}` is not scheduled for removal.

## Consequences

- **Positive:** Online/public/SaaS deployments with real domains get
  public URLs that are clean, SEO-friendly, and tenant-implicit (`/news/...`,
  not leaking `tenant_code` in the path) without changing AWCMS's default
  LAN-first/offline topology at all — a deployment that never sets any
  `PUBLIC_*` behaves identically
  (`config:validate` still PASSes, `/blog/{tenantCode}` is still the only
  relevant public route). The change is purely additive/opt-in.
- **Negative/trade-off:** Two parallel tenant resolution mechanisms now
  exist for the public context (path segment vs host mapping) — a derived
  module adding a new public route must consciously pick one
  explicitly, rather than assuming one universal mechanism. The
  `host_default` mode adds a new configuration risk surface:
  `PUBLIC_TRUST_PROXY=true` **must** only be enabled behind a trusted reverse
  proxy that overwrites (not appends to/forwards) `X-Forwarded-Host`
  — a proxy misconfiguration here can open up tenant spoofing through a
  client-forged header.
- **Neutral:** There is one security follow-up already identified and
  not yet fixed — a timing side-channel across `withNewsTenant`'s three 404
  outcomes (tenant does not resolve / `tenant_code_legacy` / the
  `blog_content` module is disabled) which have different latency costs, recorded
  as **must be fixed before `PUBLIC_TENANT_RESOLUTION_MODE=host_default`
  is enabled in production** (see `.claude/skills/awcms-tenant-domain-routing/SKILL.md`
  §Mandatory security follow-up). This does not block acceptance of this ADR because
  `host_default` cannot resolve any real mapping until Issue #562
  (the tenant domain API) exists.

### Tenant isolation does not change, regardless of routing mode

The tenant resolution mode for public routes (path segment vs host/domain) **only
determines how `tenant_id` is found** from an anonymous request, before the
`withTenant(...)` transaction is opened. Once `tenant_id` resolves — through
whichever mechanism — **all data isolation remains purely
database/RLS-based** (ADR-0003): `FORCE ROW LEVEL SECURITY` on
tenant-scoped tables, the fail-closed `app.current_tenant_id` GUC, and the
application role `awcms_app` that is neither superuser nor table owner. The
`SECURITY DEFINER` function planned for use by the host-based resolver
(`awcms_resolve_tenant_domain_lookup`,
migration TBD when the `tenant_domain` module is ported — **not `sql/033`, which is
now the `theming` schema**) will not loosen RLS on any query path afterwards — it
only performs one narrow lookup (`hostname → tenant_id`) which by
design happens _before_ any tenant context exists, exactly symmetrical to the
`tenant_code → tenant_id` lookup (also RLS-free, a root table) already
used by `/blog/{tenantCode}` since ADR-0009. Adding a new resolution mode
never means adding a new way to bypass RLS on any tenant-scoped
data.

## Alternatives considered

- **Making host/domain-based routing the default/only
  mechanism, with a full migration away from `/blog/{tenantCode}`** — rejected: it forces
  every offline/LAN deployment (which often has no public domain
  at all, doc 18 §LAN-first topology) to depend on DNS/host
  headers, in direct conflict with AWCMS's default LAN-first principle
  and with epic #555's Out of Scope ("removing legacy `/blog/{tenantCode}`
  routes in the MVP").
- **An automatic redirect from `/blog/{tenantCode}` to `/news` for tenants
  that already have a domain mapping** — rejected for the scope of this ADR: the old
  and new routes use different tenant resolution contexts (an explicit path
  segment vs an implicit host); an automatic redirect needs an additional
  product decision (e.g. whether the tenantCode in the URL may "leak" briefly before
  the redirect) beyond the scope of issue #561, which is explicitly docs-only. Recorded
  as a possible follow-up issue, not part of this decision.
- **Automatic per-tenant subdomains (e.g. `{tenantCode}.platform.example.com`)
  without an explicit mapping table** — rejected: it does not support customer
  custom domains (`blog.pelanggan-a.com`), which is one of the main motivations of
  epic #555, and it still requires the same wildcard TLS as the alternative
  already rejected by ADR-0009. The `awcms_tenant_domains` table (Issue
  #557) supports both (subdomains **and** custom domains) through
  `domain_type`, so it was chosen as the more general mapping mechanism.
