# Row Level Security (RLS) Policies

This document describes the RLS policies implemented in AWCMS for data isolation and access control.

---

## Overview

Row Level Security (RLS) is PostgreSQL's mechanism for restricting row-level access. Every table in AWCMS has RLS enabled with tenant isolation policies.

> [!IMPORTANT]
> **The Golden Rule**: Every table must have `tenant_id` column and RLS enabled.

---

## Helper Functions

These functions are used in RLS policies:

| Function | Returns | Description |
|----------|---------|-------------|
| `auth.uid()` | UUID | Current authenticated user ID |
| `current_tenant_id()` | UUID | User's tenant from JWT or profile |
| `is_platform_admin()` | BOOLEAN | Is Owner or Super Admin |
| `is_admin_or_above()` | BOOLEAN | Is Admin, Super Admin, or Owner |
| `is_super_admin()` | BOOLEAN | Is Super Admin or Owner |

### Implementation

```sql
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN COALESCE(
    (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid,
    (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '';
```

---

## Standard Policies

### Tenant Isolation Pattern

Most tables use this standard pattern:

```sql
-- SELECT: User can read within their tenant
CREATE POLICY "table_select_unified" ON public.table_name
  FOR SELECT USING (
    tenant_id = current_tenant_id() 
    OR is_platform_admin()
  );

-- INSERT: Admin+ can create within tenant
CREATE POLICY "table_insert_unified" ON public.table_name
  FOR INSERT WITH CHECK (
    (tenant_id = current_tenant_id() AND is_admin_or_above())
    OR is_platform_admin()
  );

-- UPDATE: Admin+ can modify within tenant
CREATE POLICY "table_update_unified" ON public.table_name
  FOR UPDATE USING (
    (tenant_id = current_tenant_id() AND is_admin_or_above())
    OR is_platform_admin()
  );

-- DELETE: Admin+ can delete within tenant
CREATE POLICY "table_delete_unified" ON public.table_name
  FOR DELETE USING (
    (tenant_id = current_tenant_id() AND is_admin_or_above())
    OR is_platform_admin()
  );
```

---

## Policy Reference by Table

### Content Tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `articles` | Tenant + Public (published) | Admin+ | Admin+ (own for Author) | Admin+ |
| `pages` | Tenant | Admin+ | Admin+ | Admin+ |
| `products` | Tenant + Public | Admin+ | Admin+ | Admin+ |
| `portfolio` | Tenant + Public | Admin+ | Admin+ | Admin+ |
| `testimonies` | Tenant + Public | Admin+ | Admin+ | Admin+ |
| `announcements` | Tenant | Admin+ | Admin+ | Admin+ |
| `promotions` | Tenant | Admin+ | Admin+ | Admin+ |

### System Tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `users` | Self + Admin+ | Admin+ | Admin+ | Admin+ |
| `roles` | Tenant + Global | Platform Admin | Admin+ | Admin+ |
| `tenants` | Own tenant | Platform Admin | Platform Admin | Platform Admin |
| `settings` | Tenant | Admin+ | Admin+ | - |
| `audit_logs` | Admin+ | Trigger only | - | - |

### Extension Tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `extensions` | Tenant | Admin+ | Admin+ | Admin+ |
| `extension_logs` | Admin+ | System | - | - |

---

## Special Cases

### Users Table

Users can view their own record plus Admin+ can view all tenant users:

```sql
CREATE POLICY "users_select_unified" ON public.users
  FOR SELECT USING (
    id = auth.uid()
    OR (tenant_id = current_tenant_id() AND is_admin_or_above())
    OR is_platform_admin()
  );
```

### Roles Table

Allows reading global roles (tenant_id IS NULL) for all users:

```sql
CREATE POLICY "roles_select_unified" ON public.roles
  FOR SELECT USING (
    tenant_id = current_tenant_id()
    OR tenant_id IS NULL  -- Global roles (owner, super_admin)
    OR is_platform_admin()
  );
```

### Tenants Table

Users can only see their own tenant:

```sql
CREATE POLICY "tenants_select_unified" ON public.tenants
  FOR SELECT USING (
    id = current_tenant_id()
    OR is_platform_admin()
  );
```

### Audit Logs

Only Admin+ can view, no direct inserts (trigger only):

```sql
CREATE POLICY "audit_logs_select" ON public.audit_logs
  FOR SELECT USING (
    (tenant_id = current_tenant_id() AND is_admin_or_above())
    OR is_platform_admin()
  );
```

---

## Public Access Patterns

For tables with public content:

```sql
-- Published articles are public
CREATE POLICY "articles_public_read" ON public.articles
  FOR SELECT USING (
    status = 'published'
    OR (tenant_id = current_tenant_id() AND auth.uid() IS NOT NULL)
  );
```

---

## Bypass for Service Role

The Supabase service_role key bypasses all RLS. Use only for:

- Edge Functions that need cross-tenant access
- Migration scripts
- Admin operations

> [!CAUTION]
> Never expose service_role key in frontend code!

---

## Testing Policies

Test RLS using different user contexts:

```sql
-- Test as specific user
SET LOCAL request.jwt.claims = '{"sub": "user-uuid", "role": "authenticated"}';

-- Query should return only user's tenant data
SELECT * FROM articles;

-- Reset
RESET request.jwt.claims;
```

---

## Performance Considerations

1. **Index tenant_id**: All tables should have index on `tenant_id`
2. **Keep Policies Simple**: Avoid complex subqueries
3. **Use Functions Wisely**: Cache function results when possible
4. **Monitor Query Plans**: Check RLS impact on query performance

---

## Related Documentation

- [Security](../00-core/SECURITY.md)
- [ABAC System](../03-features/ABAC_SYSTEM.md)
- [Database Schema](DATABASE_SCHEMA.md)
- [Multi-Tenancy](../00-core/MULTI_TENANCY.md)
