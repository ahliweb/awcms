-- Migration: seed platform.docs.read for protected admin API documentation access
-- Date: 2026-04-02

insert into public.permissions (name, resource, action, description)
values (
  'platform.docs.read',
  'docs',
  'read',
  'Read protected awcms-edge admin API documentation surfaces'
)
on conflict (name) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.name = 'platform.docs.read'
where r.deleted_at is null
  and (
    coalesce(r.is_platform_admin, false) = true
    or coalesce(r.is_full_access, false) = true
    or r.name in ('platform_admin', 'Platform Admin', 'super_admin', 'Super Admin', 'owner', 'Owner')
  )
on conflict do nothing;
