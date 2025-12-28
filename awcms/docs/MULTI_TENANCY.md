# Multi-Tenancy Architecture

## Overview

AWCMS uses a **Logical Isolation** model on a **Shared Database**. This allows for high scalability while maintaining strict data separation.

## 1. Tenant Resolution

### Admin Panel

* **Context**: Users log in to a unified dashboard (`/cmspanel`).
* **Resolution**: `tenant_id` is derived from the User's Profile (`users.tenant_id`) upon login.
* **Switching**: Platform Admins can "Assume Identity" of a tenant using the Tenant Switcher.

### Public Portal

* **Context**: Visitors access `tenant.com` or `tenant.awcms.com`.
* **Resolution**:
    1. **Middleware**: `src/middleware.ts` intercepts the Request.
    2. **Lookup**: Queries `get_tenant_id_by_host(host)` RPC function.
    3. **Context**: Sets `Astro.locals.tenant_id`.

## 2. Row Level Security (RLS)

Every query to the database is filtered by RLS policies.

### The Golden Rule
>
> **"Every table must have a `tenant_id` column and RLS enabled."**

### Policy Logic

```sql
-- Standard Policy
CREATE POLICY "Tenant Isolation" ON table_name
USING (tenant_id = (select auth.uid() ->> 'tenant_id')::uuid);
```

## 3. Shared vs Isolated Resources

| Resource | Scope | Description |
| -------- | ----- | ----------- |
| **Users** | Isolated | Users belong to ONE tenant (except Super Admin). |
| **Media** | Isolated | Storage buckets structured as `/{tenant_id}/{file.ext}`. |
| **Settings** | Hybrid | `system_settings` (Global) vs `tenant_configs` (Tenant). |
| **Extensions** | Shared | Installed globally, enabled per-tenant. |

## 4. Onboarding Flow

1. **Registration**: New Tenant creation triggers `create_tenant` RPC.
2. **Seeding**: `create_tenant_with_defaults` seeds initial Roles, Pages, and Menus.
3. **DNS**: Tenant configures CNAME to Cloudflare.
4. **Verification**: Admin updates `tenants.host` column.
