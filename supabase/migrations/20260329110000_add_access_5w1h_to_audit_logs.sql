-- Add structured 5W+1H access-log fields to audit_logs without breaking
-- existing trigger- and client-based consumers.

alter table public.audit_logs
  add column if not exists actor_type text,
  add column if not exists actor_role text,
  add column if not exists auth_context jsonb not null default '{}'::jsonb,
  add column if not exists module_name text,
  add column if not exists feature_name text,
  add column if not exists action_name text,
  add column if not exists resource_type text,
  add column if not exists resource_id text,
  add column if not exists permission_key text,
  add column if not exists server_timestamp timestamptz,
  add column if not exists client_timestamp timestamptz,
  add column if not exists request_duration_ms integer,
  add column if not exists workspace_source text,
  add column if not exists route_path text,
  add column if not exists url text,
  add column if not exists screen_name text,
  add column if not exists user_agent text,
  add column if not exists device_metadata jsonb not null default '{}'::jsonb,
  add column if not exists purpose text,
  add column if not exists workflow_state text,
  add column if not exists trigger_source text,
  add column if not exists business_intent text,
  add column if not exists access_channel text,
  add column if not exists access_mechanism text,
  add column if not exists integration_source text,
  add column if not exists auth_method text;

update public.audit_logs
set
  action_name = coalesce(action_name, action),
  resource_type = coalesce(resource_type, resource),
  server_timestamp = coalesce(server_timestamp, created_at),
  access_channel = coalesce(access_channel, channel),
  user_agent = coalesce(user_agent, details->>'user_agent'),
  route_path = coalesce(route_path, details->>'route_path'),
  screen_name = coalesce(screen_name, details->>'screen_name'),
  url = coalesce(url, details->>'url'),
  permission_key = coalesce(permission_key, details->>'permission_key'),
  auth_method = coalesce(auth_method, details->>'auth_method'),
  purpose = coalesce(purpose, details->>'purpose'),
  trigger_source = coalesce(trigger_source, details->>'trigger_source'),
  business_intent = coalesce(business_intent, details->>'business_intent')
where true;

create index if not exists idx_audit_logs_module_name
  on public.audit_logs (module_name);

create index if not exists idx_audit_logs_access_channel
  on public.audit_logs (access_channel);

create index if not exists idx_audit_logs_workspace_source
  on public.audit_logs (workspace_source);

create index if not exists idx_audit_logs_route_path
  on public.audit_logs (route_path);

create index if not exists idx_audit_logs_permission_key
  on public.audit_logs (permission_key);

create or replace function public.log_access_event(
  p_tenant_id uuid default null,
  p_user_id uuid default null,
  p_action text default 'access',
  p_resource text default 'access',
  p_details jsonb default '{}'::jsonb,
  p_ip_address text default null,
  p_channel text default null,
  p_actor_type text default null,
  p_actor_role text default null,
  p_auth_context jsonb default '{}'::jsonb,
  p_module_name text default null,
  p_feature_name text default null,
  p_action_name text default null,
  p_resource_type text default null,
  p_resource_id text default null,
  p_permission_key text default null,
  p_server_timestamp timestamptz default now(),
  p_client_timestamp timestamptz default null,
  p_request_duration_ms integer default null,
  p_workspace_source text default null,
  p_route_path text default null,
  p_url text default null,
  p_screen_name text default null,
  p_user_agent text default null,
  p_device_metadata jsonb default '{}'::jsonb,
  p_purpose text default null,
  p_workflow_state text default null,
  p_trigger_source text default null,
  p_business_intent text default null,
  p_access_channel text default null,
  p_access_mechanism text default null,
  p_integration_source text default null,
  p_auth_method text default null
)
returns public.audit_logs
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  inserted_row public.audit_logs;
begin
  insert into public.audit_logs (
    tenant_id,
    user_id,
    action,
    resource,
    details,
    ip_address,
    channel,
    actor_type,
    actor_role,
    auth_context,
    module_name,
    feature_name,
    action_name,
    resource_type,
    resource_id,
    permission_key,
    server_timestamp,
    client_timestamp,
    request_duration_ms,
    workspace_source,
    route_path,
    url,
    screen_name,
    user_agent,
    device_metadata,
    purpose,
    workflow_state,
    trigger_source,
    business_intent,
    access_channel,
    access_mechanism,
    integration_source,
    auth_method
  )
  values (
    p_tenant_id,
    p_user_id,
    coalesce(p_action, 'access'),
    coalesce(p_resource, 'access'),
    coalesce(p_details, '{}'::jsonb),
    p_ip_address,
    p_channel,
    p_actor_type,
    p_actor_role,
    coalesce(p_auth_context, '{}'::jsonb),
    p_module_name,
    p_feature_name,
    coalesce(p_action_name, p_action, 'access'),
    coalesce(p_resource_type, p_resource, 'access'),
    p_resource_id,
    p_permission_key,
    coalesce(p_server_timestamp, now()),
    p_client_timestamp,
    p_request_duration_ms,
    p_workspace_source,
    p_route_path,
    p_url,
    p_screen_name,
    p_user_agent,
    coalesce(p_device_metadata, '{}'::jsonb),
    p_purpose,
    p_workflow_state,
    p_trigger_source,
    p_business_intent,
    coalesce(p_access_channel, p_channel),
    p_access_mechanism,
    p_integration_source,
    p_auth_method
  )
  returning * into inserted_row;

  return inserted_row;
end;
$$;

grant execute on function public.log_access_event(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  integer,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

comment on function public.log_access_event(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  integer,
  text,
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
) is 'Writes a normalized 5W+1H access/audit event into audit_logs.';
