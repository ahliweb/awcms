# AWCMS Core Standards

This document establishes the definitive architecture and standardization pillars for the AWCMS ecosystem. All development, documentation, and extension work must align with these 5 Core Standards.

## 1. Core Security & Access

**Standard**: Zero Trust, Attribute-Based Access Control (ABAC), and complete Tenant Isolation.

### 1.1 Security Architecture

* **ABAC System**:
  * **Context**: `src/contexts/PermissionContext.jsx` (Global permission state)
  * **Hook**: `usePermission()` (Role & Permission checks)
  * **Definition**: [Role Hierarchy & Matrix](ROLE_HIERARCHY.md)
* **Multi-Tenancy**:
  * **Context**: `src/contexts/TenantContext.jsx` (Tenant isolation)
  * **Hooks**: `usePublicTenant()` (Public resolving), `useTenantTheme()` (Theming)
  * **Policy**: ALL database queries must be scoped by `tenant_id`.
* **Authentication**:
  * **Context**: `src/contexts/SupabaseAuthContext.jsx` (Auth state)
  * **Security**: `useTwoFactor()` (2FA), `verifyOtp` (Secure verification)
* **Database Security**:
  * **Safe Client**: `customSupabaseClient.js` (Respects RLS)
  * **Privileged**: `supabaseAdmin.js` (Bypasses RLS - Server/Admin only)
  * **Rules**: [RLS Policies](RLS_POLICIES.md)
* **Audit & Lifecycle**:
  * **Logging**: `useAuditLog()` (System), `useExtensionAudit()` (Plugins)
  * **User**: Soft Delete protocol (No permanent deletion without archival).

### 1.2 Security Documentation

* [ABAC System Guide](ABAC_SYSTEM.md)
* [Multi-Tenancy Guide](MULTI_TENANCY.md)
* [Security Model](SECURITY.md)
* [User Management](USER_MANAGEMENT.md)
* [System Performance](PERFORMANCE.md)

---

## 2. Core UI/UX

**Standard**: Responsive, Accessible, Theme-able, and Consistent Shadcn/Tailwind implementation.

### 2.1 UI/UX Architecture

* **Template System**:
  * **Layouts**: `MainLayout` (Admin), `AuthLayout` (Login), `DashboardLayout`
  * **Hook**: `useTemplates()` (Template management & switching)
* **Theming Engine**:
  * **Context**: `src/contexts/ThemeContext.jsx` (Dark/Light mode)
  * **Config**: TailwindCSS v4 Configuration (CSS Variables)
  * **Library**: `src/components/ui/*` (Shadcn UI primitives)
* **Navigation & Menu**:
  * **Hook**: `useAdminMenu()` (Dynamic sidebar generation)
  * **Router**: `MainRouter.jsx` (Route definitions)
  * **Components**: `Sidebar.jsx`, `Header.jsx`, `Footer.jsx`
* **Public Portal**:
  * **Rendering**: `PuckRenderer` (Visual Builder Output), Astro Islands
  * **Structure**: Sections (Header, Hero, Content, Footer)
* **Internationalization (i18n)**:
  * **Config**: `i18next` initialization
  * **Assets**: Backend-driven translation files (`template_strings`).

### 2.2 UI/UX Documentation

* [Template System](TEMPLATE_SYSTEM.md)

* [Theming Guide](THEMING.md)
* [Visual Builder](VISUAL_BUILDER.md)
* [Menu System](MENU_SYSTEM.md)
* [Internationalization](INTERNATIONALIZATION.md)

---

## 3. Core Extension System

**Standard**: Modular, Sandboxed, and Event-Driven architecture for scalability.

### 3.1 Extension Architecture

* **Architecture**:
  * **Registry**: `src/lib/extensionRegistry.js` (Component mapping)
  * **Context**: `src/contexts/PluginContext.jsx` (Plugin state & config)
  * **Events**: Hook Architecture (`src/lib/hooks.js`) for Actions/Filters.
* **Core Plugins**:
  * **Communication**: `Email` (Mailketing Integration)
  * **Growth**: `SEO` Manager, `Analytics` Dashboard
  * **Admin**: `Regions` (via `useRegions` for 10-level hierarchy)
* **External Extensions**:
  * **Loading**: Dynamic Import Logic (Lazy Loading)
  * **Commerce**: `CartContext` (Optional Commerce Module)
  * **Slots**: Defined UI slots for standardized injection points.

### 3.2 Extension Documentation

* [Extension Guide](EXTENSIONS.md)

* [Module Development](MODULES_GUIDE.md)

---

## 4. Core Documentation

**Standard**: Single Source of Truth, AI-Native, and Comprehensive.

### 4.1 Documentation Architecture

* **AI Guidelines**:
  * **Primary**: [AGENTS.md](AGENTS.md) (Rules for AI Assist)
  * **Context**: **Context7 MCP** integration for library docs.
* **Project Overview**:
  * **Root**: [README.md](../README.md) (Installation & Start)
* **Technical Reference**:
  * **Data**: [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) (SQL Structure)
  * **Map**: [INDEX.md](INDEX.md) (Documentation Map)

### 4.2 Documentation Reference

* [AI Agents Guide](AGENTS.md)

* [Database Schema](DATABASE_SCHEMA.md)

---

## 5. Additional Standards

**Standard**: Modern Mobile/IoT Integration, DevOps Excellence, and High Code Quality.

### 5.1 Additional Standards Architecture

* **Mobile & IoT Ecosystem**:
  * **App**: Flutter Integration (`awcms-mobile`)
  * **IoT Hooks**: `useSensorData()` (Real-time), `useDevices()` (Management)
  * **Engagement**: `useMobileUsers()`, `usePushNotifications()`
* **Offline Capability**:
  * **Sync**: `useOfflineSync()` (Queue-based synchronization)
  * **Architecture**: [Offline Guide](OFFLINE_ARCHITECTURE.md)
* **DevOps & Deployment**:
  * **Cloudflare**: `wrangler.toml` (Pages Config), Edge Functions
  * **CI/CD**: GitHub Actions workflows
* **Quality Assurance**:
  * **Tests**: `vitest` (Unit/Integration)
  * **Standards**: ESLint, Prettier, [Code of Conduct](CODE_OF_CONDUCT.md)

### 5.2 Additional Standards Documentation

* [Mobile Development](MOBILE_DEVELOPMENT.md)
* [Offline Architecture](OFFLINE_ARCHITECTURE.md)
* [Cloudflare Deployment](CLOUDFLARE_DEPLOYMENT.md)
* [Testing Guide](TESTING.md)
* [Contributing](CONTRIBUTING.md)
* [Architectural Recommendations](ARCHITECTURAL_RECOMMENDATIONS.md)
