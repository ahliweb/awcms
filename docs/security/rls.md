# Row Level Security (RLS) Policies

## Purpose

Document the RLS helpers and standard policy patterns used in AWCMS.

## Audience

- Database maintainers
- Backend and edge function authors

## Prerequisites

- `docs/security/abac.md`
- `docs/tenancy/overview.md`
- `docs/architecture/database.md`

## Reference

### Core Helper Functions

| Function | Returns | Purpose |
| --- | --- | --- |
| `current_tenant_id()` | UUID | Tenant from `app.current_tenant_id` or user profile |
| `auth_is_admin()` | boolean | **SECURITY DEFINER**: Checks if user is Owner/Super Admin. Bypasses RLS recursion. |
| `is_platform_admin()` | boolean | **Standard**: Checks if user is Owner/Super Admin. Subject to RLS recursion. |
| `has_permission(key)` | boolean | Checks if current user has specific permission key |
| `is_admin_or_above()` | boolean | **DEPRECATED for Logic** - Returns true for Admin/Super/Owner roles. Use `has_permission` instead. |

`current_tenant_id()` reads `app.current_tenant_id`, which is set from the `x-tenant-id` request header by database helpers.

### Table Policy Sources

- `supabase/migrations` contains the canonical SQL definitions.
- `schema_dump.sql` provides a snapshot for review and diffing.

### ⚠️ IMPORTANT: ABAC Policy Pattern (New Standard)

Since AWCMS 2.5+, we enforce **Attribute-Based Access Control (ABAC)**. DO NOT use rigid role checks like `is_admin_or_above()` for tenant-level content. Instead, check for the specific *permission* required for that table.

#### Standard Select Policy (Granular)

```sql
CREATE POLICY "table_select_abac" ON public.table_name
FOR SELECT USING (
  -- 1. Tenant Isolation
  (tenant_id = public.current_tenant_id())
  AND (
     -- 2. Granular Permission Check
     public.has_permission('tenant.module.read')
     OR
     -- 3. Platform Admin Bypass (Use auth_is_admin for recursion safety)
     public.auth_is_admin()
  )
  AND deleted_at IS NULL
);
```

### Insert and Update Pattern

```sql
CREATE POLICY "table_insert_abac" ON public.table_name
FOR INSERT WITH CHECK (
  (tenant_id = public.current_tenant_id() AND public.has_permission('tenant.module.create'))
  OR public.auth_is_admin()
);
```

### Legacy Policy Pattern (Deprecated)

*Avoid using this for new tables unless they are strictly admin-only internal tools.*

```sql
CREATE POLICY "table_select_unified" ON public.table_name
FOR SELECT USING (
  (tenant_id = current_tenant_id() OR is_platform_admin())
  AND deleted_at IS NULL
);
```

## Security and Compliance Notes

- **Granularity**: Policies should match the permissions defined in `PermissionMatrix.jsx`.
- **Isolation**: Every tenant-scoped table must include `tenant_id` and `deleted_at`.
- **Public access**: Public reads must be explicitly scoped to published content (e.g. `is_published = true`).

## References

- `docs/security/abac.md`
- `docs/tenancy/overview.md`
- `docs/architecture/database.md`
