---
description: Enforce tenant_id presence and isolation on all tenant-scoped resources
---

# Tenancy Guard

## When This Rule Applies

- Creating or modifying any table, query, hook, or component that handles tenant-scoped data
- Writing RLS policies, Edge Functions, or API queries
- Reviewing PRs that touch `supabase/migrations/`, auth contexts, or data-fetching hooks

## Mandatory Checks

### 1. Schema — `tenant_id` Column

Every tenant-scoped table **MUST** have:

```sql
tenant_id UUID NOT NULL REFERENCES public.tenants(id)
```

**Exceptions** (require explicit documentation): `tenants` table itself, `auth.users`, platform-level config tables.

### 2. RLS Policy — Tenant Scope

Every RLS policy on a tenant-scoped table **MUST** include:

```sql
tenant_id = public.current_tenant_id()
```

### 3. Client Queries — Tenant Filter

Every Supabase client query **MUST** include tenant context:

```javascript
// Admin: resolved via useTenant()
const { tenantId } = useTenant();
const { data } = await supabase
  .from('blogs')
  .select('*')
  .eq('tenant_id', tenantId)
  .is('deleted_at', null);
```

### 4. Public Portal — Build-Time Resolution

Public portal resolves tenant via build-time env:

```typescript
const tenantId = import.meta.env.PUBLIC_TENANT_ID;
```

### 5. Never Do

- ❌ Query without `tenant_id` filter on tenant-scoped tables
- ❌ Use `supabaseAdmin` (service role) in client-side code
- ❌ Pass `tenant_id` from user input without validation
- ❌ Create tables without `tenant_id` for tenant-scoped data
- ❌ Bypass RLS for convenience

## Verification

```sql
-- Check all tenant-scoped tables have tenant_id
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name NOT IN ('tenants', 'settings')
EXCEPT
SELECT table_name FROM information_schema.columns
WHERE column_name = 'tenant_id' AND table_schema = 'public';
```

## References

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.1
- [docs/tenancy/overview.md](../../docs/tenancy/overview.md)
- [docs/security/rls.md](../../docs/security/rls.md)
