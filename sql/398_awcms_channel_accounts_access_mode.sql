-- `channel_accounts` explicit access mode (Issue #1215 M-c, ADR-0148; owner
-- decision of 11 November 2026).
--
-- The visibility rule used to be inferred from the ABSENCE of rows: an account
-- with no assignee was open to every holder of the permission, so removing the
-- last assignee (or erasing the person who was it) silently opened a sender
-- identity to the whole tenant. The mode is now a column, and its default is the
-- closed one:
--
--   assigned     (default) only the account's assignees, and the holders of
--                `channel_accounts.assignments.assign` (the tenant
--                administrator), see and operate it. An assigned account with
--                no assignee is visible to administrators only: it never falls
--                open.
--   tenant_wide  the permission alone decides (the old "no assignee" behaviour),
--                chosen on purpose by an administrator through
--                `PUT /api/v1/channel-accounts/accounts/{id}/access-mode`, which
--                is audited at `warning`.
--
-- Every row that exists when this migration runs becomes `assigned` (the column
-- default), including accounts that used to be open because nobody was assigned:
-- fail-closed, and the module has shipped OFF (`CHANNEL_ACCOUNTS_ENABLED`), so
-- no live tenant depends on the old behaviour.
--
-- Also here, because it is the same table and the same defence:
--
--   * the account's business scope is now IMMUTABLE for every role (a scope
--     bound to a connection is a containment fact the binding rule checked once;
--     rewriting it afterwards would defeat that check);
--   * switching an account to `assigned` requires an `owner` assignment to exist
--     already, so a switch cannot create an account nobody but an administrator
--     can reach.
--
-- Forward-only; no row is rewritten.

ALTER TABLE awcms_channel_accounts
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'assigned';

ALTER TABLE awcms_channel_accounts
  ADD CONSTRAINT awcms_channel_accounts_access_mode_check
  CHECK (access_mode IN ('assigned', 'tenant_wide'));

COMMENT ON COLUMN awcms_channel_accounts.access_mode IS
  'Issue #1215 M-c — who may see and operate the account. assigned (default, fail-closed): its assignees and the holders of channel_accounts.assignments.assign. tenant_wide: the permission alone decides, set explicitly and audited.';

-- Same function as sql/320 plus the business scope.
CREATE OR REPLACE FUNCTION awcms_channel_accounts_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.account_kind IS DISTINCT FROM OLD.account_kind
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
     OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'a channel account identity (tenant, provider, kind, external id) is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.business_scope_type IS DISTINCT FROM OLD.business_scope_type
     OR NEW.business_scope_id IS DISTINCT FROM OLD.business_scope_id THEN
    RAISE EXCEPTION 'a channel account business scope is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'a deleted channel account is terminal'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION awcms_channel_accounts_access_mode_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.access_mode = 'assigned'
     AND OLD.access_mode IS DISTINCT FROM 'assigned'
     AND NOT EXISTS (
       SELECT 1 FROM awcms_channel_account_assignments AS a
       WHERE a.tenant_id = NEW.tenant_id
         AND a.account_id = NEW.id
         AND a.kind = 'owner'
     ) THEN
    RAISE EXCEPTION 'an account can only become assigned when it has an owner'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_accounts_access_mode_guard
  BEFORE UPDATE OF access_mode ON awcms_channel_accounts
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_accounts_access_mode_guard();
