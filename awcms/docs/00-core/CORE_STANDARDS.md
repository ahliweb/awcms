# AWCMS Core Standards

> Version: 2.12.1 | Last Updated: 2026-01-12 | React: 18.3.1

## Purpose
Define the non-negotiable architecture and implementation standards for AWCMS across all packages.

## Audience
- Engineers and maintainers working on any AWCMS package
- AI coding agents collaborating on the codebase

## Prerequisites
- `../../../AGENTS.md` must be followed over all other instructions
- `../00-core/DOCS_STRUCTURE.md` for documentation structure

## Core Concepts

### 1. Core Security and Access

**Standard**: Zero Trust, ABAC, and strict tenant isolation.

#### 1.1 Security Architecture

- **ABAC System**:
  - Context: `awcms/src/contexts/PermissionContext.jsx`
  - Hook: `usePermissions()` (role and permission checks)
  - Definition: `../03-features/ROLE_HIERARCHY.md`
- **Multi-Tenancy**:
  - Context: `awcms/src/contexts/TenantContext.jsx`
  - Hooks: `useTenant()`, `usePublicTenant()`, `useTenantTheme()`
  - Policy: All database queries must be scoped by `tenant_id`
- **Authentication**:
  - Context: `awcms/src/contexts/SupabaseAuthContext.jsx`
  - Security: `useTwoFactor()` and OTP verification
- **Database Security**:
  - Safe client: `awcms/src/lib/customSupabaseClient.js` (RLS enforced)
  - Privileged: `awcms/src/lib/supabaseAdmin.js` (service role only)
  - Rules: `../02-reference/RLS_POLICIES.md`
- **Audit and Lifecycle**:
  - Logging: `useAuditLog()`, `useExtensionAudit()`
  - Soft delete only: `../00-core/SOFT_DELETE.md`

#### 1.2 Security Documentation

- `../03-features/ABAC_SYSTEM.md`
- `../00-core/MULTI_TENANCY.md`
- `../00-core/SECURITY.md`
- `../03-features/USER_MANAGEMENT.md`
- `../03-features/PERFORMANCE.md`

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
- **Internationalization**:
  - `awcms/src/lib/i18n.js`
  - Template-driven translations in `template_strings`

#### 2.2 UI and UX Documentation

- `../03-features/TEMPLATE_SYSTEM.md`
- `../03-features/THEMING.md`
- `../03-features/VISUAL_BUILDER.md`
- `../03-features/MENU_SYSTEM.md`
- `../03-features/INTERNATIONALIZATION.md`

### 3. Core Extension System

**Standard**: Modular, sandboxed, multi-tenant, and event-driven.

#### 3.1 Extension Architecture Overview

```
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
| External Extensions | `awcms-ext-*` folders | Dynamic import | Per-tenant | Third-party modules |
| UI Slots | `<PluginSlot>` components | Runtime injection | Any | Widgets, menus, form fields |

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

- `../03-features/EXTENSIONS.md`
- `../03-features/MODULES_GUIDE.md`

### 4. Core Documentation

**Standard**: Single source of truth, AI-native, and comprehensive.

#### 4.1 Documentation Architecture

- AI Guidelines: `../../../AGENTS.md`
- Docs Index: `../../../DOCS_INDEX.md`
- Admin Docs Index: `../INDEX.md`
- Tech Reference: `../02-reference/DATABASE_SCHEMA.md`

### 5. Additional Standards

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

- `../01-guides/MOBILE_DEVELOPMENT.md`
- `../01-guides/CLOUDFLARE_DEPLOYMENT.md`
- `../01-guides/TESTING.md`
- `../01-guides/CONTRIBUTING.md`
- `../ARCHITECTURAL_RECOMMENDATIONS.md`

## Security and Compliance Notes

- Always enforce tenant scoping at UI entry points, data operations, and edge boundaries.
- ABAC permission keys must follow `scope.resource.action` and be enforced in the UI and Supabase operations.
- All deletes are soft deletes (`deleted_at`) unless explicitly documented otherwise.
- Supabase is the only backend; no custom servers are permitted.

## Operational Concerns

- Update `awcms/CHANGELOG.md` and `awcms/docs/CHANGELOG.md` for releases and doc updates.
- Versioning rules live in `../03-features/VERSIONING.md`.

## Troubleshooting

- See `../01-guides/TROUBLESHOOTING.md`.

## References

- `../../../AGENTS.md`
- `../../../DOCS_INDEX.md`
- `../INDEX.md`
