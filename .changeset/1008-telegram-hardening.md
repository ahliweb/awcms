---
"awcms": minor
---

security(telegram_delivery): post-merge hardening from the #965 audit (#1008, ADR-0140).

- **Proof of possession (M5).** The bot answers a valid `/start` with a 6-digit PIN, and `POST /api/v1/telegram/bindings/me/confirm` now takes `{ bindingId, pin }`. Migration 288 adds `pin_hash` (keyed hash only) and `pin_attempts`; wrong answers are counted in the database, the fifth ends the pending binding (`423 TELEGRAM_PIN_LOCKED`), a wrong one is `422 TELEGRAM_PIN_INVALID`. A trigger lets only `awcms_app` write a hash or raise the counter. A pending binding created before the upgrade has no PIN and cannot be confirmed: the person requests a new link. **Breaking for API clients of `confirm`.**
- **Per-chat rate limit (L3).** After the secret check and body limit, one chat may send 10 updates a minute; beyond that it is answered `200` with no reply and does not spend the per-address bucket, so a noisy user can no longer cause `429`s for everyone. The shared limiter still fails open on a Redis outage, so this is fairness, not security.
- **Idempotency (L12).** `PUT /api/v1/telegram/settings` and `POST /api/v1/telegram/bindings/{id}/revoke` now require an `Idempotency-Key` (a retried revoke replays its `200` instead of `404`) and refuse machine credentials (`403 INTERACTIVE_SESSION_REQUIRED`). **Breaking for API clients of these two routes.**
- **Key rings (L11)** are checked for distinctness at runtime, not only by `config:validate`.
- **Upgrade note.** A deployment whose `TELEGRAM_CHAT_ENCRYPTION_KEYS` and `TELEGRAM_CHAT_HASH_KEYS` share any key will, after this upgrade, stop Telegram dispatch, `/start` and `/stop` (both rings resolve as unavailable and fail closed) until the rings are split into distinct keys. Detect it before deploying: `bun run config:validate` with the production environment reports "TELEGRAM_CHAT_ENCRYPTION_KEYS ... tidak boleh berbagi kunci yang sama". Splitting means issuing a new hash ring, which orphans existing chat hashes (staff re-link). If you use a reverse proxy, WAF or APM, it must not log response bodies of `/api/v1/telegram/webhook` (the PIN is in them).
- Documented, not changed: per-run circuit breaker (L10), revoke racing a `sending` row (L13), `/stop` cost per tenant (L4).
