# Runtime Boundaries

> Documentation Authority: `SYSTEM_MODEL.md` -> `AGENTS.md` -> `README.md` -> `DOCS_INDEX.md`

## Purpose

Define the hard runtime boundaries for AWCMS across storage, edge logic, admin scope, and tenant scope.

## Canonical Runtime Rules

- Cloudflare Workers in `awcms-edge/` are the only maintained function runtime.
- Cloudflare R2 is the only maintained object storage runtime.
- Cloudflare Queues (producer + consumer bound to `awcms-edge/`) are the maintained async offload layer for background processing. See [queue-topology.md](./queue-topology.md).
- Supabase is limited to Auth, Postgres, RLS, ABAC, and SQL/database functions.
- Supabase Storage is disabled in maintained clients.
- Supabase-hosted Edge Functions are not part of the supported runtime.

## Compute Boundary

| Concern | Approved Runtime | Disallowed Runtime |
| --- | --- | --- |
| Public/server HTTP workflows | Cloudflare Workers | Supabase Edge Functions |
| Privileged orchestration | Cloudflare Workers + `SUPABASE_SECRET_KEY` | Browser clients |
| Tenant/public compatibility routes | Cloudflare Worker compatibility routes (`/functions/v1/*`) | Supabase-hosted function URLs |
| Async background processing | Cloudflare Queues (producer + consumer in `awcms-edge/`) | Custom Node.js servers, Supabase Edge Functions |

## Storage Boundary

| Concern | Approved Runtime | Disallowed Runtime |
| --- | --- | --- |
| File/object storage | Cloudflare R2 | Supabase Storage |
| Public media delivery | Cloudflare Edge API + R2 object keys | Direct storage-bucket client access |
| Protected media access | Cloudflare Edge API session-bound URLs | Client-side privileged bucket access |

## Scope Boundary

### Platform Scope

- Platform scope controls the entire AWCMS system.
- Platform users can inspect or override tenant scope safely through the admin tenant switcher.
- `cms@ahliweb.com` is the enforced `owner` role at `platform` scope with full access.

### Tenant Scope

- Tenant scope applies to all tenant resources and UI views.
- Tenant RLS is driven by `public.current_tenant_id()`.
- Platform override is allowed only for platform admins and only through approved runtime paths.

## Implementation Guarantees

- `awcms/src/lib/customSupabaseClient.js` proxies compatibility function calls to `VITE_EDGE_URL` and blocks `supabase.storage` access.
- `packages/awcms-shared/src/supabase.ts` applies the same Worker proxy/storage guard behavior for public/shared clients.
- `awcms-edge/src/index.ts` is the maintained Worker gateway.
- `public.current_tenant_id()` honors platform-admin tenant override safely while preserving tenant isolation.

## Validation Commands

```bash
cd awcms && npm run test:e2e -- platform-tenant-switcher.spec.js
cd awcms && npm run test:e2e -- platform-diagnostics.spec.js
cd awcms && npm test -- --run src/lib/customSupabaseClient.test.js
cd packages/awcms-shared && npm run test:storage-guard
cd awcms-edge && npm run test:compat-routes
```

## References

- `docs/dev/edge-functions.md`
- `docs/dev/api-usage.md`
- `docs/architecture/queue-topology.md`
- `docs/architecture/deployment-cells/schema.md`
- `docs/modules/ROLE_HIERARCHY.md`
