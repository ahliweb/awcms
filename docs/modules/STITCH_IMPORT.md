> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status**: Compatibility / historical surface only
>
> **Last Updated**: 2026-03-08

# Stitch Import

## Purpose

Document the remaining compatibility footprint for Stitch import so historical schema objects,
resource registration, and audit trails are understandable without presenting Stitch as an active,
canonical AWCMS runtime feature.

## Current State

Stitch import is no longer part of the canonical AWCMS product surface or runtime.

- `SYSTEM_MODEL.md` marks Stitch import as a removed capability.
- `docs/RESOURCE_MAP.md` marks `stitch_import` as removed from the active runtime surface.
- Admin menu synchronization explicitly filters out the `stitch_import` resource key.
- Existing migration history and resource records remain for compatibility and auditability.

## Residual Footprint

The repository still contains historical Stitch-related schema and resource artifacts:

| Surface | Current Meaning |
| --- | --- |
| `20260224150000_add_stitch_import_settings.sql` | Historical tenant-setting seed for a removed feature |
| `20260224151000_create_stitch_import_jobs.sql` | Historical audit/log table for prior Stitch import operations |
| `20260224152000_register_stitch_import_resource.sql` | Historical resource and permission registration |
| `stitch_import_jobs` table and indexes | Compatibility data retained in schema history |
| `stitch_import` resource key | Excluded from current admin-menu sync and not part of canonical active navigation |

## Documentation Rule

Do not document Stitch import as an active admin module, shipped workflow, or recommended content-ingestion path.

Use this page only when you need to explain:

- why Stitch-related migrations still exist,
- why old permissions or resource keys appear in schema history,
- why menu/resource sync intentionally excludes `stitch_import`.

## If the Feature Is Ever Revived

If Stitch import becomes an active feature again, update all of the following together:

1. `SYSTEM_MODEL.md`
2. `AGENTS.md`
3. `DOCS_INDEX.md`
4. `docs/RESOURCE_MAP.md`
5. relevant module/dev guides and the audit tracker

Until then, treat this page as a compatibility note, not a product guide.

## References

- `SYSTEM_MODEL.md`
- `docs/RESOURCE_MAP.md`
- `awcms/src/hooks/useAdminMenu.js`
- `awcms/src/scripts/seed-sidebar.js`
