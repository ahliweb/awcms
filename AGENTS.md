# AI Agents Documentation

AWCMS is architected to be "AI-Native", meaning the codebase structure, naming conventions, and documentation are optimized for collaboration with AI Coding Assistants (Agents) like GitHub Copilot, Cursor, Claude, and Gemini.

---

## 🤖 Agent Overview

In the AWCMS ecosystem, AI Agents are treated as specialized team members. We define two primary personas for AI interactions:

### 1. The Coding Agent (Architect/Builder)

* **Focus**: Implementation, Refactoring, Bug Fixing.
* **Capabilities**:
  * Full context awareness of React 18/Vite 7/Supabase constraints.
  * Ability to generate complex UI components using `shadcn/ui` patterns.
  * Writing SQL migrations for Supabase.
  * Updating system hooks (e.g., `useSearch`, `useAdminMenu`, `useMedia`, `useTwoFactor`).
* **Responsibility**: Ensuring code quality, functional patterns, and adhering to the "Single Source of Truth" principle.

### 2. The Communication Agent (Documenter/Explainer)

* **Focus**: Documentation, Changelogs, PR Descriptions.
* **Capabilities**:
  * Summarizing technical changes for non-technical stakeholders.
  * Updating Markdown files in `docs/` folder.
  * Generating "How-to" guides based on code analysis.
* **Responsibility**: Maintaining the accuracy of documentation relative to the codebase state.

### 3. The Public Experience Agent (Frontend Specialist)

* **Focus**: Public Portal (`awcms-public`), Astro Islands, Performance.
* **Capabilities**:
  * Working with **Astro 5** and **React 19** (Islands Architecture).
  * Implementing **Zod** schemas for component prop validation.
  * Optimizing for Cloudflare Pages (Edge Cache, Headers).
* **Constraints**:
  * **NO** direct database access (must use Supabase JS Client or Functions).
  * **NO** `@measured/puck` dependency (use `PuckRenderer` only).

---

## 🔧 Current Tech Stack

Agents must be aware of the exact versions in use:

| Technology       | Version  | Notes                                   |
| ---------------- | -------- | --------------------------------------- |
| React            | 18.3.1   | Functional components only              |
| Vite             | 7.2.7    | Build tool & dev server                 |
| TailwindCSS      | 4.0.0    | CSS-based config (no tailwind.config.js)|
| Supabase         | 2.87.1   | Auth, Database, Storage                 |
| React Router DOM | 7.10.1   | Client-side routing                     |
| Puck             | Latest   | Visual Editor (@measured/puck)          |
| TipTap           | 3.13.0   | Rich text editor (XSS-safe)             |
| Framer Motion    | 12.23.26 | Animations                              |
| Radix UI         | Latest   | Accessible UI primitives                |
| Lucide React     | 0.561.0  | Icon library                            |
| i18next          | 25.7.2   | Internationalization                    |
| Recharts         | 3.5.1    | Charts & Data Visualization             |
| Leaflet          | 1.9.4    | Maps                                    |

> [!IMPORTANT]
> **React 18 Required**: This project strictly uses React 18.3.1 because the Puck visual editor is not yet compatible with React 19. Do not upgrade to React 19 until Puck adds support.

---

## 📋 Agent Guidelines

To ensure successful code generation and integration, Agents must adhere to the following strict guidelines:

### Core Principles

1. **Context First**: Before generating code, read `README.md` and related component files to understand the existing patterns.

2. **Multi-Tenancy Awareness**:
   * **RLS is Sacred**: Never bypass RLS unless explicitly creating a Platform Admin feature.
   * **Tenant Context**: Always use `useTenant()` or `usePermissions()` to get `tenantId`.
   * **Isolation**: Ensure all new tables have `tenant_id` and RLS policies.
   * **Permission Keys**: Use the strict format `scope.resource.action` (e.g., `tenant.post.publish`).
   * **Channel Restrictions**:
     * Governance/Publishing = `web` only.
     * Content Creation = `mobile` or `web`.
     * API = Read-heavy.

3. **Atomic Changes**: Do not attempt to rewrite the entire application in one pass. Break tasks into:
   * Database Schema Updates (SQL migrations)
   * Utility/Hook Creation
   * Component Implementation
   * Documentation Updates

