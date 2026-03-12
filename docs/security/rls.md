# Row Level Security (RLS) Policies

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.1 - Multi-Tenancy & Isolation (RLS)

## Purpose

Document the RLS helpers and standard policy patterns used in AWCMS.

## Audience

- Database maintainers
- Backend and edge-runtime authors

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for RLS mandates
- [AGENTS.md](../../AGENTS.md) - RLS implementation patterns
- [docs/security/abac.md](./abac.md) - ABAC permission system
- [docs/tenancy/overview.md](../tenancy/overview.md) - Tenant context
- [docs/architecture/database.md](../architecture/database.md) - Database schema

## Reference

### Core Helper Functions

| Function | Returns | Purpose |
| --- | --- | --- |
| `current_tenant_id()` | UUID | Tenant from the authenticated `public.users` row, with `app.current_tenant_id` fallback for unauthenticated/request-scoped flows |
| `auth_is_admin()` | boolean | **SECURITY DEFINER**: Checks tenant-admin, platform-admin, or full-access flags for recursion-safe administrative bypass |
| `is_platform_admin()` | boolean | **Standard**: Checks platform admin/full-access flags. Subject to RLS recursion. |
| `has_permission(key)` | boolean | Checks if current user has specific permission key |
| `is_admin_or_above()` | boolean | Legacy helper still used in existing policies; prefer `has_permission` for new policy authoring. |
| `is_tenant_descendant(ancestor, descendant)` | boolean | Checks tenant hierarchy membership (descendant path). |
| `tenant_can_access_resource(row_tenant, resource_key, action)` | boolean | Enforces shared vs isolated resource access across tenant levels. |

`current_tenant_id()` is currently defined with `SECURITY DEFINER` and `row_security = off`
to avoid recursion against `public.users`.
For authenticated requests it resolves the tenant from `public.users.tenant_id`.
For public/request-scoped flows it falls back to `app.current_tenant_id`, which is populated
from the `x-tenant-id` request header.

### Table Policy Sources

- `supabase/migrations` contains the canonical SQL definitions.
- Use `npx supabase migration list --local` before local migration ops.
- Use `npx supabase db pull --schema public,extensions` only when syncing linked/remote schema snapshots.
- Keep non-migration SQL in `supabase/manual/` (not in migration directories).

### Helper Function Source Snapshot

- `public.current_tenant_id()` -> `supabase/migrations/20260307070000_fix_users_rls_recursion.sql`
- `public.auth_is_admin()` -> `supabase/migrations/20260119230212_remote_schema.sql`
- `public.has_permission()` -> `supabase/migrations/20260119230212_remote_schema.sql`
- Hierarchy access helpers (`tenant_can_access_resource`, `is_tenant_descendant`) -> `supabase/migrations/20260127160000_tenant_hierarchy_resource_sharing.sql`

### Migration History Drift

Use the helper script for safe repair planning/execution:

```bash
scripts/repair_supabase_migration_history.sh
scripts/repair_supabase_migration_history.sh --apply --local
scripts/repair_supabase_migration_history.sh --apply --linked
```

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

### Public Insert Pattern (Analytics/Event Logging)

Use this for public, write-only telemetry like visitor analytics. Only insert is allowed, and the tenant is resolved from `x-tenant-id`.

```sql
CREATE POLICY "analytics_events_public_insert" ON public.analytics_events
FOR INSERT
TO anon, authenticated
WITH CHECK (tenant_id = public.current_tenant_id());
```

### Public Aggregate Read Pattern

Aggregates (e.g., `analytics_daily`) may allow read-only access scoped to a tenant.

```sql
CREATE POLICY "analytics_daily_public_read" ON public.analytics_daily
FOR SELECT
TO anon, authenticated
USING (tenant_id = public.current_tenant_id());
```

### Shared Resource Pattern (Hierarchy-Aware)

```sql
CREATE POLICY "table_select_hierarchy" ON public.table_name
FOR SELECT USING (
  tenant_id = public.current_tenant_id()
  OR public.tenant_can_access_resource(tenant_id, 'content', 'read')
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

### Performance Tips (Context7)

- Use `(select auth.uid())` in policies to avoid recomputing per-row.
- Add indexes for columns used in RLS filters (`tenant_id`, `user_id`, `region_id`).
- Always scope policies to roles with `TO authenticated` or `TO anon` to avoid overly broad access.

## Security and Compliance Notes

- **Granularity**: Policies should match the permissions defined in `PermissionMatrix.jsx`.
- **Isolation**: Every tenant-scoped table must include `tenant_id` and `deleted_at`.
- **Public access**: Public reads must be explicitly scoped to published content (for example `status = 'published'` and `deleted_at IS NULL`).
- **Plugins**: Extension/Plugin routes must query tenant-scoped tables with `tenant_id = current_tenant_id()` and rely on ABAC permissions (no role-name checks).
- **Public portal headers**: Ensure `x-tenant-id` is set by scoped Supabase clients (static builds) or middleware (SSR) so `current_tenant_id()` resolves correctly.
- **Recursion safety**: If a helper must query `public.users` or `public.roles` inside a policy path, keep it `SECURITY DEFINER` and explicitly evaluate whether `row_security = off` is required to avoid self-referential policy loops.
- **Migration files**: RLS policy SQL must be committed as timestamped migrations only.

## References

- `docs/security/abac.md`
- `docs/tenancy/overview.md`
- `docs/architecture/database.md`
