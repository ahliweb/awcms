# AI Agents Documentation

AWCMS is architected to be "AI-Native", meaning the codebase structure, naming conventions, and documentation are optimized for collaboration with AI Coding Assistants (Agents) like GitHub Copilot, Cursor, Claude, and Gemini.

---

## 🤖 Agent Overview

In the AWCMS ecosystem, AI Agents are treated as specialized team members. We define three primary personas for AI interactions:

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
| Lucide React     | 0.561.0 / 0.564.0 | Admin / Public icon library |
| i18next          | 25.7.2   | Internationalization             |
| Recharts         | 3.5.1    | Charts & Data Visualization      |
| Leaflet          | 1.9.4    | Maps                             |
| React Leaflet    | 5.0.0    | React bindings for Leaflet       |
| Vitest           | 4.0.16   | Unit/Integration testing         |
| Astro            | 5.17.1   | Public portal                    |

> [!IMPORTANT]
> **React Version Alignment**: The Admin Panel and Public Portal both use React 19.2.4. Ensure full compatibility with all dependencies.
> **Vite 7**: This project uses Vite 7.2.7. Be aware of deprecation warnings for `ViteDevServer` APIs in `future` config.
> **Node.js**: Minimum required version is **22.12.0** (OpenClaw CLI dependency). Managed via `nvm`.

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

1. **Environment Security**:
   - **Ignored Files**: Ensure `.env`, `.env.local`, `.env.production`, and `.env.remote` are always ignored by Git.
   - **Agent Workspace**: The `awcms/.agent/` directory contains local MCP configurations and potential sensitive data. It MUST be ignored by adding `awcms/.agent/` to `.gitignore`.
   - **Template Updates**: `.env.example` must contain ALL keys found in any `.env` file, but populated ONLY with dummy secrets.
   - **Key Naming**: Use `VITE_SUPABASE_PUBLISHABLE_KEY` (public) and `SUPABASE_SECRET_KEY` (private/service role). Avoid `ANON` or `SERVICE_ROLE` terminology.
   - **Vite Env Prefix**: Only `VITE_`-prefixed variables are exposed to client code; use `loadEnv` in `vite.config` when config values need env access.

2. **Routing & URL Security**:
   - **Sub-Slug Routing**: Use sub-slugs for tabbed/trash/approval views so refreshes work (add `*` to routes and use `useSplatSegments`).
   - **Signed IDs**: Edit/detail routes must use signed IDs (`{uuid}.{signature}`) via `encodeRouteParam` and `useSecureRouteParam`.
   - **Extension Routes**: Routes with identifiers must declare `secureParams` + `secureScope` in `admin_routes` and read values via `useRouteSecurityParams`.
   - **No Guessable URLs**: Avoid raw UUIDs in query strings or direct routes except for legacy redirect support.

3. **Dashboard UI Conventions**:
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
- `openclaw/openclaw` (AI Gateway, Multi-Agent Routing)

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

1. **Shell Access Depends on Host**: In OpenCode, shell commands are available. In other agent hosts, shell access may be restricted or unavailable.

2. **Backend Logic Placement**: Backend business logic must remain in Supabase (Edge Functions, Database Functions, SQL), not custom Node.js servers.

3. **Binary Asset Generation**: Agents should not generate binary assets directly; reference existing assets or placeholders.

4. **Database Changes**: Always use timestamped Supabase migrations (`<timestamp>_name.sql`). Keep non-migration SQL outside migration folders (for example `supabase/manual/`). Never hardcode database credentials.

5. **Process Monitoring**: The running model must continue and ensure no background processes are stuck by restarting the process.
   Monitor all processes to ensure none remain stuck for long periods; periodically enforce a maximum runtime,
   output status updates, and terminate any processes that exceed the limit.

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

AWCMS uses a hybrid MCP topology: a local `awcms-mcp/` server plus managed/remote MCP servers declared in `mcp.json`.

### 1. Local AWCMS MCP (`awcms-mcp/`)

