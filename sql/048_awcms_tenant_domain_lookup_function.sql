-- tenant_domain — narrow SECURITY DEFINER bootstrap read closing the RLS
-- bootstrap gap flagged in sql/046's header: the public host resolver must
-- discover `tenant_id` from a hostname in `awcms_tenant_domains` BEFORE any
-- tenant context (`app.current_tenant_id` GUC) exists, but that table is
-- intentionally `FORCE ROW LEVEL SECURITY` (it holds tenant-manageable fields
-- like `verification_token_hash`), so a plain `SELECT` from the least-privilege
-- `awcms_app` role always returns zero rows without `withTenant(...)`. This
-- migration adds one narrowly-scoped SECURITY DEFINER function as the single
-- sanctioned bootstrap read path. `FORCE ROW LEVEL SECURITY` is NOT removed
-- from the table, and the `awcms_app` tenant-isolation policy is untouched.
--
-- Ported from awcms-micro migration 033. Adapted: the source's table/role
-- prefixes were renamed to this repo's `awcms_*` convention, and the app role
-- is `awcms_app` (sql/019). This is the first SECURITY DEFINER function in this
-- repo — it follows the checklist in
-- docs/adr/0003-postgresql-rls-multi-tenant.md for a new bootstrap function.
--
-- ## How/why this is safe (works under the HARDENED, role-separated posture)
--
-- A SECURITY DEFINER function executes with the privileges of its OWNER *at
-- call time*. The naive assumption "the migration owner is a superuser, so the
-- function bypasses RLS" is FALSE in this repo's supported posture: sql/019–022
-- deliberately run the runtime as NON-superuser, NOBYPASSRLS roles, and a
-- role-separated deployment (and the integration harness, which demotes its
-- migration owner to `NOSUPERUSER NOBYPASSRLS` right after migrating —
-- tests/integration/harness.ts) leaves NO superuser owning this function. Under
-- `FORCE ROW LEVEL SECURITY`, a non-superuser function owner is fully subject to
-- the table's policies, so a function owned by such a role would resolve ZERO
-- rows for every hostname — host-based public routing would silently return
-- nothing. The safety of this bootstrap therefore does NOT rest on any RLS
-- bypass. It rests on a dedicated, minimal owner role plus an explicit, scoped
-- read policy, hardened by a fixed column list and a locked-down EXECUTE grant:
--
--   1. DEDICATED NOLOGIN BOOTSTRAP-OWNER ROLE. `awcms_domain_bootstrap` is
--      created `NOLOGIN NOSUPERUSER NOBYPASSRLS` (cluster-scoped, idempotent —
--      same guarded pattern as sql/019/022). The function is `ALTER FUNCTION
--      ... OWNER TO awcms_domain_bootstrap`, so it executes as this role — never
--      as a superuser, never as `awcms_app`. Because the role is NOLOGIN and its
--      membership is granted to NO ONE (in particular `awcms_app` is not a
--      member, and the reassign below relies on the SUPERUSER migration owner
--      rather than granting the role's membership to anyone — see the ordering
--      note), nothing outside this one function can ever act as this role: it
--      cannot log in, and no session can `SET ROLE` to it.
--   2. EXPLICIT, SCOPED SELECT POLICY. `awcms_tenant_domains_bootstrap_read` is
--      a permissive `FOR SELECT TO awcms_domain_bootstrap USING (true)` policy.
--      RLS combines permissive policies with OR and matches a policy's role by
--      membership, so it applies ONLY when the querying role IS (or is a member
--      of) `awcms_domain_bootstrap` — i.e. ONLY inside this SECURITY DEFINER
--      function. `awcms_app` is not a member, so its own direct SELECTs still
--      see only the `tenant_isolation` policy and remain fail-closed (zero rows
--      without `app.current_tenant_id`). `FORCE ROW LEVEL SECURITY` and the
--      `tenant_isolation` policy are kept exactly as sql/046 shipped them.
--   3. FIXED, NON-SENSITIVE COLUMN LIST. The function body is fixed, static SQL
--      (no dynamic SQL / string concatenation) returning exactly eight
--      non-sensitive columns for rows matching one parameterized
--      `normalized_hostname` and `deleted_at IS NULL`. Even though the read
--      policy lets the bootstrap role SELECT the whole table, this function can
--      never return `verification_token_hash`, `verification_record_value`,
--      `hostname` (raw/unnormalized), or any other column/table — the column
--      list is the boundary, not RLS.
--   4. EXECUTE LOCKED TO `awcms_app`. `EXECUTE` is revoked from `PUBLIC` and
--      granted only to `awcms_app` — no other role can invoke this bootstrap.
--      `awcms_app` still cannot query `awcms_tenant_domains` directly without
--      `withTenant(...)`; it can only go through this one fixed lookup shape.
--   5. `SET search_path = public, pg_temp` pins name resolution inside the
--      function body so it cannot be redirected by a caller-controlled
--      `search_path` (standard SECURITY DEFINER hardening).
--   6. `STABLE` (not `VOLATILE`): the function only reads.
--
-- ORDERING / PRIVILEGE NOTE. `ALTER FUNCTION ... OWNER TO awcms_domain_bootstrap`
-- reassigns ownership to a role the migration runner is NOT a member of. That is
-- fine because the migration runner is a SUPERUSER at migration time — an
-- invariant this repo ALREADY hard-requires (sql/019's
-- `ALTER ROLE awcms_app SET app.current_tenant_id`, and sql/022's equivalents,
-- can only be executed by a superuser; the integration harness models this by
-- creating its migration owner `SUPERUSER`, migrating, then demoting). A
-- superuser can reassign ownership to any role WITHOUT being granted that role's
-- membership, so we deliberately do NOT `GRANT awcms_domain_bootstrap TO
-- <owner>`: giving anyone that membership would let them satisfy the
-- `USING (true)` policy and read across tenants, defeating the isolation this
-- migration is careful to preserve.
--
-- Timing side-channel note (kept from awcms-micro's own hardening): the
-- function JOINs `awcms_tenants` and returns the tenant's own status/code/
-- name/locale alongside the domain row, so the TypeScript resolver
-- (`resolvePublicTenantByHost`) needs exactly ONE query for every outcome
-- (unknown host, inactive domain, inactive tenant, or a full resolution),
-- rather than a conditional second round trip that would distinguish "no such
-- mapping" from "mapping exists, tenant just isn't active" purely by latency.
-- This join does not widen the bypass: `awcms_tenants` is already RLS-free by
-- design (ADR-0003) and freely `SELECT`-able. `awcms_domain_bootstrap` still
-- needs an explicit table-level `SELECT` privilege on both tables (grants
-- below) — table privileges are separate from RLS policies.
--
-- Consumer: `src/lib/tenant/public-host-tenant-resolver.ts`'s
-- `resolvePublicTenantByHost()`. It still applies
-- `domain_status = 'active' AND tenant_status = 'active'` itself (this function
-- intentionally returns non-active, non-deleted domain rows too, so the
-- resolver layer — not this SQL layer — decides which combination resolves
-- public traffic).
--
-- No explicit `BEGIN;`/`COMMIT;` wrapper: `scripts/db-migrate.ts` already runs
-- each migration inside one managed transaction (`sql.begin`), so every
-- statement below — the role, its grants, the policy, the function, and the
-- ownership reassign — applies atomically or not at all. (An in-file `BEGIN;`
-- here would sit AFTER this header comment, so the runner's leading-token
-- stripper could not remove it and it would nest inside the managed
-- transaction; omitting it is cleaner and keeps the same all-or-nothing
-- guarantee.)

-- 1. The dedicated NOLOGIN bootstrap-owner role. Created NOSUPERUSER,
-- NOBYPASSRLS, NOLOGIN, passwordless — it never logs in and nobody is ever a
-- member of it, so it is unreachable except as the definer of the one function
-- below. Idempotent + cluster-scoped: roles survive the integration harness's
-- ephemeral-database drops within one process (same guarded pattern as
-- sql/019's `awcms_app` and sql/022's `awcms_worker`/`awcms_setup`).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_domain_bootstrap') THEN
    CREATE ROLE awcms_domain_bootstrap NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 2. Minimum privileges the bootstrap-owner needs to run the function body:
-- schema USAGE (so it can resolve objects in `public`) and table-level SELECT on
-- the two tables the function reads. `awcms_tenants` is RLS-free but a
-- table-level SELECT privilege is still required to read it under this role
-- (sql/019's `ALTER DEFAULT PRIVILEGES` only grants to `awcms_app`, not this
-- role). No INSERT/UPDATE/DELETE, no other tables.
GRANT USAGE ON SCHEMA public TO awcms_domain_bootstrap;
GRANT SELECT ON awcms_tenant_domains TO awcms_domain_bootstrap;
GRANT SELECT ON awcms_tenants TO awcms_domain_bootstrap;

-- 3. The explicit, scoped bootstrap read policy. Permissive + `FOR SELECT` +
-- `TO awcms_domain_bootstrap`, so it is OR'd with (never replaces) sql/046's
-- `awcms_tenant_domains_tenant_isolation` and applies ONLY to the bootstrap
-- role — i.e. ONLY inside the SECURITY DEFINER function below. `awcms_app`'s own
-- direct SELECTs are unaffected and stay fail-closed. `FORCE ROW LEVEL SECURITY`
-- stays on; the tenant-isolation policy stays exactly as shipped.
CREATE POLICY awcms_tenant_domains_bootstrap_read
  ON awcms_tenant_domains
  FOR SELECT
  TO awcms_domain_bootstrap
  USING (true);

CREATE OR REPLACE FUNCTION awcms_resolve_tenant_domain_lookup(
  p_normalized_hostname text
)
RETURNS TABLE (
  tenant_id uuid,
  domain_status text,
  is_primary boolean,
  route_mode text,
  tenant_status text,
  tenant_code text,
  tenant_name text,
  default_locale text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT
    d.tenant_id,
    d.status AS domain_status,
    d.is_primary,
    d.route_mode,
    t.status AS tenant_status,
    t.tenant_code,
    t.tenant_name,
    t.default_locale
  FROM awcms_tenant_domains AS d
  JOIN awcms_tenants AS t ON t.id = d.tenant_id
  WHERE d.normalized_hostname = p_normalized_hostname
    AND d.deleted_at IS NULL;
$function$;

COMMENT ON FUNCTION awcms_resolve_tenant_domain_lookup(text) IS
  'Narrow SECURITY DEFINER bootstrap read for hostname -> tenant lookup before tenant context exists. Owned by the dedicated NOLOGIN awcms_domain_bootstrap role (NOT a superuser), which an explicit FOR SELECT TO awcms_domain_bootstrap USING (true) policy lets read awcms_tenant_domains under FORCE RLS; the same role has no login and no members, so nothing else can act as it. Joins the (already RLS-free) awcms_tenants row in the same call so the TypeScript resolver needs exactly one round trip regardless of outcome (avoids a timing side-channel between "unmapped host" and "mapped but inactive tenant"). Returns only tenant_id/domain_status/is_primary/route_mode/tenant_status/tenant_code/tenant_name/default_locale for non-deleted domain rows matching a normalized hostname. Never returns verification_token_hash, verification_record_value, or raw hostname. EXECUTE restricted to awcms_app.';

-- 4. Function EXECUTE privilege is a separate grant mechanism from the table
-- GRANTs sql/019's `ALTER DEFAULT PRIVILEGES` covers (that clause only applies
-- to tables/sequences, not functions/routines) — this explicit grant is
-- required, it is not automatic. PostgreSQL grants EXECUTE to PUBLIC by default
-- on function creation; revoke that first so only the least-privilege app role
-- can call this bootstrap. Done while the migration owner still owns the
-- function (before the OWNER reassign below), so the migration owner's
-- authority to REVOKE/GRANT on it is unambiguous.
REVOKE ALL ON FUNCTION awcms_resolve_tenant_domain_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_resolve_tenant_domain_lookup(text) TO awcms_app;

-- 5. Reassign the function to the bootstrap-owner so SECURITY DEFINER runs it as
-- that role. Requires SUPERUSER (the migration runner is one; see the ORDERING
-- note in the header) — a superuser reassigns ownership without needing the
-- target role's membership, so `awcms_domain_bootstrap` stays memberless.
ALTER FUNCTION awcms_resolve_tenant_domain_lookup(text) OWNER TO awcms_domain_bootstrap;
