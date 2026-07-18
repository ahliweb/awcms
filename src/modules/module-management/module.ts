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
    basePath: "/api/v1/modules"
  },
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
  jobs: [
    {
      command: "bun run config:validate",
      purpose:
        "Validate required/conditional environment variables at boot time before anything attempts to connect to a database or run migrations.",
      recommendedSchedule:
        "On-demand — run before every deploy, first stage of any go-live preflight.",
      environmentNotes: "No database connection required.",
      safeInOfflineLan: true
    }
  ]
});
