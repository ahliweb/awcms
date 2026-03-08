<!-- markdownlint-disable MD024 -->
# Changelog

All notable changes to the **AWCMS** project will be documented in this file.

## [Unreleased]

## [3.1.0] - 2026-03-09

### Changed

- Media: Unified the admin media system on canonical `media_objects` backed by Cloudflare R2 signed uploads and Worker-side finalize writes, removing the parallel gallery-manager flow and pointing public photo/video galleries at filtered canonical media records.
- Documentation: Re-baselined the documentation audit plan/tracker to the current repository inventory
  (`115` markdown files, `71` docs, `127/127` mirrored migrations), refreshed the docs hub and
  README status snapshot, and added an explicit conflict-resolution queue for broken links,
  dependency drift, script accuracy, CI coverage, and missing package-doc surfaces.
- Documentation: Added the missing `docs/architecture/ollama-integration.md`, added a compatibility-only
  `docs/modules/STITCH_IMPORT.md`, and created maintained README coverage for `awcms-edge/` and
  `packages/awcms-shared/` while reconciling setup/CI docs against live manifests and workflows.
- Tooling: Added `scripts/check_markdown_local_links.mjs`, wired it into `awcms` `docs:check` and
  the docs-link-check workflow, and added dedicated GitHub Actions jobs for `awcms-edge` and
  `awcms-mcp` validation.
- CI: Added dedicated validation jobs for `awcms-ext/primary-analytics` and `packages/awcms-shared`,
  aligned the docs-link workflow with the maintained-doc policy, and added package-level validation
  scripts/types needed for those new CI surfaces.
- Documentation: Reconciled schema, security, and tenancy docs with the current migration/helper
  baseline by updating the database schema snapshot, documenting the recursion-safe
  `current_tenant_id()` behavior, and standardizing tenant provisioning guidance on the canonical
  6-argument `create_tenant_with_defaults(...)` signature.
- Documentation: Updated deploy/module docs to reflect `awcms-edge/` as the primary edge deploy
  surface, the current GitHub Actions secret mapping split between push and PR workflows, direct
  public blog queries against `blogs`, package-manifest version authority, and the current editor
  soft-delete baseline.
- Documentation: Reconciled additional module docs for monitoring, performance, extensions, menu,
  theming, and module inventory so they match current Worker logging boundaries, router usage,
  extension workspace layout, and actual route-backed manager coverage.
- Documentation: Closed the last high-confidence closure-pass drift in dev/deploy/compliance docs by
  correcting mirrored function path references, current CI branch/path behavior, PlatformIO-based
  ESP32 versioning, SMANDAPBUN session wording, and public privacy/terms guidance.
- Documentation: Closed the 2026-03-08 maintained-doc audit cycle by rerunning parity/validation
  gates, restoring local migration history parity, and carrying remaining dependency upgrades into a
  separate maintenance backlog.
- Documentation: Added a concrete dependency-upgrade follow-up plan for `awcms`,
  `awcms-public/primary`, and `awcms-mcp` so the remaining package drift can be addressed in staged,
  validation-backed batches.
- Configuration: Disabled Supabase storage and edge-runtime services in `supabase/config.toml` for the
  current local baseline.
- Dependencies: Completed Batch A MCP dependency maintenance by updating `@types/node` to the latest
  Node 22-compatible patch range and `@types/pg` to `^8.18.0`, with lint/build validation passing.
- Dependencies: Completed Batch A public-portal dependency maintenance by updating the low-risk
  ESLint/globals/lucide packages in `awcms-public/primary` and fixing the surfaced sidebar/menu/
  localized-slug lint and type issues so `npm run check` and `npm run build` pass again.
- Dependencies: Completed the safe Batch A admin dependency maintenance path by updating
  `lucide-react`, `jsdom`, `@types/node`, and the ESLint 9 patch line in `awcms`, while explicitly
  excluding `e2e/**` from Vitest runs so unit tests remain separate from Playwright coverage.

### Fixed

- Media: Corrected the Cloudflare Worker tenant-role lookup for upload sessions, aligned admin/media pickers with canonical public URL helpers, and restored category-aware Media Library uploads and filtering.
- Documentation: Fixed `DOCS_INDEX.md` so optional local `.agents/*` directories are documented as
  non-link code paths instead of broken local markdown links.
- Tooling: Reworked `scripts/check_markdown_local_links.mjs` to replace regex-based comment stripping
  with a stateful scanner for fenced code blocks and HTML comments, resolving the CodeQL
  incomplete-sanitization finding while keeping docs validation behavior unchanged.

## [3.0.0] "Convergence" - 2026-03-08

### Added

- Agent Rules: Created `styling-guard.md` — enforces semantic CSS variables, prevents hardcoded hex/rgb in components.
- Agent Rules: Created `soft-delete-enforcer.md` — enforces `deleted_at` lifecycle, prevents hard deletes on business data.
- Agent Rules: Created `edge-function-safety.md` — enforces Supabase-only backend, prevents Node.js server creation.
- User Stories: Added 14 new stories for Tenant Auditor (AD-1–3), IoT/Device Operator (IO-1–3), AI-Assisted Content (AI-1–3), Multi-Language (ML-1–3), and Email Integration (EM-1–2).

### Changed

- Configuration: Renamed `awcms/wrangler.toml` project name from `awcms-public` to `awcms-admin` across all environments.
- Configuration: Added `PUBLIC_TENANT_ID` to `awcms-public/primary/.env.example` and `awcms-public/smandapbun/.env.example`.
- Configuration: Added `temp_supabase/` to `.gitignore`.
- Dependencies: Pinned the public Tailwind v4 toolchain in `awcms-public/primary/package.json` to `4.1.18` until Astro's current Vite typing surface is compatible with the newer `4.2.x` plugin release.
- Documentation: Updated `AGENTS.md` workflow standards with 3 new agent rule references.
- Documentation: Refreshed the repository-wide documentation audit plan/tracker for a 2026-03-08 full-scope review and updated authority docs to remove Stitch from the top-level README status baseline.
- Documentation: Restructured `docs/product/PRD.md`, `docs/product/USER_STORY.md`, and `docs/product/ACCEPTANCE_CRITERIA.md` into a minimal, aligned product documentation set and synced `DOCS_INDEX.md` descriptions.
- Documentation: Aligned public-portal architecture docs to the canonical Astro static-output model and clarified that middleware-based analytics logging is non-canonical runtime behavior.
- Documentation: Refreshed maintained docs across deploy/dev guides, module guides, package READMEs, and OpenCode/MCP setup references to match the current runtime model, env naming, and static public build flow.
- Documentation: Added `.markdownlintignore`, resolved the remaining repo-linted markdown debt, and updated the audit tracker to record a passing repository-wide markdownlint baseline.
- Wiki: Synced 6 new files and 4 updated files to local GitHub wiki, updated `Home.md`.

### Fixed

- Supabase: Restored root/mirror parity by adding the missing mirrored migration/function files and correcting the `resources_registry` insert in `20260308070000_add_cloudflare_media_schema.sql`.
- Scripts: Updated `scripts/verify_supabase_function_consistency.sh` to ignore local-only `supabase/functions/.env` files so secret material does not break parity validation.
- Scripts: Updated `scripts/verify_supabase_migration_consistency.sh` to derive `SUPABASE_DB_PASSWORD` from existing DB URLs for linked checks, and updated `scripts/verify_supabase_function_consistency.sh` to retry with the local Supabase CLI profile when an env token returns `401`.
- Validation: Resolved public workspace formatting drift in `awcms-public/primary/package.json`, restored `awcms-public/primary/astro.config.ts` compatibility after the Tailwind `4.2.x` regression, and revalidated the public check/build pipeline.

## [2.33.0] "Blueprint" - 2026-02-28

### Added

- Context Engineering: Created `docs/product/PRD.md` (Product Requirements Document) with personas, capabilities, non-goals, and success metrics.
- Context Engineering: Created `docs/product/USER_STORY.md` with user stories by persona mapped to ABAC roles.
- Context Engineering: Created `docs/product/ACCEPTANCE_CRITERIA.md` with testable criteria for tenancy, ABAC, data integrity, security, and build quality.
- Agent Rules: Created 7 guardrail playbooks in `.agents/rules/` — `tenancy-guard`, `rls-policy-auditor`, `abac-enforcer`, `migration-guardian`, `no-secrets-ever`, `sanitize-and-render`, `release-readiness`.
- Agent Workflows: Created 4 step-by-step procedures in `.agents/workflows/` — `migration-workflow`, `rls-change-workflow`, `ui-change-workflow`, `ci-validation-workflow`.
- AI Workflows: Created `docs/dev/ai-workflows.md` with prompt templates, plan mode triggers, and self-correction loops.
- Compliance: Created `docs/compliance/pdp-uu27-2022.md` (UU PDP data subject rights, incident reporting, deployer checklist).
- Compliance: Created `docs/compliance/pp71-2019-pste.md` (PP 71/2019 PSE obligations, security governance, data localization).
- Documentation: Added benchmark-ready sections for the ten Context7 benchmark prompts using a standard structure: Objective, Required Inputs, Workflow, Reference Implementation, Validation Checklist, and Failure Modes and Guardrails.
- Documentation: Added maintained package README coverage for `awcms-public/smandapbun` and updated `awcms-public/README.md` routing.
- Documentation: Added `WIKI_UPDATE_SUMMARY.md` detailing Context7-based 2026-Q1 full re-audit cycle documentation updates to the GitHub wiki.

### Changed

