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
  ],
  /**
   * ADR-0094 wave 2 (Issue #557) — the person's own record, and the one place a
   * subject request reaches by a THIRD id.
   *
   * Nothing on `awcms_profiles` carries a tenant-user or identity id: the link
   * runs the other way, from `awcms_identities.profile_id`. That is why
   * `SubjectDataColumn.references` grew a `"profile"` member rather than these
   * two tables naming a column they do not have.
   */
  subjectData: [
    {
      key: "profile_identity.profiles",
      tableName: "awcms_profiles",
      ownerModuleKey: "profile_identity",
      subjectColumns: [
        { column: "id", references: "profile" },
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" },
        { column: "deleted_by", references: "tenant_user" },
        { column: "restored_by", references: "tenant_user" }
      ],
      exportable: true,
      // NOT severed with the identity row, and this is the table that shows why
      // that distinction earns its name: `display_name`, `legal_name` and
      // `risk_level` are COPIES of personal detail living here. Anonymising
      // `awcms_identities` makes the login address unresolvable and leaves
      // every one of them standing.
      erasure: "anonymize",
      rationale:
        "The person themselves: the name they are known by, the legal name behind it, and the verification and risk assessments this tenant made ABOUT them. An assessment somebody else recorded about a person is exactly what a subject-access request is for, and there is no other table it can be read from."
    },
    {
      key: "profile_identity.profile_identifiers",
      tableName: "awcms_profile_identifiers",
      ownerModuleKey: "profile_identity",
      subjectColumns: [
        { column: "profile_id", references: "profile" },
        { column: "deleted_by", references: "tenant_user" },
        { column: "restored_by", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "anonymize",
      rationale:
        "Every email address, phone number and national identifier held for this person. The most sensitive rows in the schema and the ones a subject most needs to see; `normalized_value` is the identifier in the clear, so the export carries the MASKED form only.",
      // `normalized_value` is the plaintext identifier and `value_hash` is the
      // lookup key derived from it — handing back either would turn a subject's
      // own export into a re-identification oracle for the hashing scheme every
      // other row in this table uses.
      redactedColumns: ["normalized_value", "value_hash"]
    },
    {
      key: "profile_identity.profile_entity_links",
      tableName: "awcms_profile_entity_links",
      ownerModuleKey: "profile_identity",
      subjectColumns: [{ column: "profile_id", references: "profile" }],
      exportable: true,
      erasure: "hard_delete",
      rationale:
        "Which business records in other modules point at this person, and in what role. The row is nothing but the association itself, so it exports as the map a subject needs and is removed outright when the association must end."
    }
  ]
});
