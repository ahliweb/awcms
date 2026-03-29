---
description: UI component change checklist for admin panel
---

# UI Change Workflow

// turbo-all

## Steps

1. **Check design system** — Use `shadcn/ui` components from `@/components/ui/`. Use semantic TailwindCSS classes (`bg-primary`, `text-foreground`) — no hardcoded hex.

2. **Check permissions** — If the component has action buttons, wrap in `hasPermission()`:

   ```javascript
   const { hasPermission } = usePermissions();
   if (!hasPermission('tenant.resource.action')) return null;
   ```

3. **Check tenant scope** — All data-fetching must include `tenant_id`:

   ```javascript
   const { tenantId } = useTenant();
   ```

4. **Check soft delete** — All read queries filter deleted rows:

   ```javascript
   .is('deleted_at', null)
   ```

5. **Build**

```bash
cd /home/data/dev_react/awcms-dev/awcms && npm run build
```

1. **Test manually** — Verify the component renders correctly with different roles and tenant contexts.

2. **Update docs** if adding a new module or changing component structure.
