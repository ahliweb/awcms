-- `booking` reminder and confirmation intents (Issue #943, ADR-0131, ADR-0133
-- sections 3 and 8; epic ahliweb/awcms-one#280 item 17).
--
-- ## What this table is
--
-- The booking module's own record that "a confirmation (or a reminder) is owed
-- for this reservation", and what became of that debt. It is NOT a queue and it
-- is NOT a second outbox: the message itself is enqueued into the ONE WhatsApp
-- queue of `whatsapp_delivery` (ADR-0133 section 3, "one queue per channel per
-- deployment") through the `WhatsappDeliveryPort`. This table exists so that the
-- debt is created exactly once per `(reservation, kind, occurrence)` -- the
-- unique key below -- no matter how often, or from how many workers, the
-- scheduled job runs, and so that a cancelled reservation can be shown to have
-- emitted nothing.
--
-- ## What it deliberately does not hold
--
-- No recipient, no phone number, no name, no message body, no variables and no
-- channel credential. `message_id` is the opaque id of the row in the delivery
-- module's queue (no foreign key: the delivery module is optional and booking
-- does not depend on its tables, ADR-0011); the delivery status is read back by
-- correlation id and never copied here, so it cannot drift. The customer is
-- still only the opaque `external_customer_ref` on the reservation, handed to a
-- recipient resolver at dispatch time and never stored here.
--
-- ## Who writes it
--
-- Nothing on the request path. The scheduled job `booking:reminders:dispatch`
-- (as `awcms_worker`) creates the intents through the narrow SECURITY DEFINER
-- function of `sql/285` and settles them with a plain UPDATE (the worker holds
-- SELECT and UPDATE here, and nothing on the reservation tables). The runtime
-- role may only read. No row is ever deleted: an intent is settled
-- (`enqueued`, `suppressed`, `refused`, `skipped`, `cancelled`, `expired`).
--
-- Applied migrations are immutable; this file is new.

BEGIN;

CREATE TABLE IF NOT EXISTS awcms_booking_reminder_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  reservation_id uuid NOT NULL,
  -- `confirmation` is sent once, soon after the reservation is confirmed
  -- (occurrence 0). `reminder` is sent ahead of the start; `occurrence`
  -- numbers the leads, so a second reminder is a new row, not a re-send.
  kind text NOT NULL,
  occurrence smallint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  -- A short lower-case code for HOW it settled (`opt_out`, `consent_required`,
  -- `no_customer_ref`, ...). Never free text, never a number or a name.
  outcome_code text,
  -- The delivery module's queue row, opaque. NULL until `enqueued`.
  message_id uuid,
  -- Transient refusals (rate limit) retry on the next pass; this bounds them.
  attempts integer NOT NULL DEFAULT 0,
  -- When the intent becomes sendable (a reminder: start minus lead).
  due_at timestamptz NOT NULL,
  settled_at timestamptz,
  -- Set once the cancellation sweep has looked at an `enqueued` intent whose
  -- reservation is no longer confirmed, so it is not looked at again.
  reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_booking_reminder_intents_tenant_id_key
    UNIQUE (tenant_id, id),
  -- The idempotency guarantee: one intent per reservation, kind and occurrence.
  CONSTRAINT awcms_booking_reminder_intents_unique_key
    UNIQUE (tenant_id, reservation_id, kind, occurrence),
  CONSTRAINT awcms_booking_reminder_intents_reservation_fkey
    FOREIGN KEY (tenant_id, reservation_id)
    REFERENCES awcms_booking_reservations (tenant_id, id),
  CONSTRAINT awcms_booking_reminder_intents_kind_check
    CHECK (kind IN ('confirmation', 'reminder')),
  CONSTRAINT awcms_booking_reminder_intents_occurrence_check
    CHECK (occurrence BETWEEN 0 AND 9
           AND ((kind = 'confirmation') = (occurrence = 0))),
  CONSTRAINT awcms_booking_reminder_intents_status_check
    CHECK (status IN ('pending', 'enqueued', 'suppressed', 'refused',
                      'skipped', 'cancelled', 'expired')),
  CONSTRAINT awcms_booking_reminder_intents_outcome_check
    CHECK (outcome_code IS NULL OR outcome_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT awcms_booking_reminder_intents_attempts_check
    CHECK (attempts BETWEEN 0 AND 1000),
  CONSTRAINT awcms_booking_reminder_intents_settled_check
    CHECK ((status = 'pending') = (settled_at IS NULL)),
  CONSTRAINT awcms_booking_reminder_intents_message_check
    CHECK (message_id IS NULL OR status IN ('enqueued', 'cancelled'))
);

-- The job's scan: pending intents that are due.
CREATE INDEX IF NOT EXISTS awcms_booking_reminder_intents_due_idx
  ON awcms_booking_reminder_intents (tenant_id, due_at)
  WHERE status = 'pending';
-- The cancellation sweep: enqueued intents not yet reconciled.
CREATE INDEX IF NOT EXISTS awcms_booking_reminder_intents_unreconciled_idx
  ON awcms_booking_reminder_intents (tenant_id, created_at)
  WHERE status = 'enqueued' AND reconciled_at IS NULL;
CREATE INDEX IF NOT EXISTS awcms_booking_reminder_intents_reservation_idx
  ON awcms_booking_reminder_intents (tenant_id, reservation_id);

ALTER TABLE awcms_booking_reminder_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_booking_reminder_intents FORCE ROW LEVEL SECURITY;
CREATE POLICY awcms_booking_reminder_intents_tenant_isolation
  ON awcms_booking_reminder_intents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Immutability. Two layers, like the rest of the module (sql/180): a trigger
-- for a role that holds the privilege, and REVOKEs for the one that does not.
CREATE TRIGGER awcms_booking_reminder_intents_no_delete
  BEFORE DELETE ON awcms_booking_reminder_intents
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_reject_mutation();

CREATE OR REPLACE FUNCTION awcms_booking_guard_reminder_intent_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The identity of the debt never changes.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.reservation_id IS DISTINCT FROM OLD.reservation_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.occurrence IS DISTINCT FROM OLD.occurrence
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'awcms_booking: the identity of a reminder intent is immutable (%)', OLD.id
      USING ERRCODE = '55000';
  END IF;

  -- Once settled, the facts of the settlement are frozen: how many attempts it
  -- took, which queue row it became and when. Only the status (enqueued ->
  -- cancelled), the outcome that explains it and the reconciliation stamp move.
  IF OLD.status <> 'pending'
     AND (NEW.attempts IS DISTINCT FROM OLD.attempts
          OR NEW.message_id IS DISTINCT FROM OLD.message_id
          OR NEW.settled_at IS DISTINCT FROM OLD.settled_at) THEN
    RAISE EXCEPTION
      'awcms_booking: a settled reminder intent keeps its attempts, message and settlement time (%)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    -- `pending` settles once; an `enqueued` intent may later be cancelled (the
    -- reservation was cancelled before the message left the queue). Nothing
    -- else moves.
    IF NOT (OLD.status = 'pending' AND NEW.status <> 'pending')
       AND NOT (OLD.status = 'enqueued' AND NEW.status = 'cancelled') THEN
      RAISE EXCEPTION
        'awcms_booking: reminder intent % may not move from % to %',
        OLD.id, OLD.status, NEW.status
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status <> 'pending'
        AND NEW.outcome_code IS DISTINCT FROM OLD.outcome_code THEN
    RAISE EXCEPTION
      'awcms_booking: a settled reminder intent keeps its outcome (%)', OLD.id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER awcms_booking_reminder_intents_update_guard
  BEFORE UPDATE ON awcms_booking_reminder_intents
  FOR EACH ROW EXECUTE FUNCTION awcms_booking_guard_reminder_intent_update();

-- Privileges. The runtime role only reads (a future admin view); the worker
-- reads and settles. Nobody inserts directly: the DEFINER function of sql/285
-- is the one writer of new rows.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON awcms_booking_reminder_intents FROM awcms_app;
-- Column-scoped: the identity of the debt (reservation, kind, occurrence, due
-- time) is not the worker's to write, whatever the guard trigger says.
GRANT SELECT ON awcms_booking_reminder_intents TO awcms_worker;
GRANT UPDATE (status, outcome_code, message_id, settled_at, attempts,
              reconciled_at, updated_at)
  ON awcms_booking_reminder_intents TO awcms_worker;

COMMENT ON TABLE awcms_booking_reminder_intents IS
  'Issue #943 / ADR-0131, ADR-0133 -- one row per (reservation, kind, occurrence): a confirmation or reminder owed. Not a queue: the message goes to whatsapp_delivery through its port. Holds no recipient, name, body or credential; message_id is the delivery queue row, opaque.';

COMMIT;
