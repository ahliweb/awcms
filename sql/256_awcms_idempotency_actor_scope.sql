-- Idempotency keys are scoped per ACTOR (ADR-0129 amendment 1, audit F4 of #990,
-- issue #1000).
--
-- Before: the unique key was (tenant_id, request_scope, idempotency_key). The
-- actor lived only in some callers' request hash, so a colleague who guessed a
-- predictable key first made the victim's request answer 409 (a denial of
-- service, and a confirmation that the key was in use), and a caller whose hash
-- did not include the actor could be handed another user's stored response.
--
-- After: (tenant_id, request_scope, actor_key, idempotency_key). `actor_key` is
-- `user:<tenant_user_id>` or `anonymous`; `machine:<id>` is accepted for
-- non-user callers. A machine-credential bearer is scoped by its linked
-- service-account tenant user (`user:`), i.e. per service account (see
-- `src/modules/_shared/idempotency.ts`). A different actor presenting the same
-- key is simply a different record.
--
-- Existing rows get `legacy:unscoped`. A pre-migration row can never be
-- replayed to anyone, because a lookup under a real actor never matches it.
-- Instead, `findIdempotencyRecord` treats a legacy row for the same (tenant,
-- scope, key) created within 24 hours as a CONFLICT, so a client that retries
-- across the deploy gets 409 and the mutation is not run a second time. After
-- 24 hours the legacy row no longer blocks anything. No retention job exists
-- for this table today (rows persist); retention is tracked in
-- ahliweb/awcms#1034.
--
-- The new unique index is built while holding a SHARE lock on the table (a
-- plain CREATE UNIQUE INDEX, inside the migration transaction): reads continue,
-- idempotent writes wait for the build. The table is small relative to the
-- business tables and the build is a single scan, but run the migration in a
-- quiet window on a very large installation. There is no down migration;
-- rolling back means a forward fix, never re-adding the old index (it would
-- re-open the cross-actor squat).
--
-- Deploy order: this migration runs BEFORE the new code starts. The old code's
-- `ON CONFLICT (tenant_id, request_scope, idempotency_key)` has no matching
-- index once the old one is dropped, so an old instance still serving traffic
-- would fail its idempotent mutations closed (500) until it is replaced. That
-- is the intended failure direction: a rolling deploy must not leave an
-- instance that stores records without an actor.
--
-- Tenant isolation is unchanged: the table keeps its FORCE ROW LEVEL SECURITY
-- policy on `tenant_id`.

ALTER TABLE awcms_idempotency_keys
  ADD COLUMN IF NOT EXISTS actor_key text NOT NULL DEFAULT 'legacy:unscoped';

-- Every new insert must name its actor; the default existed only to backfill.
ALTER TABLE awcms_idempotency_keys
  ALTER COLUMN actor_key DROP DEFAULT;

ALTER TABLE awcms_idempotency_keys
  DROP CONSTRAINT IF EXISTS awcms_idempotency_keys_actor_key_shape;

ALTER TABLE awcms_idempotency_keys
  ADD CONSTRAINT awcms_idempotency_keys_actor_key_shape
  CHECK (
    actor_key IN ('anonymous', 'legacy:unscoped')
    OR actor_key ~ '^(user|machine):.{1,100}$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS awcms_idempotency_keys_scope_actor_key
  ON awcms_idempotency_keys (tenant_id, request_scope, actor_key, idempotency_key);

DROP INDEX IF EXISTS awcms_idempotency_keys_scope_key;
