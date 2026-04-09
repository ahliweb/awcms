> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Admin Panel Development

## Purpose

Document the current development model for the AWCMS admin panel in `awcms/` as it exists now: the real runtime boundaries, tenant-resolution behavior, platform-vs-tenant scope model, ABAC usage, admin menu behavior, route security expectations, and current validation workflow.

This guide is intentionally current-state focused. It is meant to help contributors and agents write changes that match the checked-in repo instead of older assumptions.

## Current State

### Current Admin Runtime Model

- `awcms/` is the maintained admin application.
- It is a React 19.2.4 SPA built with Vite `^8.0.5`.
- Admin code is JavaScript ES2022+, not TypeScript.
- TailwindCSS 4 and shadcn/ui patterns are the current UI foundation.
- The current shared admin shell uses an EmDash-style visual system owned by `awcms/src/templates/emdash-admin/`.
- `awcms/src/templates/emdash-admin/` is the supported admin template import surface.
- Supabase remains the source of truth for Auth, PostgreSQL, RLS, and ABAC.
- Cloudflare Workers in `awcms-edge/` are the only maintained server-side HTTP runtime for privileged orchestration, signed media access, integrations, and compatibility routes.

### Current Admin Security Model

- Tenant isolation is mandatory even inside admin code.
- Platform admins and full-access roles may inspect tenant-bounded data only through approved scope/override paths.
- UI permission checks are UX guardrails, not the final authority.
- Canonical permission naming must use `scope.resource.action`.
- Soft delete remains the default business-data lifecycle.
- Admin forms and manager screens must continue to filter `deleted_at IS NULL` unless they are explicitly handling trash/restore views.

### Current Admin Tenancy Model

The admin app no longer operates on a simplistic “single global admin tenant” assumption.

Current tenant context behavior includes:

- hostname-based tenant resolution through `TenantContext`
- a richer resolved tenant object, not just a raw tenant id
- platform-admin tenant scope override via stored platform tenant scope
- global tenant propagation through `setGlobalTenantId()`

That means admin changes should usually think in terms of:

- resolved tenant
- current scoped tenant
- platform override state
- tenant-aware reads and writes

not just `tenantId` in isolation.

## Admin Stack And Architecture

### Current Stack

- React 19.2.4
- Vite `^8.0.5`
- JavaScript ES2022+
- TailwindCSS `^4.2.2`
- React Router DOM 7.10.1
- `@supabase/supabase-js` `^2.99.3`
- Lucide React
- shadcn/ui patterns

### Current Runtime Boundaries

Admin work must respect [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md):

- browser code must not perform privileged server-side orchestration directly
- Cloudflare Workers are the maintained edge runtime
- Supabase Storage is not the maintained object-storage surface
- Worker compatibility/public/admin routes should resolve through the configured edge URL, not Supabase-hosted Edge Functions

## Directory And File Orientation

High-value admin directories and files include:

- `awcms/src/components/dashboard/`
- `awcms/src/components/ui/`
- `awcms/src/components/routing/`
- `awcms/src/components/visual-builder/`
- `awcms/src/contexts/`
- `awcms/src/hooks/`
- `awcms/src/lib/`
- `awcms/src/components/MainRouter.jsx`
- `awcms/src/contexts/TenantContext.jsx`
- `awcms/src/contexts/PermissionContext.jsx`
- `awcms/src/contexts/SupabaseAuthContext.jsx`
- `awcms/src/hooks/useAdminMenu.js`

Do not assume older folder patterns or deprecated “pages-first” routing conventions without reading the current files.

## Tenant Context In Admin

### Current Tenant Resolution Behavior

`TenantContext` currently:

- resolves tenant by hostname in normal environments
- uses dev-tenant resolution on localhost
- hydrates the resolved tenant with the `tenants` table when possible
- exposes both `resolvedTenant` and `currentTenant`
- supports platform scope switching through `switchTenantScope(...)`
- stores the active platform tenant override across sessions

