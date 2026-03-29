---
description: Enforce ABAC permission naming, UI hooks, and DB policy patterns
---

# ABAC Enforcer

## When This Rule Applies

- Adding new features that require permission checks
- Creating or modifying RLS policies
- Adding UI components with action buttons (create, edit, delete, approve)
- Modifying the `permissions` or `role_permissions` tables

## Permission Key Format

**Format**: `scope.resource.action`

| Scope | Usage |
|-------|-------|
| `platform` | Cross-tenant operations (Owner/Super Admin only) |
| `tenant` | Tenant-scoped operations |
| `content` | Content-specific operations |
| `module` | Module/extension operations |
| `ext` | Extension-provided operations |

**Examples**: `tenant.blog.create`, `platform.tenant.manage`, `content.page.publish`

## Frontend Enforcement

```javascript
import { usePermissions } from '@/contexts/PermissionContext';

function ActionButton() {
  const { hasPermission } = usePermissions();

  if (!hasPermission('tenant.blog.create')) {
    return null; // Don't render if no permission
  }
  return <Button onClick={handleCreate}>Create</Button>;
}
```

## Database Enforcement

```sql
-- RLS policy pattern
CREATE POLICY blogs_insert_policy ON public.blogs
FOR INSERT WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND author_id = auth.uid()
  AND public.has_permission('tenant.blog.create')
);
```

## Checklist for New Permissions

1. Add permission key to `permissions` table via migration
2. Assign to appropriate roles in `role_permissions`
3. Add UI check via `hasPermission()` in relevant component
4. Add RLS policy check via `has_permission()` in relevant table policy
5. Document in `docs/security/abac.md`

## Never Do

- ❌ Invent permission key formats outside `scope.resource.action`
- ❌ Check permissions in UI but skip DB-level enforcement
- ❌ Use role names directly instead of permission keys
- ❌ Grant permissions not defined in the `permissions` table

## References

- [docs/security/abac.md](../../docs/security/abac.md)
- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.3
- [AGENTS.md](../../AGENTS.md) Permission Checks section
