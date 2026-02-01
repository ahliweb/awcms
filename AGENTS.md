# AI Agents Documentation

AWCMS is architected to be "AI-Native", meaning the codebase structure, naming conventions, and documentation are optimized for collaboration with AI Coding Assistants (Agents) like GitHub Copilot, Cursor, Claude, and Gemini.

---

## 🤖 Agent Overview

In the AWCMS ecosystem, AI Agents are treated as specialized team members. We define two primary personas for AI interactions:

### 1. The Coding Agent (Architect/Builder)

- **Focus**: Implementation, Refactoring, Bug Fixing.
- **Capabilities**:
  - Full context awareness of React 19/Vite 7/Supabase constraints.
  - Ability to generate complex UI components using `shadcn/ui` patterns.
  - Writing SQL migrations for Supabase.
  - Updating system hooks (e.g., `useSearch`, `useAdminMenu`, `useMedia`, `useTwoFactor`).
- **Responsibility**: Ensuring code quality, functional patterns, and adhering to the "Single Source of Truth" principle.

### 2. The Communication Agent (Documenter/Explainer)

- **Focus**: Documentation, Changelogs, PR Descriptions.
- **Capabilities**:
  - Summarizing technical changes for non-technical stakeholders.
  - Updating Markdown files in `docs/` folder.
  - Generating "How-to" guides based on code analysis.
- **Responsibility**: Maintaining the accuracy of documentation relative to the codebase state.

### 3. The Public Experience Agent (Frontend Specialist)

- **Focus**: Public Portal (`awcms-public`), Astro Islands, Performance.
- **Capabilities**:
  - Working with **Astro 5** and **React 19.2.3** (Islands Architecture).
  - Implementing **Zod** schemas for component prop validation.
  - Optimizing for Cloudflare Pages (Edge Cache, Headers).
- **Constraints**:
  - **NO** direct database access (must use Supabase JS Client or Functions).
  - **NO** Puck editor runtime in the public portal (use `PuckRenderer` only; `@puckeditor/puck` is types-only).

---

## 🔧 Current Tech Stack

Agents must be aware of the exact versions in use:

| Technology       | Version  | Notes                            |
| ---------------- | -------- | -------------------------------- |
| React            | 19.2.3   | Functional components only       |
| Vite             | 7.2.7    | Build tool & dev server          |
| TailwindCSS      | 4.1.18   | Admin uses CSS-based config      |
| Supabase JS      | 2.87.1   | Admin client (respects RLS)      |
| React Router DOM | 7.10.1   | Client-side routing              |
| Puck             | 0.21.0   | Visual Editor (@puckeditor/puck) |
| TipTap           | 3.13.0   | Rich text editor (XSS-safe)      |
| Framer Motion    | 12.23.26 | Animations                       |
| Radix UI         | Latest   | Accessible UI primitives         |
| Lucide React     | 0.561.0  | Icon library                     |
| i18next          | 25.7.2   | Internationalization             |
| Recharts         | 3.5.1    | Charts & Data Visualization      |
| Leaflet          | 1.9.4    | Maps                             |
| Vitest           | 4.0.16   | Unit/Integration testing         |

> [!IMPORTANT]
> **React Version Alignment**: The Admin Panel and Public Portal both use React 19.2.3. Ensure full compatibility with all dependencies.

---

## 📋 Agent Guidelines

To ensure successful code generation and integration, Agents must adhere to the following strict guidelines:

### Core Principles

1. **Context First**: Before generating code, read `README.md` and related component files to understand the existing patterns.

2. **Multi-Tenancy Awareness**:
   - **RLS is Sacred**: Never bypass RLS unless explicitly creating a Platform Admin feature (using `auth_is_admin()` or Service Role).
   - **Tenant Context**: Always use `useTenant()` or `usePermissions()` to get `tenantId`.
   - **Isolation**: Ensure all new tables have `tenant_id` and RLS policies.
   - **Permission Keys**: Use the strict format `scope.resource.action` (e.g., `tenant.post.publish`).
   - **Channel Restrictions**:
     - Governance/Publishing = `web` only.
     - Content Creation = `mobile` or `web`.
     - API = Read-heavy.

3. **Atomic Changes**: Do not attempt to rewrite the entire application in one pass. Break tasks into:
   - Database Schema Updates (SQL migrations)
   - Utility/Hook Creation
   - Component Implementation
   - Documentation Updates

4. **Strict Technology Constraints**:

| Rule              | Requirement                                                               |
| ----------------- | ------------------------------------------------------------------------- |
| Language          | Admin Panel: JavaScript ES2022+; Public Portal: TypeScript/TSX            |
| **Admin Panel**   | React 19.2.3, Vite 7                                                      |
| **Public Portal** | Astro 5, React 19.2.3, Cloudflare Pages                                   |
| Styling           | TailwindCSS 4 utilities (Public uses Vite plugin + `tailwind.config.mjs`) |
| Backend           | Supabase only (NO Node.js servers)                                        |

