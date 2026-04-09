> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

# API Usage

## Purpose

Document the current API usage model for AWCMS across admin, public, and Worker-mediated flows.

This guide is not an external product API reference. It is a development guide for how checked-in AWCMS clients should currently access:

- Supabase Auth and PostgreSQL
- Worker-backed compatibility routes
- Cloudflare R2-backed media flows
- tenant-aware public and admin HTTP integrations

## Current State

### Current Access Model

AWCMS uses a split access model:

- Supabase JS clients are used for direct Auth and PostgreSQL access within approved client/runtime boundaries.
- Cloudflare Workers in `awcms-edge/` are used for privileged orchestration, compatibility routes, R2-backed media flows, integrations, and guarded edge-side behavior.
- Supabase remains authoritative for Auth, PostgreSQL data, RLS, and ABAC.
- Cloudflare R2 is the maintained object storage layer.
- Supabase Storage is disabled in maintained clients.

### Current Client Surfaces

- Admin client code uses `awcms/src/lib/customSupabaseClient.js`.
- Public client code uses the public Supabase helpers in the relevant public workspace.
- Worker compatibility calls should resolve against `VITE_EDGE_URL` / `PUBLIC_EDGE_URL`.
- Supabase-hosted Edge Function URLs are not the maintained runtime contract.

## Admin Client Usage

### Current Initialization Pattern

Use the checked-in admin client:

```javascript
import { supabase } from '@/lib/customSupabaseClient';
```

Current admin client behavior includes:

- PKCE/session persistence behavior through Supabase JS
- automatic `x-application-name` header
- automatic `x-tenant-id` header injection when a global tenant is set
- `supabase.storage` guard behavior that blocks legacy Supabase Storage usage
- `functions.invoke(...)` proxying to Cloudflare Worker compatibility routes

### Current Implications

- Admin code should not treat `supabase.functions.invoke(...)` as a direct Supabase-hosted Edge Function call.
- Admin code should not use `supabase.storage`.
- Tenant-aware admin requests depend on the current global tenant state set by `TenantContext`.

## Public Client Usage

### Current Initialization Pattern

Public workspaces should use their current env-driven Supabase helpers rather than copying admin-client assumptions.

Typical pattern:

```ts
import { createClientFromEnv } from '../lib/supabase';

const supabase = createClientFromEnv(import.meta.env);
```

For runtime-only or request-scoped Worker-mediated cases, use the checked-in scoped helper pattern in the target public workspace.

### Current Public Rules

- Public client code must not use secret-key paths.
- Public reads must remain tenant-scoped where relevant.
- Public reads must remain published-only and non-deleted.
- Public media access should go through the maintained public media route contract, not ad hoc storage access.

## Authentication Usage

Typical auth usage remains standard Supabase auth flows:

```javascript
const { data, error } = await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'securepassword',
});
```

Current guidance:

- Use checked-in auth context/providers instead of inventing parallel auth state.
- Resolve authenticated user identity from Supabase session/user APIs where ownership matters.
- Do not trust caller-provided `author_id`, `owner_id`, or equivalent identity fields.

## PostgreSQL Data Access

### Current Query Shape

Typical direct data access still follows the normal Supabase query style:

```javascript
const { data, error } = await supabase
  .from('blogs')
  .select('*, author:users(id, full_name)')
  .eq('status', 'published')
  .is('deleted_at', null)
  .order('created_at', { ascending: false });
```

### Current Rules

- Keep tenant filters explicit where the surface is tenant-scoped.
- Keep `deleted_at IS NULL` explicit for normal reads.
- Keep published-only filters explicit for public reads.
- Treat RLS as the final authority, but do not rely on RLS as an excuse for sloppy client-side query scope.

## Soft Delete Usage

Business-data deletion should remain soft-delete based:

```javascript
const { error } = await supabase
  .from('blogs')
  .update({ deleted_at: new Date().toISOString() })
  .eq('id', blogId);
```

Avoid documenting or implementing hard-delete flows for ordinary business lifecycle paths unless the feature is explicitly a permanent-delete surface.

## Worker-Backed Media Usage

### Current Media Model

Media uploads and delivery are Worker/R2 based.

Typical upload initiation path:

```javascript
const edgeUrl = import.meta.env.VITE_EDGE_URL || import.meta.env.VITE_LOCAL_EDGE_URL;

const response = await fetch(`${edgeUrl}/api/media/upload`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${session.access_token}`,
  },
  body: formData,
});

const data = await response.json();
```

### Current Media Rules

- Use Cloudflare R2-backed Worker routes for media flows.
- Do not use Supabase Storage.
- Public media URLs should respect the canonical public media contract.
- Protected or session-bound media should not be described as public object access.

## Worker-Backed Integration Usage

### Current Edge Invocation Pattern

For guarded edge-side integrations:

```javascript
const { data: { session } } = await supabase.auth.getSession();
const edgeUrl = import.meta.env.VITE_EDGE_URL || import.meta.env.VITE_LOCAL_EDGE_URL;

const response = await fetch(`${edgeUrl}/api/mailketing`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    'x-tenant-id': tenantId,
  },
  body: JSON.stringify({ action: 'send', recipient: 'user@example.com' }),
});

const data = await response.json();
```

### Current Mailketing Rules

- `send` is not a public anonymous action.
- `send` requires bearer auth.
- `send` requires tenant context that matches the authenticated user’s tenant scope.
- Notification send/manage permission boundaries still apply.
- Other compatibility actions may have different trust boundaries; check the current route contract before expanding usage examples.

## Public Worker Route Usage

Some current public-compatible routes now support tenant/domain-based resolution.

Current guardrails include:

- public tenant-aware routes may accept `tenantId`, `tenant_id`, or `domain`, depending on the route
- when both tenant and domain inputs are supplied, they must resolve to the same tenant
- mismatch is an explicit request failure, not an implementation detail
- `/public/media/*` only accepts canonical public keys under `tenants/<tenant_id>/...`
- malformed keys and `tenants/<tenant_id>/protected/...` are invalid public requests

If you are writing examples for those routes, document the current guardrails instead of implying looser behavior.

## Security And Compliance Notes

- Always filter `deleted_at IS NULL` for normal reads.
- Tenant-scoped tables must preserve explicit tenant filtering in client/worker code where applicable.
- Secret keys may be used only in Cloudflare Workers, migrations, and trusted operational scripts.
- Admin client injects `x-tenant-id` automatically through the current custom client setup.
- Protected Worker routes acting on tenant-scoped resources must receive tenant context that matches the authenticated user’s scope.
- Public Worker routes that accept tenant context must document and enforce the current tenant/domain contract.
- Public media URLs must preserve the canonical tenant-prefixed storage key shape.
- Supabase Storage remains disabled in maintained clients.
- Local development should prefer the local Worker URL when the tested flow depends on `wrangler dev` routes.

## Validation Guidance

Use the most relevant command for the changed API surface.

| Surface | Validation |
| --- | --- |
| admin API client usage docs | `cd awcms && npm run build` when app code changed |
| public API usage docs | `cd awcms-public/primary && npm run check:astro` when public code changed |
| Worker route docs/examples | `cd awcms-edge && npm test` and `npm run typecheck` |
| maintained docs | `cd awcms && npm run docs:check` |
| route catalog/OpenAPI examples | `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff` |

## Related Docs

- [docs/tenancy/supabase.md](../tenancy/supabase.md)
- [docs/security/rls.md](../security/rls.md)
- [docs/architecture/database.md](../architecture/database.md)
- [docs/dev/edge-functions.md](edge-functions.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/architecture/edge-openapi-spec.md](../architecture/edge-openapi-spec.md)
