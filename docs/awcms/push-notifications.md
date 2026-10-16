🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](push-notifications.id.md)

# Push Notifications — Auth Secret at Rest and Rollout Runbook

Scope: the `push_delivery` module (ADR-0074), specifically how the RFC 8291
per-subscription `auth_secret` is stored (Issue #1089, follow-up to #1082). The
module itself is described in `src/modules/push-delivery/README.md`.

## What changed

`awcms_push_subscriptions.auth_secret` was plaintext, readable by `awcms_app` and
`awcms_worker`. It is now **ciphertext** in `auth_secret_ciphertext`
(`sql/314`): AES-256-GCM through the shared ADR-0137 helper, under its own key
ring `PUSH_AUTH_SECRET_ENCRYPTION_KEYS` (same `keyId:base64,...` format and
rotation rule as `TELEGRAM_CHAT_ENCRYPTION_KEYS`: the first key writes, every key
reads).

The AAD is `(purpose, tenant_id, endpoint_hash)`. This mirrors
`awcms_telegram_bindings.chat_ciphertext` (which binds the row `id`) with one
deliberate difference: registration is an upsert keyed on
`(tenant_id, endpoint_hash)`, so the surviving row's `id` is unknown until the
statement has run, whereas the hash is known beforehand and never changes. A
ciphertext copied to another subscription or tenant fails authentication.

## Trade-offs decided

| Decision                                              | Choice                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key ring absent at registration                       | **Fail closed**: `503 PUSH_MISCONFIGURED`, nothing stored; `GET` reports `webPush.enabled=false`                                                                                                  | A legacy-plaintext fallback would keep writing rows the backfill must chase, so the rollout could never converge, and it would silently keep the exact exposure this change removes. A device that cannot register can retry once the key is set; a leaked secret cannot be recalled. `fcm` rows carry no secret and need no ring.                                                                                                                               |
| Dispatcher, row has ciphertext                        | Decrypt; **never** fall back to plaintext                                                                                                                                                         | A fallback would let a stale plaintext shadow a failed (tampered/moved) ciphertext.                                                                                                                                                                                                                                                                                                                                                                              |
| Dispatcher, row has no ciphertext                     | Use legacy plaintext                                                                                                                                                                              | Transition window only; ends with the backfill and the column drop.                                                                                                                                                                                                                                                                                                                                                                                              |
| Dispatcher, ciphertext but no ring / key rotated away | **Retryable** failure with a fixed message                                                                                                                                                        | Operator-fixable configuration; the message is not lost.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Dispatcher, ciphertext fails authentication           | **Non-retryable** failure                                                                                                                                                                         | Tampered or moved data; retrying cannot help.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Row holds both columns                                | Refused by CHECK ("exactly one")                                                                                                                                                                  | A stale ciphertext must not shadow a newer plaintext.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Plaintext column                                      | **Kept** in this change (phase 1)                                                                                                                                                                 | A migration cannot encrypt; dropping it before the backfill would destroy every existing subscription's secret.                                                                                                                                                                                                                                                                                                                                                  |
| Worker grants                                         | `INSERT` revoked; `UPDATE` narrowed to `status, disabled_reason, last_success_at, updated_at, auth_secret, auth_secret_ciphertext` (pinned in `WORKER_COLUMN_GRANTS`); `SELECT` and `DELETE` stay | The worker could rewrite `endpoint`/`p256dh_key`, or DELETE a row and INSERT it back with an attacker endpoint and the victim's copied ciphertext (the same `id`/`endpoint_hash`). It **can** still delete a subscription (the purge needs it; only stops notifications) and write the two secret columns (the backfill needs it; garbage there makes delivery fail, it cannot redirect it). It **cannot** insert, or change the endpoint, its hash or the keys. |
| Row identity at delivery                              | The dispatcher refuses (non-retryable, fixed message) a row whose `endpoint` does not hash to `endpoint_hash`                                                                                     | Defence in depth: the hash is the ciphertext AAD, and a forged row must not be delivered with a decrypted secret. Checked outside the DB transaction, so a refusal never counts as a database failure in the circuit breaker.                                                                                                                                                                                                                                    |

## Operator runbook: rollout order

Order matters. Doing step 4 before step 1 or 2 stops registrations (by design);
doing the column drop before step 5 loses secrets.

1. **Generate and store the key ring** (secret store, not the repo):
   `PUSH_AUTH_SECRET_ENCRYPTION_KEYS=k1:$(openssl rand -base64 32)`. It must
   differ from every other ring. Provide it to the **app**, `push:dispatch` and
   `push:auth-secret:backfill` (it is in `ops/awcms-jobs.env-allowlist`).
   `bun run config:validate` checks it when `PUSH_PROVIDER=web_push`.
2. **Deploy the release** (runs `sql/314`: adds the column, relaxes the CHECK,
   narrows worker UPDATE). From here: new/re-registered devices are ciphertext;
   old rows still deliver from plaintext.
3. **Run the backfill once** (as `awcms_worker`):
   `bun run push:auth-secret:backfill`. Idempotent and resumable: re-run it after
   a crash or a non-zero exit (exit 2 = a tenant hit the batch cap; exit 1 = no
   key ring). It converts in bounded keyset batches, one transaction per batch.
4. **Verify**: `bun run security:readiness` check "Push subscription auth secrets
   are encrypted at rest" must PASS (it reports the plaintext row count while any
   remain; severity warning, since mid-rollout is expected).
5. **Later (separate PR, after every deployment passes step 4)**: a migration
   drops `auth_secret`, tightens the CHECK to require the ciphertext, and the
   `awcms_push_subscriptions.auth_secret` entry is removed from
   `WORKER_CREDENTIAL_COLUMN_EXCEPTIONS`.

### Rotation

Prepend a new key (`k2:<new>,k1:<old>`), deploy, keep `k1` until no row carries
it. Removing a key id still in use makes those rows undeliverable (retryable
failure, "ring lacks the key"). A re-registering device is re-encrypted under the
active key automatically.

### Rollback

Rolling the **application** back to a release without this change while rows are
ciphertext breaks delivery for those rows (the old code reads only `auth_secret`)
and makes the old registration upsert fail the "exactly one" CHECK. Roll forward
instead, or null the ciphertext only for rows you can re-collect. The migration
is additive; there is no down migration.

### Known limits

- Rotation has no re-key mode: rows are re-encrypted under the active key only when the device re-registers, and there is no per-key row count, so confirming a retired key is unused is manual (L3, tracked as a follow-up).
- Registration is an upsert on `(tenant_id, endpoint_hash)`; another user of the same tenant who learns a device's exact endpoint can overwrite that row's owner. This pre-dates #1089 and is not changed here (L4, tracked as a follow-up).

### Logging

The plaintext secret and the ciphertext appear in no log line, audit row, event
or API response; dispatcher failure messages are fixed strings.
