# Runtime Boundaries

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

## Purpose

Define the current hard runtime boundaries for AWCMS across compute, storage, tenant scope, privileged orchestration, public compatibility routes, and generated API documentation surfaces.

This document is meant to answer a practical question:

> Where is a given responsibility allowed to live right now in the checked-in repo?

## Current Canonical Runtime Rules

- Cloudflare Workers in `awcms-edge/` are the only maintained function runtime.
- Cloudflare R2 is the only maintained object storage runtime.
- Cloudflare Queues bound to `awcms-edge/` are the maintained async offload layer.
- Supabase is limited to Auth, PostgreSQL, RLS, ABAC, and SQL/database functions.
- Supabase Storage is disabled in maintained clients.
- Supabase-hosted Edge Functions are not part of the supported runtime.
- Custom Node.js application servers are not part of the supported runtime.

## Compute Boundary

| Concern | Approved Runtime | Disallowed Runtime |
| --- | --- | --- |
| Public/server HTTP workflows | Cloudflare Workers | Supabase-hosted Edge Functions |
| Privileged orchestration | Cloudflare Workers + `SUPABASE_SECRET_KEY` | Browser clients |
| Tenant/public compatibility routes | Cloudflare Worker compatibility routes (`/functions/v1/*`) | Supabase-hosted function URLs |
| Async background processing | Cloudflare Queues in `awcms-edge/` | Custom Node.js servers, Supabase-hosted Edge Functions |
| Public route documentation surfaces | OpenAPI artifacts generated from `awcms-edge/src/lib/openapi/route-catalog.ts` | Hand-maintained speculative API docs detached from runtime |

## Storage Boundary

| Concern | Approved Runtime | Disallowed Runtime |
| --- | --- | --- |
| File/object storage | Cloudflare R2 | Supabase Storage |
| Public media delivery | Cloudflare Edge API + canonical R2 object keys | Direct bucket-style client storage access |
| Protected media access | Cloudflare Edge API + session/permission-aware flows | Client-side privileged bucket access |

Additional current guarantees:

- local `wrangler dev` R2 state is isolated from remote R2 by default
- reconciliation between local and remote media surfaces must use the maintained `sync:r2:*` commands
- public media delivery is intentionally narrower than arbitrary object lookup and follows the public media route contract

## Scope Boundary

### Platform Scope

- Platform scope controls the overall AWCMS system.
- Platform users may inspect or override tenant scope only through approved admin/runtime paths.
- Platform-wide visibility does not imply arbitrary client-side cross-tenant querying.

### Tenant Scope

- Tenant scope applies to tenant resources and tenant-facing admin/public behavior.
- Tenant RLS is driven by `public.current_tenant_id()`.
- Platform override is allowed only for approved platform-admin flows.

### Public Scope

- Public scope is not a free-form anonymous data surface.
- Public behavior must remain explicitly tenant-scoped when applicable.
- Public route contracts may resolve tenant identity from tenant ids or domains depending on the route, but they must fail closed on missing or mismatched context.

## Client Boundary

### Admin Client

- `awcms/src/lib/customSupabaseClient.js` is the maintained admin client entry point.
- It injects the current tenant header, blocks `supabase.storage`, and proxies compatibility function calls to the Worker runtime.

### Public / Shared Clients

- Public/shared client helpers should follow the workspace-specific env-driven setup.
- `packages/awcms-shared/src/supabase.ts` preserves the same Worker proxy/storage-guard contract for shared/public consumers.

### What Clients Must Not Do

- call Supabase-hosted Edge Function URLs as if they were the maintained backend runtime
- use secret-key paths from browser code
- treat Supabase Storage as available
- bypass tenant/public route guardrails with looser custom fetches

## Public Compatibility Boundary

Current public compatibility/runtime surfaces include both Astro-side public rendering and Worker-mediated public routes.

Important current public route guarantees:

- public tenant-aware Worker routes may accept `tenantId`, `tenant_id`, or `domain`, depending on the route contract
- when both tenant and domain values are supplied, they must resolve to the same tenant
- mismatch is an explicit `400` request failure
- `/public/media/*` only accepts canonical public keys under `tenants/<tenant_id>/...`
- `/public/media/*` rejects malformed keys, traversal-like segments, and the reserved protected namespace

These are runtime-boundary rules, not merely documentation conventions.

## Documentation / OpenAPI Boundary

The edge/runtime docs surface is also boundary-sensitive.

Current rules:

- public/admin/internal OpenAPI artifacts are generated from the route catalog
- internal artifacts may exist as generated files without being exposed at runtime
- public/admin specs must not imply looser trust boundaries than the runtime actually allows
- route descriptions should document canonical public guardrails when runtime behavior depends on tenant/domain resolution or canonical storage-key shape

## Implementation Guarantees

- `awcms/src/lib/customSupabaseClient.js` proxies compatibility function calls to `VITE_EDGE_URL` and blocks `supabase.storage` access.
- `packages/awcms-shared/src/supabase.ts` applies the same Worker proxy/storage-guard behavior for shared/public clients.
- `awcms-edge/src/index.ts` is the maintained Worker gateway.
- `public.current_tenant_id()` preserves approved tenant isolation behavior and platform override support.
- Worker-backed public/shared compatibility calls resolve against `VITE_EDGE_URL` / `PUBLIC_EDGE_URL`, not Supabase-hosted function endpoints.
- public media, public modules, public events, and sitemap compatibility routes now have explicit tenant/domain guardrails.

## Validation Guidance

Use the most relevant commands when boundary-related code or docs change.

```bash
cd awcms && npm run docs:check
cd awcms-edge && npm test
cd awcms-edge && npm run typecheck
cd awcms-edge && npm run openapi:build
cd awcms-edge && npm run openapi:validate
cd awcms-edge && npm run openapi:diff
```

Additional workspace-specific tests may still be required depending on which surface changed.

## Related Docs

- [docs/dev/edge-functions.md](../dev/edge-functions.md)
- [docs/dev/api-usage.md](../dev/api-usage.md)
- [docs/architecture/queue-topology.md](./queue-topology.md)
- [docs/architecture/edge-openapi-spec.md](./edge-openapi-spec.md)
- [docs/dev/openapi-quality-checklist.md](../dev/openapi-quality-checklist.md)
- [docs/modules/ROLE_HIERARCHY.md](../modules/ROLE_HIERARCHY.md)
