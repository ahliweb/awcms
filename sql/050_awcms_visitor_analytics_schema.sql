-- visitor_analytics — tenant-scoped schema for visitor presence
-- (`awcms_visitor_sessions`), individual page view/API events
-- (`awcms_visit_events`), and pre-aggregated daily statistics
-- (`awcms_visitor_daily_rollups`). Ported from awcms-micro migration 039
-- (rename `awcms_micro_` -> `awcms_`), adapted to this base's cross-tenant
-- foreign-key convention (see the composite FK note below).
--
-- Deliberately NOT audit tables and NOT soft-deletable master/config data:
-- these are high-volume, log-like analytics rows (same shape as
-- `awcms_audit_events`) — no `deleted_at`/`deleted_by`/`delete_reason`
-- columns. Lifecycle is retention-based purge
-- (`application/retention-purge.ts`, `bun run analytics:purge`), not soft
-- delete/restore.
--
-- Privacy notes (binding on every writer of these tables, see
-- `src/modules/visitor-analytics/README.md`):
--   - `ip_address` (raw) is nullable and must only ever be populated when
--     `VISITOR_ANALYTICS_RAW_IP_ENABLED=true` (the module's config gate).
--     Default privacy-first operation relies on `ip_hash`/
--     `user_agent_hash`/`visitor_key_hash` (all salted HMAC-SHA256) plus
--     already-parsed browser/device fields, never the raw values.
--   - `login_identifier_snapshot` is nullable and must never be populated
--     for anonymous public visitors — only for authenticated sessions, as
--     a point-in-time display convenience. The public visit-ingest
--     endpoint this base ships is anonymous-only, so it always leaves both
--     `identity_id` and `login_identifier_snapshot` null.
--   - No request body, cookie, Authorization header, password-reset token,
--     OAuth code, or query-string secret is ever stored in any column,
--     including the two `jsonb` catch-alls (`user_agent_parsed`, `geo`) —
--     both are populated only from derived/parsed values, never raw
--     request data.
--
-- CROSS-TENANT FOREIGN KEY (this base's convention, not awcms-micro's): a
-- plain `REFERENCES awcms_visitor_sessions (id)` is checked by the FK owner
-- and so silently crosses tenants (the referenced row could belong to any
-- tenant). This base carries `tenant_id` into the reference as a composite
-- `(tenant_id, id)` FK, which requires a matching `UNIQUE (tenant_id, id)`
-- on the parent — same pattern the office/tenant-scoped tables use. The
-- collector always resolves `visitor_session_id` from a session row it
-- itself just found/created inside the SAME tenant transaction, so this
-- composite FK is naturally satisfied and can never point across tenants.
--
-- `identity_id` stays a plain nullable FK to `awcms_identities (id)`: the
-- public ingest endpoint never populates it (anonymous-only), so it is
-- never fed a client-controlled value that a composite FK would need to
-- defend — and adding a `UNIQUE (tenant_id, id)` to another module's
-- `awcms_identities` table is out of scope for this port.
--
-- RLS: `ENABLE` + `FORCE ROW LEVEL SECURITY` + the standard
-- `tenant_isolation` policy on all three tables (same pattern as
-- sql/046). No explicit `GRANT` needed for `awcms_app` — sql/019's
-- `ALTER DEFAULT PRIVILEGES` already covers every table the owning role
-- creates from here on.

CREATE TABLE IF NOT EXISTS awcms_visitor_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  visitor_key_hash text NOT NULL,
  identity_id uuid REFERENCES awcms_identities (id),
  login_identifier_snapshot text,
  is_authenticated boolean NOT NULL DEFAULT false,
  area text NOT NULL,
  current_path text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  ip_address inet,
  user_agent_hash text,
  browser_name text,
  browser_version_major text,
  os_name text,
  device_type text,
  is_human boolean NOT NULL DEFAULT true,
  bot_reason text,
  country_code text,
  region text,
  city text,
  timezone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_visitor_sessions_area_check
    CHECK (area IN ('admin', 'public', 'api', 'auth', 'setup', 'unknown')),
  CONSTRAINT awcms_visitor_sessions_device_type_check
    CHECK (device_type IS NULL
      OR device_type IN ('desktop', 'mobile', 'tablet', 'bot', 'unknown'))
);

-- Composite unique so `awcms_visit_events` can carry a cross-tenant-safe
-- `(tenant_id, visitor_session_id)` FK (see file header). `id` is already
-- unique via the PRIMARY KEY; this adds `(tenant_id, id)` as the FK target.
CREATE UNIQUE INDEX IF NOT EXISTS awcms_visitor_sessions_tenant_id_key
  ON awcms_visitor_sessions (tenant_id, id);

