<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to the **AWCMS** project will be documented in this file.

## [2.9.3] - 2026-01-09

### Fixed

- **Visual Page Builder Error**: Resolved `no such table: _sync_queue` error by ensuring `SyncEngine` tables are auto-initialized before any mutations are queued.
- **UserProfile**: Improved error handling to catch and display user-friendly messages for `504 Gateway Timeout` and network failures during password updates.
- **TenantsManager**:
  - Fixed form overflow issues on smaller screens by making the modal content scrollable.
  - Added "Channel Domains" configuration inputs to the *Create Tenant* form (previously only available in Edit).

## [2.9.4] - 2026-01-10

### Fixed

- **Article Module Alignment**: Resolved inconsistencies between Article module and Category/Tag/Media modules.
  - **TagsManager**: Added `tenant_id` filtering to ensure tags are scoped to current tenant (non-platform admins).
  - **TagInput**: Added tenant context filtering to tag autocomplete suggestions.
  - **ArticlesManager**: Aligned category `type` filter from `'article'` to `'articles'` for consistency with `ArticleEditor`.

## [2.9.5] "Velocity" - 2026-01-10

### Changed

- **Performance Architecture**: Replaced unstable Offline Sync engine with **Local Storage Caching** layer in `UnifiedDataManager`.
  - **Caching**: Implemented 60-second TTL cache for all read operations (`select`).
  - **Invalidation**: Smart invalidation clears table-specific cache on every write (`insert`, `update`, `delete`).
  - **Speed**: Instant navigation between recently visited modules.
- **Removed**: Completely purged `wa-sqlite` dependency and `src/lib/offline` directory to resolve persistent `SQLiteError: not an error` crashes.
- **Cleanup**: Removed `useOfflineSync` hook and related dead code.

### Fixed

- **Stability**: Resolved all application crashes related to `IDBBatchAtomicVFS` and `SQLITE_MISUSE`.

## [Unreleased]

## [2.9.2] "Clarity" - 2026-01-09

### Documentation

- **Comprehensive Audit**: Full enterprise documentation audit covering 48 docs across 4 categories.
- **DEPLOYMENT.md**: Fixed `awcms-public` and `awcms-mobile` root directory paths to reference `primary` subfolder.
- **Docs Coverage Map**: Verified alignment for multi-tenancy, ABAC, RLS, workflow engine, audit trail, and compliance.
- **Standards Verification**: Confirmed CORE_STANDARDS.md, ABAC_SYSTEM.md, AUDIT_TRAIL.md, RLS_POLICIES.md, and COMPLIANCE_MAP.md accurately reflect implementation.
- **AGENTS.md**: Enforced React 18.3.1 across all projects (removed React 19 references).
- **README Updates**: Updated all project READMEs with correct `primary` subfolder paths and React 18.3.1.
- **CORE_STANDARDS.md**: Added version metadata (2.9.2, React 18.3.1, last updated date).
- **Link Fixes**: Corrected broken relative links in `awcms-mobile`, `awcms-public`, and `awcms-esp32` READMEs.

### Fixed

- **React Version**: Downgraded `react` and `react-dom` in `awcms-public/primary` from 19.x to 18.3.1 for strict compliance.
- **Lockfile Sync**: Regenerated `package-lock.json` to resolve Cloudflare `npm ci` build failure.

### Security

- Verified all XSS sanitization patterns documented in SECURITY.md match `@/utils/sanitize` implementation.
- Confirmed RLS policies on all tenant-scoped tables enforce deny-by-default model.

## [2.9.0] "Navigator" - 2026-01-08

### Added

- **RLS Policies for Menus**: Added unified tenant-scoped RLS policies (select/insert/update/delete)
- **Database Indexes**: Added performance indexes for `tenant_id` on navigation tables
- **Seed Data**: Idempotent seed script for primary tenant (3 menus, 3 categories, 3 tags)
- **Menu Manager Sync**: Public module registry + "Sync Modules" button to add all available routes
- **Menu Module Picker**: Quick select dropdown for adding menu items from predefined modules
- **Tenant Channels**: Channel-aware domain configuration (web_admin, web_public, mobile, esp32)

### Fixed

