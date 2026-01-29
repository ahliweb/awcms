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
    <AdminPageLayout requiredPermission="tenant.settings.read">
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

The admin sidebar is configured in `src/templates/flowbite-admin/components/Sidebar.jsx`:

- `MENU_ITEMS` defines all menu entries with icons, routes, and groups
- Items are grouped by category (Content, Commerce, System, etc.)
- Search functionality filters items by label

## Security and Compliance Notes

- Always enforce tenant scoping in data queries.
- Use permission checks before rendering sensitive UI elements.
- Avoid hardcoded colors; use Tailwind design tokens.

## References

- `docs/modules/COMPONENT_GUIDE.md`
- `docs/security/abac.md`
- `docs/dev/admin.md`
