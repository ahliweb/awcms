> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 3 (Modules)

# Template Migration Guide

## Purpose

Provide guidance for migrating legacy templates to the current template system.

## Audience

- Operators running migrations
- Admin panel developers

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for template system architecture
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/modules/TEMPLATE_SYSTEM.md`
- Supabase CLI v2.70+ (install globally or use `npx supabase`)

## Steps

### 1. Apply Migrations

From repo root:

```bash
scripts/verify_supabase_migration_consistency.sh
npx supabase db push --local
```

### 2. Ensure `tenant_id` is Set

Only use one-off SQL backfills like this in controlled migration windows. Keep all durable schema/data changes in timestamped migrations.

```sql
UPDATE public.templates
SET tenant_id = '<tenant_uuid>'
WHERE tenant_id IS NULL;
```

### 3. Re-save Templates in the UI

- Open `/cmspanel/templates`.
- Edit and save each template to normalize the new structure.

### 4. Assign Routes

- Use `/cmspanel/templates/assignments` to set `web` channel assignments.

## Verification

- Public portal renders assigned templates with `PuckRenderer` (`awcms-public/primary/src/components/common/PuckRenderer.astro`).
- Template parts load correctly.

## References

- `docs/modules/TEMPLATE_SYSTEM.md`
- `docs/tenancy/supabase.md`
