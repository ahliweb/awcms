-- `whatsapp_delivery` sender routing: hardening from the independent security
-- audit of Issue #1141. Forward-only and additive; `sql/322` is already pushed
-- and its checksum is part of the migration record, so it is NOT edited. Where
-- 322's comments are inaccurate this file says so.
--
-- ## H1: what the dispatcher may read of `awcms_channel_secrets`
--
-- `sql/322` granted `awcms_worker` column-only SELECT on `(id, tenant_id,
-- purpose, ciphertext)` for EVERY purpose. The purpose filter lived only in
-- application code, so a compromised worker process (which chooses the tenant
-- setting RLS trusts) could also read refresh-token, bot-token, webhook-secret,
-- PKCE-verifier and authorisation-code ciphertext. A RESTRICTIVE policy now bounds
-- the rows the worker can SEE to the three purposes a WhatsApp send resolves:
-- `provider_access_token` (an OAuth account's connection), `api_token` and
-- `device_key` (an account's own credential).
--
-- Restrictive policies are ANDed with the existing permissive tenant-isolation
-- policy, which is unchanged, and the policy is `FOR SELECT TO awcms_worker`, so
-- no other role and no other command is affected (the table's tenant-isolation
-- shape is not touched; `sql/310` is the precedent for a role-scoped restrictive
-- policy).
--
-- What it DOES bound: a compromised worker can no longer read the ciphertext of
-- the credentials the dispatcher does not use (the refresh token, which could
-- mint new access tokens; bot tokens; webhook signing secrets; OAuth state).
--
-- What it does NOT bound, stated plainly: the worker still reads the ciphertext of
-- every tenant's access token, API token and device key for whatever tenant it
-- sets, and the job holds the key ring (`CHANNEL_SECRETS_ENCRYPTION_KEYS`) to
-- decrypt them. The associated data of the AES-GCM envelope (purpose, tenant,
-- row) stops a ciphertext being RE-LABELLED or moved; it is NOT a mitigation
-- against a compromised worker, because the grant exposes the very inputs
-- (tenant, row id, purpose) that decryption needs. The comment in `sql/322` that
-- lists "AES-GCM associated data" among the bounds on this risk overstates it.
-- ADR-0148 section 5 accepts the residual risk; the bounds that actually hold are
-- the column-only read-only grant, this purpose limit, the key ring being outside
-- the database and its backups, the job-scoped key grant, and the per-tenant
-- decrypt counter.
CREATE POLICY awcms_channel_secrets_worker_dispatch_purposes
  ON awcms_channel_secrets
  AS RESTRICTIVE
  FOR SELECT
  TO awcms_worker
  USING (purpose IN ('provider_access_token', 'api_token', 'device_key'));

-- ## L2: a sender policy is never deleted
--
-- A policy row is changed in place and its `config_version` only moves forward
-- (`sql/322`). DELETE followed by INSERT would restart the version at 1 and let a
-- recorded `sender_policy_version` name two different configurations. No code path
-- deletes a policy (selecting the deployment sender is `default_sender_account_id
-- = NULL`), and TRUNCATE does not fire row triggers, so test resets are unaffected.
CREATE OR REPLACE FUNCTION awcms_whatsapp_sender_policies_no_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'a WhatsApp sender policy is never deleted: set its default to NULL to select the deployment sender'
    USING ERRCODE = '23514';
END;
$function$;

CREATE TRIGGER awcms_whatsapp_sender_policies_no_delete
  BEFORE DELETE ON awcms_whatsapp_sender_policies
  FOR EACH ROW
  EXECUTE FUNCTION awcms_whatsapp_sender_policies_no_delete();