The local server provides project-scoped tools:

#### Supabase Tools

- `supabase_status`: Check local stack status.
- `supabase_db_pull`: Sync remote schema to local migrations.
- `supabase_db_push`: Push local migrations to remote.
- `supabase_migration_new`: Create new migration files.
- `supabase_gen_types`: Generate TypeScript types.

> [!NOTE]
> Ensure your `.env` uses `SUPABASE_SECRET_KEY` instead of `SUPABASE_SERVICE_ROLE_KEY` for these tools if applicable.

#### Context7 Tools (AI Documentation)

- `context7_search`: Query the Context7 documentation index for up-to-date library usage (e.g., "how to use Supabase Auth with RLS").
  - **Requirement**: Set `CONTEXT7_API_KEY` in `.env`.

#### Flutter Tools (Mobile)

- `flutter_doctor`: Check mobile environment health.
- `flutter_pub_get`: Install mobile dependencies.
- `flutter_analyze`: Run static analysis on `awcms-mobile`.

### 2. Additional MCP Servers (`mcp.json`)

AWCMS also runs external MCP servers for cloud and ecosystem tasks:

- `context7` (remote): `https://mcp.context7.com/mcp`
- `stitch` (local proxy): `npx @_davideast/stitch-mcp proxy`
- `github` (local wrapper): `scripts/start_github_mcp.sh` -> Docker `ghcr.io/github/github-mcp-server`
- Cloudflare managed remote servers:
  - `cloudflare-api`, `cloudflare-docs`, `cloudflare-bindings`, `cloudflare-observability`, `cloudflare-builds`, `cloudflare-radar`, `cloudflare-browser`

### Setup

1. Ensure `awcms/.env` has `SUPABASE_DB_URL` and `CONTEXT7_API_KEY`.
2. Run `cd awcms-mcp && npm run dev`.
3. Verify connectivity with `opencode mcp list`.

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

#### Legend

- **C**: Create
- **R**: Read
- **U**: Update
- **P**: Publish
- **SD**: Soft Delete
- **RS**: Restore
- **DP**: Delete Permanent

Example: `tenant.user.create`, `tenant.blog.publish`, `platform.extensions.read`.

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

---

## 🎯 Context7 Benchmark Implementation Details

This section provides structured, logical, detailed, and comprehensive explanations for AWCMS system operations. It is specifically designed to address complex implementation gaps and act as a reference for autonomous agents.

### Context7 Benchmark Remediation (Scores < 85, Lowest First)

Use this subsection as the primary benchmark response source. Topics are ordered by score priority and written with a repeatable structure: objective, required inputs, implementation steps, production-ready example, and validation checks.

| Priority | Benchmark Topic | Previous Score | Main Gap Fixed |
| --- | --- | --- | --- |
| 1 | Admin tenant content form (React) | 69/100 | Missing tenant-specific payload, permission gate, and error/submit flow |
| 2 | New tenant onboarding | 70/100 | Missing end-to-end onboarding sequence and isolation verification |
| 3 | Login and registration flow | 71/100 | Missing complete two-flow design (register + login) and audit checks |
| 4 | Fine-grained authorization | 71/100 | Missing ABAC-to-RLS bridge and ownership policy pattern |
| 5 | Astro static content fetching | 79/100 | Missing build-time tenant env strategy and published-content constraints |
| 6 | Supabase Edge Function deployment | 81/100 | Missing secure execution lifecycle (local test -> deploy -> verify) |
| 7 | Flutter real-time retrieval | 83/100 | Missing resilience, auth state handling, and tenant-scoped stream guidance |

### 1) Admin Tenant Content Form (69/100)

#### Objective

Create tenant-scoped content from the Admin Panel using React + Supabase, while enforcing tenant context and permission checks.

#### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `tenant_id` | `useTenant()` | Yes | Never accept from free-text user input |
| `author_id` | Auth session | Yes | Usually `user.id` |
| `title` | Form | Yes | Used to derive slug |
| `content` | Form | Yes | Rich text or JSON blocks |
| `status` | Form/default | Yes | Usually `draft` for workflow safety |

