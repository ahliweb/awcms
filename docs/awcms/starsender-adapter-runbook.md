🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](starsender-adapter-runbook.id.md)

# StarSender adapter — operations runbook (Issue #1142)

Audience: the operator who turns the optional StarSender WhatsApp adapter on for a deployment, and the on-call person who finds a StarSender device misbehaving. Decision record: [ADR-0148](../adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) sections 4 and 7, plus the **Proposed** [ADR-0158](../adr/0158-starsender-adapter-conditions-that-differ-from-adr-0148-operator-attested-device-state-held-lanes-and-an-unapproved-acknowledgement-text.md), which records where this adapter goes beyond ADR-0148 (operator-attested device state, held lanes, unknown outcomes) and needs the owner's decision. Until it is accepted nothing here can send: the acknowledgement text is unapproved and the flag is off. Module: [`whatsapp_delivery`](../../src/modules/whatsapp-delivery/README.md) (adapter) and [`channel_accounts`](../../src/modules/channel-accounts/README.md) (accounts, acknowledgement, attestation).

## 0. What you are switching on

StarSender is an **unofficial** WhatsApp gateway. It is not a Meta-authorised interface. Using it may breach WhatsApp's terms and the number can be restricted or banned; AWCMS cannot prevent or reverse that and makes **no claim** of Meta approval, ban-free sending or reliable delivery status. A `success` answer from StarSender means only that **StarSender accepted the request**: AWCMS records the message as `sent` (accepted), never as delivered or read, and stores no provider message id (the documentation shows none).

There is **no automatic fallback**. A failed, disconnected or unapproved device never sends through another device, number or provider; an explicit reroute is a new, authorised, consent-checked enqueue. There is no device rotation to evade a provider limit.

It uses the **existing** WhatsApp queue and dispatcher (`bun run whatsapp:dispatch`, under the pinned Bun runtime). There is no second queue, no second dispatcher and no inbound endpoint.

## 1. Gates, in the order they close

Every one must hold for a message to reach StarSender. They are independent on purpose; none implies another.

| #   | Gate                                                                                                                               | Who decides                 | Fails as                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| 1   | `WHATSAPP_STARSENDER_ENABLED=true` (off by default; also needs `WHATSAPP_ENABLED` and `CHANNEL_ACCOUNTS_ENABLED`)                  | Operator, per deployment    | enqueue `refused: SENDER_UNAVAILABLE`; claimed row `failed`       |
| 2   | The risk text is **approved** by the business owner (a reviewed code change)                                                       | Business owner (human)      | no acknowledgement can be recorded (`409 RISK_TEXT_NOT_APPROVED`) |
| 3   | The tenant holds an **active acknowledgement** of the current text                                                                 | Tenant's people, one by one | `RISK_ACKNOWLEDGEMENT_REQUIRED`, terminal                         |
| 4   | The device is **attested** connected by an operator who holds their own acknowledgement                                            | Operator                    | device stays `pending`; the database refuses `connected`          |
| 5   | The `dm` capability is granted **with evidence** for the device                                                                    | Tenant administrator        | `CAPABILITY_DENIED`, terminal                                     |
| 6   | Marketing only: `broadcast` is **restricted** for StarSender, so it needs `contract_reference` or `written_authorization` evidence | Tenant administrator        | `CAPABILITY_DENIED`, terminal                                     |
| 7   | Per recipient: consent, suppression, expiry (unchanged, checked at enqueue and again at dispatch)                                  | Recipient                   | refused / cancelled as for any WhatsApp message                   |

**The shipped acknowledgement text is a DRAFT.** `src/modules/channel-accounts/domain/risk-acknowledgements.ts` ships it with `approval: null`, so gate 2 is closed until the business owner approves the wording (counsel for the DPIA copy, ADR-0148 sign-off list) and a reviewed change fills `approval` (and bumps `textVersion` if the wording changed; a new version invalidates every earlier acknowledgement). That is a human step this repository cannot perform.

## 2. Enabling it for a tenant

