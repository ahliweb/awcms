# Supabase Integration

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1.3 - Backend & Database  
> **Context7 Reference**: `supabase/supabase-js` - See [AGENTS.md](../../AGENTS.md) for detailed patterns

## Purpose

Define how AWCMS integrates with Supabase for auth, data, storage, and edge functions.

## Audience

- Admin and public portal developers
- Platform operators configuring Supabase

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - Backend architecture and constraints
- [AGENTS.md](../../AGENTS.md) - Supabase JS patterns and Context7 references
- Supabase project with RLS enabled
- Supabase CLI v2.70+ (install globally or use `npx supabase`)

## Core Concepts

- Supabase is the only backend (no custom servers).
- RLS is mandatory for all tenant-scoped tables.
- Tenant context is passed via `x-tenant-id` header and resolved in SQL with `current_tenant_id()`.
- Tenant hierarchy and resource sharing are enforced with `tenant_can_access_resource()`.

## How It Works

### Admin Panel Client

- `awcms/src/lib/customSupabaseClient.js` injects `x-tenant-id` for every request.
- `awcms/src/contexts/TenantContext.jsx` resolves tenant by domain and calls `setGlobalTenantId()`.

**Context7 guidance**: initialize clients with PKCE auth flow and global headers.

```javascript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    flowType: "pkce",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: "supabase-auth-token",
  },
  db: {
    schema: "public",
  },
  global: {
    headers: {
      "x-application-name": "awcms",
    },
    // fetch: customFetchImplementation,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
```

### Public Portal Client

- Static builds resolve tenant via `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID`).
- `awcms-public/primary/src/lib/supabase.ts` builds clients from `import.meta.env`; headers are set when scoped access is required.
- Analytics logging uses `analytics_events` only when middleware is enabled in SSR/runtime deployments.

### Edge Functions

- Stored in `supabase/functions/*`.
- Use `supabaseAdmin` (`SUPABASE_SECRET_KEY`) for cross-tenant operations and elevated workflows.
- Must enforce tenant context checks and resource sharing rules before mutating data.

## Implementation Patterns

### Admin Client Usage

```javascript
import { supabase } from '@/lib/customSupabaseClient';

const { data, error } = await supabase
  .from('blogs')
  .select('*')
  .eq('status', 'published')
  .is('deleted_at', null);
```

### Public Portal Client Usage

```ts
import { createClientFromEnv } from "../lib/supabase";

const supabase = createClientFromEnv(import.meta.env, { "x-tenant-id": tenantId });
```

### Edge Function Invocation

```javascript
const { data, error } = await supabase.functions.invoke('manage-users', {
  body: { action: 'delete', user_id: targetId }
});
```

## Security and Compliance Notes

- Never expose `SUPABASE_SECRET_KEY` in client code.
- Every request must be scoped to the tenant and filtered for `deleted_at`.
- All public reads must use `status = 'published'` where applicable.

## Operational Concerns

### Environment Variables (Admin)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_TURNSTILE_SITE_KEY` (if Turnstile enabled)
- `VITE_DEV_TENANT_SLUG` (local development)
- Ensure the dev slug exists (seed with `node awcms/src/scripts/seed-primary-tenant.js` when using localhost).

### Environment Variables (Public)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_PUBLISHABLE_KEY` (CI/build fallback)
- `PUBLIC_TENANT_ID` (static builds)
- `VITE_PUBLIC_TENANT_ID` or `VITE_TENANT_ID` (fallbacks)

### Migrations

Run from repo root.

Local-first workflow:

```bash
npx supabase migration list --local
npx supabase db push --local
```

Linked/remote workflow:

```bash
npx supabase migration list --linked
npx supabase db push --linked
```

Linked schema sync snapshot (when needed):

```bash
npx supabase db pull --schema public,extensions
```

> **Note**: We explicitly pull only the `public` and `extensions` schemas to avoid permission errors with the managed `storage` and `auth` schemas.

If migration history is mismatched:

```bash
scripts/repair_supabase_migration_history.sh
scripts/repair_supabase_migration_history.sh --apply --local
scripts/repair_supabase_migration_history.sh --apply --linked
scripts/verify_supabase_migration_consistency.sh
scripts/verify_supabase_migration_consistency.sh --linked
```

Keep non-migration SQL in `supabase/manual/` and keep `supabase/migrations/` timestamp-only.

Supabase CLI configuration lives in `supabase/config.toml`.

### Repo Layout Note

This repository currently contains both `supabase/` (root) and `awcms/supabase/`. CI uses `awcms/supabase` for linting, while the Supabase CLI defaults to the root `supabase/` directory. Keep migrations aligned across both paths if both are in use.

## Troubleshooting

- Missing tenant data: verify `x-tenant-id` header and `current_tenant_id()`.
- Auth errors: confirm Supabase URL and publishable key are set.

## References

- `docs/dev/api-usage.md`
- `docs/security/rls.md`
- `docs/tenancy/overview.md`