### Code Patterns

```javascript
// ✅ CORRECT: ES2022+ with hooks
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

function MyComponent({ data }) {
  const [state, setState] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    // Effect logic
  }, []);

  const handleAction = async () => {
    try {
      await doSomething();
      toast({ title: "Success", description: "Action completed" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    }
  };

  return <Button onClick={handleAction}>Action</Button>;
}

export default MyComponent;
```

```javascript
// ❌ INCORRECT: Class components, TypeScript, external imports
import React, { Component } from 'react';
import styles from './MyComponent.module.css'; // NO!
interface Props { data: any } // NO TypeScript!

class MyComponent extends Component<Props> { } // NO class components!
```

---

## 📁 Key Files Reference

### Contexts (Global State)

| File                                   | Purpose                           |
| -------------------------------------- | --------------------------------- |
| `src/contexts/SupabaseAuthContext.jsx` | Authentication state & methods    |
| `src/contexts/PermissionContext.jsx`   | ABAC permissions & role checks    |
| `src/contexts/PluginContext.jsx`       | Extension system & hook provider  |
| `src/contexts/ThemeContext.jsx`        | Dark/Light theme management       |
| `src/contexts/TenantContext.jsx`       | Multi-tenant context & resolution |
| `src/contexts/DarkModeContext.jsx`     | Dark mode toggle state            |
| `src/contexts/CartContext.jsx`         | Optional commerce cart state      |

### Core Libraries

| File                              | Purpose                               |
| --------------------------------- | ------------------------------------- |
| `src/lib/hooks.js`                | WordPress-style Action/Filter system  |
| `src/lib/customSupabaseClient.js` | Public Supabase client (respects RLS) |

| Hook                   | File                                | Purpose                        |
| ---------------------- | ----------------------------------- | ------------------------------ |
| `useAdminMenu`         | `src/hooks/useAdminMenu.js`         | Sidebar menu loading & state   |
| `useAuditLog`          | `src/hooks/useAuditLog.js`          | ERP Audit Logging & Compliance |
| `useDashboardData`     | `src/hooks/useDashboardData.js`     | Dashboard statistics           |
| `useDevices`           | `src/hooks/useDevices.js`           | IoT device management          |
| `useExtensionAudit`    | `src/hooks/useExtensionAudit.js`    | Extension audit logging        |
| `useMedia`             | `src/hooks/useMedia.js`             | Media library operations       |
| `useMobileUsers`       | `src/hooks/useMobileUsers.js`       | Mobile app user management     |
| `useNotifications`     | `src/hooks/useNotifications.js`     | Notification system            |
| `usePlatformStats`     | `src/hooks/usePlatformStats.js`     | Platform-wide statistics       |
| `usePublicTenant`      | `src/hooks/usePublicTenant.js`      | Public portal tenant resolving |
| `usePushNotifications` | `src/hooks/usePushNotifications.js` | Mobile push notifications      |
| `useRegions`           | `src/hooks/useRegions.js`           | 10-level region hierarchy      |
| `useSearch`            | `src/hooks/useSearch.js`            | Debounced search logic         |
| `useSensorData`        | `src/hooks/useSensorData.js`        | IoT sensor real-time data      |
| `useTemplates`         | `src/hooks/useTemplates.js`         | Template management            |
| `useTemplateStrings`   | `src/hooks/useTemplateStrings.js`   | i18n template strings          |
| `useTenantTheme`       | `src/hooks/useTenantTheme.js`       | Per-tenant theming             |
| `useTwoFactor`         | `src/hooks/useTwoFactor.js`         | 2FA setup & verification       |
| `useWidgets`           | `src/hooks/useWidgets.js`           | Widget system management       |
| `useWorkflow`          | `src/hooks/useWorkflow.js`          | Content workflow engine        |

### Utility Libraries

| File                                 | Purpose                                 |
| ------------------------------------ | --------------------------------------- |
| `src/lib/customSupabaseClient.js`    | Public Supabase client (respects RLS)   |
| `src/lib/supabaseAdmin.js`           | Admin client (bypasses RLS)             |
| `src/lib/utils.js`                   | Helper functions (`cn()`, etc.)         |
| `src/lib/extensionRegistry.js`       | Extension component mapping             |
| `src/lib/templateExtensions.js`      | Template/Widget/PageType extension APIs |
| `src/lib/widgetRegistry.js`          | Widget type definitions                 |
| `src/lib/themeUtils.js`              | Theme utilities                         |
| `src/lib/i18n.js`                    | i18next configuration                   |
| `src/lib/hooks.js`                   | WordPress-style Action/Filter system    |
| `src/lib/pluginRegistry.js`          | Core plugin registration                |
| `src/lib/publicModuleRegistry.js`    | Public portal module registry           |
| `src/lib/tierFeatures.js`            | Subscription tier feature gating        |
| `src/lib/regionUtils.js`             | Region hierarchy utilities              |
| `src/lib/externalExtensionLoader.js` | External extension dynamic loading      |

