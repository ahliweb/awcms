# Admin UI Architecture

## Purpose

Describe the admin layout system and the shared template components.

## Audience

- Admin panel developers

## Prerequisites

- `docs/modules/COMPONENT_GUIDE.md`
- `docs/security/abac.md`

## Core Concepts

- Admin pages use `awcms/src/templates/flowbite-admin`.
- `AdminPageLayout` handles permission checks and tenant context display.
- Tables and forms use shared components for consistency.

## How It Works

- `AdminPageLayout` reads `requiredPermission` for access control.
- `PageHeader` standardizes titles, actions, and breadcrumbs.
- `GenericContentManager` provides CRUD operations with search, pagination, and bulk actions.
- Sidebar menus are data-driven from `admin_menus` and `resources_registry` via `useAdminMenu`.

## Implementation Patterns

### Standard Manager Component

```jsx
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import GenericContentManager from '@/components/dashboard/GenericContentManager';
import { FileText } from 'lucide-react';

function ExampleManager() {
  const columns = [
    { key: 'title', label: 'Title', className: 'font-medium' },
    { key: 'status', label: 'Status' }
  ];

  const formFields = [
    { key: 'title', label: 'Title', required: true },
    { key: 'content', label: 'Content', type: 'textarea' }
  ];

  return (
    <AdminPageLayout requiredPermission="tenant.example.read">
      <PageHeader
        title="Example Manager"
        description="Manage example content."
        icon={FileText}
        breadcrumbs={[{ label: 'Example', icon: FileText }]}
      />

      <GenericContentManager
        tableName="examples"
        resourceName="Example"
        columns={columns}
        formFields={formFields}
        permissionPrefix="examples"
        showBreadcrumbs={false}
      />
    </AdminPageLayout>
  );
}
```

### Custom Manager Component

```jsx
import { AdminPageLayout, PageHeader } from '@/templates/flowbite-admin';
import { Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

function CustomManager() {
  return (
    <AdminPageLayout requiredPermission="tenant.setting.read">
      <PageHeader
        title="Custom Settings"
        description="Configure advanced options."
        icon={Settings}
        breadcrumbs={[{ label: 'Settings', icon: Settings }]}
        actions={<Button>Save Changes</Button>}
      />

      {/* Custom content here */}
    </AdminPageLayout>
  );
}
```

## Key Components

| Component | Purpose |
|-----------|---------|
| `AdminPageLayout` | Page wrapper with permission checks and layout |
| `PageHeader` | Standardized header with title, description, icon, breadcrumbs, actions |
| `GenericContentManager` | CRUD operations with table, search, pagination |
| `ContentTable` | Data table with sorting and actions |

## Dashboard Widgets (Plugins)

Plugins can inject widgets into the admin dashboard using the `dashboard_widgets` filter. The dashboard renders these via `PluginWidgets`, which supports basic layout hints and optional framing.

- `component`: use a plugin registry key (for example `mailketing:MailketingCreditsWidget`)
- `position`: `main` (default) or `sidebar`
- `size`: `large` (spans two columns in grid layouts)
- `order` or `priority`: sort order (lower shows first)
- `frame`: `default` (card wrapper), `flush` (edge-to-edge), or `false`
- `props`: passed to the widget component

```jsx
addFilter('dashboard_widgets', 'mailketing_stats', (widgets) => [
  ...widgets,
  {
    id: 'mailketing_credits',
    component: 'mailketing:MailketingCreditsWidget',
    position: 'sidebar',
    priority: 50,
    frame: false
  },
  {
    id: 'analytics-overview',
    component: 'awcms-ext-ahliweb-analytics:AnalyticsWidget',
    position: 'main',
    size: 'large',
    order: 1,
    frame: 'flush',
    props: { className: 'rounded-none' }
  }
]);
```

## Permissions and Access

- Use `requiredPermission` prop for route-level access.
- Use `usePermissions()` inside components for finer-grained checks:

```jsx
const { hasPermission, userRole, isPlatformAdmin } = usePermissions();

if (hasPermission('tenant.blog.create')) {
  // Show create button
}
```

## Sidebar Configuration

The admin sidebar is data-driven via `awcms/src/hooks/useAdminMenu.js` and rendered in `awcms/src/templates/flowbite-admin/components/Sidebar.jsx`:

- Menu items are stored in `admin_menus` and enriched with `resources_registry` metadata
- Permission checks rely on ABAC prefixes (`resources_registry.permission_prefix`)
- Items are grouped by `group_label`/`group_order` and filtered by search input

## Security and Compliance Notes

- Always enforce tenant scoping in data queries.
- Use permission checks before rendering sensitive UI elements.
- Avoid hardcoded colors; use Tailwind design tokens.

## References

- `docs/modules/COMPONENT_GUIDE.md`
- `docs/security/abac.md`
- `docs/dev/admin.md`
