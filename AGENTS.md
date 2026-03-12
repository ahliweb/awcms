# AI Agents Documentation

AWCMS is architected to be "AI-Native", meaning the codebase structure, naming conventions, and documentation are optimized for collaboration with AI Coding Assistants (Agents) like GitHub Copilot, Cursor, Claude, and Gemini.

## Documentation Authority

All agent work must respect this chain:

1. `SYSTEM_MODEL.md` (primary source of truth)
2. `AGENTS.md` (this file)
3. `README.md` (canonical monorepo operational baseline)
4. `DOCS_INDEX.md` (documentation routing)
5. implementation/module docs in `docs/**`

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
  - **NO** direct database access (must use Supabase JS Client or approved server-side edge runtimes).
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
| Lucide React     | 0.564.0  | Admin / Public icon library      |
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
   - **RLS is Sacred**: Never bypass RLS unless explicitly creating a Platform Admin feature (using `auth_is_admin()` or a server-side `SUPABASE_SECRET_KEY` path inside approved edge runtimes).
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
| Backend           | Supabase (Auth, DB, RLS) + Cloudflare Workers (Edge Logic)                |

1. **Environment Security**:
   - **Ignored Files**: Ensure `.env`, `.env.local`, `.env.production`, and `.env.remote` are always ignored by Git.
   - **Agent Workspace**: The `awcms/.agent/` directory contains local MCP configurations and potential sensitive data. It MUST be ignored by adding `awcms/.agent/` to `.gitignore`.
   - **Template Updates**: `.env.example` must contain ALL keys found in any `.env` file, but populated ONLY with dummy secrets.
   - **Key Naming**: Use `VITE_SUPABASE_PUBLISHABLE_KEY` (public) and `SUPABASE_SECRET_KEY` (private/server-only). Avoid `ANON` or `SERVICE_ROLE` terminology.
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

When updating docs or implementing library usage, **Context7 is the primary reference**. Use the following verified library IDs:

- `supabase/supabase` (Platform guidance: database, RLS, migrations)
- `supabase/supabase-js` (Auth, Database)
- `supabase/cli` (Migration/CLI workflows)
- `vitejs/vite` (Build Tooling)
- `cloudflare/cloudflare-docs` (Workers, R2, Platform guidance)
- `withastro/docs` (Public Portal)
- `remix-run/react-router` (Routing v7)
- `websites/react_dev` (React 19)
- `websites/tailwindcss` (v4 CSS-first)
- `ueberdosis/tiptap-docs` (Rich Text)
- `puckeditor/puck` (Visual Editor)
- `grx7/framer-motion` (Animations)
- `openclaw/openclaw` (AI Gateway, Multi-Agent Routing)
- `ollama/ollama` (Self-hosted LLM runtime)
- `ollama/ollama-js` (Ollama Node.js SDK)

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

2. **Backend Logic Placement**: Backend business logic must remain in Cloudflare Workers (Edge Logic) and Supabase (Database Functions, SQL), not custom Node.js servers. Supabase Edge Functions are deprecated in favor of Cloudflare Workers.

3. **Edge API and Storage Ownership**: Supabase must not be used to manage the Edge API or file storage. Use the Cloudflare Edge API (`awcms-edge/`) for server-side HTTP workflows and Cloudflare R2 for object/file storage. Supabase is limited to Auth, Postgres, RLS, and ABAC.

4. **Binary Asset Generation**: Agents should not generate binary assets directly; reference existing assets or placeholders.

5. **Database Changes**: Always use timestamped Supabase migrations (`<timestamp>_name.sql`). Keep non-migration SQL outside migration folders (for example `supabase/manual/`). Never hardcode database credentials.

6. **Process Monitoring**: The running model must continue and ensure no background processes are stuck by restarting the process.
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
// Cloudflare Worker route pattern (awcms-edge/src/index.ts)
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
> Ensure your `.env` uses the canonical `SUPABASE_SECRET_KEY` name for privileged server-side access.

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
- `github` (local wrapper): `scripts/start_github_mcp.sh` -> Docker `ghcr.io/github/github-mcp-server`
- Cloudflare managed remote servers:
  - `cloudflare-api`, `cloudflare-docs`, `cloudflare-bindings`, `cloudflare-observability`, `cloudflare-builds`, `cloudflare-radar`, `cloudflare-browser`

### Setup

1. Ensure `awcms/.env` has `SUPABASE_DB_URL` and `CONTEXT7_API_KEY`.
2. Run `cd awcms-mcp && npm run dev`.
3. Verify connectivity with `opencode mcp list`.

---

## 🧠 Self-Hosted AI Models (Ollama)

AWCMS supports running local, open-source AI models via [Ollama](https://ollama.com) as an alternative or complement to cloud AI providers. Ollama provides an OpenAI-compatible API and native tool calling, making it a drop-in backend for OpenClaw.

> **Architecture Reference:** [docs/architecture/ollama-integration.md](docs/architecture/ollama-integration.md)

### Quick Setup

```bash
# 1. Install Ollama (see https://ollama.com for platform-specific installers)
# 2. Pull a tool-calling capable model
ollama pull qwen3
ollama pull llama3.2

# 3. Verify the service is running
curl http://localhost:11434/api/tags
```

### Integration via OpenAI SDK (Drop-In)

If AWCMS code already uses the `openai` SDK, point `baseURL` to Ollama:

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://localhost:11434/v1/',
  apiKey: 'ollama', // required by SDK but ignored by Ollama
});

const response = await client.chat.completions.create({
  model: 'qwen3',
  messages: [{ role: 'user', content: 'Summarize the latest blog posts.' }],
});
console.log(response.choices[0].message.content);
```

### Integration via Ollama Native SDK

```javascript
import ollama from 'ollama'

// Basic chat
const response = await ollama.chat({
  model: 'qwen3',
  messages: [{ role: 'user', content: 'Summarize tenant activity.' }],
})
console.log(response.message.content)

// Streaming
const stream = await ollama.chat({
  model: 'qwen3',
  messages: [{ role: 'user', content: 'Generate a status report.' }],
  stream: true,
})
for await (const part of stream) {
  process.stdout.write(part.message.content)
}
```

### Tool Calling Pattern

Ollama models like `qwen3` and `llama3.1` support function/tool calling:

```javascript
import ollama from 'ollama'

const tools = [{
  type: 'function',
  function: {
    name: 'get_tenant_stats',
    description: 'Get tenant usage statistics',
    parameters: {
      type: 'object',
      required: ['tenantId'],
      properties: {
        tenantId: { type: 'string', description: 'The tenant UUID' }
      }
    }
  }
}]