4. **Strict Technology Constraints**:

| Rule             | Requirement                                |
| ---------------- | ------------------------------------------ |
| Language         | JavaScript ES2022+ (NO TypeScript)         |
| **Admin Panel**  | React 18.3.1 (Strict), Vite 7              |
| **Public Portal**| Astro 5, React 19, Cloudflare Pages        |
| Styling          | TailwindCSS 4 utilities (NO external CSS)  |
| Backend          | Supabase only (NO Node.js servers)         |

### Code Patterns

```javascript
// ✅ CORRECT: ES2022+ with hooks
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

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
      toast({ variant: "destructive", title: "Error", description: error.message });
    }
  };

  return (
    <Button onClick={handleAction}>Action</Button>
  );
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

| File                                   | Purpose                               |
| -------------------------------------- | ------------------------------------- |
| `src/contexts/SupabaseAuthContext.jsx` | Authentication state & methods        |
| `src/contexts/PermissionContext.jsx`   | ABAC/RBAC permissions & role checks   |
| `src/contexts/PluginContext.jsx`       | Extension system & hook provider      |
| `src/contexts/ThemeContext.jsx`        | Dark/Light theme management           |

### Core Libraries

| File                              | Purpose                               |
| --------------------------------- | ------------------------------------- |
| `src/lib/hooks.js`                | WordPress-style Action/Filter system  |
| `src/lib/customSupabaseClient.js` | Public Supabase client (respects RLS) |

| Hook               | File                               | Purpose                         |
| ------------------ | ---------------------------------- | ------------------------------- |
| `useAdminMenu`     | `src/hooks/useAdminMenu.js`        | Sidebar menu loading & state    |
| `useAuditLog`      | `src/hooks/useAuditLog.js`         | ERP Audit Logging & Compliance  |
| `useDashboardData` | `src/hooks/useDashboardData.js`    | Dashboard statistics            |
| `useExtensionAudit`| `src/hooks/useExtensionAudit.js`   | Extension audit logging         |
| `useMedia`         | `src/hooks/useMedia.js`            | Media library operations        |
| `useNotifications` | `src/hooks/useNotifications.js`    | Notification system             |
| `useSearch`        | `src/hooks/useSearch.js`           | Debounced search logic          |
| `useTwoFactor`     | `src/hooks/useTwoFactor.js`        | 2FA setup & verification        |

### Utility Libraries

| File                              | Purpose                                   |
| --------------------------------- | ----------------------------------------- |
| `src/lib/customSupabaseClient.js` | Public Supabase client (respects RLS)     |
| `src/lib/supabaseAdmin.js`        | Admin client (bypasses RLS)               |
| `src/lib/utils.js`                | Helper functions (`cn()`, etc.)           |
| `src/lib/extensionRegistry.js`    | Extension component mapping               |
| `src/lib/templateExtensions.js`   | Template/Widget/PageType extension APIs   |
| `src/lib/widgetRegistry.js`       | Widget type definitions                   |
| `src/lib/themeUtils.js`           | Theme utilities                           |
| `src/lib/i18n.js`                 | i18next configuration                     |

---

## 🛠️ Workflow Documentation

### 1. Feature Request Phase

* **User**: "Add a notification badge to the header."
* **Agent**: Analyzes:
  * `src/components/dashboard/Header.jsx`
  * `src/hooks/useNotifications.js`
  * Database table `notifications`

### 2. Implementation Phase

```text
Agent Action 1: Check if database table exists
Agent Action 2: Create/update hook for data fetching
Agent Action 3: Implement UI component with proper styling
Agent Action 4: Add toast notifications for user feedback
Agent Action 5: Update documentation if needed
```

### 3. Verification Phase

* Test the feature manually or describe how to test
* Ensure no breaking changes to existing functionality

---

## 📚 External Documentation (Context7)

To prevent API hallucinations and ensure adherence to the latest library standards, this project uses the **Context7 MCP Server**. Agents should use Context7 to fetch real-time documentation for core dependencies.

### Available Tools

- `resolve-library-id`: Search for a library's Context7 ID.
* `query-docs`: Query specific documentation using a Library ID.

### Core Library IDs

Use these pre-resolved IDs for frequent queries:

| Library | Context7 Library ID | Purpose |
| :--- | :--- | :--- |
| **Vite 7** | `/vitejs/vite` | Build tool & Dev server |
| **TailwindCSS 4** | `/websites/tailwindcss` | Styling & Utility classes |
| **Supabase JS** | `/supabase/supabase-js` | Auth, DB & Storage Client |
| **Lucide React** | `/websites/lucide_dev_guide_packages` | Icon documentation |
| **React 18** | `/websites/react_dev` | Core Library documentation |

### Usage Pattern

1. **Identify Need**: "How do I implement a custom Tailwind 4 plugin?"
2. **Resolve**: `resolve-library-id(libraryName: "tailwindcss")` (if ID is unknown).
3. **Query**: `query-docs(libraryId: "/websites/tailwindcss", query: "custom plugin implementation")`.

---

## 🎨 UI Component Patterns

### Using shadcn/ui Components

```javascript
// Import from @/components/ui/
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