- Compliance: Expanded `docs/compliance/iso-mapping.md` from basic 27001 table to full 10-standard coverage (27001/27002/27005/27017/27018/27701/27034/20000/22301/15408).
- Compliance: Updated `docs/compliance/overview.md` with cross-references to new split compliance documents.
- Documentation: Updated `DOCS_INDEX.md` with Product & Specs, Compliance, Agent Guidance, and AI Workflows sections.
- Documentation: Updated `AGENTS.md` with Workflow Standards section referencing all agent rules and workflows.
- Documentation: Completed the 2026-Q1 Context7 re-audit cycle (Phase 0–5) and updated the audit plan/tracker with closure evidence.
- Documentation: Normalized markdown structure in maintained mobile/ESP32/extension package READMEs to satisfy markdownlint validation gates.
- Documentation: Revised documentation audit plan to clarify scope and integrate Context7 as primary reference for library best practices.

### Removed

- Documentation: Removed Context7 Benchmark Remediation section from `AGENTS.md` (consolidated into benchmark implementation details).

## [2.32.1] "Codex" - 2026-02-27

### Added

- Added `docs/dev/documentation-audit-tracker.md` as the docs-audit drift register and phase tracker.
- Added `awcms-mcp/README.md` with setup, scripts, and environment guidance.

### Changed

- Phase 1: reconciled authority docs and aligned CI Node runtime to `22.12.0`.
- Phase 2: documented canonical dual-root Supabase policy and reconciled Stitch/resource security references.
- Replaced `DOCUMENTATION_UPDATE_SUMMARY.md` references with `CHANGELOG.md` in docs-audit planning docs.
- Phase 3: aligned setup/troubleshooting/CI/CD/deploy docs with live workflows, secret mapping, and Supabase consistency checks.
- Phase 4: completed full module/package docs sweep and resolved remaining high-impact drift.

### Fixed

- Added local Performance Advisor FK index troubleshooting runbook using `supabase/manual/check_advisors.sql`.
- Added `scripts/verify_supabase_function_consistency.sh` to the setup runbook script matrix.
- Standardized mobile/ESP32 package docs to `SUPABASE_PUBLISHABLE_KEY` naming.
- Corrected root documentation links in `awcms-mobile-java/README.md`.
- Clarified user deletion docs to explicit soft-delete update workflow behavior.

### Removed

- Removed obsolete backup-only migrations from `awcms/supabase/migrations_backup/`.
- Removed legacy one-off scripts in `awcms/scripts/` not used by active runbooks or package scripts.
- Removed stale summary artifacts (`ASTRO_V5_UPGRADE_SUMMARY.md`, `DOCUMENTATION_UPDATE_SUMMARY.md`, `REFACTORING_COMPLETION_SUMMARY.md`, `awcms/analysis_report.md`) and retired root-level ad-hoc SQL checks.

## [2.32.0] "OpenClaw Gateway" - 2026-02-23

### Security

- Dependency Audit: Fixed 17 npm vulnerabilities (minimatch ReDoS + ajv) across `awcms` and `awcms-public/primary` via overrides and `npm audit fix`.
- OpenClaw Gateway: Hardened with token auth, rate limiting (10/60s, 5min lockout), loopback binding, and chmod 600 config permissions.

### Added

- OpenClaw Integration: Installed OpenClaw CLI v2026.2.21-2 with multi-tenant AI gateway config (per-tenant agent isolation via `~/.openclaw/openclaw.json`).
- Node.js Upgrade: Upgraded from v20.20.0 to v22.22.0 via nvm (required by OpenClaw >=22.12.0).
- Missing Dependency: Added `react-leaflet` to `awcms` to fix pre-existing build failure.
- Admin Routing: Introduced sub-slug routing for tabbed modules, trash views, approvals, and editor screens to support refresh-safe deep links.
- Route Signing: Added signed route params and helper hooks to prevent guessable edit/detail URLs (with legacy redirects).
- Documentation: Added local admin bootstrap guidance and a focused public portal README for the primary template.

### Changed

- Node.js Constraints: Updated engine constraints in all `package.json` files to `>=22.12.0` to match openclaw dependency documentation.
- Documentation Summary: Completed comprehensive documentation audit across 85+ files. Updated `SYSTEM_MODEL.md`, `AGENTS.md`, `README.md`, `DOCS_INDEX.md`, `tech-stack.md`, `documentation-audit-plan.md`, and `SECURITY.md` to reflect OpenClaw integration, Node 22 requirement, and new dependencies.
- Sidebar Access: Platform admin/full-access roles now see all visible sidebar items regardless of permission filters.
- Permission Matrix UI: Added resource counts, sticky headers, and scrollable layout improvements for large matrices.
- Dashboard UI: Standardized widget headers and card styling, including plugin widgets.
- Documentation Updates: Aligned tech stack versions, updated Supabase client examples, and refreshed routing/Puck/TipTap guidance to match Context7 best practices.
- Public Portal Docs: Trimmed the public portal root README to point to canonical guides.

### Fixed

- Linting: Fixed line-length lint warning in `AGENTS.md` to pass markdownlint checks.
- Legacy Links: Redirected query-string links (blogs review queue and visual editor) to the new sub-slug routes.

## [2.31.0] "Persona" - 2026-02-16

### Security

- Admin Profile Encryption: Added encrypted admin-only profile fields keyed by salted profile descriptions.

### Added

- Turnstile Host Mapping: Added `VITE_TURNSTILE_SITE_KEY_MAP` support for per-domain Turnstile keys and a localhost test-key fallback.
- Repo Hygiene: Ignored `temp_debug_images/` from git tracking.
- Turnstile Secrets: Added `TURNSTILE_SECRET_KEY_MAP` support for host-specific Turnstile secrets in Edge Functions.
- Dashboard UI: Added shared `dashboard-surface` and `dashboard-surface-hover` utilities for consistent card styling.
- Auth Shell: Introduced a shared authentication layout for login, reset, and registration flows.
- Shipping Calculation: Implemented dynamic shipping cost calculation in Checkout with support for multiple couriers (JNE, J&T, POS, TIKI).
- Turnstile Debugging: Added `VITE_TURNSTILE_DEBUG` to ensure host/key resolution logging when needed.
- Supabase MCP: Integrated Supabase MCP for improved project management and local development support.

- User Profiles: Added `user_profiles` and `user_profile_admin` tables, and refactored `UserEditor`/`UsersManager` for detailed profile and admin field management.

- Mobile App: Added profile customization, theme switcher, and permission handling.
- Admin Configuration: Added Context7 server configuration in `.bashrc` and codebase.
- Media Management: Introduced media categories for better asset organization.
- Sidebar Navigation: Implemented dynamic navigation structure with `navigation.ts` and `SideBarIcon.astro`.
- Code Quality: Configured ESLint and Prettier for improved code consistency.

### Changed

- Security Standards: Standardized Supabase API key terminology (`PUBLISHABLE_KEY`, `SECRET_KEY`) globally and strictly enforced usage rules.
- Docs: Recommended `supabase db pull --schema public,extensions` to avoid storage churn in shadow DBs.
- Turnstile Logging: Key-selection logs are now dev-only.
- Admin UX: Refined dashboard layout, page header hierarchy, sidebar styling, and card surfaces for a more polished UI.
- Auth UI: Redesigned login, reset-password, and register screens with new layout, typography, and CTA styling.
- Toast Styling: Updated toast colors, borders, and accent bars for clearer status feedback.
- Profile UX: Refined the profile page layout, avatar upload flow, and 2FA surface styling.
- Tenant Settings UX: Polished branding settings layout and controls for a more consistent admin feel.
- Users/Roles UX: Improved table surfaces, search bars, and edit dialogs for user and role management.
- Permissions UX: Updated permission list surfaces, dialogs, and controls to match the refreshed admin style.
- Region Picker: Refactored `RegionPicker` to fetch levels dynamically from the database and resolved `region_levels` hierarchy conflicts.
- Taxonomy: Restricted Tags to Blog module only; ensured Categories are globally accessible across modules.
- Notifications UX: Replaced native confirm prompts with AlertDialog confirmations for mark-all-read and notification deletion.

### Fixed

- Mobile Auth: Fixed a logging issue by checking mounted state before using ref after async operation.

- Tenant Creation: Resolved unique constraint collisions causing 409 Conflict errors during new tenant creation.
- Database Synchronization: Reset local migration history to match remote schema and resolved `region_levels` data duplicates.
- RLS Policy: Fixed RLS policies and queries for improved security and stability.

## [2.30.0] "Waypoint" - 2026-02-07

### Security

- Dependencies: Fixed high severity vulnerability in `wrangler` (and `undici`) by overriding version to `^4.61.1` in `awcms-public/smandapbun`.

### Added

- Public Portal Static Helpers: Added build-time tenant and settings helpers (`publicTenant`, `publicSettings`) for static Astro builds.
- DB Tooling: Added `20260207123000_fix_index_advisor_text_array_init.sql` and `awcms/scripts/apply_index_advisor_fix.sh` to resolve index_advisor lint warnings after resets.
- Storage Config: Added Supabase S3 endpoint/region/bucket env entries for server and public metadata.

### Changed

- Public Portal Rendering: Standardized on static output with build-time tenant resolution (`PUBLIC_TENANT_ID`) and removed `Astro.locals` reliance across pages/layouts.
- Supabase Client: Added `PUBLIC_SUPABASE_*` env fallbacks for public builds.
- Dependencies: Updated extension peer dependencies to React 19.
- Documentation: Synchronized public portal, tenancy, and architecture docs to the static build model and Context7 best practices.

### Fixed

- Supabase Content Fetching: Added fallback queries for blog/page content when schema cache relationships are missing.
- Public Portal Build Stability: Fixed nullability issues in contact/blog pages and removed noisy Turnstile logging.

## [2.29.0] "Equilibrium" - 2026-02-03

### Added

