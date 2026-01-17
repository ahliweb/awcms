# Supabase Integration

## Purpose

Define how AWCMS integrates with Supabase for auth, data, storage, and edge functions.

## Audience

- Admin and public portal developers
- Platform operators configuring Supabase

## Prerequisites

- Supabase project with RLS enabled
- `supabase` CLI installed for migrations

## Core Concepts

- Supabase is the only backend (no custom servers).
- RLS is mandatory for all tenant-scoped tables.
- Tenant context is passed via `x-tenant-id` header and resolved in SQL with `current_tenant_id()`.

## How It Works

### Admin Panel Client

- `awcms/src/lib/customSupabaseClient.js` injects `x-tenant-id` for every request.
- `awcms/src/contexts/TenantContext.jsx` resolves tenant by domain and calls `setGlobalTenantId()`.

### Public Portal Client

- `awcms-public/primary/src/middleware.ts` resolves tenant and writes `locals.tenant_id`.
- `awcms-public/primary/src/lib/supabase.ts` builds a request-scoped client with `x-tenant-id`.

### Edge Functions

- Stored in `supabase/functions/*`.
- Use `supabaseAdmin` (service role) for cross-tenant operations and elevated workflows.
- Must enforce tenant context checks before mutating data.

## Implementation Patterns

### Admin Client Usage

```javascript
import { supabase } from '@/lib/customSupabaseClient';

const { data, error } = await supabase
  .from('articles')
  .select('*')
  .eq('status', 'published')
  .is('deleted_at', null);
```

### Public Portal Client Usage

```ts
import { createScopedClient } from '../lib/supabase';

const supabase = createScopedClient({ 'x-tenant-id': tenantId }, runtimeEnv);
```

### Edge Function Invocation

```javascript
const { data, error } = await supabase.functions.invoke('manage-users', {
  body: { action: 'delete', user_id: targetId }
});
```

## Security and Compliance Notes

- Never expose the service role key in client code.
- Every request must be scoped to the tenant and filtered for `deleted_at`.
- All public reads must use `status = 'published'` where applicable.

## Operational Concerns

### Environment Variables (Admin)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SUPER_ADMIN_EMAIL` (optional override)
- `VITE_TURNSTILE_SITE_KEY` (if Turnstile enabled)
- `VITE_DEV_TENANT_SLUG` (local development)

### Environment Variables (Public)

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEV_TENANT_HOST` (local development)

### Migrations

Run from repo root:

```bash
supabase db push
```

Supabase CLI configuration lives in `supabase/config.toml`.

### Repo Layout Note

This repository currently contains both `supabase/` (root) and `awcms/supabase/`. CI uses `awcms/supabase` for linting, while the Supabase CLI defaults to the root `supabase/` directory. Keep migrations aligned across both paths if both are in use.

## Troubleshooting

- Missing tenant data: verify `x-tenant-id` header and `current_tenant_id()`.
- Auth errors: confirm Supabase URL and anon key are set.

## References

- `../02-reference/API_DOCUMENTATION.md`
- `../02-reference/RLS_POLICIES.md`
- `docs/tenancy/overview.md`