1. Deploy a build containing `sql/340` and `sql/341`; run `bun run db:migrate`. For tenants that already exist run `bun run identity-access:permissions:backfill` (the three `risk_acknowledgements` permissions are new).
2. Set `WHATSAPP_STARSENDER_ENABLED=true` for **both** the web process and the `whatsapp:dispatch` job (the job env allowlist already carries the name; regenerate and redeploy `ops/awcms-jobs.env-*` if you use them). Without the flag the adapter does not exist, whatever else is configured.
3. The tenant registers the device: `POST /api/v1/channel-accounts/accounts` with `provider: starsender`, `accountKind: device`, `authMode: device_key`, then writes the **device API key** with `PUT .../accounts/{id}/credential` (write-only, MFA-enrolled holder, step-up). The key is never returned, logged, audited or evented. Never put a product's real key in this repository.
4. Each operator who will attest a device reads the text (`GET /api/v1/channel-accounts/risk-acknowledgements?provider=starsender`) and records their **own** acknowledgement (`POST` the same path with the `textVersion` they read).
5. The tenant administrator records evidence for `dm` (and `reply`) on the device (`PUT .../capabilities/dm`).
6. The operator attests the device is paired (a person who has an MFA factor needs a fresh step-up, as for the credential; acknowledging needs the same): `POST .../accounts/{id}/attest-device`. This is **operator-attested, not verified**: StarSender documents no status call (section 4). The health record says `OPERATOR_ATTESTED`.
7. Send with `senderAccountId`, or configure the prospective default sender of a business scope (`PUT /api/v1/whatsapp/sender-policy`). A derived product that wants StarSender as its default configures that policy; **there is no provider default in code**.

## 3. Reading it in production

| Symptom                                                                       | Meaning / what to do                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `failure_code = device_disconnected`, rows in `retry_wait`, one call per pass | StarSender reported the device not connected. The device's **lane is held** (one call, no more) with bounded backoff against `WHATSAPP_SEND_MAX_RETRIES`, then terminal `failed`. Re-pair the phone in StarSender, then attest again if the account was degraded. Nothing is rerouted.                                                            |
| `failure_code = unauthorized`                                                 | StarSender rejected the device key (401/403): the key was rotated or belongs to another device. Rewrite the credential. The lane is held with backoff.                                                                                                                                                                                            |
| `failure_code = outcome_unknown`                                              | A timeout, a reset or **ANY 5xx**: the request may have been processed (a failing gateway may already have forwarded the message). **Not retried** (StarSender documents no idempotency key; a retry could message the person twice). Counts against the device's breaker. Check the recipient/StarSender dashboard before re-enqueueing by hand. |
| `failure_code = rate_limited`                                                 | HTTP 429 or a limit message. Retried with backoff, bounded. A repeated run opens that device's circuit breaker; other devices are unaffected.                                                                                                                                                                                                     |
| `failure_code = rejected`                                                     | StarSender refused this message (including HTTP 200 with `success:false`). Terminal. The provider's wording is never stored.                                                                                                                                                                                                                      |
| `failure_code = malformed_response`                                           | HTTP 200 in a shape this adapter does not know. **Not treated as accepted.** Terminal. See section 6: the contract may have changed.                                                                                                                                                                                                              |
| `sender_unavailable` with reason `RISK_ACKNOWLEDGEMENT_REQUIRED`              | The tenant's acknowledgement was revoked, or the text changed. Re-acknowledge the current version, then re-attest the degraded device.                                                                                                                                                                                                            |
| `GET /api/v1/whatsapp/senders`                                                | Per device: availability (a coarse reason), queue, quota, throttled. Never a key, a device id or a number.                                                                                                                                                                                                                                        |

Health honesty: `healthCheck` reports the device's **circuit breaker only**. It is not a connectivity probe, because the only documented call is the send itself. The breaker and the failure codes above are the signals; the device state in `channel_accounts` is what an operator attested.

## 4. Stopping it

- **One device:** disable it (`PATCH .../accounts/{id}` with `status: disabled`) or disconnect it (`POST .../disconnect`, erases the stored key). Effective at the next claim, and within `WHATSAPP_SENDER_REVALIDATE_EVERY_ROWS` rows inside a pass already running. Queued rows to it fail terminally; nothing is rerouted.
- **A tenant's use of the provider:** revoke the acknowledgements (`POST .../risk-acknowledgements/{id}/revoke`). Revoking the **last** one degrades the tenant's connected devices in the same transaction and every send is denied at once. The records stay (who accepted what, when withdrawn).
- **The whole deployment:** unset `WHATSAPP_STARSENDER_ENABLED` and restart web and job. Enqueue refuses, queued rows fail at dispatch, the provider is never called.

