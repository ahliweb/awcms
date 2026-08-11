-- Gelombang 7 PR 7.1 (Issue #423), ADR-0085 — one human, one credential, many
-- tenants.
--
-- `awcms_principals` is GLOBAL and has no RLS. `awcms_identities` keeps every
-- row, every id, and all eight incoming foreign keys exactly where they are; it
-- gains ONE nullable column pointing at the principal it belongs to.
--
-- Nothing authenticates against a principal yet. This migration creates the
-- rows and the link; PR 7.2 moves the login path onto them. That split is
-- deliberate — a migration that both invents a credential store AND starts
-- authenticating with it has no state in which it can be verified.
--
-- ## The sentence this table stands on
--
-- **A principal is an AUTHENTICATION fact, never an AUTHORIZATION fact.**
--
-- `awcms_permissions` is the precedent for a global table, but it is a catalogue
-- that grants nothing by existing. A credential table is not that, so four
-- controls replace RLS here, and ADR-0085 records all four:
--
--   1. database privileges narrowed — `REVOKE ALL`, then SELECT/INSERT/UPDATE,
--      and NEVER DELETE (below);
--   2. a read-shape invariant checked by machine —
--      `bun run identity:principal-access:check`, which allows only listed files
--      to name this table and requires every query in them to be keyed on `id =`
--      or `email_normalized =`. RLS bounds ROWS; that gate bounds CALL SITES;
--   3. a projection invariant — `password_hash` never leaves the store module;
--   4. the authorization boundary does not move — holding a principal grants
--      nothing, and every permission still resolves through `awcms_tenant_users`
--      under FORCE RLS.
--
-- ## Why this migration REFUSES to run on a colliding database
--
-- `awcms_identities` is UNIQUE on `(tenant_id, login_identifier)`, so `A@x.com`
-- and `a@x.com` are two legal rows in one tenant today and one principal
-- afterwards. Merging them is never a patch — it is a conversation with a
-- customer about which row is the person and which is a duplicate.
--
-- So the DO block below raises rather than guessing. `bun run
-- identity:principals:preflight` (#440) answers the same question read-only and
-- months earlier, which is the entire reason it was built before this file.
-- Hitting this exception in a deploy window means the census was not run.
--
-- ## Why the backfill is safe: it moves no secret and can lock nobody out
--
-- `password_hash` is left NULL on every principal. Credentials are PROMOTED on
-- the first successful login (PR 7.2): the password is verified against the
-- IDENTITY's hash exactly as it is today, and only then written to the
-- principal. Until that happens the principal is an empty shell that
-- authenticates nothing, so a backfill that got something wrong cannot refuse
-- anyone — the identity row is still the only credential in play.
--
-- ## Normalization is `lower(btrim(...))`, and nothing cleverer
--
-- The SAME rule `normalizeLoginIdentifier` applies in TypeScript. No
-- dot-stripping, no `+tag` removal, no Unicode folding: each of those merges
-- addresses that are genuinely different people at some providers, and a merge
-- is unrecoverable in a way a collision report is not.

BEGIN;

-- 1. FORCE off first, then refuse the whole migration on any within-tenant
--    collision.
--
-- The ORDER of these two is load-bearing, and getting it wrong is silent.
-- `awcms_identities` is FORCE RLS and its policy reads
-- `current_setting('app.current_tenant_id')`; a cross-tenant count issued before
-- the toggle either raises on the unset GUC or matches nothing. A collision
-- check that can only ever see zero rows is a check that always passes — the
-- exact shape of gate this repo has repeatedly paid for. The toggle is what
-- makes the count able to fail.
--
-- If the exception fires, the whole transaction rolls back and `FORCE` comes
-- back with it. There is no state in which this migration leaves RLS relaxed.
ALTER TABLE awcms_identities NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  collisions bigint;
BEGIN
  SELECT count(*) INTO collisions
  FROM (
    SELECT tenant_id, lower(btrim(login_identifier))
    FROM awcms_identities
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) AS c;

  IF collisions > 0 THEN
    RAISE EXCEPTION
      'awcms_principals: % within-tenant identifier collision(s) must be resolved before this migration can run. Run `bun run identity:principals:preflight` for the per-row report. Each collision is a decision about which account is the person — not something a migration may take.',
      collisions;
  END IF;
END
$$;

-- 2. The table.
CREATE TABLE IF NOT EXISTS awcms_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The global key. UNIQUE without a tenant column, which is the entire point:
  -- one human, one row, regardless of how many tenants they belong to.
  email_normalized text NOT NULL,
  -- NULL until the first successful login promotes it (PR 7.2). Nullable is
  -- load-bearing, not laziness: a NOT NULL column would force this migration to
  -- COPY every password hash, and a backfill that moves secrets is a backfill
  -- whose failure mode is a credential in two places.
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT awcms_principals_email_normalized_check
    CHECK (email_normalized = lower(btrim(email_normalized))
           AND email_normalized <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS awcms_principals_email_key
  ON awcms_principals (email_normalized);

-- 3. The link. Nullable, and it stays nullable.
--
-- An identity created by a path that has not been taught about principals yet
-- must not fail; it must be visibly unlinked, which is a state a later pass can
-- find and fix. NOT NULL here would make every un-migrated writer a 500.
ALTER TABLE awcms_identities
  ADD COLUMN IF NOT EXISTS principal_id uuid REFERENCES awcms_principals (id);

-- ADR-0064 — an FK column must be index-reachable, and this one is not covered
-- by any existing index (`awcms_identities_tenant_login_key` leads with
-- `tenant_id`). The lookup this serves is "every membership of this human",
-- which is the query PR 7.4's tenant switch is built on.
CREATE INDEX IF NOT EXISTS awcms_identities_principal_idx
  ON awcms_identities (principal_id)
  WHERE principal_id IS NOT NULL;

-- 4. Backfill: one principal per distinct normalized address, then link.
--
-- Still inside the `NO FORCE` window opened in step 1 — this is CROSS-TENANT
-- DML, and the owner is not exempt from FORCE (`sql/103` established the
-- pattern). `FORCE` is restored immediately after.
INSERT INTO awcms_principals (email_normalized)
SELECT DISTINCT lower(btrim(i.login_identifier))
FROM awcms_identities i
ON CONFLICT (email_normalized) DO NOTHING;

UPDATE awcms_identities i
SET principal_id = p.id
FROM awcms_principals p
WHERE p.email_normalized = lower(btrim(i.login_identifier))
  AND i.principal_id IS NULL;

ALTER TABLE awcms_identities FORCE ROW LEVEL SECURITY;

-- 5. Privileges — control 1 of the four that replace RLS.
--
-- `sql/019` grants all four verbs on every new table by default, so this is a
-- REQUIRED narrowing rather than decoration — the same omission `sql/109`
-- shipped with and the DB-gated suite caught.
--
-- DELETE is withheld permanently, and the reason is not tidiness. A principal is
-- the object a human's whole login depends on across every tenant; the runtime
-- has no operation that should remove one, and the recovery from a wrongly
-- deleted row is a restore, not an INSERT — every `awcms_identities.principal_id`
-- pointing at it would have to be re-derived. UPDATE is retained because PR 7.2
-- promotes the credential into it.
REVOKE ALL ON awcms_principals FROM awcms_app;
GRANT SELECT, INSERT, UPDATE ON awcms_principals TO awcms_app;

-- `awcms_worker` gets nothing at all. No scheduled job reads or writes a
-- credential, and `WORKER_ROLE_GRANTS` states the rule: any `awcms_%` table not
-- keyed there must be ungranted for that role.

COMMENT ON TABLE awcms_principals IS
  'One human, one credential, many tenants (ADR-0085). GLOBAL and RLS-free, and the sentence that makes that defensible is: a principal is an AUTHENTICATION fact, never an AUTHORIZATION fact. Holding one grants nothing — every permission still resolves through awcms_tenant_users under FORCE RLS. Four controls replace RLS here: narrowed privileges (never DELETE), the machine-checked read-shape invariant identity:principal-access:check, password_hash never leaving the store module, and an unchanged authorization boundary.';

COMMENT ON COLUMN awcms_principals.password_hash IS
  'NULL until the first successful login PROMOTES it (PR 7.2): the password is verified against the identity hash exactly as today, and only then written here. That is what makes the sql/112 backfill safe — it moves no secret and can lock nobody out, because until promotion the identity row is still the only credential in play.';

COMMENT ON COLUMN awcms_identities.principal_id IS
  'The global principal this tenant-scoped identity belongs to (ADR-0085). Nullable on purpose: an identity created by a writer not yet taught about principals must be visibly unlinked rather than a 500. awcms_identities.id and all eight incoming foreign keys are unchanged — this migration lowers what the row MEANS without moving anything physical.';

COMMIT;