This is more than a plain “tenant id provider”.

### What Admin Code Should Use

Use `useTenant()` for tenant-scoped admin work.

Typical admin expectations:

- read `currentTenant` for the active scoped tenant
- do not hardcode tenant ids
- do not assume platform users should bypass tenant filtering in app code
- respect `currentTenant.id` or `currentTenant.tenantId` based on the existing code path you are working in

### Current Dev Behavior

Local development uses dev tenant resolution rather than the production hostname contract. If tenant resolution is missing or inconsistent in local work, inspect the current dev seeding and tenant-resolution helpers before inventing a workaround.

## Permissions And ABAC In Admin

### Current Permission Context Behavior

`PermissionContext` currently resolves:

- the current user role
- tenant id from the authenticated user profile
- permission list
- ABAC policies
- role flags such as:
  - `is_platform_admin`
  - `is_full_access`
  - `is_tenant_admin`
  - staff/public/guest flags

### What Admin Code Should Do

Use `usePermissions()` for UI gating.

Typical patterns:

```jsx
const { hasPermission, hasAnyPermission, isPlatformAdmin, isFullAccess } = usePermissions();

if (hasPermission('tenant.blog.create')) {
  return <Button>Create Blog</Button>;
}
```

Rules:

- use canonical permission families documented in [docs/security/abac.md](../security/abac.md)
- do not invent new permission names without checking the migration-backed baseline first
- treat UI permission checks as additive UX gates only
- if the change alters a documented or migration-backed permission surface, update the relevant docs and migrations accordingly

## Admin Menu System

### Current State

The admin menu is not just a static global sidebar.

`useAdminMenu()` currently combines and normalizes:

- `admin_menus`
- `resources_registry`
- `extension_menu_items`
- plugin/extension/resource fallback behavior
- tenant-aware menu scope via `tenant_id`
- platform-vs-tenant menu preference and de-duplication

### Implications For Admin Changes

When adding or changing a module/menu surface:

- do not assume a single global menu table is the whole story
- account for `tenant_id` and menu scope behavior
- check whether the module should come from:
  - `admin_menus`
  - `resources_registry`
  - extension menu entries
  - plugin filter injection
- keep `docs/modules/MENU_SYSTEM.md` and current menu behavior aligned if the contract changes

## Routes And Route Security

### Current Expectations

Admin routes with identifiers should not rely on guessable raw ids in normal edit/detail flows.

Current route security expectations include:

- signed route params for protected core edit/detail screens
- `useSecureRouteParam` or `useRouteSecurityParams` where appropriate
- sub-slug routing when module views need refresh-safe tabs, trash views, or nested modes

If a change adds or modifies a protected admin route, read:

- `awcms/src/components/MainRouter.jsx`
- current route-security helpers in `awcms/src/lib/routeSecurity.js`
- [AGENTS.md](../../AGENTS.md)

before implementing a new route pattern.

## Common Admin Change Types

### Adding Or Updating A Module

Typical steps for current admin module work:

1. Identify whether the module already exists in `resources_registry`.
2. Add or update the relevant manager/component under `src/components/dashboard/`.
3. Add or adjust routes in `MainRouter.jsx`.
4. Wire menu visibility through the current menu system, not just a hardcoded sidebar assumption.
5. Confirm the permission family is canonical and migration-backed if needed.
6. Update docs when the module surface or routing contract changes.

### Dashboard Widgets

Dashboard widgets may come from plugin/extension registry hooks. Use current widget patterns and shared headers rather than ad hoc card structures where possible.

### Forms And Mutations

For tenant content forms and manager mutations:

- block mutation when tenant context is missing
- block mutation when permission is missing
- resolve the authenticated user where ownership matters
- default to draft/non-destructive lifecycle behavior when publish/delete actions require stronger permission
- provide success/error toast feedback

## Current Reference Pattern: Tenant Content Form

### Objective