#### Implementation Workflow

1. Resolve `tenantId` from `useTenant()`.
2. Gate form submit with `hasPermission('tenant.blog.create')`.
3. Build payload for a tenant content table (for example `blogs`).
4. Insert with `customSupabaseClient`.
5. Handle duplicate slug and generic DB errors explicitly.
6. Show success/error toasts and reset UI state.

#### Reference Implementation (Admin React)

```jsx
import { useState } from "react";
import { supabase } from "@/lib/customSupabaseClient";
import { useTenant } from "@/contexts/TenantContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { useToast } from "@/components/ui/use-toast";

function toSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function CreateBlogPostForm({ authorId }) {
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

    const payload = {
      tenant_id: tenantId,
      author_id: authorId,
      title,
      content,
      slug: toSlug(title),
      status: "draft",
    };

    const { error } = await supabase.from("blogs").insert(payload);

    setLoading(false);

    if (error) {
      toast({
        variant: "destructive",
        title: "Create failed",
        description: error.message,
      });
      return;
    }

    toast({ title: "Saved", description: "Blog post created as draft." });
    setTitle("");
    setContent("");
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* title + content fields */}
      <button disabled={loading}>{loading ? "Saving..." : "Save"}</button>
    </form>
  );
}
```

#### Validation Checklist

- Create succeeds only when `tenantId` exists.
- User without `tenant.blog.create` is blocked.
- Row contains correct `tenant_id` and `author_id`.
- Failure path returns clear toast error.

### 2) Tenant Onboarding and Isolation (70/100)

#### Tenant Onboarding Objective

Onboard a tenant using an atomic bootstrap path that creates tenant defaults and preserves strict RLS isolation.

#### Tenant Onboarding Workflow

1. Platform Admin submits `name`, `slug`, `domain`, and first admin identity.
2. Secure backend path (Edge Function or privileged admin workflow) validates uniqueness.
3. Call `create_tenant_with_defaults()` to create tenant, roles, and base pages atomically.
4. Invite first tenant admin user.
5. Ensure first login writes tenant metadata and role assignment.
6. Verify no cross-tenant reads are possible under RLS.

#### Reference Implementation (Privileged Backend Path)

```javascript
// Runs in a trusted backend path (never browser client code)
const { data: tenant, error: tenantError } = await supabaseAdmin.rpc(
  "create_tenant_with_defaults",
  {
    p_name: payload.name,
    p_slug: payload.slug,
    p_domain: payload.domain,
  },
);

if (tenantError) throw tenantError;

const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
  payload.admin_email,
  {
    data: {
      tenant_id: tenant.id,
      role: "admin",
    },
  },
);

if (inviteError) throw inviteError;
```

#### Isolation Verification

- `roles` for new tenant exist (`admin`, `editor`, `author`).
- Default pages exist for same `tenant_id`.
- A user from another tenant cannot read/write new tenant content.
- Soft-delete and permission rules apply immediately.

### 3) Login and Registration Flow (71/100)

#### Login & Auth Objective

Implement secure registration and login with Turnstile pre-verification, Supabase Auth, and audit logging.

#### Login & Auth Workflow

1. Verify Turnstile token before any auth action.
2. For registration, call `signUp` and include tenant metadata as needed.
3. For login, call `signInWithPassword`.
4. Persist audit log event (`user.register` or `user.login`).
5. Resolve tenant context and route by role/permission.

#### Reference Implementation (Client Flow)