- Visitor Statistics: Added analytics event tracking (IP, page paths, referrers, device/geo) with daily rollups.
- Visitor Statistics: Introduced an Admin Panel module for visitor insights and a public visitor stats page.
- Visitor Statistics: Added a tenant-configurable cookie consent notice for analytics disclosure.

### Changed

- Database Synchronization: Stabilized local-to-remote schema sync by neutralizing conflicting system triggers on the `storage` schema.

### Fixed

- Performance: Resolved Supabase Advisor warnings for unindexed foreign keys and redundant RLS policies on `analytics_daily`.
- Database Lint: Fixed type mismatch warning in `extensions.index_advisor`.

## [2.28.0] "Aegis" - 2026-02-01

### Added

- Contact Form Security: Implemented Cloudflare Turnstile with explicit rendering across tenants (`smandapbun`, `primary`) for stronger spam protection.
- Contact Form Security: Added callback polling so Turnstile renders reliably on slow connections.
- User Experience: Integrated a global **Toast Notification System** (replacing native alerts) for immediate visual feedback on form submission success/failure.
- Auditing: Added `ip_address` column to `contact_messages` table to track submission sources.
- Auditing: Updated `verify-turnstile` Edge Function to capture and return client IP addresses (`CF-Connecting-IP`).
- Auditing: Added **IP Address** column to the Admin Panel's Contact Messages manager.

### Changed

- Code Quality: Enforced stricter TypeScript checks in `smandapbun` forms.
- Code Quality: Standardized `turnstile` and `showToast` global type definitions.

### Fixed

- Turnstile Stability: Resolved issues where the Turnstile widget would sometimes fail to render (invisible) by moving to explicit rendering mode.
- Dependencies: Resolved "missing module" build errors for `@supabase/supabase-js` by fixing TypeScript module resolution.
- Linting: Fixed various ESLint and Prettier issues in `smandapbun`.

## [2.27.0] "Foundation" - 2026-02-01

### Added

- Database-Driven UI/UX (Foundations): Created `resources_registry`, `ui_configs`, and `component_registry` tables to store all UI/module definitions.
- Database-Driven UI/UX (Foundations): Implemented `DynamicResourceManager` and `SchemaForm` to render flexible, schema-based administration pages.
- Database-Driven UI/UX (Foundations): Added new dynamic routes `/cmspanel/resources/:resourceKey` and `/cmspanel/res/:resourceKey`.
- Database-Driven UI/UX (Foundations): Created a test resource (`test_dynamic`) with a fully functional settings-form schema.
- Resource Management: Populated the `resources_registry` with over 40 standard system resources.
- Resource Management: Established a formal `RESOURCE_MAP.md` doc as the source of truth for all modules.

### Changed

- Admin Navigation: Updated `useAdminMenu` to fetch resource metadata (label, icon, type, permissions) from the database instead of hardcoded config.
- Admin Navigation: Linked `admin_menus` table directly to `resources_registry` via `resource_id`.
- Permission Normalization: Migrated proper permissions (ABAC) to `tenant.{module}.{action}` format across the database and codebase.
- Permission Normalization: Updated 18 React components in `src/components/dashboard/` to use the new tenant-scoped permission keys.
- Permission Normalization: Replaced legacy `manage_platform` check in `GenericContentManager` with appropriate context boolean.
- Permission Normalization: Soft-deleted legacy permission keys that conflicted with the new normalized format.
- Database Synchronization: Updated `audit_logs` migration logging to match schema (using `resource` and `details` columns).
- Database Synchronization: Synced local migrations with remote database, capturing drift in `20260201015918_remote_schema.sql` (Storage triggers).
- Database Synchronization: Repaired migration history for 8 previously missing remote migrations.
- Security Documentation: Updated `abac.md` security documentation with comprehensive module mapping.

## [2.26.0] "Spectrum" - 2026-01-30

### Added

- Tenant Hierarchy: Added parent/level/path fields for up to five tenant levels.
- Tenant Hierarchy: Added configurable resource sharing with registry and per-tenant rules.
- Role Inheritance: Added auto vs linked inheritance mode and tenant role links.
- Reporting Permissions: Added platform reporting permissions for read and bulk actions.
- Public Portal (Smandapbun): Added bilingual support (Indonesian/English) for all pages in `src/pages/en`.
- Public Portal (Smandapbun): Added category filtering for Gallery page.
- Public Portal (Smandapbun): Added custom Vanilla JS Lightbox for Gallery with slide navigation and captions.

### Changed

- Tenant Management: Added parent tenant selection, resource sharing rules, and role link controls.
- Tenant Management: Tenant creation now uses `create_tenant_with_defaults` for consistent seeding.
- Access Control: Updated RLS policies to respect shared vs isolated resources across tenant levels.
- Documentation: Synchronized numerous `docs/` guides (setup, CI/CD, deploy, tenancy, architecture, modules, i18n, security) with current paths, `VITE_*` env var usage, `npx supabase` commands, and the `blogs` table naming conventions.
- Documentation: Normalized all cross-doc references to the new root `docs/` tree instead of legacy `awcms/docs` paths.
- Public Portal (Smandapbun): Updated homepage hero image to `kegiatan-sekolah/IMG_6411.webp`.
- Public Portal (Smandapbun): Updated site-wide phone number to `082254008080`.
- Public Portal (Smandapbun): Removed Fax information from contact data and UI.
- Public Portal (Smandapbun): Updated operational hours to "Senin - Jumat: 07:00 - 15:00 WIB".
- Public Portal (Smandapbun): Updated default stats for alumni and achievements in `site.json` and `api.ts`.
- Public Portal (Smandapbun): Refactored `galeri.astro` to flatten album structure and support filtering.

### Fixed

- Reporting: Platform reporting now checks explicit `platform.reporting.read` permission.
- Database Tooling: Added `SET client_min_messages TO warning` at the start of several migrations so `npx supabase db pull` runs without noisy "does not exist" notices.

## [2.25.0] - 2026-01-27

### Added

- Documentation: Added "How to Choose and Use AI Models in OpenCode Zen" guide (`docs/guides/opencode-models.md`).
- Role Management: Added DB-driven role flags, onboarding defaults, and 10-level staff hierarchy support.
- Role Management: Added tenant isolation and tenant IDs for extension registry tables.
- Database: Added migrations for role flags (`20260127090000`), extension tenant isolation (`20260127094000`), and advisor lint fix (`20260127121000`).

### Changed

- Access Control: Replaced hardcoded role-name checks with role flags across admin/public UI and Edge Functions.
- Access Control: Updated onboarding approval flow to use platform admin flag checks.
- Extensions: Scoped extension install, registry, and plugin loading to the current tenant.
- Documentation: Updated role, RLS, extensions, and onboarding docs to match schema and permissions.

### Fixed

- Supabase Lint: Resolved `extensions.index_advisor` type mismatch warning by casting `statements` to `text[]` when privileges allow.

## [2.24.0] "Nexus" - 2026-01-23

### Added

- Documentation Overhaul: Synchronized `database.md`, `standards.md`, and `AGENTS.md` with the latest database schema and codebase patterns, specifically covering the **Unified Content Model** and **Modules Management** system.
- Documentation Overhaul: Added detailed schema documentation for `page_tags`, `page_files`, and `content_translations`.
- Documentation Overhaul: Documented the `modules` table, its RLS policies, and the `tenant.modules.read` permission.
- Documentation Overhaul: Updated `MODULES_GUIDE.md` to include information about the `Modules Manager`.
- School Activity Images: Added new gallery images to the public portal and updated the gallery page component.

### Changed

- Database Migrations: Added `20260121235324_remote_schema.sql` after syncing the remote schema via `supabase db pull`.

### Fixed

- Performance & Reliability: Corrected broken relative links across the documentation library to ensure link integrity.
- Database Migrations: Guarded `ALTER TABLE public.blogs` with `IF EXISTS` in `20260120091500_unified_content_model.sql` to prevent `db pull` failures.
- Security: Pinned `lodash` to `^4.17.23` across public templates and admin packages to address prototype pollution alerts.

## [2.23.1] "Antigravity" - 2026-01-22

### Changed

- Project-Wide Terminology Standardization: Renamed "News" and "Article" to "Blog" across all repositories (`awcms`, `awcms-public`, `awcms-mobile`).
- Project-Wide Terminology Standardization: Updated Smandapbun template: renamed `/berita` routes to `/blogs`, updated translation keys, and standardized internal components.
- Project-Wide Terminology Standardization: Refactored Admin Panel: Renamed `ArticlesManager` to `BlogsManager`, updated `ArticleEditor` to `BlogEditor`, and standardized Visual Builder blocks.
- Project-Wide Terminology Standardization: Updated Mobile App: Refactored DAOs and Services to use "blog" terminology (`BlogsDao`, `SyncService`).
- Project-Wide Terminology Standardization: Standardized database conventions and localization resources (`en.json`, `id.json`, `app_en.arb`, `app_id.arb`).

### Fixed

- Public Portal (Smandapbun): Fixed `SiteImages` type mismatch in `api.ts` with legacy mapping support.
- Public Portal (Smandapbun): Resolved missing terminology in navigation and footer components.

### Added

- SEO Default Configuration: Renamed "SEO" to "SEO Default" in Sidebar and SEO Manager for clarity.
- SEO Default Configuration: Implemented automatic pre-filling of global SEO settings (Title, Description, Keyword, OG Image) when creating new Pages.
- SEO Default Configuration: Updated `PageEditor` to fetch default values from `seo_global` settings.
- Public Portal (Astro): Initialized Astro project configuration and directory structure for public school templates.
- Public Portal (Astro): Configured `@astrojs/tailwind`, `@astrojs/sitemap`, and `astro-icon` integrations.
- Theme Management: **Dark Mode Support**: Added dedicated "Dark Mode" color configuration in Theme Editor.
- Theme Management: **Dual-Mode Theming**: Implemented independent light/dark CSS variable injection via `themeUtils`.
- Theme Management: **Reset Functionality**: Added "Reset to Defaults" button in `ThemeEditor` to restore factory color palettes for both modes.
- Theme Management: **Live Preview**: Added toggle to switch between Light and Dark mode previews while editing.

