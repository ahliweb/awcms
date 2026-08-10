-- ADR-0077, Issue #477 — retire the second outbox.
--
-- `awcms_sync_outbox` was created by `sql/010` and never written by anything:
-- no application code, no trigger, no migration. `POST /api/v1/sync/pull` now
-- reads `awcms_domain_events`, which is this repo's transactional outbox and
-- already carries a dispatcher, a DLQ, and replay.
--
-- ## Why the checkpoint needs no migration
--
-- `awcms_sync_nodes.last_pull_sequence` is a plain `bigint DEFAULT 0` with no
-- foreign key to any sequence. `pull.ts` writes back `newCheckpoint =
-- sinceSequence` whenever it finds no events — which was every call — so every
-- node in every deployment still holds 0. Moving the cursor's source table is
-- therefore free TODAY and would not be on the first day a producer existed.
--
-- ## Why this refuses instead of destroying
--
-- The table is provably empty in this codebase, and `DROP TABLE` on a provably
-- empty table is safe. "Provably" covers what the code does, not what a hand
-- run against a production database once did. A deployment holding rows here
-- knows something this migration does not, and deserves to be stopped rather
-- than quietly cleaned up: the rows would be the only evidence of whatever put
-- them there.
--
-- Idempotent: after the DROP the DO block's `to_regclass` guard is NULL and the
-- whole migration becomes a no-op on a second run.

DO $$
DECLARE
  outbox_rows bigint;
BEGIN
  IF to_regclass('public.awcms_sync_outbox') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM awcms_sync_outbox' INTO outbox_rows;

  IF outbox_rows > 0 THEN
    RAISE EXCEPTION
      'awcms_sync_outbox holds % row(s); ADR-0077 retires it on the basis that nothing has ever written it. Export those rows and decide what they mean before re-running this migration.',
      outbox_rows;
  END IF;
END $$;

DROP TABLE IF EXISTS awcms_sync_outbox;

-- The cursor index `/sync/pull` will need once an event type becomes
-- replicable (`sync-storage/domain/sync-replication.ts`). `sql/009` indexes
-- `event_sequence` globally and `(tenant_id, recorded_at DESC)`, but not the
-- tenant-scoped cursor shape this endpoint scans by.
--
-- Created now, with the endpoint that uses it, rather than later with the first
-- allow-list entry: the allow-list is one line, and a one-line change that
-- silently turns a bounded index scan into a full scan is the kind that lands
-- without anyone measuring it.
CREATE INDEX IF NOT EXISTS awcms_domain_events_tenant_sequence_idx
  ON awcms_domain_events (tenant_id, event_sequence);

COMMENT ON INDEX awcms_domain_events_tenant_sequence_idx IS
  'Cursor index for POST /api/v1/sync/pull (ADR-0077): WHERE tenant_id = ? AND event_sequence > ? ORDER BY event_sequence ASC.';
