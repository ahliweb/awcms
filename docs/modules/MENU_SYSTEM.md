> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Admin Menu System

## Purpose

Describe how the current admin menu system is sourced, normalized, filtered, scoped, and extended in AWCMS.

This guide reflects the live `useAdminMenu()` behavior rather than an older simplified model of “a single static sidebar table”.

## Current State

### Current Menu Reality

The admin menu is currently assembled from multiple inputs and then normalized.

It is not just:

- a hardcoded sidebar
- a globally tenantless `admin_menus` table
- an extension-only injection surface

Current menu behavior combines:

- `admin_menus`
- `resources_registry`
- `extension_menu_items`
- plugin/extension/runtime injections
- tenant-aware scope filtering
- platform-vs-tenant preference and de-duplication

### Current Scope Model

`admin_menus` currently supports scoped rows using fields like:

- `tenant_id`
- `scope`

That means menu loading must respect:

- current tenant scope
- platform vs tenant visibility
- shared/null-tenant rows where intended

For public website rendering, tenant-owned portals should prefer explicit tenant-scoped menu rows for the active tenant. Shared/null-tenant fallback rows should only be used when a public workspace intentionally documents that fallback behavior.

## Current Source Order

The current effective menu model is closer to:

1. `admin_menus` as a primary configured source
2. `resources_registry` as a system/source-of-truth companion for module/resource metadata
3. extension menu rows from `extension_menu_items`
4. plugin/runtime filter injections
5. de-duplication and priority normalization inside `useAdminMenu()`

## Current `useAdminMenu()` Behavior

`useAdminMenu()` currently does more than simply fetch rows.

Important current behavior includes:

- tenant-aware query scoping through the active tenant context
- null-tenant fallback behavior where intended
- extension menu normalization
- resource fallback item generation for active resources without explicit menu rows
- de-duplication across overlapping sources
- priority-based winner selection for duplicate/conflicting menu candidates
- platform-aware handling of platform menu items

This means menu changes should read the current hook and utility helpers before assuming a direct table-to-sidebar mapping.

## Current Data Sources

### `admin_menus`

Use `admin_menus` for configured menu rows and scope-aware seeded menu state.

Current important fields/concepts include:

- `tenant_id`
- `scope`
- `group_label`
- `group_order`
- `order`
- `resource_id`
- `permission`

### `resources_registry`

`resources_registry` is part of the current source-of-truth model for module/resource metadata.

Current menu logic uses it to:

- enrich configured menu rows
- infer missing menu items for active resources
- align resource/menu visibility with permission prefixes and scope

### `extension_menu_items`

Extension menu rows currently participate in the normalized menu result when the related extension is active and not deleted.

### Plugin / Runtime Filters

Menu injection may still happen through hooks/filters for plugin-like behavior.

This remains part of the current runtime surface, but injected items still enter a normalization/deduplication pipeline.

## Current Menu Identity And Deduplication Rules

The current menu system tries to collapse equivalent items using identity signals such as:

- canonical key
- normalized path
- normalized label

Menu candidates are compared using current preference rules that account for factors like:

- source type
- tenant scoping
- resource linkage
- permission presence
- platform-specific behavior
- explicit ordering/group ordering

Do not document or implement menu additions as if duplicate rows are always rendered independently.

## Permissions And Access

### Current Permission Model

- Each menu item may declare a `permission`.
- The sidebar/UI layer hides items when the current permission context does not allow them.
- Platform-admin/full-access roles may bypass standard permission checks for visible platform/admin surfaces.
- `resources_registry.permission_prefix` still matters for ABAC alignment.

### Current Guidance

- Use canonical permission names from [docs/security/abac.md](../security/abac.md).
- Prefer resource-linked/menu-aligned permission design instead of ad hoc hardcoded checks.
- Do not invent placeholder menu permission families without migration-backed support.

## Extension And Plugin Injection

Example shape:

```javascript
import { addFilter } from '@/lib/hooks';

addFilter('admin_menu_items', 'my_plugin', (items) => [
  ...items,
  {
    label: 'My Feature',
    path: 'my-feature',
    icon: 'Star',
    permission: 'tenant.my_feature.read',
  },
]);
```

Current rule:

- injected items should still align with current menu identity, permission, and routing conventions

## Implications For Admin Changes

When adding or changing admin menu behavior:

- do not assume `admin_menus` is globally tenantless
- do not assume a new module only needs a route and a sidebar label
- check whether the feature should be represented in `resources_registry`
- check whether extension/runtime injection is more appropriate than a direct seeded menu row
- preserve current scope-aware behavior for platform and tenant users
- verify menu routing and permission alignment together

## Security And Compliance Notes

- Menu permissions must align with ABAC definitions.
- Avoid undocumented hardcoded sidebar items outside the current menu system.
- Preserve tenant/platform scope boundaries in menu visibility.
- Menu visibility should not imply backend authorization; RLS and permission enforcement remain authoritative.

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin/menu code changes | `cd awcms && npm run build` |
| maintained docs | `cd awcms && npm run docs:check` |
| edge/admin route docs tied to menu changes | `cd awcms-edge && npm test && npm run typecheck` when relevant |

## Related Docs

- [docs/security/abac.md](../security/abac.md)
- [docs/dev/admin.md](../dev/admin.md)
- [../../awcms/src/hooks/useAdminMenu.js](../../awcms/src/hooks/useAdminMenu.js)
