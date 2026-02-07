# Multi-Tenancy Architecture

> **Documentation Authority**: [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) Section 2.1 - Multi-Tenancy & Isolation

## Purpose

Define how tenant isolation is resolved and enforced across AWCMS.

## Audience

- Developers implementing tenant-aware features
- Operators configuring tenant domains

## Prerequisites

- [SYSTEM_MODEL.md](../../SYSTEM_MODEL.md) - **Primary authority** for multi-tenancy architecture
- [AGENTS.md](../../AGENTS.md) - Tenant context patterns and RLS guidelines
- [docs/architecture/standards.md](../architecture/standards.md) - Core implementation standards
- [docs/security/rls.md](../security/rls.md) - Row Level Security policies

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

- Static builds resolve tenant at build time using `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID`).
- Tenant-specific routes are generated with `getStaticPaths` when needed.
- Middleware-based resolution is reserved for SSR/runtime deployments.

#### Smandapbun Variant

- `awcms-public/smandapbun` is a single-tenant static portal.
- Tenant resolution is fixed at build time in `src/lib/api.ts`.
- See `docs/tenancy/smandapbun.md` for tenant-specific behavior and migration status.

### Data Layer (Supabase)

- `x-tenant-id` is injected into requests by the admin client and scoped public clients when needed.
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
const supabase = createClientFromEnv(import.meta.env, { 'x-tenant-id': tenantId });
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

- **Shared by default**: `settings`, `branding`, `modules` (descendants). Tenant admins and full-access roles have read/write access across levels based on `tenant_resource_rules`.
- **Isolated by default**: `content` (blogs, pages), `media` (storage objects), `users`, and `orders`. These resources are strictly scoped to a single `tenant_id`.
- **Rules Storage**: Configured in `tenant_resource_registry` and enforced via `tenant_resource_rules`.

## Security and Compliance Notes

### Row Level Security (RLS)
- **Strict Enforcement**: RLS is mandatory for all tables.
- **Bypass Prohibition**: Client-side code must NEVER bypass RLS. Elevation to Service Role is restricted to specific Edge Functions.

### Data Lifecycle (Soft Delete)
- **Mechanism**: All tenant-scoped tables must use the "Soft Delete" pattern.
- **Schema Requirement**: Tables must include a `deleted_at` (TIMESTAMPTZ, nullable) column.
- **Operations**:
  - **Delete**: Implemented as `UPDATE table SET deleted_at = NOW() ...`.
  - **Read**: Queries must explicitly filter `.is('deleted_at', null)`.
- **Foreign Keys**: Must use `ON DELETE RESTRICT` or `SET NULL`. `ON DELETE CASCADE` is forbidden for business data to preserve audit trails.

### Query Requirements
- **Tenant Filter**: All queries must include `.eq('tenant_id', tenantId)` even if RLS is enabled, to ensure query planner optimization and leak prevention.
- **Cross-Tenant Access**: Allowed only for resources marked as shared in the registry.

## Operational Concerns


- Tenant domains are configured in the `tenants` table (host/subdomain fields).
- New tenant creation seeds default roles, staff hierarchy, and resource rules via SQL/RPC.

## Troubleshooting

- 404 on public portal: confirm `PUBLIC_TENANT_ID` and build-time `getStaticPaths` output.
- Missing data in admin: verify `setGlobalTenantId()` and Supabase headers.

## References

- `docs/tenancy/supabase.md`
- `docs/security/rls.md`
- `docs/security/abac.md`
