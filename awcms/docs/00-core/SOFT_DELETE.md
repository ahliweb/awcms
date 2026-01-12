# Soft Delete Lifecycle

## Purpose
Define the soft delete rules and query patterns used across AWCMS.

## Audience
- Developers implementing CRUD logic
- Database maintainers authoring migrations

## Prerequisites
- `awcms/docs/00-core/MULTI_TENANCY.md`
- `awcms/docs/02-reference/RLS_POLICIES.md`

## Core Concepts

- AWCMS never hard-deletes tenant data from the database.
- Soft delete uses `deleted_at` timestamps.
- Reads must filter out soft-deleted rows.

## How It Works

- Application code updates `deleted_at` instead of using `.delete()`.
- RLS policies typically include `deleted_at IS NULL` checks for read operations.
- Restore workflows set `deleted_at` back to `NULL`.

## Implementation Patterns

### Soft Delete

```javascript
const { error } = await supabase
  .from('articles')
  .update({ deleted_at: new Date().toISOString() })
  .eq('id', articleId);
```

### Read Without Deleted Rows

```javascript
const { data, error } = await supabase
  .from('articles')
  .select('*')
  .is('deleted_at', null);
```

## Security and Compliance Notes

- Soft delete is mandatory for tenant-scoped tables.
- Always include tenant scoping and `deleted_at` filters together.
- Hard deletes are allowed only when explicitly documented and approved.

## Operational Concerns

- Ensure every new table includes `deleted_at` (nullable timestamp).
- Add indexes for `tenant_id` and `deleted_at` to keep RLS performant.

## References

- `../02-reference/RLS_POLICIES.md`
- `../02-reference/DATABASE_SCHEMA.md`
- `../02-reference/API_DOCUMENTATION.md`
