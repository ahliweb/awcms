# Admin Panel Development

## 1. Overview

The Admin Panel (`awcms/`) is a React SPA built with Vite. It serves as the central management interface for all tenants.

## 2. Key Technologies

- **Framework**: React 19.2.3
- **Build Tool**: Vite 7
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

1. Create a `Manager` component in `src/components/dashboard/`.
2. Add a route in `src/components/MainRouter.jsx`.
3. Add a sidebar item in `src/templates/flowbite-admin/components/Sidebar.jsx`.

### 4.2 Handling Permissions

Use the `usePermissions` hook to guard UI elements:

```jsx
const { hasPermission } = usePermissions();

if (hasPermission('tenant.article.create')) {
  <Button>Create Article</Button>
}
```

### 4.3 Tenant Awareness

The `useTenant` hook provides the currently selected tenant context. All API calls should include `tenant_id` unless they are super-admin global operations.

```jsx
const { currentTenant } = useTenant();
// Use currentTenant.id in mutations
```
