> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1 (Tech Stack) and Section 2.3 (Permissions)

# Admin Panel Development

## 1. Overview

The Admin Panel (`awcms/`) is a React SPA built with Vite. It serves as the central management interface for all tenants.

## 2. Key Technologies

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for Admin Panel tech stack (React 19.2.4, Vite 7.2.7, TailwindCSS 4)
- [AGENTS.md](../../AGENTS.md) - Implementation patterns, Context7 references, and multi-tenancy guidelines
- **Framework**: React 19.2.4
- **Build Tool**: Vite 7.2.7
- **Styling**: Tailwind CSS 4, shadcn/ui
- **State Management**: React Context (Tenant, Permissions, Auth)
- **Icons**: Lucide React

## 3. Directory Structure

- `src/components/`: Reusable UI components.
- `src/contexts/`: Global state providers.
- `src/hooks/`: Custom React hooks.
- `src/pages/`: Route components.
- `src/templates/flowbite-admin/`: Main admin layout and shell.

## 4. Common Tasks

### 4.1 Adding a New Module

1. Register the module in `resources_registry` (scope, db_table, permission_prefix).
2. Create a `Manager` component in `src/components/dashboard/`.
3. Add a route in `src/components/MainRouter.jsx`.
4. Insert a sidebar item in `admin_menus` (seed via `awcms/src/scripts/seed-sidebar.js`).
5. Ensure the permission exists in `permissions` and is mapped via `role_permissions`.

### 4.2 Handling Permissions

Use the `usePermissions` hook to guard UI elements:

```jsx
const { hasPermission } = usePermissions();

if (hasPermission('tenant.blog.create')) {
  <Button>Create Article</Button>
}
```

### 4.3 Plugin Dashboard Widgets

Plugins can inject dashboard widgets via the `dashboard_widgets` filter. Use plugin registry keys for components (for example `mailketing:MailketingCreditsWidget`).

```jsx
addFilter('dashboard_widgets', 'mailketing_stats', (widgets) => [
  ...widgets,
  {
    id: 'mailketing_credits',
    component: 'mailketing:MailketingCreditsWidget',
    position: 'sidebar',
    priority: 50,
    frame: false
  }
]);
```

### 4.4 Tenant Awareness

The `useTenant` hook provides the currently selected tenant context. All API calls should include `tenant_id` unless they are super-admin global operations.

```jsx
const { currentTenant } = useTenant();
// Use currentTenant.id in mutations
```
