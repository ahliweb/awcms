import { defineModule } from "../_shared/module-contract";

export const profileIdentityModule = defineModule({
  key: "profile_identity",
  name: "Profile Identity",
  version: "1.0.0",
  status: "active",
  description:
    "Canonical person/organization profile lifecycle: CRUD/list/search/soft-delete, typed identifiers (email/phone/national_id/tax_id/...) with normalization/hashing/masking, and cross-module entity links (employee, vendor, customer, tax party, ...).",
  dependencies: ["tenant_admin"],
  api: {
    openApiPath: "openapi/modules/profile-identity.openapi.yaml",
    basePath: "/api/v1/profiles"
  },
  /**
   * `/admin/profiles` existed as a hand-written entry in `AdminLayout.astro`'s
   * static array and was unknown to the registry — so `GET /api/v1/modules`
   * reported this module as having no admin surface while the page shipped.
   * `requiredPermission` is the exact key the page itself gates its read on.
   */
  navigation: [
    {
      labelKey: "admin.layout.nav_profiles",
      path: "/admin/profiles",
      order: 10,
      requiredPermission: "profile_identity.profile_management.read"
    }
  ],
  permissions: [
    {
      activityCode: "profile_management",
      action: "read",
      description: "Read profile records"
    },
    {
      activityCode: "profile_management",
      action: "create",
      description: "Create profile records"
    },
    {
      activityCode: "profile_management",
      action: "update",
      description: "Update profile records"
    },
    {
      activityCode: "profile_management",
      action: "delete",
      description: "Soft delete profile records"
    },
    {
      activityCode: "profile_management",
      action: "restore",
      description: "Restore soft-deleted profile records"
    }
  ]
});
