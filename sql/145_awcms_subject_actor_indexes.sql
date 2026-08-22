-- 145_awcms_subject_actor_indexes.sql
--
-- Finding C5 of the 17 August 2026 audit round — the subject-data export reads
-- two of the largest append-only tables in the schema over columns nothing
-- indexes.
--
-- `readSubjectExport` answers "everything this repository holds about this
-- person" by reading every registered exportable table with a predicate on the
-- subject's own columns. For `awcms_audit_events` and `awcms_domain_events`
-- those columns are `actor_tenant_user_id` (plus `actor_profile_id` on the
-- second), and neither has an index — so a data-subject-access request is two
-- sequential scans of the tables that grow fastest and are never pruned below
-- their retention window.
--
-- ## Why no gate saw it
--
-- `db:fk-index:check` enforces "an FK column must be index-reachable"
-- (ADR-0064). These columns are NOT foreign keys, deliberately: an audit row
-- must survive the deletion of the actor it names, and an FK would either block
-- that deletion or cascade the evidence away. So the one gate that looks at
-- index coverage structurally cannot see them, and the near-miss makes it
-- worse: `awcms_audit_events_actor_tenant_idx` covers `actor_tenant_id` — the
-- delegated actor's TENANT, a different column one character apart in reading.
--
-- ## Shape
--
-- Partial on `IS NOT NULL`, because most rows have no actor at all (system
-- writes, scheduled jobs, anonymous public events) and an index entry for every
-- one of them is bytes on the write path bought for nothing. `tenant_id` leads,
-- matching the export's own predicate and every other index on these tables.
--
-- No `created_at` tail: the export takes the whole set for one subject and does
-- not order it, so a third column would only widen the entry. That is a
-- deliberate difference from `awcms_audit_events_actor_tenant_idx`, which
-- serves a time-ordered admin listing.

CREATE INDEX IF NOT EXISTS awcms_audit_events_actor_tenant_user_idx
  ON awcms_audit_events (tenant_id, actor_tenant_user_id)
  WHERE actor_tenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS awcms_domain_events_actor_tenant_user_idx
  ON awcms_domain_events (tenant_id, actor_tenant_user_id)
  WHERE actor_tenant_user_id IS NOT NULL;

-- `awcms_domain_events` matches the subject on a SECOND column, and the export
-- ORs them. Postgres can use two partial indexes for an OR through a BitmapOr,
-- which is why this is two narrow indexes rather than one composite that would
-- serve neither branch alone.
CREATE INDEX IF NOT EXISTS awcms_domain_events_actor_profile_idx
  ON awcms_domain_events (tenant_id, actor_profile_id)
  WHERE actor_profile_id IS NOT NULL;