### Changed

- Localization: Updated Indonesian (`id.json`) translations for "SEO Default Configuration".
- Code Refactor: Centralized Supabase client imports across Admin components.
- Code Refactor: Standardized `PageHeader` component path references.

### Fixed

- Public Portal (smandapbun): Resolved all `astro check` errors and type mismatch issues.
- Public Portal (smandapbun): Optimized localized list processing with explicit type casting in Astro templates.
- Public Portal (smandapbun): Cleaned up unused imports and variables across the entire template.
- Public Portal (smandapbun): Restored missing critical imports in financial, achievement, and service pages.
- Public Portal (smandapbun): Resolved deployment build errors by adding `VITE_` prefix fallbacks for Supabase credentials in `src/lib/supabase.ts`.

## [2.23.0] "Vortex" - 2026-01-21

### Added

- Sidebar Admin: `SidebarMenuManager` with role-based filtering, icon picker, and nested group support.
- Sidebar Admin: Updated `Sidebar` component with permission checks, collapsible sections, and favorites.
- Module Management: `ModulesManager` component for listing all system modules (Owner/SuperAdmin view all, Admin view tenant-scoped).
- Module Management: Database migration for `modules` table with RLS policies and `tenant.modules.read` permission.

### Fixed

- Notification System: Resolved RLS error during notification creation by ensuring `tenant_id` is explicitly passed to the insert operation.
- Database Synchronization: Repaired migration history to resolve timestamps conflicts.
- Database Synchronization: Successfully synced local migration files with remote database (`npx supabase db push`) and resolved all schema diffs (`npx supabase db pull`).
- Code Quality: Resolved ESLint warnings in `ModulesManager.jsx` (unused variables, hooks dependencies).

### Security

- Supabase Advisor: Resolved `security_definer_view` warning for `published_articles_view` by setting `security_invoker = true`.
- Supabase Advisor: Resolved `auth_rls_initplan` warnings by implementing `get_current_tenant_id()` stable function and wrapping `auth.uid()` in RLS policies.
- Supabase Advisor: Optimized RLS policies for `page_tags`, `page_files`, `content_translations`, and `audit_logs`.

## [2.22.0] "Convergence" - 2026-01-20

### Added

- Unified Content Model: Database migration for `page_tags`, `page_files`, `content_translations` tables
- Unified Content Model: Extended `pages` table with `category_id`, `meta_title`, `meta_keywords`, `og_image`, `canonical_url`
- Unified Content Model: Added `sync_source_id` to content tables for cross-tenant synchronization

- Admin Panel: `UnifiedContentEditor.jsx` - Multi-mode editor (Visual/RichText/Markdown)
- Admin Panel: `SeoMetadataPanel.jsx` - Collapsible SEO fields panel
- Admin Panel: Enhanced `PagesManager.jsx` with Tags tab and SEO fields
- Admin Panel: Added "Content" unified category type in `CategoriesManager.jsx`

- **Public Portal Libraries** (11 new TypeScript modules): `menu.ts` - Dynamic menu fetching from Supabase
- **Public Portal Libraries** (11 new TypeScript modules): `widgets.ts` - Widget area management
- **Public Portal Libraries** (11 new TypeScript modules): `plugins.ts` - Analytics plugins (GA, FB Pixel, Hotjar, Crisp)
- **Public Portal Libraries** (11 new TypeScript modules): `extension_registry.ts` - Extension management with registry pattern
- **Public Portal Libraries** (11 new TypeScript modules): `i18n.ts` - Multilingual translations and locale detection
- **Public Portal Libraries** (11 new TypeScript modules): `tenant_sync.ts` - Cross-tenant content synchronization
- **Public Portal Libraries** (11 new TypeScript modules): `theme.ts` - Dynamic theming with CSS variables
- **Public Portal Libraries** (11 new TypeScript modules): `sitemap.ts` - XML sitemap generation
- **Public Portal Libraries** (11 new TypeScript modules): `search.ts` - Full-text search across content
- **Public Portal Libraries** (11 new TypeScript modules): `sidebar.ts` - Sidebar navigation management

- **Public Portal Components** (6 new Astro components): `PuckRenderer.astro` - Render 15+ Puck visual builder components
- **Public Portal Components** (6 new Astro components): `WidgetRenderer.astro` - Render 12 dynamic widget types
- **Public Portal Components** (6 new Astro components): `PluginLoader.astro` - Script injection at head/body positions
- **Public Portal Components** (6 new Astro components): `ThemeLoader.astro` - Dynamic CSS variable injection
- **Public Portal Components** (6 new Astro components): `Sidebar.astro` - Dynamic sidebar navigation
- **Public Portal Components** (6 new Astro components): `SidebarLayout.astro` - Layout with integrated sidebar

### Changed

- Extended `MetaData` type with `keywords` field
- Updated `Metadata.astro` to render meta keywords tag
- Integrated `ThemeLoader` and `PluginLoader` into `Layout.astro`

## [2.21.1] "Synchronization" - 2026-01-20

### Added

- Database Synchronization: **Baselining**: Consolidated fragmented migration history into a single baseline file (`20260119230212_remote_schema.sql`) to resolve persistent "Duplicate Primary Key" conflicts during `db pull`.
- Database Synchronization: **Stability**: Verified full synchronization between local environment and remote database.

### Fixed

- Migration Mismatch: Resolved "Remote migration versions not found" in CI by synchronizing root (`supabase/migrations`) and sub-project (`awcms/supabase/migrations`) directories.
- Migration Mismatch: Removed 37 obsolete migration files from root directory to match remote database state.
- RLS Security: Added `auth_is_admin()` SECURITY DEFINER function via `20260120000001` migration to safely bypass RLS recursion.
- RLS Security: Pulled latest remote schema changes (`20260120002708_remote_schema.sql`) to ensure full alignment.

## [2.21.0] "Nexus" - 2026-01-20

### Added

- Multi-Tenancy & SEO Integration: **SEO Data Flow**: Public Portal now fetches global SEO settings (Title, Description, OG Image) from Admin Panel via `middleware.ts`.
- Multi-Tenancy & SEO Integration: **Tenant Context**: Implemented `getTenant` helper in Public Portal to provide full tenant profile access (`locals.tenant`) to all components.
- Multi-Tenancy & SEO Integration: **Permission Alignment**: Added permission keys for renamed resources (`projects.*`, `testimonials.*`).

### Changed

- Database Alignment: Renamed `portfolio` table to `projects` to align with Public Portal expectations.
- Database Alignment: Renamed `testimonies` table to `testimonials` to align with Public Portal expectations.
- Database Alignment: Updated `PortfolioManager` and `TestimonyManager` in Admin Panel to use new resource names.

### Fixed

- Sidebar Visibility: Restored visibility of "Email Settings" and "Email Logs" in the admin sidebar.
- Sidebar Visibility: Updated `useAdminMenu` fallback configuration to include missing email menu items.
- Sidebar Visibility: Manually seeded `admin_menus` table with missing entries for Mailketing plugin.
- Code Quality: Fixed `any` type errors in `awcms-public/primary/src/env.d.ts` for strict TypeScript compliance.

## [2.20.0] "Vanguard" - 2026-01-19

### Added

- RLS Security: Implemented `auth_is_admin()` SECURITY DEFINER function to safely bypass RLS recursion for platform admins.
- Permission Templates: Restored functionality for "Viewer Set", "Editor Set", and "Manager Set" buttons in Role Editor for all tenant roles.
- Admin Dashboard: **Neo-Glass Aesthetic**: Standardized `StatCards`, `ActivityFeed`, and `PlatformOverview` with consistent blur/opacity (`bg-white/60`, `backdrop-blur-xl`) and typography.
- Admin Dashboard: **Console Fix**: Resolved Recharts `width(-1)` warning by enforcing minimum container dimensions.
- Database: **Hard Delete**: Added `{ force: true }` support to `UnifiedDataManager` for permanent deletions.
- Database: **Synchronization**: Repaired migration history and fully synced local/remote schemas.
- Global Localization: **Audit**: Completed comprehensive audit of all hardcoded strings across `awcms`, `awcms-public`, and `awcms-mobile`.
- Global Localization: **Admin Panel**: Localized `Dashboard`, `Login`, and `Widget` components with `i18next`.
- Global Localization: **Public Portal**: Localized `Hero`, `Features`, `Contact`, `About`, and `Pricing` pages with `id`/`en` JSON resources.
- Global Localization: **Mobile App**: Implemented `flutter_localizations` with ARB files and refactored core screens (`Home`, `Login`, `Notifications`).

### Fixed

- User Editor Dark Mode: Resolved unreadable white backgrounds and light text in "Create New User" modal when in dark mode.
- Permission Saving: Fixed critical `42501` RLS violation when saving role permissions by using the new `auth_is_admin()` bypass.
- Role Permissions: Hardened upsert logic in `RoleEditor.jsx` to prevent data loss during updates.

## [2.19.0] "Evolution" - 2026-01-19

### Added

- Rebranding: Renamed all public-facing branding from "Arthelokyo" to "AWCMS".
- Rebranding: Updated social media handles and footer configuration.
- Language Persistence: Implemented `lang` cookie for persistent language selection across sessions.
- Language Persistence: Updated Middleware to respect cookie preferences when URL prefix is missing.
- Public Portal: Updated Language Switcher to use explicit `/en` and `/id` paths for better SEO and routing.

