# Template Migration Guide

## Purpose

Provide guidance for migrating legacy templates to the current template system.

## Audience

- Operators running migrations
- Admin panel developers

## Prerequisites

- `awcms/docs/03-features/TEMPLATE_SYSTEM.md`
- Supabase CLI installed

## Steps

### 1. Apply Migrations

From repo root:

```bash
supabase db push
```

### 2. Ensure `tenant_id` is Set

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

- Public portal renders assigned templates with `PuckRenderer`.
- Template parts load correctly.

## References

- `docs/modules/TEMPLATE_SYSTEM.md`
- `docs/tenancy/supabase.md`
