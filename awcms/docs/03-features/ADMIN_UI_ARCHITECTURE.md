# Admin UI Architecture

## Purpose
Describe the admin layout system and the shared template components.

## Audience
- Admin panel developers

## Prerequisites
- `awcms/docs/03-features/COMPONENT_GUIDE.md`
- `awcms/docs/03-features/ABAC_SYSTEM.md`

## Core Concepts

- Admin pages use `awcms/src/templates/awadmintemplate01`.
- `AdminPageLayout` handles permission checks and tenant context display.
- Tables and forms use shared components for consistency.

## How It Works

- `AdminPageLayout` reads `requiredPermission` for access control.
- `PageHeader` standardizes titles, actions, and breadcrumbs.
- `DataTable` provides search, pagination, and bulk actions.

## Implementation Patterns

```jsx
import { AdminPageLayout, PageHeader } from '@/templates/awadmintemplate01';

<AdminPageLayout requiredPermission="tenant.page.read">
  <PageHeader title="Pages" description="Manage pages" />
</AdminPageLayout>
```

## Permissions and Access

- Use `requiredPermission` for route-level access.
- Use `usePermissions()` inside components for finer-grained checks.

## Security and Compliance Notes

- Always enforce tenant scoping in data queries.
- Avoid hardcoded colors; use Tailwind tokens.

## References

- `../03-features/COMPONENT_GUIDE.md`
- `../00-core/SECURITY.md`