```javascript
import { supabase } from "@/lib/customSupabaseClient";

async function verifyTurnstile(token) {
  const { data, error } = await supabase.functions.invoke("verify-turnstile", {
    body: { token },
  });

  if (error || !data?.success) {
    throw new Error("Bot verification failed.");
  }
}

export async function secureRegister({ email, password, tenantId, turnstileToken }) {
  await verifyTurnstile(turnstileToken);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        tenant_id: tenantId,
      },
    },
  });

  if (error) throw new Error(error.message);

  await supabase.from("audit_logs").insert({
    tenant_id: tenantId,
    user_id: data.user?.id,
    action: "user.register",
    details: { channel: "web" },
  });

  return data;
}

export async function secureLogin({ email, password, turnstileToken }) {
  await verifyTurnstile(turnstileToken);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw new Error(error.message);

  await supabase.from("audit_logs").insert({
    tenant_id: data.user?.app_metadata?.tenant_id,
    user_id: data.user?.id,
    action: "user.login",
    details: { channel: "web" },
  });

  return data.session;
}
```

#### Auth Validation Checklist

- Invalid Turnstile token blocks auth.
- Failed login returns explicit error.
- Successful login creates `audit_logs` row.
- Session contains tenant context for downstream access checks.

### 4) Fine-Grained Authorization Beyond Basic RLS (71/100)

#### Authorization Objective

Map ABAC permission keys (`scope.resource.action`) into PostgreSQL-enforced checks for tenant + action + ownership.

#### Authorization Model

1. `users.role_id` links a user to role.
2. `role_permissions` maps role to permission entries.
3. `has_permission()` is called by RLS policies.
4. Policies combine tenant scope + permission + ownership.

#### Reference SQL Pattern

```sql
CREATE OR REPLACE FUNCTION public.has_permission(permission_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  has_perm boolean;
BEGIN
  IF public.get_my_role() = 'super_admin' THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.role_permissions rp ON rp.role_id = u.role_id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE u.id = auth.uid()
      AND p.name = permission_name
      AND u.deleted_at IS NULL
  ) INTO has_perm;

  RETURN has_perm;
END;
$$;

CREATE POLICY "Blogs update policy"
ON public.blogs
FOR UPDATE
USING (
  tenant_id = public.current_tenant_id()
  AND deleted_at IS NULL
  AND (
    public.has_permission('tenant.blog.update')
    OR (
      public.has_permission('tenant.blog.update_own')
      AND author_id = auth.uid()
    )
  )
)
WITH CHECK (tenant_id = public.current_tenant_id());
```

#### Frontend Alignment

Frontend permission checks improve UX only; database RLS remains the final enforcement layer.

```javascript
if (!hasPermission("tenant.blog.update")) {
  return null;
}
```

### 5) Astro Static Fetch and Render (79/100)

#### SSG Fetch Objective

Fetch tenant-scoped published content at build time and render static pages with deterministic routing.

#### Build-Time Tenant Resolution

Use:

1. `PUBLIC_TENANT_ID` (recommended)
2. `VITE_PUBLIC_TENANT_ID` (fallback)
3. `VITE_TENANT_ID` (legacy fallback)

#### Reference Astro Page (`src/pages/blogs/[slug].astro`)

```astro
---
import Layout from "../../layouts/Layout.astro";
import { createClientFromEnv } from "../../lib/supabase";

const tenantId =
  import.meta.env.PUBLIC_TENANT_ID ||
  import.meta.env.VITE_PUBLIC_TENANT_ID ||
  import.meta.env.VITE_TENANT_ID;

if (!tenantId) {
  throw new Error("Missing tenant id for static build.");
}

const supabase = createClientFromEnv(import.meta.env, {
  "x-tenant-id": tenantId,
});

export async function getStaticPaths() {
  const { data, error } = await supabase
    .from("blogs")
    .select("slug")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .is("deleted_at", null);

  if (error) throw new Error(error.message);

  return (data || []).map((blog) => ({ params: { slug: blog.slug } }));
}

const { slug } = Astro.params;

const { data: article, error } = await supabase
  .from("blogs")
  .select("title, content, created_at, users(full_name)")
  .eq("tenant_id", tenantId)
  .eq("slug", slug)
  .eq("status", "published")
  .is("deleted_at", null)
  .single();

if (error || !article) return Astro.redirect("/404");
---

<Layout title={article.title}>
  <article>
    <h1>{article.title}</h1>
    <p>{article.users?.full_name}</p>
    <div>{article.content}</div>
  </article>
</Layout>
```