- **Tenant Isolation Bug (TagsManager)**: Platform admins now create tags within active tenant context
- **Tenant Isolation Bug (MenusManager)**: Menu inserts now include `tenant_id` from TenantContext
- **NOT NULL Constraints**: Enforced `tenant_id NOT NULL` on categories, tags, menus, menu_permissions
- **Photo Gallery Save Error**: Added missing `published_at`, `reviewed_at`, `approved_at` columns
- **Photo Gallery Category Select**: Removed type filter that blocked category selection

### Security

- **Data Cleanup Migration**: Removes rows with NULL or invalid `tenant_id` (orphaned data)
- **RLS Enforcement**: All navigation tables now have proper tenant-scoped RLS policies
- **Media Library Audit**: Verified `files` table compliance (RLS, NOT NULL, ABAC) - no changes needed
- **Media Role Capabilities**: RLS policies now restrict INSERT/UPDATE/DELETE to manage roles (owner, super_admin, admin, editor, author); read-only for others

### Changed

- **MenusManager**: Added TenantContext integration for proper tenant isolation
- **TagsManager**: Removed conditional null tenant_id for platform admins

## [2.8.0] "Pathfinder" - 2026-01-08

### Added

- **Path-Based Tenant Routing**: Public Portal now uses `/{tenant}/...` URL structure
  - New route: `src/pages/[tenant]/[...slug].astro`
  - Tenant-aware URL builder: `src/lib/url.ts`
  - Root redirect: `/` → `/primary/`
- **Documentation**: New `docs/01-guides/MIGRATION.md` for URL structure migration

### Changed

- **Public Portal Middleware**: Path-first tenant resolution with host fallback
- **Navbar/Footer**: All links now use `tenantUrl()` helper for tenant-prefixed URLs
- **URL Policy**: `trailingSlash: 'always'` enforced in `astro.config.mjs`
- **Documentation Updates**:
  - Updated `MULTI_TENANCY.md` with path-based resolution
  - Updated `PUBLIC_PORTAL_ARCHITECTURE.md` with new routing
  - Updated `AGENTS.md` to clarify React version per project
  - Updated `docs/INDEX.md` with Migration Guide link

### Fixed

- **TypeScript**: Added `tenant_slug` to `App.Locals` interface

### Documentation

- Comprehensive documentation audit and synchronization
- Fixed React version contradictions in `AGENTS.md`
- Updated project READMEs to reflect current architecture

## [2.7.0] "Unified Admin Template" - 2026-01-05

### Added

- **awadmintemplate01**: New unified admin UI template with 11 core components:
  - `AdminPageLayout`: Main wrapper with permission guard and tenant context
  - `PageHeader`: Standardized breadcrumbs and ABAC-filtered action buttons
  - `PageTabs`: Gradient-styled tabs with accessibility features
  - `DataTable`: Auto-injection of "Nama Tenant" column for platform admins
  - `FormWrapper`: Sticky submit bar with unsaved changes warning
  - `EmptyState`, `LoadingSkeleton`, `NotAuthorized`: Consistent state components
  - `TenantBadge`: Displays current tenant context in header
- **Template Permissions**: `platform.template.read/update/manage` for owner/super_admin only
- **Documentation**: New `docs/ADMIN_UI_ARCHITECTURE.md` with component reference

### Changed

- **Header.jsx**: Now displays `TenantBadge` for platform admins
- **AdminLayout.jsx**: Added footer with template version info
- **ArticlesManager.jsx**: Refactored to use awadmintemplate01 components
- **PagesManager.jsx**: Refactored to use awadmintemplate01 components
- **UsersManager.jsx**: Refactored to use awadmintemplate01 components
- **TemplatesManager.jsx**: Now requires `platform.template.manage` permission

### Security

- **Template ABAC**: Only `owner` and `super_admin` roles can manage admin templates
- **Route Guards**: All refactored managers use `AdminPageLayout` permission checks

### Fixed

- **Turnstile**: Fully resolved CORS (`x-tenant-id` support) and 500 errors by correcting Edge Function headers and secrets.
- **AdminDashboard**: Refactored to use `AdminPageLayout`, eliminated layout shifts, and fixed grid responsiveness.

### Database Migrations

- `20260105000001_add_template_permissions.sql` - Template permission seeding

## [2.6.4] - 2026-01-05

### Fixed

- **Turnstile CSP**: Resolved `Error 600010` by adding `unsafe-eval` to `Content-Security-Policy` header in `public/_headers` (required for Cloudflare WebAssembly).
- **Turnstile Config**: Temporarily hardcoded Production Site Key in Auth pages (`LoginPage`, `RegisterPage`) to resolve environment variable mismatch on Cloudflare Pages.
- **Offline Module**: Fixed `st: not a statement` initialization crash by removing trailing semicolons from `schema.js` SQL definitions.

