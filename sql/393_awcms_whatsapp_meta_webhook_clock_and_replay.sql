-- `whatsapp_delivery` Meta webhook ledgers - the database clock, and tenant-wide
-- replay suppression (Issue #1298, findings L2 and L4 of the independent audit
-- of #1267). Forward-only: `sql/318` and `sql/365` are applied and are NOT edited.
--
-- ## L4: the database clock, for every role
--
-- `awcms_whatsapp_webhook_receipts.received_at` is the stamp the worker's purge
-- floor rests on (`awcms_whatsapp_webhook_receipts_worker_purge_only`, 8 days),
-- and it defaulted to `now()` while `awcms_app` could write it. Unlike `sql/379`,
-- where a trigger forces the database clock and no role can make a fresh row
-- look old, a role that could write the column could also move it. Now:
--
--   * a BEFORE INSERT trigger stamps `received_at := now()` whatever the
--     statement says (every role, including the owner: the readiness probe and
--     the tests that need an AGED receipt insert one and then UPDATE it as the
--     owner, which no runtime role can do);
--   * `awcms_app` loses UPDATE and DELETE on the table (it only ever INSERTs a
--     receipt; the purge is the worker's, under the restrictive floor), so
--     nothing at runtime can move the stamp or delete a receipt to reopen a
--     replay gap. The worker never held UPDATE.
--
-- `awcms_whatsapp_service_windows.last_inbound_at` is different on purpose: it is
-- the time the PROVIDER says a person wrote (a fact about the world, clamped to
-- the webhook's arrival by the parser), not a stamp of ours, so the database
-- clock cannot replace it. What the database CAN refuse is a future value: a
-- BEFORE INSERT OR UPDATE trigger caps it at `now()` for every role, so a window
-- can never be stretched past the moment the row is written, whatever the
-- application computed. `awcms_app` loses DELETE (closing a window early is the
-- purge's job; erasing an open one is nobody's), keeping INSERT and UPDATE for
-- the upsert. A window only ever moves later in the application's SQL
-- (GREATEST), so the trigger does not add a forward-only rule: the owner and the
-- tests must still be able to age a row.
--
-- ## L2: replay suppression
--
-- `replay_window_seconds` (`sql/318`, written as 300 by the Meta subscription
-- directory) is NOT read by the Meta path, on purpose, and is not removed: it is
-- the signed-timestamp tolerance of providers whose signature covers a
-- timestamp, and Meta's `X-Hub-Signature-256` is an HMAC of the body alone, with
-- no timestamp to bound. The replay controls of this path are, instead:
--
--   1. the body hash, now recorded and looked up PER TENANT rather than per
--      subscription, so a token rotation (new subscription, same app secret)
--      does not reopen a captured body (`awcms_whatsapp_webhook_receipts_
--      tenant_payload_idx` below makes that lookup an index probe);
--   2. an `entry.time` horizon of seven days for the three WABA-level
--      changes (template status, messaging limit, restriction), below the
--      eight-day receipt retention, so a body whose receipt was purged cannot
--      apply either (code: `META_ENTRY_MAX_AGE_MS`); a missing time is refused,
--      not defaulted to "now";
--   3. the forward-only and ordering rules that already bound everything else
--      (delivery status by rank, template and restriction by event time).
--
-- The column comment below records that, so the next reader does not mistake an
-- unread column for an unfinished control.
--
-- The migration runner wraps the file in a transaction. No rows are written.

-- ---------------------------------------------------------------------------
-- Receipts: lookup by (tenant, body hash) across subscriptions, and the clock.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS awcms_whatsapp_webhook_receipts_tenant_payload_idx
  ON awcms_whatsapp_webhook_receipts (tenant_id, payload_sha256);

CREATE OR REPLACE FUNCTION awcms_whatsapp_webhook_receipts_clock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.received_at := now();

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_whatsapp_webhook_receipts_clock
  ON awcms_whatsapp_webhook_receipts;

CREATE TRIGGER awcms_whatsapp_webhook_receipts_clock
  BEFORE INSERT ON awcms_whatsapp_webhook_receipts
  FOR EACH ROW
  EXECUTE FUNCTION awcms_whatsapp_webhook_receipts_clock();

REVOKE UPDATE, DELETE ON awcms_whatsapp_webhook_receipts FROM awcms_app;

-- ---------------------------------------------------------------------------
-- Service windows: never later than the write, and no runtime DELETE.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION awcms_whatsapp_service_windows_clock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.last_inbound_at := LEAST(NEW.last_inbound_at, now());

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS awcms_whatsapp_service_windows_clock
  ON awcms_whatsapp_service_windows;

CREATE TRIGGER awcms_whatsapp_service_windows_clock
  BEFORE INSERT OR UPDATE ON awcms_whatsapp_service_windows
  FOR EACH ROW
  EXECUTE FUNCTION awcms_whatsapp_service_windows_clock();

REVOKE DELETE ON awcms_whatsapp_service_windows FROM awcms_app;

COMMENT ON COLUMN awcms_channel_webhook_subscriptions.replay_window_seconds IS
  'Signed-timestamp tolerance for providers whose signature covers a timestamp. NOT read for whatsapp_cloud (Issue #1298 L2): Meta''s X-Hub-Signature-256 is an HMAC of the body alone. Meta replay is bounded by the per-tenant body-hash receipts (8 days), the entry.time horizon of 7 days for WABA-level changes, and the forward-only ordering rules.';