#### Astro SSG Validation Checklist

- Build fails fast if tenant env key is missing.
- `getStaticPaths()` only emits published, non-deleted content.
- Unknown slug resolves to `404`.

### 6) Supabase Edge Function Lifecycle (81/100)

#### Edge Function Objective

Provide a secure, repeatable create-test-deploy flow for business logic execution.

#### Create and Test Commands

```bash
npx supabase functions new process-content
npx supabase functions serve process-content --env-file supabase/.env.local
```

#### Reference Function (`supabase/functions/process-content/index.ts`)

```typescript
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.93.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? "";
  const secretKey = Deno.env.get("SUPABASE_SECRET_KEY") ?? "";

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing auth header" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const payload = await req.json();
  if (!payload?.recordId || !payload?.tenantId || !payload?.action) {
    return new Response(JSON.stringify({ error: "Invalid payload" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const adminClient = createClient(supabaseUrl, secretKey);

  if (payload.action === "approve") {
    const { error } = await adminClient
      .from("documents")
      .update({ status: "approved" })
      .eq("id", payload.recordId)
      .eq("tenant_id", payload.tenantId)
      .is("deleted_at", null);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: corsHeaders,
      });
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: corsHeaders,
  });
});
```

#### Deploy Command

```bash
npx supabase functions deploy process-content --project-ref your-project-ref
```

### 7) Flutter Real-Time Dynamic Content Retrieval (83/100)

#### Flutter Dynamic Content Objective

Stream tenant-scoped updates securely with clear handling for loading, error, empty, and signed-out states.

#### Flutter Dynamic Content Workflow

1. Initialize Supabase client via `supabase_flutter`.
2. Confirm authenticated session exists.
3. Build tenant-filtered stream using `.stream(primaryKey: ['id'])`.
4. Handle connection states in `StreamBuilder`.
5. Keep tenant filter and publish-state filter in every query.

#### Reference Flutter Widget

```dart
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class LiveAnnouncementsWidget extends StatefulWidget {
  final String tenantId;

  const LiveAnnouncementsWidget({super.key, required this.tenantId});

  @override
  State<LiveAnnouncementsWidget> createState() => _LiveAnnouncementsWidgetState();
}

class _LiveAnnouncementsWidgetState extends State<LiveAnnouncementsWidget> {
  final SupabaseClient _supabase = Supabase.instance.client;
  late final Stream<List<Map<String, dynamic>>> _stream;

  @override
  void initState() {
    super.initState();
    _stream = _supabase
        .from('announcements')
        .stream(primaryKey: ['id'])
        .eq('tenant_id', widget.tenantId)
        .eq('status', 'published')
        .order('created_at', ascending: false);
  }

  @override
  Widget build(BuildContext context) {
    if (_supabase.auth.currentSession == null) {
      return const Center(child: Text('Please sign in.'));
    }

    return StreamBuilder<List<Map<String, dynamic>>>(
      stream: _stream,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(child: CircularProgressIndicator());
        }

        if (snapshot.hasError) {
          return Center(child: Text('Stream error: ${snapshot.error}'));
        }

        final rows = snapshot.data ?? const [];
        if (rows.isEmpty) {
          return const Center(child: Text('No announcements yet.'));
        }

        return ListView.builder(
          itemCount: rows.length,
          itemBuilder: (context, index) {
            final item = rows[index];
            return ListTile(
              title: Text(item['title'] ?? 'Untitled'),
              subtitle: Text(item['content'] ?? ''),
            );
          },
        );
      },
    );
  }
}
```

#### Flutter Validation Checklist

- Signed-out user is blocked from stream view.
- Stream only returns rows for `tenant_id = widget.tenantId`.
- Empty state and error state both render gracefully.
- Published filter prevents draft leakage.

