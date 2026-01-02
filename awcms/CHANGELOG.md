<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to the **AWCMS** project will be documented in this file.

## [Unreleased]

### Added

- **Dynamic CORS**: `vite.config.js` now reads `VITE_CORS_ALLOWED_ORIGINS` from `.env`.
- **System Audit**: Verified system health across 12 checking points.
- **Documentation**: Updated README.md and SECURITY.md with CORS best practices.

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

## [0.1.0] - 2025-12-01

- Initial Beta Release.
