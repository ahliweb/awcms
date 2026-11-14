---
"awcms": minor
---

security(whatsapp_delivery): close the six Low findings of the independent audit of #1267 (Meta multi-WABA senders) (Issue #1298). Behaviour changes for operators are marked.

**L1.** An operator clearing a WABA restriction now moves the event clock strictly past the event that set it and the moment of the clear, so a stale `ACCOUNT_RESTRICTION` arriving later in another body can no longer undo the clear; only an event Meta stamps after the clear restricts again.

**L2.** Replay. The webhook receipt is looked up per tenant, not per subscription, so a token rotation (new subscription, same app secret) no longer reopens a captured body. Template, messaging-limit and restriction changes now need a **stated `entry.time` within seven days** (below the eight-day receipt retention): a body whose receipt was purged cannot apply, and a body with no readable time is refused instead of defaulting to "now" (**behaviour change**: such entries are counted as `ignored`). `replay_window_seconds` is deliberately not read for Meta (the HMAC covers the body only, no signed timestamp exists) and the column comment says so.

**L3.** `sql/392`: `awcms_worker` loses table-level `UPDATE` on `awcms_whatsapp_messages` and keeps it on the eleven columns the dispatcher and expiry sweep write (`provider_status*`, recipient, template, purpose, sender and `contains_secret` are no longer writable by the worker). A trigger that binds only `awcms_worker` allows exactly the queue's transitions, freezes terminal rows, lets `body`/`variables` only be cleared on a secret message, ties provider acceptance writes to `sending -> sent` and refuses a lower retry count. Pinned exactly by `security:readiness`; tested as the real worker login.

**L4.** `sql/393`: a `BEFORE INSERT` trigger stamps webhook receipts with the database clock for every role; `awcms_app` loses `UPDATE`/`DELETE` on receipts and `DELETE` on service windows; a trigger caps a window's `last_inbound_at` at `now()` (it is the provider's own time, so it cannot be replaced by the clock). Pinned by `security:readiness`.

**L5.** New read-only `bun run whatsapp:meta:preflight` (as `awcms_worker`) and the runbook `docs/awcms/whatsapp-meta-enable-runbook.md` (en/id): run it before enabling the Meta path on a deployment that already holds Meta numbers, to see the numbers without a WABA parent and the queued rows (OTP counted apart) that would fail terminally. No approval backfill is provided: an approval is Meta's fact and needs evidence.

**L6.** The per-(tenant, address) webhook attempt bucket is refunded for a verified, new delivery, so a legitimate high-volume tenant is no longer answered `429` by its own traffic. Refusals, malformed bodies and verified duplicates keep their charge.

**Audit follow-up (independent audit of this change: PASS, three Lows, fixed).** `sql/394`: `awcms_worker`'s `INSERT` on `awcms_whatsapp_messages` must be a fresh `queued` row (trigger) and its `DELETE` only reaches terminal rows older than seven days (RESTRICTIVE policy); both pinned by `security:readiness` (trigger body, policy expression, behavioural probe). `whatsapp:meta:preflight` now decides each number's binding with the dispatcher's own sender-port verdict, so a revoked/disabled parent or a scope mismatch is a terminal finding and a degraded one a hold (new `number_unusable` finding). The webhook receipt dedupe takes a per-(tenant, body hash) advisory lock, so a body delivered to two subscriptions at once applies once.

No OpenAPI or AsyncAPI change (no request or response shape changed). Human steps not performed here: running the preflight and the runbook against a real deployment.
