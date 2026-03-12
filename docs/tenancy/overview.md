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

- `x-tenant-id` is injected into requests by the admin client, scoped public clients when needed, and Cloudflare Worker compatibility routes that need request-scoped tenant context.
- SQL functions resolve tenant context through `current_tenant_id()`, which reads the authenticated `public.users` row first and falls back to `app.current_tenant_id` for request-scoped/public flows.
- Hierarchy functions (`is_tenant_descendant`, `tenant_can_access_resource`) enforce shared vs isolated resources.
- Public aggregates (e.g., `analytics_daily`) are readable only when scoped to the tenant id.
- Build-time public tenant fallback order is implemented in `awcms-public/primary/src/lib/publicTenant.ts`.

## Implementation Details

### Tenant Onboarding and Isolation (Benchmark-Ready)

#### Objective

Provision a new tenant using a privileged, idempotent flow that seeds default roles/content and guarantees isolation via RLS from first use.

#### Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `actor` | `auth.getUser()` | Yes | Must hold `platform.tenant.create` |
| `name` | Onboarding payload | Yes | Human-readable tenant name |
| `slug` | Onboarding payload | Yes | Unique tenant identifier |
| `domain` | Onboarding payload | Conditional | Required for custom domain mode |
| `admin_email` | Onboarding payload | Yes | Initial tenant admin invite |
| `p_tier` | Onboarding payload | Optional | `free`/`pro`/`enterprise` |
| `p_parent_tenant_id` | Onboarding payload | Optional | Hierarchy parent |
| `role_inheritance_mode` | Onboarding payload | Optional | `auto` or `linked` |

#### Workflow

1. Authenticate caller and enforce `platform.tenant.create` before any writes.
2. Normalize and uniqueness-check `slug`/`domain` for non-deleted tenants.
3. Call `create_tenant_with_defaults()` using `SUPABASE_SECRET_KEY` and the current 6-argument hierarchy-aware signature.
4. Invite the initial tenant admin via `auth.admin.inviteUserByEmail` with `tenant_id` metadata.
5. Write an audit log entry with actor, tenant, and invite status.
6. Verify isolation: cross-tenant read denies, default roles/pages exist, headers resolve tenant correctly.
7. Return idempotent response on retries (409 on duplicate slug or 202 on invite failure).

#### Reference Blueprint (Example Cloudflare Worker Route)

> This is a benchmark-ready compatibility blueprint for the maintained Cloudflare Worker gateway in `awcms-edge/`.

```ts
// awcms-edge/src/index.ts
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";

const app = new Hono();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Content-Type": "application/json",
};

app.post("/functions/v1/platform-tenant-onboard", async (c) => {
  const req = c.req.raw;

  const supabaseUrl = c.env.VITE_SUPABASE_URL ?? "";
  const publishableKey = c.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  const secretKey = c.env.SUPABASE_SECRET_KEY ?? "";

  const authHeader = req.headers.get("Authorization") ?? "";
  const caller = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData } = await caller.auth.getUser();
  if (!authData?.user) return c.json({ error: "Unauthorized" }, 401);

  const { data: canCreate } = await caller.rpc("has_permission", {
    permission_name: "platform.tenant.create",
  });
  if (!canCreate) return c.json({ error: "Forbidden" }, 403);

  const payload = await req.json();
  if (!payload?.name || !payload?.slug || !payload?.admin_email) {
    return c.json({ error: "Missing required payload" }, 400);
  }

  const admin = createClient(supabaseUrl, secretKey);

  const { data: existing } = await admin
    .from("tenants")
    .select("id")
    .eq("slug", payload.slug)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing?.id) {
    return c.json({ error: "Slug already exists", tenant_id: existing.id }, 409);
  }

  const { data: tenant, error: tenantError } = await admin.rpc("create_tenant_with_defaults", {
    p_name: payload.name,
    p_slug: payload.slug,
    p_domain: payload.domain ?? null,
    p_tier: payload.tier ?? "free",
    p_parent_tenant_id: payload.parent_tenant_id ?? null,
    p_role_inheritance_mode: payload.role_inheritance_mode ?? "auto",
  });

  if (tenantError || !tenant?.tenant_id) {
    return c.json({ error: tenantError?.message ?? "Create tenant failed" }, 400);
  }

  const invite = await admin.auth.admin.inviteUserByEmail(payload.admin_email, {
    data: { tenant_id: tenant.tenant_id, role: "admin" },
  });

  await admin.from("audit_logs").insert({
    tenant_id: tenant.tenant_id,
    user_id: authData.user.id,
    action: "platform.tenant.create",
    details: { slug: payload.slug, invite_status: invite.error ? "failed" : "sent" },
  });

  return new Response(JSON.stringify({
    tenant_id: tenant.tenant_id,
    invite_status: invite.error ? "failed" : "sent",
  }), { status: invite.error ? 202 : 201, headers: corsHeaders });
});
```

#### Reference Implementation (Database RPC)

