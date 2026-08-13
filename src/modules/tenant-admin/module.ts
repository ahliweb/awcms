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
  /**
   * ADR-0094 wave 2 (Issue #557) — the tenant's own furniture. Offices and
   * settings are structures, not people; the links are administrator stamps,
   * except for the status transitions, which record who suspended a customer.
   */
  subjectData: [
    {
      key: "tenant_admin.offices",
      tableName: "awcms_offices",
      ownerModuleKey: "tenant_admin",
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" },
        { column: "deleted_by", references: "tenant_user" },
        { column: "restored_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "The office hierarchy, which is org structure rather than anybody's personal data. A subject appears only as the administrator who edited it — and exporting the tree because somebody once renamed a branch would hand over the tenant's shape, not the person's data."
    },
    {
      key: "tenant_admin.tenants",
      tableName: "awcms_tenants",
      ownerModuleKey: "tenant_admin",
      // The tenant table's own tenant column is `id` — it IS the tenant. Named
      // explicitly rather than left to the `tenant_id` default, which would
      // have produced a filter on a column that does not exist.
      tenantColumn: "id",
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "The tenant record itself. `legal_name` belongs to an ORGANISATION; the only person here is the operator who created or last edited the row."
    },
    {
      key: "tenant_admin.tenant_status_transitions",
      tableName: "awcms_tenant_status_transitions",
      ownerModuleKey: "tenant_admin",
      subjectColumns: [
        { column: "actor_tenant_user_id", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "severed_with_subject_row",
      rationale:
        "ADR-0073 — who suspended or restored a tenant, and why. An act with consequences for every user of that tenant, so it is answerable as the actor's own history and must survive their erasure as evidence."
    },
    {
      key: "tenant_admin.tenant_settings",
      tableName: "awcms_tenant_settings",
      ownerModuleKey: "tenant_admin",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "One row of timezone and feature flags per tenant, with no author column at all. Configuration about the tenant, naming nobody and matchable to nobody."
    },
    {
      key: "tenant_admin.setup_state",
      tableName: "awcms_setup_state",
      ownerModuleKey: "tenant_admin",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "A one-row latch recording that the setup wizard has run. It holds a lock timestamp and nothing else; erasing it would re-open first-run bootstrap on a live tenant."
    }
  ],
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
    },
    {
      activityCode: "tenant_lifecycle",
      action: "disable",
      scope: "platform",
      description:
        "Suspend a tenant: stop serving it, and refuse its live sessions and machine credentials from their next request (ADR-0073)"
    },
    {
      activityCode: "tenant_lifecycle",
      action: "restore",
      scope: "platform",
      description:
        "Lift a tenant suspension and resume service (ADR-0073). Separate from `disable` on purpose: during an incident you want someone who can bring a customer back without being able to cut one off"
    }
  ]
});