### Fixed

- Code Quality: Resolved `react-hooks/exhaustive-deps` warnings in `PolicyManager` and `ThemeEditor` by adding missing `t` dependency.

## [2.18.0] "Defiance" - 2026-01-18

### Added

- Astro Public Portal Internationalization (Phase 7-10): Completed localization of all 12+ landing pages including `homes/` and `landing/` demos.
- Astro Public Portal Internationalization (Phase 7-10): Implemented `i18n.ts` utility for dynamic routing and metadata translation in Astro.
- Astro Public Portal Internationalization (Phase 7-10): Added full Indonesian (`id.json`) and English (`en.json`) translation namespaces for all portal components.
- Improved I18N Routing: Implemented intelligent middleware path rewriting to support `/id/homes/*` URLs.
- Improved I18N Routing: Enhanced locale detection to prioritize path prefixes (e.g., `/id/`).

### Changed

- Code Quality & Type Safety: Refined TypeScript definitions across `index.astro`, `blog.ts`, and `i18n.ts` to eliminate `any` types.
- Code Quality & Type Safety: Verified project build and type-safety via `astro check` and ESLint.

### Fixed

- Build Stability: Resolved "Astro.request.headers not available" warning during static site generation for blog pages.
- Build Stability: Repaired missing translation keys causing UI inconsistencies in mobile app demo pages.

## [2.17.0] "Citadel" - 2026-01-18

### Added

- Cross-Channel Multi-Language Support: Implemented English as the primary language across all AWCMS channels.
- Cross-Channel Multi-Language Support: Added Indonesian as a secondary language with full translations.
- Cross-Channel Multi-Language Support: **awcms**: Set English as `fallbackLng` in i18next config, reordered language selector.
- Cross-Channel Multi-Language Support: **awcms-public**: Created locale files (`en.json`, `id.json`) and `i18n.ts` utility for Astro.
- Cross-Channel Multi-Language Support: **awcms-public**: Added `LanguageSwitcher.astro` component with dropdown (EN/ID) in header.
- Cross-Channel Multi-Language Support: **awcms-mobile**: Added Flutter l10n with ARB files for English and Indonesian.
- Cross-Channel Multi-Language Support: **awcms-esp32**: Created language header files (`lang_en.h`, `lang_id.h`) with 40+ macros.
- Documentation: Created comprehensive `docs/dev/multi-language.md` cross-channel i18n guide.
- Documentation: Updated `docs/modules/INTERNATIONALIZATION.md` with full usage examples and channel references.

### Changed

- UI Language Defaults: `LanguageSettings.jsx`: English marked as "Default (Primary)", Indonesian as "Secondary".
- UI Language Defaults: `LanguageSelector.jsx`: English appears first in dropdown.
- UI Language Defaults: Google Translate widget `pageLanguage` updated to English.

### Fixed

- Documentation Link Check: Created `.mlc_config.json` with 31 ignore patterns for external/relative URLs.
- Documentation Link Check: Fixed `docs:check` script path in `package.json`.
- Markdown Linting: Created `.markdownlint.json` config to relax line length and disable strict table rules.
- Markdown Linting: Fixed missing code block languages in `EMAIL_INTEGRATION.md` and `VERSIONING.md`.
- Markdown Linting: Auto-fixed MD022, MD032, MD004 errors across 46 documentation files.

## [2.16.0] "Bastion" - 2026-01-17

### Changed

- ABAC Refactor: Replaced all legacy Role-Based Access Control (RBAC) references with Attribute-Based Access Control (ABAC).
- ABAC Refactor: Renamed `ExtensionRBACIntegration` to `ExtensionABACIntegration` in codebase and UI.
- ABAC Refactor: Standardized terminology across the entire repository (docs, components, guides).
- Security & RLS: Deprecated `is_admin_or_above()` in favor of granular `public.has_permission()` RLS checks.
- Security & RLS: Hardened RLS policies for `public.sso_providers` and `public.roles`.
- Documentation: Extensive audit and cleanup: Removed duplicate `permissions.md` and outdated docs.
- Documentation: Updated `DOCS_INDEX.md`, `MODULES_GUIDE.md`, and `ROLE_HIERARCHY.md` to reflect current ABAC implementation.
- Templates: Replaced legacy `awtemplate01` references with `astrowind` as the active public template.

### Fixed

- Code Quality: Resolved ESLint errors in `LanguageSettings.jsx`, `WidgetsManager.jsx`, and `Sidebar.jsx` (conditional hooks, unused vars).
- Code Quality: Cleaned up unused variables in `RichTextEditor.jsx`.
- Database: Repaired migration history and successfully synchronized schema via `supabase db push`.

## [2.15.3] - 2026-01-16

### Remediation & Enhancements

- Database Integrity (Region Module): Created `public.provinces` reference table with 38 Indonesian provinces.
- Database Integrity (Region Module): Updated `ContactsManager` to use a standardized dropdown for Province selection, ensuring consistent data.
- Resilience: Implemented `GlobalErrorBoundary` to catch and gracefully handle root-level application crashes (White Screen of Death).
- Modernization: Replaced deprecated `react-helmet` with `react-helmet-async` across the entire application for meaningful React 19 compatibility.
- Security & Verification: Verified Mobile App offline-first architecture (`Drift` + `SyncService`) and IoT credential safety.

## [2.15.2] - 2026-01-15

### Documentation

- Documentation Overhaul: Restructured and unified documentation into a root `docs/` directory.
- New Structure: Organized documentation into `architecture`, `tenancy`, `security`, `compliance`, `dev`, `deploy`, and `modules`.
- New Guides: Added `docs/dev/setup.md` (Developer Setup Guide), `docs/security/threat-model.md`, `docs/compliance/indonesia.md` (UU PDP), and ISO 27001 mapping.
- Clean Up: Removed `awcms/docs` directory and fixed all broken links.

## [2.15.1] - 2026-01-14

### Fixed

- Middleware Stability: Completely rewrote `src/middleware.ts` to resolve persistent ESLint parsing errors and ensure robust tenant resolution.
- Linting & Type Safety: Configured `eslint.config.js` to ignore `public/` directory assets.
- Linting & Type Safety: Fixed implicit `any` types and unused variables in `src/lib/supabase.ts` and `src/middleware.ts`.
- Linting & Type Safety: Added strict `App.Locals` type definitions in `src/env.d.ts` for `runtime`, `tenant_id`, and `host`.
- Database Synchronization: Repaired migration history (`20260114045306` et al.) and successfully synced local schema with remote via `npx supabase db push`.
- Cleanup: Removed unused `vitest.config.ts` and legacy imports in `src/pages/index.astro`.

## [2.15.0] "Zenith" - 2026-01-14

### Added

- Public Portal Templates: **Pongo Integration**: Fully integrated "Pongo" HTML template into `awcms-public/primary`.
- Public Portal Templates: **Asset Management**: Migrated static assets (Bootstrap, jQuery, plugins) to `public/assets`.
- Public Portal Templates: **Component Library**: Created Astro components for `Header`, `Footer`, `Hero`, and `Features` matching Pongo design.
- Public Portal Templates: **Layout Engine**: Updated `Layout.astro` to support legacy script injection (`is:inline`) for template compatibility.

## [2.14.0] "Horizon" - 2026-01-14

### Added

- Hierarchical Information Architecture: **Database Schema**: Added `parent_id`, `template_key`, `sort_order`, and `nav_visibility` to `pages` table.
- Hierarchical Information Architecture: **Admin Page Editor**: Added Parent Page selector, Navigation Visibility toggle, and Sort Order controls.
- Hierarchical Information Architecture: **Public Portal Routing**: Implemented nested slug resolution (e.g., `/profile/team`) in `[...slug].astro`.
- Template System: Migrated Pongo template to `awtemplate01` structure.
- Template System: Updated `PageLayout` to support `awtemplate01.standard` and `awtemplate01.landing` keys.
- Seeding: Added seeding migration for hierarchical pages (Home, Profile, Services, Projects, News, Contact).

### Fixed

- Public Portal Code Quality: **Linting**: Resolved 29+ `astro check` errors, fixing implicit `any` types and unused variables.
- Public Portal Code Quality: **Type Safety**: Enhanced TypeScript interfaces for `PagePublicDTO`, `MenuDTO`, and component props.
- Public Portal Code Quality: **Components**: Fixed `PageTitle`, `Header`, and `Layout` components to strictly adhere to Astro/React best practices.

## [2.13.0] "Atlas" - 2026-01-13

### Added

- Region Module Upgrades: Implemented server-side pagination, debounced search, and sorting for Administrative Regions.
- Region Module Upgrades: Refactored `RegionsManager` to use standard Admin Table component consistent with other modules.
- Region Module Upgrades: Added `Administrative` group label to Sidebar for Region module visibility.

### Fixed

- Sidebar Manager: Fixed "Core" label logic to only appear for plugins explicitly marked as `type: "core"` (e.g., Mailketing, Backup).
- Database Synchronization: Resolved `npx supabase db pull` failure by fixing a missing policy (`audit_logs_insert_unified`) in the migration history.
- Documentation Link Check: resolved linting errors in `AGENTS.md` and `CORE_STANDARDS.md`.

### Changed

- Documentation: Consolidated architecture docs (Menu System, ABAC, Core Standards).
- Documentation: Updated "Current Tech Stack" references to React 18.3.1 and Tailwind 4.
- Admin Menu System: Updated `useAdminMenu` hook to propagate `plugin_type` from manifest to UI components.

## [2.12.1] "Mailbox" - 2026-01-12

