---
description: Enforce soft delete lifecycle and prevent hard deletes on business data
---

# Soft Delete Enforcer

> **Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.2

## Rule

Business data tables MUST use soft delete via a `deleted_at` (TIMESTAMPTZ) column.
SQL `DELETE FROM` statements are **FORBIDDEN** for business data. Hard deletes are only
permitted for join/link tables and non-business associative records.

## Required Column

Every business table must include:

```sql
deleted_at TIMESTAMPTZ DEFAULT NULL
```

## Violations

```sql
-- ❌ Hard delete on business table
DELETE FROM blog_posts WHERE id = '...';

-- ❌ Missing deleted_at filter in read query
SELECT * FROM pages WHERE tenant_id = '...';

-- ❌ ON DELETE CASCADE on business entity FK
REFERENCES blog_posts(id) ON DELETE CASCADE
```

## Allowed

```sql
-- ✅ Soft delete
UPDATE blog_posts SET deleted_at = NOW() WHERE id = '...';

-- ✅ Reading with soft delete filter
SELECT * FROM pages WHERE tenant_id = '...' AND deleted_at IS NULL;

-- ✅ Hard delete on join/link table (documented)
DELETE FROM post_tags WHERE post_id = '...';

-- ✅ CASCADE on associative/join table FK
REFERENCES post_tags(id) ON DELETE CASCADE
```

## Supabase JS Client

```javascript
// ❌ Violation
await supabase.from('blog_posts').delete().eq('id', id);

// ✅ Correct
await supabase.from('blog_posts').update({ deleted_at: new Date().toISOString() }).eq('id', id);

// ✅ Every read query must filter
await supabase.from('blog_posts').select('*').is('deleted_at', null);
```

## Enforcement

1. **Migration review**: New migrations must not contain `DELETE FROM` for business tables.
2. **Code review**: Application code must use `.update({ deleted_at })` not `.delete()` for
   business entities.
3. **FK review**: New foreign keys on business tables must use `ON DELETE RESTRICT` or
   `ON DELETE SET NULL`, not `CASCADE`.

## Rationale

- Preserves audit trail and data recovery capability
- Supports compliance with UU PDP data retention requirements
- Prevents accidental data loss in multi-tenant environment