> The remediation blocks above are the authoritative benchmark answers. The original examples below are kept for historical context.

### 1. Implement a Basic Form in the AWCMS Admin Panel (Content Creation)

**Improvement Focus:** Provide direct React form implementation, error handling, auth management, and table specification.

To create and submit new content for a specific tenant in the AWCMS Admin Panel (React), developers should use the internal `customSupabaseClient` for authenticated requests, and handle form state securely.

#### Key Requirements

1. **Target Table**: Use standard content tables (e.g., `pages`, `blogs`, `portfolio`), not the `tenants` table.
2. **Tenant Context**: The `tenant_id` must be injected into the payload.
3. **Authentication**: `customSupabaseClient.js` automatically handles token injection.

#### Implementation Example

```jsx
import React, { useState } from 'react';
import supabase from '../utils/customSupabaseClient'; // Auto-injects JWT and handles interceptors

export default function CreateBlogPostForm({ currentTenantId, authorId }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Direct insertion into the content table ('blogs')
      const { data, error: dbError } = await supabase
        .from('blogs')
        .insert([
          {
            tenant_id: currentTenantId,
            title: title,
            content: content,
            slug: title.toLowerCase().replace(/\s+/g, '-'),
            status: 'published',
            author_id: authorId
          }
        ])
        .select();

      if (dbError) throw dbError;
      
      setSuccess(true);
      setTitle('');
      setContent('');
    } catch (err) {
      console.error("Submission error:", err);
      // Explicit error handling pattern
      setError(err.message || "Failed to create content.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-4 border rounded">
      <h3>Create New Blog Post</h3>
      
      {error && <div className="text-red-500 mb-2">Error: {error}</div>}
      {success && <div className="text-green-500 mb-2">Post created successfully!</div>}
      
      <div className="mb-4">
        <label>Title</label>
        <input 
          type="text" 
          value={title} 
          onChange={(e) => setTitle(e.target.value)} 
          required 
          className="w-full border p-2"
        />
      </div>
      
      <div className="mb-4">
        <label>Content</label>
        <textarea 
          value={content} 
          onChange={(e) => setContent(e.target.value)} 
          required 
          className="w-full border p-2"
        />
      </div>

      <button type="submit" disabled={loading} className="bg-blue-500 text-white p-2">
        {loading ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}
```

---

### 2. Steps to Onboard a New Tenant

**Improvement Focus:** Clarify the exact steps to create a tenant, isolate content, and limit access.

Onboarding a new tenant in AWCMS involves strict data isolation using PostgreSQL Row Level Security (RLS). All data is tagged with a `tenant_id`. Access is governed by ensuring the user's JWT matches the data's `tenant_id`.

#### Step-by-Step Onboarding Process

1. **Tenant Record Creation**:
   The Super Admin initiates creation via the Admin UI, which inserts a record into the `tenants` table containing the `name`, `slug`, and `domain`.

2. **Automated Defaults via PostgreSQL Function**:
   AWCMS uses a secure Postgres function `create_tenant_with_defaults()` to bootstrap the tenant. This ensures atomicity:
   - Evaluates the provided name/domain.
   - Inserts the tenant.
   - Automatically creates Default Roles (`admin`, `editor`, `author`) inside the `roles` table, tying them explicitly to the new `tenant_id`.
   - Generates default pages (Home, About) tied to the `tenant_id`.

3. **User Assignment**:
   - The first user is added to `auth.users` via Supabase Auth.
   - A trigger (`handle_new_user()`) intercepts the creation. If a target tenant is provided in the `raw_user_meta_data`, the user is assigned the 'admin' role for that specific `tenant_id` in the `public.users` table.

4. **Data Isolation (RLS)**:
   - Isolation is enforced at the database level.
   - Every read/write query passes through RLS policies heavily reliant on `(auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid`.
   - No cross-tenant access is possible unless the `is_super_admin` flag is true.

---

