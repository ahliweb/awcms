# Programmatic Content Type Schemas

AWCMS leverages Supabase for its foundational database structure, but defining a new content type requires a tenant-safe schema, ABAC-driven policies, and admin UI registration.

## Objective

Create a new tenant-scoped content type (for example `events`) that is fully isolated, permissioned, and ready for Admin and Public clients.

## Required Inputs

| Field | Source | Required | Notes |
| --- | --- | --- | --- |
| `content_type` | Module spec | Yes | Example: `events` |
| `permission_prefix` | Permission matrix | Yes | Example: `tenant.events.*` |
| `status` lifecycle | Workflow design | Yes | `draft`/`review`/`published`/`archived` |
| `tenant_id` | `useTenant()` / RLS | Yes | Isolation boundary |
| `author_id` | `auth.uid()` | Yes | Ownership enforcement |
| Migration name | Supabase CLI | Yes | Timestamped SQL file |

## Workflow

1. Create a migration in `supabase/migrations/` and mirror it in `awcms/supabase/migrations/`.
2. Define the table with `tenant_id`, audit fields, `deleted_at`, and a workflow `status`.
3. Add partial unique indexes for slug and tenant-scoped listing performance.
4. Enable RLS and create ABAC policies using `has_permission` and `auth_is_admin`.
5. Register the resource in `resources_registry` (`key`, `label`, `scope`, `type`, `db_table`, `permission_prefix`) and add permissions in `permissions` + `role_permissions`.
6. (Optional) Register blocks/components in `component_registry` using `resource_key` and `editor_type`.

## Reference Implementation

### A. Migration SQL (Table + Indexes + RLS)

```sql
-- supabase/migrations/<timestamp>_create_events.sql
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  author_id uuid not null references public.users(id),
  title text not null,
  slug text not null,
  summary text,
  content jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','review','published','archived')),
  published_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists events_tenant_slug_unique
  on public.events (tenant_id, lower(slug))
  where deleted_at is null;

create index if not exists events_tenant_status_created_idx
  on public.events (tenant_id, status, created_at desc)
  where deleted_at is null;

alter table public.events enable row level security;
```

### B. RLS Policies (ABAC Standard)

```sql
create policy events_select_abac on public.events
for select using (
  tenant_id = public.current_tenant_id()
  and deleted_at is null
  and (public.has_permission('tenant.events.read') or public.auth_is_admin())
);

create policy events_insert_abac on public.events
for insert with check (
  tenant_id = public.current_tenant_id()
  and author_id = auth.uid()
  and public.has_permission('tenant.events.create')
);

create policy events_update_abac on public.events
for update using (
  tenant_id = public.current_tenant_id()
  and deleted_at is null
  and (
    public.has_permission('tenant.events.update')
    or (public.has_permission('tenant.events.update_own') and author_id = auth.uid())
    or public.auth_is_admin()
  )
);
```

### C. Resource Registration

```javascript
// awcms/src/lib/registerContentType.js
import { supabase } from "@/lib/customSupabaseClient";

export async function registerEventsResource() {
  const { error } = await supabase.from("resources_registry").insert([
    {
      key: "events",
      label: "Events",
      scope: "tenant",
      type: "content",
      db_table: "events",
      icon: "Calendar",
      permission_prefix: "tenant.events",
      active: true,
    },
  ]);

  if (error) throw new Error(error.message);
}
```

### D. Component Registry (Optional)

```javascript
import { supabase } from "@/lib/customSupabaseClient";

await supabase.from("component_registry").upsert({
  resource_key: "events",
  tenant_id: tenantId,
  editor_type: "puck",
  config: {
    blocks: ["EventList"],
  },
});
```

### E. Admin Create Flow (Minimal Insert)

```javascript
import { supabase } from "@/lib/customSupabaseClient";
import { useTenant } from "@/contexts/TenantContext";

const { tenantId } = useTenant();
const { data: authData } = await supabase.auth.getUser();
const user = authData?.user;

await supabase.from("events").insert({
  tenant_id: tenantId,
  author_id: user.id,
  title,
  slug,
  content,
  status: "draft",
});
```

## Validation Checklist

- Cross-tenant reads and writes are denied by RLS.
- Duplicate slugs are blocked within the same tenant and non-deleted scope.
- `update_own` permissions only allow edits by the original author.
- Public queries include `status = 'published'` and `deleted_at is null`.

## Failure Modes and Guardrails

- Missing `deleted_at` column: soft delete pattern breaks.
- No partial unique index on slug: restore collisions occur.
- RLS policy without `tenant_id`: cross-tenant leaks.
- Missing permission keys: ABAC policies return false for all users.

## References

- `docs/security/abac.md`
- `docs/security/rls.md`
- `docs/tenancy/overview.md`
