-- Telegram delivery: the four narrow SECURITY DEFINER functions the unauthenticated
-- webhook and the least-privilege dispatcher need (Issue #965, ADR-0140 sections
-- 3 and 7). Pattern: `sql/048` (tenant_domain host lookup) and `sql/142`
-- (delegated-access expiry sweep); read those headers for the full argument. This
-- file states only what is specific to Telegram.
--
-- ## Why the webhook needs a bootstrap read at all
--
-- `POST /api/v1/telegram/webhook` has no tenant in its path (one bot per
-- deployment) and no session. It must discover the tenant from the one-time code
-- (`/start <code>`) or from the chat (`/stop`) BEFORE any tenant context exists,
-- but `awcms_telegram_link_codes` and `awcms_telegram_bindings` are FORCE RLS, so
-- a plain SELECT as the runtime role returns zero rows. Two fixed functions are
-- the only sanctioned cross-tenant reads:
--
--   * `awcms_telegram_resolve_link_code(code_hash)` returns the TENANT ID of an
--     unconsumed, unexpired code and nothing else. The code is 256 random bits and
--     only its hash is passed, so the function is not an enumeration oracle.
--   * `awcms_telegram_find_bindings_by_chat_hash(hashes)` returns
--     `(tenant_id, binding_id)` for live bindings whose KEYED chat hash is in the
--     list. The caller computes the list (one candidate per active tenant per ring
--     key), because the hash is bound to the tenant and cannot be looked up
--     without knowing it; without the secret hash ring the list cannot be forged.
--
-- Everything after that (the atomic consume, the binding insert, the revocation)
-- runs under the resolved tenant's ordinary RLS. `FORCE ROW LEVEL SECURITY` and
-- the tenant-isolation policies are untouched. These two are the ONLY functions
-- below that read across tenants: the bootstrap read policies further down are
-- `USING (true)` for this role on the two Telegram tables, and nothing else.
--
-- ## Why the dispatcher and the purge need two more
--
-- `awcms_worker` deliberately holds no privilege on the identity tables (it would
-- be a cron job that can read every login identifier) and none on the module
-- registry. ADR-0140 section 3 nonetheless says the dispatcher re-checks the
-- principal AT SEND TIME, not only at enqueue, and that a module switched off
-- revokes; the nightly purge runs the same two checks (whether or not
-- `TELEGRAM_ENABLED` is on) so a person who left, or a tenant that switched the
-- module off, loses the stored chat id without anyone sending anything. So:
--
--   * `awcms_telegram_principal_active(tenant, principal)` answers ONE boolean:
--     the tenant user is active, its identity is active, and it still holds at
--     least one role grant in force (direct or through a group, role not deleted).
--   * `awcms_telegram_module_enabled(tenant)` answers whether Module Management
--     has the module on for the tenant (no row means "never toggled": enabled).
--
-- These two do NOT bypass RLS: they run in the CALLER's tenant transaction (the
-- dispatcher's or the purge's), the policies evaluate against
-- `app.current_tenant_id`, and the function owner only supplies the table
-- privileges the worker lacks. A call for another tenant's id sees no row and
-- answers `false`. Neither returns a row, an id or a value other than a boolean.
-- The owner holds COLUMN-level SELECT on the identity table (the three columns
-- the join reads), so even a defect in these functions could not reach a login
-- identifier or a password hash.
--
-- KNOWN COST, stated rather than buried: the grant join in
-- `awcms_telegram_principal_active` restates `activeRoleGrants`
-- (`identity-access/application/grant-source.ts`) in SQL, because a function
-- cannot embed a TypeScript fragment. If that definition changes, this function
-- must change with it. `tests/integration/telegram-delivery.integration.test.ts`
-- pins its behaviour (direct grant, group grant, no grant, deactivated).
--
-- ## Safeguards (the sql/048 list, restated)
--
--   1. A dedicated NOLOGIN, NOSUPERUSER, NOBYPASSRLS role with NO members, so
--      nothing outside these functions can act as it.
--   2. Scoped read policies for that role on the two Telegram tables only
--      (permissive, OR-ed with the tenant-isolation policy; they apply to this
--      role alone).
--   3. Fixed static SQL, no dynamic SQL; each function returns the narrowest
--      shape that answers its question.
--   4. EXECUTE revoked from PUBLIC and granted to exactly the role that calls it.
--   5. `SET search_path = public, pg_temp`.
--   6. STABLE: all four only read.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_telegram_bootstrap') THEN
    CREATE ROLE awcms_telegram_bootstrap NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_telegram_bootstrap;
