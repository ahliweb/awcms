-- `hr_workforce` attendance corrections (#998 audit L1): `decided_by` names who
-- DECIDED, never who settled.
--
-- `sql/198` required `decided_by` on every non-pending correction, so settling a
-- `rejected` / `withdrawn` correction whose workflow instance names no decider
-- (a graph that rejects without a human decision; a cancel with no recorded
-- canceller) had to invent one, and the code used the settling user. That
-- recorded a requester as having rejected their own correction. The column is
-- now NULL in exactly that case; who settled it is on the `settled` audit row
-- (actor, or `trigger = workflow_event`).
--
-- An `approved` correction still must name its approver: the guard trigger and
-- the segregation-of-duties CHECK of `sql/198` are unchanged. `decided_at` stays
-- mandatory once settled.

BEGIN;

ALTER TABLE awcms_hr_attendance_corrections
  DROP CONSTRAINT IF EXISTS awcms_hr_attendance_corrections_lifecycle_check;
ALTER TABLE awcms_hr_attendance_corrections
  ADD CONSTRAINT awcms_hr_attendance_corrections_lifecycle_check
    CHECK (
      (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
      OR (status = 'approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
      OR (status IN ('rejected', 'withdrawn') AND decided_at IS NOT NULL)
    );

COMMIT;