const messages = [{ role: 'user', content: 'Show stats for tenant abc-123' }]
const response = await ollama.chat({ model: 'qwen3', messages, tools })

if (response.message.tool_calls) {
  for (const call of response.message.tool_calls) {
    const result = await executeTool(call.function.name, call.function.arguments)
    messages.push(response.message)
    messages.push({ role: 'tool', content: JSON.stringify(result) })
  }
  // Get final answer with tool results
  const final = await ollama.chat({ model: 'qwen3', messages })
  console.log(final.message.content)
}
```

### OpenClaw Integration

To route a tenant to a local Ollama model, update `openclaw/openclaw.json`:

```json
{
  "id": "tenant_local",
  "workspace": "~/.openclaw/workspace-tenant-local",
  "model": {
    "primary": "ollama/qwen3",
    "baseUrl": "http://127.0.0.1:11434/v1"
  },
  "tools": { "profile": "coding" }
}
```

### Context7 Library IDs

- `ollama/ollama` — Runtime capabilities, API reference, model management
- `ollama/ollama-js` — Node.js SDK usage, streaming, tool calling patterns

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
6. For repository-wide doc changes, update `docs/dev/documentation-audit-plan.md` and `docs/dev/documentation-audit-tracker.md`

---

## 🔄 Workflow Standards

For standardized AI-assisted development workflows, see:

- **[docs/dev/ai-workflows.md](docs/dev/ai-workflows.md)** — Prompt templates, plan mode triggers, iteration loops
- **`.agents/workflows/`** — Step-by-step procedures:
  - `migration-workflow.md` — Safe database migration creation
  - `rls-change-workflow.md` — RLS/ABAC policy changes
  - `ui-change-workflow.md` — UI component changes
  - `ci-validation-workflow.md` — Build/lint/test gate
- **`.agents/rules/`** — Guardrail playbooks:
  - `tenancy-guard.md` — Tenant isolation enforcement
  - `rls-policy-auditor.md` — RLS coverage audit
  - `abac-enforcer.md` — Permission naming and enforcement
  - `migration-guardian.md` — Migration safety
  - `no-secrets-ever.md` — Secret prevention
  - `sanitize-and-render.md` — Content sanitization
  - `release-readiness.md` — Pre-release checklist
  - `styling-guard.md` — Semantic CSS variables enforcement
  - `soft-delete-enforcer.md` — Soft delete lifecycle enforcement
  - `edge-function-safety.md` — Supabase-only backend architecture

---

<!-- markdownlint-disable MD024 -->
## 🎯 Context7 Benchmark Implementation Details

This section provides structured, logical, detailed, and comprehensive explanations for all ten AWCMS benchmark topics.
Each topic follows a consistent six-part structure: Objective → Required Inputs → Workflow → Reference Implementation → Validation Checklist → Failure Modes and Guardrails.
Topics are ordered by priority (lowest score first).

### Context7 Benchmark Score Profile

| # | Benchmark Topic | Score | Target | Status |
| --- | --- | --- | --- | --- |
| 8 | Cloudflare Worker route for custom business logic | 46/100 | 92+ | Active — needs full lifecycle: create → test → deploy → verify |
| 7 | User login and registration with Supabase Auth | 79/100 | 92+ | Active — needs dual-flow (register + login), 2FA, tenant assignment |
| 6 | ESP32 IoT device configuration mechanism | 81/100 | 92+ | Active — needs full config push/apply/persist lifecycle |
| 10 | Monorepo versioning and independent deployment | 81/100 | 92+ | Active — needs additive schema strategy, path-filtered CI |
| 9 | Fine-grained ABAC authorization beyond basic RLS | 83/100 | 92+ | Active — needs ABAC-to-RLS bridge with ownership semantics |
| 4 | Astro Public Portal static content rendering | 87/100 | 92+ | Active — needs build-time tenant env, published-only queries |
| 5 | Flutter secure real-time content retrieval | 90/100 | 92+ | Stabilized — fallback path, session gate, tenant/status filters |
| 2 | Tenant onboarding and isolation | 92/100 | 92+ | Stabilized — full onboarding lifecycle, idempotency, isolation checks |
| 1 | Define new content type schema (Supabase) | 93/100 | 92+ | Stabilized — schema lifecycle, indexes, RLS policy set |
| 3 | Admin Panel content form (React) | 94/100 | 92+ | Stabilized — permission gate, author mapping, duplicate handling |

#### 1) Tenant Onboarding and Isolation in AWCMS (83/100)

##### Objective

Onboard a new tenant using a secure, idempotent, platform-admin flow that bootstraps tenant defaults and guarantees tenant isolation through RLS from first use.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `actor` | Auth session (`auth.getUser`) | Yes | Must be platform admin/full access or hold `platform.tenant.create` |
| `name` | Onboarding form/API | Yes | Human-readable tenant name |
| `slug` | Onboarding form/API | Yes | Unique tenant identifier; used in routing/domain mapping |
| `domain` | Onboarding form/API | Conditional | Required when custom-domain mode is used |
| `admin_email` | Onboarding form/API | Yes | First tenant admin invitation target |
| Bootstrap RPC | `create_tenant_with_defaults()` | Yes | Must atomically create tenant + default roles/content |
| Audit metadata | Request context | Yes | Store actor, request id, and created tenant id |

##### Workflow

1. Authenticate caller and enforce platform-level permission (`platform.tenant.create`) before any write.
2. Normalize `slug`/`domain` and enforce uniqueness checks in non-deleted scope.
3. Call `create_tenant_with_defaults()` using privileged server context (`SUPABASE_SECRET_KEY`) to create baseline tenant data atomically.
4. Invite the initial tenant admin via `auth.admin.inviteUserByEmail` with metadata (`tenant_id`, role hint).
5. Persist onboarding audit event and return an idempotent response payload (`tenant_id`, invite status).
6. Run isolation verification checks: cross-tenant read denial, default role presence, and default page/content existence.
7. Expose retry-safe behavior for partial failures (for example invite failed after tenant created).

##### Reference Implementation

```typescript
// awcms-edge/src/index.ts
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

const app = new Hono();