Rotate a key by writing the credential again (replaces it). **Replacing a device key moves the device back to `pending` (`CREDENTIAL_REPLACED`) in the same transaction and it must be attested again**: the attested state is a claim about that key's pairing, not about whichever key is stored next. A key shared between two devices is a misconfiguration: each device isolates its own key, breaker and lane.

## 5. Webhooks: none, deliberately

StarSender's public documentation describes an inbound webhook (incoming message `message`, `from`, `timestamp`) but **no authentication of the request**: no signature, secret header or challenge. ADR-0148 I9 forbids trusting a URL's secrecy for content that mutates customer state, and the matrix keeps `inbound` for StarSender `unverified`. So:

- **No StarSender webhook route exists** (`tests/starsender-adapter.test.ts` asserts it), no signature scheme is invented, and no delivery status or contact is ingested from StarSender.
- The adapter runs in **status-unknown mode**: a message is `sent` (accepted) and stays that. Nothing will ever say "delivered" or "read".
- Whether a compensating mechanism is admissible (for example a polling endpoint, if StarSender documents one) is **not decided here**; it needs an ADR addendum and evidence. Until then StarSender status and contacts are out.

## 6. Verify against the live API before production (NOT done in this change)

The contract fixtures in `tests/fixtures/starsender/contract-fixtures.ts` come from one public documentation page (read 3 November 2026): only the **success** body is documented. Every failure body is an assumption. Before enabling this in production, with a StarSender test device and your own number:

1. Confirm the request: `Authorization` carries the raw device key (no `Bearer`), `to` accepts `62…` digits, `messageType: "text"` plus `body` sends text.
2. Record the real error bodies for: invalid number, disconnected device, wrong key, exhausted quota/rate limit. Compare with the fixtures; adjust `classifyStarsenderResponse` and the fixtures **together**.
3. Check whether `data` ever carries a message id. If it does and is stable, adding it is a deliberate change (a `providerMessageId` makes duplicate-send investigation possible) that needs its own review.
4. Check whether StarSender offers a side-effect-free device-status call. If so, a connector can replace operator attestation (and `attest-device` can be retired).
5. Check whether StarSender offers any request idempotency key. If so, `outcome_unknown` (timeouts, resets, any 5xx) could become retryable.
6. Check the exact wording of the "device not connected" and rate-limit answers. `DEVICE_DISCONNECTED` and `RATE_LIMITED` in `domain/starsender-contract.ts` are free-text patterns that may also match a message about a **recipient** (for example "number not connected to WhatsApp"); they only ever hold the lane or delay a retry (never a recipient-level verdict), but they must be tightened against real answers, not guessed.

## 7. Residual risks (stated, not hidden)

- **Unverified contract** (section 6): field names and failure wording are unproven against the live API.
- **Operator-attested device state**: the control plane cannot tell that a device is really paired. A disconnected device is found by a failed send (the lane is held), not by a probe; the worker has no write grant, so it does not mark the account `degraded` by itself.
- **Whose acknowledgement counts**: a device is bound to the acknowledgement it was attested under, and revoking THAT one degrades it; the send decision itself asks "does the tenant hold an active acknowledgement of the current text", not "is the attester still active". Whether an acknowledgement of a deactivated or erased person should stop counting is **not decided** (the record survives erasure of the person by design) and no clean rule was found; deactivate the person's acknowledgement by revoking it.
- **At-least-once**: a crash after StarSender accepted and before the row is finalised can resend (the queue's existing property). A timeout is not retried precisely to avoid the larger duplicate risk.
- **The text is a draft** until the owner approves it, and a stored acknowledgement proves a person clicked a version, not that they understood it.
- **Per-tenant sender credentials and the dispatcher's reach** are the ADR-0148 section 5 accepted residual risk, unchanged.
- **Marketing consent is still keyed by tenant and recipient**, not business scope (open decision M4 of #1231, not touched here).
