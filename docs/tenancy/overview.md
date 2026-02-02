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
- Tenants can be nested up to 5 levels using `parent_tenant_id` and `hierarchy_path`.
- Resource sharing is configurable per tenant via `tenant_resource_rules`.

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
- Middleware also sets visitor tracking cookies and logs analytics events (scoped to the resolved tenant).

#### Smandapbun Variant

- `awcms-public/smandapbun` is a single-tenant portal with shared middleware for analytics and consent.
- Tenant resolution falls back to a fixed slug in `src/lib/api.ts` when host/path lookups fail.
- See `docs/tenancy/smandapbun.md` for tenant-specific behavior and migration status.

### Data Layer (Supabase)

- `x-tenant-id` is injected into requests by the admin client and public middleware.
- SQL functions read `app.current_tenant_id` via `current_tenant_id()`.
- Hierarchy functions (`is_tenant_descendant`, `tenant_can_access_resource`) enforce shared vs isolated resources.
- Public aggregates (e.g., `analytics_daily`) are readable only when scoped to the tenant id.

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

### Hierarchy & Sharing Defaults

- **Shared by default**: `settings` and `branding` (descendants). Tenant admins and full-access roles have read/write access across levels.
- **Isolated by default**: `content`, `media`, and `users` resources.
- Rules are stored in `tenant_resource_registry` and `tenant_resource_rules`.

## Security and Compliance Notes

- Every tenant-scoped table must include `tenant_id` and `deleted_at`.
- All queries must include tenant filters even when RLS is enabled.
- Cross-tenant access is allowed only for resources marked as shared.
- Platform admin and full-access roles can access all tenants, including cross-tenant reporting.

## Operational Concerns

- Tenant domains are configured in the `tenants` table (host/subdomain fields).
- New tenant creation seeds default roles, staff hierarchy, and resource rules via SQL/RPC.

## Troubleshooting

- 404 on public portal: confirm middleware tenant resolution and host config.
- Missing data in admin: verify `setGlobalTenantId()` and Supabase headers.

## References

- `docs/tenancy/supabase.md`
- `docs/security/rls.md`
- `docs/security/abac.md`
