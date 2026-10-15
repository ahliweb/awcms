-- Rate-aware audit of SENSITIVE READS (Issue #978, finding PS-18 (a);
-- `docs/awcms/hr-payroll.md` sections 11.3, 13.2 and 17).
--
-- ## Why this table exists
--
-- `docs/awcms/hr-payroll.md` section 13.2 claims the audit trail answers "who
-- read what". Until this issue it audited only the payout-account `reveal`: an
-- insider paging through `compensation.read`, per-employee run lines or other
-- employees' payslips left nothing behind. The obvious fix, one audit row per
-- read, floods the log (a list screen is dozens of reads a minute) and teaches
-- everyone to ignore it.
--
-- So a sensitive read is audited ONCE PER ACTOR, PER KIND, PER WINDOW, and the
-- window carries a running count. `awcms_audit_events` is append-only to the
-- application role (no UPDATE privilege, see `security:readiness`), so the
-- counter cannot live in the audit row; it lives here, and the audit row is
-- written when a window OPENS and again at each decade of reads or items
-- (10, 100, 1000 ...), which keeps the log growth logarithmic in the number of
-- reads while an unusually heavy reader still shows up as a `warning`.
--
-- ## Shape, and why it is bounded
--
-- ONE row per `(tenant, actor, module, kind)`. A new window overwrites the
-- previous one in place (`window_start`, `read_count`, `item_count` reset), so
-- the table's size is `actors x sensitive kinds`, never a function of traffic,
-- and it needs no purge job. Evidence is the audit row, not this row: this is
-- the working counter the next read consults. It holds no amount, no name, no
-- identifier of a record and no free text - only who, which kind, and counts.
--
-- ## Classification
--
-- INTERNAL operational state. The actor column is a person reference (a
-- tenant user id), as on `awcms_audit_events`, which has no foreign key either:
-- a counter row must never block the removal of an account, and an orphaned
-- one is harmless (it counts reads that were already audited).
--
-- RLS ENABLE + FORCE with USING and WITH CHECK, like every tenant table. The
-- application role may SELECT, INSERT and UPDATE; there is no DELETE because
-- nothing deletes (bounded), and no TRUNCATE.

CREATE TABLE IF NOT EXISTS awcms_sensitive_read_windows (
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  actor_tenant_user_id uuid NOT NULL,
  module_key text NOT NULL,
  -- The audit action name for this kind, e.g. `sensitive_read.compensation`.
  kind text NOT NULL,
  -- Start of the CURRENT fixed window. A read whose window is later than this
  -- opens a new one (and is audited); an equal one increments it.
  window_start timestamptz NOT NULL,
  read_count integer NOT NULL,
  -- Records returned across the window. A COUNT: never a value.
  item_count bigint NOT NULL,
  -- The distinct record ids already AUDITED in the current window (bounded to
  -- 500 by the writer). Coalescing may drop repeats, never identities: a read
  -- naming an id not in this set writes an audit row listing it. UUIDs only,
  -- the same ids the audit row carries; never a value.
  seen_ids uuid[] NOT NULL DEFAULT '{}',
  last_read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_sensitive_read_windows_pkey
    PRIMARY KEY (tenant_id, actor_tenant_user_id, module_key, kind),
  CONSTRAINT awcms_sensitive_read_windows_module_key_check
    CHECK (module_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  CONSTRAINT awcms_sensitive_read_windows_kind_check
    CHECK (kind ~ '^[a-z][a-z0-9_.]{0,62}$'),
  CONSTRAINT awcms_sensitive_read_windows_read_count_check
    CHECK (read_count >= 1),
  CONSTRAINT awcms_sensitive_read_windows_item_count_check
    CHECK (item_count >= 0),
  CONSTRAINT awcms_sensitive_read_windows_seen_ids_check
    CHECK (cardinality(seen_ids) <= 500)
);

ALTER TABLE awcms_sensitive_read_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_sensitive_read_windows FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_sensitive_read_windows_tenant_isolation
  ON awcms_sensitive_read_windows
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

REVOKE DELETE, TRUNCATE ON awcms_sensitive_read_windows FROM awcms_app;
