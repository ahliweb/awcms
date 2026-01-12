# Modules Guide

## Purpose
Describe how admin modules are organized and where to find them in the codebase.

## Audience
- Admin panel developers
- Extension authors

## Prerequisites
- `awcms/docs/02-reference/FOLDER_STRUCTURE.md`

## Core Concepts

- Modules map to routes, menu entries, and permission keys.
- Most module UIs live under `awcms/src/components/dashboard` and `awcms/src/pages/cmspanel`.
- Plugins can add modules via the extension system.

## How It Works

- `admin_menus` defines visible modules and permissions.
- `awcms/src/components/MainRouter.jsx` wires routes to pages.
- `useAdminMenu()` loads the menu configuration.

## Implementation Patterns

- Add a page under `awcms/src/pages/cmspanel`.
- Add a manager component under `awcms/src/components/dashboard`.
- Register the menu item with the required ABAC permission.

## Permissions and Access

- Every module must enforce `usePermissions()` checks.
- Use `useTenant()` to scope tenant data.

## Security and Compliance Notes

- Use soft delete patterns for module deletes.
- Ensure module queries filter `deleted_at` and `tenant_id`.

## References

- `../03-features/MENU_SYSTEM.md`
- `../03-features/ABAC_SYSTEM.md`