### Documentation

- Consolidated documentation structure, added monorepo docs index, and refreshed core standards and guides.
- Added Supabase integration and soft delete canonical docs.
- Updated package READMEs and removed duplicated doc content via canonical links.

## [2.12.0] "Mailbox" - 2026-01-12

### Added

- Email Logs Enhancements: Added **Tenant Name** column to Email Logs table.
- Email Logs Enhancements: Added **User** column showing who sent the email.
- Email Logs Enhancements: Added **Role** column with nested role data join.
- Email Logs Enhancements: Added **IP Address** column with client IP tracking.
- Email Logs Enhancements: Updated date format to include seconds (HH:mm:ss).
- IP Address Tracking: Mailketing Edge Function now captures client IP from request headers (`cf-connecting-ip`, `x-real-ip`, `x-forwarded-for`).
- Widget Area System: Default Sidebar widget area with WidgetAreaRenderer component.

### Fixed

- Email Settings Redirect: Fixed broken navigation by activating Mailketing plugin and removing hardcoded menu entries.
- Email Logs Select Error: Fixed Radix UI Select crash by replacing empty string value with 'all'.
- Test Email Sender: Fixed "Unknown Sender" error by fetching tenant config for verified `from_email` in `sendTestEmail`.
- Audit Logs Schema: Added `deleted_at` column for soft-delete support.
- Email Logs Schema: Added `deleted_at`, `user_id`, and `ip_address` columns.

### Security

- RLS Performance: Fixed Auth RLS Initialization Plan warning by wrapping `current_tenant_id()` and `auth.uid()` in `(select ...)`.
- Policy Consolidation: Removed duplicate INSERT policies on `audit_logs` table.

### Database Migrations

- `add_deleted_at_to_email_logs` - Soft delete support for email_logs
- `add_user_to_email_logs` - Track which user sent emails
- `add_ip_address_to_email_logs` - IP address tracking
- `fix_email_logs_user_fk` - Foreign key to public.users table
- `fix_audit_logs_rls_performance` - Optimized RLS policies

## [2.11.0] "Connect" - 2026-01-11

### Added

- Public Portal Menu Sync: Dynamic fetching of menu items from the `menus` table via `src/lib/menu.ts`.
- Content Seeding: Automated SQL-based content seeding for "primary" tenant (About, Contact, Articles sample data).
- Public Portal Routing: Implemented catch-all `[...slug].astro` to handle dynamic article routes (`/articles/slug`) and standard pages (`/about`, `/contact`).

### Changed

- Database Synchronization: Resolved `audit_logs_insert_unified` policy drift by restoring missing remote policies.
- Database Synchronization: Successfully synced local and remote schemas via `npx supabase db pull` with zero diffs.
- Dependency Management: Standardized `awcms/package.json` version to `2.11.0`.

### Fixed

- 404 Errors: Resolved "Page Not Found" issues on the public portal by ensuring proper routing and content existence.
- Migration History: Repaired conflicting migration history (`20260111120509`, `...1548`) to ensure clean deployment.

### Security

- Seed Data: Switched from Anon Key to Direct SQL execution for seeding to bypass RLS restrictions on service-level data insertion.

### Fixed

- SSO Login Activity: Log OAuth-based sign-ins to `audit_logs` so SSO login history is populated consistently.
- Extensions Registry: Added soft delete support for `extension_menu_items` and `extension_routes_registry` to prevent missing `deleted_at` errors during menu/route fetches.

## [2.10.1] "Midnight" - 2026-01-11

### Changed

- UI/UX (Dark Mode): Comprehensive overhaul of Dark Mode contrast across the admin panel.
- UI/UX (Dark Mode): Updated `index.css` semantic variables (background, foreground, border, muted) for readability.
- UI/UX (Dark Mode): Replaced hardcoded light backgrounds in `AdminPageLayout` with `bg-background` for dark-theme continuity.
- UI/UX (Dark Mode): Updated `Header.jsx`, `PageHeader.jsx`, and `ModuleHeader.jsx` to use semantic foreground text tokens.
- UI/UX (Dark Mode): Refactored `GenericResourceEditor` to use `bg-card` and semantic borders, fixing white modals in dark mode.
- UI/UX (Dark Mode): Updated `SSOManager`, `GenericContentManager`, and `ContentTable` to use semantic color tokens.
- UI/UX (Dark Mode): Added `dark:` variants to `ArticlesManager` workflow badges for contrast.

## [2.10.0] "Sentinel" - 2026-01-11

### Added

- Login Activity Logging: Enhanced audit log tracking for user logins with email, IP address, and status.
- Login Activity Logging: Captured IP address via `get-client-ip` Edge Function.
- Login Activity Logging: Added status tracking (`success`, `failed`, or error description).
- Login Activity Logging: Logged failed attempts with attempted email and error message.
- Login Activity Pagination: Added Previous/Next navigation with 20 events per page (max 1000).
- Automatic Cleanup: Database function `cleanup_old_login_audit_logs()` keeps only 100 most recent login events per tenant.
- SSO Security Tab: New "Login Activity" tab in SSO & Security page with Time, Email, Status, Channel, and IP Address columns.

### Changed

- Edge Function CORS: Updated `get-client-ip` function to allow Supabase client headers (`x-tenant-id`, `x-application-name`).
- Audit Logs RLS: Policy updated to allow login events with NULL tenant_id for pre-authentication logging.

### Fixed

- Login Activity Refresh: Fixed issue where clicking Refresh button resulted in empty table.

### Security

- Function Search Path: Fixed `cleanup_old_login_audit_logs()` with `SET search_path = ''` to resolve Supabase Security Advisor warning.
- RLS Performance: Created optimized helper functions (`get_current_user_id()`, `get_current_tenant_id()`) to resolve Auth RLS Initialization Plan warnings.
- Policy Consolidation: Consolidated multiple permissive policies on `audit_logs` to single INSERT and SELECT policies.

## [2.9.9] - 2026-01-11

### Changed

- Admin Dashboard: Increased spacing between stat cards and widget sections for the admin role to improve readability.
- Public Portal: Removed tenant slug prefixes for host-based URLs and normalized menu links to avoid `/primary` in public navigation.

### Fixed

- ABAC Soft Delete: Added `deleted_at` support and aligned RLS policies for `role_permissions`, `role_policies`, and `policies` to prevent permission matrix load errors.

## [2.9.8] - 2026-01-11

### Changed

- Public Portal: Upgraded TailwindCSS to v4 with `@tailwindcss/vite` and removed `@astrojs/tailwind`.
- Soft Delete: Enforced `deleted_at` across admin/mobile flows, added missing columns, and aligned RLS policies and permission helpers to ignore soft-deleted rows.

## [2.9.7] - 2026-01-11

### Documentation

- Refreshed stack/version references, Tailwind 4 vs 3 split, and public portal paths across core docs and project READMEs.
- Updated mobile and ESP32 documentation to match current folder layout and dependency versions.
- Corrected public portal routing/middleware behavior and Cloudflare deployment env var naming.

## [2.9.6] "Stabilization" - 2026-01-10

### Fixed

- User Approval: Resolved "Forbidden: Platform admin only" error by deploying updated `manage-users` Edge Function with improved role detection and debug parsing.
- Users Module: Confirmed internal logic for SMTP email triggers (`resetPasswordForEmail`, `inviteUserByEmail`) correctly delegates to Supabase Native SMTP.

### Security

- Edge Function: Deployed `manage-users` with correct project root to ensure role-based access control is active.

## [2.9.5] "Velocity" - 2026-01-10

### Changed

- Performance Architecture: Replaced unstable Offline Sync engine with **Local Storage Caching** layer in `UnifiedDataManager`.
- Performance Architecture: Implemented 60-second TTL cache for all read operations (`select`).
- Performance Architecture: Added table-scoped cache invalidation on writes (`insert`, `update`, `delete`).
- Performance Architecture: Enabled instant navigation between recently visited modules.
- Removed: Completely purged `wa-sqlite` dependency and `src/lib/offline` directory to resolve persistent `SQLiteError: not an error` crashes.
- Cleanup: Removed `useOfflineSync` hook and related dead code.

### Fixed

- Stability: Resolved all application crashes related to `IDBBatchAtomicVFS` and `SQLITE_MISUSE`.

## [2.9.4] - 2026-01-10

### Fixed

- Article Module Alignment: Resolved inconsistencies between Article module and Category/Tag/Media modules.
- Article Module Alignment: Added `tenant_id` filtering in `TagsManager` so tags remain tenant-scoped for non-platform admins.
- Article Module Alignment: Added tenant context filtering to `TagInput` autocomplete suggestions.
- Article Module Alignment: Aligned `ArticlesManager` category `type` filter from `'article'` to `'articles'` for `ArticleEditor` consistency.

## [2.9.3] - 2026-01-09

### Fixed

- Visual Page Builder Error: Resolved `no such table: _sync_queue` error by ensuring `SyncEngine` tables are auto-initialized before any mutations are queued.
- UserProfile: Improved error handling to catch and display user-friendly messages for `504 Gateway Timeout` and network failures during password updates.
- TenantsManager: Fixed form overflow issues on smaller screens by making the modal content scrollable.
- TenantsManager: Added "Channel Domains" configuration inputs to the *Create Tenant* form (previously only available in Edit).

## [2.9.2] "Clarity" - 2026-01-09

### Documentation

