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

Operator runbook (Issue #1098; the same procedure applies to the Telegram ring,
see below):

1. Prepend a new key (`k2:<new>,k1:<old>`) to `PUSH_AUTH_SECRET_ENCRYPTION_KEYS`
   and deploy. The first key writes, every key reads, so nothing breaks while rows
   still carry `k1`.
2. Run `bun run push:auth-secret:rekey` (the `--rekey` mode of the backfill
   script). It re-encrypts every row whose ciphertext key id is not the active
   key. Idempotent, resumable and batched (keyset), runs as `awcms_worker`, and
   never prints key material or ciphertext. Exit codes: `1` no valid ring, `2` a
   tenant did not finish (run it again), `3` some rows could not be decrypted under
   the ring (they are counted and left untouched; this means a key they were
   written under is already missing from the ring: put it back, re-run).
3. Check `bun run security:readiness`, check "Push auth-secret ciphertexts are
   under the active key". It prints the row count per key id (counts only) and
   warns while any row remains under a key other than the active one.
4. Only when that check passes, remove `k1` from the ring and deploy. Removing a
   key id still in use makes those rows undeliverable (retryable failure, "ring
   lacks the key"). After a key COMPROMISE, run steps 1-4 immediately; the old key
   is retired as soon as step 3 is green.

**A re-key only rewraps; it does not undo a compromise.** Anyone who held the old
key and a copy of the data (database, backup, replica) can still read the secrets
they copied. After a compromise treat the push subscriptions as exposed: force
re-subscription (disable the rows, so each device registers again with a fresh
secret) and purge backups per policy. Telegram chat ids are disclosed PII.

**Last resort for rows that cannot be decrypted** (re-key exit code `3`, their key
is gone for good): the readiness check cannot go green while they remain. Disable
the push subscriptions (`disablePushSubscription`, or purge them through the
retention sweep) so devices re-subscribe; for Telegram, end the bindings with
`endBindings` so users re-link. Do not edit ciphertext by hand.

A re-registering device is also re-encrypted under the active key automatically.

#### Telegram chat ring

`TELEGRAM_CHAT_ENCRYPTION_KEYS` (`awcms_telegram_bindings.chat_ciphertext`) has the
same gap and the same procedure with `bun run telegram:chat:rekey` and the
readiness check "Telegram chat ciphertexts are under the active key". One
difference: this job runs as `awcms_app` (`DATABASE_URL`), not as the worker,
because the binding guard trigger (`sql/216`) refuses every other role any write
of a live chat ciphertext, so a worker holding the key ring cannot re-point a
binding at another chat. The trigger cannot tell a re-key from a swap, so it is
deliberately left as it is. Revoked and erased bindings carry no ciphertext and are
not touched; the hash ring `TELEGRAM_CHAT_HASH_KEYS` is a separate ring and is not
affected.

### Rollback

Rolling the **application** back to a release without this change while rows are
ciphertext breaks delivery for those rows (the old code reads only `auth_secret`)
and makes the old registration upsert fail the "exactly one" CHECK. Roll forward
instead, or null the ciphertext only for rows you can re-collect. The migration
is additive; there is no down migration.

### Known limits

- ~~Rotation has no re-key mode / no per-key row count~~ **Resolved (Issue #1098):** `bun run push:auth-secret:rekey`, `bun run telegram:chat:rekey` and the per-key-id readiness checks. See Rotation.
- ~~Registration takes a device over from another user in the same tenant~~ **Resolved as an explicit, audited transfer (Issue #1098), see below.** The residual risk is accepted: a tenant user who knows another user's exact endpoint (a capability URL, masked everywhere) can still move that device to themselves; the secret is not disclosed.

### Endpoint re-registration by another user (Issue #1098)

Registration is keyed on `(tenant_id, endpoint_hash)`. When the same endpoint is
registered by a different tenant user than the one who holds the row (**whatever
its status**: active, disabled or revoked), the row **moves to the new user**. Trade-off, decided:

| Option                                   | For                                                                                            | Against                                                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refuse when the owner differs (rejected) | Closes the takeover outright                                                                   | The endpoint belongs to the **browser profile**: on a shared browser the second user could never receive notifications, with no way to learn why. |
| Transfer, silently (before)              | Works on shared browsers                                                                       | The previous owner stops receiving notifications and nothing says so.                                                                             |
| **Transfer, explicit and audited (now)** | Works on shared browsers; the move is visible, attributable and reversible by an administrator | A tenant user holding the raw endpoint can still take a device; detection, not prevention.                                                        |

What the transfer does, in the **same transaction** as the registration:

- the row's `tenant_user_id` becomes the new user; the previous user's still
  queued notifications (`queued`, `retry_wait`) for that device are cancelled with
  `last_error = 'subscription_transferred'`, and later fan-out for the previous
  user skips the device. Revoking or disabling a device cancels its pending
  messages the same way. Defence in depth: every message carries
  `recipient_tenant_user_id` (`sql/315`, set at enqueue), and the dispatcher
  refuses, non-retryably and with a fixed message, any message whose recipient is
  no longer the subscription's owner. So nothing addressed to the previous user
  reaches the new owner, including a message already claimed (`sending`) when the
  transfer commits and one revoked-then-re-registered by someone else. The only
  residual window is a transfer committing between the dispatcher's owner check
  and the provider call, which delivers under the previous owner's now-stale
  secret and is undecryptable on the device;
- one audit event `push_delivery` / `subscription.transfer` (`push_subscription`,
  severity `warning`) records the subscription id and the previous and new
  `tenant_user_id`. **Ids only**: never the endpoint, the keys or the secret. If
  writing the audit event fails, the registration fails and rolls back (fail
  closed);
- the "previous owner" is read with the row **locked** (`SELECT ... FOR UPDATE`
  after an `INSERT ... ON CONFLICT DO NOTHING`), so two concurrent registrations
  cannot both believe they were the first. Re-registering one's own device or a new
  device records no transfer.

### Logging

The plaintext secret and the ciphertext appear in no log line, audit row, event
or API response; dispatcher failure messages are fixed strings.
