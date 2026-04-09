> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# Database Schema

## Purpose

Describe the current database architecture for AWCMS at a practical level: what the schema is responsible for, how tenancy and authorization shape it, how migrations are maintained, and how readers should treat this document versus the migration history.

This document is an architectural guide, not a substitute for the executable migration baseline.

## Current State

### Current Database Role

AWCMS uses PostgreSQL via Supabase as the authoritative data plane for:

- tenant-scoped business data
- identity and role state
- ABAC permission state
- RLS enforcement
- audit/configuration metadata
- media metadata and ownership state
- extension and import metadata

### What This Document Is And Is Not

- This document describes current schema structure and important table families.
- The canonical executable truth remains the migration history in:
  - `supabase/migrations/`
  - `awcms/supabase/migrations/`
- Before depending on exact columns, constraints, or policy shapes, verify the latest migrations.

## Current Schema Principles

### Tenancy

- every tenant-scoped table should have `tenant_id`
- RLS should be enabled
- query code should still keep tenant filters explicit where applicable

### Lifecycle

- business-data tables should use soft delete where the lifecycle applies
- normal reads should filter `deleted_at IS NULL`

### Authorization

- canonical permission keys live in `permissions`
- role-to-permission assignment lives in `role_permissions`
- RLS policy authoring should use current recursion-safe/ABAC-aware patterns

### Storage Split

- object/file bytes live in Cloudflare R2
- database rows track metadata, ownership, authorization state, and upload/session lifecycle

## Current Major Table Families

### 1. Control Plane And Deployment-Tenancy Metadata

Examples include tables such as:

- `platform_projects`
- `deployment_cells`
- `tenants_control`
- `tenant_domains`
- `tenant_service_contracts`
- `tenant_migrations`

These support higher-level deployment-cell and tenancy orchestration concerns.

### 2. Core Tenant Application Tables

Examples include:

- `tenants`
- `modules`
- tenant settings/branding/configuration families

These represent the main application tenancy model consumed by admin, public, and Worker code.

### 3. Identity / Roles / Permissions

Examples include:

- `users`
- `roles`
- `permissions`
- `role_permissions`
- `role_policies`
- `user_profiles`
- `user_profile_admin`

This family underpins current Auth-adjacent tenant membership, ABAC, and encrypted admin-only profile state.

### 4. Content Tables

Examples include:

- `blogs`
- `pages`
- `events`
- `content_translations`
- portfolio/partner/service/team/testimony/funfact-style content families

These remain tenant-scoped, soft-delete aware, and generally workflow/publish-state aware where the feature requires it.

### 5. Taxonomy And Navigation

Examples include:

- `categories`
- `tags`
- join tables such as `blog_tags` and `page_tags`
- `menus`
- `admin_menus`

Important current note:

- `admin_menus` is not a trivial globally tenantless table; current admin menu behavior is scope-aware and interacts with runtime normalization logic.

### 6. Templates, Widgets, And Visual Composition

Examples include:

- `templates`
- `template_parts`
- `template_assignments`
- `widgets`
- `template_strings`

These support current admin and public composition flows and remain tenant-aware.

### 7. Media And Upload Lifecycle

Examples include:

- `media_objects`
- `media_upload_sessions`

Important current note:

- the database stores metadata and authorization state, not the object bytes themselves
- maintained media delivery uses Worker + R2, not Supabase Storage

### 8. Extension Platform Tables

Examples include:

- `platform_extension_catalog`
- `tenant_extensions`
- extension audit/lifecycle tables
- extension routing/metadata tables where present

These support the current extension ownership split between platform catalog and tenant activation/configuration.

### 9. Import / EmDash Tables

Examples include:

- `tenant_import_jobs`
- `tenant_import_sources`
- `tenant_import_mappings`
- `tenant_import_artifacts`
- `tenant_import_audit`

These are now part of a live import/materialization surface, not merely speculative schema.

### 10. Notification And Queue-Adjacent Tables

Examples include:

- `tenant_notification_channels`
- `notification_templates`
- `notification_dispatches`
- `queue_dead_letters`

These support current notification configuration, dispatch auditing, and DLQ/replay workflows.

## Current Architectural Rules

### Migration Authority

- root `supabase/migrations/` is the canonical source
- `awcms/supabase/migrations/` must remain mirrored in parity
- matching counts alone are not sufficient; filenames and content must align

### Safe Schema Change Rules

- prefer additive changes where possible
- do not document destructive shortcuts as normal workflow
- keep non-migration SQL out of migration folders
- use timestamped migration files only

### Foreign Key Guidance

- prefer lifecycle-safe FK behavior for core business entities
- use cascading deletes only where the association is intentionally disposable and documented

## How To Read This Schema Safely

When working from this document:

1. identify the relevant table family
2. inspect the current migration definitions for exact shape
3. check RLS and ABAC implications
4. check whether related Worker/public/admin docs also need updating

## Current Validation Guidance

| Surface | Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| migration parity | `scripts/verify_supabase_migration_consistency.sh` |
| Worker/runtime behavior tied to schema docs | `cd awcms-edge && npm test && npm run typecheck` when relevant |

## Related Docs

- [docs/tenancy/overview.md](../tenancy/overview.md)
- [docs/tenancy/supabase.md](../tenancy/supabase.md)
- [docs/security/rls.md](../security/rls.md)
- [docs/security/abac.md](../security/abac.md)
- [docs/architecture/runtime-boundaries.md](./runtime-boundaries.md)
