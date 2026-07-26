import { defineModule } from "../_shared/module-contract";

export const tenantAdminModule = defineModule({
  key: "tenant_admin",
  name: "Tenant Admin",
  version: "1.0.0",
  status: "active",
  description:
    "Tenant root entity, office hierarchy, tenant settings, and the one-time setup wizard that bootstraps the first tenant, owner, office, role, and access assignment.",
  dependencies: [],
  api: {
    openApiPath: "openapi/modules/tenant-admin.openapi.yaml",
    // `basePath` stays the primary display prefix; `routes` is what actually
    // claims ownership. This descriptor used to say `basePath: "/api/v1"`,
    // which is a prefix of EVERY route in the application — see
    // `ModuleApiContract.routes` for the 36 routes that swallowed.
    basePath: "/api/v1/offices",
    routes: ["/api/v1/offices", "/api/v1/settings", "/api/v1/setup"]
  },
  navigation: [
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
