-- awcms_setup must not be able to read a credential column (Issue #1082).
--
-- Found by the security review of #1078, which narrowed only `awcms_worker`.
-- `sql/022` gave the setup role `GRANT SELECT, INSERT ON awcms_identities`, a
-- TABLE-level grant, so `password_hash` (and every column added since) was
-- readable by it. An operator can activate `awcms_setup` for LOGIN
-- (`SETUP_DATABASE_URL`), which made it the only LOGIN-capable role besides
-- `awcms_app` that could read a password hash. RLS trusts the session setting
-- `app.current_tenant_id`, which the caller chooses, so anyone able to run SQL as
-- the setup role could read any tenant's hashes. The role has no business
-- reading one: it creates a row, it never verifies a login.
--
-- ## The audit: every statement run as awcms_setup
--
-- `getSetupDatabaseClient()` has ONE caller, `POST /api/v1/setup/initialize`
-- (`src/pages/api/v1/setup/initialize.ts`), which runs `bootstrapPlatformTenant`
-- (`tenant-admin/application/platform-bootstrap.ts`) in one transaction. That is
-- the only flow; the others in the repo (tenant provisioning, setup status, the
-- platform-tenant resolver) run as `awcms_app`. Against `awcms_identities` it
-- issues exactly:
--
--   1. setup wizard, owner creation
--        INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier,
--          password_hash) VALUES (...) RETURNING id
--      INSERT stays table-level (write-only: `password_hash` is written, never
--      read). `RETURNING id` needs SELECT on `id` only.
--   2. setup wizard, principal link (`linkIdentityToPrincipal`, ADR-0086)
--        UPDATE awcms_identities SET principal_id = $1
--        WHERE id = $2 AND principal_id IS NULL
--      reads `id` and `principal_id` (the WHERE) and writes `principal_id`.
--
-- That is the whole read set, hence the grants below:
--   SELECT (id, principal_id)   UPDATE (principal_id)
--
-- ## A pre-existing break this fixes on the way
--
-- ADR-0086 moved the owner's principal link into the wizard, and `sql/112`
-- granted `awcms_principals` to `awcms_app` only. Under `SETUP_DATABASE_URL`
-- the wizard therefore failed with `permission denied for table
-- awcms_principals` (and had no UPDATE on `awcms_identities`), while every check
-- stayed green: the matrix compared the grants with a list that omitted both.
-- Nothing ran the real bootstrap as the setup role. It is now covered by
-- `tests/integration/setup-role-credential-columns.integration.test.ts`.
--
-- ## The principal find-or-create is a SECURITY DEFINER function
--
-- `awcms_setup` gets NO direct privilege on `awcms_principals`. The find-or-create
-- of the owner's principal is `awcms_ensure_principal_id(text) RETURNS uuid`,
-- owned by the NOLOGIN, memberless `awcms_principal_ensure` (INSERT
-- (email_normalized) and SELECT (id, email_normalized) only, never
-- `password_hash`), `SET search_path = public, pg_temp`, EXECUTE revoked from
-- PUBLIC. It is granted to `awcms_setup`, to `awcms_app` and to the role that runs
-- this migration (the DATABASE_URL fallback posture connects as it), and
-- `principal-store.ts` (`ensurePrincipalIdForEmail`) calls it for every caller, so
-- the app's behaviour is identical: same INSERT ... ON CONFLICT DO NOTHING +
-- re-read, same id back.
--
-- ## The link is one-way, for EVERY role (account-takeover guard)
--
-- `UPDATE (principal_id)` on `awcms_identities` would let the setup role re-point
-- an ALREADY-linked identity (in any tenant: the policy trusts the GUC) at an
-- attacker's principal, which is an account takeover. Two layers:
--   (a) a BEFORE UPDATE trigger `awcms_identities_principal_link_once` rejects
--       changing a NON-NULL `principal_id` to anything else, for every role (the
--       app role held the same latent capability). Audited: every writer in
--       `identity-access` (`linkIdentityToPrincipal`, `attachIdentityToPrincipal`)
--       already says `WHERE ... principal_id IS NULL`, and no code path unlinks or
--       repoints, so nothing legitimate is broken.
--   (b) a RESTRICTIVE policy `awcms_identities_setup_link_once` limits the setup
--       role's UPDATE to rows whose `principal_id IS NULL`, and to a result that is
--       NOT NULL (the WITH CHECK is explicit: with a USING-only policy it would be
--       implied, and an implied check is one edit away from being lost).
-- `security:readiness` fails if either is missing.
--
-- ## Deliberately unchanged
--
-- INSERT on the other bootstrap tables, and their SELECT (they hold no
-- credential column). `awcms_setup` still holds nothing on any other credential
-- table; `security:readiness` ("Worker and setup roles cannot read credential
-- columns", critical) now fails if that ever changes.
--
-- Pure DDL, no rows written. A column privilege cannot be revoked from a role
-- that holds it through a table grant, so the table is REVOKEd whole (SELECT
-- only) and re-GRANTed by column. Matching changes in `SETUP_ROLE_GRANTS` /
-- `SETUP_COLUMN_GRANTS` (`scripts/security-readiness.ts`) land with this file.

-- NOTE: a REVOKE only removes a privilege granted BY THE SAME GRANTOR (see
-- sql/304). The security:readiness check asks `has_column_privilege` afterwards
-- and fails the deploy if the revoke was a silent no-op.

-- ===== awcms_identities =====
REVOKE SELECT ON awcms_identities FROM awcms_setup;
GRANT SELECT (id, principal_id) ON awcms_identities TO awcms_setup;
GRANT UPDATE (principal_id) ON awcms_identities TO awcms_setup;

CREATE OR REPLACE FUNCTION awcms_identities_principal_link_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'awcms_identities.principal_id is linked once and never repointed'
    USING ERRCODE = '23000';
END;
$function$;

DROP TRIGGER IF EXISTS awcms_identities_principal_link_once ON awcms_identities;
CREATE TRIGGER awcms_identities_principal_link_once
  BEFORE UPDATE OF principal_id ON awcms_identities
  FOR EACH ROW
  WHEN (OLD.principal_id IS NOT NULL
        AND NEW.principal_id IS DISTINCT FROM OLD.principal_id)
  EXECUTE FUNCTION awcms_identities_principal_link_once();

DROP POLICY IF EXISTS awcms_identities_setup_link_once ON awcms_identities;
CREATE POLICY awcms_identities_setup_link_once
  ON awcms_identities
  AS RESTRICTIVE
  FOR UPDATE
  TO awcms_setup
  USING (principal_id IS NULL)
  WITH CHECK (principal_id IS NOT NULL);

-- ===== awcms_principals: find-or-create through a DEFINER function =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_principal_ensure') THEN
    CREATE ROLE awcms_principal_ensure NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_principal_ensure;
GRANT INSERT (email_normalized) ON awcms_principals TO awcms_principal_ensure;
GRANT SELECT (id, email_normalized) ON awcms_principals TO awcms_principal_ensure;

CREATE OR REPLACE FUNCTION awcms_ensure_principal_id(p_email_normalized text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO awcms_principals (email_normalized)
  VALUES (p_email_normalized)
  ON CONFLICT (email_normalized) DO NOTHING;

  SELECT id INTO v_id FROM awcms_principals
  WHERE email_normalized = p_email_normalized;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'principal missing immediately after an idempotent insert';
  END IF;

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION awcms_ensure_principal_id(text) IS
  'Find-or-create the principal for an already-normalized address and return ONLY its id (never password_hash). Lets the setup wizard link the owner without any direct privilege on awcms_principals. EXECUTE: awcms_setup, awcms_app and the migration role.';

REVOKE ALL ON FUNCTION awcms_ensure_principal_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_ensure_principal_id(text) TO awcms_setup;
GRANT EXECUTE ON FUNCTION awcms_ensure_principal_id(text) TO awcms_app;
DO $$
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION awcms_ensure_principal_id(text) TO %I',
    current_user
  );
END
$$;
ALTER FUNCTION awcms_ensure_principal_id(text) OWNER TO awcms_principal_ensure;
