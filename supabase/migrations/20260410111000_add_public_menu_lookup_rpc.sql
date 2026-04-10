create or replace function public.get_public_menu_rows(
  p_tenant_id uuid,
  p_location text,
  p_locale text default null
)
returns table (
  id uuid,
  tenant_id uuid,
  name text,
  label text,
  slug text,
  url text,
  parent_id uuid,
  "order" integer,
  is_active boolean,
  is_public boolean,
  role_id uuid,
  group_label text,
  location text,
  locale text,
  page_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.tenant_id,
    m.name,
    m.label,
    m.slug,
    m.url,
    m.parent_id,
    m."order",
    m.is_active,
    m.is_public,
    m.role_id,
    m.group_label,
    m.location,
    m.locale,
    m.page_id
  from public.menus m
  where m.deleted_at is null
    and m.tenant_id = p_tenant_id
    and m.is_active = true
    and m.is_public = true
    and (
      m.location = p_location
      or (m.location is null and m.group_label = p_location)
    )
    and (
      p_locale is null
      or m.locale = p_locale
      or m.locale is null
    )
  order by m."order" asc, m.created_at asc;
$$;

revoke all on function public.get_public_menu_rows(uuid, text, text) from public;
grant execute on function public.get_public_menu_rows(uuid, text, text) to anon;
grant execute on function public.get_public_menu_rows(uuid, text, text) to authenticated;
grant execute on function public.get_public_menu_rows(uuid, text, text) to service_role;
