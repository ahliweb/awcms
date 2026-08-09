-- Issue #468, ADR-0072 — retention for the domain-event delivery ledger.
--
-- ## A GRANT and an index
--
-- `sql/022` gave the worker SELECT/INSERT/UPDATE — what the DISPATCHER needs.
-- The purge is a second worker entrypoint with a different job, so it gets the
-- verb the first one was deliberately denied.
--
-- The index is needed, unlike `sql/096`'s case. The purge reads `WHERE
-- tenant_id = ? AND status IN ('delivered','skipped') AND updated_at < ? ORDER
-- BY updated_at ASC`, and the closest existing index —
-- `awcms_domain_event_deliveries_tenant_status_idx` — is `(tenant_id, status)`
-- with no time column at all. On a table whose entire problem is that
-- `delivered` rows accumulate, that means reading every delivered row in the
-- tenant to find the old ones.
--
-- Partial, on the two purgeable statuses only: the dispatcher's hot path is
-- `status = 'pending'`, and this index has no reason to carry those rows or to
-- be updated as they churn through it.
--
-- ## What is NOT purged, and why the list is short on purpose
--
-- `dead_letter` rows are excluded. They LOOK terminal — the dispatcher will
-- never retry one on its own — and they are precisely the rows an operator
-- opens the console to find and replay. A retention window that swept them
-- would delete the work AND its evidence, and the deletion would be
-- indistinguishable from the queue having drained cleanly.
--
-- `awcms_domain_events` (the parent, holding the payloads) also stays on
-- `TABLES_PREDATING_THE_RULE` and is deliberately out of scope here. Deleting
-- deliveries does not shrink it, so this migration does not claim to have
-- solved the larger half — the event stream needs its own decision about how
-- long a payload is worth keeping, and that is a different question from how
-- long a delivery RECEIPT is.

GRANT DELETE ON awcms_domain_event_deliveries TO awcms_worker;

CREATE INDEX IF NOT EXISTS awcms_domain_event_deliveries_retention_idx
  ON awcms_domain_event_deliveries (tenant_id, updated_at)
  WHERE status IN ('delivered', 'skipped');
