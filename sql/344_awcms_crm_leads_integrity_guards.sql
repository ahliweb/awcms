-- crm_leads -- integrity guards (Issue #1166, ADR-0153).
--
-- Database-level refusals that hold whatever the application does (and
-- whatever a privileged role does: unlike the REVOKEs in sql/342, a trigger
-- also binds the table owner):
--
--   1. a published revision, its stages and its allowed edges are IMMUTABLE
--      (ADR-0153 L2). A stage or an edge may be written only in the
--      transaction that published its revision, so nothing can be added to a
--      revision after it was published either;
--   2. a source touch and an assignment are append-only (L4);
--   3. a transition row is append-only; erasure may null its free-text reason
--      and nothing else (L7);
--   4. a conversion record keeps what was recorded: its reversal is stamped
--      ONCE, and erasure may null its note (L7);
--   5. a merge record keeps what was merged: its rollback is stamped ONCE, and
--      erasure may null its note (L5);
--   6. a lead's denormalised category always equals its stage's category, and
--      a lead's identity (tenant, id, pipeline) never changes;
--   7. a lead is in a `converted` stage if and only if it has a live
--      conversion, and holds an external customer reference only while it has
--      one (deferred, checked at commit).

CREATE OR REPLACE FUNCTION awcms_crm_leads_immutable_row_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only: rows are never changed or removed', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER awcms_crm_pipeline_revisions_immutable
  BEFORE UPDATE OR DELETE ON awcms_crm_pipeline_revisions
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_leads_immutable_row_guard();

CREATE TRIGGER awcms_crm_pipeline_stages_immutable
  BEFORE UPDATE OR DELETE ON awcms_crm_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_leads_immutable_row_guard();

CREATE TRIGGER awcms_crm_pipeline_transitions_immutable
  BEFORE UPDATE OR DELETE ON awcms_crm_pipeline_transitions
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_leads_immutable_row_guard();

CREATE TRIGGER awcms_crm_lead_source_touches_immutable
  BEFORE UPDATE OR DELETE ON awcms_crm_lead_source_touches
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_leads_immutable_row_guard();

CREATE TRIGGER awcms_crm_lead_assignments_immutable
  BEFORE UPDATE OR DELETE ON awcms_crm_lead_assignments
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_leads_immutable_row_guard();

-- (1) A stage or an edge belongs to a revision published IN THIS TRANSACTION.
-- `now()` is the transaction's start instant and `published_at` defaults to
-- it, so equality means "the same transaction".
CREATE OR REPLACE FUNCTION awcms_crm_pipeline_definition_open_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM awcms_crm_pipeline_revisions
    WHERE tenant_id = NEW.tenant_id
      AND id = NEW.revision_id
      AND published_at = now()
  ) THEN
    RAISE EXCEPTION 'a published pipeline revision is immutable; publish a new revision instead'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_crm_pipeline_stages_open_guard
  BEFORE INSERT ON awcms_crm_pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_pipeline_definition_open_guard();

CREATE TRIGGER awcms_crm_pipeline_transitions_open_guard
  BEFORE INSERT ON awcms_crm_pipeline_transitions
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_pipeline_definition_open_guard();

-- (3) Transition history.
CREATE OR REPLACE FUNCTION awcms_crm_lead_transitions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lead transition history is append-only'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.reason IS NOT NULL
     OR (to_jsonb(NEW) - 'reason') IS DISTINCT FROM (to_jsonb(OLD) - 'reason') THEN
    RAISE EXCEPTION 'lead transition history is append-only; only erasure of the reason is allowed'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_crm_lead_transitions_guard
  BEFORE UPDATE OR DELETE ON awcms_crm_lead_transitions
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_lead_transitions_guard();