CREATE INDEX IF NOT EXISTS awcms_visitor_sessions_tenant_last_seen_idx
  ON awcms_visitor_sessions (tenant_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS awcms_visitor_sessions_tenant_area_last_seen_idx
  ON awcms_visitor_sessions (tenant_id, area, last_seen_at DESC);

ALTER TABLE awcms_visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_visitor_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_visitor_sessions_tenant_isolation
  ON awcms_visitor_sessions
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE TABLE IF NOT EXISTS awcms_visit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  visitor_session_id uuid,
  identity_id uuid REFERENCES awcms_identities (id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  method text NOT NULL,
  status_code integer,
  area text NOT NULL,
  route_pattern text,
  path_sanitized text NOT NULL,
  referrer_domain text,
  duration_ms integer,
  ip_hash text,
  user_agent_hash text,
  user_agent_parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
  geo jsonb NOT NULL DEFAULT '{}'::jsonb,
  human_status text NOT NULL,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_visit_events_session_fk
    FOREIGN KEY (tenant_id, visitor_session_id)
    REFERENCES awcms_visitor_sessions (tenant_id, id),
  CONSTRAINT awcms_visit_events_area_check
    CHECK (area IN ('admin', 'public', 'api', 'auth', 'setup', 'unknown')),
  CONSTRAINT awcms_visit_events_human_status_check
    CHECK (human_status IN ('human', 'bot', 'unknown')),
  CONSTRAINT awcms_visit_events_status_code_check
    CHECK (status_code IS NULL OR (status_code >= 100 AND status_code <= 599))
);

CREATE INDEX IF NOT EXISTS awcms_visit_events_tenant_occurred_idx
  ON awcms_visit_events (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS awcms_visit_events_tenant_area_occurred_idx
  ON awcms_visit_events (tenant_id, area, occurred_at DESC);

CREATE INDEX IF NOT EXISTS awcms_visit_events_tenant_human_status_occurred_idx
  ON awcms_visit_events (tenant_id, human_status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS awcms_visit_events_session_occurred_idx
  ON awcms_visit_events (visitor_session_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS awcms_visit_events_identity_occurred_idx
  ON awcms_visit_events (identity_id, occurred_at DESC);

ALTER TABLE awcms_visit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_visit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_visit_events_tenant_isolation
  ON awcms_visit_events
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- No `deleted_at`/soft delete (see file header) and no separate `id`
-- primary key — `(tenant_id, date, area)` is both the natural key and the
-- upsert target for the rollup job, so it is the PRIMARY KEY directly
-- (Postgres creates its backing unique index automatically).
CREATE TABLE IF NOT EXISTS awcms_visitor_daily_rollups (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  date date NOT NULL,
  area text NOT NULL,
  human_unique_visitors integer NOT NULL DEFAULT 0,
  human_pageviews integer NOT NULL DEFAULT 0,
  bot_pageviews integer NOT NULL DEFAULT 0,
  authenticated_unique_users integer NOT NULL DEFAULT 0,
  public_unique_visitors integer NOT NULL DEFAULT 0,
  admin_unique_users integer NOT NULL DEFAULT 0,
  top_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_browsers jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_devices jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_countries jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, date, area),
  CONSTRAINT awcms_visitor_daily_rollups_area_check
    CHECK (area IN ('admin', 'public', 'api', 'auth', 'setup', 'unknown'))
);

ALTER TABLE awcms_visitor_daily_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_visitor_daily_rollups FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_visitor_daily_rollups_tenant_isolation
  ON awcms_visitor_daily_rollups
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Least-privilege grants for the `awcms_worker` role (sql/022) — the
-- scheduled rollup (`bun run analytics:rollup`) and retention-purge
-- (`bun run analytics:purge`) jobs run as this role when
-- WORKER_DATABASE_URL is set. sql/019's `ALTER DEFAULT PRIVILEGES` only
-- covers `awcms_app`, so each table a worker job touches needs an explicit
-- grant here (same pattern sql/035 blog / sql/041 news-media use). The
-- worker is NOBYPASSRLS, so these tenant-scoped tables still enforce their
-- `tenant_isolation` policy on top of these table privileges — every job
-- opens `withTenant(...)` per tenant, which sets `app.current_tenant_id`.
GRANT SELECT, DELETE ON awcms_visit_events TO awcms_worker;
GRANT SELECT, UPDATE, DELETE ON awcms_visitor_sessions TO awcms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON awcms_visitor_daily_rollups TO awcms_worker;