Create a tenant-aware form that inserts draft content while enforcing permission and author ownership.

### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| active tenant | `useTenant()` | Yes | Scope all inserts and reads |
| permission | `usePermissions()` | Yes | Example: `tenant.blog.create` |
| `author_id` | `supabase.auth.getUser()` | Yes | Do not trust caller input |
| `slug` | derived from title | Yes | Uniqueness remains tenant-scoped |

### Workflow

1. Block submit if tenant context is missing.
2. Block submit if permission is missing.
3. Resolve the current authenticated user.
4. Build a draft payload.
5. Insert using the current Supabase client pattern.
6. Normalize duplicate/constraint failures into clear toast feedback.

### Validation Checklist

- insert is blocked without tenant context
- user without the relevant permission cannot submit successfully
- author/owner fields come from authenticated state
- create-on-save does not accidentally publish
- duplicate tenant-scoped slug errors are user-friendly

## Environment Variables

Current admin development should expect:

- client-exposed runtime values to use the `VITE_` prefix
- `import.meta.env` in runtime code
- `loadEnv` in Vite config when env access is needed at config time
- edge/runtime-related admin work to use the configured edge URL rather than direct Supabase-hosted function URLs

Do not reintroduce legacy key names or old Supabase naming conventions.

## Current Validation Commands

Use the most relevant commands for the changed admin surface.

| Surface | Validation |
| --- | --- |
| `awcms/` general admin work | `npm run build` |
| maintained docs | `cd awcms && npm run docs:check` |
| related edge route/admin Worker changes | `cd awcms-edge && npm test` and `npm run typecheck` |
| route catalog/OpenAPI changes | `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff` |
| migration/permission changes | keep mirrored migrations aligned and run the relevant migration validation path |

## Guardrails For Admin Work

### Data And Lifecycle Guardrails

- preserve tenant filtering
- preserve `deleted_at` filtering unless the screen is intentionally a trash/restore surface
- use soft delete for business records
- do not quietly widen admin reads to cross-tenant behavior unless the feature is explicitly platform-scoped and designed for it

### UI Guardrails

- admin code in `awcms/` stays JavaScript ES2022+
- use existing UI primitives and patterns where available
- use semantic theme variables, not hardcoded hex values
- provide toast feedback for meaningful admin actions

### Permission Guardrails

- use canonical permission families
- do not rely on role-name-only checks where permission checks should exist
- do not document or implement app-only placeholder permission families as canonical without migration-backed support

### Contract And Documentation Guardrails

If the change affects:

- admin-visible module behavior
- admin menu scope or ownership model
- route security expectations
- ABAC naming or permission-family behavior
- documented edge/admin route usage

then the change may also need aligned updates in:

- [docs/security/abac.md](../security/abac.md)
- [docs/modules/MENU_SYSTEM.md](../modules/MENU_SYSTEM.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
- `awcms-edge/src/lib/openapi/route-catalog.ts`

## Prompting Guidance For Admin Work

Good admin prompts should say:

- which admin workspace/files are involved
- whether the task is tenant-scoped, platform-scoped, or cross-tenant
- which current pattern to follow
- which permission family matters
- whether route security/menu scope/docs/OpenAPI metadata also need updates
- how the result should be validated

Example prompt framing:

```text
Working in `awcms/`.
This is a tenant-scoped admin change.
Preserve tenant isolation, soft delete, and canonical ABAC naming.
Follow the current patterns in `TenantContext`, `PermissionContext`, `useAdminMenu`, and the relevant manager screen.
If the change affects a documented edge/admin surface or permission contract, keep docs and route metadata aligned.
Done when the admin build passes and any related docs/edge validation are updated.
```

## Related Docs

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md)
- [AGENTS.md](../../AGENTS.md)
- [docs/security/abac.md](../security/abac.md)
- [docs/security/rls.md](../security/rls.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/modules/MENU_SYSTEM.md](../modules/MENU_SYSTEM.md)
