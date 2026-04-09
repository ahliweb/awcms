# Security Guide

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

## Purpose

Describe the current AWCMS security posture, enforcement layers, trust boundaries, and implementation expectations across admin, public, Worker, database, and storage surfaces.

This is a current-state security overview. It should help readers understand where the real controls live today and which lower-level docs define the details.

## Current Security Model

AWCMS currently relies on layered security, not a single enforcement mechanism.

The active security model combines:

- Supabase Auth for identity/session authority
- PostgreSQL RLS for tenant isolation
- ABAC permission checks for action-level authorization
- Cloudflare Workers for approved server-side orchestration and guarded compatibility routes
- Cloudflare R2 for maintained object storage
- signed route params for protected admin detail/edit routes
- sanitization rules for admin and public rich-content rendering
- soft-delete lifecycle rules for business data

## Current Enforcement Layers

### 1. Client Layer

- UI permission checks through `usePermissions()`
- tenant context via `useTenant()` or current public build-time tenant resolution
- input validation and safe rendering conventions
- signed route param usage for protected admin edit/detail flows

### 2. Edge Layer

- Cloudflare Workers validate auth, tenant context, and request shape for protected compatibility routes
- Worker-side checks are additive guardrails, not the final authority
- public Worker routes now have explicit tenant/domain/media guardrails

### 3. Database Layer

- RLS is mandatory
- tenant-scoped tables resolve against `current_tenant_id()`
- ABAC checks use canonical permission keys and helper functions such as `has_permission(...)`
- recursion-safe helpers are required where policies would otherwise recurse through `public.users`

### 4. Storage Layer

- Cloudflare R2 is the maintained object layer
- public media is served through the Worker-mediated public media contract
- protected/session-bound media is not publicly addressable through arbitrary object paths

## Current High-Level Controls

### Access Control

- AWCMS is ABAC-first, not role-name-first
- permission keys must use `scope.resource.action`
- platform/full-access roles may bypass some UI checks, but database authority still matters
- new features should not be documented or implemented with placeholder permission families

### Tenant Isolation

- tenant isolation is mandatory in admin, public, Worker, and database surfaces
- tenant context may come from admin tenant scope, build-time public tenant config, or guarded Worker route resolution depending on the surface
- cross-tenant behavior must be explicit and auditable

### Data Lifecycle

- business-data deletion remains soft delete by default
- normal reads must keep `deleted_at IS NULL`
- public reads must also stay published-only where relevant

### Content Sanitization

- admin raw HTML fallback rendering uses the admin sanitization path
- public raw HTML fallback rendering uses the public sanitization path
- rich content import/rendering paths must not bypass current sanitization rules before HTML injection

## Current Public Security Guardrails

Public surfaces now have clearer runtime guardrails than older docs implied.

### Public Tenant Guardrails

- public tenant-aware Worker routes may accept `tenantId`, `tenant_id`, or `domain`, depending on the route
- when tenant and domain inputs are both supplied, they must resolve to the same tenant
- mismatch is an explicit failure mode (`400 Tenant/domain mismatch`)

### Public Media Guardrails

- `/public/media/*` only accepts canonical public keys shaped like `tenants/<tenant_id>/...`
- malformed keys and traversal-like segments are rejected
- `tenants/<tenant_id>/protected/...` is never a valid public media path

### Public Data Guardrails

- public reads must remain tenant-scoped where applicable
- public reads must remain published-only and non-deleted
- public/client code must not use secret-key paths

## Current OWASP-Oriented Mapping

| Risk Area | Current AWCMS Control |
| --- | --- |
| Broken access control | ABAC + RLS + protected routes + Worker guardrails |
| Cryptographic failures | managed auth/session primitives, encrypted admin-only profile fields, secret-key server-side restriction |
| Injection / XSS | sanitization paths for admin/public fallback HTML, safe editor/rendering patterns |
| Insecure design | layered runtime boundaries and tenant isolation model |
| Misconfiguration | explicit runtime boundaries, storage guards, env-key rules |
| Vulnerable components | workspace dependency management and validation workflows |
| Auth/session failures | Supabase Auth, session-aware Worker validation, 2FA surfaces where enabled |
| Software/data integrity | migration discipline, OpenAPI/runtime alignment, audit trails |
| Logging failures | audit logs, queue dead-letter capture, dispatch logs |
| SSRF / unsafe server fetch | no custom Node.js backend proxy layer as maintained runtime |

## Current Sensitive Areas To Review Carefully

High-risk change categories in the current repo include:

- RLS helper or policy changes
- new permission families
- new Worker routes or public compatibility route changes
- media/public delivery changes
- route-security/signed-id changes
- import/materialization paths
- HTML rendering or sanitization changes
- any server-side use of `SUPABASE_SECRET_KEY`

## Current Implementation References

Useful current implementation anchors:

- `awcms/src/contexts/PermissionContext.jsx`
- `awcms/src/contexts/TenantContext.jsx`
- `awcms/src/lib/customSupabaseClient.js`
- `awcms-edge/src/index.ts`
- `awcms-edge/src/lib/openapi/route-catalog.ts`
- `awcms-public/primary/src/lib/content.ts`
- `awcms-public/primary/src/utils/sanitize.ts`

## Operational Security Notes

- never commit real `.env*` secrets
- keep `SUPABASE_SECRET_KEY` server-side only
- keep migrations timestamped and mirrored when required
- keep docs/spec artifacts aligned when documented trust boundaries change
- treat analytics/IP/geo-style event fields as personal data subject to retention policy and consent requirements

## Validation Guidance

Use the most relevant command for the touched security surface.

| Surface | Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| Worker/runtime security changes | `cd awcms-edge && npm test && npm run typecheck` |
| route catalog/OpenAPI trust-boundary updates | `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff` |
| migration/RLS changes | `scripts/verify_supabase_migration_consistency.sh` plus relevant migration validation |

## Related Docs

- [docs/security/rls.md](./rls.md)
- [docs/security/abac.md](./abac.md)
- [docs/tenancy/overview.md](../tenancy/overview.md)
- [docs/tenancy/supabase.md](../tenancy/supabase.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/architecture/database.md](../architecture/database.md)
