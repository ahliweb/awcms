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

## Module-registry composition (Issue #178, ADR-0025; ADR-0034 §3)

Distinct from the tenant lifecycle above: **which modules exist in the code**
is determined at build/compile time, not at runtime and never from tenant
input. ADR-0034 §3 removed the derived-application pathway — the composition
engine now validates the reviewed **base** registry (the same shape a new
domain module added directly to `src/modules/` produces).

- **`domain/module-composition.ts`** — the pure validation engine.
  `composeModuleRegistry(registry)` / `validateComposedModuleRegistry(registry)`
  reject: duplicate module key, missing/cyclic dependency (reuses
  `_shared/module-dependency-graph.ts`), capability provider conflict/missing
  (`ModuleCapabilityContract`), deployment-profile incompatibility, navigation
  path conflict, and invalid job descriptor (reuses `domain/job-registry.ts`).
  It lives here — not `_shared/` — so both reused validators are imported
  cleanly (DAG down from `_shared/`, job-registry as a sibling); see the file
  header and ADR-0025 for the placement rationale.
- **`buildComposedModuleInventory()`** — a deterministic, sorted-by-key,
  timestamp-free snapshot for CI/release evidence
  (`docs/awcms/module-composition-inventory.json`).
- **Gates** (all in `bun run check` + CI): `modules:compose:check`,
  `modules:composition:inventory:generate`/`:check`.
- Fixture: `tests/fixtures/example-domain-modules/` (a test-support example
  domain module), exercised by `tests/module-composition-fixture.test.ts`.

## API surface

| Method + Path                                       | Permission                                 |
| --------------------------------------------------- | ------------------------------------------ |
| `GET /api/v1/modules`                               | `module_management.modules.read`           |
| `GET /api/v1/modules/{moduleKey}`                   | `module_management.modules.read`           |
| `POST /api/v1/modules/sync`                         | `module_management.modules.sync`           |
| `GET /api/v1/modules/{moduleKey}/health`            | `module_management.health.read`            |
| `POST /api/v1/modules/{moduleKey}/health/check`     | `module_management.health.check`           |
| `GET /api/v1/modules/{moduleKey}/jobs`              | `module_management.jobs.read`              |
| `GET /api/v1/modules/{moduleKey}/permissions`       | `module_management.permissions.read`       |
| `GET /api/v1/tenant/modules`                        | `module_management.tenant_modules.read`    |
| `POST /api/v1/tenant/modules/{moduleKey}/enable`    | `module_management.tenant_modules.enable`  |
| `POST /api/v1/tenant/modules/{moduleKey}/disable`   | `module_management.tenant_modules.disable` |
| `GET /api/v1/tenant/modules/{moduleKey}/settings`   | `module_management.settings.read`          |
| `PATCH /api/v1/tenant/modules/{moduleKey}/settings` | `module_management.settings.update`        |
| `GET /api/v1/access/modules`                        | `identity_access.access_control.read`      |

All high-risk mutations (sync, enable, disable, settings update, health check)
write an audit event to `awcms_audit_events` with
`module_key = 'module_management'`.

## Adapted for this base

Relative to the awcms-mini source, module-registry composition IS present
(Issue #178 — `modules:compose:check`, `modules:composition:inventory:*`; see
the section above). ADR-0034 §3 removed the derived-application pathway (the
`application-registry.ts` seam, migration namespace 900-999, and the
`extension:check` gate) — awcms is a template used directly, so those no longer
exist. The following remain intentionally **not** ported (they depend on
toolchain/UI that does not exist in this repo, or are scheduled separately):
tenant module presets, the tenant-module matrix, module audit summary (admin
UI), and the live email provider health check. The core registry, lifecycle,
settings, permission sync, navigation, jobs, health, and composition services
are all present.