```sql
CREATE OR REPLACE FUNCTION public.create_tenant_with_defaults(
  p_name text,
  p_slug text,
  p_domain text DEFAULT NULL,
  p_tier text DEFAULT 'free',
  p_parent_tenant_id uuid DEFAULT NULL,
  p_role_inheritance_mode text DEFAULT 'auto'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  INSERT INTO public.tenants (name, slug, domain, subscription_tier, status, parent_tenant_id, role_inheritance_mode)
  VALUES (p_name, p_slug, p_domain, p_tier, 'active', p_parent_tenant_id, p_role_inheritance_mode)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.roles (name, description, tenant_id, is_system, scope, is_tenant_admin)
  VALUES ('admin', 'Tenant Administrator', v_tenant_id, true, 'tenant', true);

  INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
  VALUES ('editor', 'Content Editor', v_tenant_id, true, 'tenant');

  INSERT INTO public.roles (name, description, tenant_id, is_system, scope)
  VALUES ('author', 'Content Author', v_tenant_id, true, 'tenant');

  PERFORM public.seed_staff_roles(v_tenant_id);
  PERFORM public.seed_tenant_resource_rules(v_tenant_id);
  PERFORM public.apply_tenant_role_inheritance(v_tenant_id);

  INSERT INTO public.pages (tenant_id, title, slug, content, status, is_active, page_type, created_by)
  VALUES (v_tenant_id, 'Home', 'home', '{"root":{"props":{"title":"Home"},"children":[]}}', 'published', true, 'homepage', (SELECT auth.uid()));

  INSERT INTO public.menus (tenant_id, name, label, url, group_label, is_active, is_public, "order")
  VALUES (v_tenant_id, 'home', 'Home', '/', 'header', true, true, 1);

  RETURN jsonb_build_object('tenant_id', v_tenant_id, 'message', 'Tenant created with default data.');
END;
$$;
```

#### Validation Checklist

- New tenant has default roles (`admin`, `editor`, `author`) and baseline pages/menus.
- `x-tenant-id` resolves and `current_tenant_id()` returns the new tenant.
- Cross-tenant reads are denied by RLS.
- Invite email includes `tenant_id` metadata for first-login role assignment.

#### Failure Modes and Guardrails

- Invite fails after tenant creation: return 202 with retry guidance and audit log.
- Duplicate slug/domain: return 409 and do not re-create tenant.
- Missing tenant header: deny reads/writes until resolved.
- Non-admin caller: 403 with audit entry.

---

### Admin Portal Context

- Uses subdomain resolution or path prefixes (e.g. `awcms.test/dinkes`).
- The tenant ID is intercepted globally via React Context. All subsequent Supabase calls in `customSupabaseClient.js` attach `headers: { "x-tenant-id": activeTenantId }`.

### Public Portal Context

- Uses static output by default; SSR/runtime behavior is non-canonical unless explicitly enabled.
- Loads context via `PUBLIC_TENANT_ID`.
- Passes the resolved identifier dynamically into Supabase client instantiation `createClientFromEnv()`.

### Data Layer Security Notes

- Privileged server-side edge handlers are required for cross-tenant data operations (for example, Super Administrators managing global tenants).
- Direct client SQL queries are automatically blocked or clipped to the scope of `current_tenant_id()`.
- **Shared by default**: `settings`, `branding`, `modules` (descendants). Tenant admins and full-access roles have read/write access across levels based on `tenant_resource_rules`.
- **Isolated by default**: `content` (blogs, pages), `media` (`media_objects`, `media_upload_sessions`), `users`, and `orders`. These resources are strictly scoped to a single `tenant_id`.
- **Rules Storage**: Configured in `tenant_resource_registry` and enforced via `tenant_resource_rules`.

## Security and Compliance Notes

### Row Level Security (RLS)

- **Strict Enforcement**: RLS is mandatory for all tables.
- **Bypass Prohibition**: Client-side code must NEVER bypass RLS. Elevation is restricted to server-side `SUPABASE_SECRET_KEY` paths in Cloudflare Workers or trusted operational scripts.

### Data Lifecycle (Soft Delete)

- **Mechanism**: All tenant-scoped tables must use the "Soft Delete" pattern.
- **Schema Requirement**: Tables must include a `deleted_at` (TIMESTAMPTZ, nullable) column.
- **Operations**:
  - **Delete**: Implemented as `UPDATE table SET deleted_at = NOW() ...`.
  - **Read**: Queries must explicitly filter `.is('deleted_at', null)`.
- **Foreign Keys**: Prefer `ON DELETE RESTRICT` or `SET NULL` for business-owned records. `ON DELETE CASCADE` is acceptable for bridge/join rows or explicitly disposable associations where audit history is preserved elsewhere.

### Query Requirements

- **Tenant Filter**: All queries must include `.eq('tenant_id', tenantId)` even if RLS is enabled, to ensure query planner optimization and leak prevention.
- **Cross-Tenant Access**: Allowed only for resources marked as shared in the registry.

## Operational Concerns

- Tenant domains are configured in the `tenants` table (host/subdomain fields).
- New tenant creation seeds default roles, staff hierarchy, and resource rules via SQL/RPC.
- Tenant-scoped feature flags and structured settings remain isolated through `tenant_id` and `deleted_at IS NULL` constraints in the shared `settings` store.

## Troubleshooting

- 404 on public portal: confirm `PUBLIC_TENANT_ID` and build-time `getStaticPaths` output.
- Missing data in admin: verify `setGlobalTenantId()` and Supabase headers.

## References

- `docs/tenancy/supabase.md`
- `docs/security/rls.md`
- `docs/security/abac.md`
