-- #1004 (audit finding H2 of the security review of 938caa88; ADR-0141 section 7,
-- ADR-0088). One boolean: does this principal (a person, global) hold an identity
-- in any tenant OTHER than the given one?
--
-- ## Why it exists
--
-- A fresh SSO session normally stands in for the current password when starting
-- TOTP enrolment. But the MFA factor is PRINCIPAL-global (ADR-0087): enrolling it
-- binds the person in every tenant they belong to, and ADR-0088 rejects letting
-- one tenant's identity provider vouch for them in another (tenant B's IdP
-- administrator can assert `alice@corp.com`). So the SSO exemption may only apply
-- when the person has no identity elsewhere - and `awcms_identities` is FORCE RLS,
-- so an ordinary query cannot answer "elsewhere".
--
-- ## Shape (the sql/048 / sql/217 safeguards)
--
--   1. A dedicated NOLOGIN, NOSUPERUSER, NOBYPASSRLS role with NO members.
--   2. COLUMN-level SELECT on `awcms_identities` (tenant_id, principal_id) only -
--      no login identifier, no password hash - plus a read policy for that role
--      alone.
--   3. Fixed static SQL; returns a single boolean, never a tenant id or a count,
--      so it cannot be used to enumerate memberships.
--   4. EXECUTE revoked from PUBLIC and granted to awcms_app only.
--   5. `SET search_path = public, pg_temp`; STABLE (it only reads).
--
-- It takes the principal id of the CALLER'S OWN session, never a value a request
-- body names, so the boolean it returns is about the person already
-- authenticated.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_principal_reach') THEN
    CREATE ROLE awcms_principal_reach NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_principal_reach;
GRANT SELECT (tenant_id, principal_id) ON awcms_identities TO awcms_principal_reach;

DROP POLICY IF EXISTS awcms_identities_principal_reach_read ON awcms_identities;
CREATE POLICY awcms_identities_principal_reach_read
  ON awcms_identities
  FOR SELECT
  TO awcms_principal_reach
  USING (true);

CREATE OR REPLACE FUNCTION awcms_principal_has_other_tenant_identity(
  p_principal_id uuid,
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM awcms_identities AS i
    WHERE i.principal_id = p_principal_id
      AND i.tenant_id <> p_tenant_id
  );
$function$;

COMMENT ON FUNCTION awcms_principal_has_other_tenant_identity(uuid, uuid) IS
  '#1004 / ADR-0088. One boolean: whether the principal holds an identity in any tenant other than the given one. Lets the TOTP enrolment re-authentication refuse the fresh-SSO exemption for a person who works in several tenants (the factor is principal-global; one tenant IdP must not vouch for the others). Reads only (tenant_id, principal_id) of awcms_identities as a dedicated NOLOGIN role; returns no id or count. EXECUTE restricted to awcms_app.';

REVOKE ALL ON FUNCTION awcms_principal_has_other_tenant_identity(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_principal_has_other_tenant_identity(uuid, uuid) TO awcms_app;
ALTER FUNCTION awcms_principal_has_other_tenant_identity(uuid, uuid) OWNER TO awcms_principal_reach;