GRANT SELECT ON awcms_telegram_link_codes TO awcms_telegram_bootstrap;
GRANT SELECT ON awcms_telegram_bindings TO awcms_telegram_bootstrap;
-- Table privileges only, for the two dispatcher functions (RLS still applies).
GRANT SELECT (id, tenant_id, identity_id, status) ON awcms_tenant_users TO awcms_telegram_bootstrap;
-- Column-level on purpose: the table holds login identifiers and password hashes.
GRANT SELECT (id, tenant_id, status) ON awcms_identities TO awcms_telegram_bootstrap;
-- Column-level: the tenant's lifecycle state only (a suspended tenant has no live binding).
GRANT SELECT (id, status) ON awcms_tenants TO awcms_telegram_bootstrap;
GRANT SELECT ON awcms_access_policies TO awcms_telegram_bootstrap;
GRANT SELECT ON awcms_user_groups TO awcms_telegram_bootstrap;
GRANT SELECT ON awcms_user_group_members TO awcms_telegram_bootstrap;
GRANT SELECT ON awcms_roles TO awcms_telegram_bootstrap;
GRANT SELECT ON awcms_tenant_modules TO awcms_telegram_bootstrap;

CREATE POLICY awcms_telegram_link_codes_bootstrap_read
  ON awcms_telegram_link_codes
  FOR SELECT
  TO awcms_telegram_bootstrap
  USING (true);

CREATE POLICY awcms_telegram_bindings_bootstrap_read
  ON awcms_telegram_bindings
  FOR SELECT
  TO awcms_telegram_bootstrap
  USING (true);

CREATE OR REPLACE FUNCTION awcms_telegram_resolve_link_code(
  p_code_hash text
)
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT c.tenant_id
  FROM awcms_telegram_link_codes AS c
  WHERE c.code_hash = p_code_hash
    AND c.consumed_at IS NULL
    AND c.invalidated_at IS NULL
    AND c.expires_at > now();
$function$;

COMMENT ON FUNCTION awcms_telegram_resolve_link_code(text) IS
  'Narrow SECURITY DEFINER bootstrap read for the Telegram webhook: the tenant id of an unconsumed, unexpired one-time link code, found by its SHA-256 hash, before any tenant context exists. Returns nothing else. EXECUTE restricted to awcms_app.';

CREATE OR REPLACE FUNCTION awcms_telegram_find_bindings_by_chat_hash(
  p_hashes text
)
RETURNS TABLE (tenant_id uuid, binding_id uuid)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT b.tenant_id, b.id
  FROM awcms_telegram_bindings AS b
  WHERE b.chat_hash = ANY (string_to_array(p_hashes, ','))
    AND b.status IN ('pending_confirmation', 'active');
$function$;

COMMENT ON FUNCTION awcms_telegram_find_bindings_by_chat_hash(text) IS
  'Narrow SECURITY DEFINER bootstrap read for the Telegram webhook /stop command: (tenant_id, binding_id) of live bindings whose keyed chat hash is in a comma-separated candidate list. The hash is keyed and tenant-bound, so a caller without the secret ring cannot build a list that matches. EXECUTE restricted to awcms_app.';

