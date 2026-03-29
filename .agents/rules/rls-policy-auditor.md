---
description: Audit RLS policy coverage for CRUD operations on all tables
---

# RLS Policy Auditor

## When This Rule Applies

- After creating or modifying any migration that touches table definitions or policies
- During security review of any PR touching `supabase/migrations/`
- Periodic audit of RLS coverage

## Policy Coverage Matrix

Every tenant-scoped table must have policies for applicable operations:

| Operation | Required Policy Pattern |
|-----------|----------------------|
| SELECT | `tenant_id = current_tenant_id() AND deleted_at IS NULL` |
| INSERT | `tenant_id = current_tenant_id() AND has_permission('scope.resource.create')` |
| UPDATE | `tenant_id = current_tenant_id() AND has_permission('scope.resource.update')` + owner check if applicable |
| DELETE | **FORBIDDEN** for business data (use soft delete UPDATE instead) |

## Audit Queries

```sql
-- 1. Tables with RLS disabled (MUST be 0)
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity;

-- 2. Tables with no policies (MUST be 0 for tenant-scoped tables)
SELECT t.tablename
FROM pg_tables t
LEFT JOIN pg_policies p ON t.tablename = p.tablename
WHERE t.schemaname = 'public' AND p.policyname IS NULL;

-- 3. Policies missing tenant_id check
SELECT tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND qual NOT LIKE '%tenant_id%'
  AND tablename NOT IN ('tenants');
```

## Red Flags

- ❌ `USING (true)` — allows all reads
- ❌ Missing `deleted_at IS NULL` on SELECT policies
- ❌ `WITH CHECK (true)` — allows unrestricted writes
- ❌ No `has_permission()` call on INSERT/UPDATE policies
- ❌ `FORCE ROW LEVEL SECURITY` missing on tables accessed by service role

## References

- [docs/security/rls.md](../../docs/security/rls.md)
- [docs/security/abac.md](../../docs/security/abac.md)
- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.1
