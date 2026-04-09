> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Template Migration Guide

## Purpose

Provide current-state guidance for migrating legacy template/layout data into the current template/visual-builder composition system.

This guide is for controlled migration work, not for ordinary day-to-day template edits.

## Current Migration Context

Template migration now happens inside a broader composition system that includes:

- `templates`
- `template_parts`
- `template_assignments`
- widget-area composition
- Pages-owned visual rendering paths

Current important rule:

- migration work should align with the current tenant-scoped template system, not just backfill a single old layout field

## Current Safe Migration Expectations

Before migrating template data:

1. verify root/mirrored migrations are in parity
2. confirm the target tenant/context is correct
3. keep durable schema/data changes in timestamped migrations when they are meant to persist as part of the baseline
4. treat one-off SQL backfills as controlled operational work, not as a substitute for proper migration history

## Current Practical Migration Flow

### 1. Verify Migration Parity

```bash
scripts/verify_supabase_migration_consistency.sh
```

### 2. Apply The Relevant Database Changes

Use the current local/linked Supabase workflow appropriate to the environment.

For example:

```bash
npx supabase db push --local
```

### 3. Backfill Or Normalize Tenant Scope Carefully

If a controlled one-off backfill is required, do it intentionally and in a migration window.

Representative pattern:

```sql
UPDATE public.templates
SET tenant_id = '<tenant_uuid>'
WHERE tenant_id IS NULL;
```

Current important rule:

- do not normalize arbitrary production data with ad hoc SQL unless the migration plan explicitly calls for it

### 4. Re-Save / Normalize Through The Current Admin UI

Use the current Templates/Visual Editor surfaces to normalize template records and confirm the data behaves correctly in the current composition runtime.

### 5. Recreate Or Verify Assignments

Use the current template assignment flow to restore `web` channel assignments and any other required channel-specific mappings.

## Current Verification Goals

- templates load in the current admin template system
- template parts resolve correctly
- assignments map correctly for the intended channels
- public rendering uses the intended template composition path
- tenant scope is correct after migration

## Current Public Verification Note

If the migrated template affects public rendering, verify the public portal renders through the current render-only path and assigned templates behave as expected.

## Validation Guidance

| Surface | Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| migration parity | `scripts/verify_supabase_migration_consistency.sh` |
| public render implications | `cd awcms-public/primary && npm run check:astro` when relevant |
| edge/runtime implications | `cd awcms-edge && npm test && npm run typecheck` when relevant |

## Related Docs

- [docs/modules/TEMPLATE_SYSTEM.md](./TEMPLATE_SYSTEM.md)
- [docs/modules/VISUAL_BUILDER.md](./VISUAL_BUILDER.md)
- [docs/tenancy/supabase.md](../tenancy/supabase.md)
