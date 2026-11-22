-- `channel_accounts`: an external id is claimed by VERIFICATION, not by
-- registration (Issue #1215, external-id squatting; ADR-0170 amends ADR-0148
-- invariant I1; owner decision K2 of 22 November 2026: options A + C).
--
-- ## The defect this closes
--
-- `awcms_channel_accounts_live_external_key` (sql/318) was unique on
-- `(provider, external_id)` across tenants for EVERY live row, and a
-- registration starts `pending`, unverified. A tenant could therefore register
-- somebody else's public id (a page id, a phone number id, a bot id) first, and
-- the real owner would then be answered `409 ACCOUNT_ALREADY_REGISTERED` with no
-- recourse.
--
-- ## What changes
--
-- 1. `claim_basis` (NOT NULL, default `registration`, immutable): how this row
--    comes to hold the global claim.
--
--      registration  the row holds the claim from the moment it is live, in
--                    every status (the behaviour of sql/318, and the fail-closed
--                    one). It is the basis of every provider/kind for which this
--                    repository has NO call that proves control of the id.
--      verification  the row holds the claim only while it is `connected` or
--                    `degraded`, i.e. after a connector proved control of the
--                    id and `recordAccountHealth` moved it there. A `pending`
--                    row of this basis holds nothing against other tenants.
--
--    The application chooses the basis at INSERT from one code table
--    (`claimBasisFor`, pinned by a test); it never writes it afterwards, and a
--    trigger refuses a change by every role. Every row that exists when this
--    migration runs becomes `registration` (the column default): a claim is
--    never released by a migration.
--
-- 2. The global unique index is rebuilt PARTIAL: live rows that hold the claim.
--    The first row of a verification-basis id to become `connected` wins; the
--    other is refused by the index (23505) at the moment it would verify, which
--    is race-safe without any application lock.
--
-- 3. A per-tenant unique index over ALL live rows of `(tenant_id, provider,
--    external_id)`: one tenant cannot register the same id twice, whatever the
--    status or basis (the duplicate answer for "yours" is unchanged).
--
-- 4. The platform release action (option C): a PLATFORM-scoped permission
--    `channel_accounts.account_claims.revoke` (never in the catalogue seeded to
--    tenant roles) and one narrow SECURITY DEFINER read, the locator that finds
--    which tenant's row holds a contested claim. The release itself runs in the
--    holder tenant's own RLS context with the existing delete code; the definer
--    never writes.
--
-- ## Deploy note
--
-- No `CONCURRENTLY`: the migration runner wraps each file in a transaction. A
-- plain `CREATE UNIQUE INDEX` takes a SHARE lock on `awcms_channel_accounts`
-- while it builds. The table holds one row per connected external account (tens
-- per tenant at most) and the module ships OFF (`CHANNEL_ACCOUNTS_ENABLED`), so
-- the lock is held for milliseconds. Neither index can fail on existing data:
-- the old index already made every live `(provider, external_id)` unique, and
-- both new predicates select a subset of it or a per-tenant refinement of it.
-- The old index is dropped and recreated under the SAME name inside this one
-- transaction, so no instant exists in which the claim is unprotected.
--
-- Forward-only.

ALTER TABLE awcms_channel_accounts
  ADD COLUMN IF NOT EXISTS claim_basis text NOT NULL DEFAULT 'registration';

ALTER TABLE awcms_channel_accounts
  ADD CONSTRAINT awcms_channel_accounts_claim_basis_check
  CHECK (claim_basis IN ('registration', 'verification'));

COMMENT ON COLUMN awcms_channel_accounts.claim_basis IS
  'Issue #1215 / ADR-0170 — how this row holds the GLOBAL (provider, external_id) claim. registration (default, fail-closed): from the moment it is live, any status. verification: only while connected or degraded, after a connector proved control of the id. Chosen at INSERT from the code table claimBasisFor; immutable (trigger).';

CREATE OR REPLACE FUNCTION awcms_channel_accounts_claim_basis_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NEW.claim_basis IS DISTINCT FROM OLD.claim_basis THEN
    RAISE EXCEPTION 'the claim basis of a channel account is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER awcms_channel_accounts_claim_basis_guard
  BEFORE UPDATE OF claim_basis ON awcms_channel_accounts
  FOR EACH ROW
  EXECUTE FUNCTION awcms_channel_accounts_claim_basis_guard();

-- I1 (amended): a live external account is held by exactly ONE tenant, where
-- "holds" is registration for the providers that cannot be verified and
-- verification for those that can. NOT scoped by tenant_id on purpose.
DROP INDEX IF EXISTS awcms_channel_accounts_live_external_key;