## [2.6.3] - 2026-01-04

### Fixed

- **Turnstile Login**: Resolved "Security check failed" (Error 600010) by correcting environment variable configuration and removing hardcoded keys in `LoginPage.jsx`.

### Documentation

- **Comprehensive Update**: Updated `CONFIGURATION.md`, `TROUBLESHOOTING.md`, `DEPLOYMENT.md`, and `SECURITY.md` to reflect recent system changes and fixes.

## [2.6.2] - 2026-01-04

### Fixed

- **Public Portal**: Resolved 500 error on non-home pages (e.g., `/about`) caused by incorrect Supabase client initialization in Cloudflare runtime.
- **Database Synchronization**: Repaired migration history and synchronized local schema with remote database.

### Security

- **Supabase Advisor**: Resolved "Function Search Path Mutable" warning for `public.get_tenant_by_domain` by setting explicit `search_path`.

## [2.6.1] - 2026-01-04

### Fixed

- **Public Portal**: Added missing `@/lib/utils.ts` with `cn` function for class name merging.
- **Public Portal**: Installed `@measured/puck` dependency required by Card component.
- **Card Component**: Added required `render` property to `CardConfig` for Puck ComponentConfig compliance.
- **Domain Alias**: Fixed `get_tenant_id_by_host` RPC to properly map `tenant-public.domain.tld` to `tenant.domain.tld`.

## [2.6.0] "Clarity" - 2026-01-04

### Added

- **Nama Tenant Column**: Platform admins (`owner`, `super_admin`) now see tenant names in list views across all 20 modules.
- **Public Template System**: New `awtemplate01` template with dedicated layout, header, footer, and components.
- **Domain Aliasing**: `get_tenant_id_by_host` RPC now supports `-public` domain suffix aliasing.
- **RLS Pre-request Hook**: Fixed `current_tenant_id()` function to read `app.current_tenant_id` for anonymous users.

### Changed

- **Admin/Public Separation**: Main router now redirects `/` to `/login`, removing all public routes from admin panel.
- **Visibility Logic**: Nama Tenant column now uses role-based check (`userRole === 'super_admin' || userRole === 'owner'`) instead of tenant context check.

### Fixed

- **GenericContentManager**: Column was only visible when no tenant was selected; now visible for platform admins regardless.
- **Custom Modules**: Added tenant query joins and display badges to TagsManager, ThemesManager, MenusManager, MediaLibrary, and WidgetsManager.
- **Permission Deduplication**: Removed duplicate permissions and synced `owner` role with `super_admin` (313 permissions each).
- **Editor Initialization**: Fixed blank page issues in ArticleEditor and PageEditor due to missing state hooks.
- **SettingsManager**: Fixed `PGRST200` error with `customSelect="*"` and soft-delete/sort column issues.

### Security

- **ABAC Enforcement**: All Nama Tenant displays respect existing ABAC policies - no cross-tenant data leakage.
- **Tenant Isolation**: RLS policies remain active; platform admins can view all tenants but isolation is enforced.

### Database Migrations

- `20260104000001_seed_awtemplate01.sql` - Template seeding
- `20260104000002_fix_tenant_lookup_rpc.sql` - Tenant lookup fix
- `20260104000003_enable_public_tenant_access.sql` - Public access policies
- `20260104000004_fix_current_tenant_id.sql` - RLS function fix
- `20260104000005_support_public_domain_alias.sql` - Domain aliasing
- `20260104000006_deduplicate_permissions.sql` - Permission cleanup

## [2.5.1] - 2026-01-04

### Changed

- **CI/CD Pipeline**: Updated Flutter from `3.38.3` to `3.38.5` (Dart 3.10.4).

## [2.5.0] "Catalyst" - 2026-01-04

### Changed

- **CI/CD Pipeline**: Upgraded Flutter from `3.27.0` to `3.38.3` (Dart 3.10.1).
- **Flutter Mobile**: Updated SDK constraint from `^3.6.0` to `^3.10.0`.
- **Flutter Mobile Dependencies**:
  - `flutter_riverpod`: `^2.6.1` → `^3.1.0`
  - `go_router`: `^14.6.2` → `^17.0.1`
  - `flutter_lints`: `^5.0.0` → `^6.0.0`
  - `drift`: `^2.22.0` → `^2.30.0`
  - `drift_dev`: `^2.22.0` → `^2.30.0`
  - `drift_flutter`: `^0.2.4` → `^0.2.8`

