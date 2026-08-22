-- ADR-0090 (finding A1 of the 17 August 2026 audit round) — the sweep that
-- ends a delegated membership when its grant runs out, and the narrow
-- SECURITY DEFINER function that lets a scheduled job perform it without
-- holding a privilege it could misuse.
--
-- ## What already landed, and what this adds
--
-- The GATE landed first: `resolveDelegatedGrantState` carries
-- `expires_at > now()`, so an expired grant is refused at every authorization
-- from the instant on the row. This migration is the CLEANUP behind that gate —
-- the grant is marked revoked with reason `expired`, its tenant user goes
-- `inactive`, and its live sessions are revoked. Exactly what ADR-0090 promised
-- ("revocation AND expiry deactivate the membership in the same transaction")
-- and what `expireDelegatedAccessGrants` was written for before it spent its
-- whole life with zero callers.
--
-- ## Why a function, and not three GRANTs
--
-- The sweep runs as `awcms_worker`, which holds SELECT + DELETE on
-- `awcms_delegated_access_grants` (sql/129) and NOTHING on
-- `awcms_tenant_users` or `awcms_sessions`. Granting those plainly would hand a
-- scheduled job two verbs it does not need and cannot be trusted with:
--
--   * `UPDATE awcms_tenant_users` also writes `status = 'active'`, which is
--     "un-deactivate any member";
--   * `UPDATE awcms_sessions` also writes `revoked_at = NULL`, which is
--     "un-revoke a stolen session".
--
-- Both are ESCALATIONS, in a role whose whole point is that it cannot escalate.
-- Column-scoped grants do not help: the column is where the dangerous value
-- lives, not beside it.
--
-- So the privilege goes to a function instead, following `sql/048` /`sql/119` /
-- `sql/124`, with the same four safeguards:
--
--   1. a dedicated NOLOGIN owner role with no members, unreachable except as
--      this function's definer;
--   2. explicit policies scoped to that role alone — permissive, so they are
--      OR-ed with the tenant-isolation policies and change nothing for
--      `awcms_app`;
--   3. a TIGHT boundary — here it is not a column list but the STATEMENTS: the
--      function takes a tenant id and a batch size and NOTHING ELSE, so there
--      is no value a caller can supply that the function will write. Every
--      literal it writes is in this file;
--   4. EXECUTE revoked from PUBLIC and granted only to `awcms_worker`.
--
-- ## It can only ever REMOVE access
--
-- Read the three statements as a set. The grant UPDATE is guarded by
-- `revoked_at IS NULL`, so that column can only move from NULL to `now()`. The
-- membership UPDATE writes the literal `'inactive'` and is guarded by
-- `principal_kind = 'delegated'`, so it cannot touch an ordinary member and
-- cannot activate anybody. The session UPDATE writes `now()` guarded by
-- `revoked_at IS NULL`, so it can revoke and never un-revoke.
--
-- A compromised worker calling this in a loop can therefore end delegated
-- support episodes early. That is a nuisance, not a breach, and it is the only
-- thing it can do.
--
-- ## Deliberately no actor
--
-- `revoked_by_tenant_user_id` stays NULL and `revoke_reason` is the literal
-- `'expired'`. `sql/117`'s own CHECK anticipates this ("what is forbidden is an
-- actor without a time"), and the customer's grant list can then tell an
-- engagement a human ended from one that simply ran out. It is also what keeps
-- this function narrow: an actor parameter would be a value the caller supplies
-- and the function writes.
--
-- ## Why not reuse it for the human revocation path
--
-- `revokeDelegatedAccess` names the person who revoked and their reason, and it
-- runs as `awcms_app`, which already holds every privilege it needs. Pushing it
-- through here would widen this function with an actor and a free-text reason
-- for no gain. The two paths are held to the same END STATE by
-- `tests/integration/delegated-access-expiry.integration.test.ts`, which runs
-- both and compares — a behavioural anchor rather than a comment asking the
-- next author to remember.
--
-- Idempotent: the role is created only if absent, policies are guarded, the
-- function is `CREATE OR REPLACE`, and the sweep itself is naturally re-runnable
-- (a second pass finds the same rows already revoked and matches none of them).

BEGIN;

-- 1. The owner role. NOLOGIN, no members, no bypass — reachable only as this
--    function's definer, exactly like `awcms_partner_view` and
--    `awcms_domain_bootstrap` before it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'awcms_delegated_expiry'
  ) THEN
    CREATE ROLE awcms_delegated_expiry
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO awcms_delegated_expiry;

