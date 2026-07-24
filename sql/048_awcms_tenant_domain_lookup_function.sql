-- tenant_domain — narrow SECURITY DEFINER bootstrap read closing the RLS
-- bootstrap gap flagged in sql/046's header: the public host resolver must
-- discover `tenant_id` from a hostname in `awcms_tenant_domains` BEFORE any
-- tenant context (`app.current_tenant_id` GUC) exists, but that table is
-- intentionally `FORCE ROW LEVEL SECURITY` (it holds tenant-manageable fields
-- like `verification_token_hash`), so a plain `SELECT` from the least-privilege
-- `awcms_app` role always returns zero rows without `withTenant(...)`. This
-- migration adds one narrowly-scoped SECURITY DEFINER function as the single
-- sanctioned bootstrap read path. `FORCE ROW LEVEL SECURITY` is NOT removed
-- from the table.
--
-- Ported from awcms-micro migration 033. Adapted: the source's table/role
-- prefixes were renamed to this repo's `awcms_*` convention, and the app role
-- is `awcms_app` (sql/019). This is the first SECURITY DEFINER function in this
-- repo — it follows the checklist in
-- docs/adr/0003-postgresql-rls-multi-tenant.md for a new bypass function.
--
-- How/why this is safe:
--   - Migrations execute as the schema-owning role (`DATABASE_URL`, which on a
--     typical deployment is a Postgres SUPERUSER — the same role that owns
--     every FORCE-RLS table in this schema). Superusers bypass row security
--     unconditionally, regardless of `FORCE ROW LEVEL SECURITY` (`FORCE` only
--     removes the *table owner's* default RLS exemption when the owner is a
--     non-superuser role; it has no effect on an actually-superuser owner). So
--     a SECURITY DEFINER function owned by this role executes with the same
--     unconditional RLS bypass as the migration's own DDL/DML already does.
--   - Because the *role* running this function's body already has an
--     unconditional bypass, the safety of this mechanism does not come from
--     RLS/FORCE at all — it comes entirely from two narrower guarantees:
--       1. The function body is fixed, static SQL (no dynamic SQL / string
--          concatenation) returning exactly eight non-sensitive columns for
--          rows matching one parameterized `normalized_hostname` argument and
--          `deleted_at IS NULL`. It can never be used to read
--          `verification_token_hash`, `verification_record_value`, `hostname`
--          (raw/unnormalized), or any other column/table.
--       2. `EXECUTE` on the function is revoked from `PUBLIC` and granted only
--          to `awcms_app` — no other non-superuser role can invoke this
--          bypass. `awcms_app` still cannot query `awcms_tenant_domains`
--          directly without `withTenant(...)`; it can only go through this one
--          fixed lookup shape.
--   - `SET search_path = public, pg_temp` pins name resolution inside the
--     function body so it cannot be redirected by a caller-controlled
--     `search_path` (standard SECURITY DEFINER hardening).
--   - `STABLE` (not `VOLATILE`): the function only reads.
--
-- Timing side-channel note (kept from awcms-micro's own hardening): the
-- function JOINs `awcms_tenants` and returns the tenant's own status/code/
-- name/locale alongside the domain row, so the TypeScript resolver
-- (`resolvePublicTenantByHost`) needs exactly ONE query for every outcome
-- (unknown host, inactive domain, inactive tenant, or a full resolution),
-- rather than a conditional second round trip that would distinguish "no such
-- mapping" from "mapping exists, tenant just isn't active" purely by latency.
-- This join does not widen the bypass: `awcms_tenants` is already RLS-free by
-- design (ADR-0003) and freely `SELECT`-able by `awcms_app` — joining it here
-- only removes a round trip; it exposes nothing not already unconditionally
-- public.
--
-- Consumer: `src/lib/tenant/public-host-tenant-resolver.ts`'s
-- `resolvePublicTenantByHost()`. It still applies
-- `domain_status = 'active' AND tenant_status = 'active'` itself (this function
-- intentionally returns non-active, non-deleted domain rows too, so the
-- resolver layer — not this SQL layer — decides which combination resolves
-- public traffic).

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
  'Narrow SECURITY DEFINER bootstrap read for hostname -> tenant lookup before tenant context exists. Joins the (already RLS-free) awcms_tenants row in the same call so the TypeScript resolver needs exactly one round trip regardless of outcome (avoids a timing side-channel between "unmapped host" and "mapped but inactive tenant"). Returns only tenant_id/domain_status/is_primary/route_mode/tenant_status/tenant_code/tenant_name/default_locale for non-deleted domain rows matching a normalized hostname. Never returns verification_token_hash, verification_record_value, or raw hostname. EXECUTE restricted to awcms_app.';

-- Function EXECUTE privilege is a separate grant mechanism from the table
-- GRANTs sql/019's `ALTER DEFAULT PRIVILEGES` covers (that clause only applies
-- to tables/sequences, not functions/routines) — this explicit grant is
-- required, it is not automatic. PostgreSQL grants EXECUTE to PUBLIC by default
-- on function creation; revoke that first so only the least-privilege app role
-- can call this bypass.
REVOKE ALL ON FUNCTION awcms_resolve_tenant_domain_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_resolve_tenant_domain_lookup(text) TO awcms_app;
