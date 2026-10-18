---
"awcms": minor
---

Key re-rotation and an explicit endpoint transfer for push and Telegram (Issue #1098, follow-up to #1089).

- `bun run push:auth-secret:rekey` (the `--rekey` mode of `push:auth-secret:backfill`) and the new `bun run telegram:chat:rekey` re-encrypt every ciphertext whose key id is not the ring's active key, so an old key can finally be retired. Idempotent, resumable, keyset-batched; the push job runs as `awcms_worker`, the Telegram job as `awcms_app` (the binding guard trigger refuses the worker any live ciphertext write). Neither prints key material or ciphertext.
- `security:readiness` gains two warning checks that report ciphertext row counts per key id for both rings and warn while any row is under a non-active key.
- Registering a push endpoint that an active row already holds for another tenant user now transfers it explicitly: the previous owner is read with the row locked, their still-queued notifications for the device are cancelled, and a `subscription.transfer` audit event (ids only, never the endpoint or secret) is written in the same transaction, fail closed.
- No schema or API change. Operator runbook in `docs/awcms/push-notifications.md` (EN and ID).
- Security-audit follow-up: `sql/315` adds `awcms_push_messages.recipient_tenant_user_id` (backfilled from the subscription's current owner, then `NOT NULL`, composite FK to `awcms_tenant_users`); enqueue sets it and the dispatcher refuses (non-retryable, fixed message) any message whose recipient no longer owns the device. Any owner change on registration (including a revoked or disabled row) now cancels the pending messages and writes the `subscription.transfer` audit; revoke and disable also cancel `queued`/`retry_wait` messages. Readiness key-id buckets match the key-id pattern. Runbook gains the compromise and undecryptable-row guidance.
