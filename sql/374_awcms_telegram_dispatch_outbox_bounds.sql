-- telegram_engagement -- the customer bot dispatcher's role can no longer
-- forge a delivery of another module's event, nor enumerate other modules'
-- events (the #1271 audit, M1, found on `awcms_social_dispatch` and checked
-- here on the role with the same pattern). Forward-only; sql/353 is applied and
-- is NOT edited.
--
-- ## What was wrong
--
-- sql/353 granted `awcms_telegram_engagement_dispatch` an INSERT on
-- `awcms_domain_event_deliveries` bounded only by the delivery row's OWN
-- `event_type` column, plus `SELECT (id, event_sequence)` on every event of the
-- tenant. Run as the role in a rolled-back transaction, that let it read the id
-- and sequence of a `workflow_approval` event and insert a delivery of THAT
-- event to `hr_workforce.attendance_correction_settler`, labelled
-- `awcms.telegram_engagement.consent.changed`: the event-runtime dispatcher
-- joins the delivery to the real event and would have handed a workflow event
-- to an HR consumer on the role's say-so.
--
-- ## The fix
--
-- * No consumer subscribes to `awcms.telegram_engagement.consent.changed`, so
--   `appendDomainEvent` never writes a delivery row for it: the delivery INSERT
--   and SELECT grants and their policy are REMOVED. A consumer declared later
--   fails loudly (permission denied) until a migration grants a delivery
--   INSERT bound to the referenced event's producer and type.
-- * A RESTRICTIVE SELECT policy shows the role only the event its own INSERT
--   writes (`RETURNING id, event_sequence`), never another module's.
--
-- `security:readiness` pins the new policy exactly, no longer expects the
-- removed grants, and its rolled-back probe as the role proves both refusals.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

DROP POLICY IF EXISTS awcms_domain_event_deliveries_tge_dispatch_insert
  ON awcms_domain_event_deliveries;

REVOKE ALL ON awcms_domain_event_deliveries
  FROM awcms_telegram_engagement_dispatch;

DROP POLICY IF EXISTS awcms_domain_events_tge_dispatch_select
  ON awcms_domain_events;

CREATE POLICY awcms_domain_events_tge_dispatch_select
  ON awcms_domain_events
  AS RESTRICTIVE
  FOR SELECT
  TO awcms_telegram_engagement_dispatch
  USING (
    producer_module = 'telegram_engagement'
    AND event_type = 'awcms.telegram_engagement.consent.changed'
  );
