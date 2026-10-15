-- #1045 (security audit of #1032, exploit e10). The document status trigger
-- (sql/174) let a submitted document's `approval_status` move `pending` ->
-- `approved|rejected` without looking at the workflow instance it is bound to,
-- and accepted ANY `approval_instance_id` at submit. `finaliseDocument` trusts
-- that column, so the runtime role could mark a document approved while its
-- instance stayed pending and then post inventory.
--
-- The precedent is sql/198 (the HR attendance correction trigger): the domain
-- row follows the engine's verdict, enforced in the database.
--
--   * draft -> submitted: the bound instance exists in the same tenant, names
--     this document (`procurement_document` / the document id), was requested by
--     the submitter, and its status agrees with `approval_status`.
--   * submitted -> submitted (approval_status leaves `pending`): the instance is
--     re-read FOR SHARE and must hold the matching verdict.
--
-- Only the function is replaced; the trigger (sql/174) keeps pointing at it. The
-- function is SECURITY INVOKER, so the instance read goes through the caller's
-- RLS: another tenant's instance is simply invisible. `search_path` is pinned and
-- the table schema-qualified so a pg_temp table cannot shadow the instance table.

CREATE OR REPLACE FUNCTION awcms_procurement_guard_document_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  allowed text[];
  transition text := OLD.status || '->' || NEW.status;
  inst_tenant uuid;
  inst_type text;
  inst_resource text;
  inst_status text;
  inst_requester uuid;
BEGIN
  allowed := CASE transition
    WHEN 'draft->draft' THEN ARRAY[
      'supplier_id', 'supplier_code_snapshot', 'supplier_name_snapshot',
      'location_id', 'source_location_id', 'external_reference',
      'document_date', 'notes', 'currency_code', 'total_cost', 'line_count',
      'updated_at', 'updated_by']
    WHEN 'draft->submitted' THEN ARRAY[
      'status', 'total_cost', 'line_count', 'approval_status',
      'approval_instance_id', 'submitted_at', 'submitted_by',
      'updated_at', 'updated_by']
    WHEN 'draft->cancelled' THEN ARRAY[
      'status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
      'updated_at', 'updated_by']
    WHEN 'submitted->submitted' THEN ARRAY[
      'approval_status', 'updated_at', 'updated_by']
    WHEN 'submitted->finalised' THEN ARRAY[
      'status', 'finalised_at', 'finalised_by', 'updated_at', 'updated_by']
    WHEN 'submitted->cancelled' THEN ARRAY[
      'status', 'cancelled_at', 'cancelled_by', 'cancel_reason',
      'updated_at', 'updated_by']
    WHEN 'finalised->reversed' THEN ARRAY[
      'status', 'reversed_at', 'reversed_by', 'reverse_reason',
      'updated_at', 'updated_by']
    ELSE NULL
  END;

  IF allowed IS NULL THEN
    RAISE EXCEPTION
      'awcms_procurement: illegal document transition % for document %',
      transition, OLD.id
      USING ERRCODE = '55000';
  END IF;

  -- The approval decision is a one-way door (audit M4): a submitted document's
  -- approval may only move pending -> approved|rejected, and the workflow
  -- instance it points at is fixed at submit — never re-pointed, never cleared.
  -- (`approval_instance_id` is in no allowed set after submit, so the
  -- byte-identical check below already holds it; `finalised` additionally
  -- needs the CHECK above.)
  IF transition = 'submitted->submitted'
     AND NOT (OLD.approval_status = 'pending'
              AND NEW.approval_status IN ('approved', 'rejected')) THEN
    RAISE EXCEPTION
      'awcms_procurement: approval may only move pending -> approved|rejected (document %)',
      OLD.id
      USING ERRCODE = '55000';
  END IF;

  -- The approval verdict belongs to the workflow engine, never to a writer
  -- (#1045). Without these checks the runtime role could bind ANY instance id at
  -- submit and then flip `pending` -> `approved` with the instance still pending.
  --
  -- At submit the bound instance must be this tenant's, name THIS document, have
  -- been requested by the submitter, and agree with the approval status being
  -- recorded: `pending` for a normal submit, or the settled verdict when the
  -- workflow finished at start (a graph with no human step).
  IF transition = 'draft->submitted' THEN
    IF NEW.approval_status = 'not_required' THEN
      IF NEW.approval_instance_id IS NOT NULL THEN
        RAISE EXCEPTION
          'awcms_procurement: PROCUREMENT_APPROVAL_BAD_WORKFLOW (document %): an unrequired approval binds no instance',
          OLD.id
          USING ERRCODE = '23514';
      END IF;
    ELSE
      SELECT i.tenant_id, i.resource_type, i.resource_id, i.status,
             i.requested_by_tenant_user_id
        INTO inst_tenant, inst_type, inst_resource, inst_status, inst_requester
        FROM public.awcms_workflow_instances i
       WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.approval_instance_id
       FOR SHARE;

      IF inst_tenant IS DISTINCT FROM NEW.tenant_id
         OR inst_type IS DISTINCT FROM 'procurement_document'
         OR inst_resource IS DISTINCT FROM NEW.id::text
         OR inst_requester IS DISTINCT FROM NEW.submitted_by
         OR inst_status IS DISTINCT FROM (CASE NEW.approval_status
              WHEN 'pending' THEN 'pending'
              WHEN 'approved' THEN 'approved'
              WHEN 'rejected' THEN 'rejected'
            END) THEN
        RAISE EXCEPTION
          'awcms_procurement: PROCUREMENT_APPROVAL_BAD_WORKFLOW (document %)',
          OLD.id
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  -- A settled verdict must be the instance's own. `rejected` also accepts a
  -- `cancelled` instance: the application records a cancelled request as a
  -- rejection (it is never an approval), and refusing it would strand the row.
  IF transition = 'submitted->submitted' THEN
    SELECT i.status INTO inst_status
      FROM public.awcms_workflow_instances i
     WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.approval_instance_id
     FOR SHARE;

    IF NOT (
      (NEW.approval_status = 'approved' AND inst_status = 'approved')
      OR (NEW.approval_status = 'rejected'
          AND inst_status IN ('rejected', 'cancelled'))
    ) THEN
      RAISE EXCEPTION
        'awcms_procurement: PROCUREMENT_APPROVAL_VERDICT_MISMATCH (document %)',
        OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
    RAISE EXCEPTION
      'awcms_procurement: transition % may not change any column outside its allowed set (document %)',
      transition, OLD.id
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;
