-- OMES contract re-vendor fix (ADR-0122, issue ahliweb/omes#221, applied to
-- this repo alongside ahliweb/omes#232's contract re-vendor).
--
-- `worker-result.request.schema.json` v1 was amended in place (not cut as
-- v2) to remove its `job_id` property entirely -- see that schema's own
-- top-level `description` for the full rationale: nothing in this contract
-- set ever gave the worker a server-known job id to echo back, so the field
-- was in practice a client-invented opaque string this repo could never
-- validate. `additionalProperties: false` on that schema now means a
-- request that still carries `job_id` is REJECTED at the contract-validation
-- step, before `ingestWorkerResult` (application/worker-result-ingestion.ts)
-- is ever called -- so this column can no longer be populated from the wire.
--
-- `worker_job_id` stays as a column (never dropped -- it may still hold
-- historical values from before this change, and it costs nothing to keep
-- for that provenance), but a NEW row can no longer supply one, so the
-- NOT NULL constraint sql/159 gave it must be relaxed.
ALTER TABLE awcms_omes_worker_results
  ALTER COLUMN worker_job_id DROP NOT NULL;
