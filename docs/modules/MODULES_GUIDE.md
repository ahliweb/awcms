> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Modules Guide

## Purpose

Describe how admin-facing modules are currently organized, routed, permissioned, surfaced in menus, and synchronized into the tenant-scoped module inventory.

This is a current-state guide for the checked-in admin/runtime behavior, not a promise that every resource always has a one-to-one manager screen.

## Current Module Model

The current module system is a blend of:

- route-backed manager screens in `awcms/src/components/dashboard/`
- entries in `resources_registry`
- scope-aware admin menu items
- tenant-scoped `modules` rows
- extension-provided resources and menus

That means “module” can refer to more than one implementation surface:

- a dedicated manager component
- a dynamic resource rendered through generic runtime machinery
- an extension-backed feature exposed through menus/resources

## Current Core Surfaces

| Concern | Current Source |
| --- | --- |
| manager components | `awcms/src/components/dashboard/` |
| route definitions | `awcms/src/components/MainRouter.jsx` |
| menu loading | `awcms/src/hooks/useAdminMenu.js` |
| module inventory/toggles | `awcms/src/hooks/useModules.js` |
| resource metadata | `resources_registry` |
| extension module visibility | `extension_menu_items`, extension manifests, runtime injection |

## Current Routing Model

- canonical admin routes live in `MainRouter.jsx`
- route paths commonly use splats (`*`) for sub-slugs like tabs, trash views, approvals, and nested modes
- protected edit/detail routes should follow current signed-id route-security expectations where applicable

Do not document route aliases as canonical when `MainRouter.jsx` already makes the real route contract clear.

## Current Module Inventory Model

The `modules` table is tenant-scoped even when the platform-level Modules screen is used.

Current behavior in `useModules()` includes:

- per-tenant module reads for tenant-scoped users
- platform-wide reads for platform/full-access users where RLS allows it
- module sync through `sync_modules_from_sidebar(...)`
- realtime refresh plus browser-event refresh after toggles/sync
- fail-open `isModuleEnabled(slug)` behavior when a slug is not yet represented in the DB inventory

This means the module inventory is synchronized state, not the only source of truth for whether a feature exists.

## Current Available Module Families

### Content

- Blogs
- Pages
- Visual Pages
- Widgets
- Templates
- Portfolio
- Testimonials
- Announcements
- Fun Facts
- Services
- Team
- Partners

### Media

- Media Library
- resource-backed gallery-style features where implemented through dynamic resource patterns

### Commerce

- Products
- Product Types
- Orders
- Promotions

### Navigation

- Menus
- Categories
- Tags

### System And Access

- Users
- Roles
- Permissions
- Policies
- Settings
- Branding settings
- Email settings/logs
- Audit logs
- Visitor statistics
- SEO
- Languages
- SSO
- Notifications
- Contacts / contact messages
- Themes
- school/site-image style tenant settings surfaces where present

### Platform And Extension Surfaces

- Tenants
- Modules
- Extensions
- Sidebar/admin-navigation management
- Platform settings/dashboard
- Dynamic resource surfaces

### Mobile And IoT

- Mobile Users
- Push Notifications
- Mobile Config
- Devices

Treat this list as a current orientation map, not as a guarantee that every item has the exact same implementation depth.

## Current Module Sync Behavior

`sync_modules_from_sidebar()` currently builds tenant module inventory from live navigation/resource sources.

Current implications:

- module rows are synchronized per tenant
- platform operators can sync across tenants
- tenant-scoped consumers still read the active tenant view only
- toggle state is stored on the tenant/module pair, not on a single global module record

## Current Add-A-Module Pattern

When adding or updating a module today, review whether the feature needs all of these surfaces or only a subset:

1. manager component or dynamic-resource rendering support
2. route entry in `MainRouter.jsx`
3. menu visibility through the current menu system
4. `resources_registry` entry or update
5. canonical permission family and ABAC alignment
6. tenant-scoped inventory sync behavior if it should participate in the Modules screen
7. docs updates if the module surface becomes user-visible or contract-relevant

## Current Permission Mapping Rules

- every module-visible surface should align to canonical permission keys
- use `scope.resource.action`
- do not invent app-only module permissions without checking the current migration-backed baseline
- route/layout permission gates should align with backend authority, not replace it

Example:

```jsx
<AdminPageLayout requiredPermission="tenant.widgets.read">
  <WidgetsManager />
</AdminPageLayout>
```

## Current Dynamic Resource Caveat

Some resources exist in the registry and the module inventory without a dedicated manager component.

Before documenting a module as fully route-backed, verify whether it is currently implemented via:

- a dedicated `*Manager.jsx`
- `DynamicResourceManager`
- extension/runtime injection

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin/module code changes | `cd awcms && npm run build` |
| maintained docs | `cd awcms && npm run docs:check` |
| edge/admin route contract changes tied to a module | `cd awcms-edge && npm test && npm run typecheck` when relevant |

## Related Docs

- [docs/security/abac.md](../security/abac.md)
- [docs/modules/MENU_SYSTEM.md](./MENU_SYSTEM.md)
- [docs/dev/admin.md](../dev/admin.md)
- [docs/modules/ROLE_HIERARCHY.md](./ROLE_HIERARCHY.md)
