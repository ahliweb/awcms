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
    "Tenant domain/subdomain mapping for host-based public routing (ported from awcms-micro epic #555). Ships the awcms_tenant_domains schema (migration 046: hostname/normalized_hostname, domain_type subdomain|custom_domain, route_mode canonical|legacy_blog, status pending_verification|active|suspended|failed, verification_method dns_txt (ADR-0106 — the schema CHECK still accepts dns_cname|file|manual, which this application no longer writes or honours), is_primary/redirect_to_primary, tenant-scoped RLS with FORCE), its permission catalog seed (migration 047: tenant_domain.domains.{read,create,update,delete,verify,set_primary}), the SECURITY DEFINER bootstrap host-lookup function (migration 048, EXECUTE restricted to awcms_app), the authenticated tenant-scoped management API (GET/POST /api/v1/tenant/domains, GET/PATCH/DELETE .../{id}, POST .../{id}/verify — a real DNS TXT ownership check against a server-minted challenge, ADR-0106 — POST .../{id}/set-primary), an admin screen (/admin/tenant/domains), the additive public host resolver (lib/tenant/public-host-tenant-resolver.ts — coexists with ADR-0009 path-based /blog/{tenantCode}, never regresses it), and the OPTIONAL Cloudflare DNS adapter (infrastructure/cloudflare-dns-adapter.ts, env-gated, absent-safe, not wired into any route). The host-resolved public content route family is NOT owned here — it landed in blog_content as /news/** (ADR-0059), and this module's public host resolver is what it resolves tenants with; src/middleware.ts is untouched by this module. This module never stores a DNS provider API token/credential in the database.",
  dependencies: ["tenant_admin", "identity_access"],
  // ADR-0084, Gelombang 5 PR 5.4 — the first REAL entitlement attachment in this
  // base, and the module chosen for it deliberately.
  //
  // A custom domain is the archetypal plan-tier feature, and this module is the
  // cleanest attachment mechanically: nothing depends on it, and its whole
  // GUARDED surface is domain MANAGEMENT. Host resolution for a domain already
  // configured is a public read path that never reaches `authorizeInTransaction`,
  // so an unentitled tenant keeps being served at the domains it already has —
  // only adding and changing them is refused. Losing the ability to add a domain
  // is a plan wall; losing the domain you already have would be an outage, and
  // this attachment cannot cause one.
  //
  // `site_search` and `comments` were rejected for the opposite reason: both
  // carry PUBLIC unauthenticated surfaces that bypass the chokepoint, so an
  // entitlement on either would be enforced on half the module and silently
  // ignored on the other half.
  //
  // This denies NOBODY as shipped: `sql/111` puts `custom_domain` in the DEFAULT
  // plan, and a tenant with no subscription row is treated as being on that plan
  // (the `awcms_tenant_modules` convention). What the attachment buys is that
  // the branch now EXECUTES against real rows instead of never executing at all.
  requiresEntitlement: "custom_domain",
  type: "domain",
  api: {
    openApiPath: "openapi/modules/tenant-domain.openapi.yaml",
    basePath: "/api/v1/tenant/domains"
  },
  jobs: [
    {
      command: "bun run tenant-domain:dns:sync",
      schedule: {
        mode: "cron",
        expression: "*/15 * * * *",
        backlog: "bounded"
      },
      purpose:
        "Reconciles pending/active domain rows against the configured DNS provider so a verification record that was created but never propagated does not leave a tenant stuck at pending_verification forever. Read-only against the provider unless TENANT_DOMAIN_DNS_PROVIDER names a real adapter; with the default 'manual' it makes no outbound call at all.",
      recommendedSchedule: "Every 15 minutes via cron/systemd timer.",
      environmentNotes:
        "Reaches an external DNS provider ONLY when TENANT_DOMAIN_DNS_PROVIDER=cloudflare (plus TENANT_DOMAIN_CLOUDFLARE_*). Default 'manual' keeps it purely local.",
      safeInOfflineLan: true
    }
  ],
  /**
   * ADR-0094 wave 2 (Issue #557) — a hostname belongs to the tenant, not to
   * whoever configured it.
   */
  subjectData: [
    {
      key: "tenant_domain.tenant_domains",
      tableName: "awcms_tenant_domains",
      ownerModuleKey: "tenant_domain",
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" },
        { column: "deleted_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Custom hostnames and their DNS verification state. The domain is the tenant's property and the verification token is a deployment secret; a person appears only as the administrator who added or removed one.",
      redactedColumns: ["verification_token_hash"]
    }
  ],
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
  ]
  // NO `settings` BLOCK, and its absence is the decision — finding D7.
  //
  // This declared `defaults: { defaultVerificationMethod: "manual" }`, and
  // NOTHING read it, so every domain was created with
  // `verification_method = NULL`. The repair that suggested itself — apply the
  // default at creation — was the one that had to be refused, because at the
  // time `verifyTenantDomain` performed no verification of any kind: it checked
  // the column was non-NULL and set `status = 'active'`. A NULL was the only
  // thing standing between "a tenant created a hostname row" and "that hostname
  // is active" in host->tenant resolution.
  //
  // ADR-0106 removed the reason rather than the symptom. `verify` now resolves
  // a server-minted TXT challenge in the claimed zone, and
  // `verification_method` is written by the server at creation — so there is
  // no preference left for a setting to express, and no NULL left doing a
  // security control's job by accident. The block stays deleted on the original
  // ground: a value in the descriptor that nothing reads is a claim about
  // behaviour, and this module makes none.
});
