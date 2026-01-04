<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to the **AWCMS** project will be documented in this file.

## [Unreleased]

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
