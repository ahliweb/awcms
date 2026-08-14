import { defineModule } from "../_shared/module-contract";

export const moduleManagementModule = defineModule({
  key: "module_management",
  name: "Module Management",
  version: "0.1.0",
  status: "active",
  description:
    "Database-backed, tenant-aware module registry: syncs trusted code descriptors (`listModules()`) into the database, tracks per-tenant module enablement, dependency validation, non-secret settings, permission sync/status, admin navigation, job/command registry, and health/readiness. Generic infrastructure for managing every other registered module — not a domain-specific feature.",
  dependencies: ["tenant_admin", "identity_access"],
  type: "system",
  isCore: true,
  api: {
    openApiPath: "openapi/modules/module-management.openapi.yaml",
    basePath: "/api/v1/modules",
    // `/api/v1/tenant` is SPLIT: `/modules` here, `/domains` in `tenant_domain`.
    // Longest-prefix resolution handles that without a special case.
    routes: [
      "/api/v1/modules",
      "/api/v1/tenant/modules",
      "/api/v1/tenant/navigation"
    ]
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_modules",
      path: "/admin/modules",
      order: 31,
      requiredPermission: "module_management.tenant_modules.read"
    },
    {
      // The sidebar editor is itself a sidebar entry — it has to be, because
      // `tests/admin-navigation-registry.test.ts` requires every admin page to
      // be claimed by exactly one descriptor. Gated on `navigation.read`, so an
      // operator who cannot see the configuration cannot see the link to it
      // either.
      labelKey: "admin.layout.nav_sidebar_menu",
      path: "/admin/sidebar-menu",
      order: 33,
      requiredPermission: "module_management.navigation.read"
    }
  ],
  permissions: [
    {
      activityCode: "modules",
      action: "read",
      description: "Read the module registry"
    },
    {
      activityCode: "modules",
      action: "sync",
      description: "Sync trusted code descriptors into the database registry"
    },
    {
      activityCode: "tenant_modules",
      action: "read",
      description: "Read tenant module enablement state"
    },
    {
      activityCode: "tenant_modules",
      action: "enable",
      description: "Enable a module for a tenant"
    },
    {
      activityCode: "tenant_modules",
      action: "disable",
      description: "Disable a module for a tenant"
    },
    {
      activityCode: "settings",
      action: "read",
      description: "Read effective tenant module settings"
    },
    {
      activityCode: "settings",
      action: "update",
      description: "Update tenant module settings"
    },
    {
      activityCode: "permissions",
      action: "read",
      description: "Read module permission sync/status"
    },
    {
      activityCode: "navigation",
      action: "read",
      description: "Read the module admin navigation registry"
    },
    {
      activityCode: "navigation",
      action: "configure",
      description:
        "Configure this tenant's admin sidebar arrangement (reorder, hide, relabel, move between sections) — the item set itself stays code-derived and is never tenant-writable"
    },
    {
      activityCode: "jobs",
      action: "read",
      description: "Read the module job/command registry"
    },
    {
      activityCode: "health",
      action: "read",
      description: "Read module health/readiness status"
    },
    {
      activityCode: "health",
      action: "check",
      description: "Trigger a module health check"
    }
  ],
  /**
   * ADR-0094 wave 2 (Issue #557) — the registry describes MODULES. Six of these
   * nine tables are synchronised from code on every boot and name nobody at
   * all; the three that reach a person do so through an operator stamp.
   */
  subjectData: [
    {
      key: "module_management.tenant_modules",
      tableName: "awcms_tenant_modules",
      ownerModuleKey: "module_management",
      subjectColumns: [
        { column: "enabled_by", references: "tenant_user" },
        { column: "disabled_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Which modules a tenant has turned on, and who turned them on or off. A capability decision about the tenant; the person is the operator who made it."
    },
    {
      key: "module_management.module_settings",
      tableName: "awcms_module_settings",
      ownerModuleKey: "module_management",
      subjectColumns: [{ column: "updated_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Per-tenant module setting overrides. Configuration values belonging to the tenant, stamped with who last edited them."
    },
    {
      key: "module_management.modules",
      tableName: "awcms_modules",
      ownerModuleKey: "module_management",
      // GLOBAL: the registry is synchronised from `listModules()` and shared by
      // every tenant in the deployment, so there is no `tenant_id` to filter on.
      tenantColumn: null,
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "The installed-module catalogue, synchronised from `listModules()` on boot. Every row is a fact about the build; no column has ever held a person."
    },
    {
      key: "module_management.module_navigation",
      tableName: "awcms_module_navigation",
      ownerModuleKey: "module_management",
      tenantColumn: null,
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Sidebar entries declared by each module and re-synchronised from code. Derived registry data with no author and no subject."
    },
    {
      key: "module_management.module_jobs",
      tableName: "awcms_module_jobs",
      ownerModuleKey: "module_management",
      tenantColumn: null,
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Scheduled-job declarations mirrored from each module's descriptor. A catalogue of commands, naming nobody."
    },
    {
      key: "module_management.module_health_checks",
      tableName: "awcms_module_health_checks",
      ownerModuleKey: "module_management",
      tenantColumn: null,
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "The latest health probe per module. Machine status with a timestamp and a message about a module, not about a person."
    },
    {
      key: "module_management.module_dependencies",
      tableName: "awcms_module_dependencies",
      ownerModuleKey: "module_management",
      tenantColumn: null,
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "The module dependency graph, derived from code. Two module keys per row and nothing else."
    },
    {
      key: "module_management.sidebar_menu_types",
      tableName: "awcms_sidebar_menu_types",
      ownerModuleKey: "module_management",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Per-tenant sidebar grouping overrides — a label and a position. Tenant-wide presentation with no per-user personalisation and no author column."
    },
    {
      key: "module_management.sidebar_menu_items",
      tableName: "awcms_sidebar_menu_items",
      ownerModuleKey: "module_management",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Per-tenant sidebar entry overrides. Held on the same terms as the types above: tenant-wide, not per person."
    }
  ],
  jobs: [
    {
      command: "bun run config:validate",
      schedule: {
        mode: "manual",
        because:
          "A deploy gate, not a background task: it runs as the first stage of a deployment and its whole value is failing BEFORE the app starts."
      },
      purpose:
        "Validate required/conditional environment variables at boot time before anything attempts to connect to a database or run migrations.",
      recommendedSchedule:
        "On-demand — run before every deploy, first stage of any go-live preflight.",
      environmentNotes: "No database connection required.",
      safeInOfflineLan: true
    }
  ]
});