- Comprehensive Audit: Full enterprise documentation audit covering 48 docs across 4 categories.
- DEPLOYMENT.md: Fixed `awcms-public` and `awcms-mobile` root directory paths to reference `primary` subfolder.
- Docs Coverage Map: Verified alignment for multi-tenancy, ABAC, RLS, workflow engine, audit trail, and compliance.
- Standards Verification: Confirmed CORE_STANDARDS.md, ABAC_SYSTEM.md, AUDIT_TRAIL.md, docs/security/rls.md, and COMPLIANCE_MAP.md accurately reflect implementation.
- AGENTS.md: Enforced React 18.3.1 across all projects (removed React 19 references).
- README Updates: Updated all project READMEs with correct `primary` subfolder paths and React 18.3.1.
- CORE_STANDARDS.md: Added version metadata (2.9.2, React 18.3.1, last updated date).
- Link Fixes: Corrected broken relative links in `awcms-mobile`, `awcms-public`, and `awcms-esp32` READMEs.

### Fixed

- React Version: Downgraded `react` and `react-dom` in `awcms-public/primary` from 19.x to 18.3.1 for strict compliance.
- Lockfile Sync: Regenerated `package-lock.json` to resolve Cloudflare `npm ci` build failure.

### Security

- Verified all XSS sanitization patterns documented in SECURITY.md match `@/utils/sanitize` implementation.
- Confirmed RLS policies on all tenant-scoped tables enforce deny-by-default model.

## [2.9.0] "Navigator" - 2026-01-08

### Added

- RLS Policies for Menus: Added unified tenant-scoped RLS policies (select/insert/update/delete)
- Database Indexes: Added performance indexes for `tenant_id` on navigation tables
- Seed Data: Idempotent seed script for primary tenant (3 menus, 3 categories, 3 tags)
- Menu Manager Sync: Public module registry + "Sync Modules" button to add all available routes
- Menu Module Picker: Quick select dropdown for adding menu items from predefined modules
- Tenant Channels: Channel-aware domain configuration (web_admin, web_public, mobile, esp32)

### Fixed

- Tenant Isolation Bug (TagsManager): Platform admins now create tags within active tenant context
- Tenant Isolation Bug (MenusManager): Menu inserts now include `tenant_id` from TenantContext
- NOT NULL Constraints: Enforced `tenant_id NOT NULL` on categories, tags, menus, menu_permissions
- Photo Gallery Save Error: Added missing `published_at`, `reviewed_at`, `approved_at` columns
- Photo Gallery Category Select: Removed type filter that blocked category selection

### Security

- Data Cleanup Migration: Removes rows with NULL or invalid `tenant_id` (orphaned data)
- RLS Enforcement: All navigation tables now have proper tenant-scoped RLS policies
- Media Library Audit: Verified `files` table compliance (RLS, NOT NULL, ABAC) - no changes needed
- Media Role Capabilities: RLS policies now restrict INSERT/UPDATE/DELETE to manage roles (platform admin/full access, admin, editor, author); read-only for others

### Changed

- MenusManager: Added TenantContext integration for proper tenant isolation
- TagsManager: Removed conditional null tenant_id for platform admins

## [2.8.0] "Pathfinder" - 2026-01-08

### Added

- Path-Based Tenant Routing: Public Portal now uses `/{tenant}/...` URL structure
- Path-Based Tenant Routing: Added route `src/pages/[tenant]/[...slug].astro`.
- Path-Based Tenant Routing: Added tenant-aware URL builder `src/lib/url.ts`.
- Path-Based Tenant Routing: Added root redirect `/` -> `/primary/`.
- Documentation: New `docs/01-guides/MIGRATION.md` for URL structure migration

### Changed

- Public Portal Middleware: Path-first tenant resolution with host fallback
- Navbar/Footer: All links now use `tenantUrl()` helper for tenant-prefixed URLs
- URL Policy: `trailingSlash: 'always'` enforced in `astro.config.mjs`
- Documentation Updates: Updated `MULTI_TENANCY.md` with path-based resolution
- Documentation Updates: Updated `PUBLIC_PORTAL_ARCHITECTURE.md` with new routing
- Documentation Updates: Updated `AGENTS.md` to clarify React version per project
- Documentation Updates: Updated `docs/INDEX.md` with Migration Guide link

### Fixed

- TypeScript: Added `tenant_slug` to `App.Locals` interface

### Documentation

- Comprehensive documentation audit and synchronization
- Fixed React version contradictions in `AGENTS.md`
- Updated project READMEs to reflect current architecture

## [2.7.0] "Unified Admin Template" - 2026-01-05

### Added

- awadmintemplate01: New unified admin UI template with 11 core components: `AdminPageLayout`: Main wrapper with permission guard and tenant context
- awadmintemplate01: New unified admin UI template with 11 core components: `PageHeader`: Standardized breadcrumbs and ABAC-filtered action buttons
- awadmintemplate01: New unified admin UI template with 11 core components: `PageTabs`: Gradient-styled tabs with accessibility features
- awadmintemplate01: New unified admin UI template with 11 core components: `DataTable`: Auto-injection of "Nama Tenant" column for platform admins
- awadmintemplate01: New unified admin UI template with 11 core components: `FormWrapper`: Sticky submit bar with unsaved changes warning
- awadmintemplate01: New unified admin UI template with 11 core components: `EmptyState`, `LoadingSkeleton`, `NotAuthorized`: Consistent state components
- awadmintemplate01: New unified admin UI template with 11 core components: `TenantBadge`: Displays current tenant context in header
- Template Permissions: `platform.template.read/update/manage` for platform admin/full access roles only
- Documentation: New `docs/ADMIN_UI_ARCHITECTURE.md` with component reference

### Changed

- Header.jsx: Now displays `TenantBadge` for platform admins
- AdminLayout.jsx: Added footer with template version info
- ArticlesManager.jsx: Refactored to use awadmintemplate01 components
- PagesManager.jsx: Refactored to use awadmintemplate01 components
- UsersManager.jsx: Refactored to use awadmintemplate01 components
- TemplatesManager.jsx: Now requires `platform.template.manage` permission

### Security

- Template ABAC: Only platform admin/full access roles can manage admin templates
- Route Guards: All refactored managers use `AdminPageLayout` permission checks

### Fixed

- Turnstile: Fully resolved CORS (`x-tenant-id` support) and 500 errors by correcting Edge Function headers and secrets.
- AdminDashboard: Refactored to use `AdminPageLayout`, eliminated layout shifts, and fixed grid responsiveness.

### Database Migrations

- `20260105000001_add_template_permissions.sql` - Template permission seeding

## [2.6.4] - 2026-01-05

### Fixed

- Turnstile CSP: Resolved `Error 600010` by adding `unsafe-eval` to `Content-Security-Policy` header in `public/_headers` (required for Cloudflare WebAssembly).
- Turnstile Config: Temporarily hardcoded Production Site Key in Auth pages (`LoginPage`, `RegisterPage`) to resolve environment variable mismatch on Cloudflare Pages.
- Offline Module: Fixed `st: not a statement` initialization crash by removing trailing semicolons from `schema.js` SQL definitions.

## [2.6.3] - 2026-01-04

### Fixed

- Turnstile Login: Resolved "Security check failed" (Error 600010) by correcting environment variable configuration and removing hardcoded keys in `LoginPage.jsx`.

### Documentation

- Comprehensive Update: Updated `CONFIGURATION.md`, `TROUBLESHOOTING.md`, `DEPLOYMENT.md`, and `SECURITY.md` to reflect recent system changes and fixes.

## [2.6.2] - 2026-01-04

### Fixed

- Public Portal: Resolved 500 error on non-home pages (e.g., `/about`) caused by incorrect Supabase client initialization in Cloudflare runtime.
- Database Synchronization: Repaired migration history and synchronized local schema with remote database.

### Security

- Supabase Advisor: Resolved "Function Search Path Mutable" warning for `public.get_tenant_by_domain` by setting explicit `search_path`.

## [2.6.1] - 2026-01-04

### Fixed

- Public Portal: Added missing `@/lib/utils.ts` with `cn` function for class name merging.
- Public Portal: Installed `@measured/puck` dependency required by Card component.
- Card Component: Added required `render` property to `CardConfig` for Puck ComponentConfig compliance.
- Domain Alias: Fixed `get_tenant_id_by_host` RPC to properly map `tenant-public.domain.tld` to `tenant.domain.tld`.

## [2.6.0] "Clarity" - 2026-01-04

### Added

- Nama Tenant Column: Platform admin/full-access roles now see tenant names in list views across all 20 modules.
- Public Template System: New `awtemplate01` template with dedicated layout, header, footer, and components.
- Domain Aliasing: `get_tenant_id_by_host` RPC now supports `-public` domain suffix aliasing.
- RLS Pre-request Hook: Fixed `current_tenant_id()` function to read `app.current_tenant_id` for anonymous users.

### Changed

- Admin/Public Separation: Main router now redirects `/` to `/login`, removing all public routes from admin panel.
- Visibility Logic: Nama Tenant column now uses platform admin flag checks instead of tenant context checks.

### Fixed

- GenericContentManager: Column was only visible when no tenant was selected; now visible for platform admins regardless.
- Custom Modules: Added tenant query joins and display badges to TagsManager, ThemesManager, MenusManager, MediaLibrary, and WidgetsManager.
- Permission Deduplication: Removed duplicate permissions and synced full-access roles (`owner`, `super_admin`).
- Editor Initialization: Fixed blank page issues in ArticleEditor and PageEditor due to missing state hooks.
- SettingsManager: Fixed `PGRST200` error with `customSelect="*"` and soft-delete/sort column issues.

### Security

- ABAC Enforcement: All Nama Tenant displays respect existing ABAC policies - no cross-tenant data leakage.
- Tenant Isolation: RLS policies remain active; platform admins can view all tenants but isolation is enforced.

### Database Migrations

