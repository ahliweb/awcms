# Multi-Tenancy Architecture

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

## Purpose

Define the current multi-tenancy model for AWCMS across admin, public, Worker, database, and hierarchy/resource-sharing surfaces.

This guide is a current-state architectural overview, not just a tenant-id primer.

## Current Tenancy Model

AWCMS currently uses logical isolation on a shared data model with layered enforcement.

Current tenancy behavior depends on:

- tenant-scoped tables with mandatory `tenant_id`
- RLS enforcement in PostgreSQL
- SQL tenant resolution through `current_tenant_id()`
- explicit tenant-aware query patterns in admin/public/Worker code
- controlled platform-admin scope override behavior
- optional hierarchy-aware resource-sharing rules for selected resources

## Current Scope Layers

### Platform Scope

- platform roles can operate across the system through approved platform paths
- platform-wide visibility does not imply arbitrary client-side cross-tenant querying
- platform-admin tenant override is an explicit feature, not a reason to remove tenant scoping from app code

### Tenant Scope

- tenant scope applies to most business data and tenant-managed behavior
- tenant-scoped tables should explicitly preserve tenant filtering in query code even when RLS is active

### Public Scope

- public scope is still tenant-aware where applicable
- static public builds resolve tenant at build time
- public Worker compatibility routes may resolve tenant by tenant id or domain depending on the route contract

## Current Admin Tenancy Model

The admin app no longer uses a simplistic single-value tenant model.

Current admin behavior includes:

- hostname-based tenant resolution through `TenantContext`
- a richer resolved tenant object
- `currentTenant` vs `resolvedTenant` distinction
- platform tenant-scope override behavior for platform users
- tenant propagation through the global Supabase client header contract

Admin changes should account for the active scoped tenant, not just a guessed global tenant id.

## Current Public Tenancy Model

### Static-First Public Builds

Canonical public builds resolve tenant at build time using:

- `PUBLIC_TENANT_ID`
- `VITE_PUBLIC_TENANT_ID`
- `VITE_TENANT_ID`

Static builds should fail closed when tenant identity is missing for a tenant-specific build.

### Public Worker-Mediated Tenancy

Some public-compatible Worker routes now support guarded tenant resolution using:

- `tenantId`
- `tenant_id`
- `domain`

When tenant and domain are both supplied, they must resolve to the same tenant.

## Current Data-Layer Tenancy Model

### SQL Resolution

`current_tenant_id()` is the current SQL-side tenant resolver.

It matters for:

- authenticated user flows
- request-scoped/public flows that use approved tenant context propagation
- RLS enforcement on tenant-scoped tables

### Hierarchy And Resource Sharing

AWCMS still supports hierarchy-aware tenancy and selective resource sharing.

Current concepts include:

- `parent_tenant_id`
- hierarchy depth limits
- `is_tenant_descendant(...)`
- `tenant_can_access_resource(...)`
- `tenant_resource_rules` and related registry/rule tables for shared-vs-isolated behavior

Not all resources are shared equally.

## Current Shared Vs Isolated Resource Model

Directionally, current behavior remains:

- shared/configurable-by-rule resources: selected settings/branding/module-style surfaces
- isolated-by-default resources: users, content, media, commerce, and other core tenant-owned business data

Do not generalize one resource-sharing rule across unrelated table groups without checking the current migrations and runtime behavior.

## Current Tenant Onboarding Model

Tenant onboarding remains a privileged flow.

Current expectations include:

- privileged caller auth and permission check
- uniqueness checks for slug/domain
- hierarchy-aware `create_tenant_with_defaults(...)` usage
- initial role/bootstrap seeding
- audit logging
- idempotent error handling around duplicate or partial-failure states

Treat onboarding as a platform-managed operational flow, not a generic browser-side insert pattern.

## Current Media And Storage Tenancy Rules

- media metadata remains tenant-owned in Postgres
- storage keys remain tenant-prefixed
- public media is served through guarded Worker routes
- protected/session-bound media is not part of the public object namespace
- admin media library behavior is now tenant-scoped even for platform users unless they intentionally switch tenant scope

## Current Query Rules

When writing tenant-aware code, current best practice remains:

- explicitly filter by tenant where the surface is tenant-scoped
- explicitly filter `deleted_at IS NULL` for normal reads
- explicitly filter public reads to published state where relevant
- do not assume Worker/admin/public code can loosen query scope because RLS exists

## Security Notes

- RLS is mandatory
- client-side RLS bypass is forbidden
- privileged cross-tenant work belongs only in approved server-side paths using `SUPABASE_SECRET_KEY`
- public route tenant/domain guardrails are part of the tenancy model now, not just edge-route implementation detail

## Validation Guidance

| Surface | Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| Worker/public tenancy contract changes | `cd awcms-edge && npm test && npm run typecheck` |
| migration/tenant-rule changes | `scripts/verify_supabase_migration_consistency.sh` plus relevant migration validation |

## Related Docs

- [docs/tenancy/supabase.md](./supabase.md)
- [docs/security/rls.md](../security/rls.md)
- [docs/security/abac.md](../security/abac.md)
- [docs/dev/admin.md](../dev/admin.md)
- [docs/dev/public.md](../dev/public.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