CREATE UNIQUE INDEX awcms_channel_accounts_live_external_key
  ON awcms_channel_accounts (provider, external_id)
  WHERE deleted_at IS NULL
    AND (claim_basis = 'registration' OR status IN ('connected', 'degraded'));

CREATE UNIQUE INDEX IF NOT EXISTS awcms_channel_accounts_tenant_external_key
  ON awcms_channel_accounts (tenant_id, provider, external_id)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Option C: the platform release action
-- ---------------------------------------------------------------------------

-- PLATFORM-scoped (ADR-0053): releasing a claim ends ANOTHER tenant's account,
-- so no tenant may hold it however its roles are arranged. Granted to the owner
-- of the SETUP tenant only (the pattern of sql/092); a deployment whose platform
-- tenant is not the setup tenant runs `identity-access:permissions:backfill`.
INSERT INTO awcms_permissions (module_key, activity_code, action, description, scope)
VALUES
  ('channel_accounts', 'account_claims', 'revoke',
   'PLATFORM: release a contested external-account claim held by another tenant (soft-deletes the holder account and erases its credential; critical audit in both tenants'' trails)', 'platform')
ON CONFLICT (module_key, activity_code, action) DO NOTHING;

INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
SELECT r.tenant_id, r.id, p.id
FROM awcms_setup_state s
JOIN awcms_roles r
  ON r.tenant_id = s.tenant_id AND r.role_code = 'owner' AND r.deleted_at IS NULL
JOIN awcms_permissions p
  ON p.module_key = 'channel_accounts'
 AND p.activity_code = 'account_claims'
 AND p.action = 'revoke'
WHERE NOT EXISTS (
  SELECT 1 FROM awcms_role_permissions rp
  WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id AND rp.permission_id = p.id
);

-- The locator: which row holds a contested claim. `awcms_channel_accounts` is
-- FORCE RLS, so a platform request cannot see another tenant's row; this is the
-- one cross-tenant READ, in the shape of sql/048 and sql/119:
--
--   1. a dedicated NOLOGIN owner role, no members, never a superuser;
--   2. an explicit SELECT policy for that role only (permissive, so it is OR-ed
--      with the tenant isolation policy and replaces nothing: a direct SELECT
--      by `awcms_app` stays fail-closed);
--   3. a FIXED column list: the boundary is the columns, not the RLS;
--   4. EXECUTE revoked from PUBLIC and granted to `awcms_app` only.
--
-- It REQUIRES both the provider and the external id (equality, no pattern) and
-- returns at most the single row the unique index allows: it is a lookup, not a
-- directory. It never returns the display name, the credential reference, the
-- connection or any person.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awcms_channel_claim_locator') THEN
    CREATE ROLE awcms_channel_claim_locator
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

ALTER ROLE awcms_channel_claim_locator
  NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;

GRANT USAGE ON SCHEMA public TO awcms_channel_claim_locator;

GRANT SELECT (
  id, tenant_id, provider, account_kind, external_id, status, claim_basis,
  deleted_at
) ON awcms_channel_accounts TO awcms_channel_claim_locator;

CREATE POLICY awcms_channel_accounts_claim_locator_read
  ON awcms_channel_accounts
  FOR SELECT
  TO awcms_channel_claim_locator
  USING (true);

CREATE OR REPLACE FUNCTION awcms_find_channel_account_claim_holder(
  p_provider text,
  p_external_id text
)
RETURNS TABLE (
  tenant_id uuid,
  account_id uuid,
  account_kind text,
  status text,
  claim_basis text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT a.tenant_id, a.id, a.account_kind, a.status, a.claim_basis
  FROM awcms_channel_accounts AS a
  WHERE a.provider = p_provider
    AND a.external_id = p_external_id
    AND a.deleted_at IS NULL
    AND (a.claim_basis = 'registration' OR a.status IN ('connected', 'degraded'))
  LIMIT 1;
$function$;

COMMENT ON FUNCTION awcms_find_channel_account_claim_holder(text, text) IS
  'Issue #1215 / ADR-0170 option C. Which live row holds the global (provider, external_id) claim: the same predicate as awcms_channel_accounts_live_external_key. SECURITY DEFINER with the four sql/048 safeguards: NOLOGIN memberless owner awcms_channel_claim_locator, a SELECT policy for that role only, a fixed column list, EXECUTE for awcms_app only. Requires both arguments (equality), returns at most one row and never the display name, credential reference or any person. Called only by the platform release action, whose permission is platform-scoped.';

REVOKE ALL ON FUNCTION awcms_find_channel_account_claim_holder(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION awcms_find_channel_account_claim_holder(text, text) TO awcms_app;

ALTER FUNCTION awcms_find_channel_account_claim_holder(text, text)
  OWNER TO awcms_channel_claim_locator;
