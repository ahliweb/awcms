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

## 3.1 Environment Variables (Vite)

- Client-exposed env vars must use the `VITE_` prefix.
- Use `import.meta.env` in runtime code; use `loadEnv` in `vite.config` when env values are required at config time.

## 4. Common Tasks

### 4.1 Adding a New Module

1. Register the module in `resources_registry` (scope, db_table, permission_prefix).
2. Create a `Manager` component in `src/components/dashboard/`.
3. Add a route in `src/components/MainRouter.jsx` (use `/<module>/*` if the module needs sub-slugs for tabs or trash views).
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

Local development uses `VITE_DEV_TENANT_SLUG` (default `primary`) on localhost. If tenant resolution fails, run `node awcms/src/scripts/seed-primary-tenant.js`.

```jsx
const { currentTenant } = useTenant();
// Use currentTenant.id in mutations
```

## 5. Tenant Content Form (Benchmark-Ready)

### Objective

Create a tenant-aware form that inserts draft content while enforcing permissions and author ownership.

### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `tenantId` | `useTenant()` | Yes | Scope for all inserts |
| Permission | `usePermissions()` | Yes | `tenant.blog.create` |
| `author_id` | `auth.getUser()` | Yes | Do not trust caller input |
| `slug` | Derived from title | Yes | Enforce per-tenant uniqueness |

### Workflow

1. Block submit if tenant context is missing.
2. Block submit if permission is missing.
3. Resolve current user and build payload with `status: 'draft'`.
4. Insert via `customSupabaseClient` and handle duplicate slug errors.
5. Show toast on success/failure and reset form state.

### Reference Implementation

```javascript
import { useState } from "react";
import { supabase } from "@/lib/customSupabaseClient";
import { useTenant } from "@/contexts/TenantContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/components/ui/use-toast";

const toSlug = (value) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

export default function CreateBlogPostForm() {
  const { tenantId } = useTenant();
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!tenantId) {
      toast({ variant: "destructive", title: "Missing tenant context" });
      return;
    }

    if (!hasPermission("tenant.blog.create")) {
      toast({ variant: "destructive", title: "Permission denied" });
      return;
    }

    setLoading(true);
    const { data: authData } = await supabase.auth.getUser();
    const user = authData?.user;

    if (!user) {
      setLoading(false);
      toast({ variant: "destructive", title: "Session expired" });
      return;
    }

    const { error } = await supabase.from("blogs").insert({
      tenant_id: tenantId,
      author_id: user.id,
      title,
      content,
      slug: toSlug(title),
      status: "draft",
    });

    setLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Create failed",
        description: error.code === "23505" ? "Slug already exists." : error.message,
      });
      return;
    }

    toast({ title: "Saved", description: "Draft created." });
    setTitle("");
    setContent("");
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* inputs and submit button */}
    </form>
  );
}
```

### Validation Checklist

- Insert is blocked without tenant context.
- User without `tenant.blog.create` cannot submit.
- `author_id` matches authenticated user.
- Duplicate slugs return a friendly error.

### Failure Modes and Guardrails

- Hardcoded tenant IDs: always use `useTenant()`.
- Publishing on create: keep `status = 'draft'` and require publish permission.
- Silent errors: use toast feedback for all error paths.