## [2.4.3] - 2026-01-04

### Fixed

- **Flutter Mobile**: Downgraded `flutter_lints` from `^6.0.0` to `^5.0.0` for Dart 3.6.0 compatibility.

## [2.4.2] - 2026-01-04

### Fixed

- **Flutter Mobile**: Corrected Dart SDK constraint (`^3.10.1` → `^3.6.0`) to match Flutter 3.27.0.
- **Flutter Mobile**: Fixed duplicate `_` variable names in `offline_indicator.dart` and `security_gate.dart` (Dart 3.x compatibility).
- **CI/CD Pipeline**: Added `CLOUDFLARE_ENABLED` variable check to skip deployment job when secrets are not configured.

## [2.4.1] - 2026-01-04

### Fixed

- **CI/CD Pipeline**: Fixed Flutter SDK version mismatch (`3.24.0` → `3.27.0`) to match `pubspec.yaml` requirement of `^3.10.1`.
- **CI/CD Pipeline**: Fixed `npm ci` failure in Public Portal by switching to `npm install` for better lock file tolerance.
- **Public Portal**: Regenerated `package-lock.json` to sync with `package.json` dependencies.

## [2.4.0] "Blaze" - 2026-01-04

### Added

- **CORE_STANDARDS Compliance**: Full audit verification of all 55 requirements across 5 pillars.
- **Privileged Supabase Client**: `src/lib/supabaseAdmin.js` for server-side operations that bypass RLS.
- **Cloudflare Configuration**: `wrangler.toml` for Cloudflare Pages/Workers deployment.
- **Code Formatting**: `.prettierrc` configuration for consistent code style.
- **CI/CD Pipeline**: `.github/workflows/ci.yml` GitHub Actions workflow for automated testing and deployment.
- **Documentation**:
  - `docs/ARCHITECTURAL_RECOMMENDATIONS.md`: Architecture best practices.
  - `docs/CI_CD.md`: CI/CD pipeline documentation.

### Changed

- **Dynamic CORS**: `vite.config.js` now reads `VITE_CORS_ALLOWED_ORIGINS` from `.env`.
- **Documentation Updates**:
  - Fixed broken links in `INDEX.md` (CHANGELOG path).
  - Fixed broken links in `VERSIONING.md` (CHANGELOG references).
  - Fixed `FOLDER_STRUCTURE.md` (RBAC→ABAC, removed deprecated notice).
  - Added Vitest/Prettier/Wrangler to `TECH_STACK.md`.
  - Updated `TESTING.md` with Vitest implementation details.

### Security

- **RLS Bypass Client**: Proper implementation of service role client with security warnings.

## [2.3.1] - 2026-01-04

### Changed

- **Version**: Bumped to 2.3.1 (Patch) to reflect bug fixes and dev-tooling enhancements.
- **Documentation**: Corrected component reference consistency in `VISUAL_BUILDER.md`.

### Fixed

- **Offline Architecture (CRITICAL)**: Implemented missing `schema.js` and `applySchema` logic in `db.js`, fixing a critical gap where local SQLite tables were not initialized.
- **Testing Framework**: Established comprehensive automated testing infrastructure using `vitest`, `jsdom`, and `@testing-library`, enabling verifying core system logic.
- **Unit Tests**:
  - `PermissionContext.test.jsx`: Added verification for ABAC logic, RBAC fallback, and `super_admin` policies.
  - `UnifiedDataManager.test.js`: Added verification for offline/online toggle and data fetching delegation.

## [2.3.0] - 2026-01-04

### Added

- **Database Stability**: Fully synchronized local schema with remote database using `npx supabase db pull`.
- **Schema Validation**: Patched migrations to enforce strict `NOT NULL` constraints on `permissions` table.
- **Cleanup**: Removed unused `remote_schema.sql` artifacts.

### Changed

- **Version**: Bumped to 2.3.0 to reflect core stability achievements.

## [2.2.0] - 2026-01-03

### Changed

