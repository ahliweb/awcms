> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack) and Section 2.3 (Permissions)

# Admin UI Architecture

## Purpose

Describe the admin layout system and the shared template components.

## Audience

- Admin panel developers

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Admin Panel architecture (React 19.2.4, Vite 7, TailwindCSS 4)
- [AGENTS.md](../../AGENTS.md) - Implementation patterns and Context7 references
- `docs/modules/COMPONENT_GUIDE.md`
- `docs/security/abac.md`

## Core Concepts

- Admin pages use `awcms/src/templates/flowbite-admin`.
- `AdminPageLayout` handles permission checks and tenant context display.
- Tables and forms use shared components for consistency.
- Routing currently uses `BrowserRouter` + `Routes` in `awcms/src/components/MainRouter.jsx` with `React.lazy` + `Suspense` for code splitting. If adopting data routers in the future, prefer `createBrowserRouter` + `RouterProvider` with loaders/actions (see `docs/architecture/standards.md`).

## How It Works

- `AdminPageLayout` reads `requiredPermission` for access control.
- `PageHeader` standardizes titles, actions, and breadcrumbs.
- `GenericContentManager` provides CRUD operations with search, pagination, and bulk actions.
- Sidebar menus are data-driven from `admin_menus` and `resources_registry` via `useAdminMenu`.

### Routing and Extensions

- `usePluginRoutes()` injects extension routes at runtime.
- `ExtensionErrorBoundary` wraps dynamic routes to prevent extension failures from crashing the shell.
- The fallback loader is `PageLoader` inside `MainRouter.jsx`.

### Route Conventions (Sub-Slugs)

Admin routes use path-based sub-slugs so tab and trash views survive refreshes. Base module routes use `*` in `MainRouter.jsx` to allow nested paths, and legacy query-string links redirect to the new slugs.

Edit/detail routes use signed IDs (`{id}.{signature}`) to prevent guessable links. Use `encodeRouteParam` when generating links and `useSecureRouteParam` to decode inside route screens.

```javascript
import { encodeRouteParam } from '@/lib/routeSecurity';

const handleEdit = async (role) => {
  const routeId = await encodeRouteParam({ value: role.id, scope: 'roles.edit' });
  if (!routeId) return;
  navigate(`/cmspanel/roles/edit/${routeId}`);
};
```

```javascript
import useSecureRouteParam from '@/hooks/useSecureRouteParam';
import { useParams } from 'react-router-dom';

const RoleEditor = () => {
  const { id: routeParam } = useParams();
  const { value: roleId } = useSecureRouteParam(routeParam, 'roles.edit');
  // roleId is decoded UUID or null
};
```

| Area | Base Route | Sub-Slug Patterns | Notes |
| --- | --- | --- | --- |
| Blogs | `/cmspanel/blogs` | `/categories`, `/tags`, `/queue`, `/edit/:id` | Review queue lives at `/queue`. |
| Pages | `/cmspanel/pages` | `/categories`, `/tags` | Tabs map to sub-slugs. |
| Users | `/cmspanel/users` | `/approvals/:status`, `/new`, `/edit/:id` | Approval statuses: `pending`, `completed`, `rejected`. |
| Roles | `/cmspanel/roles` | `/new`, `/edit/:id` | Role editor is route-backed. |
| Templates | `/cmspanel/templates` | `/parts`, `/assignments`, `/languages` | Tabs map to sub-slugs. |
| Visual Pages | `/cmspanel/visual-pages` | `/layouts` | Layout manager is tabbed. |
| Sidebar Manager | `/cmspanel/admin-navigation` | `/groups` | Items/groups tabs. |
| Media Library | `/cmspanel/files` or `/cmspanel/media` | `/trash` | Trash view uses sub-slug. |
| Tags | `/cmspanel/tags` | `/trash` | Trash view uses sub-slug. |
| Visual Editor | `/cmspanel/visual-editor/:mode/:id` | `template`, `part`, `page`, `blog` | Legacy `?templateId`/`?partId` redirect here. |

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
For header conventions and widget frame behavior, see `docs/modules/EXTENSIONS.md`.

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
