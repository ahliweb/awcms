-- `whatsapp_delivery` - the dispatcher's write access to the queue, narrowed to
-- the COLUMNS it writes and to the VALUES it writes (Issue #1298, finding L3 of
-- the independent audit of #1267). Forward-only: `sql/178` and `sql/365` are
-- applied and are NOT edited.
--
-- ## The gap
--
-- `sql/178` gave `awcms_worker` a TABLE-level UPDATE on `awcms_whatsapp_messages`.
-- `sql/365` then added `provider_status`, `provider_status_rank`,
-- `provider_status_at` and `provider_failure_code`, which a SIGNED Meta webhook
-- resolved to the row's own sender writes (as `awcms_app`), and which the
-- dispatcher never writes. The table-level grant silently covered them: a
-- compromised dispatcher could mark a message `read` or `failed` (forward-only
-- by the sender guard, but a forged "read" is still a forged fact). It could
-- equally rewrite `recipient`, `template_key`, `purpose` or `sender_account_id`
-- of a queued row, the identity snapshot aside (that one is guarded for every
-- role).
--
-- ## The fix, in two layers (audit lesson 12: a column grant says WHICH columns,
-- not WHAT values)
--
--   1. COLUMN grant. The worker keeps SELECT, INSERT (the booking reminder job
--      enqueues through the port as the worker) and DELETE (the purge), and its
--      UPDATE is revoked table-wide and re-granted on exactly the columns the
--      dispatcher and the expiry sweep write. Found by reading every
--      `UPDATE awcms_whatsapp_messages` CALL SITE (not the definitions):
--
--        claim            status, next_attempt_at, retry_count, updated_at
--        lease / retry    status, next_attempt_at, retry_count, failure_code,
--                         last_error, updated_at
--        finalise sent    status, sent_at, next_attempt_at, updated_at,
--                         provider_name, provider_message_id, body, variables
--        finalise failed  status, retry_count, next_attempt_at, failure_code,
--                         last_error, updated_at, body, variables
--        expiry sweep     status, next_attempt_at, failure_code, last_error,
--                         body, variables, updated_at
--
--        cancel by       status, next_attempt_at, failure_code, body,
--        correlation     variables, updated_at (`cancelWhatsappByCorrelation`,
--                        reached through `WhatsappDeliveryPort.cancelByCorrelation`
--                        by the booking reminder job, which runs as the worker:
--                        found by the booking integration suite, not by reading)
--
--      Every other call site (`cancelWhatsappMessage`,
--      `cancelWaitingMessagesForRecipient`, and the webhook's provider-status
--      write) runs as `awcms_app`.
--
--   2. VALUE guard. A BEFORE UPDATE trigger that applies ONLY to the worker
--      (`current_user = 'awcms_worker'`; every other role is untouched) and
--      allows exactly the transitions the code makes:
--
--        queued | retry_wait -> sending          (claim)
--        sending             -> retry_wait | sent | failed
--        queued | retry_wait | sending -> cancelled (dispatch-time policy
--                                           outcome, or a cancel by correlation)
--        queued | retry_wait | sending -> expired (expiry sweep)
--        a terminal row (sent, failed, expired, cancelled) never changes
--
--      `body` and `variables` may only be CLEARED (to '' and '{}'), and only on a
--      row that `contains_secret` (the OTP purge); `provider_name`,
--      `provider_message_id` and `sent_at` change only in the `sending -> sent`
--      transition; `retry_count` never goes down. So a compromised dispatcher
--      cannot resurrect a cancelled message, mark a queued one `sent` without
--      ever claiming it, fabricate a provider message id on a terminal row, or
--      read back a secret it replaced.
--
-- What it STILL can do, and why that is accepted: write `failure_code` and
-- `last_error` text on a row it holds under a live lease, and fail or retry any
-- row it has claimed. That is the dispatcher's job; a worker that is lying about
-- delivery outcomes is a compromise that no column grant can bound, and the
-- sender-snapshot guard of `sql/365` plus the per-attempt ledger keep the
-- evidence of which sender it used.
--
-- A REVOKE only removes a privilege granted BY THE SAME GRANTOR (sql/304):
-- `security:readiness` asks `has_table_privilege` afterwards and fails the
-- deploy if this was a no-op, and pins the grant in `WORKER_COLUMN_GRANTS`.
--
-- No rows are written. The migration runner wraps the file in a transaction.

REVOKE UPDATE ON awcms_whatsapp_messages FROM awcms_worker;

GRANT UPDATE (
  status, next_attempt_at, retry_count, updated_at, sent_at,
  provider_name, provider_message_id, body, variables,
  failure_code, last_error
) ON awcms_whatsapp_messages TO awcms_worker;

CREATE OR REPLACE FUNCTION awcms_whatsapp_messages_worker_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user <> 'awcms_worker' THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('sent', 'failed', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'the WhatsApp dispatcher does not change a terminal message'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (NEW.status = 'sending' AND OLD.status IN ('queued', 'retry_wait'))
    OR (NEW.status IN ('retry_wait', 'sent', 'failed')
        AND OLD.status = 'sending')
    OR (NEW.status = 'cancelled'
        AND OLD.status IN ('queued', 'retry_wait', 'sending'))
    OR (NEW.status = 'expired'
        AND OLD.status IN ('queued', 'retry_wait', 'sending'))
  ) THEN
    RAISE EXCEPTION 'the WhatsApp dispatcher made a status change the queue does not allow'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.body IS DISTINCT FROM OLD.body
     AND NOT (NEW.body = '' AND OLD.contains_secret) THEN
    RAISE EXCEPTION 'the WhatsApp dispatcher may only clear the body of a secret message'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.variables IS DISTINCT FROM OLD.variables
     AND NOT (NEW.variables = '{}'::jsonb AND OLD.contains_secret) THEN
    RAISE EXCEPTION 'the WhatsApp dispatcher may only clear the variables of a secret message'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW.provider_name IS DISTINCT FROM OLD.provider_name
      OR NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id
      OR NEW.sent_at IS DISTINCT FROM OLD.sent_at)
     AND NOT (NEW.status = 'sent' AND OLD.status = 'sending') THEN
    RAISE EXCEPTION 'the WhatsApp dispatcher records a provider acceptance only when it marks a message sent'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.retry_count < OLD.retry_count THEN
    RAISE EXCEPTION 'the WhatsApp retry count never goes down'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_whatsapp_messages_worker_guard
  ON awcms_whatsapp_messages;

CREATE TRIGGER awcms_whatsapp_messages_worker_guard
  BEFORE UPDATE ON awcms_whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION awcms_whatsapp_messages_worker_guard();

COMMENT ON FUNCTION awcms_whatsapp_messages_worker_guard() IS
  'Issue #1298 (L3) - for awcms_worker ONLY: allows exactly the status transitions, body/variables clearing and provider acceptance writes the dispatcher and the expiry sweep make; a terminal message never changes. Pinned exactly by security:readiness.';
