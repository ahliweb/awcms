# Admin Menu System

## Purpose

Describe how admin menus are stored, loaded, and extended.

## Audience

- Admin panel developers
- Extension authors

## Prerequisites

- `docs/security/abac.md`

## Core Concepts

- Menu configuration is stored in `admin_menus`.
- The UI falls back to `awcms/src/hooks/useAdminMenu.js` defaults.
- Extensions and plugins can inject menu items at runtime.

## How It Works

### Data Source Order

1. `admin_menus` table (canonical)
2. `DEFAULT_MENU_CONFIG` in `useAdminMenu.js` (fallback)
3. Extension or plugin injections (hooks)

### Extension Injection

```javascript
import { addFilter } from '@/lib/hooks';

addFilter('admin_menu_items', 'my_plugin', items => [
  ...items,
  { label: 'My Feature', path: 'my-feature', icon: 'Star', permission: 'tenant.my_feature.read' }
]);
```

## Implementation Patterns

- Use `useAdminMenu()` to load and update menu items.
- Menu items must include a permission key following `scope.resource.action`.

## Permissions and Access

- Each menu item has a `permission` field.
- The sidebar hides items when `usePermissions().hasPermission()` fails.

## Security and Compliance Notes

- Menu permissions must align with ABAC definitions.
- Avoid hardcoded menu items outside the menu system.

## References

- `docs/security/abac.md`
- `../../src/hooks/useAdminMenu.js`