- `20260104000001_seed_awtemplate01.sql` - Template seeding
- `20260104000002_fix_tenant_lookup_rpc.sql` - Tenant lookup fix
- `20260104000003_enable_public_tenant_access.sql` - Public access policies
- `20260104000004_fix_current_tenant_id.sql` - RLS function fix
- `20260104000005_support_public_domain_alias.sql` - Domain aliasing
- `20260104000006_deduplicate_permissions.sql` - Permission cleanup

## [2.5.1] - 2026-01-04

### Changed

- CI/CD Pipeline: Updated Flutter from `3.38.3` to `3.38.5` (Dart 3.10.4).

## [2.5.0] "Catalyst" - 2026-01-04

### Changed

- CI/CD Pipeline: Upgraded Flutter from `3.27.0` to `3.38.3` (Dart 3.10.1).
- Flutter Mobile: Updated SDK constraint from `^3.6.0` to `^3.10.0`.
- Flutter Mobile Dependencies: `flutter_riverpod`: `^2.6.1` → `^3.1.0`
- Flutter Mobile Dependencies: `go_router`: `^14.6.2` → `^17.0.1`
- Flutter Mobile Dependencies: `flutter_lints`: `^5.0.0` → `^6.0.0`
- Flutter Mobile Dependencies: `drift`: `^2.22.0` → `^2.30.0`
- Flutter Mobile Dependencies: `drift_dev`: `^2.22.0` → `^2.30.0`
- Flutter Mobile Dependencies: `drift_flutter`: `^0.2.4` → `^0.2.8`

## [2.4.3] - 2026-01-04

### Fixed

- Flutter Mobile: Downgraded `flutter_lints` from `^6.0.0` to `^5.0.0` for Dart 3.6.0 compatibility.

## [2.4.2] - 2026-01-04

### Fixed

- Flutter Mobile: Corrected Dart SDK constraint (`^3.10.1` → `^3.6.0`) to match Flutter 3.27.0.
- Flutter Mobile: Fixed duplicate `_` variable names in `offline_indicator.dart` and `security_gate.dart` (Dart 3.x compatibility).
- CI/CD Pipeline: Added `CLOUDFLARE_ENABLED` variable check to skip deployment job when secrets are not configured.

## [2.4.1] - 2026-01-04

### Fixed

- CI/CD Pipeline: Fixed Flutter SDK version mismatch (`3.24.0` → `3.27.0`) to match `pubspec.yaml` requirement of `^3.10.1`.
- CI/CD Pipeline: Fixed `npm ci` failure in Public Portal by switching to `npm install` for better lock file tolerance.
- Public Portal: Regenerated `package-lock.json` to sync with `package.json` dependencies.

## [2.4.0] "Blaze" - 2026-01-04

### Added

- CORE_STANDARDS Compliance: Full audit verification of all 55 requirements across 5 pillars.
- Privileged Supabase Client: `src/lib/supabaseAdmin.js` for server-side operations that bypass RLS.
- Cloudflare Configuration: `wrangler.toml` for Cloudflare Pages/Workers deployment.
- Code Formatting: `.prettierrc` configuration for consistent code style.
- CI/CD Pipeline: `.github/workflows/ci.yml` GitHub Actions workflow for automated testing and deployment.
- Documentation: `docs/ARCHITECTURAL_RECOMMENDATIONS.md`: Architecture best practices.
- Documentation: `docs/CI_CD.md`: CI/CD pipeline documentation.

### Changed

- Dynamic CORS: `vite.config.js` now reads `VITE_CORS_ALLOWED_ORIGINS` from `.env`.
- Documentation Updates: Fixed broken links in `INDEX.md` (CHANGELOG path).
- Documentation Updates: Fixed broken links in `VERSIONING.md` (CHANGELOG references).
- Documentation Updates: Fixed `FOLDER_STRUCTURE.md` (ABAC terminology alignment, removed deprecated notice).
- Documentation Updates: Added Vitest/Prettier/Wrangler to `TECH_STACK.md`.
- Documentation Updates: Updated `TESTING.md` with Vitest implementation details.

### Security

- RLS Bypass Client: Proper implementation of service role client with security warnings.

## [2.3.1] - 2026-01-04

### Changed

- Version: Bumped to 2.3.1 (Patch) to reflect bug fixes and dev-tooling enhancements.
- Documentation: Corrected component reference consistency in `VISUAL_BUILDER.md`.

### Fixed

- Offline Architecture (CRITICAL): Implemented missing `schema.js` and `applySchema` logic in `db.js`, fixing a critical gap where local SQLite tables were not initialized.
- Testing Framework: Established comprehensive automated testing infrastructure using `vitest`, `jsdom`, and `@testing-library`, enabling verifying core system logic.
- Unit Tests: `PermissionContext.test.jsx`: Added verification for ABAC logic, ABAC fallback, and full-access policies.
- Unit Tests: `UnifiedDataManager.test.js`: Added verification for offline/online toggle and data fetching delegation.

## [2.3.0] - 2026-01-04

### Added

- Database Stability: Fully synchronized local schema with remote database using `npx supabase db pull`.
- Schema Validation: Patched migrations to enforce strict `NOT NULL` constraints on `permissions` table.
- Cleanup: Removed unused `remote_schema.sql` artifacts.

### Changed

- Version: Bumped to 2.3.0 to reflect core stability achievements.

## [2.2.0] - 2026-01-03

### Changed

- Core Architecture: Migrated to **Tailwind CSS v4** with native `@theme` configuration.
- Core Architecture: Optimized **Vite 7** build with `server.warmup` and `baseline-widely-available` target.
- Core Architecture: Implemented strict **Tenant Isolation** via comprehensive RLS policies and Database Indices.
- Module Standardization: Refactored **P0 Modules** (Content, Pages, Categories) to use standard UI/UX tokens.
- Module Standardization: Refactored **P1 Modules** (Users, Roles, Permissions) for enhanced ABAC security.
- Module Standardization: Refactored **P2 Modules** (Tenants, Settings, Themes) with modernized layouts.
- Module Standardization: Refactored **P3 Modules** (Commerce, Galleries) to align with design system.
- Security & Reliability: Added `ExtensionErrorBoundary` to prevent widget crashes affecting the core UI.
- Security & Reliability: Enhanced `SSOManager` and `PolicyManager` with strict validation.

## [2.1.0] - 2026-01-01

### Added

- ResourceSelect Component: New `src/components/dashboard/ResourceSelect.jsx` for dynamic relationship selection.
- Regions Plugin: Added `src/plugins/regions` and `src/hooks/useRegions.js` with hierarchical support.
- Ahliweb Analytics: Integrated external extension support.
- Task & Audit Documentation: Created `task.md`, `implementation_plan.md`, and `walkthrough.md`.

### Changed

- UI Standardization (Phase 2): Refactored `GenericResourceEditor` to use Shadcn UI `Select` and `Checkbox`.
- UI Standardization (Phase 2): Refactored `ArticlesManager` and `GenericContentManager` to use standard `Breadcrumb` component.
- UI Standardization (Phase 2): Replaced legacy inputs in `dashboard` with standardized Shadcn components.
- Dependency Management: Updated `useRegions.js` to use aliased imports (`@/lib/customSupabaseClient`).
- Dependency Management: Fixed duplicate menu items in `useAdminMenu.js`.
- Admin Navigation: Migrated sidebar to be Database-driven (`admin_menus` table) with `DEFAULT_MENU_CONFIG` fallback.
- Admin Navigation: Added support for Extension and Plugin menu injection.
- Multi-Tenancy: Enforced `tenant_id` on all File uploads via `useMedia` hook.
- Multi-Tenancy: Verified `TenantsManager` for platform admin use.

### Fixed

- Build Errors: Resolved missing `ResourceSelect` import in `GenericResourceEditor`.
- Build Errors: Resolved incorrect import paths in `useRegions.js`.
- Articles Module: Fixed blank page issues and routing.

## [2.0.0] "Aurora" - 2025-12-30

### Added

- Versioning System: Centralized version management with `src/lib/version.js`
- Version Badge: UI component for displaying version in admin panel
- Documentation Audit: 7 new documentation files (CONTRIBUTING, CODE_OF_CONDUCT, LICENSE, OFFLINE_ARCHITECTURE, ROLE_HIERARCHY, AUDIT_TRAIL, RLS_POLICIES)
- Role Migration: Changed `super_super_admin` to `owner` as supreme role
- RLS Fix: Global roles (platform admin/full access) now readable by all users
- Security Hardening: Added `SET search_path = ''` to SECURITY DEFINER functions

### Changed

- PERFORMANCE.md: Expanded from 682 bytes to 4.8 KB
- MONITORING.md: Expanded from 573 bytes to 4.1 KB
- INDEX.md: Added Security & Access Control section

### Fixed

- RLS policy on `roles` table blocking global role access
- Supabase Security Advisor warnings for function search_path

## [1.0.0] - 2025-12-15

### Added (1.0.0)

- Sidebar Menu Structure: Logical groups (CONTENT, MEDIA, COMMERCE, etc.)
- Dynamic Sitemap: Edge Function (`serve-sitemap`) generation
- Tenant Administration: Billing and administrative fields
- Multi-Tenant Architecture: Full tenant isolation with RLS
- ABAC System: Attribute-Based Access Control
- Visual Builder: Puck-based page builder
- Internationalization: EN and ID language support

### Changed (1.0.0)

- Menu Grouping consolidated and reorganized
- User Module tenant selector based on role
- Dashboard Platform Overview for platform admins

### Fixed (1.0.0)

- UserEditor.jsx duplicate query bug
- MainRouter.jsx typo route `/ssn`
- TenantSettings.jsx infinite spinner
- TenantSettings.jsx invisible Save button

## [0.1.0] - 2025-12-01

- Initial Beta Release.
