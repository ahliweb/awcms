# Multi-Tenancy Architecture

## Purpose

Define how tenant isolation is resolved and enforced across AWCMS.

## Audience

- Developers implementing tenant-aware features
- Operators configuring tenant domains

## Prerequisites

- `docs/architecture/standards.md`
- `docs/security/rls.md`

## Core Concepts

- AWCMS uses logical isolation on a shared database.
- Tenant context is mandatory for all reads and writes.
- RLS enforces isolation at the database layer.

## How It Works

### Admin Panel (React)

- Tenant context is resolved by domain in `awcms/src/contexts/TenantContext.jsx`.
- Resolution calls RPC `get_tenant_by_domain` and sets `setGlobalTenantId()`.
- Local development uses `VITE_DEV_TENANT_SLUG` to force a tenant.
- `usePermissions()` exposes `tenantId` for permission-scoped operations.

### Public Portal (Astro)

- Middleware resolves tenant in `awcms-public/primary/src/middleware.ts`.
- Priority order:
  1. Path slug (`/{tenant}/...`) via `get_tenant_by_slug`.
  2. Host header fallback via `get_tenant_id_by_host`.
- Host-resolved tenants are served at root paths without redirects.

### Data Layer (Supabase)

- `x-tenant-id` is injected into requests by the admin client and public middleware.
- SQL functions read `app.current_tenant_id` via `current_tenant_id()`.

## Implementation Patterns

### Admin Tenant Context

```javascript
import { useTenant } from '@/contexts/TenantContext';

const { currentTenant } = useTenant();
```

### Public Tenant Context

```ts
const supabase = createScopedClient({ 'x-tenant-id': tenantId }, runtimeEnv);
```

### Tenant-Scoped Queries

```javascript
const { data } = await supabase
  .from('pages')
  .select('*')
  .eq('tenant_id', tenantId)
  .is('deleted_at', null);
```

## Security and Compliance Notes

- Every tenant-scoped table must include `tenant_id` and `deleted_at`.
- All queries must include tenant filters even when RLS is enabled.
- Platform admin features are the only exception to cross-tenant access.

## Operational Concerns

- Tenant domains are configured in the `tenants` table (host/subdomain fields).
- New tenant creation must seed default roles, templates, and menus via SQL or RPC.

## Troubleshooting

- 404 on public portal: confirm middleware tenant resolution and host config.
- Missing data in admin: verify `setGlobalTenantId()` and Supabase headers.

## References

- `docs/tenancy/supabase.md`
- `docs/security/rls.md`
- `docs/security/abac.md`
