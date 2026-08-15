🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0009-public-tenant-scoped-routes.id.md)

# ADR-0009 — Tenant resolution for public routes (no session)

- **Status:** Accepted
- **Date:** 2026-07-07
- **Decision maker:** <maintainer>
- **Related:** `docs/awcms/15_frontend_architecture_integration.md`, `docs/awcms/16_backend_data_access_integration.md`, `docs/awcms/18_configuration_env_reference.md` §LAN-first deployment topology, Issue #540 (epic #536, `blog_content`), ADR-0003

## Context

Every tenant resolution mechanism that exists today assumes the caller is already authenticated: `src/middleware.ts` only resolves the tenant for `/admin/*` through the session cookie, and every `/api/v1/*` endpoint relies on the `X-AWCMS-Tenant-ID` header sent explicitly by a client that already knows its tenant. **There is no mechanism for an anonymous visitor** (e.g. a public blog reader) to have their request scoped to the right tenant — this repo has never built a tenant-scoped public route at all (the single example, `/customer/receipts/{token}` in doc 14's screen inventory, is purely illustrative/never implemented, and its token pattern only fits one specific resource anyway, not cross-page public navigation like a blog/RSS/sitemap).

Epic #536 (`blog_content`) needs this for real: `GET /blog/{...}`, RSS, sitemap, and public post pages (Issue #540) all have to know which tenant they serve **without** a session/explicit header from an ordinary visitor's browser. This decision must be made once at the base level (not decided ad hoc by `blog_content`), because the next public derived module (e.g. a customer portal, per-tenant landing pages) will hit the identical problem.

## Decision

We decided that tenant-scoped public routes resolve the tenant through an **explicit path segment** carrying the existing `tenant_code` (`awcms_tenants.tenant_code`, globally unique since migration 002) — of the form `/<prefix>/{tenantCode}/...` (e.g. `/blog/{tenantCode}/{slug}`), **not** subdomain-per-tenant.

Resolution: before opening the `withTenant` transaction, look up `tenant_code → tenant_id` from `awcms_tenants` (an RLS-free table — it is itself the tenant root, the same reason this table is RLS-free in ADR-0003) with one light query; a `tenantCode` that is not found, or a tenant with `status != 'active'`, → `404`, not a leak of the tenant's existence. This pattern is symmetric with how `X-AWCMS-Tenant-ID` is already resolved for authenticated API clients — only the source of the tenant id differs (path, not header/session).

## Consequences

- **Positive:** works identically on every deployment profile (LAN/offline/online, doc 18) without extra DNS/TLS — in line with AWCMS's LAN-first default topology principle (one server, LAN clients, no internet dependency). Easy to test locally (`http://localhost:4321/blog/{tenantCode}/...`), no wildcard cert needed.
- **Negative/trade-off:** the `tenantCode` is visible in the public URL — not full white-labeling (a visitor knows this is multi-tenant SaaS). A derived application that needs a custom domain per tenant (e.g. `blog.customer-a.com`) needs an extra layer (see Alternatives below) — out of scope for this base.
- **Neutral:** every new public route follows the same pattern (one `tenantCode → tenant_id` resolution point, a reusable helper, not reimplemented per module) — `awcms-new-endpoint` is documented to refer to this ADR.

## Alternatives considered

- **Subdomain per tenant** (`{tenantCode}.awcms.example.com`) — rejected as the base default: it needs wildcard DNS + a wildcard/SAN TLS certificate + a real public domain, which directly contradicts the default LAN-first/offline topology (doc 18) where the server may not even have a public domain at all. Valid as an **optional extension** for online-only deployments (can be a follow-up ADR if a particular derived application needs it), not for the generic base.
- **Custom domain per tenant** (a domain→tenant mapping table, e.g. `blog.customer-a.com`) — same as above, rejected for the base (it needs per-tenant DNS/TLS provisioning, which makes no sense LAN-first); recorded as a valid extension for an online-only SaaS derived application, designed separately from this base when the time comes.
- **Global public pages with no tenant in the URL, tenant picked via a switcher** — rejected: impossible for an anonymous visitor who has never known which tenant they are looking for (e.g. a visitor arriving from an RSS/search-engine link straight to one specific post), and it weakens the isolation model (one public domain becomes "a directory of all tenants").