### Toast Notifications (Required)

```javascript
import { useToast } from '@/components/ui/use-toast';

const { toast } = useToast();

// Success
toast({ title: "Saved", description: "Changes saved successfully" });

// Error
toast({ variant: "destructive", title: "Error", description: error.message });
```

### TailwindCSS 4.0 Styling

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
import { supabase } from '@/lib/customSupabaseClient';

// Select with relations
const { data, error } = await supabase
  .from('articles')
  .select(`
    *,
    author:users(id, full_name, avatar_url),
    category:categories(id, name)
  `)
  .eq('status', 'published')
  .is('deleted_at', null)
  .order('created_at', { ascending: false });
```

### Soft Delete Pattern

```javascript
// AWCMS uses soft delete - never use .delete()
const { error } = await supabase
  .from('articles')
  .update({ deleted_at: new Date().toISOString() })
  .eq('id', articleId);
```

### File Upload

```javascript
const { data, error } = await supabase.storage
  .from('articles')
  .upload(`images/${fileName}`, file, {
    cacheControl: '3600',
    upsert: false
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

## 🔐 Permission Checks

### Key Format Compliance

Agents must usage the standardized permission keys: `scope.resource.action`.

* **Scopes**: `platform`, `tenant`, `content`
* **Actions**: `create` (C), `read` (R), `update` (U), `publish` (P), `delete` (SD), `delete_permanent` (DP).
* **Special Flags**: `U-own` (Update Own Only) - requires checking `user_id` against resource owner.

### Standard Permission Matrix

Agents must strictly adhere to this matrix when implementing access controls:

📌 *Semua permission hanya berlaku dalam tenant masing-masing*

| Role | C | R | U | P | SD | RS | DP | Description |
| :--- | :--: | :--: | :--: | :--: | :--: | :--: | :--: | :--- |
| **Owner (Global)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Supreme authority (Global) |
| **Super Admin (Global)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Platform management (Global) |
| **Admin (Tenant)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Tenant management (Tenant) |
| **Editor (Tenant)** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | Content review & approval |
| **Author (Tenant)** | ✅ | ✅ | ✅* | ❌ | ❌ | ❌ | ❌ | Content creation & update own |
| **Member** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | Commenting & Profile management |
| **Subscriber** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | Premium content access |
| **Public** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | Read-only access |
| **No Access** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Banned/Disabled |

*\* Author → hanya konten milik sendiri (tenant_id + owner_id)*

**Legend:**

* **C**: Create
* **R**: Read
* **U**: Update
* **P**: Publish
* **SD**: Soft Delete
* **RS**: Restore
* **DP**: Delete Permanent

Example: `tenant.user.manage`, `content.post.publish`.

### Implementation Pattern

```javascript
import { usePermission } from '@/contexts/PermissionContext';

function MyComponent() {
  const { hasPermission, role } = usePermission();

  // Super admin bypasses all checks
  if (role === 'super_admin') {
    // Full access
  }

  // Permission-based rendering
  if (hasPermission('content.article.edit')) {
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
