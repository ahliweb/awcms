# AWCMS Core Standards

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

## Purpose

Define the current non-negotiable implementation standards for AWCMS across admin, public, edge, database, storage, and documentation surfaces.

This document is the practical standards summary for the checked-in repo. It is not a replacement for the authority docs above it.

## Current Core Standards

### 1. Runtime Ownership

- `awcms/` is the maintained admin app.
- `awcms-public/*` are the maintained public portals.
- `awcms-edge/` is the only maintained server-side HTTP runtime.
- Supabase is authoritative for Auth, PostgreSQL, RLS, and ABAC.
- Cloudflare R2 is the maintained object storage layer.
- Cloudflare Queues are the maintained async offload layer.
- Custom Node.js application servers are not part of the maintained runtime.

### 2. Tenancy And Isolation

- tenant isolation is mandatory across admin, public, Worker, and database surfaces
- tenant-scoped tables must use `tenant_id`
- tenant-aware queries should preserve explicit tenant filtering where applicable
- platform-wide behavior must remain explicit and auditable
- public route tenant/domain guardrails are part of the current runtime contract

### 3. Authorization And Security

- ABAC is the maintained authorization model
- permission keys must use `scope.resource.action`
- UI permission checks are additive UX guardrails only
- RLS remains the final authority for tenant isolation and authorization
- recursion-safe helper patterns matter for new RLS authoring
- soft delete is the default business-data lifecycle

### 4. Storage And Media

- maintained media flows use Worker + R2
- Supabase Storage is disabled in maintained clients
- public media delivery must respect canonical public storage-key rules
- protected/session-bound media must not be described as public object access

### 5. UI And Routing

- admin code in `awcms/` stays JavaScript ES2022+
- public portal code stays TypeScript/TSX
- admin edit/detail routes should use signed route params where the current routing model requires them
- themeable UI should use semantic variables rather than hardcoded hex values
- public rendering must remain published-only and non-deleted

### 6. Docs And Contract Alignment

- documented Worker route changes should usually update:
  - route implementation
  - route catalog/OpenAPI metadata
  - generated OpenAPI artifacts
  - edge/runtime docs
- cross-cutting doc changes should be reflected in the documentation audit tracker
- docs should describe runtime reality, not aspirational behavior

## Current Standards By Surface

### Admin

- React 19.2.4 + Vite `^8.0.5`
- JavaScript ES2022+
- `useTenant()` and `usePermissions()` are current foundational contexts
- scope-aware menu behavior should follow `useAdminMenu()`

### Public

- Astro 6.0.8 + React 19.2.4 islands
- static-first output for canonical public builds
- build-time tenant resolution is the normal path
- public Worker compatibility routes must preserve current tenant/domain/media guardrails

### Edge

- Cloudflare Workers + Hono
- protected routes validate auth early
- request shape validation happens before writes or sensitive reads
- public routes must fail closed on missing/mismatched tenant context where applicable
- documented route changes must keep OpenAPI/docs aligned

### Database

- migrations remain the canonical executable truth
- root and mirrored migration trees must stay in parity
- new policy authoring should follow current ABAC-first and recursion-safe patterns

## Current Validation Expectations

Use the most relevant validation for the changed surface.

| Surface | Typical Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| admin | `cd awcms && npm run build` |
| public primary | `cd awcms-public/primary && npm run check:astro` |
| edge | `cd awcms-edge && npm test && npm run typecheck` |
| documented edge route metadata | `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff` |
| migration parity | `scripts/verify_supabase_migration_consistency.sh` |

## Related Docs

- [docs/security/overview.md](../security/overview.md)
- [docs/tenancy/overview.md](../tenancy/overview.md)
- [docs/architecture/runtime-boundaries.md](./runtime-boundaries.md)
- [docs/dev/edge-functions.md](../dev/edge-functions.md)
- [docs/dev/prompt-guide.md](../dev/prompt-guide.md)
