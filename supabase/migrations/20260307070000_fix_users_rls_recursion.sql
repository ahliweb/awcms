-- Fix infinite recursion in users RLS by bypassing row_security in helper functions

create or replace function public.current_tenant_id()
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
 set row_security = off
as $function$
declare
  v_tenant_id uuid;
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    begin
      v_tenant_id := current_setting('app.current_tenant_id', true)::uuid;
      if v_tenant_id is not null then
        return v_tenant_id;
      end if;
    exception when others then
      null;
    end;

    return null;
  end if;

  select tenant_id into v_tenant_id
  from public.users
  where id = v_user_id
    and deleted_at is null;

  if v_tenant_id is not null then
    return v_tenant_id;
  end if;

  return null;
end;
$function$;

create or replace function public.get_my_role()
 returns text
 language plpgsql
 stable security definer
 set search_path to 'public'
 set row_security = off
as $function$
declare
  role_name text;
begin
  select r.name into role_name
  from public.users u
  join public.roles r on u.role_id = r.id
  where u.id = (select auth.uid())
    and r.deleted_at is null
  limit 1;

  if role_name is null then
    select r.name into role_name
    from public.roles r
    where r.is_guest = true
      and r.deleted_at is null
      and (r.tenant_id = public.current_tenant_id() or r.tenant_id is null)
    order by r.tenant_id nulls last
    limit 1;
  end if;

  return coalesce(role_name, 'guest');
end;
$function$;

create or replace function public.is_admin_or_above()
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
 set row_security = off
as $function$
begin
  return exists (
    select 1
    from public.users u
    join public.roles r on u.role_id = r.id
    where u.id = auth.uid()
      and r.deleted_at is null
      and (r.is_tenant_admin or r.is_platform_admin or r.is_full_access)
  );
end;
$function$;

create or replace function public.is_platform_admin()
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
 set row_security = off
as $function$
begin
  return exists (
    select 1
    from public.users u
    join public.roles r on u.role_id = r.id
    where u.id = auth.uid()
      and r.deleted_at is null
      and (r.is_platform_admin = true or r.is_full_access = true)
  );
end;
$function$;
