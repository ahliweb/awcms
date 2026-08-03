import { defineModule } from "../_shared/module-contract";

export const tenantAdminModule = defineModule({
  key: "tenant_admin",
  name: "Tenant Admin",
  version: "1.0.0",
  status: "active",
  description:
    "Tenant root entity, office hierarchy, tenant settings, and the one-time setup wizard that bootstraps the first tenant, owner, office, role, and access assignment.",
  dependencies: [],
  // ADR-0060: this module owns `awcms_offices`, the only real hierarchy the
  // base has, so it provides the `business_scope_hierarchy` adapter that
  // `identity_access` consumes (optionally) for scope resolution. A `provides`
  // is a SOURCE-level relationship, not a lifecycle edge — `identity_access`
  // receives the adapter as an injected parameter at composition roots and
  // never imports this module.
  capabilities: {
    provides: ["business_scope_hierarchy"]
  },
  api: {
    openApiPath: "openapi/modules/tenant-admin.openapi.yaml",
    // `basePath` stays the primary display prefix; `routes` is what actually
    // claims ownership. This descriptor used to say `basePath: "/api/v1"`,
    // which is a prefix of EVERY route in the application — see
    // `ModuleApiContract.routes` for the 36 routes that swallowed.
    basePath: "/api/v1/offices",
    routes: [
      "/api/v1/offices",
      "/api/v1/settings",
      "/api/v1/setup",
      "/api/v1/tenants"
    ]
  },
  navigation: [
    // PLATFORM-scoped (ADR-0054). The link is gated on the platform permission
    // itself — ADR-0051 §Keputusan butir 3 — because unlike `/admin/idn-regions`
    // there is no tenant-readable half of this screen: the directory lists every
    // tenant, so an ordinary tenant has nothing here to see.
    {
      labelKey: "admin.layout.nav_tenants",
      path: "/admin/tenants",
      order: 29,
      requiredPermission: "tenant_admin.tenant_provisioning.read"
    },
    {
      labelKey: "admin.layout.nav_offices",
      path: "/admin/offices",
      order: 30,
      requiredPermission: "tenant_admin.office_management.read"
    }
  ],
  permissions: [
    {
      activityCode: "office_management",
      action: "read",
      description: "Read office records"
    },
    {
      activityCode: "office_management",
      action: "create",
      description: "Create office records"
    },
    {
      activityCode: "office_management",
      action: "update",
      description: "Update office records"
    },
    {
      activityCode: "office_management",
      action: "delete",
      description: "Soft-delete office records"
    },
    // PLATFORM-scoped (ADR-0053/ADR-0054). Creating a tenant is not an action a
    // tenant takes on its own data — it adds a party to the deployment — so it
    // is excluded from the catalogue every tenant owner receives, and the
    // chokepoint refuses it unless the acting tenant is the platform tenant.
    //
    // `read` is here for the same reason: the tenant DIRECTORY lists every
    // tenant on the deployment. A tenant-scoped `read` would let any owner
    // enumerate the platform's customer list.
    {
      activityCode: "tenant_provisioning",
      action: "read",
      scope: "platform",
      description: "PLATFORM: list every tenant on the deployment"
    },
    {
      activityCode: "tenant_provisioning",
      action: "create",
      scope: "platform",
      description: "PLATFORM: provision a new tenant with its owner account"
    },
    {
      activityCode: "tenant_settings",
      action: "read",
      description: "Read tenant settings"
    },
    {
      activityCode: "tenant_settings",
      action: "update",
      description: "Update tenant settings"
    }
  ]
});
