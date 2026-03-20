-- Migration: 20260320100000_create_notification_channels.sql
-- Purpose: Per-tenant multi-channel messaging infrastructure
--   - tenant_notification_channels : credentials + enable/disable per channel type
--   - notification_dispatches      : per-message dispatch audit log
--   - notification_templates       : reusable per-tenant message templates
-- Authority: AGENTS.md §Architecture Plan Phase 1
-- Mirrors:   awcms/supabase/migrations/20260320100000_create_notification_channels.sql

-- ============================================================
-- 1. tenant_notification_channels
-- ============================================================

create table if not exists public.tenant_notification_channels (
  id              uuid          primary key default gen_random_uuid(),
  tenant_id       uuid          not null references public.tenants(id),
  channel_type    text          not null
    check (channel_type in ('email', 'whatsapp', 'telegram')),
  label           text          not null,
  credentials     jsonb         not null default '{}'::jsonb,
  enabled         boolean       not null default false,
  daily_quota     int           not null default 500
    check (daily_quota >= 0 and daily_quota <= 100000),
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  deleted_at      timestamptz,
  -- one active channel record per type per tenant
  constraint tenant_notification_channels_type_unique
    unique nulls not distinct (tenant_id, channel_type, deleted_at)
);

create index if not exists tnc_tenant_type_idx
  on public.tenant_notification_channels (tenant_id, channel_type)
  where deleted_at is null;

alter table public.tenant_notification_channels enable row level security;

create policy tnc_select
  on public.tenant_notification_channels for select
  using (
    tenant_id = public.current_tenant_id()
    and deleted_at is null
    and public.has_permission('tenant.notifications.read')
  );

create policy tnc_insert
  on public.tenant_notification_channels for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('tenant.notifications.manage')
  );

create policy tnc_update
  on public.tenant_notification_channels for update
  using (
    tenant_id = public.current_tenant_id()
    and deleted_at is null
    and public.has_permission('tenant.notifications.manage')
  )
  with check (tenant_id = public.current_tenant_id());

-- ============================================================
-- 2. notification_dispatches
-- ============================================================

create table if not exists public.notification_dispatches (
  id                  uuid          primary key default gen_random_uuid(),
  tenant_id           uuid          not null references public.tenants(id),
  channel_id          uuid          references public.tenant_notification_channels(id),
  channel_type        text          not null
    check (channel_type in ('email', 'whatsapp', 'telegram')),
  template_id         uuid,         -- nullable: ad-hoc messages have no template
  recipient           text          not null,
  subject             text,         -- email only
  body_preview        text,         -- first 500 chars of rendered body (no credentials)
  status              text          not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'permanent_failure')),
  provider_message_id text,
  error_message       text,
  payload_hash        text,         -- sha256 of full payload for idempotency auditing
  job_id              uuid,         -- queue job_id from awcms-notifications queue
  actor_id            uuid          references auth.users(id),
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
  -- No deleted_at: dispatch logs are immutable audit records
);

create index if not exists nd_tenant_status_created_idx
  on public.notification_dispatches (tenant_id, status, created_at desc);

create index if not exists nd_tenant_channel_created_idx
  on public.notification_dispatches (tenant_id, channel_type, created_at desc);

create index if not exists nd_job_id_idx
  on public.notification_dispatches (job_id)
  where job_id is not null;

alter table public.notification_dispatches enable row level security;

create policy nd_select
  on public.notification_dispatches for select
  using (
    tenant_id = public.current_tenant_id()
    and public.has_permission('tenant.notifications.read')
  );

-- Inserts happen via edge worker (admin client) — no direct insert policy for tenant users
-- Updates happen via edge worker (admin client) — no direct update policy for tenant users

-- ============================================================
-- 3. notification_templates
-- ============================================================

create table if not exists public.notification_templates (
  id              uuid          primary key default gen_random_uuid(),
  tenant_id       uuid          not null references public.tenants(id),
  channel_type    text          not null
    check (channel_type in ('email', 'whatsapp', 'telegram')),
  slug            text          not null,
  label           text          not null,
  subject         text,         -- email only
  body            text          not null,
  variables       jsonb         not null default '[]'::jsonb,  -- [{name, description, required}]
  is_system       boolean       not null default false,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  deleted_at      timestamptz
);

create unique index if not exists nt_tenant_channel_slug_unique
  on public.notification_templates (tenant_id, channel_type, lower(slug))
  where deleted_at is null;

create index if not exists nt_tenant_channel_idx
  on public.notification_templates (tenant_id, channel_type)
  where deleted_at is null;

alter table public.notification_templates enable row level security;

create policy nt_select
  on public.notification_templates for select
  using (
    tenant_id = public.current_tenant_id()
    and deleted_at is null
    and public.has_permission('tenant.notifications.read')
  );

create policy nt_insert
  on public.notification_templates for insert
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_permission('tenant.notifications.manage')
  );

create policy nt_update
  on public.notification_templates for update
  using (
    tenant_id = public.current_tenant_id()
    and deleted_at is null
    and public.has_permission('tenant.notifications.manage')
  )
  with check (tenant_id = public.current_tenant_id());

create policy nt_soft_delete
  on public.notification_templates for update
  using (
    tenant_id = public.current_tenant_id()
    and is_system = false
    and public.has_permission('tenant.notifications.manage')
  )
  with check (tenant_id = public.current_tenant_id());

-- ============================================================
-- 4. Seed permissions
-- ============================================================

insert into public.permissions (name, description, resource, action, module)
values
  ('tenant.notifications.read',   'View notification channels, dispatch log, and templates',  'notifications', 'read',   'notifications'),
  ('tenant.notifications.send',   'Trigger message sends via notification service',            'notifications', 'send',   'notifications'),
  ('tenant.notifications.manage', 'Create and configure notification channels and templates',  'notifications', 'manage', 'notifications')
on conflict (name) do nothing;

-- ============================================================
-- 5. Seed modules per tenant
--    (email-notifications, whatsapp-notifications, telegram-notifications)
--    Actual modules schema: (id, tenant_id, name, slug, description, status, created_at, updated_at)
-- ============================================================

insert into public.modules (tenant_id, name, slug, description, status)
select
  t.id,
  'Email Notifications',
  'email-notifications',
  'Send transactional and bulk emails via Mailketing through the Cloudflare queue.',
  'inactive'
from public.tenants t
where t.deleted_at is null
on conflict (tenant_id, slug) do update set
  name        = excluded.name,
  description = excluded.description,
  updated_at  = now();

insert into public.modules (tenant_id, name, slug, description, status)
select
  t.id,
  'WhatsApp Notifications',
  'whatsapp-notifications',
  'Send WhatsApp messages via StarSender through the Cloudflare queue.',
  'inactive'
from public.tenants t
where t.deleted_at is null
on conflict (tenant_id, slug) do update set
  name        = excluded.name,
  description = excluded.description,
  updated_at  = now();

insert into public.modules (tenant_id, name, slug, description, status)
select
  t.id,
  'Telegram Notifications',
  'telegram-notifications',
  'Send Telegram messages via Bot API through the Cloudflare queue.',
  'inactive'
from public.tenants t
where t.deleted_at is null
on conflict (tenant_id, slug) do update set
  name        = excluded.name,
  description = excluded.description,
  updated_at  = now();
