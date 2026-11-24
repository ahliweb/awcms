-- hr_commission / payroll boundary -- the SEPARATE, minimal database role through
-- which the scheduled catalog check `payroll:catalog-boundary:job` connects
-- (Issue #1095, owner decision K3 of 2026-11-22). Forward-only.
--
-- ## What it is for
--
-- `payroll:catalog-boundary:check` (Issue #1015, `docs/awcms/hr-payroll.md`
-- section 13.3) reads the migrated CATALOG of a database and fails when a view,
-- rule, function, trigger or grant reaches a payroll table from outside the
-- payroll family. Until now it ran only when somebody ran it (CI against a fresh
-- database, an operator against a restored one). K3 schedules it daily against
-- the DEPLOYED database, as the job `payroll:catalog-boundary:job`.
--
-- ## Why a role of its own
--
-- The check needs to read the catalogs and nothing else. Running it as
-- `awcms_app` (or `awcms_worker`) would put a login that reads every payroll row
-- into a cron container whose only purpose is to look at structure. So the job
-- connects as `awcms_catalog_boundary_audit`:
--
--   * `CONNECT` on the database (from PUBLIC's default; catalog views such as `pg_class`, `pg_proc`,
--     `pg_policy`, `pg_roles` and `pg_auth_members` are readable by any role);
--   * NO privilege on any table, column, sequence or function of the application
--     schema. In particular no SELECT on a payroll table, a ledger, an audit table
--     or any tenant data: the role cannot read data even if its login leaks, and
--     it is not a member of any other role;
--   * NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT, and it owns
--     nothing.
--
-- `security:readiness` pins exactly that (role exists, none of the attributes
-- above, NOINHERIT, no table- or column-level privilege on any relation in any
-- privilege, no EXECUTE on any SECURITY DEFINER function (through PUBLIC or
-- otherwise: a definer runs with its owner's rights), no membership, owns
-- nothing), and warns while the role has no LOGIN (the job is then "not
-- activated").
--
-- ## Activation (opt-in, like `awcms_social_dispatch`)
--
-- The role ships NOLOGIN and passwordless. The OPERATOR grants LOGIN and a
-- password, builds the connection string into `PAYROLL_CATALOG_AUDIT_DATABASE_URL`
-- and lists it in the job's scoped environment (`ops/awcms-jobs.env-scoped`):
--
--   ALTER ROLE awcms_catalog_boundary_audit LOGIN PASSWORD '<secret>';
--
-- The job has NO fallback to `DATABASE_URL` / `WORKER_DATABASE_URL`: a missing
-- value refuses (fail closed). Split-role deployments (migrations run by one
-- role, payroll objects owned by another) must also set `PAYROLL_EXPECTED_OWNERS`;
-- the job fails loudly when it finds an owner it cannot account for and the
-- variable is empty.
--
-- No explicit BEGIN/COMMIT: the migration runner wraps each file.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_catalog_boundary_audit'
  ) THEN
    CREATE ROLE awcms_catalog_boundary_audit
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

-- CONNECT is deliberately NOT granted here: it comes from PUBLIC's default
-- CONNECT on the database, exactly like every other awcms_ role. A statement that
-- names the database would need dynamic SQL, which the payroll SQL boundary scan
-- refuses in a DO block. An operator who revoked PUBLIC CONNECT grants it to this
-- role together with LOGIN:
--
--   GRANT CONNECT ON DATABASE <db> TO awcms_catalog_boundary_audit;

COMMENT ON ROLE awcms_catalog_boundary_audit IS
  'Minimal login of the scheduled job payroll:catalog-boundary:job (Issue #1095): CONNECT and catalog reads only, no privilege on any application table. Ships NOLOGIN; the operator grants LOGIN.';