- **Core Architecture**:
  - Migrated to **Tailwind CSS v4** with native `@theme` configuration.
  - Optimized **Vite 7** build with `server.warmup` and `baseline-widely-available` target.
  - Implemented strict **Tenant Isolation** via comprehensive RLS policies and Database Indices.
- **Module Standardization**:
  - Refactored **P0 Modules** (Content, Pages, Categories) to use standard UI/UX tokens.
  - Refactored **P1 Modules** (Users, Roles, Permissions) for enhanced ABAC security.
  - Refactored **P2 Modules** (Tenants, Settings, Themes) with modernized layouts.
  - Refactored **P3 Modules** (Commerce, Galleries) to align with design system.
- **Security & Reliability**:
  - Added `ExtensionErrorBoundary` to prevent widget crashes affecting the core UI.
  - Enhanced `SSOManager` and `PolicyManager` with strict validation.

## [2.1.0] - 2026-01-01

### Added

- **ResourceSelect Component**: New `src/components/dashboard/ResourceSelect.jsx` for dynamic relationship selection.
- **Regions Plugin**: Added `src/plugins/regions` and `src/hooks/useRegions.js` with hierarchical support.
- **Ahliweb Analytics**: Integrated external extension support.
- **Task & Audit Documentation**: Created `task.md`, `implementation_plan.md`, and `walkthrough.md`.

### Changed

- **UI Standardization (Phase 2)**:
  - Refactored `GenericResourceEditor` to use Shadcn UI `Select` and `Checkbox`.
  - Refactored `ArticlesManager` and `GenericContentManager` to use standard `Breadcrumb` component.
  - Replaced legacy inputs in `dashboard` with standardized Shadcn components.
- **Dependency Management**:
  - Updated `useRegions.js` to use aliased imports (`@/lib/customSupabaseClient`).
  - Fixed duplicate menu items in `useAdminMenu.js`.
- **Admin Navigation**:
  - Migrated sidebar to be Database-driven (`admin_menus` table) with `DEFAULT_MENU_CONFIG` fallback.
  - Added support for Extension and Plugin menu injection.
- **Multi-Tenancy**:
  - Enforced `tenant_id` on all File uploads via `useMedia` hook.
  - Verified `TenantsManager` for Super Admin use.

### Fixed

- **Build Errors**:
  - Resolved missing `ResourceSelect` import in `GenericResourceEditor`.
  - Resolved incorrect import paths in `useRegions.js`.
- **Articles Module**: Fixed blank page issues and routing.

## [2.0.0] "Aurora" - 2025-12-30

### Added

- **Versioning System**: Centralized version management with `src/lib/version.js`
- **Version Badge**: UI component for displaying version in admin panel
- **Documentation Audit**: 7 new documentation files (CONTRIBUTING, CODE_OF_CONDUCT, LICENSE, OFFLINE_ARCHITECTURE, ROLE_HIERARCHY, AUDIT_TRAIL, RLS_POLICIES)
- **Role Migration**: Changed `super_super_admin` to `owner` as supreme role
- **RLS Fix**: Global roles (owner, super_admin) now readable by all users
- **Security Hardening**: Added `SET search_path = ''` to SECURITY DEFINER functions

### Changed

- **PERFORMANCE.md**: Expanded from 682 bytes to 4.8 KB
- **MONITORING.md**: Expanded from 573 bytes to 4.1 KB
- **INDEX.md**: Added Security & Access Control section

### Fixed

- RLS policy on `roles` table blocking global role access
- Supabase Security Advisor warnings for function search_path

## [1.0.0] - 2025-12-15

### Added (1.0.0)

- **Sidebar Menu Structure**: Logical groups (CONTENT, MEDIA, COMMERCE, etc.)
- **Dynamic Sitemap**: Edge Function (`serve-sitemap`) generation
- **Tenant Administration**: Billing and administrative fields
- **Multi-Tenant Architecture**: Full tenant isolation with RLS
- **ABAC System**: Attribute-Based Access Control
- **Visual Builder**: Puck-based page builder
- **Internationalization**: EN and ID language support

### Changed (1.0.0)

- Menu Grouping consolidated and reorganized
- User Module tenant selector based on role
- Dashboard Platform Overview for owner and super_admin

### Fixed (1.0.0)

- UserEditor.jsx duplicate query bug
- MainRouter.jsx typo route `/ssn`
- TenantSettings.jsx infinite spinner
- TenantSettings.jsx invisible Save button

## [0.1.0] - 2025-12-01

- Initial Beta Release.
