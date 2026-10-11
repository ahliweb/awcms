🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `whatsapp_delivery`

Generic WhatsApp delivery capability (Issue #963, [ADR-0133](../../../docs/adr/0133-generic-delivery-capability-whatsapp-promotion.md) phase 1).

This module **delivers** WhatsApp messages that another module decided to send — booking reminders, hr_payroll notices, a downstream commerce adapter. It has no opinion about what deserves a message and ships no business wording except a neutral `system.notice` template. It is WhatsApp-specific on purpose: `WhatsappDeliveryPort` is **not** a multi-channel facade (that would be notification orchestration, which ADR-0133 section 7 does not admit).

## "No second outbox", stated precisely

ADR-0074 already made `push_delivery` a second outbox, so the issue's constraint cannot be read literally. What this module does, and what ADR-0133 section 3 binds:

- It is a **channel queue table** (`awcms_whatsapp_messages`), the repo's third after `awcms_email_messages` and `awcms_push_messages`. It does **not** join `awcms_domain_events` (a provider call inside the claim transaction would violate ADR-0006) and it does **not** extend the e-mail table (a mixed-shape table with two dispatchers contending).
- It reuses the **lease mechanism**, not a new one: claim with `FOR UPDATE SKIP LOCKED`, `next_attempt_at` doubles as the lease expiry, send **outside** any transaction, finalise per row.
- **One queue per channel per deployment, never one per domain.** Booking, hr_payroll, commerce and every later consumer enqueue into this single queue through the port. A consumer never adds its own WhatsApp table, dispatcher or provider call. What the rule refuses is a **second WhatsApp queue**.

## The port

`_shared/ports/whatsapp-delivery-port.ts`, adapter `whatsappDeliveryPortAdapter` in `application/whatsapp-enqueue.ts`:

- `enqueue(tx, input)` is **one INSERT in the caller's transaction** (so a rolled-back booking sends no reminder). There is no `send`: the provider is called only by the dispatcher, outside any transaction. The caller never learns the provider's answer synchronously.
- Refusals and suppressions are **returned**, never thrown: `refused` (`CONSENT_REQUIRED`, `TEMPLATE_UNKNOWN`, `DISABLED`, `RATE_LIMITED`, plus `RECIPIENT_INVALID`, `RECIPIENT_UNRESOLVED`, `EXPIRY_REQUIRED`) and `suppressed` (`hard_failure`, `opt_out`). The idempotency key is required and unique per tenant; a replay answers `duplicate`.
- `getStatusByCorrelation` reads state back by the caller's own record id (masked recipient, never the number); `cancelByCorrelation` cancels still-waiting messages and is a no-op once sent.
- The port performs **no access check and writes no audit row**: the consumer authorises and audits its own business action.

Consumers register templates with `registerWhatsappTemplate` (module-prefixed keys, e.g. `booking.reminder`). A template has **exactly one purpose** and a variable allow-list; a variable that is not on the list is **dropped** by the renderer, which is what keeps a payroll notice free of salary data.

## Purpose classes and consent

| Purpose         | Consent                                                           | Suppression honoured                  |
| --------------- | ----------------------------------------------------------------- | ------------------------------------- |
| `transactional` | none                                                              | every reason                          |
| `security`      | none; mandatory `expiresAt`; never blocked by a marketing opt-out | hard failure only                     |
| `marketing`     | explicit, per recipient, recorded with its source                 | every reason, and a withdrawn consent |

**Consent is independent of segment membership.** The decision (`domain/whatsapp-eligibility.ts`) takes the suppression row and the consent row and nothing else; being in a segment, list or campaign audience never implies consent. It runs at enqueue **and again at dispatch**, so a withdrawal lands in minutes even for a row claimed a moment earlier. Withdrawing a consent, or suppressing a number, cancels the recipient's waiting messages in the same transaction.

A `security` message that passes `expires_at` is `expired`, **not retried late**. A row that carries a secret (an OTP) has its body and variables cleared when it reaches any terminal state, and the secret never reaches an attempt row, an audit row, a log line or an event.

## The phone number

E.164-normalised or **refused, never guessed** (a national `08…` number is read only when `WHATSAPP_DEFAULT_COUNTRY_CODE` is set). Stored raw in **one column** (`awcms_whatsapp_messages.recipient`) because no adapter can deliver to a hash; `recipient_hash` (keyed HMAC, see below) drives consent, suppression, rate limits; `recipient_masked` is what every list, log line, audit row and event carries. Consent and suppression tables store only the hash and the masked form.

## Providers

Chosen per **deployment** from the environment, never per tenant (a tenant-supplied token would let one tenant's admin make the deployment speak as someone else). Never in the database, logs or error text.

- `WHATSAPP_PROVIDER=log` — records "would have sent", calls nothing.
- `fonnte` (`WHATSAPP_FONNTE_TOKEN`) — free text over Fonnte's HTTP API.
- `meta` (`WHATSAPP_META_ACCESS_TOKEN`, `WHATSAPP_META_PHONE_NUMBER_ID`) — WhatsApp Cloud API **template** messages. A template with no approved `providerTemplate` fails terminally; it never falls back to free text.

A missing or unknown provider does not crash the dispatcher and does not silently become `log`: it resolves to a provider that fails every send **non-retryably**, and `config:validate` rejects `WHATSAPP_ENABLED=true` without one. Every call goes through `ssrfSafeFetch` under a total timeout; only the **adapter** feeds the circuit breaker, so a per-message rejection (bad number, bad template) never trips it. A provider that reports a number cannot receive WhatsApp makes the dispatcher record a `hard_failure` suppression.

## Behaviour when off

Without `WHATSAPP_ENABLED=true`, `enqueue` answers `refused: DISABLED` and writes nothing, and `bun run whatsapp:dispatch` claims not a single row. `bun run whatsapp:queue:purge` runs **regardless** (for every tenant): a deployment that turned WhatsApp off still has rows from when it was on.

## Retention: `delegated`

The purge first expires stale non-terminal rows (clearing an OTP), then deletes only terminal ones. Its DELETEs name the terminal statuses (`sent`, `failed`, `cancelled`, `expired`) and uses `updated_at` as the cursor, so a message waiting out a provider outage — or a reminder scheduled days ahead — is never deleted. Attempts go before messages (FK order). Consents and suppressions are never purged: they are privacy decisions, and deleting a suppression would resume sending to someone who asked to stop.

## Admin surface

`/admin/whatsapp` (navigation entry gated on `whatsapp_delivery.messages.read`): delivery status, recent messages with cancel, recent attempts, the consent store, the suppression list and the registered templates. Each panel is gated on its own permission. The ten permissions are seeded by `sql/179`.

## Security notes and known limits (audit of PR #975)

- **The recipient hash is keyed.** `HMAC-SHA256(key, tenantId 0x00 "whatsapp:recipient" 0x00 e164)` under the secret ring `WHATSAPP_RECIPIENT_HASH_KEYS` (`keyId:base64` pairs, the first writes, all are read, the key id is stored in the value as `k1:<hex>`; shape of ADR-0137 section 2). A hash salted only with the tenant id is invertible in about a millisecond (the number space is small and the mask leaks the last four digits), and consent and suppression rows hold no plaintext, so this could never have been migrated later. With no usable ring enqueue, consent and suppression **refuse** and the dispatcher claims nothing (fail closed); `config:validate` requires the ring when `WHATSAPP_ENABLED=true`. **A key id can never be retired while any consent or suppression row, or a restorable backup, still carries it**: those rows cannot be re-hashed. Rotation is "prepend a new key"; there is deliberately no re-hash job.
- **One owner per row.** The claim lease is sized to the whole batch (`limit` times the provider timeout), the lease is renewed and verified immediately before each row, and finalisation matches the exact lease value this pass wrote, so a lease that expires mid-batch is skipped rather than sent twice. A re-claim of an expired `sending` row counts as an attempt, a row past the retry cap is failed, and a throw while processing a row fails that row only. Residual: at-least-once to the provider remains (a crash after the provider accepted and before finalise can resend).
- **Opting out is protected.** Re-granting consent over a withdrawn row is refused unless the request says `reinstateWithdrawn`, carries an `evidenceRef`, is not `source: "import"`, and the caller holds the high-risk `consents.restore` instead of `consents.create`. The withdrawal stays in `withdrawal_history`, and the reinstatement is audited at warning severity and emitted as an event.
- **Expiry never depends on the dispatcher.** `whatsapp:queue:purge` marks any non-terminal row past `expires_at` as `expired` and clears an OTP, for every tenant, regardless of the flag, the breaker and the tenant's state.
- **Provider text is redacted before it is stored.** A secret-bearing row keeps no provider detail (`Provider reported <code>.`); any other row has the exact values of its own body and variables removed. The Fonnte adapter has no structured "invalid recipient" signal, so it never creates a hard-failure suppression from free text; Meta's numeric codes keep that verdict.
- **Rate limits.** `security` messages have their own per-recipient bucket (`WHATSAPP_RATE_SECURITY_PER_RECIPIENT_PER_HOUR`, default 5), so notices cannot exhaust it and an OTP flood cannot target one number. The counts are racy under concurrency by design.
- **Idempotent replay ignores the payload.** A second `enqueue` with the same `(tenant, idempotencyKey)` returns `duplicate` whatever its template, variables or recipient; a caller that reuses a key for a different message loses it silently. Keys must be derived from the caller's own record id.
- **Opt-out versus an in-flight message.** A withdrawal cancels `queued` and `retry_wait` rows and the dispatcher re-checks consent before every send, but a row already `sending` is in a provider call and cannot be recalled; that window is bounded by the provider timeout.
- **Erasure is not implemented.** The `subjectData` descriptors declare `anonymize` for the four tables, but no executor path has been exercised for them yet; a data-subject erasure of a WhatsApp recipient is an open item (and clearing `recipient_hash` removes a suppression, so it must not run on suppressed numbers without a decision).

## Not in this phase

Inbound webhooks (delivery receipts, "stop" replies — ADR-0133 section 10, Q2), a per-tenant sender selection (Q3), an admin reveal of the raw number (Q7), Telegram, and notification orchestration are not built. The commerce compatibility adapter and the per-tenant cutover (ADR-0133 section 6, phases 2 to 4) are separate, later pull requests.
