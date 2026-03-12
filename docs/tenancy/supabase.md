# Supabase Integration

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 1.3 - Backend & Database  
> **Context7 Reference**: `supabase/supabase-js` - See [AGENTS.md](../../AGENTS.md) for detailed patterns

## Purpose

Define how AWCMS integrates with Supabase for auth, PostgreSQL data, RLS, and ABAC while Cloudflare handles edge gateway and object storage responsibilities.

## Audience

- Admin and public portal developers
- Platform operators configuring Supabase

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - Backend architecture and constraints
- [AGENTS.md](../../AGENTS.md) - Supabase JS patterns and Context7 references
- Supabase project with RLS enabled
- Supabase CLI v2.70+ (install globally or use `npx supabase`)

## Core Concepts

- Supabase is the system of record for Auth, PostgreSQL data, RLS, and ABAC.
- Cloudflare Workers provide the primary edge HTTP layer for maintained client applications.
- Cloudflare R2 is the canonical object storage layer for maintained file/media flows.
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
- `awcms-public/primary/src/lib/supabase.ts` and `awcms-public/smandapbun/src/lib/supabase.ts` both build on `@awcms/shared/supabase`; headers are set when scoped access is required.
- Canonical static deployments do not depend on middleware-based analytics logging.

### Edge Logic

- Primary edge HTTP handlers live in `awcms-edge/` (Cloudflare Workers).
- Use `SUPABASE_SECRET_KEY` only in approved server-side runtimes for cross-tenant operations and elevated workflows.
- Must enforce tenant context checks and resource sharing rules before mutating data.

### Storage

- Maintained file and media delivery flows should use Cloudflare R2 through `awcms-edge/`.
- Supabase should not be used as the primary file storage surface for maintained client applications.
- File metadata, tenant ownership, and authorization checks remain anchored in Supabase tables and policies.

### Tenant Provisioning RPC Signatures

`create_tenant_with_defaults` is currently authored as the hierarchy-aware 6-argument function:

- 6-argument signature: `(p_name, p_slug, p_domain, p_tier, p_parent_tenant_id, p_role_inheritance_mode)`

Older compatibility overloads still appear in historical migration snapshots, but current seed migrations and onboarding flows should call the 6-argument hierarchy-aware signature only.

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

### Worker Invocation (Gateway Compatibility)

```javascript
const { data, error } = await supabase.functions.invoke('manage-users', {
  body: { action: 'delete', user_id: targetId }
});
```

In maintained clients, `supabase.functions.invoke(...)` is a compatibility bridge that proxies to the Cloudflare Worker API configured by `VITE_EDGE_URL` / `PUBLIC_EDGE_URL`.

## Security and Compliance Notes

- Never expose `SUPABASE_SECRET_KEY` in client code.
- Every request must be scoped to the tenant and filtered for `deleted_at`.
- All public reads must use `status = 'published'` where applicable.
- Prefer Cloudflare Workers for new edge HTTP endpoints.

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

#### Canonical dual-root policy

- `supabase/migrations/` is the canonical authoring source.
- `awcms/supabase/migrations/` is a required mirror used by CI linting.
- Every migration change must be mirrored with identical filename and content.
- As of the 2026-03-12 planning refresh, both roots contain `131` migration files; use parity verification because matching counts alone do not guarantee filename/content alignment.
- Validate parity before merge:

```bash
scripts/verify_supabase_migration_consistency.sh
```

If you need linked-project history validation too:

```bash
scripts/verify_supabase_migration_consistency.sh --linked
```

#### Local-first workflow

```bash
npx supabase migration list --local
npx supabase db push --local
```

#### Linked/remote workflow

```bash
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
```

#### Linked schema sync snapshot (when needed)

```bash
npx supabase db pull --schema public,extensions
```

> **Note**: We explicitly pull only the `public` and `extensions` schemas to avoid permission errors with the managed `storage` and `auth` schemas.

#### If migration history is mismatched

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

This repository contains both `supabase/` (root) and `awcms/supabase/`. CI currently lints from `awcms/supabase`, while local Supabase CLI commands default to root `supabase/`. Follow the canonical dual-root policy above to keep both paths aligned.

## Troubleshooting

- Missing tenant data: verify `x-tenant-id` header and `current_tenant_id()`.
- Auth errors: confirm Supabase URL and publishable key are set.

## References

- `docs/dev/api-usage.md`
- `docs/security/rls.md`
- `docs/tenancy/overview.md`
