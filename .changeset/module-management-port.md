---
"awcms": minor
---

Add the module-management module: a database-backed, tenant-aware module
registry ported from awcms-mini. Provides descriptor sync into the DB
registry, per-tenant module enable/disable with dependency validation,
non-secret module settings (secret-shaped key/value rejection), read-only
permission sync/status, an admin navigation registry, a documentation-only
job/command registry, and passive/explicit module health-readiness signals.

- New migration `008_awcms_module_management_schema.sql`: extends
  `awcms_modules` and adds `awcms_tenant_modules`, `awcms_module_dependencies`,
  `awcms_module_settings`, `awcms_module_navigation`, `awcms_module_jobs`, and
  `awcms_module_health_checks`, plus the `module_management` permission catalog.
  Tenant-scoped tables have RLS tenant-isolation policies.
- New REST endpoints under `/api/v1/modules`, `/api/v1/tenant/modules`, and
  `/api/v1/access/modules`, all guarded by default-deny ABAC and audited.
- Extends `_shared/redaction.ts` with `findSensitiveKeys` and
  `findSecretShapedValues` for module settings validation.
