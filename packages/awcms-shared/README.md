# @awcms/shared

Shared utilities for AWCMS public portals.

## Purpose

`@awcms/shared` centralizes public-portal-safe helpers so multiple Astro portals can reuse the same
tenant-resolution, sanitization, and Supabase environment-resolution logic.

## Current Exports

| Export Path | Purpose |
| --- | --- |
| `@awcms/shared` | Aggregate re-export surface |
| `@awcms/shared/supabase` | Resolve public Supabase credentials and create tenant-scoped clients |
| `@awcms/shared/sanitize` | Shared sanitize allowlists/options for public rendering |
| `@awcms/shared/tenant` | Build-time tenant ID resolution helpers |
| `@awcms/shared/types` | Shared TypeScript types used by public portals |

## Usage

```ts
import { createClientFromEnv, getTenantId, SANITIZE_BASE_OPTIONS } from '@awcms/shared';
```

## Environment Resolution

`resolveSupabaseCredentials()` currently resolves public credentials in this order:

1. `PUBLIC_SUPABASE_URL`
2. `VITE_SUPABASE_URL`
3. `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
4. `VITE_SUPABASE_PUBLISHABLE_KEY`

`getTenantId()` resolves tenant identity in this order:

1. explicit override argument
2. `PUBLIC_TENANT_ID`
3. `VITE_PUBLIC_TENANT_ID`
4. `VITE_TENANT_ID`

Use publishable keys only. Never inject `SUPABASE_SECRET_KEY` into public portal builds or this package.

## Package Notes

- This package is source-first TypeScript with a dedicated `npm run typecheck` validation script.
- CI now runs the package directly in addition to consumer validation from `awcms-public/primary` and `awcms-public/smandapbun`.
- It is intended for public-portal/shared-runtime code, not admin-only or server-secret flows.
- Worker compatibility calls from `@awcms/shared/supabase` resolve against `PUBLIC_EDGE_URL` / `VITE_EDGE_URL`; missing Worker URLs should be treated as configuration errors rather than reasons to fall back to Supabase Edge Functions.

## References

- `../../docs/dev/public.md`
- `../../docs/tenancy/supabase.md`
- `../../SYSTEM_MODEL.md`