CREATE OR REPLACE FUNCTION awcms_telegram_principal_active(
  p_tenant_id uuid,
  p_principal_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM awcms_tenant_users AS tu
    JOIN awcms_identities AS i
      ON i.tenant_id = tu.tenant_id AND i.id = tu.identity_id
    WHERE tu.tenant_id = p_tenant_id
      AND tu.id = p_principal_id
      AND tu.status = 'active'
      AND EXISTS (
        SELECT 1 FROM awcms_tenants AS t
        WHERE t.id = p_tenant_id AND t.status = 'active'
      )
      AND i.status = 'active'
      AND EXISTS (
        SELECT 1
        FROM (
          SELECT ap.role_id
          FROM awcms_access_policies AS ap
          WHERE ap.tenant_id = p_tenant_id
            AND ap.subject_type = 'tenant_user'
            AND ap.tenant_user_id = p_principal_id
            AND ap.status = 'active'
            AND ap.effective_from <= now()
            AND (ap.effective_to IS NULL OR ap.effective_to > now())
          UNION ALL
          SELECT ap.role_id
          FROM awcms_access_policies AS ap
          JOIN awcms_user_groups AS gr
            ON gr.id = ap.user_group_id AND gr.tenant_id = ap.tenant_id
            AND gr.deleted_at IS NULL
          JOIN awcms_user_group_members AS m
            ON m.user_group_id = gr.id AND m.tenant_id = gr.tenant_id
          WHERE ap.tenant_id = p_tenant_id
            AND ap.subject_type = 'user_group'
            AND m.tenant_user_id = p_principal_id
            AND ap.status = 'active'
            AND ap.effective_from <= now()
            AND (ap.effective_to IS NULL OR ap.effective_to > now())
        ) AS g
        JOIN awcms_roles AS r
          ON r.id = g.role_id AND r.tenant_id = p_tenant_id
          AND r.deleted_at IS NULL
      )
  );
$function$;

COMMENT ON FUNCTION awcms_telegram_principal_active(uuid, uuid) IS
  'One boolean for the Telegram dispatcher: the tenant is active, the tenant user is active, its identity is active, and it holds at least one role grant in force (direct or via a group, role not deleted). Mirrors identity-access grant-source.ts activeRoleGrants in SQL. Runs under the caller''s tenant RLS (it does not bypass it). EXECUTE restricted to awcms_worker.';

CREATE OR REPLACE FUNCTION awcms_telegram_module_enabled(
  p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $function$
  SELECT COALESCE(
    (SELECT tm.enabled
     FROM awcms_tenant_modules AS tm
     WHERE tm.tenant_id = p_tenant_id AND tm.module_key = 'telegram_delivery'),
    true
  );
$function$;

COMMENT ON FUNCTION awcms_telegram_module_enabled(uuid) IS
  'One boolean for the Telegram dispatcher: whether Module Management has telegram_delivery enabled for the tenant (no row means never toggled, so enabled). Runs under the caller''s tenant RLS. EXECUTE restricted to awcms_worker.';

REVOKE ALL ON FUNCTION awcms_telegram_resolve_link_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION awcms_telegram_find_bindings_by_chat_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION awcms_telegram_principal_active(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION awcms_telegram_module_enabled(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION awcms_telegram_resolve_link_code(text) TO awcms_app;
GRANT EXECUTE ON FUNCTION awcms_telegram_find_bindings_by_chat_hash(text) TO awcms_app;
GRANT EXECUTE ON FUNCTION awcms_telegram_principal_active(uuid, uuid) TO awcms_worker;
GRANT EXECUTE ON FUNCTION awcms_telegram_module_enabled(uuid) TO awcms_worker;

ALTER FUNCTION awcms_telegram_resolve_link_code(text) OWNER TO awcms_telegram_bootstrap;
ALTER FUNCTION awcms_telegram_find_bindings_by_chat_hash(text) OWNER TO awcms_telegram_bootstrap;
ALTER FUNCTION awcms_telegram_principal_active(uuid, uuid) OWNER TO awcms_telegram_bootstrap;
ALTER FUNCTION awcms_telegram_module_enabled(uuid) OWNER TO awcms_telegram_bootstrap;
