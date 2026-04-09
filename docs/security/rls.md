# Row Level Security (RLS) Policies

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

## Purpose

Document the current RLS helper functions, policy-authoring expectations, recursion-safe patterns, and public/tenant/platform policy rules used in AWCMS.

This guide describes the maintained RLS model as it exists now in the migration baseline and runtime, not an older simplified role-check model.

## Current State

### Current RLS Model

AWCMS uses RLS as a mandatory enforcement layer for tenant isolation and access control.

Current reality:

- tenant-scoped data should resolve against `public.current_tenant_id()`
- ABAC permission checks should use canonical permission keys and helper functions
- recursion-safe admin/permission helpers matter in real policy authoring
- public routes and request-scoped flows may still rely on request header mediated tenant resolution where appropriate
- Worker-side checks are additive and do not replace RLS

### Current Policy Philosophy

New policy authoring should prefer:

- explicit tenant isolation
- explicit soft-delete filtering where applicable
- explicit permission checks
- recursion-safe helper functions
- documented public read/write exceptions only where intended

Avoid older “single helper + broad admin bypass” policy habits unless the table truly is an internal/admin-only surface.

## Current Core Helper Functions

| Function | Returns | Current Role |
| --- | --- | --- |
| `current_tenant_id()` | UUID | Tenant resolver for tenant-scoped RLS paths; supports authenticated user resolution and request-scoped fallback behavior |
| `auth_is_admin()` | boolean | Recursion-safe admin/full-access bypass helper for new policy authoring |
| `has_permission(key)` | boolean | Canonical permission check helper |
| `caller_has_permission(key)` | boolean | Recursion-safe permission helper for policy paths that would otherwise recurse through `public.users` |
| `tenant_can_access_resource(row_tenant, resource_key, action)` | boolean | Hierarchy/resource-sharing helper |
| `is_tenant_descendant(ancestor, descendant)` | boolean | Tenant hierarchy helper |

### Legacy Helpers Still Present

Helpers like `is_platform_admin()` and `is_admin_or_above()` may still exist in older policies, but they should not be treated as the preferred pattern for new policy authoring when the newer recursion-safe/ABAC-aware helpers already fit the table.

## Current Tenant Resolution Behavior In RLS

`current_tenant_id()` currently matters in both authenticated and request-scoped paths.

Important current behavior:

- authenticated requests resolve tenant from the caller’s user record
- request/public-scoped flows may fall back through request-scoped tenant context populated from headers
- this allows certain public or compatibility paths to remain tenant-aware without bypassing the overall RLS model

That does not mean raw tenant headers are universally trusted everywhere. It means the SQL helper is part of the current runtime contract.

## Current Recursion-Safe Policy Pattern

### `public.users` And Similar Sensitive Tables

When a policy path needs to answer permission questions that themselves depend on user/role state, recursion-safe helper functions are required.

Current example pattern:

```sql
CREATE OR REPLACE FUNCTION public.caller_has_permission(p_permission_name text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
set row_security = off
as $$
begin
  return exists (
    select 1
    from public.role_permissions rp
    join public.permissions p on p.id = rp.permission_id
    join public.users u on u.role_id = rp.role_id
    where u.id = auth.uid()
      and u.deleted_at is null
      and p.name = p_permission_name
  );
end;
$$;
```

Use recursion-safe helpers instead of inline self-referential joins when the policy path would recurse through `public.users`.

## Current Standard Policy Patterns

### Tenant-Scoped Read Pattern

```sql
CREATE POLICY table_select_abac ON public.table_name
FOR SELECT USING (
  tenant_id = public.current_tenant_id()
  AND deleted_at IS NULL
  AND (
    public.has_permission('tenant.module.read')
    OR public.auth_is_admin()
  )
);
```

### Tenant-Scoped Insert Pattern

```sql
CREATE POLICY table_insert_abac ON public.table_name
FOR INSERT WITH CHECK (
  (
    tenant_id = public.current_tenant_id()
    AND public.has_permission('tenant.module.create')
  )
  OR public.auth_is_admin()
);
```

### Ownership-Aware Update Pattern

```sql
CREATE POLICY table_update_abac ON public.table_name
FOR UPDATE USING (
  tenant_id = public.current_tenant_id()
  AND deleted_at IS NULL
  AND (
    public.has_permission('tenant.module.update')
    OR (
      public.has_permission('tenant.module.update_own')
      AND owner_id = auth.uid()
    )
    OR public.auth_is_admin()
  )
);
```

### Public Insert Pattern

Use for public write-only telemetry/event capture where the table is intentionally writable by unauthenticated traffic under tenant scope.

```sql
CREATE POLICY analytics_events_public_insert ON public.analytics_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
);
```

### Public Aggregate Read Pattern

```sql
CREATE POLICY analytics_daily_public_read ON public.analytics_daily
FOR SELECT
TO anon, authenticated
USING (
  tenant_id = public.current_tenant_id()
);
```

### Hierarchy-Aware Shared Resource Pattern

```sql
CREATE POLICY table_select_hierarchy ON public.table_name
FOR SELECT USING (
  tenant_id = public.current_tenant_id()
  OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
  OR public.auth_is_admin()
);
```

## Current Policy Authoring Rules

- prefer canonical permission keys from the migration-backed baseline
- prefer `auth_is_admin()` over legacy non-recursion-safe admin helpers for new policy authoring
- include `deleted_at IS NULL` for business-data reads unless the table/view intentionally exposes trash/deleted state
- keep public access explicit and narrow
- do not use role-name checks where permission checks or recursion-safe helpers are the right tool

## Deprecated Or Lower-Value Patterns

Avoid for new policy authoring unless a table is genuinely a narrow internal/admin-only exception:

- role-name-based checks
- `is_admin_or_above()` as the default tenant-content gate
- `is_platform_admin()` as the preferred new helper in recursion-sensitive paths
- broad unified policies that hide the actual permission/resource model

## Performance Guidance

- add indexes for columns used in RLS filters such as `tenant_id`, `user_id`, and hierarchy keys
- scope policies to the correct roles where appropriate (`authenticated`, `anon`)
- keep helper function usage deliberate and recursion-safe

## Security And Compliance Notes

- Every tenant-scoped table should include `tenant_id`.
- Business-data tables should include `deleted_at` where the soft-delete lifecycle applies.
- Public reads should stay explicitly published-only and non-deleted where relevant.
- Plugin/extension routes must still query tenant-scoped tables correctly and rely on ABAC permissions rather than role names.
- If a helper must read `public.users` or similar sensitive tables inside a policy path, evaluate recursion risk first and use `SECURITY DEFINER` plus `row_security = off` only when justified.
- Notification configuration tables and notification dispatch tables do not necessarily share the same tenant write semantics; document the exact table behavior rather than implying one generic rule.

## Migrations And Sources

- `supabase/migrations/` remains the canonical migration source
- keep `awcms/supabase/migrations/` mirrored in parity
- keep non-migration SQL out of migration folders
- commit policy changes as timestamped migrations only

## Validation Guidance

```bash
cd awcms && npm run docs:check
cd awcms-edge && npm test && npm run typecheck
scripts/verify_supabase_migration_consistency.sh
```

Use additional migration/local database validation as required by the specific policy change.

## Related Docs

- [docs/security/abac.md](./abac.md)
- [docs/tenancy/overview.md](../tenancy/overview.md)
- [docs/tenancy/supabase.md](../tenancy/supabase.md)
- [docs/architecture/database.md](../architecture/database.md)
