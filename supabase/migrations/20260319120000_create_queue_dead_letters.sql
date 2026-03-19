-- Migration: Create queue_dead_letters table
--
-- Stores messages that exhausted all retries on either
-- awcms-media-events-dlq or awcms-notifications-dlq.
--
-- DLQ consumer (dlqConsumer.ts) inserts rows here after receiving a DLQ batch.
-- Replay is performed via POST /api/admin/queue/replay (superadmin-only).
--
-- Authority: docs/architecture/queue-topology.md → Phase 5 Observability

create table if not exists public.queue_dead_letters (
  id               uuid primary key default gen_random_uuid(),

  -- Which DLQ the message arrived on
  queue_name       text not null,

  -- Envelope fields (copied from the failed message for inspection)
  job_id           text not null,
  event_type       text not null,
  tenant_id        uuid,
  resource_type    text,
  resource_id      text,
  trace_id         text,

  -- Full message payload preserved for replay
  payload          jsonb not null,

  -- Failure context
  failure_reason   text,
  failed_at        timestamptz not null default now(),

  -- Replay tracking (null = not yet replayed)
  replayed_at      timestamptz,
  replayed_by      uuid references auth.users(id),
  replayed_job_id  text,

  created_at       timestamptz not null default now()
);

-- Index: lookup by tenant for the admin UI
create index if not exists queue_dead_letters_tenant_idx
  on public.queue_dead_letters (tenant_id, failed_at desc)
  where tenant_id is not null;

-- Index: lookup by queue + replay status for ops dashboards
create index if not exists queue_dead_letters_queue_replayed_idx
  on public.queue_dead_letters (queue_name, replayed_at nulls first, failed_at desc);

-- Index: lookup by job_id for idempotency checks during replay
create index if not exists queue_dead_letters_job_id_idx
  on public.queue_dead_letters (job_id);

-- RLS: Enable row-level security.
-- Only platform admins (service-role / SUPABASE_SECRET_KEY path) should read/write.
-- The DLQ consumer uses the admin client (bypasses RLS); the replay route also uses
-- the admin client.  Direct user-facing read is blocked for now.
alter table public.queue_dead_letters enable row level security;

-- Platform admin select policy (uses auth_is_admin() or the is_platform_admin flag)
create policy queue_dead_letters_platform_admin_select
  on public.queue_dead_letters
  for select
  using (
    exists (
      select 1
      from public.users u
      where u.id = auth.uid()
        and u.deleted_at is null
        and (u.is_platform_admin = true or u.is_full_access = true)
    )
  );

-- No insert/update/delete via user JWT — admin client only.
-- (Service-role key bypasses RLS entirely.)

comment on table public.queue_dead_letters is
  'Dead-letter store for Cloudflare Queue messages that exhausted all retries. '
  'Populated by dlqConsumer.ts. Replayed via POST /api/admin/queue/replay.';
