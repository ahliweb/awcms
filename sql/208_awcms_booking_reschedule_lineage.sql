-- `booking` reschedule lineage (Issue #941, ADR-0131; booking.md section 5.3).
--
-- A reschedule is ONE transaction that supersedes the old reservation and creates
-- its replacement:
--
--   old   confirmed -> rescheduled   (superseded_by_id = the replacement)
--   new   inserted confirmed         (rescheduled_from_id = the old one, same lineage)
--
-- Each row names the other through a composite foreign key, and the two cannot
-- both exist first. Marking the old one `rescheduled` needs the replacement to
-- be there (the immediate `superseded_by_id` foreign key of `sql/180`); inserting
-- the replacement first would collide with the old one on the natural-key
-- backstop `awcms_booking_reservations_external_ref_key` whenever an adapter's
-- `external_ref` moves to it (booking.md section 5.3: "the adapter's external_ref
-- moves to the new reservation"), because the old row is still `confirmed` and the
-- unique index covers live statuses.
--
-- The way out that changes the fewest guarantees is to let the ONE reference be
-- checked at COMMIT: the old row is superseded first (so it leaves the live set
-- of the partial unique index), then the replacement is inserted under the id
-- the old row already names. The foreign key is still enforced, for every
-- transaction, at the latest at commit; it is not dropped, not weakened to a
-- trigger and not made NOT VALID. What is lost is only that a statement in the
-- middle of the reschedule transaction can see `superseded_by_id` pointing at a
-- row that does not exist yet. A transaction that never inserts the replacement
-- fails at COMMIT with the same 23503 it failed with before.
--
-- `rescheduled_from_id` (replacement -> old) stays immediate: the old row exists
-- first in every ordering, so there is nothing to defer.
--
-- Idempotent: ALTER CONSTRAINT ... DEFERRABLE can be repeated.

BEGIN;

ALTER TABLE awcms_booking_reservations
  ALTER CONSTRAINT awcms_booking_reservations_superseded_by_fkey
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT awcms_booking_reservations_superseded_by_fkey
  ON awcms_booking_reservations IS
  'Issue #941 / ADR-0131. DEFERRABLE INITIALLY DEFERRED so a reschedule can supersede the old reservation (leaving the live set of the external-ref unique index) before the replacement it names is inserted, in one transaction; still enforced at commit.';

COMMIT;
