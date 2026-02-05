# AWCMS Core Standards

> Version: 2.28.0 | Last Updated: 2026-02-03 | React: 19.2.4

## Purpose

Define the non-negotiable architecture and implementation standards for AWCMS across all packages.

## Audience

- Engineers and maintainers working on any AWCMS package
- AI coding agents collaborating on the codebase

## Prerequisites

- `../../AGENTS.md` must be followed over all other instructions
- `../../DOCS_INDEX.md` for documentation structure

## Core Concepts

### 1. Core Security and Access

**Standard**: Zero Trust, ABAC, and strict tenant isolation.

#### 1.1 Security Architecture

- **ABAC System**:
  - Context: `awcms/src/contexts/PermissionContext.jsx`
  - Hook: `usePermissions()` (role and permission checks)
  - Definition: `docs/modules/ROLE_HIERARCHY.md`
- **Administrative Regions**: Indonesian administrative regions (Propinsi to Desa/Kelurahan) sourced from [cahyadsn/wilayah](https://github.com/cahyadsn/wilayah/blob/master/db/wilayah.sql) (Last Updated: 2026-01-13). Managed via `regions` table with standard hierarchy.
- **Tenants**: Multi-tenancy support with `tenants` table and RLS policies.
  - Context: `awcms/src/contexts/TenantContext.jsx`
  - Hooks: `useTenant()`, `usePublicTenant()`, `useTenantTheme()`
  - Policy: All database queries must be scoped by `tenant_id`
- **Modules**: Feature toggles managed via `modules` table (e.g., Blog, Shop, Portfolio).
  - Permission: `tenant.modules.read` required to view available modules.
  - Context: `TenantContext` generally handles active module states.
- **Authentication**:
  - Context: `awcms/src/contexts/SupabaseAuthContext.jsx`
  - Security: `useTwoFactor()` and OTP verification
- **Database Security**:
  - Safe client: `awcms/src/lib/customSupabaseClient.js` (RLS enforced)
  - Privileged: `awcms/src/lib/supabaseAdmin.js` (service role only)
- Rules: `docs/security/rls.md`
- **Audit and Lifecycle**:
  - Logging: `useAuditLog()`, `useExtensionAudit()`
  - Soft delete only: `docs/architecture/database.md`

#### 1.2 Security Documentation

- `docs/security/abac.md`
- `docs/tenancy/overview.md`
- `docs/security/overview.md`
- `docs/modules/USER_MANAGEMENT.md`
- `docs/modules/PERFORMANCE.md`

### 2. Core UI and UX

**Standard**: Responsive, accessible, theme-able, and consistent shadcn/ui + Tailwind.

#### 2.1 UI and UX Architecture

- **Template System**:
  - Layouts: `MainLayout`, `AuthLayout`, `DashboardLayout`
  - Hook: `useTemplates()`
- **Theming Engine**:
  - Context: `awcms/src/contexts/ThemeContext.jsx`
  - Config: TailwindCSS v4 with CSS variables
  - Library: `awcms/src/components/ui/*` (shadcn/ui)
- **Navigation and Menu**:
  - Hook: `useAdminMenu()`
  - Router: `awcms/src/components/MainRouter.jsx`
  - Components: `Sidebar.jsx`, `Header.jsx`, `Footer.jsx`
- **Public Portal**:
  - Rendering: `PuckRenderer` only (no editor runtime)
  - Astro Islands architecture
  - Consent + analytics: `ConsentNotice` and middleware-based logging
- **Internationalization**:
  - `awcms/src/lib/i18n.js`
  - Template-driven translations in `template_strings`

#### 2.2 UI and UX Documentation

- `docs/modules/TEMPLATE_SYSTEM.md`
- `docs/modules/THEMING.md`
- `docs/modules/VISUAL_BUILDER.md`
- `docs/modules/MENU_SYSTEM.md`
- `docs/modules/INTERNATIONALIZATION.md`

### 3. Core Extension System

**Standard**: Modular, sandboxed, multi-tenant, and event-driven.

#### 3.1 Extension Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         AWCMS CORE                                   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    PluginContext.jsx                          │  │
│  │   • Loads active plugins from `extensions` table              │  │
│  │   • Separates Core vs External plugins                        │  │
│  │   • Calls register() lifecycle on each plugin                 │  │
│  │   • Fires 'plugins_loaded' action when complete               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              ↓                                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │  pluginRegistry  │  │ externalLoader   │  │ templateExts     │   │
│  │  (Core Plugins)  │  │ (Dynamic Import) │  │ (UI Slots)       │   │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘   │
└───────────┼──────────────────────┼──────────────────────┼───────────┘
            ↓                      ↓                      ↓
    ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
    │ src/plugins/  │      │ awcms-ext-*   │      │ <PluginSlot>  │
    │ backup/       │      │ vendor-slug/  │      │ Injection Pts │
    │ mailketing/   │      │ (Per-Tenant)  │      │               │
    │ regions/      │      └───────────────┘      └───────────────┘
    │ helloworld/   │
    └───────────────┘
```

#### 3.2 Three-Layer Extension Model

| Layer | Location | Loading | Scope | Use Case |
| --- | --- | --- | --- | --- |
| Core Plugins | `awcms/src/plugins/` | Static import | Platform-wide | Essential functionality |
| External Extensions | `awcms-ext/*` folders | Dynamic import | Per-tenant | Third-party modules |
| UI Slots | `<PluginSlot>` components | Runtime injection | Any | Widgets, menus, form fields |

> **Requirement**: Core Plugins must specify `"type": "core"` in their `plugin.json` manifest and pass `plugin_type` during menu registration to be labeled as "Core" in the UI. Extensions must not use this type.

#### 3.3 Core Files

| File | Purpose |
| --- | --- |
| `awcms/src/contexts/PluginContext.jsx` | Provider for plugin state and loading |
| `awcms/src/lib/pluginRegistry.js` | Static registry for core plugins |
| `awcms/src/lib/externalExtensionLoader.js` | Dynamic loader for external packages |
| `awcms/src/lib/templateExtensions.js` | APIs for registering Puck blocks and widgets |
| `awcms/src/lib/hooks.js` | Actions and filters system |
| `awcms/src/lib/widgetRegistry.js` | Widget type definitions |

#### 3.4 Extension Documentation

- `docs/modules/EXTENSIONS.md`
- `docs/modules/MODULES_GUIDE.md` (Covers both System Modules and Extensions)

### 4. Core Documentation

**Standard**: Single source of truth, AI-native, and comprehensive.

#### 4.1 Documentation Architecture

- AI Guidelines: `../../AGENTS.md`
- Docs Index: `../../DOCS_INDEX.md`
- Admin Docs Index: `../../DOCS_INDEX.md`
- Tech Reference: `docs/architecture/database.md`

### 5. Additional Standards

#### 5.1 Context7 Best Practices

- **Supabase JS**: Use `createClient` with PKCE, global headers, and scoped tenant headers.
- **React**: Avoid derived state in `useEffect`; keep effects side-effect only.
- **Astro**: Use `defineMiddleware` and middleware sequencing for request-level logic.
- **TailwindCSS**: Prefer utility classes and `@utility` for shared patterns.

**Standard**: Modern mobile/IoT integration, DevOps excellence, and high code quality.

#### 5.1 Additional Standards Architecture

- **Mobile and IoT**:
  - Flutter app: `awcms-mobile/primary`
  - IoT hooks: `useSensorData()`, `useDevices()`
- **Performance Strategy**:
  - Local Storage caching via `UnifiedDataManager` (60s TTL)
- **DevOps and Deployment**:
  - Cloudflare Pages for public/admin
  - GitHub Actions workflows
- **Quality Assurance**:
  - `vitest` for unit/integration tests
  - ESLint and Prettier

#### 5.2 Additional Standards Documentation

- `docs/dev/mobile.md`
- `docs/deploy/cloudflare.md`
- `docs/dev/testing.md`
- `CONTRIBUTING.md`
- `../ARCHITECTURAL_RECOMMENDATIONS.md`

## Security and Compliance Notes

- Always enforce tenant scoping at UI entry points, data operations, and edge boundaries.
- ABAC permission keys must follow `scope.resource.action` and be enforced in the UI and Supabase operations.
- All deletes are soft deletes (`deleted_at`) unless explicitly documented otherwise.
- Supabase is the only backend; no custom servers are permitted.

## Operational Concerns

- Update `CHANGELOG.md` for releases and doc updates.
- Versioning rules live in `docs/modules/VERSIONING.md`.

## Troubleshooting

- See `docs/dev/troubleshooting.md`.

## References

- `../../AGENTS.md`
- `../../DOCS_INDEX.md`
