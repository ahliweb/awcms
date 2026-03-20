# Release Summary - 2026-03 Admin UI Cleanup

## Summary

- Standardized admin page spacing, card separation, and toolbar layout across shared and custom dashboard screens.
- Removed duplicated nested shells in the Visual Pages and Theme Layout flows.
- Unified list, filter, and pagination presentation across `GenericContentManager` screens and custom tag/notification views.
- Cleaned module copy, breadcrumb labels, and translation gaps that produced awkward plurals or raw keys.

## Key Improvements

| Area | Improvement |
| --- | --- |
| Shared shell | Added consistent vertical spacing to `AdminPageLayout` and aligned module sections around `space-y-6`. |
| Shared content manager | Added support for `canCreate`, `updatePermission`, `deletePermission`, `disableTenantFilter`, and embedded header/content composition. |
| Visual Pages | Removed duplicate nested headers/layouts and aligned visual page queries with the standard page relation select. |
| Tables and pagination | Improved truncation handling, surfaced pagination rows, and aligned custom filters/pagination bars with shared card styling. |
| Custom screens | Normalized `Notifications`, `Menus`, `Files`, `Platform Diagnostics`, `Platform Dashboard`, `Extensions`, `Tags`, and `User Profile` to the shared admin rhythm. |
| Copy cleanup | Fixed labels such as `Visual Pagess`, `Lang`, `Tags Manager`, and other inconsistent or redundant phrases. |

## Validation

- `npm run build` in `awcms/` completed successfully after the cleanup batch.

## Commit

- `53bea67` - `fix: unify admin module layouts and copy`
