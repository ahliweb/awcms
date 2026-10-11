-- `hr_commission` phase 2, accrual issue (Issue #951, ADR-0132) — the deferred
-- back-dated-publish rule for commission rules (`sql/182` is immutable once
-- applied, so this is a new migration).
--
-- ## The problem
--
-- A rule is selected by the date the SOURCE EVENT happened, never by `now()`.
-- That is correct for an accrual and dangerous for a publish: publishing a
-- version whose window STARTS IN THE PAST silently changes which rule is
-- "in force" for every event that has already happened but has not been
-- accrued yet (a late-reported sale, a delayed adapter), so a person can be
-- paid under terms that did not exist when the sale was made. Accruals that
-- already exist are untouched (they cite their rule by foreign key and a
-- published version is immutable), which is exactly why the change would
-- otherwise be invisible.
--
-- ## The rule
--
-- A draft whose `effective_from` is earlier than TODAY (UTC date of the
-- transaction) can only become `published` WITH a reason. The database decides
-- what "back-dated" means and records the outcome on the row:
--
--   * `publish_backdated` is stamped by a trigger on the draft -> published
--     move from the window itself, so a client cannot assert it either way;
--   * a back-dated publish without a non-empty `backdated_reason` is refused
--     (55000), and a non-back-dated publish carries no reason;
--   * the pair is immutable afterwards with the rest of the published row (the
--     existing immutability trigger compares `to_jsonb`, so a new column is
--     covered without touching it).
--
-- "Today" is the UTC date. A tenant west of UTC may see a window starting on its
-- own today flagged as back-dated for a few hours: the safe direction.
--
-- The reason is the actor's justification for a commercial term and sits in the
-- same CONFIDENTIAL table as the term; it is never written to an audit row
-- (the audit row carries the boolean only).

ALTER TABLE awcms_hr_commission_rules
  ADD COLUMN IF NOT EXISTS publish_backdated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS backdated_reason text;

ALTER TABLE awcms_hr_commission_rules
  ADD CONSTRAINT awcms_hr_commission_rules_backdated_check
  CHECK (
    (publish_backdated = false AND backdated_reason IS NULL)
    OR (
      publish_backdated = true
      AND status <> 'draft'
      AND backdated_reason IS NOT NULL
      AND char_length(btrim(backdated_reason)) BETWEEN 1 AND 500
    )
  );

CREATE OR REPLACE FUNCTION awcms_hr_commission_rules_backdate_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $awcms_hr_commission_backdate$
DECLARE
  v_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'published' THEN
    IF NEW.effective_from < v_today THEN
      IF NEW.backdated_reason IS NULL
         OR char_length(btrim(NEW.backdated_reason)) = 0 THEN
        RAISE EXCEPTION
          'awcms_hr_commission_rules: a window starting before % needs a back-dated reason (Issue #951)',
          v_today
          USING ERRCODE = '55000';
      END IF;
      NEW.publish_backdated := true;
    ELSE
      NEW.publish_backdated := false;
      NEW.backdated_reason := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$awcms_hr_commission_backdate$;

CREATE TRIGGER awcms_hr_commission_rules_backdate_guard
  BEFORE UPDATE ON awcms_hr_commission_rules
  FOR EACH ROW EXECUTE FUNCTION awcms_hr_commission_rules_backdate_guard();

COMMENT ON COLUMN awcms_hr_commission_rules.publish_backdated IS
  'Issue #951 — stamped by trigger at publish: the window started before the UTC date of the publishing transaction. Cannot be asserted by a client.';
COMMENT ON COLUMN awcms_hr_commission_rules.backdated_reason IS
  'Issue #951 — CONFIDENTIAL. The publisher''s justification for a back-dated window; required exactly when publish_backdated; never written to an audit row.';
