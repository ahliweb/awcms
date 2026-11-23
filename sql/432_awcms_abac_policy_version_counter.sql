-- 432_awcms_abac_policy_version_counter.sql
--
-- `identity_access` - a per-tenant ABAC policy version, bumped by the database
-- in the same transaction as every change to `awcms_abac_policies`, so a policy
-- cache in ANY process can tell that its snapshot is stale (Issue
-- ahliweb/awcms#1482). Forward-only: `sql/005` and `sql/031` are applied and are
-- NOT edited.
--
-- ## The gap
--
-- `policy-cache.ts` memoises each tenant's compiled policies in a process-local
-- `Map`, invalidated only by `invalidatePolicyCache(tenantId)` in the process
-- that served the write. With more than one process or replica, a new `deny`
-- or a disabled `allow` kept its old effect everywhere else until restart: a
-- stale ALLOW on the authorization chokepoint (ADR-0063).
--
-- ## The mechanism
--
-- `awcms_abac_policy_versions` holds one row per tenant whose policies have been
-- written. A row trigger on `awcms_abac_policies` (INSERT, UPDATE, DELETE) and a
-- statement trigger (TRUNCATE) write a FRESH value from a standalone sequence
-- into the affected tenants' rows. The chokepoint reads the version inside the
-- authorization transaction the request already opens and drops a cached
-- snapshot whose version differs.
--
-- Why a sequence and not `policy_version + 1`: equality is all the reader
-- compares, so what must hold is "a value is never written twice". A counter
-- restarts at 1 when its row disappears (tenant deletion, a TRUNCATE in a test
-- harness that reuses tenant ids) and could then equal a value some process
-- still has cached. A standalone sequence (not OWNED BY the table, so
-- `TRUNCATE ... RESTART IDENTITY` does not reset it) never hands out a value
-- twice, including across two concurrent writers: whichever commits last
-- leaves a value nobody has observed before.
--
-- Why a trigger and not the writers: there are five writer call sites today
-- (`abac-admin.ts` x2, `abac-policy-directory.ts` x3), plus whatever a
-- migration, an operator or a future surface does. A trigger cannot be
-- forgotten by any of them.
--
-- ## Privileges
--
-- The trigger function is `SECURITY DEFINER`, owned by the new NOLOGIN,
-- memberless `awcms_abac_policy_version_bump`, with `search_path` pinned. That
-- role holds exactly: SELECT (id) on `awcms_tenants` (to skip a tenant that is
-- being deleted, and for the TRUNCATE branch), SELECT/INSERT and UPDATE of the
-- two mutable columns on the version table (SELECT is required by
-- `ON CONFLICT`), and USAGE on the sequence. `awcms_app` keeps SELECT only on
-- the version table and nothing on the sequence, so the runtime cannot move a
-- version backwards to re-validate a stale cache. `security:readiness` pins the
-- function body, the trigger shapes, the role, the policies and the grants.
--
-- No rows are written. The migration runner wraps the file in a transaction.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_abac_policy_version_bump') THEN
    CREATE ROLE awcms_abac_policy_version_bump
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

CREATE SEQUENCE IF NOT EXISTS awcms_abac_policy_version_seq AS bigint;

CREATE TABLE IF NOT EXISTS awcms_abac_policy_versions (
  tenant_id uuid PRIMARY KEY REFERENCES awcms_tenants (id) ON DELETE CASCADE,
  policy_version bigint NOT NULL
    CONSTRAINT awcms_abac_policy_versions_positive_check CHECK (policy_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE awcms_abac_policy_versions IS
  'Issue #1482: per-tenant ABAC policy version. Written ONLY by the awcms_abac_policy_version_bump trigger on awcms_abac_policies; read by the authorization chokepoint to invalidate a stale policy cache in every process.';

ALTER TABLE awcms_abac_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE awcms_abac_policy_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY awcms_abac_policy_versions_tenant_isolation
  ON awcms_abac_policy_versions
  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);

-- The bump runs in the WRITER's transaction: under a tenant context for every
-- runtime write, and with none for a migration or an operator. `true` is safe
-- because nothing but the pinned trigger body can act as this role.
CREATE POLICY awcms_abac_policy_versions_bump
  ON awcms_abac_policy_versions
  FOR ALL
  TO awcms_abac_policy_version_bump
  USING (true)
  WITH CHECK (true);

-- sql/019's default privileges gave the runtime every verb; take them back.
REVOKE ALL ON awcms_abac_policy_versions FROM PUBLIC;
REVOKE ALL ON awcms_abac_policy_versions FROM awcms_app;
GRANT SELECT ON awcms_abac_policy_versions TO awcms_app;

REVOKE ALL ON SEQUENCE awcms_abac_policy_version_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE awcms_abac_policy_version_seq FROM awcms_app;

GRANT USAGE ON SCHEMA public TO awcms_abac_policy_version_bump;
GRANT SELECT (id) ON awcms_tenants TO awcms_abac_policy_version_bump;
GRANT SELECT, INSERT ON awcms_abac_policy_versions TO awcms_abac_policy_version_bump;
GRANT UPDATE (policy_version, updated_at)
  ON awcms_abac_policy_versions TO awcms_abac_policy_version_bump;
GRANT USAGE ON SEQUENCE awcms_abac_policy_version_seq TO awcms_abac_policy_version_bump;

CREATE OR REPLACE FUNCTION awcms_abac_policy_version_bump()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_old uuid;
  v_new uuid;
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    INSERT INTO awcms_abac_policy_versions AS v (tenant_id, policy_version)
    SELECT t.id, nextval('awcms_abac_policy_version_seq')
    FROM awcms_tenants AS t
    ON CONFLICT (tenant_id) DO UPDATE
      SET policy_version = EXCLUDED.policy_version, updated_at = now();
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := OLD.tenant_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := NEW.tenant_id;
  END IF;
  INSERT INTO awcms_abac_policy_versions AS v (tenant_id, policy_version)
  SELECT t.id, nextval('awcms_abac_policy_version_seq')
  FROM awcms_tenants AS t
  WHERE t.id = v_old OR t.id = v_new
  ON CONFLICT (tenant_id) DO UPDATE
    SET policy_version = EXCLUDED.policy_version, updated_at = now();
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION awcms_abac_policy_version_bump() IS
  'Issue #1482: writes a fresh awcms_abac_policy_version_seq value into the version row of every tenant whose awcms_abac_policies rows changed (both sides of an UPDATE; every tenant on TRUNCATE). Owned by the NOLOGIN, memberless awcms_abac_policy_version_bump role. Body pinned by security:readiness.';

REVOKE ALL ON FUNCTION awcms_abac_policy_version_bump() FROM PUBLIC;
ALTER FUNCTION awcms_abac_policy_version_bump() OWNER TO awcms_abac_policy_version_bump;

DROP TRIGGER IF EXISTS awcms_abac_policies_version_bump ON awcms_abac_policies;
CREATE TRIGGER awcms_abac_policies_version_bump
  AFTER INSERT OR UPDATE OR DELETE ON awcms_abac_policies
  FOR EACH ROW EXECUTE FUNCTION awcms_abac_policy_version_bump();

DROP TRIGGER IF EXISTS awcms_abac_policies_version_bump_truncate ON awcms_abac_policies;
CREATE TRIGGER awcms_abac_policies_version_bump_truncate
  AFTER TRUNCATE ON awcms_abac_policies
  FOR EACH STATEMENT EXECUTE FUNCTION awcms_abac_policy_version_bump();
