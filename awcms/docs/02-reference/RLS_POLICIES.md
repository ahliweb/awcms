# Row Level Security (RLS) Policies

## Purpose
Document the RLS helpers and standard policy patterns used in AWCMS.

## Audience
- Database maintainers
- Backend and edge function authors

## Prerequisites
- `awcms/docs/00-core/MULTI_TENANCY.md`
- `awcms/docs/00-core/SOFT_DELETE.md`

## Reference

### Core Helper Functions

| Function | Returns | Purpose |
| --- | --- | --- |
| `current_tenant_id()` | UUID | Tenant from `app.current_tenant_id` or user profile |
| `is_platform_admin()` | boolean | Owner or Super Admin |
| `is_admin_or_above()` | boolean | Admin or higher |
| `is_super_admin()` | boolean | Super Admin or Owner |

`current_tenant_id()` reads `app.current_tenant_id`, which is set from the `x-tenant-id` request header by database helpers.

### Table Policy Sources

- `supabase/migrations` contains the canonical SQL definitions.
- `schema_dump.sql` provides a snapshot for review and diffing.

### Standard Policy Pattern

```sql
CREATE POLICY "table_select_unified" ON public.table_name
FOR SELECT USING (
  (tenant_id = current_tenant_id() OR is_platform_admin())
  AND deleted_at IS NULL
);
```

### Insert and Update Pattern

```sql
CREATE POLICY "table_insert_unified" ON public.table_name
FOR INSERT WITH CHECK (
  (tenant_id = current_tenant_id() AND is_admin_or_above())
  OR is_platform_admin()
);
```

## Security and Compliance Notes

- Every tenant-scoped table must include `tenant_id` and `deleted_at`.
- Public reads must be explicitly scoped to published content.
- Service role keys bypass RLS and must remain server-side only.

## References

- `../00-core/MULTI_TENANCY.md`
- `../00-core/SUPABASE_INTEGRATION.md`
- `../00-core/SOFT_DELETE.md`