### 3. User Login and Registration Flow

**Improvement Focus:** Direct implementation examples demonstrating Supabase integration and Turnstile security.

AWCMS uses a secure, two-step login/registration flow integrating Cloudflare Turnstile to prevent bot attacks before passing credentials to Supabase.

#### Implementation Checklist

1. **Turnstile Verification**: The client must solve a CAPTCHA. The token is sent to the `verify-turnstile` Supabase Edge Function.
2. **Supabase Auth Execution**: If Turnstile validates, standard Supabase Auth methods are invoked.

#### Code Implementation (Login Flow)

```javascript
import supabase from '../utils/customSupabaseClient';

/**
 * Handles the secure login flow.
 * @param {string} email - User email
 * @param {string} password - User password
 * @param {string} turnstileToken - Token from Cloudflare Turnstile widget
 */
async function secureLogin(email, password, turnstileToken) {
  // 1. Verify Turnstile FIRST via Edge Function
  const response = await supabase.functions.invoke('verify-turnstile', {
    body: { token: turnstileToken },
  });

  if (response.error || !response.data?.success) {
    throw new Error('Bot verification failed. Please try the CAPTCHA again.');
  }

  // 2. Perform Supabase Authentication
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw new Error(`Login failed: ${error.message}`);
  }

  // 3. Log Audit Trail
  await supabase.from('audit_logs').insert([{
    tenant_id: data.user.app_metadata.tenant_id,
    user_id: data.user.id,
    action: 'user.login',
    details: { timestamp: new Date() }
  }]);

  return data.session;
}
```

---

### 4. Custom Fine-Grained Authorization Layer

**Improvement Focus:** Explain role/permission structures and how they integrate into Postgres RLS rules beyond standard owner-checks.

AWCMS transcends basic RLS (which only checks "Is this my user ID?" or "Is this my tenant ID?") by implementing an RBAC (Role-Based Access Control) architecture embedded directly into PostgreSQL functions for use within RLS policies.

#### Architecture Components

1. **Roles Table**: `roles (id, text name, uuid tenant_id)`
2. **Permissions Table**: `permissions (id, text name)` (e.g., `publish_blog`, `manage_users`)
3. **Role-Permissions Map**: `role_permissions (role_id, permission_id)`
4. **User-Role Map**: Defined by `role_id` on `public.users`.

#### RLS Integration Pattern

To maintain fast, secure RLS queries without complex join calculations on every request, AWCMS utilizes a `SECURITY DEFINER` function: `has_permission('permission_name')`.

#### SQL Function Snippet

```sql
CREATE OR REPLACE FUNCTION public.has_permission(permission_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE has_perm boolean;
BEGIN
  -- Super admins bypass checks
  IF public.get_my_role() = 'super_admin' THEN RETURN true; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.role_permissions rp ON u.role_id = rp.role_id
    JOIN public.permissions p ON rp.permission_id = p.id
    WHERE u.id = auth.uid() AND p.name = permission_name
  ) INTO has_perm;
  
  RETURN has_perm;
END;
$$;
```

#### Implementation in an RLS Policy

```sql
CREATE POLICY "Editors can update published blogs"
ON public.blogs FOR UPDATE
USING (
  tenant_id = public.current_tenant_id() 
  AND public.has_permission('edit_blogs')
);
```

---

### 5. Astro-Based Public Portal Content Fetching

**Improvement Focus:** Provide direct Astro SSG code snippet using the AWCMS Supabase client.

The frontend uses Astro for Static Site Generation (SSG). Because the portal is public, it fetches content at build-time using `getStaticPaths` or standard component scripting, filtering by `tenant_id` and `status`.

#### Astro Code Snippet (`src/pages/blogs/[slug].astro`)