app.post('/functions/v1/platform-tenant-onboard', async (c) => {
  const req = c.req.raw;

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

  const { data: canCreateTenant } = await callerClient.rpc("has_permission", {
    permission_name: "platform.tenant.create",
  });

  if (!canCreateTenant) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  const payload = await req.json();
  if (!payload?.name || !payload?.slug || !payload?.admin_email) {
    return new Response(JSON.stringify({ error: "Missing required payload" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey);

  const { data: existingTenant } = await supabaseAdmin
    .from("tenants")
    .select("id")
    .eq("slug", payload.slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingTenant?.id) {
    return new Response(
      JSON.stringify({ error: "Slug already exists", tenant_id: existingTenant.id }),
      { status: 409, headers: corsHeaders },
    );
  }

  const { data: tenant, error: tenantError } = await supabaseAdmin.rpc(
    "create_tenant_with_defaults",
    {
      p_name: payload.name,
      p_slug: payload.slug,
      p_domain: payload.domain ?? null,
    },
  );

  if (tenantError || !tenant?.id) {
    return new Response(JSON.stringify({ error: tenantError?.message ?? "Create tenant failed" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
    payload.admin_email,
    {
      data: {
        tenant_id: tenant.id,
        role: "admin",
      },
    },
  );

  await supabaseAdmin.from("audit_logs").insert({
    tenant_id: tenant.id,
    user_id: authData.user.id,
    action: "platform.tenant.create",
    details: {
      slug: payload.slug,
      invite_status: inviteError ? "failed" : "sent",
    },
  });

  if (inviteError) {
    return new Response(
      JSON.stringify({
        tenant_id: tenant.id,
        warning: "Tenant created but invite failed. Retry invite from admin tools.",
      }),
      { status: 202, headers: corsHeaders },
    );
  }

  return new Response(JSON.stringify({ tenant_id: tenant.id, invite_status: "sent" }), {
    status: 201,
    headers: corsHeaders,
  });
});
```

##### Validation Checklist

- Platform user without `platform.tenant.create` cannot create tenants.
- Duplicate slug/domain onboarding attempts are rejected or handled idempotently.
- New tenant has default roles (`admin`, `editor`, `author`) and baseline pages/config created.
- Invited admin receives tenant metadata needed for first-login assignment.
- Cross-tenant reads/writes from non-privileged tenant users remain blocked by RLS.

##### Failure Modes and Guardrails

- **Failure:** Tenant created but invite fails. **Guardrail:** return `202` with retry instruction and keep audit trail.
- **Failure:** Concurrent duplicate onboarding requests. **Guardrail:** unique constraints + pre-check + conflict response.
- **Failure:** Missing tenant assignment on first login. **Guardrail:** enforce onboarding trigger/profile sync checks.
- **Failure:** Privileged endpoint abuse. **Guardrail:** enforce platform permission check and audit every create attempt.

#### 2) Define a New Content Type Schema in AWCMS (90/100)

##### Objective

Create a tenant-scoped content type that supports workflow states, high-performance reads, and strict multi-tenant isolation using Supabase migrations and PostgreSQL RLS.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `content_type` | Product/module spec | Yes | Example: `events`, `announcements`, `knowledge_base` |
| `tenant_id` | Tenant context/JWT claims | Yes | Isolation boundary |
| `author_id` | Auth session (`auth.uid()`) | Yes | Ownership and `update_own` policy |
| `status` lifecycle | Workflow design | Yes | Recommended: `draft`, `review`, `published`, `archived` |
| Permission prefix | Permission matrix | Yes | Example: `tenant.event.*` |
| Migration file | Supabase migration folder | Yes | Timestamped SQL only |

##### Workflow

1. Define table shape with explicit columns for filterable fields; use `jsonb` only for extensible metadata.
2. Add composite/partial indexes for tenant and publish state (`tenant_id`, `status`, `created_at`).
3. Enforce unique slug per tenant for non-deleted rows.
4. Enable RLS and create policy set for read/create/update/publish/delete semantics.
5. Enforce soft delete (`deleted_at`) across policies and app queries.
6. Map permission keys to AWCMS format (`scope.resource.action`).
7. Run migration and verify policies with multi-user tests (cross-tenant, owner, editor, admin).

##### Reference Implementation

```sql
-- supabase/migrations/<timestamp>_create_events_content_type.sql
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  author_id uuid not null references public.users(id),
  title text not null,
  slug text not null,
  summary text,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'published', 'archived')),
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists events_tenant_slug_unique
  on public.events (tenant_id, lower(slug))
  where deleted_at is null;

create index if not exists events_tenant_status_created_idx
  on public.events (tenant_id, status, created_at desc)
  where deleted_at is null;

alter table public.events enable row level security;

create policy events_select_policy
on public.events
for select
using (
  tenant_id = public.current_tenant_id()
  and deleted_at is null
  and public.has_permission('tenant.event.read')
);

create policy events_insert_policy
on public.events
for insert
with check (
  tenant_id = public.current_tenant_id()
  and author_id = auth.uid()
  and public.has_permission('tenant.event.create')
);

create policy events_update_policy
on public.events
for update
using (
  tenant_id = public.current_tenant_id()
  and deleted_at is null
  and (
    public.has_permission('tenant.event.update')
    or (
      public.has_permission('tenant.event.update_own')
      and author_id = auth.uid()
    )
  )
)
with check (tenant_id = public.current_tenant_id());
```

##### Validation Checklist

- Cross-tenant read/write attempts are denied by RLS.
- Duplicate `slug` is blocked only within the same tenant and non-deleted scope.
- `update_own` users can update only their rows.
- Published/public queries exclude soft-deleted rows.

##### Failure Modes and Guardrails

- **Failure:** Missing `tenant_id` in insert payload. **Guardrail:** `with check` requires `tenant_id = current_tenant_id()`.
- **Failure:** Slug collisions after restore. **Guardrail:** partial unique index + restore conflict handling.
- **Failure:** Query latency growth on listing pages. **Guardrail:** tenant/status/date index and pagination.

#### 3) Flutter Secure Real-Time or Near-Real-Time Retrieval (90/100)

##### Objective

Stream tenant-specific content to Flutter clients with safe auth handling, resilient fallback, and strict filtering to prevent cross-tenant or draft leakage.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `tenantId` | Auth profile or trusted app state | Yes | Must not come from arbitrary user input |
| Session | `Supabase.instance.client.auth.currentSession` | Yes | Signed-out users should not access streams |
| Table | Supabase table (`announcements`, etc.) | Yes | Must include tenant and status columns |
| Stream primary key | `.stream(primaryKey: ['id'])` | Yes | Required for realtime consistency |

##### Workflow

1. Initialize Supabase client via `supabase_flutter`.
2. Block access when no active session exists.
3. Build realtime stream with `.eq('tenant_id', tenantId)` and `.eq('status', 'published')`.
4. Add `deleted_at is null` filter in stream query.
5. Provide fallback one-shot fetch for temporary realtime/WebSocket failures.
6. Render explicit loading, error, empty, and success states.

##### Reference Implementation

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

  Future<List<Map<String, dynamic>>> _fallbackFetch() async {
    final rows = await _supabase
        .from('announcements')
        .select()
        .eq('tenant_id', widget.tenantId)
        .eq('status', 'published')
        .filter('deleted_at', 'is', null)
        .order('created_at', ascending: false);
    return List<Map<String, dynamic>>.from(rows);
  }

  @override
  void initState() {
    super.initState();
    _stream = _supabase
        .from('announcements')
        .stream(primaryKey: ['id'])
        .eq('tenant_id', widget.tenantId)
        .eq('status', 'published')
        .filter('deleted_at', 'is', null)
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
          return FutureBuilder<List<Map<String, dynamic>>>(
            future: _fallbackFetch(),
            builder: (context, fallback) {
              if (fallback.connectionState == ConnectionState.waiting) {
                return const Center(child: CircularProgressIndicator());
              }
              if (fallback.hasError) {
                return Center(child: Text('Connection error: ${fallback.error}'));
              }
              final rows = fallback.data ?? const [];
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

##### Validation Checklist

- Signed-out state is blocked before stream subscription.
- Query always includes `tenant_id`, `status = published`, and `deleted_at is null`.
- UI handles loading/error/empty/success deterministically.
- Fallback query provides near-real-time continuity during stream errors.

##### Failure Modes and Guardrails

- **Failure:** Tenant ID spoofing from UI input. **Guardrail:** derive tenant context from trusted profile/session claims.
- **Failure:** Draft leakage to public users. **Guardrail:** mandatory `status = published` filter.
- **Failure:** Empty screen on realtime outage. **Guardrail:** fallback fetch path.

#### 4) Admin Tenant Content Form (React) (97/100)

##### Objective

Implement a complete Admin form flow for tenant content creation with permission checks, tenant-aware payload construction, and robust success/error handling.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `tenantId` | `useTenant()` | Yes | Must exist before submit |
| Permission gate | `hasPermission('tenant.blog.create')` | Yes | UI and submit enforcement |
| `author_id` | `supabase.auth.getUser()` | Yes | Do not trust caller-provided author |
| `title`, `content` | Controlled form state | Yes | `slug` derived from title |

##### Workflow

1. Resolve tenant context and permission capabilities before submit.
2. Resolve authenticated user ID for `author_id`.
3. Build payload with `status: 'draft'` to avoid accidental publish.
4. Execute insert through `customSupabaseClient`.
5. Handle duplicate/constraint errors explicitly.
6. Emit toast notifications for both success and failure paths.

##### Reference Implementation

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
    const currentUser = authData?.user;

    if (!currentUser) {
      setLoading(false);
      toast({ variant: "destructive", title: "Session expired" });
      return;
    }

    const payload = {
      tenant_id: tenantId,
      author_id: currentUser.id,
      title,
      content,
      slug: toSlug(title),
      status: "draft",
    };

    const { error } = await supabase.from("blogs").insert(payload);
    setLoading(false);

    if (error) {
      const message = error.code === "23505"
        ? "Slug already exists in this tenant."
        : error.message;

      toast({
        variant: "destructive",
        title: "Create failed",
        description: message,
      });
      return;
    }

    toast({ title: "Saved", description: "Blog post created as draft." });
    setTitle("");
    setContent("");
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        required
      />
      <textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        required
      />
      <button disabled={loading}>{loading ? "Saving..." : "Save"}</button>
    </form>
  );
}
```

##### Validation Checklist

- Submit is blocked when tenant context is missing.
- User lacking `tenant.blog.create` cannot submit successfully.
- Inserted row contains correct `tenant_id` and `author_id`.
- Duplicate slug path returns explicit and user-friendly feedback.

##### Failure Modes and Guardrails

- **Failure:** Hardcoded `tenant_id` in UI. **Guardrail:** always source tenant from `useTenant()`.
- **Failure:** Posting directly as `published`. **Guardrail:** default `draft`, publish action separated by permission.
- **Failure:** Silent insert failures. **Guardrail:** explicit toast/error branch and loading reset.

#### 5) Fine-Grained Authorization Beyond Basic RLS (95/100)

##### Objective

Implement enforceable ABAC authorization in Supabase by mapping AWCMS permission keys to PostgreSQL functions and RLS policies with tenant and ownership constraints.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| Permission key | `permissions.name` | Yes | Must follow `scope.resource.action` |
| Role mapping | `users.role_id` -> `role_permissions` | Yes | Core ABAC relationship |
| Tenant resolver | `current_tenant_id()` | Yes | Isolation boundary |
| Owner field | Resource `author_id`/`owner_id` | For `*_own` | Enforces ownership semantics |

##### Workflow

1. Normalize permission keys in DB and frontend (`tenant.blog.update`, `tenant.blog.update_own`, etc.).
2. Implement `has_permission(permission_name text)` as `SECURITY DEFINER`.
3. Build RLS policies combining tenant scope + permission + ownership.
4. Keep frontend checks for UX only; database policy remains final authority.
5. Add route security for identifiers using signed params on edit/detail routes.

##### Reference Implementation

```sql
create or replace function public.has_permission(permission_name text)
returns boolean
language plpgsql
stable
security definer
as $$
declare
  has_perm boolean;
begin
  if public.get_my_role() = 'super_admin' then
    return true;
  end if;

  select exists (
    select 1
    from public.users u
    join public.role_permissions rp on rp.role_id = u.role_id
    join public.permissions p on p.id = rp.permission_id
    where u.id = auth.uid()
      and u.deleted_at is null
      and p.name = permission_name
  ) into has_perm;

  return has_perm;
end;
$$;

create policy blogs_update_policy
on public.blogs
for update
using (
  tenant_id = public.current_tenant_id()
  and deleted_at is null
  and (
    public.has_permission('tenant.blog.update')
    or (
      public.has_permission('tenant.blog.update_own')
      and author_id = auth.uid()
    )
  )
)
with check (tenant_id = public.current_tenant_id());
```

```javascript
// Frontend: UX gate only, never the final security layer
if (!hasPermission("tenant.blog.update")) {
  return null;
}
```

##### Validation Checklist

- User from Tenant A cannot access Tenant B rows.
- `update_own` can edit only owned rows.
- User with `tenant.blog.publish` can publish; user without cannot.
- Direct SQL/API attempts bypassing UI are still blocked by RLS.

##### Failure Modes and Guardrails

- **Failure:** Permission names drift (`edit_blog` vs `tenant.blog.update`). **Guardrail:** enforce key format in migrations/seeds.
- **Failure:** Frontend-only security assumptions. **Guardrail:** policy tests for API/database direct access.
- **Failure:** Guessable route IDs for protected content. **Guardrail:** signed ID route params (`encodeRouteParam`, `useSecureRouteParam`).

#### 6) Cloudflare Worker Route for Custom Business Logic (46/100)

##### Objective

Create, test locally, deploy, and verify a Cloudflare Worker route in `awcms-edge/` that performs tenant-scoped business logic with proper authentication, CORS handling, and secret management within the AWCMS architecture.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| Route name | Implementation spec | Yes | Becomes a route in `awcms-edge/src/index.ts` |
| `VITE_SUPABASE_URL` | Worker env / Wrangler vars | Yes | Used to create caller/admin Supabase clients |
| `SUPABASE_SECRET_KEY` | Worker secret binding | Yes | Server-side only — never expose to clients |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Worker env / Wrangler vars | Yes | Used for caller authentication via `auth.getUser()` |
| `x-tenant-id` | Request header | Conditional | Required for tenant-scoped writes |
| Caller `Authorization` | Request header | Yes | JWT bearer token from authenticated client |

##### Workflow

1. Add or extend the route in `awcms-edge/src/index.ts`.
2. Import `Hono` handlers and `createClient` from `@supabase/supabase-js`.
3. Handle CORS preflight (`OPTIONS` → return `ok` with CORS headers).
4. Validate HTTP method (reject non-POST/GET as appropriate).
5. Create a caller-context client using the publishable key and the request's `Authorization` header — call `auth.getUser()` to authenticate.
6. Create an admin client using `SUPABASE_SECRET_KEY` for privileged database operations.
7. Extract and validate `x-tenant-id` header for tenant-scoped operations.
8. Perform business logic (transform content, manage users, etc.) using the admin client with explicit `tenant_id` and `deleted_at IS NULL` filters.
9. Return structured JSON responses with appropriate HTTP status codes.
10. Test locally with `cd awcms-edge && npm run dev:local`.
11. Deploy with `cd awcms-edge && npm run deploy`.
12. Set secrets with `npx wrangler secret put <SECRET_NAME>` or the configured Cloudflare secret workflow.

##### Reference Implementation

```typescript
// awcms-edge/src/index.ts
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-tenant-id, content-type",
  "Content-Type": "application/json",
};

const app = new Hono();

app.post('/functions/v1/content-transform', async (c) => {
  const req = c.req.raw;

  // Step 3: Environment setup
  const supabaseUrl = c.env.VITE_SUPABASE_URL ?? "";
  const publishableKey = c.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  const secretKey = c.env.SUPABASE_SECRET_KEY ?? "";

  // Step 4: Authenticate caller using publishable key client
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData?.user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Step 5: Validate tenant context
  const tenantId = req.headers.get("x-tenant-id") ?? "";
  if (!tenantId) {
    return c.json({ error: 'Missing x-tenant-id header' }, 400);
  }

  // Step 6: Create admin client for privileged operations
  const adminClient = createClient(supabaseUrl, secretKey);

  // Step 7: Parse and validate request payload
  const payload = await req.json();
  if (!payload?.blog_id || !payload?.transformed) {
    return c.json({ error: 'Missing blog_id or transformed content' }, 400);
  }

  // Step 8: Perform tenant-scoped business logic
  const { data, error } = await adminClient
    .from("blogs")
    .update({
      content: payload.transformed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payload.blog_id)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .select("id")
    .single();

  if (error) {
    return c.json({ error: error.message }, 400);
  }

  if (!data) {
    return c.json({ error: 'Blog not found or access denied' }, 404);
  }

  return c.json({ ok: true, id: data.id });
});
```

**Local testing:**

```bash
# Run the Worker locally
cd awcms-edge && npm run dev:local

# Test with curl
curl -i http://127.0.0.1:8787/functions/v1/content-transform \
  -H "Authorization: Bearer <jwt_token>" \
  -H "x-tenant-id: <tenant_uuid>" \
  -H "Content-Type: application/json" \
  -d '{"blog_id": "<uuid>", "transformed": {"blocks": []}}'
```

**Deployment:**

```bash
# Deploy to production
cd awcms-edge && npm run deploy

# Set required secrets
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

**Current Worker route inventory:**

| Function | Purpose | Path |
| --- | --- | --- |
| `verify-turnstile` | Validate Turnstile tokens with host-aware secret | `awcms-edge/src/index.ts` |
| `manage-users` | Account request workflow and admin user lifecycle | `awcms-edge/src/index.ts` |
| `mailketing` | Email send/subscribe/credits/list integrations | `awcms-edge/src/index.ts` |
| `mailketing-webhook` | Webhook ingestion and email log updates | `awcms-edge/src/index.ts` |
| `serve-sitemap` | Tenant-aware XML sitemap generation | `awcms-edge/src/index.ts` |

##### Validation Checklist

- Function rejects unauthenticated calls (missing or invalid JWT returns `401`).
- Privileged writes use `SUPABASE_SECRET_KEY` admin client only — never the publishable key.
- Tenant scope is enforced via `x-tenant-id` header validation and `.eq("tenant_id", tenantId)`.
- Soft-deleted rows are excluded with `.is("deleted_at", null)`.
- CORS headers are present on all responses including error responses.
- Local `awcms-edge` Worker behavior matches the deployed Worker route behavior.
- Secrets are set via `supabase secrets set`, never hardcoded in function code.

##### Failure Modes and Guardrails

- **Failure:** Missing CORS headers on error responses. **Guardrail:** include `corsHeaders` in every `new Response()` call, including errors.
- **Failure:** Using `SUPABASE_SECRET_KEY` in client-side code. **Guardrail:** key must remain accessible only in approved server-side edge runtimes.
- **Failure:** Mutating soft-deleted rows. **Guardrail:** always chain `.is("deleted_at", null)` on queries.
- **Failure:** Missing permission check. **Guardrail:** add `has_permission` RPC call or restrict endpoint to admin routes.
- **Failure:** Route not found after deploy. **Guardrail:** verify the deployed Worker URL and route path in `awcms-edge/src/index.ts` and the target client env config.

#### 7) User Login and Registration with Supabase Auth (79/100)

##### Objective

Implement a complete dual-flow authentication system (register + login) using Supabase Auth with tenant assignment, session management, and audit logging within the AWCMS React admin panel.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `email`, `password` | Login/register form | Yes | Password minimum 8 characters |
| `tenant_id` | Tenant selection or auto-resolve | Yes | Assigned during registration or first login |
| `role` | Admin assignment or default | Yes | Default: `member`; upgraded by tenant admin |
| Supabase client | `@/lib/customSupabaseClient` | Yes | Uses `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Auth context | `SupabaseAuthContext.jsx` | Yes | Provides `useAuth()` hook |

##### Workflow

1. **Registration flow:** `supabase.auth.signUp({ email, password })` → user receives confirmation email → on confirm, profile sync trigger creates `public.users` row with `tenant_id` and default role.
2. **Login flow:** `supabase.auth.signInWithPassword({ email, password })` → on success, `AuthProvider` resolves session → fetches user profile with tenant/role → redirects to tenant dashboard.
3. **Session management:** `AuthProvider` listens to `onAuthStateChange` events (`SIGNED_IN`, `SIGNED_OUT`, `TOKEN_REFRESHED`) and updates context.
4. **Tenant assignment:** On first login, user's `tenant_id` is resolved from `user_metadata` or profile lookup. If missing, redirect to tenant selection.
5. **2FA support:** `syncTwoFactorStatus()` checks if MFA is enrolled and updates context state.
6. **Audit:** Log login events to `audit_logs` with `action: 'auth.login'`.

##### Reference Implementation

```jsx
// Registration form component
import { useState } from "react";
import { supabase } from "@/lib/customSupabaseClient";
import { useToast } from "@/components/ui/use-toast";

export default function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { requested_role: "member" },
      },
    });

    setLoading(false);

    if (error) {
      toast({ variant: "destructive", title: "Registration failed", description: error.message });
      return;
    }

    toast({ title: "Check your email", description: "A confirmation link has been sent." });
  };

  return (
    <form onSubmit={handleRegister}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      <button disabled={loading}>{loading ? "Creating..." : "Register"}</button>
    </form>
  );
}
```

```jsx
// Login form component
import { useState } from "react";
import { supabase } from "@/lib/customSupabaseClient";
import { useAuth } from "@/contexts/SupabaseAuthContext";
import { useToast } from "@/components/ui/use-toast";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      toast({ variant: "destructive", title: "Login failed", description: error.message });
      return;
    }
    // AuthProvider's onAuthStateChange handles session + redirect
  };

  return (
    <form onSubmit={handleLogin}>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <button disabled={loading}>{loading ? "Signing in..." : "Sign In"}</button>
    </form>
  );
}
```

```jsx
// AuthProvider session management (from SupabaseAuthContext.jsx)
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event, session) => {
      if (event === "SIGNED_IN" && session?.user) {
        // Fetch user profile with tenant and role
        const { data: profile } = await supabase
          .from("users")
          .select("id, tenant_id, role_id")
          .eq("id", session.user.id)
          .is("deleted_at", null)
          .single();

        setUser({ ...session.user, profile });
        await syncTwoFactorStatus();
      }
      if (event === "SIGNED_OUT") {
        setUser(null);
      }
    },
  );
  return () => subscription.unsubscribe();
}, []);
```

##### Validation Checklist

- Registration creates auth user and triggers profile sync to `public.users`.
- Login with wrong credentials returns explicit error without leaking user existence.
- Session refresh happens automatically via `TOKEN_REFRESHED` event.
- Tenant ID is resolved from profile, not from user input.
- Signed-out users cannot access protected routes.

##### Failure Modes and Guardrails

- **Failure:** Missing tenant assignment after registration. **Guardrail:** profile sync trigger creates `users` row with tenant metadata from invitation or default.
- **Failure:** Session expiry mid-operation. **Guardrail:** `AuthProvider` detects `SIGNED_OUT` and redirects to login.
- **Failure:** Password too weak. **Guardrail:** Supabase enforces minimum length; UI validates before submit.
- **Failure:** Email confirmation not received. **Guardrail:** resend confirmation endpoint with rate limiting.

#### 8) Astro Public Portal Static Content Rendering (87/100)

##### Objective

Fetch and statically render tenant-scoped, published-only content in the Astro-based Public Portal using build-time environment variables and Supabase queries with strict filtering.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `PUBLIC_TENANT_ID` or `VITE_PUBLIC_TENANT_ID` | Build-time `.env` | Yes | Resolved at build, not runtime |
| `PUBLIC_SUPABASE_URL` | Build-time `.env` | Yes | Supabase project URL |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Build-time `.env` | Yes | Client-safe key |
| Content query | Supabase JS client | Yes | Must filter `status = published` and `deleted_at IS NULL` |

##### Workflow

1. Resolve tenant ID from build-time env (`PUBLIC_TENANT_ID` / `VITE_PUBLIC_TENANT_ID` / `VITE_TENANT_ID`).
2. Initialize Supabase client with publishable key in `src/lib/content.ts`.
3. Query content with mandatory filters: `.eq("tenant_id", tenantId)`, `.eq("status", "published")`, `.is("deleted_at", null)`.
4. Pass fetched data to Astro pages via `getStaticPaths()` or frontmatter `await`.
5. Render content using sanitized HTML components (never raw `set:html` without sanitization).
6. Generate SEO metadata (title, description, OG tags) from content fields.
7. Build with `output: "static"` — no SSR, no runtime tenant resolution.

##### Reference Implementation

```typescript
// awcms-public/primary/src/lib/content.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseKey = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const tenantId = import.meta.env.PUBLIC_TENANT_ID
  ?? import.meta.env.VITE_PUBLIC_TENANT_ID
  ?? import.meta.env.VITE_TENANT_ID;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function getPublishedBlogs() {
  const { data, error } = await supabase
    .from("blogs")
    .select("id, title, slug, summary, content, published_at, author_id")
    .eq("tenant_id", tenantId)
    .eq("status", "published")
    .is("deleted_at", null)
    .order("published_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch blogs: ${error.message}`);
  return data ?? [];
}

export async function getBlogBySlug(slug: string) {
  const { data, error } = await supabase
    .from("blogs")
    .select("id, title, slug, content, published_at, author_id, summary")
    .eq("tenant_id", tenantId)
    .eq("slug", slug)
    .eq("status", "published")
    .is("deleted_at", null)
    .single();

  if (error) return null;
  return data;
}
```

```astro
---
// awcms-public/primary/src/pages/[locale]/blog/[slug].astro
import { getPublishedBlogs, getBlogBySlug } from "~/lib/content";
import BaseLayout from "~/layouts/BaseLayout.astro";
import PuckRenderer from "~/components/common/PuckRenderer.astro";

export async function getStaticPaths() {
  const blogs = await getPublishedBlogs();
  return blogs.map((blog) => ({
    params: { slug: blog.slug, locale: "id" },
    props: { blog },
  }));
}

const { blog } = Astro.props;
---
<BaseLayout title={blog.title} description={blog.summary}>
  <article>
    <h1>{blog.title}</h1>
    <time datetime={blog.published_at}>{new Date(blog.published_at).toLocaleDateString()}</time>
    <PuckRenderer content={blog.content} />
  </article>
</BaseLayout>
```

##### Validation Checklist

- Build fails if `PUBLIC_TENANT_ID` is missing (explicit error, not silent empty data).
- Queries always include `tenant_id`, `status = published`, and `deleted_at IS NULL`.
- Draft, archived, or soft-deleted content never appears in static output.
- HTML in Puck content blocks is sanitized before rendering.
- `output: "static"` is set in `astro.config.mjs` — no SSR runtime.

##### Failure Modes and Guardrails

- **Failure:** Missing tenant env at build time. **Guardrail:** content.ts throws if `tenantId` is falsy.
- **Failure:** Draft content leaking to public. **Guardrail:** `.eq("status", "published")` on every query.
- **Failure:** XSS from imported HTML. **Guardrail:** `PuckRenderer` uses `sanitize-html` with allowlisted tags.
- **Failure:** Stale content after publish. **Guardrail:** rebuild triggered by CI on content update webhook or manual deploy.

#### 9) ESP32 IoT Device Configuration Mechanism (81/100)

##### Objective

Deliver device configuration updates securely via the Cloudflare Edge API, apply settings on the ESP32 firmware, and persist a safe last-known configuration for offline boot recovery within the AWCMS IoT subsystem.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `device_token` | Device provisioning (per-device publishable key) | Yes | Never the secret key |
| `device-config` URL | Supabase Functions URL | Yes | `https://<project>.supabase.co/functions/v1/device-config` |
| `polling_interval_sec` | Config payload from server | Yes | Controls fetch frequency |
| Config schema | Server JSON response | Yes | Known keys: `led_enabled`, `brightness_level`, `firmware_version` |
| `secrets.h` | Local gitignored file | Yes | `WIFI_SSID`, `WIFI_PASS`, `DEVICE_TOKEN` |

##### Workflow

1. Device boots, connects to WiFi, and loads last-known config from ESP32 `Preferences` (NVS).
2. Device polls `/functions/v1/device-config` with `Authorization: Bearer <device_token>`.
3. Edge Function validates the device token, resolves the tenant/device context, and returns scoped configuration JSON.
4. Firmware parses the JSON response, applies config to hardware (LED, brightness, intervals).
5. Config is persisted to `Preferences` for offline recovery on next boot.
6. When `firmware_version` in the payload increases, device triggers OTA update via `Update.h`.
7. If network is unavailable, device continues with last-known config.

##### Reference Implementation

```cpp
// awcms-esp32/primary/lib/ConfigManager/ConfigManager.h
#pragma once
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>

class ConfigManager {
public:
    struct DeviceConfig {
        int     pollingIntervalSec;
        bool    ledEnabled;
        int     brightnessLevel;
        String  firmwareVersion;
    };

    ConfigManager(const char* endpoint, const char* deviceToken)
        : _endpoint(endpoint), _token(deviceToken) {}

    bool fetchAndApply(DeviceConfig& out) {
        HTTPClient http;
        http.begin(_endpoint);
        http.addHeader("Authorization", String("Bearer ") + _token);
        http.addHeader("Content-Type", "application/json");

        int httpCode = http.GET();
        if (httpCode != 200) {
            Serial.printf("[Config] HTTP error: %d\n", httpCode);
            return false;
        }

        String body = http.getString();
        http.end();

        StaticJsonDocument<512> doc;
        DeserializationError err = deserializeJson(doc, body);
        if (err) {
            Serial.printf("[Config] JSON parse error: %s\n", err.c_str());
            return false;
        }

        out.pollingIntervalSec = doc["polling_interval_sec"] | 60;
        out.ledEnabled         = doc["led_enabled"] | true;
        out.brightnessLevel    = doc["brightness_level"] | 50;
        out.firmwareVersion    = doc["firmware_version"].as<String>();

        _persist(out);
        return true;
    }

private:
    const char* _endpoint;
    const char* _token;
    Preferences _prefs;

    void _persist(const DeviceConfig& cfg) {
        _prefs.begin("awcms_cfg", false);
        _prefs.putInt("poll_int", cfg.pollingIntervalSec);
        _prefs.putBool("led_en", cfg.ledEnabled);
        _prefs.putInt("brightness", cfg.brightnessLevel);
        _prefs.end();
    }
};
```

```cpp
// awcms-esp32/primary/src/main.cpp
#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"       // WIFI_SSID, WIFI_PASS, DEVICE_TOKEN (gitignored)
#include "config.h"        // CONFIG_ENDPOINT
#include "ConfigManager.h"

ConfigManager configMgr(CONFIG_ENDPOINT, DEVICE_TOKEN);
ConfigManager::DeviceConfig activeConfig;

void connectWifi() {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.print("[WiFi] Connecting");
    while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
    Serial.printf("\n[WiFi] Connected: %s\n", WiFi.localIP().toString().c_str());
}

void setup() {
    Serial.begin(115200);
    connectWifi();
    activeConfig.pollingIntervalSec = 60; // Safe default
    configMgr.fetchAndApply(activeConfig);
}

void loop() {
    static unsigned long lastFetch = 0;
    unsigned long now = millis();
    if (now - lastFetch >= (unsigned long)activeConfig.pollingIntervalSec * 1000) {
        lastFetch = now;
        if (!configMgr.fetchAndApply(activeConfig)) {
            Serial.println("[Config] Fetch failed; using last-known config.");
        }
    }
    digitalWrite(LED_BUILTIN, activeConfig.ledEnabled ? HIGH : LOW);
    delay(1000);
}
```

**Build and flash:**

```bash
cd awcms-esp32/primary
pio run -e dev            # compile
pio run -e dev -t upload  # flash to connected device
pio device monitor        # serial output at 115200 baud
```

##### Validation Checklist

- Device uses last-known config from `Preferences` when network is unavailable.
- Config updates apply within one polling interval after server-side change.
- OTA update triggers only when `firmware_version` increases.
- Device token revocation at server prevents future config/telemetry access.
- `secrets.h` is in `.gitignore` — credentials never committed.

##### Failure Modes and Guardrails

- **Failure:** Device token leaked. **Guardrail:** revoke token in AWCMS admin, Edge Function blocks revoked tokens.
- **Failure:** Invalid JSON from server. **Guardrail:** `deserializeJson` error falls back to last-known settings.
- **Failure:** WiFi unavailable. **Guardrail:** device boots with persisted config and retries WiFi connection.
- **Failure:** Breaking config schema changes. **Guardrail:** use versioned endpoints (`device-config-v2`) for incompatible changes.

#### 10) Monorepo Versioning and Independent Deployment (81/100)

##### Objective

Enable independent releases for each AWCMS client application (admin, public portals, mobile, IoT) within a single monorepo, while preserving backward compatibility across shared database schemas and APIs.

##### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| App version | `package.json` / `pubspec.yaml` | Yes | SemVer per client |
| CI path filters | `.github/workflows/*.yml` | Yes | Deploy only changed apps |
| Additive schema rules | DB migration policy | Yes | No column drops, no renames without alias |
| Root changelog | `CHANGELOG.md` | Yes | Global release history using Keep a Changelog format |
| Migration files | `supabase/migrations/` | Yes | Timestamped SQL migrations |

##### Workflow

1. Make all backend/database changes **additive**: add new columns with defaults, never drop or rename existing columns.
2. Bump only the app version(s) affected by the change (`npm version patch --prefix awcms` for admin only).
3. Deploy in staged order: **database/functions → admin → public portals → mobile → IoT**.
4. For breaking API changes, create versioned endpoints (e.g., `device-config-v2`) and support both versions during transition.
5. Record releases in root `CHANGELOG.md` following Keep a Changelog format and SemVer.
6. Tag releases when merging to `main` with pattern: `v<major>.<minor>.<patch>`.
7. Use path-filtered CI: each workflow job triggers only when its app directory is modified.

##### Reference Implementation

```bash
# Version bump examples
npm version minor --prefix awcms              # Admin panel
npm version patch --prefix awcms-public/primary   # Public portal
```

```yaml
# .github/workflows/ci-push.yml (path filtering)
jobs:
  deploy-admin:
    if: contains(github.event.commits[0].modified, 'awcms/')
    steps:
      - run: npm run build
        working-directory: awcms/

  deploy-public:
    if: contains(github.event.commits[0].modified, 'awcms-public/')
    steps:
      - run: npm run build
        working-directory: awcms-public/primary/
```

```sql
-- Additive migration example: add column with default, never drop
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS
  reading_time_minutes int DEFAULT 0;

-- For breaking schema changes: deprecate, don't remove
COMMENT ON COLUMN public.blogs.old_field IS
  'DEPRECATED: Use new_field instead. Will be removed in v3.0.0.';
```

**Version matrix (current apps):**

| App | Version Source | Deploy Target | Path Filter |
| --- | --- | --- | --- |
| Admin (`awcms/`) | `awcms/package.json` | Cloudflare Pages | `awcms/**` |
| Public Primary (`awcms-public/primary/`) | `awcms-public/primary/package.json` | Cloudflare Pages | `awcms-public/primary/**` |
| Public SMANDAPBUN | `awcms-public/smandapbun/package.json` | Cloudflare Pages | `awcms-public/smandapbun/**` |
| Flutter Mobile | `awcms-flutter/pubspec.yaml` | App Store / Play Store | `awcms-flutter/**` |
| ESP32 IoT | `awcms-esp32/platformio.ini` | PlatformIO OTA | `awcms-esp32/**` |

##### Validation Checklist

- Each app can be versioned and deployed independently without affecting others.
- Database migrations are additive — no column drops, no type changes without backward compatibility.
- CI jobs trigger only for changed paths (admin change doesn't trigger public deploy).
- Root `CHANGELOG.md` records all releases with proper SemVer and dates.
- Staged deployment order prevents clients from calling APIs that don't exist yet.

##### Failure Modes and Guardrails

- **Failure:** Column rename breaks existing clients. **Guardrail:** additive-only policy; add new column, migrate data, deprecate old column.
- **Failure:** All apps deploy when only admin changed. **Guardrail:** path-filtered CI with per-directory conditions.
- **Failure:** Breaking API consumed by IoT devices in the field. **Guardrail:** versioned endpoints + minimum support window for old versions.
- **Failure:** Changelog not updated. **Guardrail:** CI check for `CHANGELOG.md` modification on version bump PRs.

### Benchmark Authoring Rules (For Future Updates)

- Always answer benchmark prompts in the same sequence: Objective -> Inputs -> Workflow -> Implementation -> Validation -> Failure Modes.
- Prefer runnable, production-safe examples over conceptual prose.
- Use current stack versions and current env key names (`VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`).
- Keep tenant isolation, RLS, and soft delete checks explicit in every relevant example.
- If a benchmark score regresses, update this section first before editing scattered docs.

### Legacy Remediation Archive (Scores < 85, Historical)

Use this subsection for historical reference only. Topics are ordered by the old score profile and preserved to help compare remediation progress over time.

| Priority | Benchmark Topic | Previous Score | Main Gap Fixed |
| --- | --- | --- | --- |
| 1 | Admin tenant content form (React) | 69/100 | Missing tenant-specific payload, permission gate, and error/submit flow |
| 2 | New tenant onboarding | 70/100 | Missing end-to-end onboarding sequence and isolation verification |
| 3 | Login and registration flow | 71/100 | Missing complete two-flow design (register + login) and audit checks |
| 4 | Fine-grained authorization | 71/100 | Missing ABAC-to-RLS bridge and ownership policy pattern |
| 5 | Astro static content fetching | 79/100 | Missing build-time tenant env strategy and published-content constraints |
| 6 | Cloudflare Worker route deployment | 81/100 | Missing secure execution lifecycle (local test -> deploy -> verify) |
| 7 | Flutter real-time retrieval | 83/100 | Missing resilience, auth state handling, and tenant-scoped stream guidance |

#### Archived Material Policy

- Full legacy snippets and detailed walkthroughs were removed from this archive section for brevity.
- Canonical benchmark answers now live in the remediation section above (`### Context7 Benchmark Remediation (Active Gaps + Stabilized References)`).
- Previous legacy details remain available via git history: `git log -- AGENTS.md` and `git show <commit>:AGENTS.md`.
- For authoritative project guidance, refer to `SYSTEM_MODEL.md`, `README.md`, and `DOCS_INDEX.md`.
