# Component Guide

## Purpose
Define UI component patterns for the admin panel and shared components.

## Audience
- Frontend developers working in `awcms/`

## Prerequisites
- `awcms/docs/00-core/CORE_STANDARDS.md`
- `awcms/docs/02-reference/TECH_STACK.md`

## Core Concepts

- Use shadcn/ui primitives from `awcms/src/components/ui`.
- Use TailwindCSS tokens and CSS variables (no hardcoded colors).
- Use `useToast` for user feedback.

## How It Works

- UI primitives are composed into dashboard and module components.
- Shared utilities live in `awcms/src/lib/utils.js`.

## Implementation Patterns

### Button

```jsx
import { Button } from '@/components/ui/button';

<Button variant="secondary">Secondary</Button>
```

### Dialog

```jsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

<Dialog>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Title</DialogTitle>
    </DialogHeader>
  </DialogContent>
</Dialog>
```

### Toast

```jsx
import { useToast } from '@/components/ui/use-toast';

const { toast } = useToast();

toast({ title: 'Saved', description: 'Changes saved successfully' });
```

## Permissions and Access

- Components must use `usePermissions()` for access checks.
- Use `useTenant()` for tenant context when rendering tenant data.

## Security and Compliance Notes

- Avoid hardcoded colors; use Tailwind tokens or CSS variables.
- Validate input and handle errors with destructive toasts.

## Operational Concerns

- Keep component structure aligned with `awcms/docs/02-reference/FOLDER_STRUCTURE.md`.

## References

- `../03-features/ADMIN_UI_ARCHITECTURE.md`
- `../03-features/ABAC_SYSTEM.md`