---

## 🛠️ Workflow Documentation

### 1. Feature Request Phase

- **User**: "Add a notification badge to the header."
- **Agent**: Analyzes:
  - `src/components/dashboard/Header.jsx`
  - `src/hooks/useNotifications.js`
  - Database table `notifications`

### 2. Implementation Phase

```text
Agent Action 1: Check if database table exists
Agent Action 2: Create/update hook for data fetching
Agent Action 3: Implement UI component with proper styling
Agent Action 4: Add toast notifications for user feedback
Agent Action 5: Update documentation if needed
```

### 3. Verification Phase

- Test the feature manually or describe how to test
- Ensure no breaking changes to existing functionality

---

## 🎨 UI Component Patterns

### Using shadcn/ui Components

```javascript
// Import from @/components/ui/
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
```

### Toast Notifications (Required)

```javascript
import { useToast } from "@/components/ui/use-toast";

const { toast } = useToast();

// Success
toast({ title: "Saved", description: "Changes saved successfully" });

// Error
toast({ variant: "destructive", title: "Error", description: error.message });
```

### TailwindCSS 4.1 Styling (Admin + Public)

```javascript
// Use utility classes directly
<div className="flex items-center gap-4 p-4 bg-background rounded-lg border">
  <span className="text-foreground font-medium">Content</span>
</div>

// Conditional classes with cn()
import { cn } from '@/lib/utils';

<div className={cn(
  "base-classes",
  isActive && "bg-primary text-primary-foreground",
  className
)}>
```

### Multi-Tenant Theming

Use CSS variables for colors and fonts to support white-labeling. **Do not hardcode hex values.**

```javascript
// ✅ CORRECT: Using variables
<div className="bg-[var(--primary)] text-white font-[var(--font-sans)]">
  My Brand Content
</div>

// ✅ CORRECT: Using Tailwind utilities mapped to variables
<div className="bg-primary text-primary-foreground font-sans">
  My Brand Content
</div>

// ❌ INCORRECT: Hardcoded values
<div className="bg-blue-600 font-inter">
  My Brand Content
</div>
```

---

## ⚠️ Agent Limitations

While powerful, Agents operating in this environment have specific boundaries:

1. **No Shell Access**: Agents cannot run `npm install` or execute shell commands directly in all environments.

2. **No File Deletion**: Agents can only create or overwrite files. Deprecated files must be manually cleaned up.

3. **Frontend Logic Only**: Backend logic must be implemented via Supabase (Edge Functions, Database Functions, or SQL), not Node.js servers.

4. **No Binary Files**: Agents cannot generate images or binary assets. Use placeholder descriptions or reference existing assets.

5. **Database Changes**: Always use Supabase migrations or SQL. Never hardcode database credentials.

---

## 📝 Supabase Integration Patterns

### Data Fetching

```javascript
import { supabase } from "@/lib/customSupabaseClient";

// Select with relations
const { data, error } = await supabase
  .from("blogs")
  .select(
    `
    *,
    author:users(id, full_name, avatar_url),
    category:categories(id, name)
  `,
  )
  .eq("status", "published")
  .is("deleted_at", null)
  .order("created_at", { ascending: false });
```

### Soft Delete Pattern

```javascript
// AWCMS uses soft delete - never use .delete()
const { error } = await supabase
  .from("blogs")
  .update({ deleted_at: new Date().toISOString() })
  .eq("id", blogId);
```

### File Upload

```javascript
const { data, error } = await supabase.storage
  .from("blogs")
  .upload(`images/${fileName}`, file, {
    cacheControl: "3600",
    upsert: false,
  });
```

### User Deletion with Permission Check

AWCMS implements a safety check before deleting users. Users cannot be deleted if their role has active permissions in the Permission Matrix.

```javascript
// Edge Function pattern (supabase/functions/manage-users/index.ts)
case 'delete': {
  // 1. Get user's role_id
  const { data: targetUser } = await supabaseAdmin
    .from('users')
    .select('role_id, role:roles!users_role_id_fkey(name)')
    .eq('id', user_id)
    .single();

  // 2. Check for active permissions
  const { count } = await supabaseAdmin
    .from('role_permissions')
    .select('*', { count: 'exact', head: true })
    .eq('role_id', targetUser.role_id);

  // 3. Block if permissions exist
  if (count > 0) {
    throw new Error('User has active permissions. Change role first.');
  }

  // 4. Proceed with soft delete
  await supabaseAdmin
    .from('users')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', user_id);
}
```

