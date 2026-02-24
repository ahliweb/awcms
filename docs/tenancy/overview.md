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

- Static builds resolve tenant at build time using `PUBLIC_TENANT_ID` (or `VITE_PUBLIC_TENANT_ID` / `VITE_TENANT_ID`).
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
- Build-time public tenant fallback order is implemented in `awcms-public/primary/src/lib/publicTenant.ts`.

## Implementation Details

### Tenant Onboarding & Provisioning Process

Creating a new tenant requires precise coordination between the database definition, initial content, and staff roles. AWCMS orchestrates this provisioning securely via the backend Edge Function invoking a specialized RPC method: `create_tenant_with_defaults()`.

**Step 1: Admin Creates Tenant**  
The platform admin (or trusted automation) invokes `create_tenant_with_defaults()` via a privileged backend path. For local development, the seed script demonstrates this flow:

```ts
const { data, error } = await supabase.rpc('create_tenant_with_defaults', {
  p_name: 'Dinkes Jatim',
  p_slug: 'dinkes',
  p_domain: null,
  p_tier: 'pro',
  p_parent_tenant_id: null,
  p_role_inheritance_mode: 'auto'
});
```

Reference implementation: `awcms/src/scripts/seed-primary-tenant.js`.

**Step 2: Database Provisioning via `create_tenant_with_defaults()`**  
The Edge Function securely calls the Postgres RPC function below (running with `SECURITY DEFINER` privileges), which guarantees consistent initialization and isolation:

```sql
CREATE OR REPLACE FUNCTION "public"."create_tenant_with_defaults"("p_name" text, "p_slug" text, "p_domain" text DEFAULT NULL, "p_tier" text DEFAULT 'free', "p_parent_tenant_id" uuid DEFAULT NULL, "p_role_inheritance_mode" text DEFAULT 'auto') RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
    v_tenant_id uuid;
BEGIN
    -- 1. Insert Base Tenant
    INSERT INTO public.tenants (
      name, slug, domain, subscription_tier, status, parent_tenant_id, role_inheritance_mode
    ) VALUES (p_name, p_slug, p_domain, p_tier, 'active', p_parent_tenant_id, p_role_inheritance_mode)
    RETURNING id INTO v_tenant_id;

    -- 2. Seed Core Tenant Roles
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_tenant_admin)
    VALUES ('admin', 'Tenant Administrator', v_tenant_id, true, 'tenant', true);
    
    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('editor', 'Content Editor', v_tenant_id, true, 'tenant');

    INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
    VALUES ('author', 'Content Author', v_tenant_id, true, 'tenant');

    -- 3. Seed Inheritance, Resource Sharing, and Permissions
    PERFORM public.seed_staff_roles(v_tenant_id);
    PERFORM public.seed_tenant_resource_rules(v_tenant_id);
    PERFORM public.apply_tenant_role_inheritance(v_tenant_id);

    -- 4. Seed Default CMS Content
    INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
    VALUES (
        v_tenant_id, 'Home', 'home', '{"root":{"props":{"title":"Home"},"children":[]}}', 'published', true, 'homepage', (SELECT auth.uid())
    );

    -- 5. Set Default Menus
    INSERT INTO public.menus (tenant_id, name, label, url, group_label, is_active, is_public, "order")
    VALUES (v_tenant_id, 'home', 'Home', '/', 'header', true, true, 1);

    RETURN jsonb_build_object('tenant_id', v_tenant_id, 'message', 'Tenant created with default data.');
EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;
```

**Step 3: User Assignment**  
Finally, the newly created tenant requires an admin user. Through the admin panel UI or Edge Functions, a user is associated with the `admin` role ID created in Step 2.

---

### Admin Portal Context

- Uses subdomain resolution or path prefixes (e.g. `awcms.test/dinkes`).
- The tenant ID is intercepted globally via React Context. All subsequent Supabase calls in `customSupabaseClient.js` attach `headers: { "x-tenant-id": activeTenantId }`.

### Public Portal Context

- Renders statically or via Server-Side Rendering (SSR).
- Loads context via `PUBLIC_TENANT_ID`.
- Passes the resolved identifier dynamically into Supabase client instantiation `createClientFromEnv()`.

### Data Layer Security Notes

- Edge Functions are mandatory for cross-tenant data operations (Super Administrators managing global tenants).
- Direct client SQL queries are automatically blocked or clipped to the scope of `current_tenant_id()`.
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
- Tenant feature flags such as Stitch import controls are stored in `settings` (`key = 'stitch_import'`) and remain tenant-scoped.

## Troubleshooting

- 404 on public portal: confirm `PUBLIC_TENANT_ID` and build-time `getStaticPaths` output.
- Missing data in admin: verify `setGlobalTenantId()` and Supabase headers.

## References

- `docs/tenancy/supabase.md`
- `docs/security/rls.md`
- `docs/security/abac.md`
