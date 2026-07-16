# Module Management

Database-backed, tenant-aware module registry. Generic infrastructure for
managing every other registered module — not a domain-specific feature.
Ported and adapted from the awcms-mini module-management module.

## What it does

- **Descriptor sync** (`application/descriptor-sync.ts`) — reads the trusted,
  in-process code registry (`listModules()`, `src/modules/index.ts`) and
  upserts it into the database registry (`awcms_modules` +
  `awcms_module_dependencies`/`_navigation`/`_jobs`, migration 008). Naturally
  idempotent. Refuses to write when the registry fails dependency-graph
  validation (`_shared/module-dependency-graph.ts`).
- **Module catalog** (`application/module-catalog.ts`) — merges each
  descriptor's always-current static metadata with the DB's tracked lifecycle
  state. `GET /api/v1/modules`, `GET /api/v1/modules/{moduleKey}`.
- **Tenant module lifecycle** (`application/tenant-module-lifecycle.ts`) —
  per-tenant enable/disable, dependency-validated. A missing
  `awcms_tenant_modules` row means "enabled by default" (backward-compatible).
  `isCore` modules cannot be disabled (prevents admin lockout). Writes only
  `awcms_tenant_modules`, never unloads code.
- **Module settings** (`application/module-settings.ts`) — tenant-aware,
  **non-secret** operational preferences. `PATCH` shallow-merges. Secret-shaped
  keys and secret-shaped values are rejected at request time (never stored),
  reusing `_shared/redaction.ts`'s `findSensitiveKeys`/`findSecretShapedValues`.
- **Permission sync/status** (`application/permission-sync.ts`) — read-only
  report of `synced`/`missing`/`orphaned`/`mismatched_description` against
  `awcms_permissions`. Never writes to the catalog.
- **Navigation registry** (`application/navigation-registry.ts`) — filters
  module-declared nav entries by module status, tenant enablement, and
  required permission. Navigation filtering is **not** authorization.
- **Job registry** (`application/job-registry.ts`) — documentation-only
  metadata about each module's operational commands. Never an execution
  surface.
- **Health/readiness** (`application/health-registry.ts`) — cheap, bounded
  signals (registry synced, migrations applied, permissions synced, settings
  valid, jobs documented, OpenAPI/AsyncAPI documented). `GET .../health` is a
  passive read; `POST .../health/check` records history and runs any live
  provider check (none in this base yet).

## "Sync first"

`awcms_tenant_modules`, `awcms_module_settings`, and
`awcms_module_health_checks` all have a foreign key to
`awcms_modules.module_key`. Registering a module in `src/modules/index.ts` does
**not** automatically create its registry row. Every tenant-scoped mutation
that needs the registry row to exist (`enableTenantModule`,
`disableTenantModule`, `updateModuleSettings`, `runModuleHealthCheck`) calls
`syncModuleDescriptors(tx)` itself first — do not assume an operator ran
`POST /api/v1/modules/sync` beforehand.

## API surface

| Method + Path                                     | Permission                          |
| ------------------------------------------------- | ----------------------------------- |
| `GET /api/v1/modules`                             | `module_management.modules.read`    |
| `GET /api/v1/modules/{moduleKey}`                 | `module_management.modules.read`    |
| `POST /api/v1/modules/sync`                       | `module_management.modules.sync`    |
| `GET /api/v1/modules/{moduleKey}/health`          | `module_management.health.read`     |
| `POST /api/v1/modules/{moduleKey}/health/check`   | `module_management.health.check`    |
| `GET /api/v1/modules/{moduleKey}/jobs`            | `module_management.jobs.read`       |
| `GET /api/v1/modules/{moduleKey}/permissions`     | `module_management.permissions.read`|
| `GET /api/v1/tenant/modules`                      | `module_management.tenant_modules.read`   |
| `POST /api/v1/tenant/modules/{moduleKey}/enable`  | `module_management.tenant_modules.enable`  |
| `POST /api/v1/tenant/modules/{moduleKey}/disable` | `module_management.tenant_modules.disable` |
| `GET /api/v1/tenant/modules/{moduleKey}/settings` | `module_management.settings.read`   |
| `PATCH /api/v1/tenant/modules/{moduleKey}/settings` | `module_management.settings.update` |
| `GET /api/v1/access/modules`                      | `identity_access.access_control.read` |

All high-risk mutations (sync, enable, disable, settings update, health check)
write an audit event to `awcms_audit_events` with
`module_key = 'module_management'`.

## Adapted for this base

Relative to the awcms-mini source, the following are intentionally **not**
ported (they depend on toolchain/UI that does not exist in this foundation
repo): build-time module composition (`modules:compose:check`), the derived
application compatibility manifest (`extension:check`), tenant module presets,
the tenant-module matrix, module audit summary (admin UI), and the live email
provider health check. The core registry, lifecycle, settings, permission
sync, navigation, jobs, and health services are all present.
