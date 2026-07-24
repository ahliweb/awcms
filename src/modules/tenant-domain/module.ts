import { defineModule } from "../_shared/module-contract";

/**
 * `tenant_domain` — tenant hostname/subdomain -> tenant mapping for host-based
 * public routing, ported from awcms-micro (epic #555). Ships: the
 * `awcms_tenant_domains` schema (migration 046), its permission catalog seed
 * (migration 047), the SECURITY DEFINER host-lookup bootstrap function
 * (migration 048), the authenticated tenant-scoped management API
 * (`/api/v1/tenant/domains/**`), an admin screen (`/admin/tenant/domains`), the
 * additive public host resolver (`lib/tenant/public-host-tenant-resolver.ts`),
 * and the optional Cloudflare DNS adapter (`infrastructure/
 * cloudflare-dns-adapter.ts`, not wired into any route yet).
 *
 * `type: "domain"` — registered per the port instruction. (awcms-micro used
 * `type: "system"` reasoning that hostname->tenant routing is shared platform
 * infrastructure; in this base it is registered as a `"domain"` module like the
 * other ported website modules, following the same directly-in-base convention
 * blog_content/news_portal use. The DB `module_type` CHECK constraint accepts
 * base/system/domain/integration.)
 *
 * PORT-TIME NOTES (documented, not silent):
 *  - The optional Cloudflare DNS adapter is included as an OPTIONAL capability
 *    with a safe absent default: with no `TENANT_DOMAIN_DNS_PROVIDER=cloudflare`
 *    configured, `resolveTenantDomainDnsProvider` returns a clean
 *    misconfigured-result provider (never throws), so awcms builds and runs
 *    with zero Cloudflare credentials. No route calls it yet.
 *  - The host-resolved public route family (a `/news`-style tenant content
 *    surface) is NOT wired in this port — that needs blog_content/news_portal
 *    public render routes plumbed through the resolver, deferred exactly as
 *    news_portal's own port deferred its `/news/**` routes. The resolver +
 *    lookup function + directory + admin API are a complete, tested seam ready
 *    for that future wiring; `src/middleware.ts` is intentionally untouched
 *    (host resolution is a per-public-route concern, not a middleware one, so
 *    the login/Turnstile/CSP guarantees are unchanged).
 *
 * This module never stores a DNS provider API token/credential in the database:
 * `verification_token_hash` (migration 046) is an internal bearer-token hash,
 * `verification_record_value` is the public DNS record value the tenant
 * publishes (not a secret), and the Cloudflare adapter's own API token/zone id
 * are read only from `TENANT_DOMAIN_CLOUDFLARE_*` env vars, never persisted.
 */
export const tenantDomainModule = defineModule({
  key: "tenant_domain",
  name: "Tenant Domain",
  version: "0.1.0",
  status: "active",
  description:
    "Tenant domain/subdomain mapping for host-based public routing (ported from awcms-micro epic #555). Ships the awcms_tenant_domains schema (migration 046: hostname/normalized_hostname, domain_type subdomain|custom_domain, route_mode canonical|legacy_blog, status pending_verification|active|suspended|failed, verification_method dns_txt|dns_cname|file|manual, is_primary/redirect_to_primary, tenant-scoped RLS with FORCE), its permission catalog seed (migration 047: tenant_domain.domains.{read,create,update,delete,verify,set_primary}), the SECURITY DEFINER bootstrap host-lookup function (migration 048, EXECUTE restricted to awcms_app), the authenticated tenant-scoped management API (GET/POST /api/v1/tenant/domains, GET/PATCH/DELETE .../{id}, POST .../{id}/verify, POST .../{id}/set-primary), an admin screen (/admin/tenant/domains), the additive public host resolver (lib/tenant/public-host-tenant-resolver.ts — coexists with ADR-0009 path-based /blog/{tenantCode}, never regresses it), and the OPTIONAL Cloudflare DNS adapter (infrastructure/cloudflare-dns-adapter.ts, env-gated, absent-safe, not wired into any route). PORT DEFERRALS: the host-resolved public content route family is not wired here (same deferral news_portal made for its /news/** routes); src/middleware.ts is untouched. This module never stores a DNS provider API token/credential in the database.",
  dependencies: ["tenant_admin", "identity_access"],
  type: "domain",
  api: {
    openApiPath: "openapi/modules/tenant-domain.openapi.yaml",
    basePath: "/api/v1/tenant/domains"
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_tenant_domains",
      path: "/admin/tenant/domains",
      order: 60,
      requiredPermission: "tenant_domain.domains.read"
    }
  ],
  permissions: [
    {
      activityCode: "domains",
      action: "read",
      description: "Read tenant domain/subdomain mappings"
    },
    {
      activityCode: "domains",
      action: "create",
      description: "Add a tenant domain/subdomain mapping"
    },
    {
      activityCode: "domains",
      action: "update",
      description: "Update a tenant domain/subdomain mapping"
    },
    {
      activityCode: "domains",
      action: "delete",
      description: "Soft delete a tenant domain/subdomain mapping"
    },
    {
      activityCode: "domains",
      action: "verify",
      description: "Verify ownership of a tenant domain/subdomain"
    },
    {
      activityCode: "domains",
      action: "set_primary",
      description: "Set a tenant domain as the active primary domain"
    }
  ],
  settings: {
    schemaVersion: 1,
    // Non-secret operational preference only: the default domain verification
    // mode is manual DNS attestation, never an automatic provider. "manual"
    // means no automated check at all is assumed until a tenant/operator
    // explicitly picks one of the other `verification_method` values. The
    // optional Cloudflare adapter is selected purely via the
    // `TENANT_DOMAIN_DNS_PROVIDER` env var (not this settings object, and not
    // wired into any route yet) — it never defaults this value away from manual.
    defaults: { defaultVerificationMethod: "manual" }
  }
});