**Frontend Pattern**: Use `AlertDialog` from shadcn/ui for modern confirmation modals instead of native `confirm()`.

---

## 🔌 Unified MCP Server

AWCMS provides a "Swiss Army Knife" MCP server in `awcms-mcp/` that grants Agents capabilities across the entire stack.

### 1. Supabase Tools

- `supabase_status`: Check local stack status.
- `supabase_db_pull`: Sync remote schema to local migrations.
- `supabase_db_push`: Push local migrations to remote.
- `supabase_migration_new`: Create new migration files.
- `supabase_gen_types`: Generate TypeScript types.

### 2. Context7 Tools (AI Documentation)

- `context7_search`: Query the Context7 documentation index for up-to-date library usage (e.g., "how to use Supabase Auth with RLS").
  - **Requirement**: Set `CONTEXT7_API_KEY` in `.env`.

### 3. Flutter Tools (Mobile)

- `flutter_doctor`: Check mobile environment health.
- `flutter_pub_get`: Install mobile dependencies.
- `flutter_analyze`: Run static analysis on `awcms-mobile`.

### Setup

1. Ensure `awcms/.env` has `SUPABASE_DB_URL` and `CONTEXT7_API_KEY`.
2. Run `cd awcms-mcp && npm run dev`.

---

## 🔐 Permission Checks

### Key Format Compliance

Agents must use the standardized permission keys: `scope.resource.action`.

- **Scopes**: `platform`, `tenant`, `content`, `modules`
- **Actions**: `create` (C), `read` (R), `update` (U), `publish` (P), `delete` (SD), `restore` (RS), `delete_permanent` (DP).
- **Special Flags**: `U-own` (Update Own Only) - requires checking `user_id` against resource owner.

### Standard Permission Matrix

Agents must strictly adhere to this matrix when implementing access controls:

📌 _Semua permission hanya berlaku dalam tenant masing-masing_

| Role                     |  C  |  R  |  U   |  P  | SD  | RS  | DP  | Description                     |
| :----------------------- | :-: | :-: | :--: | :-: | :-: | :-: | :-: | :------------------------------ |
| **Owner (Global)**       | ✅  | ✅  |  ✅  | ✅  | ✅  | ✅  | ✅  | Supreme authority (Global)      |
| **Super Admin (Global)** | ✅  | ✅  |  ✅  | ✅  | ✅  | ✅  | ✅  | Platform management (Global)    |
| **Admin (Tenant)**       | ✅  | ✅  |  ✅  | ✅  | ✅  | ✅  | ✅  | Tenant management (Tenant)      |
| **Editor (Tenant)**      | ✅  | ✅  |  ✅  | ✅  | ✅  | ❌  | ❌  | Content review & approval       |
| **Author (Tenant)**      | ✅  | ✅  | ✅\* | ❌  | ❌  | ❌  | ❌  | Content creation & update own   |
| **Member**               | ❌  | ✅  |  ❌  | ❌  | ❌  | ❌  | ❌  | Commenting & Profile management |
| **Subscriber**           | ❌  | ✅  |  ❌  | ❌  | ❌  | ❌  | ❌  | Premium content access          |
| **Public**               | ❌  | ✅  |  ❌  | ❌  | ❌  | ❌  | ❌  | Read-only access                |
| **No Access**            | ❌  | ❌  |  ❌  | ❌  | ❌  | ❌  | ❌  | Banned/Disabled                 |

_\* Author → hanya konten milik sendiri (tenant_id + owner_id)_

> Platform admin access is determined by role flags (`is_platform_admin`/`is_full_access`), not role names.

**Legend:**

- **C**: Create
- **R**: Read
- **U**: Update
- **P**: Publish
- **SD**: Soft Delete
- **RS**: Restore
- **DP**: Delete Permanent

Example: `tenant.user.create`, `tenant.blog.publish`, `tenant.modules.read`.

### Implementation Pattern

```javascript
import { usePermissions } from "@/contexts/PermissionContext";

function MyComponent() {
  const { hasPermission, isPlatformAdmin, isFullAccess } = usePermissions();

  // Platform admin/full access bypasses all checks
  if (isPlatformAdmin || isFullAccess) {
    // Full access
  }

  // Permission-based rendering
  if (hasPermission("tenant.blog.update")) {
    return <EditButton />;
  }

  return null;
}
```

---

## 📚 Documentation Standards

When updating documentation:

1. Use tables for structured data
2. Include code examples with proper syntax highlighting
3. Keep version numbers accurate (check `package.json`)
4. Use relative links between docs files
5. Update `CHANGELOG.md` for significant changes
