-- Issue ahliweb/omes#198 (ADR-0122) — enrollment challenge issuance columns.
--
-- `awcms_omes_enrollments` (sql/154) was created with `public_key NOT NULL`,
-- which is correct for a row written by the (out of scope here, ahliweb/
-- omes#199) pull-worker enrollment exchange — the worker always presents its
-- public key at that point. It cannot hold for a row AWCMS itself creates
-- when an OPERATOR issues an enrollment challenge for a server that has not
-- enrolled yet: the public key does not exist until the worker generates its
-- keypair and presents it later.
--
-- This migration:
--   * makes `public_key` nullable (a `pending` challenge row has none yet);
--   * adds `enrollment_challenge_hash` — sha256 of the one-time challenge
--     value AWCMS mints and returns to the operator ONCE. The raw challenge
--     is never persisted (same discipline as `awcms_sessions`/API-key hashing
--     elsewhere in this repo) — only its hash, so a later worker-enrollment
--     presentation (`ahliweb/omes#199`) can be verified by re-hashing and
--     comparing;
--   * adds `challenge_expires_at` — an issued-but-unused challenge is refused
--     as `pending` forever without this.
--
-- Additive only — no existing column is altered destructively, no data is
-- migrated, and 154/155/156 are left exactly as landed.

ALTER TABLE awcms_omes_enrollments
  ALTER COLUMN public_key DROP NOT NULL;

ALTER TABLE awcms_omes_enrollments
  ADD COLUMN IF NOT EXISTS enrollment_challenge_hash text,
  ADD COLUMN IF NOT EXISTS challenge_expires_at timestamptz;

-- A `pending` row must always carry a hash to verify against and an expiry —
-- both only for that status, since an `enrolled`/`revoked`/`expired` row's
-- challenge has already been consumed or invalidated and its hash is no
-- longer meaningful to keep around unredacted-shaped.
ALTER TABLE awcms_omes_enrollments
  ADD CONSTRAINT awcms_omes_enrollments_pending_challenge_check
    CHECK (
      status <> 'pending'
      OR (enrollment_challenge_hash IS NOT NULL AND challenge_expires_at IS NOT NULL)
    );
