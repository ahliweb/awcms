---
description: Safe database migration creation and verification workflow
---

# Migration Workflow

// turbo-all

## Steps

1. **Plan the change** — Document what tables/columns/policies will be created or modified. Reference `docs/architecture/database.md` for current schema.

2. **Create migration file**

```bash
cd /home/data/dev_react/awcms-dev && npx supabase migration new <descriptive_name>
```

1. **Write SQL** — Follow rules in `.agents/rules/migration-guardian.md`:
   - Include `IF NOT EXISTS` / `IF EXISTS` guards
   - Add `tenant_id`, `deleted_at` for business tables
   - Enable RLS and add policies immediately
   - Add permission keys to `permissions` table if needed

2. **Apply locally**

```bash
cd /home/data/dev_react/awcms-dev && npx supabase db reset
```

1. **Run RLS audit** — Execute queries from `.agents/rules/rls-policy-auditor.md`

2. **Test with multiple contexts** — Verify tenant isolation with different user roles

3. **Push to remote (after approval)**

```bash
cd /home/data/dev_react/awcms-dev && npx supabase db push
```

1. **Update docs** if schema changed: `docs/architecture/database.md`, `CHANGELOG.md`
