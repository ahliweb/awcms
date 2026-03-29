---
description: Safe migration creation, modification, and verification procedures
---

# Migration Guardian

## When This Rule Applies

- Creating any new SQL migration
- Modifying database schema, RLS policies, or functions
- Syncing remote schema changes

## Do ✅

- Use timestamped migration files: `supabase/migrations/<timestamp>_<name>.sql`
- Include `IF NOT EXISTS` / `IF EXISTS` guards on CREATE/DROP
- Add `deleted_at TIMESTAMPTZ` to new business data tables
- Add `tenant_id UUID NOT NULL REFERENCES tenants(id)` to tenant-scoped tables
- Enable RLS on every new table: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- Add policies immediately after enabling RLS
- Test with multiple tenant contexts before pushing
- Keep non-migration SQL in `supabase/manual/`

## Don't ❌

- Never modify an existing, applied migration file
- Never use `DROP TABLE` without `IF EXISTS`
- Never disable RLS, even temporarily
- Never hardcode UUIDs, secrets, or credentials
- Never use `ON DELETE CASCADE` on core business entities
- Never create a migration that weakens existing RLS policies

## Safe Repair Steps

If a migration fails:

1. **DO NOT** edit the failed migration
2. Create a new migration to fix the issue: `supabase migration new fix_<issue>`
3. Apply the fix and verify with audit queries
4. Document the fix in the migration file comments

## Verification Commands

```bash
# Create new migration
npx supabase migration new <name>

# Apply locally
npx supabase db reset

# Check migration status
npx supabase migration list

# Diff local vs remote
npx supabase db diff

# Push to remote (after thorough testing)
npx supabase db push
```

## Post-Migration Checks

```sql
-- Verify RLS enabled on all tables
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity;

-- Verify no orphan tables without policies
SELECT t.tablename FROM pg_tables t
LEFT JOIN pg_policies p ON t.tablename = p.tablename
WHERE t.schemaname = 'public' AND p.policyname IS NULL;
```

## References

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.2
- [AGENTS.md](../../AGENTS.md) Database Changes section
- [docs/dev/setup.md](../../docs/dev/setup.md)