-- (4) Conversion records.
CREATE OR REPLACE FUNCTION awcms_crm_lead_conversions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  mutable constant text[] := ARRAY[
    'note', 'reversed_at', 'reversal_evidence_ref', 'reversal_occurred_at', 'reversed_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a conversion record is never removed; record its reversal'
      USING ERRCODE = '23514';
  END IF;

  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'a conversion record is immutable; a correction is a reversal'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.note IS NOT NULL AND NEW.note IS DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'a conversion note can only be erased'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.reversed_at IS NOT NULL
     AND (NEW.reversed_at IS DISTINCT FROM OLD.reversed_at
       OR NEW.reversal_evidence_ref IS DISTINCT FROM OLD.reversal_evidence_ref
       OR NEW.reversal_occurred_at IS DISTINCT FROM OLD.reversal_occurred_at
       OR NEW.reversed_by IS DISTINCT FROM OLD.reversed_by) THEN
    RAISE EXCEPTION 'a conversion is reversed once'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_crm_lead_conversions_guard
  BEFORE UPDATE OR DELETE ON awcms_crm_lead_conversions
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_lead_conversions_guard();

-- (5) Merge records.
CREATE OR REPLACE FUNCTION awcms_crm_lead_merges_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  mutable constant text[] := ARRAY['note', 'reverted_at', 'reverted_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a merge record is never removed; roll it back'
      USING ERRCODE = '23514';
  END IF;

  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'a merge record is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.note IS NOT NULL AND NEW.note IS DISTINCT FROM OLD.note THEN
    RAISE EXCEPTION 'a merge note can only be erased'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.reverted_at IS NOT NULL
     AND (NEW.reverted_at IS DISTINCT FROM OLD.reverted_at
       OR NEW.reverted_by IS DISTINCT FROM OLD.reverted_by) THEN
    RAISE EXCEPTION 'a merge is rolled back once'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_crm_lead_merges_guard
  BEFORE UPDATE OR DELETE ON awcms_crm_lead_merges
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_lead_merges_guard();

-- (6) Lead identity and the denormalised category.
CREATE OR REPLACE FUNCTION awcms_crm_leads_stage_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  stage_category_value text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.id IS DISTINCT FROM OLD.id
       OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
    RAISE EXCEPTION 'a lead''s tenant, id, pipeline and creation time are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'anonymized'
     AND (NEW.status IS DISTINCT FROM 'anonymized'
       OR NEW.display_name IS NOT NULL) THEN
    RAISE EXCEPTION 'an anonymised lead stays anonymised'
      USING ERRCODE = '23514';
  END IF;

  SELECT category INTO stage_category_value
  FROM awcms_crm_pipeline_stages
  WHERE tenant_id = NEW.tenant_id
    AND revision_id = NEW.revision_id
    AND stage_key = NEW.stage_key;

  IF stage_category_value IS DISTINCT FROM NEW.stage_category THEN
    RAISE EXCEPTION 'a lead''s stage_category must equal its stage''s category'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_crm_leads_stage_guard
  BEFORE INSERT OR UPDATE ON awcms_crm_leads
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_leads_stage_guard();

-- Contact points: kind, platform and lead never change; an erased value is
-- never written back.
CREATE OR REPLACE FUNCTION awcms_crm_lead_contact_points_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'a contact point is revoked or erased, never removed'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.platform IS DISTINCT FROM OLD.platform
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a contact point''s lead, kind and platform are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.erased_at IS NOT NULL AND (
       NEW.erased_at IS DISTINCT FROM OLD.erased_at
       OR NEW.value_encrypted IS NOT NULL) THEN
    RAISE EXCEPTION 'an erased contact point stays erased'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.erased_at IS NULL AND NEW.erased_at IS NULL AND (
       NEW.value_encrypted IS DISTINCT FROM OLD.value_encrypted
       OR NEW.value_hash IS DISTINCT FROM OLD.value_hash
       OR NEW.value_masked IS DISTINCT FROM OLD.value_masked) THEN
    RAISE EXCEPTION 'a contact point value is never edited; revoke it and add another'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_crm_lead_contact_points_guard
  BEFORE UPDATE OR DELETE ON awcms_crm_lead_contact_points
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_lead_contact_points_guard();

-- (7) Conversion consistency (ADR-0153 N1, L7). A lead is in a `converted`
-- stage IF AND ONLY IF it has a LIVE (unreversed) conversion record, and it
-- carries an `external_customer_ref` only while it has one. Without this a path
-- that moves a lead without going through the conversion code (a stage
-- migration on a new revision was one) could leave a working lead holding a
-- live conversion and a customer reference, after which a new conversion
-- trips the one-live-conversion index.
--
-- DEFERRED constraint triggers on BOTH tables, checked at COMMIT: a conversion
-- writes the conversion row and the lead row in one transaction, in either
-- order, and only the final state has to be consistent.
CREATE OR REPLACE FUNCTION awcms_crm_leads_conversion_consistency_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  target_lead uuid;
  lead_category text;
  lead_customer_ref text;
  has_live_conversion boolean;
BEGIN
  IF TG_TABLE_NAME = 'awcms_crm_leads' THEN
    target_lead := NEW.id;
  ELSE
    target_lead := NEW.lead_id;
  END IF;

  SELECT stage_category, external_customer_ref
    INTO lead_category, lead_customer_ref
  FROM awcms_crm_leads
  WHERE tenant_id = NEW.tenant_id AND id = target_lead;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  has_live_conversion := EXISTS (
    SELECT 1
    FROM awcms_crm_lead_conversions
    WHERE tenant_id = NEW.tenant_id
      AND lead_id = target_lead
      AND reversed_at IS NULL
  );

  IF (lead_category = 'converted') IS DISTINCT FROM has_live_conversion THEN
    RAISE EXCEPTION 'a lead is in a converted stage if and only if it has a live conversion record'
      USING ERRCODE = '23514';
  END IF;

  IF lead_customer_ref IS NOT NULL AND NOT has_live_conversion THEN
    RAISE EXCEPTION 'a lead carries an external customer reference only while it has a live conversion'
      USING ERRCODE = '23514';
  END IF;

  RETURN NULL;
END;
$function$;

CREATE CONSTRAINT TRIGGER awcms_crm_leads_conversion_consistency
  AFTER INSERT OR UPDATE ON awcms_crm_leads
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_leads_conversion_consistency_guard();

CREATE CONSTRAINT TRIGGER awcms_crm_lead_conversions_consistency
  AFTER INSERT OR UPDATE ON awcms_crm_lead_conversions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION awcms_crm_leads_conversion_consistency_guard();