GRANT SELECT, UPDATE ON awcms_delegated_access_grants TO awcms_delegated_expiry;
GRANT SELECT, UPDATE ON awcms_tenant_users TO awcms_delegated_expiry;
GRANT SELECT, UPDATE ON awcms_sessions TO awcms_delegated_expiry;

-- 2. Policies for that role alone. `USING (true)` is safe here in a way it
--    would never be on a login role: nothing can act as `awcms_delegated_expiry`
--    except the function below, and the function's own predicates are the
--    boundary. Permissive, so `awcms_app`'s tenant isolation is untouched.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'awcms_delegated_access_grants',
    'awcms_tenant_users',
    'awcms_sessions'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = target
        AND policyname = target || '_delegated_expiry_sweep'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR SELECT TO awcms_delegated_expiry USING (true)',
        target || '_delegated_expiry_sweep',
        target
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE tablename = target
        AND policyname = target || '_delegated_expiry_write'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR UPDATE TO awcms_delegated_expiry '
        || 'USING (true) WITH CHECK (true)',
        target || '_delegated_expiry_write',
        target
      );
    END IF;
  END LOOP;
END
$$;

-- 3. The function. One tenant, one batch size, one integer back.
CREATE OR REPLACE FUNCTION awcms_expire_delegated_access_grants(
  p_tenant_id uuid,
  p_limit integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  expired_grant record;
  expired_identity uuid;
  swept integer := 0;
BEGIN
  -- A hostile or careless batch size must not turn this into a full-table
  -- sweep held in one transaction. Clamped rather than rejected: the caller's
  -- intent ("drain some backlog") is served either way.
  IF p_limit IS NULL OR p_limit < 1 THEN
    p_limit := 1;
  ELSIF p_limit > 1000 THEN
    p_limit := 1000;
  END IF;

  FOR expired_grant IN
    UPDATE awcms_delegated_access_grants
    SET revoked_at = now(),
        revoke_reason = 'expired',
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND id IN (
        SELECT id FROM awcms_delegated_access_grants
        WHERE tenant_id = p_tenant_id
          AND revoked_at IS NULL
          AND expires_at <= now()
        ORDER BY expires_at
        LIMIT p_limit
      )
    RETURNING granted_tenant_user_id
  LOOP
    swept := swept + 1;

    -- Never redeemed: there is no membership to end, and the code can no
    -- longer be redeemed because every redemption path demands
    -- `revoked_at IS NULL`.
    CONTINUE WHEN expired_grant.granted_tenant_user_id IS NULL;

    UPDATE awcms_tenant_users
    SET status = 'inactive',
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND id = expired_grant.granted_tenant_user_id
      AND principal_kind = 'delegated'
    RETURNING identity_id INTO expired_identity;

    CONTINUE WHEN expired_identity IS NULL;

    UPDATE awcms_sessions
    SET revoked_at = now()
    WHERE tenant_id = p_tenant_id
      AND identity_id = expired_identity
      AND revoked_at IS NULL;
  END LOOP;

  RETURN swept;
END;
$function$;

COMMENT ON FUNCTION awcms_expire_delegated_access_grants(uuid, integer) IS
  'ADR-0090. Ends delegated support episodes whose grant has run out: the grant is revoked with reason ''expired'' and no actor, its delegated tenant user goes inactive, and its live sessions are revoked. Narrow SECURITY DEFINER with the sql/048 safeguards and a dedicated NOLOGIN memberless owner (awcms_delegated_expiry). It takes a tenant id and a batch size and nothing else, so no caller-supplied value is ever written — every literal is in sql/142. Each of its three statements is guarded so it can only REMOVE access: revoked_at only moves from NULL, status is the literal ''inactive'' behind principal_kind = ''delegated'', and a session''s revoked_at only moves from NULL. EXECUTE restricted to awcms_worker. This is CLEANUP: expiry itself takes effect at the instant on the row, enforced by resolveDelegatedGrantState at the chokepoint.';

REVOKE ALL ON FUNCTION awcms_expire_delegated_access_grants(uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_expire_delegated_access_grants(uuid, integer)
  TO awcms_worker;

-- Reassign so SECURITY DEFINER really runs as that role. Requires SUPERUSER at
-- migration time — an invariant this repo already demands.
ALTER FUNCTION awcms_expire_delegated_access_grants(uuid, integer)
  OWNER TO awcms_delegated_expiry;

COMMIT;
