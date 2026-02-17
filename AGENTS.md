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
- Working with **Astro 5.17.1** and **React 19.2.4** (Static output + Islands).
  - Implementing **Zod** schemas for component prop validation.
  - Optimizing for Cloudflare Pages static builds (cache headers, asset optimization).
- **Constraints**:
  - **NO** direct database access (must use Supabase JS Client or Functions).
- **NO** Puck editor runtime in the public portal (use `Render` from `@puckeditor/core` only).

---

## 🔧 Current Tech Stack

Agents must be aware of the exact versions in use:

| Technology       | Version  | Notes                            |
| ---------------- | -------- | -------------------------------- |
| React            | 19.2.4   | Functional components only       |
| Vite             | 7.2.7    | Build tool & dev server          |
| TailwindCSS      | 4.1.18   | Admin uses CSS-based config      |
| Supabase JS      | 2.93.3 / 2.93.3 | Admin / Public clients     |
| React Router DOM | 7.10.1   | Client-side routing              |
| Puck             | 0.21.0   | Visual Editor (`@puckeditor/core`) |
| TipTap           | 3.13.0   | Rich text editor (XSS-safe)      |
| Framer Motion    | 12.23.26 | Animations                       |
| Radix UI         | Latest   | Accessible UI primitives         |
| Lucide React     | 0.561.0  | Icon library                     |
| i18next          | 25.7.2   | Internationalization             |
| Recharts         | 3.5.1    | Charts & Data Visualization      |
| Leaflet          | 1.9.4    | Maps                             |
| Vitest           | 4.0.16   | Unit/Integration testing         |
| Astro            | 5.17.1   | Public portal                    |

> [!IMPORTANT]
> **React Version Alignment**: The Admin Panel and Public Portal both use React 19.2.4. Ensure full compatibility with all dependencies.
> **Vite 7**: This project uses Vite 7.2.7. Be aware of deprecation warnings for `ViteDevServer` APIs in `future` config.

---

## 📋 Agent Guidelines

To ensure successful code generation and integration, Agents must adhere to the following strict guidelines:

### Core Principles

1. **Context First**: Before generating code, read `README.md` and related component files to understand the existing patterns.

2. **Multi-Tenancy Awareness**:
   - **RLS is Sacred**: Never bypass RLS unless explicitly creating a Platform Admin feature (using `auth_is_admin()` or Service Role).
   - **Tenant Context**: Always use `useTenant()` or `usePermissions()` to get `tenantId`.
   - **Public Portal Tenant Context**: Static builds use `PUBLIC_TENANT_ID`/`VITE_PUBLIC_TENANT_ID`; avoid `Astro.locals` in build-time code.
   - **Tenancy**: Use `tenant_id` for all isolation. Respect the **5-level** hierarchy limit.
   - **Roles**: Use the **10-level** Staff Hierarchy (`public.roles.staff_level`) for workflow logic. See [HIERARCHY.md](docs/tenancy/HIERARCHY.md).
   - **Soft Delete**: `deleted_at` IS NULL check is mandatory.
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
| **Admin Panel**   | React 19.2.4, Vite 7                                                      |
| **Public Portal** | Astro 5.17.1 (static output), React 19.2.4                                  |
| Styling           | TailwindCSS 4 utilities (Public uses Vite plugin + `tailwind.config.mjs`) |
| Backend           | Supabase only (NO Node.js servers)                                        |

5. **Environment Security**:
   - **Ignored Files**: Ensure `.env`, `.env.local`, `.env.production`, and `.env.remote` are always ignored by Git.
   - **Agent Workspace**: The `awcms/.agent/` directory contains local MCP configurations and potential sensitive data. It MUST be ignored by adding `awcms/.agent/` to `.gitignore`.
   - **Template Updates**: `.env.example` must contain ALL keys found in any `.env` file, but populated ONLY with dummy secrets.
   - **Key Naming**: Use `VITE_SUPABASE_PUBLISHABLE_KEY` (public) and `SUPABASE_SECRET_KEY` (private/service role). Avoid `ANON` or `SERVICE_ROLE` terminology.
   - **Vite Env Prefix**: Only `VITE_`-prefixed variables are exposed to client code; use `loadEnv` in `vite.config` when config values need env access.

6. **Routing & URL Security**:
   - **Sub-Slug Routing**: Use sub-slugs for tabbed/trash/approval views so refreshes work (add `*` to routes and use `useSplatSegments`).
   - **Signed IDs**: Edit/detail routes must use signed IDs (`{uuid}.{signature}`) via `encodeRouteParam` and `useSecureRouteParam`.
   - **Extension Routes**: Routes with identifiers must declare `secureParams` + `secureScope` in `admin_routes` and read values via `useRouteSecurityParams`.
   - **No Guessable URLs**: Avoid raw UUIDs in query strings or direct routes except for legacy redirect support.

7. **Dashboard UI Conventions**:
   - **Widget Headers**: Use `title`, `icon`, `badge`, or a `header` object for plugin widgets so the dashboard renders consistent headers.
   - **Widget Frames**: Prefer the default widget frame; avoid wrapping plugin widgets in custom cards unless `frame` is disabled.

### Context7 (Primary Reference)

When updating docs or implementing library usage, **Context7 is the primary reference**. Use the following verified library IDs with `context7_search`:

- `supabase/supabase-js` (Auth, Database)
- `vitejs/vite` (Build Tooling)
- `withastro/astro` (Public Portal)
- `remix-run/react-router` (Routing v7)
- `websites/react_dev` (React 19)
- `websites/tailwindcss` (v4 CSS-first)
- `ueberdosis/tiptap-docs` (Rich Text)
- `puckeditor/puck` (Visual Editor)
- `grx7/framer-motion` (Animations)

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
| `useSplatSegments`     | `src/hooks/useSplatSegments.js`     | Sub-slug routing segments      |
| `useSecureRouteParam`  | `src/hooks/useSecureRouteParam.js`  | Signed route param decoding    |
| `useRouteSecurityParams` | `src/hooks/useRouteSecurityParams.js` | Secure params for plugin routes |
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
| `src/lib/routeSecurity.js`           | Signed route param helpers              |
| `src/components/dashboard/widgets/DashboardWidgetHeader.jsx` | Shared dashboard widget header |
| `src/components/routing/SecureRouteGate.jsx` | Secured plugin route wrapper |
| `src/contexts/RouteSecurityContext.jsx` | Secure route param context |

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

### Dashboard Widget Headers

Use the shared dashboard header style for widgets to keep cards consistent:

```javascript
import DashboardWidgetHeader from '@/components/dashboard/widgets/DashboardWidgetHeader';
import { BarChart3 } from 'lucide-react';

function ExampleWidget() {
  return (
    <Card className="dashboard-surface dashboard-surface-hover">
      <DashboardWidgetHeader title="Analytics" icon={BarChart3} badge="Live" />
      <CardContent className="pt-4">...</CardContent>
    </Card>
  );
}
```

### Route Security (Plugin Routes)

For extension routes that accept identifiers, declare `secureParams` and `secureScope` and read values with `useRouteSecurityParams`:

```javascript
addFilter('admin_routes', 'analytics_routes', (routes) => [
  ...routes,
  {
    path: 'analytics/reports/:id',
    element: AnalyticsReport,
    permission: 'ext.analytics.reports',
    secureParams: ['id'],
    secureScope: 'ext.analytics.reports'
  }
]);
```

```javascript
import useRouteSecurityParams from '@/hooks/useRouteSecurityParams';

const AnalyticsReport = () => {
  const { id } = useRouteSecurityParams();
  // id is decoded UUID
};
```

### Route Security (Core Routes)

Use signed IDs for core edit/detail screens so URLs are not guessable:

```javascript
import { encodeRouteParam } from '@/lib/routeSecurity';

const handleEdit = async (role) => {
  const routeId = await encodeRouteParam({ value: role.id, scope: 'roles.edit' });
  if (!routeId) return;
  navigate(`/cmspanel/roles/edit/${routeId}`);
};
```

```javascript
import useSecureRouteParam from '@/hooks/useSecureRouteParam';
import { useParams } from 'react-router-dom';

const RoleEditor = () => {
  const { id: routeParam } = useParams();
  const { value: roleId } = useSecureRouteParam(routeParam, 'roles.edit');
  // roleId is decoded UUID or null
};
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

5. **Database Changes**: Always use timestamped Supabase migrations (`<timestamp>_name.sql`); ignore `current_*.sql` snapshots. Never hardcode database credentials.

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

### Client Initialization (Context7)

```javascript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: "pkce",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: "supabase-auth-token",
  },
  db: {
    schema: "public",
  },
  global: {
    headers: {
      "x-application-name": "awcms",
    },
    // fetch: customFetchImplementation,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
```

### Soft Delete Pattern

```javascript
// AWCMS uses soft delete - never use .delete()
const { error } = await supabase
  .from("blogs")
  .update({ deleted_at: new Date().toISOString() })
  .eq("id", blogId);
```

### User Profile Details (Extended)

Store extended profile metadata in `user_profiles` and keep admin-only data in `user_profile_admin` with pgcrypto encryption. Access admin fields via RPC to preserve RLS boundaries.

```javascript
// Read admin-only profile fields (requires tenant.user.update)
const { data, error } = await supabase.rpc('get_user_profile_admin_fields', {
  p_user_id: userId,
});

// Update admin-only profile fields (encrypted server-side)
await supabase.rpc('set_user_profile_admin_fields', {
  p_user_id: userId,
  p_admin_notes: notes,
  p_admin_flags: flags,
});
```

### React Router 7 Data Loading

Prefetch data using loaders rather than `useEffect` where possible (Admin Panel):

```javascript
// src/routes/dashboard.tsx
import { useLoaderData } from "react-router-dom";
import { supabase } from "@/lib/customSupabaseClient";

export async function loader({ request }) {
  const { data, error } = await supabase.from("stats").select("*");
  if (error) throw new Response("Error loading stats", { status: 500 });
  return data;
}

export default function Dashboard() {
  const stats = useLoaderData();
  return <div>{/* render stats */}</div>;
}
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

> [!NOTE]
> Ensure your `.env` uses `SUPABASE_SECRET_KEY` instead of `SUPABASE_SERVICE_ROLE_KEY` for these tools if applicable.

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

- **Scopes**: `platform`, `tenant`, `content`, `module`
- **Actions**: `create` (C), `read` (R), `update` (U), `publish` (P), `delete` (SD), `restore` (RS), `permanent_delete` (DP).
- **Special Flags**: `U-own` (Update Own Only) - requires checking `user_id` against resource owner.

### Standard Permission Matrix

Agents must strictly adhere to this matrix when implementing access controls:

📌 _Semua permission hanya berlaku dalam tenant masing-masing_

| Role                     |  C  |  R  |  U   |  P  | SD  | RS  | DP  | Description                     |
| :----------------------- | :-: | :-: | :--: | :-: | :-: | :-: | :-: | :------------------------------ |
| **Owner (Platform)**     | ✅  | ✅  |  ✅  | ✅  | ✅  | ✅  | ✅  | Supreme authority (Platform)    |
| **Super Admin (Platform)**| ✅  | ✅  |  ✅  | ✅  | ✅  | ✅  | ✅  | Platform management (Platform)  |
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

Example: `tenant.user.create`, `tenant.blog.publish`, `tenant.extensions.read`.

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
