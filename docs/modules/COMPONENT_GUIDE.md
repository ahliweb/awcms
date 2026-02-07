# Component Guide

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.4 - Styling & Theming  
> **Context7 Reference**: `/websites/tailwindcss`, `/websites/react_dev` - See [AGENTS.md](../../AGENTS.md)

## Purpose

Define UI component patterns for the admin panel and shared components.

## Audience

- Frontend developers working in `awcms/`

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - Styling and theming standards
- [AGENTS.md](../../AGENTS.md) - UI patterns and Context7 references
- [docs/architecture/standards.md](../architecture/standards.md) - Core implementation standards
- [docs/architecture/tech-stack.md](../architecture/tech-stack.md) - Technology versions

## Core Concepts

- Use shadcn/ui primitives from `awcms/src/components/ui`.
- Use TailwindCSS tokens and CSS variables (no hardcoded colors).
- Use `useToast` for user feedback.
- Use `cn()` from `awcms/src/lib/utils.js` for conditional class names.
- Use Framer Motion variants for coordinated animations when needed.

## How It Works

- UI primitives are composed into dashboard and module components.
- Shared utilities live in `awcms/src/lib/utils.js`.
- Layout components from `flowbite-admin` provide consistent page structure.

## Implementation Patterns

### Button

```jsx
import { Button } from '@/components/ui/button';

<Button variant="secondary">Secondary</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Cancel</Button>
```

### Conditional Classes

```jsx
import { cn } from '@/lib/utils';

<div className={cn('text-sm', isActive && 'text-primary')} />
```

### Dialog

```jsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Confirm Action</DialogTitle>
    </DialogHeader>
    <p>Are you sure?</p>
    <DialogFooter>
      <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
      <Button onClick={handleConfirm}>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Toast

```jsx
import { useToast } from '@/components/ui/use-toast';

const { toast } = useToast();

// Success
toast({ title: 'Saved', description: 'Changes saved successfully' });

// Error
toast({ variant: 'destructive', title: 'Error', description: 'Failed to save' });
```

### Card

```jsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

<Card>
  <CardHeader>
    <CardTitle>Settings</CardTitle>
  </CardHeader>
  <CardContent>
    {/* Card content */}
  </CardContent>
</Card>
```

### Tabs

```jsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

<Tabs defaultValue="general">
  <TabsList>
    <TabsTrigger value="general">General</TabsTrigger>
    <TabsTrigger value="advanced">Advanced</TabsTrigger>
  </TabsList>
  <TabsContent value="general">General settings</TabsContent>
  <TabsContent value="advanced">Advanced settings</TabsContent>
</Tabs>
```

## Permissions and Access

- Components must use `usePermissions()` for access checks:

```jsx
const { hasPermission, userRole, isPlatformAdmin, tenantId } = usePermissions();

if (hasPermission('tenant.blog.create')) {
  // Show create button
}
```

- Use `useTenant()` for tenant context when rendering tenant data:

```jsx
const { currentTenant } = useTenant();
```

## Security and Compliance Notes

- Avoid hardcoded colors; use Tailwind tokens or CSS variables.
- Validate input and handle errors with destructive toasts.
- Always scope data queries to the current tenant.

## Operational Concerns

- Keep component structure aligned with `docs/architecture/folder-structure.md`.
- Follow naming conventions: `*Manager.jsx` for admin modules.

## References

- `docs/modules/ADMIN_UI_ARCHITECTURE.md`
- `docs/security/abac.md`
