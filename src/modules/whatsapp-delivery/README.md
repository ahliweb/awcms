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

The **deployment sender** (`senderAccountId = null`) is chosen per **deployment** from the environment, never per request (a request-supplied token would let one tenant's admin make the deployment speak as someone else). Never in the database, logs or error text. A **tenant-owned sender** is a different path: see [Sender routing](#sender-routing-issue-1141) below.

- `WHATSAPP_PROVIDER=log` — records "would have sent", calls nothing.
- `fonnte` (`WHATSAPP_FONNTE_TOKEN`) — free text over Fonnte's HTTP API.
- `meta` (`WHATSAPP_META_ACCESS_TOKEN`, `WHATSAPP_META_PHONE_NUMBER_ID`) — WhatsApp Cloud API **template** messages. A template with no approved `providerTemplate` fails terminally; it never falls back to free text.

A missing or unknown provider does not crash the dispatcher and does not silently become `log`: it resolves to a provider that fails every send **non-retryably**, and `config:validate` rejects `WHATSAPP_ENABLED=true` without one. Every call goes through `ssrfSafeFetch` under a total timeout; only the **adapter** feeds the circuit breaker, so a per-message rejection (bad number, bad template) never trips it. A provider that reports a number cannot receive WhatsApp makes the dispatcher record a `hard_failure` suppression.

## Behaviour when off

Without `WHATSAPP_ENABLED=true`, `enqueue` answers `refused: DISABLED` and writes nothing, and `bun run whatsapp:dispatch` claims not a single row. `bun run whatsapp:queue:purge` runs **regardless** (for every tenant): a deployment that turned WhatsApp off still has rows from when it was on.

## Retention: `delegated`

The purge first expires stale non-terminal rows (clearing an OTP), then deletes only terminal ones. Its DELETEs name the terminal statuses (`sent`, `failed`, `cancelled`, `expired`) and uses `updated_at` as the cursor, so a message waiting out a provider outage — or a reminder scheduled days ahead — is never deleted. Attempts go before messages (FK order). Consents and suppressions are never purged: they are privacy decisions, and deleting a suppression would resume sending to someone who asked to stop.

## Admin surface

`/admin/whatsapp` (navigation entry gated on `whatsapp_delivery.messages.read`): delivery status, recent messages with cancel, recent attempts, the consent store, the suppression list and the registered templates. Each panel is gated on its own permission. The ten permissions are seeded by `sql/179`; the two sender-routing permissions (`senders.read`, `sender_policy.configure`, API only, no screen yet) by `sql/323`.

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

## Sender routing (Issue #1141)

[ADR-0148](../../../docs/adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) section 4. A tenant can own several WhatsApp senders (a Meta Cloud API phone number per brand, later StarSender devices) in [`channel_accounts`](../channel-accounts/README.md), and a message can be sent through one of them. **One queue, one dispatcher, no dual write**: the sender is a **key on the existing queue**, not a second one.

### What changed on the port, and who is affected

`WhatsappDeliveryPort` goes from `1.0.0` to **`1.1.0`, additively** (`capability-contract-versions.ts`, `awcms-family-compatibility.yaml`):

| Added (all optional) | Meaning                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `senderAccountId`    | The tenant-owned account that should send. Never a token, a phone number id or a device id.                |
| `inReplyToMessageId` | Thread affinity: this message continues an earlier message to the same recipient and **keeps its sender**. |
| `businessScope`      | `{ type, id }`: the brand or unit; the key of the default-sender policy.                                   |
| refusals             | `SENDER_UNAVAILABLE`, `SENDER_AFFINITY_CONFLICT`, `REPLY_TARGET_UNKNOWN`.                                  |

**Compatibility (stated, and tested).** No existing field, signature or refusal changed. A call that sets none of the new fields, for a tenant with no sender policy, is queued with `senderAccountId = null` (the **deployment sender**) and takes the same path, the same provider, the same credential and the same event payload as in `1.0.0`. So `booking`, and the commerce adapter behind `awcms-one`'s per-tenant `legacy`/`upstream` mode router (downstream ADR-0047; [ADR-0133](../../../docs/adr/0133-generic-delivery-capability-whatsapp-promotion.md) section 6), compile and behave **unchanged**. A tenant in `legacy` mode never reaches this port, so sender routing does not apply to it until its cutover (a tenant is in exactly one mode, so there is still no second queue and no dual write); `awcms-one` adopts the new inputs after a subtree sync as a merge commit, and the StarSender default of a derived product is a **configuration of the policy**, applied per tenant, never a code change. A consumer that switches exhaustively over the refusal reasons (none in this repository does: booking maps an unknown reason to a coarse code) must add the three members before it passes a sender. A consumer that accepts a sender id from a **user** must authorise that choice itself: the port enforces tenant authority, it performs no access check (the consumer authorises its own business action, ADR-0011).

### Which sender a message gets

In this order, once, at enqueue, **snapshotted on the row and immutable** (`sender_account_id`, `sender_selection`, `sender_policy_version`, the business scope; the database refuses an UPDATE of any of them, for every role):

1. the thread's sender, when `inReplyToMessageId` names an earlier message to the same recipient (a different explicit sender is `SENDER_AFFINITY_CONFLICT`, an unknown, foreign or other-recipient target is `REPLY_TARGET_UNKNOWN`);
2. else the explicit `senderAccountId`;
3. else the **default of the business scope** (`awcms_whatsapp_sender_policies`), else the tenant-wide default;
4. else the deployment sender (`null`).

The default is a **prospective policy with a configuration version**: `PUT /api/v1/whatsapp/sender-policy` (high-risk, `whatsapp_delivery.sender_policy.configure`, `Idempotency-Key`, audited at `warning`) changes what **later** messages get; a message already queued keeps the sender and the version it was given. `defaultSenderAccountId: null` is an explicit decision to use the deployment sender for a scope. There is **no provider default in code**: a derived product that wants StarSender (or Meta) as its default configures the policy.

### A sender that cannot send never sends through another

A sender is usable only when `channel_accounts` says so **right now**: an account of **this tenant** (another tenant's id and an unknown id are one answer), a WhatsApp sending identity, `connected`, its connection grant active, and the capability (`dm`, `reply`, or `broadcast` for marketing) granted with evidence against the current matrix (`ChannelAccountPort`). Otherwise:

| Moment   | Sender state                                                                                          | Result                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| enqueue  | not usable for any reason, or the provider has no adapter on this deployment (StarSender until #1142) | `refused: SENDER_UNAVAILABLE`, nothing queued, **never** another sender, number or provider |
| dispatch | unknown, revoked, disabled, connection not active, capability withdrawn, no adapter                   | terminal `failed` with `sender_unavailable`; the provider is never called                   |
| dispatch | degraded, pending, token awaiting refresh, no key ring, control plane off                             | the lane is **held**: rows stay waiting, nothing is claimed, the retry budget is not spent  |
| dispatch | the provider rejects the sender's credential (`unauthorized`)                                         | that row fails; the rest of the lane fails closed with **no further call**                  |

There is no rotation to another number to evade a provider limit, a quality rating or a failure (ADR-0148 I4, I5); an explicit reroute is a **new** enqueue.

### Adapter and secret: from the tenant's record, never from the request

The Meta adapter is built **per lane, per pass** from the sender's own record (`external_id` is the `phone_number_id`) and its own credential, decrypted **in memory** for the claimed row's tenant by `ChannelSenderCredentialPort` (the application key ring, AES-256-GCM, associated data binding purpose, tenant and row). The port input type has no field a token could ride on, and the policy endpoint rejects a body that smuggles one. The sender-resolution adapter (`channel-account-port-adapter.ts`, used on the enqueue path) **never imports the secret store**; only `scripts/whatsapp-dispatch.ts` composes the credential adapter, which is why `CHANNEL_SECRETS_ENCRYPTION_KEYS` is granted to `whatsapp:dispatch` alone among the jobs that reach this module. A revoked sender is therefore effective on the **next claim**.

### Per-sender health, quota, throttle, breaker, fair claiming

- **Lanes and fair claiming.** A pass serves each sender that has due rows as its own lane, oldest-waiting first, at most `limit / lanes` rows per lane, so a stalled or throttled number cannot starve the others.
- **Breaker.** One circuit breaker per sender (`whatsapp-delivery:sender:<account id>`); the deployment sender keeps `whatsapp-delivery`. One failing number does not stop another.
- **Quota and throttle.** `WHATSAPP_SENDER_RATE_PER_HOUR` (default 1000) and `WHATSAPP_SENDER_RATE_PER_DAY` (default 10000), counted from what the sender really **sent** plus what is in flight. A reached cap makes the lane wait; the rows are never rerouted. These are deployment-wide ceilings, not per-sender settings.
- **Diagnostics.** `GET /api/v1/whatsapp/senders` (`whatsapp_delivery.senders.read`): per sender, availability (a coarse reason code), the queue, the quota and whether it is throttled. No credential, secret reference, phone number or device id is ever projected; the messages list gains `senderAccountId` and `senderSelection`. The `awcms.whatsapp.message.*` events gain `senderAccountId` (absent for the deployment sender, so that payload is unchanged); "accepted" by the provider is never "delivered".

### Consent and suppression: the recipient, not the sender

Consent, suppression, expiry, the purpose classes, the idempotency key and the recipient rate limits are keyed by the **recipient** (and checked at enqueue and again at dispatch), never by the sender: changing the sender does not change who consented, and an opt-out or a suppressed address stops every sender of the tenant. Marketing through a sender needs the `broadcast` capability (restricted for an unofficial provider, so it needs contract evidence there).

### Limits of this change (open, stated)

- **Only `whatsapp_cloud` has an adapter.** A StarSender sender is refused at enqueue and fails closed at dispatch until Issue #1142 adds its adapter behind its own flag and the per-operator risk acknowledgement (not built here).
- **Consent is not yet keyed by business scope** (it is by tenant and recipient, as before): one brand's opt-in covers the tenant's other brands. Keying consent by scope is a schema decision for the consent tables, not taken here; an opt-out and a suppression are the safe direction (they apply tenant-wide).
- **No per-purpose sender override** in the policy (the pack lists it as optional) and **no per-sender cap override** (the caps are deployment-wide).
- **Per-sender breaker and health are in-process**, like the deployment breaker: they reset when the dispatcher process restarts; the quota is counted from the queue and survives restarts. No health row is written by the dispatcher.
- **No admin screen** for senders or the policy (the connection manager is #1154); the API is complete.
- **Per-person account assignment** (`channel_accounts` assignments) is not applied by the port; a consumer that lets a user pick a sender must check it.
- **A race window of one transaction:** an account revoked between the enqueue check and the INSERT is caught by the database guard, which raises inside the caller's transaction (loud, fail closed); a revocation after the INSERT is caught at dispatch.

## Not in this phase

Inbound webhooks (delivery receipts, "stop" replies — ADR-0133 section 10, Q2), a StarSender adapter (Issue #1142), an admin reveal of the raw number (Q7), Telegram, and notification orchestration are not built. Per-tenant sender selection (Q3) is **built since Issue #1141**: see [Sender routing](#sender-routing-issue-1141). The commerce compatibility adapter and the per-tenant cutover (ADR-0133 section 6, phases 2 to 4) are separate, later pull requests.

## WhatsApp Bun runtime / planned UI status

Existing `bun run whatsapp:dispatch` performs provider HTTP via one Bun queue. Meta multi-sender routing ([#1141](https://github.com/ahliweb/awcms/issues/1141)) reuses it, and the StarSender and webhook work [#1142–#1143](https://github.com/ahliweb/awcms/issues/1142) must too, not a Node.js/Socket.IO worker. Future Bun SSE/WS projects status only; provider accepted is not verified delivered. [Runtime standard](../../../docs/awcms/bun-delivery-realtime-runtime.md).
