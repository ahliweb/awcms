-- Issue #468, ADR-0072 — retention for the email outbox.
--
-- ADR-0072 decided the FRAME (a `dataLifecycle` descriptor, a legal hold that
-- overrides retention, deletion by a moving cutoff); this applies it to the two
-- email tables. No new ADR: the decision was made, and this is the second set
-- of tables it lands on after `awcms_abac_decision_logs`.
--
-- ## Why `awcms_worker` needs DELETE it did not have
--
-- `sql/022` gave the worker exactly what the DISPATCHER needs — SELECT/UPDATE
-- on messages, INSERT on attempts — and nothing more. That was right: a
-- dispatcher that can DELETE is a dispatcher that can lose a queue to a bug.
-- The purge job is a second worker entrypoint with a different job, so it needs
-- the verb the first one was deliberately denied.
--
-- Granted per table rather than by a blanket `ALTER DEFAULT PRIVILEGES`, so the
-- worker's rights stay a list somebody chose. `scripts/security-readiness.ts`
-- carries the same list in code and `tests/comments-awcms-adaptations.test.ts`
-- pins the two together in both directions.
--
-- ## The index this adds, and the one it does not
--
-- The purge reads `WHERE tenant_id = ? AND status IN (terminal) AND
-- updated_at < ? ORDER BY updated_at ASC`. `awcms_email_messages_dispatch_idx`
-- is the wrong index for it: it covers the OPPOSITE status set
-- (`queued`/`retry_wait`) and is keyed on `next_attempt_at`. So the purge gets
-- its own.
--
-- `awcms_email_delivery_attempts` gets nothing new. Its existing
-- `(tenant_id, attempted_at DESC)` already serves an ascending scan — PostgreSQL
-- reads a btree backwards — and adding an ascending twin would put write
-- amplification on a table that takes one row per delivery attempt to buy
-- nothing. The same reasoning `sql/091` recorded for the decision log.

GRANT DELETE ON awcms_email_messages TO awcms_worker;
GRANT DELETE ON awcms_email_delivery_attempts TO awcms_worker;

CREATE INDEX IF NOT EXISTS awcms_email_messages_retention_idx
  ON awcms_email_messages (tenant_id, status, updated_at);
