# Supabase Integration

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) -> [AGENTS.md](../../AGENTS.md) -> [README.md](../../README.md) -> [DOCS_INDEX.md](../../DOCS_INDEX.md)
>
> **Status:** Maintained
>
> **Last Refreshed:** 2026-04-09

## Purpose

Define the current Supabase integration model for AWCMS: what Supabase owns, how tenant context is resolved, how client and Worker code interact with it, how migrations are maintained, and where Supabase stops and Cloudflare begins.

This is a current-state guide for the checked-in repo, not a generic Supabase tutorial.

## Current State

### What Supabase Owns

Supabase remains the system of record for:

- Auth
- PostgreSQL data
- tenant isolation
- RLS enforcement
- ABAC permission enforcement
- SQL/database functions and helper procedures

### What Supabase Does Not Own

In the maintained AWCMS runtime, Supabase does not own:

- the primary server-side HTTP runtime
- object/file storage delivery for maintained media flows
- the maintained edge/API orchestration layer

Those responsibilities currently belong to Cloudflare Workers and Cloudflare R2.

## Current Integration Model

### Admin Client

The admin app uses `awcms/src/lib/customSupabaseClient.js`.

Current behavior includes:

- publishable-key client auth
- automatic `x-tenant-id` header injection when tenant scope is set
- `x-application-name` header injection
- Worker proxy behavior for `functions.invoke(...)`
- explicit blocking of `supabase.storage`

### Public Clients

Public portals use env-driven Supabase client helpers in their own workspaces.

Current public expectations:

- tenant resolution is static-first for canonical public builds
- public reads remain published-only and non-deleted
- public code does not use secret-key paths
- public compatibility routes may resolve tenant context through the Worker layer when needed

### Worker Runtime

Cloudflare Workers in `awcms-edge/` are the maintained HTTP gateway that may use Supabase in two different modes:

- publishable-key caller-context client for auth/session-preserving checks
- secret-key admin client for approved privileged operations

Worker-side checks are additive guardrails. Supabase remains the final authority for Auth, RLS, and ABAC.

## Tenant Context Model

### Current Tenant Resolution

Tenant context is not just a static string passed around arbitrarily.

Current repo behavior includes:

- admin-side tenant resolution through `TenantContext`
- public static tenant resolution through build-time envs
- request-scoped/public compatibility flows using `x-tenant-id` or route/domain-mediated Worker resolution where appropriate
- SQL-side resolution through `public.current_tenant_id()`

### Current `x-tenant-id` Role

The `x-tenant-id` header still matters, but it should be understood in context:

- admin client code uses it as part of the current scoped tenant contract
- public/request-scoped flows may rely on it when the route/client helper is designed for that pattern
- Worker public routes now also support domain-mediated tenant resolution on certain documented surfaces
- raw tenant input should not be treated as implicitly trusted just because a header exists

## Current Supabase Patterns

### Admin Client Usage

```javascript
import { supabase } from '@/lib/customSupabaseClient';

const { data, error } = await supabase
  .from('blogs')
  .select('*')
  .eq('status', 'published')
  .is('deleted_at', null);
```

### Public Client Usage

```ts
import { createClientFromEnv } from '../lib/supabase';

const supabase = createClientFromEnv(import.meta.env, { 'x-tenant-id': tenantId });
```

### Worker Invocation Usage

```javascript
const { data, error } = await supabase.functions.invoke('manage-users', {
  body: { action: 'delete', user_id: targetId },
});
```

Current meaning of that example:

- in maintained clients, `functions.invoke(...)` is a compatibility bridge to the Worker runtime
- it is not a recommendation to build against Supabase-hosted Edge Function URLs

## Storage Model

### Current Rule

Maintained file/media flows use Cloudflare R2 through `awcms-edge/`.

Supabase should not be used as the maintained file-storage surface for current AWCMS features.

### What Supabase Still Stores For Media

Supabase/Postgres still owns:

- media metadata
- tenant ownership
- authorization state
- upload/session bookkeeping

The Worker/runtime layer handles:

- object storage interaction
- public/protected delivery behavior
- signed/session-bound access
- post-upload orchestration

## Notification And Integration Data

Current notification infrastructure lives in Supabase tables for configuration and audit state, while Worker/queue paths perform operational send/dispatch behavior.

Important current split:

- tenants manage channel/template configuration through RLS-backed tables
- dispatch outcomes are recorded through the Worker/queue path
- permission names should be verified against the live migration-backed baseline before documenting new examples

## Tenant Provisioning And Hierarchy Notes

Current onboarding and hierarchy-sensitive flows should use the current canonical signatures and helper functions present in migrations and runtime code, not historical overload assumptions.

Do not document older compatibility signatures as the recommended path when current flows already use the hierarchy-aware variant.

## Current Migration Policy

### Dual-Root Policy

- `supabase/migrations/` is the canonical root migration path
- `awcms/supabase/migrations/` is the required mirrored path
- every migration change must keep both trees in parity
- identical filenames and content matter; matching counts alone are not enough

### Current Validation

```bash
scripts/verify_supabase_migration_consistency.sh
scripts/verify_supabase_migration_consistency.sh --linked
```

### Current CLI Guidance

Local-first flow:

```bash
npx supabase migration list --local
npx supabase db push --local
```

Linked/remote flow:

```bash
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

Linked schema snapshot when needed:

```bash
npx supabase db pull --schema public,extensions
```

Keep non-migration SQL in `supabase/manual/`.

## Security And Compliance Notes

- Never expose `SUPABASE_SECRET_KEY` in client code.
- Keep tenant filtering explicit where the surface is tenant-scoped.
- Keep `deleted_at IS NULL` explicit for normal reads.
- Keep public reads published-only where applicable.
- Prefer Cloudflare Workers for new server-side HTTP endpoints.
- Do not document Supabase Storage as an approved maintained media surface.

## Environment Variables

### Admin

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_DEV_TENANT_SLUG`
- Turnstile-related public/admin envs when those surfaces are enabled

### Public

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_TENANT_ID`
- `VITE_PUBLIC_TENANT_ID`
- `VITE_TENANT_ID`

### Worker / Server-Side

- `SUPABASE_SECRET_KEY`
- the current Worker env set required by the route/integration in question

## Validation Guidance

Use the most relevant command for the changed surface.

| Surface | Validation |
| --- | --- |
| maintained docs | `cd awcms && npm run docs:check` |
| Worker/runtime/Supabase trust-boundary changes | `cd awcms-edge && npm test && npm run typecheck` |
| migration parity | `scripts/verify_supabase_migration_consistency.sh` |
| route catalog/OpenAPI examples | `cd awcms-edge && npm run openapi:build && npm run openapi:validate && npm run openapi:diff` |

## Related Docs

- [docs/dev/api-usage.md](../dev/api-usage.md)
- [docs/security/rls.md](../security/rls.md)
- [docs/tenancy/overview.md](./overview.md)
- [docs/architecture/runtime-boundaries.md](../architecture/runtime-boundaries.md)
- [docs/architecture/database.md](../architecture/database.md)
