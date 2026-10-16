-- Encrypt awcms_push_subscriptions.auth_secret at rest (Issue #1089), PHASE 1.
--
-- Follow-up to #1082. The RFC 8291 per-subscription auth secret is stored in
-- plaintext in `auth_secret`, readable by awcms_app and awcms_worker (the worker
-- needs it for the HKDF; it is a documented WORKER_CREDENTIAL_COLUMN_EXCEPTIONS
-- entry). A SQL migration has no access to the application key ring, so it
-- CANNOT encrypt the existing rows. The rollout is therefore expand / migrate /
-- contract, and this file is only the EXPAND step:
--
--   1. (this file)  add `auth_secret_ciphertext` and relax the transport CHECK so
--                   a web_push row may carry the secret in EITHER column.
--   2. (code)       registration writes ciphertext only; the dispatcher decrypts
--                   ciphertext and falls back to plaintext only for a row that
--                   has no ciphertext yet.
--   3. (runtime)    `bun run push:auth-secret:backfill` encrypts the remaining
--                   rows under the key ring and NULLs the plaintext. Idempotent,
--                   resumable, batched, keyset.
--   4. (LATER migration, NOT in this PR)  once `security:readiness` reports ZERO
--                   plaintext rows on every deployment: DROP COLUMN auth_secret,
--                   tighten the CHECK to require the ciphertext, and remove the
--                   `awcms_push_subscriptions.auth_secret` worker exception.
--
-- The plaintext column is deliberately NOT dropped here: a deployment that has
-- not yet run the backfill would lose every subscription's secret, and push to
-- all of those devices would silently stop.
--
-- ## Ciphertext format and binding
--
-- ADR-0137 envelope (AES-256-GCM, `v2:<keyId>:<iv>:<tag>:<ct>`), written under the
-- FIRST key of PUSH_AUTH_SECRET_ENCRYPTION_KEYS and read under whichever key the
-- envelope names (rotation = add a key in front, keep the old ones). The AAD is
-- (purpose, tenant_id, row id), where the row id is the subscription's
-- `endpoint_hash` and NOT `id`: registration is an upsert keyed on
-- (tenant_id, endpoint_hash), so `id` of the surviving row is unknown until the
-- statement has run, while the hash is known before it and is immutable for the
-- row's life. A ciphertext copied to another row (or tenant) fails to
-- authenticate.
--
-- ## CHECK changes
--
--   web_push : p256dh_key present AND exactly ONE of auth_secret /
--              auth_secret_ciphertext present
--   fcm      : none of the three present
--
-- "Exactly one" is the safer shape: a row holding both would let a stale
-- ciphertext shadow a newer plaintext (an app rollback re-registering with the
-- old code) and deliver with the wrong secret, silently. Failing the write loudly
-- is the better failure. See the runbook for the rollback note.
--
-- ## Worker grants
--
-- The worker held TABLE-level INSERT and UPDATE on this table, so it could
-- rewrite `endpoint`/`p256dh_key`, or DELETE a row and INSERT it back with the
-- same id and endpoint_hash but an attacker endpoint and key (the dispatcher
-- then delivered to the attacker using the victim's decrypted secret). Its real
-- writes are: dispatch (status, disabled_reason, last_success_at, updated_at),
-- the backfill (auth_secret NULLed, auth_secret_ciphertext set), and DELETE for
-- the purge. It never inserts (only the app registers a device).
--
--   awcms_worker AFTER this file:  SELECT (table-wide), DELETE,
--     UPDATE (status, disabled_reason, last_success_at, updated_at,
--             auth_secret, auth_secret_ciphertext)  -- pinned in
--     WORKER_COLUMN_GRANTS.
--   awcms_worker CANNOT: INSERT; UPDATE endpoint / endpoint_hash / p256dh_key /
--     tenant or user columns.
--   What it STILL can do, and why that is accepted: DELETE a subscription (the
--     purge needs it; deleting a device only stops notifications), and UPDATE
--     auth_secret / auth_secret_ciphertext (the backfill needs it; a worker that
--     writes garbage there makes delivery fail, it cannot redirect it).
--   Defence in depth: the dispatcher refuses a row whose endpoint does not hash
--     to its endpoint_hash, and the ciphertext AAD binds that hash.
--
-- SELECT stays table-wide (the dispatcher needs the endpoint, the keys and the
-- ciphertext); the new ciphertext column is a documented worker exception in
-- security-readiness, like telegram's chat_ciphertext.
--
-- Pure DDL, no rows written.

ALTER TABLE awcms_push_subscriptions
  ADD COLUMN IF NOT EXISTS auth_secret_ciphertext text;

ALTER TABLE awcms_push_subscriptions
  DROP CONSTRAINT IF EXISTS awcms_push_subscriptions_keys_match_transport_check;

ALTER TABLE awcms_push_subscriptions
  ADD CONSTRAINT awcms_push_subscriptions_keys_match_transport_check
  CHECK (
    (transport = 'web_push'
      AND p256dh_key IS NOT NULL
      AND ((auth_secret IS NOT NULL) <> (auth_secret_ciphertext IS NOT NULL)))
    OR (transport = 'fcm'
      AND p256dh_key IS NULL
      AND auth_secret IS NULL
      AND auth_secret_ciphertext IS NULL)
  );

-- The backfill's work-finding predicate and the readiness count.
CREATE INDEX IF NOT EXISTS awcms_push_subscriptions_plaintext_secret_idx
  ON awcms_push_subscriptions (tenant_id, id)
  WHERE auth_secret IS NOT NULL;

-- NOTE: a REVOKE only removes a privilege granted BY THE SAME GRANTOR (see
-- sql/304). `security:readiness` (the grant matrix) asks has_*_privilege
-- afterwards and fails the deploy if this was a no-op.
REVOKE INSERT, UPDATE ON awcms_push_subscriptions FROM awcms_worker;
GRANT UPDATE (status, disabled_reason, last_success_at, updated_at,
              auth_secret, auth_secret_ciphertext)
  ON awcms_push_subscriptions TO awcms_worker;
