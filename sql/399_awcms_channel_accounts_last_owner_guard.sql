-- `channel_accounts` last-owner guard on assignments (Issue #1215 M-c, ADR-0148).
--
-- With `access_mode = 'assigned'` (sql/398) an account is reachable by its
-- assignees; the one who answers for it is an `owner`. Three database-level
-- rules, for every role, because the application checks (a refusal with a clear
-- code) can be bypassed by a defect and these cannot:
--
--   * An assignment's tenant, account and person never change; only its kind
--     does (the upsert is the one writer).
--   * Demoting the LAST owner of a live `assigned` account is refused. The check
--     takes the account row lock first, so two concurrent demotions of two
--     owners cannot each see "the other one remains".
--   * DELETING the last owner is NOT refused here, on purpose: the same
--     statement is what a data-subject erasure runs (`hard_delete` of the
--     person's assignments), and an erasure must always complete. The API
--     refuses the deletion with `409 LAST_OWNER` before it gets here. What the
--     database does instead is leave a durable trace: when a delete leaves a live
--     `assigned` account with no owner, one `warning` audit row
--     (`channel_accounts.account.owner_orphaned`) is written in the same
--     transaction. The row carries the account id only, never the person. The
--     account itself stays fail-closed: with no assignee it is visible to the
--     tenant administrators alone.
--
-- Pure DDL, no rows written. Every function pins `search_path`.

CREATE OR REPLACE FUNCTION awcms_channel_account_assignments_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_mode text;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.tenant_user_id IS DISTINCT FROM OLD.tenant_user_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'a channel account assignment tenant, account, person and id are immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.kind = 'owner' AND NEW.kind <> 'owner' THEN
    SELECT access_mode INTO v_mode
    FROM awcms_channel_accounts
    WHERE tenant_id = OLD.tenant_id AND id = OLD.account_id
      AND deleted_at IS NULL
    FOR UPDATE;

    IF v_mode = 'assigned' AND NOT EXISTS (
      SELECT 1 FROM awcms_channel_account_assignments AS a
      WHERE a.tenant_id = OLD.tenant_id
        AND a.account_id = OLD.account_id
        AND a.kind = 'owner'
        AND a.id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'the last owner of an assigned channel account cannot be demoted'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_account_assignments_guard
  BEFORE UPDATE ON awcms_channel_account_assignments
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_account_assignments_guard();

CREATE OR REPLACE FUNCTION awcms_channel_account_assignments_orphan_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.kind = 'owner'
     AND EXISTS (
       SELECT 1 FROM awcms_channel_accounts AS acc
       WHERE acc.tenant_id = OLD.tenant_id
         AND acc.id = OLD.account_id
         AND acc.deleted_at IS NULL
         AND acc.access_mode = 'assigned'
     )
     AND NOT EXISTS (
       SELECT 1 FROM awcms_channel_account_assignments AS a
       WHERE a.tenant_id = OLD.tenant_id
         AND a.account_id = OLD.account_id
         AND a.kind = 'owner'
     ) THEN
    INSERT INTO awcms_audit_events
      (tenant_id, module_key, action, resource_type, resource_id, severity,
       message, attributes)
    VALUES
      (OLD.tenant_id, 'channel_accounts',
       'channel_accounts.account.owner_orphaned', 'channel_account',
       OLD.account_id::text, 'warning',
       'An assigned channel account lost its last owner; it is now visible to administrators only.',
       jsonb_build_object('accountId', OLD.account_id));
  END IF;

  RETURN NULL;
END;
$function$;

CREATE TRIGGER awcms_channel_account_assignments_orphan_audit
  AFTER DELETE ON awcms_channel_account_assignments
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_account_assignments_orphan_audit();
