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
    basePath: "/api/v1"
  },
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
