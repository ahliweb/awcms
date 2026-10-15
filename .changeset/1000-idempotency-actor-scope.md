---
"awcms": minor
---

security(idempotency): idempotency keys are scoped per actor and the request hash is keyed (#1000, audit F4 of #990, ADR-0145).

- Migration 256: `awcms_idempotency_keys` gains `actor_key` and is unique on `(tenant_id, request_scope, actor_key, idempotency_key)`. A colleague can no longer claim another user's predictable key (the victim used to get `409`) or be replayed their stored response. Pre-existing rows become `legacy:unscoped`: for 24 hours a retry with the same key answers `409 IDEMPOTENCY_CONFLICT` (never the stored body), after which the row blocks nothing.
- `findIdempotencyRecord`/`saveIdempotencyRecord` take an explicit branded `IdempotencyActor` (`userIdempotencyActor`, `machineIdempotencyActor`, `ANONYMOUS_IDEMPOTENCY_ACTOR`); all ~100 callers updated.
- `computeRequestHash` is now HMAC-SHA-256 keyed by the new `IDEMPOTENCY_HMAC_SECRET` (required in production, >= 32 characters; fail closed otherwise; per-process random key outside production). Rotating it answers `409` for retries of requests recorded before the change; rotate in a quiet period.

**Upgrade note (required before deploying).**

- Set `IDEMPOTENCY_HMAC_SECRET` (at least 32 characters, e.g. `openssl rand -base64 48`) in every production environment. Without it the server refuses to start and `config:validate` fails.
- Run `bun run db:migrate` (migration 256) and redeploy back-to-back, or use a maintenance window. Migration 256 drops the old unique index, so an old instance still serving traffic fails its idempotent mutations with a 500 until it is replaced.
- For 24 hours after the migration, a retry that carries the key of a request stored before it answers `409 IDEMPOTENCY_CONFLICT` instead of running again.
- Rollback is forward-fix only (see ADR-0145): do not re-add the old index.
