# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [2.9.9] - 2026-01-11

### Changed

- Admin Dashboard: Added more spacing for admin role cards and widget sections.
- Public Portal: Removed tenant slug prefixes for host-based URLs and normalized menu links.

### Fixed

- RBAC Soft Delete: Added `deleted_at` support and RLS alignment for `role_permissions`, `role_policies`, and `policies`.

## [2.9.8] - 2026-01-11

### Changed

- Public Portal: Upgraded TailwindCSS to v4 with `@tailwindcss/vite` and removed `@astrojs/tailwind`.
- Soft Delete: Enforced `deleted_at` across admin/mobile flows, added missing columns, and aligned RLS policies and permission helpers to ignore soft-deleted rows.

## [2.9.7] - 2026-01-11

### Documentation

- Updated stack/version references, Tailwind 4 vs 3 split, and public portal paths across guides and reference docs.
- Refreshed mobile and ESP32 documentation to match current folder layout and dependency versions.
- Corrected public portal routing/middleware behavior and Cloudflare deployment env var naming.

## [2.9.3] - 2026-01-09

### Fixed

- **Visual Page Builder**: Fixed `no such table: _sync_queue` error.
- **UserProfile**: Improved error handling for network timeouts.
- **TenantsManager**: Form scrollability and Channel Domains fields.

## [2.9.2] - 2026-01-09

### Documentation

- **Enterprise Audit**: Comprehensive documentation audit of 48 files across core, guides, reference, and features.
- **Drift Fixes**: Corrected `awcms-public/primary` and `awcms-mobile/primary` paths in DEPLOYMENT.md.
- **Verified**: CORE_STANDARDS.md, ABAC_SYSTEM.md, AUDIT_TRAIL.md, RLS_POLICIES.md, COMPLIANCE_MAP.md.

### Fixed

- **React 18.3.1**: Downgraded `awcms-public/primary` to comply with strict version constraint.
- **Lockfile**: Synced `package-lock.json` for Cloudflare CI.

## [2.9.1] - 2026-01-09

### Security

- **XSS Prevention**: Refactored `dangerouslySetInnerHTML` usage to use strict `DOMPurify` sanitization across all visual builder blocks and public pages.

### Infrastructure

- **CI/CD Fixes**: Corrected GitHub Actions workflow paths for caching (`awcms-public/primary`) and Flutter build (`awcms-mobile/primary`).
- **Cloudflare Support**: Added proxy configuration to support `awcms-public` build without root directory changes.

### Docs

- **Folder Structure**: Updated docs to reflect the specific `primary` subdirectory structure for public and mobile apps.
- **Audited**: Verified alignment between documentation claims and codebase implementation.

## [2.9.0] - 2026-01-05

- Dashboard UI refactor to use standardized AdminPageLayout
- Resolved all remaining ESLint warnings
- Fixed Turnstile CAPTCHA validation flow
- Updated project dependencies to latest stable versions
- Released v2.9.0

## [2.8.0] - 2025-12-28

- Mobile admin module integration
- Esp32 IoT module enhancements
- Database schema updates for device management