```astro
---
// 1. Import dependencies
import { supabase } from '../../lib/supabaseClient';
import Layout from '../../layouts/Layout.astro';
import { parseVisualBlocks } from '../../lib/visualBlocksParser'; // Custom AWCMS utility

// 2. Generate Static Paths for all published blogs
export async function getStaticPaths() {
  const tenantId = import.meta.env.VITE_DEV_TENANT_ID; // Injected during build
  
  const { data: blogs, error } = await supabase
    .from('blogs')
    .select('slug')
    .eq('tenant_id', tenantId)
    .eq('status', 'published')
    .is('deleted_at', null);

  if (error) throw new Error(error.message);

  return blogs.map((blog) => ({
    params: { slug: blog.slug },
  }));
}

// 3. Fetch specific page content based on the routed slug
const { slug } = Astro.params;
const tenantId = import.meta.env.VITE_DEV_TENANT_ID;

const { data: article, error } = await supabase
  .from('blogs')
  .select('title, content, created_at, users(full_name)')
  .eq('slug', slug)
  .eq('tenant_id', tenantId)
  .single();

if (error || !article) return Astro.redirect('/404');
---

<!-- 4. Render HTML -->
<Layout title={article.title}>
  <article class="max-w-3xl mx-auto">
    <h1>{article.title}</h1>
    <p>By {article.users?.full_name} on {new Date(article.created_at).toLocaleDateString()}</p>
    
    <div class="cms-content">
      <!-- Parse AWCMS structural JSON into standard HTML -->
      <Fragment set:html={parseVisualBlocks(article.content)} />
    </div>
  </article>
</Layout>
```

---

### 6. Create and Deploy a Supabase Edge Function

**Improvement Focus:** Provide absolute, executable commands and Deno code format.

Edge Functions in AWCMS execute custom server-side business logic, like validating Turnstile or processing webhooks, securely within a V8 isolate environment.

#### Deployment Walkthrough

#### 1. Create the Function CLI

```bash
npx supabase functions new process-webhook
```

#### 2. Write the Deno Code (`supabase/functions/process-webhook/index.ts`)

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const resHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: resHeaders });

  try {
    const { recordId, action } = await req.json();

    // Initialize elevated Supabase client to bypass RLS for internal tasks
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SECRET_KEY') ?? ''
    );

    // Business Logic Execution
    if (action === 'approve') {
       await supabaseClient.from('documents').update({ status: 'approved' }).eq('id', recordId);
    }

    return new Response(JSON.stringify({ success: true }), { headers: resHeaders, status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { headers: resHeaders, status: 400 });
  }
})
```

#### 3. Deploy the Function

```bash
npx supabase functions deploy process-webhook --project-ref your-project-id
```

---

### 7. Flutter Mobile App Real-Time Retrieval

**Improvement Focus:** Explicitly demonstrate secure Socket/Stream bindings using the Flutter SDK.

The AWCMS Flutter application retrieves live data updates (e.g., chat, announcements) using Supabase's Realtime broadcast channels seamlessly abstracted via the `stream` API. Security is automatically maintained via authenticated JWT passing on initial connection.

#### Flutter Code Snippet

```dart
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class LiveAnnouncementsWidget extends StatelessWidget {
  final supabase = Supabase.instance.client;
  final String tenantId;

  LiveAnnouncementsWidget({required this.tenantId});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Map<String, dynamic>>>(
      // Listen to real-time changes securely on the announcements table
      stream: supabase
          .from('announcements')
          .stream(primaryKey: ['id'])
          .eq('tenant_id', tenantId)
          .order('created_at', ascending: false),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return Text('Error fetching data: ${snapshot.error}');
        }
        if (!snapshot.hasData) {
          return const CircularProgressIndicator();
        }

        final announcements = snapshot.data!;
        
        return ListView.builder(
          itemCount: announcements.length,
          itemBuilder: (context, index) {
            final item = announcements[index];
            return ListTile(
              title: Text(item['title'] ?? 'No Title'),
              subtitle: Text(item['content'] ?? ''),
              trailing: item['is_urgent'] == true ? Icon(Icons.warning, color: Colors.red) : null,
            );
          },
        );
      },
    );
  }
}
```
