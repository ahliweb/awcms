-- `email` - the worker's UPDATE on the outbound queue narrowed from the whole
-- table to the columns the dispatcher writes (Issue ahliweb/awcms#1364).
-- Forward-only: `sql/022` is applied and is NOT edited.
--
-- ## The gap
--
-- `sql/022` gave `awcms_worker` a TABLE-level UPDATE on `awcms_email_messages`.
-- The worker-insert guard (`sql/302`, `sql/371`, `sql/410`) is BEFORE INSERT
-- only, so the category allow-list and the staff-recipient rule that bound what
-- the worker may QUEUE did not bind what it may later REWRITE: a compromised
-- worker could change the `category`, `to_address` (and its hash / mask),
-- `subject`, `variables` or `template_key` of a queued row, and the message
-- would go out to a recipient, under a category, that no guard ever saw.
--
-- ## The fix: a COLUMN grant
--
-- UPDATE is revoked table-wide and re-granted on exactly the columns found by
-- reading every `UPDATE awcms_email_messages` CALL SITE that runs as the worker
-- (`email-dispatch.ts`: claim, sender-lane claim, hold-budget expiry,
-- finalize sent / suppressed / deferred / retry / failed):
--
--   status, next_attempt_at   claim, lease, release, retry schedule
--   retry_count, last_error   retry bookkeeping and the failure text
--   sent_at                   finalize sent
--   provider_name,
--   provider_message_id       finalize sent
--
-- `updated_at` is deliberately NOT granted: no worker statement sets it (the
-- table has no trigger that does), so granting it would be an unused privilege.
-- Every other call site (`cancelEmailMessage`, the provider-event reconciler)
-- runs as `awcms_app`, and the retention purge only DELETEs.
-- `SELECT` stays table-wide (the claim's `RETURNING`, the guard trigger, the
-- `WHERE` clauses), and so does `DELETE` (`sql/095`).
--
-- What the worker STILL can do, and why that is accepted: set `status`,
-- `next_attempt_at`, `retry_count`, `last_error` and the provider columns of a
-- row of its own tenant (FORCE'd RLS). That is the dispatcher's job; a worker
-- lying about delivery outcomes is a compromise no column grant can bound.
-- What it can no longer do is change WHO a queued message goes to, WHAT it
-- says, or WHICH category and sender it is filed under. The sender snapshot
-- and purpose stay immutable for every role (`sql/346`).
--
-- A REVOKE only removes a privilege granted BY THE SAME GRANTOR (sql/304):
-- `security:readiness` asks the catalog afterwards and fails the deploy if this
-- was a no-op, and pins the column list in `WORKER_COLUMN_GRANTS`.
--
-- No rows are written. The migration runner wraps the file in a transaction.

REVOKE UPDATE ON awcms_email_messages FROM awcms_worker;

GRANT UPDATE (
  status, next_attempt_at, retry_count, last_error, sent_at,
  provider_name, provider_message_id
) ON awcms_email_messages TO awcms_worker;
