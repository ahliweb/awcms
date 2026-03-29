> **Documentation Authority**: [AGENTS.md](../../AGENTS.md) § Core Principles, [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)

# AWCMS Prompt Component Guide

A reference card for writing effective prompts for any coding work in the AWCMS ecosystem.
Every prompt is more reliable when it answers these questions upfront.

---

## The 5 Essential Components

### 1. 🏗️ Workspace

Tell the agent **which workspace** the change lives in. This determines the tech stack, tooling, and constraints.

| Workspace | When to name it |
|---|---|
| `awcms/` | Admin Panel (React 19, Vite 8, shadcn/ui) |
| `awcms-public/primary/` | Public Portal (Astro 6, React Islands) |
| `awcms-public/smandapbun/` | Smandapbun public site |
| `awcms-edge/` | Cloudflare Worker (TypeScript, Wrangler) |
| `awcms-mcp/` | Local MCP server |
| `packages/awcms-shared/` | Shared package (TypeScript) |
| `awcms-mobile/primary/` | Flutter mobile app |
| `supabase/migrations/` | Database schema changes |

**Example:**
> "Working in `awcms/` (Admin Panel)…"

---

### 2. 🎯 Task Type

Name the **category of work** so the agent pulls the right patterns and constraints.

| Task Type | Keywords to use |
|---|---|
| New UI component | `"new component"`, `"add page"`, `"add dialog"` |
| Hook / data layer | `"new hook"`, `"update hook"`, `"data fetching"` |
| Database migration | `"new migration"`, `"alter table"`, `"add column"` |
| RLS / ABAC | `"RLS policy"`, `"permission"`, `"role check"` |
| Edge Worker route | `"new Worker route"`, `"edge handler"` |
| Extension/plugin | `"extension"`, `"plugin"`, `"addon"` |
| Refactor | `"refactor"`, `"extract hook"`, `"rename"` |
| Bug fix | `"bug"`, `"broken"`, `"error"`, `"regression"` |
| Documentation | `"update docs"`, `"add to AGENTS.md"` |

---

### 3. 🔒 Tenant & Permission Context

State **who this feature is for** and at what permission level. This prevents the agent from bypassing RLS or writing wrong permission keys.

**Platform-level feature (affects all tenants):**
> "This is a Platform Admin feature — it uses `auth_is_admin()` and the `SUPABASE_SECRET_KEY` path."

**Tenant-scoped feature (most features):**
> "This is tenant-scoped. Use `useTenant()` for `tenantId`. The required permission key is `tenant.post.publish`."

**Public (no auth):**
> "This is a public-facing page — no auth, no RLS bypass."

**⚠️ Note:** If you omit this component, the agent may default to the wrong isolation level or hardcode a `tenantId`.

---

### 4. 📋 Existing Patterns to Follow

Point the agent at **specific files** that demonstrate the established pattern. This is the most effective way to get consistent, idiomatic code.

**Examples:**
> "Follow the pattern in `src/hooks/useMedia.js` for the hook structure."
> "Match the component style in `src/components/blogs/BlogList.jsx`."
> "Use the same migration structure as `supabase/migrations/20260325120000_add_files_permanent_delete_permission.sql`."

If you don't know the reference file, say so:
> "I don't have a reference file — please check existing patterns before generating."

---

### 5. ✅ Acceptance Criteria / Constraints

State **what done looks like** and any hard constraints the agent must not violate.

**Useful constraints to call out explicitly:**

```text
- Soft delete only (never .delete())
- No TypeScript in awcms/ (JavaScript ES2022+ only)
- No class components
- Signed route params (encodeRouteParam / useSecureRouteParam) for edit routes
- Mirror migration to awcms/supabase/migrations/ if touching supabase/migrations/
- Both supabase/migrations/ and awcms/supabase/migrations/ must stay in parity
- Toast notifications required for all user actions
```

---

## Quick-Start Templates

Copy and fill in the blanks before writing your specific request.

### Template A — New Admin UI Feature

```text
Working in `awcms/` (Admin Panel).
Task type: new component + hook.
Tenant-scoped — use `useTenant()` for tenantId. Permission key: `tenant.<resource>.<action>`.
Follow the pattern in `src/hooks/use<Similar>.js` and `src/components/<similar>/`.
Constraints: JS only, soft delete, signed route params for edit URL, toast on success/error.

<your specific request here>
```

---

### Template B — New Database Migration

```text
Task type: database migration.
This must be mirrored — create the SQL file in BOTH:
  - supabase/migrations/<timestamp>_<name>.sql
  - awcms/supabase/migrations/<timestamp>_<name>.sql
RLS required. Use `tenant_id` for isolation. Soft delete column (`deleted_at`) if this is a content table.
Follow the migration workflow at `.agents/workflows/migration-workflow.md`.

<your specific request here>
```

---

### Template C — Edge Worker Route

```text
Working in `awcms-edge/` (Cloudflare Worker, TypeScript).
Task type: new Worker route / edge handler.
Auth: validate `Authorization: Bearer <supabase_access_token>` via SUPABASE_SECRET_KEY.
No direct DB calls from the public client — use the admin client (`supabaseAdmin`).
Constraints: no Node.js APIs (Workers runtime only), return JSON responses.

<your specific request here>
```

---

### Template D — RLS or Permission Change

```text
Task type: RLS policy / ABAC change.
Follow the RLS change workflow at `.agents/workflows/rls-change-workflow.md`.
Scope: [platform-level / tenant-level / public].
Permission key format: `scope.resource.action` (e.g. `tenant.post.publish`).
Mirror the migration to both migration folders.

<your specific request here>
```

---

### Template E — Public Portal (Astro)

```text
Working in `awcms-public/primary/` (Astro 6, static output, React Islands).
Task type: [new page / new island component / new layout].
No auth, no RLS bypass. Tenant resolved via `VITE_PUBLIC_TENANT_ID` at build time.
No Puck editor runtime — use `Render` from `@puckeditor/core` only if rendering Puck content.
TypeScript/TSX only. Use Zod for prop validation if applicable.

<your specific request here>
```

---

## Cheat Sheet — What to Always Avoid Saying

These omissions cause the most agent errors:

| ❌ Vague | ✅ Specific |
|---|---|
| "Add a feature" | "Add a hook + list component in `awcms/` for…" |
| "Make it work for all users" | "Tenant-scoped, use `useTenant()`, permission key `tenant.x.y`" |
| "Update the database" | "New migration in both migration folders, RLS required" |
| "Add a button that deletes" | "Soft delete via `.update({ deleted_at })`, never `.delete()`" |
| "Make an API call" | "Call the Edge Worker at `VITE_EDGE_URL/api/…` with Bearer token" |

---

## Reference

- [AGENTS.md](../../AGENTS.md) — full tech stack table, hook reference, code patterns
- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) — authoritative constraints and MCP topology
- [`.agents/workflows/`](../../.agents/workflows/) — step-by-step workflows for migrations, RLS, UI, CI
