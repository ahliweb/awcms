-- `whatsapp_delivery` - the dispatcher role's INSERT and DELETE on the queue,
-- narrowed to what the code does (Issue #1298, independent audit LOW-1 of the
-- sql/392 change). Forward-only: `sql/392` is applied and is NOT edited.
--
-- ## The gap
--
-- `sql/392` bounded the worker's UPDATE (columns and values), but its INSERT and
-- DELETE on `awcms_whatsapp_messages` stayed unbounded. As `awcms_worker` an
-- INSERT could create a row that never went through the dispatcher's
-- consent/suppression checks (a `queued` row to any recipient with any body), or
-- one carrying the forged facts the UPDATE guard refuses (`status = 'sent'`,
-- `provider_status = 'read'`, a made-up `provider_message_id`); a DELETE could
-- erase a fresh `queued` or `sent` row, i.e. evidence.
--
-- ## The fix
--
--   1. INSERT value guard (BEFORE INSERT, `current_user = 'awcms_worker'` only):
--      the only thing the worker inserts is the booking reminder job's enqueue
--      through the port, which writes a fresh `queued` row. So the row must be
--      `queued`, with no provider acceptance (`provider_name`,
--      `provider_message_id`, `sent_at`), no provider status (NULL, rank 0), no
--      failure text and `retry_count = 0`.
--   2. DELETE floor (RESTRICTIVE policy, worker only): the worker's DELETE is the
--      purge, which removes only TERMINAL rows older than the retention. So the
--      policy allows only a terminal row last touched more than 7 days ago
--      (the purge's default is 30; a retention configured below 7 days is
--      clamped by this floor). A terminal row is frozen against the worker by
--      the `sql/392` UPDATE guard, so the worker cannot age a row by writing
--      `updated_at`: the floor does not rest on a column it can write (audit
--      lesson 5). RESTRICTIVE, so it narrows the tenant-isolation policy and can
--      never widen it.
--
-- Both are pinned exactly by `security:readiness` (and the DELETE floor by a
-- behavioural probe). No rows are written. The runner wraps the file in a
-- transaction.

CREATE OR REPLACE FUNCTION awcms_whatsapp_messages_worker_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF current_user <> 'awcms_worker' THEN
    RETURN NEW;
  END IF;

  IF NEW.status <> 'queued'
     OR NEW.provider_name IS NOT NULL
     OR NEW.provider_message_id IS NOT NULL
     OR NEW.sent_at IS NOT NULL
     OR NEW.provider_status IS NOT NULL
     OR NEW.provider_status_rank <> 0
     OR NEW.failure_code IS NOT NULL
     OR NEW.last_error IS NOT NULL
     OR NEW.retry_count <> 0 THEN
    RAISE EXCEPTION 'the WhatsApp dispatcher role may only enqueue a fresh queued message'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_whatsapp_messages_worker_insert_guard
  ON awcms_whatsapp_messages;

CREATE TRIGGER awcms_whatsapp_messages_worker_insert_guard
  BEFORE INSERT ON awcms_whatsapp_messages
  FOR EACH ROW
  EXECUTE FUNCTION awcms_whatsapp_messages_worker_insert_guard();

COMMENT ON FUNCTION awcms_whatsapp_messages_worker_insert_guard() IS
  'Issue #1298 (audit LOW-1) - for awcms_worker ONLY: an insert must be a fresh queued message with no provider acceptance, provider status, failure text or retries. Pinned exactly by security:readiness.';

CREATE POLICY awcms_whatsapp_messages_worker_purge_only
  ON awcms_whatsapp_messages
  AS RESTRICTIVE
  FOR DELETE
  TO awcms_worker
  USING (
    status IN ('sent', 'failed', 'cancelled', 'expired')
    AND updated_at < now() - interval '7 days'
  );
