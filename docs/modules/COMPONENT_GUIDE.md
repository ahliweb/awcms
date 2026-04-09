# Component Guide

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

## Purpose

Define the current component patterns for the admin app and related shared UI surfaces: primitives, layout conventions, permission-aware rendering, styling rules, and common implementation expectations.

## Current Component Model

Current AWCMS component work in `awcms/` is built around:

- shadcn/ui-style primitives under `awcms/src/components/ui`
- Tailwind/CSS-variable-based styling
- layout/page wrappers used by manager screens
- `cn()` for conditional classes
- toast-driven feedback for important user actions

## Current Styling Rules

- use semantic Tailwind utilities and CSS variables
- avoid hardcoded hex colors in component code
- preserve white-labeling and dark-mode compatibility
- use current tenant theme variables where the feature depends on tenant branding

## Current Utility Rules

- use `cn()` from the current utils layer for class composition
- use the current shared UI primitives before inventing local one-off replacements
- use toasts for meaningful success/error feedback rather than silent failures

## Current Permission And Tenant Rules

- permission-sensitive components should use `usePermissions()`
- tenant-aware rendering/data operations should use `useTenant()` or the current hook/context path for the surface being edited
- UI checks are not the final authority, but they should still be present where the UX depends on them

## Current Common Patterns

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

toast({ title: 'Saved', description: 'Changes saved successfully' });
toast({ variant: 'destructive', title: 'Error', description: 'Failed to save' });
```

## Current Layout Integration

Component work should align with the current admin shell and manager patterns instead of drifting into isolated page-specific structures.

Current practical rule:

- if a component is part of a manager/module surface, keep it compatible with the current shared page/layout/header structure

## Current Motion / Interaction Guidance

- use current motion patterns deliberately where interaction benefits from them
- avoid gratuitous animation or overly custom motion systems when current shared patterns suffice

## Current Data/Mutation Guardrails

- validate and normalize user-visible errors
- keep tenant scoping explicit in data flows
- keep destructive actions aligned with current soft-delete and permission rules

## Validation Guidance

| Surface | Validation |
| --- | --- |
| admin component changes | `cd awcms && npm run build` |
| maintained docs | `cd awcms && npm run docs:check` |
| public/shared implications | run the relevant workspace validation when the component pattern crosses workspace boundaries |

## Related Docs

- [docs/modules/ADMIN_UI_ARCHITECTURE.md](./ADMIN_UI_ARCHITECTURE.md)
- [docs/security/abac.md](../security/abac.md)
- [docs/architecture/standards.md](../architecture/standards.md)
