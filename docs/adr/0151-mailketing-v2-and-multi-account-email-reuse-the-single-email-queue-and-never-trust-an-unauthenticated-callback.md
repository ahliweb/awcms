🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0151-mailketing-v2-and-multi-account-email-reuse-the-single-email-queue-and-never-trust-an-unauthenticated-callback.id.md)

# ADR-0151 — Mailketing v2 and multi-account email reuse the single `email` queue, and an unauthenticated provider callback never changes customer state

- **Status:** Proposed
- **Review:** becomes Accepted once a maintainer reviews it. Issues #1159 to #1162 stay blocked until then. Docs only: nothing here is evidence that the v2 adapter, multi-account routing or the webhook works.
- **Date:** 2026-10-27
- **Decision maker:** ahliweb (maintainer review pending)
- **Resolves:** Issue #1158 (Mailketing multi-account email management, v2 migration and CRM ownership). It is the email ADR that [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) §9 left to this issue.
- **Extends, does not supersede:** [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) (I1 to I13, §3 matrix, §5 credentials). It conforms to all thirteen invariants. It treats a Mailketing connection as a `channel_account` and applies the §5 amendment of ADR-0074/0133 to **tenant-owned** email accounts only. [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.md) (one queue per channel, purpose classes, consent independent of segments), [ADR-0139](0139-cross-channel-notification-orchestration-not-admitted.md) (no facade, no fallback), [ADR-0103](0103-newsletter-is-its-own-module.md) (`newsletter` owns consent), [ADR-0006](0006-offline-first-sync-outbox.md) (provider I/O outside transactions), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md), ADR-0150 (Proposed in the #1144 branch) (the inbound verification gate and the "no authenticated provenance, no state change" rule).
- **Related:** Issues #1139, #1140 (account registry), #1154, #1159, #1160, #1161, #1162, #1167, #1168, #1172; downstream `ahliweb/awcms-one` #458, #459, #461 and its `commerce` segments and campaigns (#114, #360, #362); the UI traceability draft (PR #1175, UP-01..16); the readiness pack [`docs/awcms/omnichannel-foundation.md`](../awcms/omnichannel-foundation.md) §2, §3, §5.

**Docs and governance only.** No module, table, migration, route, OpenAPI path, AsyncAPI channel, dependency or provider call is added. Acceptance means the **design is admitted**; each of #1159 to #1162 still passes its own Definition of Ready and the security review for credentials and webhooks.

## Context

Verified on `main` at 27 October 2026 (the **implemented** state):

- `src/modules/email/infrastructure/mailketing-provider.ts` implements **Mailketing v1**: `POST {baseUrl}/api/v1/send`, `application/x-www-form-urlencoded`, `api_token` **in the request body**, response `{status, response, message_id?}`; `status:"failed"` on HTTP 2xx is a non-retryable business rejection; network, timeout and 5xx are retryable; a per-provider circuit breaker (`email-mailketing`) counts only service-level failures. Calls go through `fetch` with a configuration-supplied base URL.
- `resolveEmailProvider` picks **one** provider for the whole deployment from `EMAIL_PROVIDER`, `EMAIL_MAILKETING_API_TOKEN` and `EMAIL_MAILKETING_API_BASE_URL`. `EMAIL_MAILKETING_ACCOUNT_ID` is an operator-facing label that is never sent to the provider. The sender comes from deployment settings (`EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`). `awcms_email_messages` has no sender or account column and no purpose class (only `category`).
- The `email` module is already the durable outbox: lease-claimed `email-dispatch`, retry, templates with per-category variable allow-lists, `awcms_email_delivery_attempts`, and a suppression list (`awcms_email_suppression_list`, admin screen #544) that the dispatcher **re-checks right before sending**. `provider_message_id` is stored per message. The accepted trade-off is one possible duplicate send when a crash lands between "provider accepted" and finalize.
- `newsletter` (ADR-0103) owns subscription consent, confirmation and unsubscribe. Downstream `commerce` (awcms-one) owns the customer, segments, campaigns and WhatsApp/email fan-out.
- There is **no inbound email webhook** in this repository.

What the provider documents (official documentation, **as of 24 October 2026**, which the implementing issues re-verify):

- **API v2.0.2 (2026-10-23)**, base `https://api.mailketing.co.id/api/v2`: `POST /send` (JSON), `GET /credits`, `GET /senders`, `GET /lists`, `POST /subscribers`. Auth by header, `Authorization: Bearer` or `X-Api-Token`. Response `{success, data.message_id}`. **No documented generic campaign CRUD, list creation or deletion, or subscriber unsubscribe or delete endpoint.**
- **Breaking correction in v2.0.2:** `message_id` is **always provider-generated** and cannot be supplied on a send. The changelog is authoritative where the rendered request-field prose lags it; sandbox contract fixtures confirm.
- `success:false` on HTTP 200 is a failure; `success:true` means **queued**, not delivered. Documented statuses of interest: 401, 402 (no credit), 403 (sender unverified), 422 (invalid), 429 (with `Retry-After`), 5xx. The rate policy limits **30 failed requests per minute per IP** (since v2.0.1); it throttles failures, not successes.
- Webhook events: `emailopen`, `emailclick`, `bounce`, `newsubscriber`, `unsubscribe`; `delivered` is **Business API only**. **No signature or HMAC verification appears in the reviewed public documentation.**
- Product owner requirement: Mailketing **v2** is the target production transport; v1 is not to remain the active production transport.

What is not established and this ADR must not assume: a provider-side idempotency key, a remote unsubscribe or delete API, an authenticated webhook, a source-IP list, or a message-status polling endpoint.

## Decision

### 1. One adapter family, two versions: migrate by staged flip, not by in-place rewrite

Two versioned adapters sit behind the existing `EmailProvider` port (`createMailketingV1Provider` is today's code, unchanged; `createMailketingV2Provider` is new). The version is a property of the **connection** (and, for the legacy deployment sender, of one new env variable `EMAIL_MAILKETING_API_VERSION`, default `v1` until the flip). The port, the queue, the dispatcher, templates, suppression and attempts ledger do not change shape. A `null` account keeps today's behaviour byte for byte (ADR-0148 I13).

Rollout stages (each is a separate gate, and none flips production without real-vendor confirmation and a rollback path):

| Stage | State                                                                                                  | Gate to enter                                                     |
| ----- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 0     | Today: v1, deployment-wide                                                                             | none                                                              |
| 1     | v2 adapter exists, flag off; sandbox contract fixtures pass                                            | #1159 merged                                                      |
| 2     | v2 used in staging against the real vendor (a throwaway sender), read-only health in production        | Q3 criteria met, owner signs                                      |
| 3     | **v2 becomes the default** for new connections and the legacy sender; v1 stays selectable              | Stage 2 evidence recorded                                         |
| 4     | v1 allowed only as an explicit, audited, time-boxed rollback (window length: Q2); then a removal issue | Stage 3 stable; a tracked issue to delete v1 is opened at stage 3 |

v2 specifics the adapter must honour: credentials in a **header only** (never query, never body, never logged); JSON body; `success:false` on 200 is a failure; `success:true` is "accepted/queued" (maps to `sent` with a note that `delivered` is not known, as with WhatsApp in ADR-0148 §4); the response `data.message_id` is stored as `provider_message_id` **after acceptance** and is **not** an idempotency key. Our immutable internal queue id stays distinct from it. A crash after the provider accepted but before finalize is **uncertain** (possible duplicate on re-claim), exactly the existing documented trade-off; no provider-side dedupe is claimed.

Error classification (maps onto the existing `retryable` and breaker rules):

| Response                           | Meaning                  | Message outcome                                                          | Account / connection effect                                                                            |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 200 `success:true`                 | Queued by provider       | `sent` (accepted), store `provider_message_id`                           | breaker success                                                                                        |
| 200 `success:false`                | Provider rejected        | `failed`, non-retryable                                                  | none (provider is up)                                                                                  |
| 401                                | Token invalid or revoked | `failed`, non-retryable                                                  | connection `degraded` (auth); **stop claiming** for it; operator action                                |
| 402                                | No credit                | held, not burned: back to `retry_wait` with a long lease, no retry spend | connection `degraded` (credit); dispatch for that connection pauses until `GET /credits` shows balance |
| 403                                | Sender not verified      | `failed`, non-retryable                                                  | sender account `unverified`; no automatic switch to another sender (I5)                                |
| 422                                | Invalid message          | `failed`, non-retryable                                                  | none                                                                                                   |
| 429                                | Rate limited             | retryable, honour `Retry-After`                                          | counts toward the breaker                                                                              |
| 5xx / timeout / network / non-JSON | Service problem          | retryable, bounded                                                       | counts toward the breaker                                                                              |

Because the vendor's limit counts **failed requests per IP**, and a deployment's tenants share the egress IP, one tenant's invalid token could lock every tenant out. The adapter therefore keeps a **per-connection failure budget** (consecutive 4xx stop that connection's claiming before the IP-wide threshold) and caps outgoing traffic locally, in addition to the per-connection circuit breaker (today the breaker key is global; per-connection keys are part of #1159/#1160).

### 2. Accounts: each Mailketing connection is a `channel_account` in the #1140 registry

Per ADR-0148: a **Mailketing connection** is a `channel_provider_connection` with auth mode `api_token` (not OAuth); each **verified sender identity** is a child `channel_account` (kind `email_sender`) of that connection; the API token is a `channel_secret` (envelope-encrypted, referenced by an opaque id, never returned). A tenant may hold many connections, and each connection exposes many sender addresses or domains (read from `GET /senders`). A business scope (brand) maps to a sender account; the mapping is **prospective** (a policy with a configuration version) and **snapshotted immutably** on each queued message.

- The `email` queue stays the **one** queue. `awcms_email_messages` gains a nullable, immutable `sender_account_id` (a sender key, as in ADR-0148 §4). `null` is the deployment sender and today's behaviour. No queue per account, brand or tenant.
- The dispatcher resolves the connection, the secret and the sender from the **authenticated tenant's** record at claim time, never from request input; the secret is decrypted only inside the send call for the claimed row's tenant (ADR-0148 §5 mitigations).
- A tenant-owned connection's token is never the deployment token and the deployment token is never used for a tenant-owned account. Deployment-owned system mail (password reset, security notices) keeps the deployment sender (Q7).
- **No automatic sender rotation** to bypass a reputation score, a limit or a block (I4, I5). A disabled, unverified, revoked or foreign-tenant sender makes enqueue refuse with `SENDER_UNAVAILABLE` and a claimed row terminal `failed`.
- A domain is only usable when the provider reports the sender as verified; SPF, DKIM and DMARC state is read through read-only DNS checks and shown as **advisory evidence** with the date of the last check (Q9). A failing record never silently switches the sender.

Registry vs separate table. Chosen: the registry (#1140). A separate `email_provider_connection` table would duplicate secret handling, health, assignment and capability evidence already designed for C1 and would be a second implementation of the most security-sensitive part. The cost is a hard dependency: #1160 cannot start before #1140 has its model and security review.

### 3. Ownership map (who is authoritative for what)

| Concern                                                          | Authority                                                                 | Mailketing holds                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| Outbound queue, dispatch, attempts, templates                    | upstream `email`                                                          | nothing authoritative; it accepted a request             |
| Suppression (bounce, complaint, unsubscribe, manual)             | upstream `email`                                                          | its own internal state, **never** read back as authority |
| Subscription consent, confirm, unsubscribe                       | upstream `newsletter` (ADR-0103); `commerce` for its customers downstream | nothing                                                  |
| Customer, segments, marketing campaigns                          | downstream `commerce` (awcms-one #461)                                    | nothing                                                  |
| Accounts, secrets, sender mapping, capability evidence           | upstream `channel_accounts` (#1140)                                       | external sender ids and list ids as references           |
| Transport analytics (credit, accepted, provider-reported events) | shown as **provider-reported**, never as ground truth                     | the raw numbers                                          |

Mailketing lists (`GET /lists`, `POST /subscribers`) are **external references**, not authority. Recommendation: the multi-account work does **not** push subscribers to Mailketing lists at all (Q5): our campaigns fan out through our own queue, one recipient per message, as today, so a remote list adds a second copy of personal data and a second consent surface for no capability we need. `GET /lists` may be shown read-only. A remote list is never imported as proof of permission.

### 4. Purpose classes, consent and suppression precedence

`awcms_email_messages` gains an immutable `purpose` (`transactional` / `security` / `marketing`; Q8 decides where classification is made). Rules, evaluated **at enqueue and again immediately before dispatch** (ADR-0133 §4; the dispatcher already re-checks suppression):

1. **Hard suppression** (hard bounce, spam complaint, manual block) stops every purpose except where law requires a security notice and the address is deliverable; there is no override path from a campaign.
2. **Unsubscribe or consent withdrawal** stops `marketing` only. It never blocks `security` or `transactional` mail, and a marketing opt-out never suppresses a password reset.
3. **`marketing`** requires a recorded, currently valid consent evidence reference from `newsletter` (or the downstream customer's consent for a `commerce` campaign) plus an unsubscribe mechanism in the message. Segment membership, a remote list, or an imported file is never consent (I8).
4. Suppression and withdrawal win over everything already queued.
5. **Withdrawal propagation:** Mailketing documents no delete or unsubscribe endpoint, so upstream suppression is the authority and nothing is "called" remotely. If a recipient was ever pushed to a remote list (not planned, Q5), removal is an **operator workflow**: a checklist item with an audited task and a reconciliation report of recipients still present remotely. We never fake an HTTP call that does not exist.

### 5. The webhook: no authenticated provenance, no state change

Reviewed public documentation shows no signature or HMAC. ADR-0148 §3 already marks inbound for email `restricted`, and ADR-0150 I9/N5 forbids treating URL secrecy as authentication for content that changes customer state. Decision for #1161, in two modes with a safe default:

- **Mode `strict` (the default until Q1 is answered).** The endpoint exists only behind a flag and accepts events, but **no event changes suppression, consent, a message's status, a subscriber or a customer**. Every event is validated (size cap, JSON shape, a per-connection opaque callback token stored hashed, replay dedupe on `(account, event type, provider_message_id, recipient hash, timestamp)`), attributed to a tenant, connection and **our own `provider_message_id`** (an event for an id we did not issue is discarded), and written to a **quarantine ledger** shown to operators as "provider-reported, unauthenticated". An operator may confirm a bounce or unsubscribe into the suppression list (an audited human decision).
- **Mode `restrictive-only` (needs maintainer approval, Q1).** Additionally, an event that matches a message we issued may **add** a suppression for `bounce` or `unsubscribe` (a restrictive, fail-safe direction: it can stop mail, it can never create consent or send more). Forgery risk is a nuisance suppression of one recipient (low), mitigated by the message-id binding, the opaque token and an audited, reversible suppression.
- In both modes: `emailopen` and `emailclick` are **counters only**, labelled unauthenticated, never proof of reading (image proxies and security scanners open and click) and never used for scoring or customer state; `newsubscriber` is ignored (it must never create a subscriber or consent); raw tracked links in click events are stored as host plus hash and rendered as text, never as a clickable link and never fetched; `delivered` is not expected on this API tier and is never inferred.
- **Compensating controls that depend on the vendor** are requested in Q6 (a signed header or a configurable secret header, a published source-IP list, an event id). If the vendor adds a verifiable mechanism, mode `authenticated` is admitted by a one-line ADR amendment and the ADR-0150 verification gate; until then the matrix cell stays `restricted`.
- The endpoint runs under pinned Bun, performs no database work before token and size checks, rate-limits per connection, and aggregates rejection audit as in ADR-0140 §9 (ADR-0150 §4).

### 6. Security, privacy and operations

- **Provider I/O** only from the durable Bun queue (`ssrfSafeFetch` to a **fixed, deployment-configured** provider host, never tenant-supplied; bounded timeouts; per-connection breaker). SSE or WebSocket may show redacted queue state to authorised users and is never a delivery acknowledgement or a send path (#1168).
- **Secrets:** header-only auth; masked everywhere; canary test that a known token never reaches a log, response, event, job payload or UI.
- **Health and cost:** a health job reads `GET /credits` and `GET /senders` (read-only) into per-connection health (balance, sender states, last sync). Credit forecast is an advisory moving average of recent sends against balance (Q11 sets the scope). Per-connection and per-tenant send caps and a daily budget, and an automatic **pause** (not a rotation) of marketing when a complaint or bounce rate crosses a threshold.
- **UU PDP No. 27/2022:** the data that leaves for Mailketing is the recipient address, sender, subject and body of each message (personal data and possibly personal content); Mailketing is a processor whose location and terms the **controller** must record (cross-border disclosure, Art. 56), with a processing agreement (Q10); minimisation (no extra attributes, no list sync, Q5); purpose classes (§4); logs carry masked addresses only (the existing `email-log-redaction`); a data-subject erasure removes the recipient from our tables, and the remote copy is bounded by the provider's own retention, disclosed to the controller.
- **RLS `FORCE`** with `USING` and `WITH CHECK` and composite `tenant_id` keys on every new table; ABAC default-deny; new permissions seeded by migration in the same change as their route (names finalised by #1160/#1162, for example `email.connections.read|manage|credentials.manage` (high-risk, step-up), `email.senders.use`, `email.webhook.review`).

### 7. Contracts, docs and rollout mechanics (for #1159 to #1162)

- OpenAPI: connection and sender admin routes, health (credit, sender state, last sync), webhook callback, quarantine review; AsyncAPI: `email.message.*` gain `sender_account_id` (additive), connection health events, quarantine events. DTOs carry ids and codes, never a token. All in the same pull request as the code, English and Indonesian mirrors.
- Docs and skill mirrors updated with the code: `src/modules/email/README(.id).md`, `.claude/skills/awcms-email/SKILL.md`, the omnichannel pack, `docs/awcms/` env reference (`EMAIL_MAILKETING_API_VERSION`, flags), and the admin UI contract (UP rows for the v2 badge, verified sender, credit, queue status, last sync, migration warning).
- Migrations: new forward-only files only; no applied migration is rewritten; a sender key and a purpose column are nullable or defaulted so existing rows and deployments with no account behave as today.
- Gates: full `bun run check`, a two-tenant RLS test, a token canary, v1 and v2 contract fixtures (including each status in §1), a replay test for the webhook, and the security review for #1160 and #1161.
- **Derived templates and downstream:** `awcms-one` consumes the sender-aware port after upstream merge and a subtree sync (`apps/cms`) as a **merge commit only, never squash or rebase**; template profiles are verified before the sync is accepted. The `legacy`/`upstream` mode router (awcms-one ADR-0047) is unchanged.

### 8. What is implemented versus planned

| Capability                                                   | Today (`main`)                  | Planned by              |
| ------------------------------------------------------------ | ------------------------------- | ----------------------- |
| v1 send, queue, retry, breaker, suppression                  | implemented                     | n/a                     |
| One deployment token and sender (env)                        | implemented                     | kept as the `null` path |
| v2 adapter, health (`/credits`, `/senders`)                  | not implemented                 | #1159                   |
| Many connections and verified senders per tenant             | not implemented                 | #1160 (after #1140)     |
| Webhook intake (quarantine) and trusted status               | not implemented                 | #1161                   |
| Email admin UI for accounts, credit, health                  | not implemented                 | #1162 (after #1160)     |
| Commerce sender, list and campaign adapter                   | not implemented                 | awcms-one #461          |
| Remote campaign CRUD, list create/delete, remote unsubscribe | **not offered by the provider** | will not be built       |

### 9. Invariants for downstream issues (#1159 to #1162)

M1. v2 credentials travel in a header only; v1 body-token behaviour is unchanged and confined to the v1 adapter. No token in a query string, log, audit row, event, response or UI.
M2. `provider_message_id` is stored after acceptance and is never used as an idempotency key; the internal queue id stays distinct; crash-after-accepted is documented as uncertain.
M3. `success:true` is "queued", never "delivered"; `success:false` on HTTP 200 is a failure; every status of §1 has a fixture and a classified outcome.
M4. The one `email` queue stays; the sender is a nullable immutable key on the row; `null` equals today's behaviour; no queue per account.
M5. The secret and the sender are resolved from the authenticated tenant's record at dispatch; no request-supplied token, host or sender id; a foreign-tenant or disabled sender is refused, never rerouted.
M6. No automatic sender, account or channel failover, and no sender rotation to avoid a limit, a block or a reputation signal.
M7. Consent and suppression are checked at enqueue and again immediately before dispatch; purpose classes follow §4; a remote list is never proof of consent; withdrawal needing a remote action is an operator workflow.
M8. An unauthenticated callback changes no customer state; in `strict` mode it changes nothing at all except the quarantine ledger. Open, click and new-subscriber events never create consent or scores.
M9. Per-connection failure budget and local rate cap; one tenant's bad credential cannot exhaust the shared-IP failure allowance.
M10. Everything runs under the pinned Bun runtime; SSE or WebSocket carries redacted UI state only.
M11. Every new table: RLS `FORCE`, `subjectData` and `data_lifecycle` descriptors in the creating migration, forward-only migration.
M12. No claim in code, UI or docs of a remote campaign, list-management or authenticated-webhook capability the provider does not document; the UI states "provider-reported" for webhook-derived figures.

## Options considered

### Adapter strategy

| Criterion              | **C. Versioned v1 + v2 adapters, staged flip (chosen)**              | A. Keep v1 only                                           | B. Replace v1 with v2 in place                                  |
| ---------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| Security               | v2 header-only token; v1 body token confined and time-boxed          | Token stays in the request body; v1 is end-of-life        | Best end state, but no tested rollback if the vendor misbehaves |
| Performance            | Equivalent; per-connection breaker added                             | Equivalent                                                | Equivalent                                                      |
| Maintainability        | Two adapters for a bounded window, then one                          | Lowest now, highest later (vendor retires v1)             | One adapter, but a risky single change                          |
| Scalability            | Version per connection allows gradual tenant migration               | Blocks multi-account v2 features (`/senders`, `/credits`) | Same as C after the flip                                        |
| Compatibility          | Existing deployments untouched until the flip; owner requirement met | Violates the owner's "v2, not v1" requirement             | Breaks deployments that cannot take the change at once          |
| Operational complexity | A flag and a documented rollback window                              | None                                                      | Incident-driven rollback only                                   |
| Long-term implications | A tracked v1 removal issue closes the window                         | Debt that becomes an outage                               | None, if it works                                               |

### Account model

| Criterion              | **Registry (#1140) with sender child accounts (chosen)**     | Separate `email_provider_connection` table      | Env list of tokens                             |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------- | ---------------------------------------------- |
| Security               | One audited secret store, capability evidence and revocation | Second implementation of secret handling        | Tokens in the environment; no tenant isolation |
| Maintainability        | Reuses health, assignment, ABAC and the UI                   | Parallel code that drifts                       | Redeploy to change a token                     |
| Scalability            | Rows, not deployments                                        | Rows, duplicated tooling                        | Does not scale per tenant                      |
| Compatibility          | `null` account is today's behaviour                          | Same                                            | Same                                           |
| Operational complexity | Depends on #1140 delivery order                              | Independent of #1140, but extra to operate      | Lowest, wrong                                  |
| Long-term implications | Email, WhatsApp and Telegram share one account model         | Likely merged into the registry later at a cost | A dead end                                     |

### Webhook handling

| Criterion              | **Quarantine in `strict` mode, `restrictive-only` after approval (chosen)** | Defer entirely (no endpoint)                 | Trust the secret URL and apply all events                                                            |
| ---------------------- | --------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Security               | No state change without authentication; forged events cannot harm           | Safest                                       | Forged bounce or unsubscribe suppresses recipients; forged `newsubscriber` could create a subscriber |
| Performance            | Cheap checks first; small ledger                                            | None                                         | Writes on every event                                                                                |
| Maintainability        | One reusable intake plus quarantine view                                    | Nothing to maintain                          | Fragile logic around untrusted input                                                                 |
| Scalability            | Bounded by per-connection rate limits                                       | n/a                                          | Flood-prone                                                                                          |
| Compatibility          | Meets "fail closed for untrusted events"                                    | Meets it; leaves operators blind to bounces  | Violates the owner's rule                                                                            |
| Operational complexity | Operators review a quarantine list                                          | Operators rely on the provider dashboard     | Hidden errors                                                                                        |
| Long-term implications | Upgrades to `authenticated` if the vendor adds a signature                  | Same upgrade path, nothing learned meanwhile | Hard to unwind bad data                                                                              |

### Compliance reading

- **UU PDP No. 27/2022:** consent per purpose and channel (I8, §4); minimisation (no list sync, masked logs); processor disclosure and cross-border transfer are the controller's records (Q10); breach notification needs the audit and decrypt telemetry of the pack.
- **ISO/IEC 27001:2022 and 27002:2022:** secrets (5.17, 8.24), access (5.15, 8.2), supplier relationships (5.19 to 5.23: Mailketing is a supplier whose documented limits are inputs), logging (8.15), secure coding (8.28), information deletion (8.10), PII (5.34).
- **ISO/IEC 27005:** largest risks are credential concentration in the dispatcher (accepted in ADR-0148 §5), IP-wide failure lockout (M9), forged callbacks (§5), and sending to withdrawn recipients (§4, checked twice). Removed: second queue, deployment-wide token for tenant accounts, rotation to dodge limits.

## Consequences

- **Positive:** one decision for four implementation issues; no second queue; v2 migration is staged and reversible; the webhook cannot be used to change customer state; ownership of consent, suppression and campaigns is unambiguous; unsupported provider capabilities are not promised.
- **Negative / trade-off:** two adapters for a window; a hard dependency of #1160 on #1140; in `strict` mode operators confirm bounces by hand until the vendor offers authentication or the maintainer approves `restrictive-only`; opens and clicks stay low-trust numbers.
- **Neutral:** nothing changes for any deployment until the v2 flag or an account is configured; the legacy env path remains.
- **Human sign-off still needed (not performed here):** the controller or DPO for the Mailketing processing agreement and consent copy; the owner for the v2 flip and the vendor outreach; the security review of #1160 and #1161 before merge.

## Open questions for the maintainer

- **Q1.** Webhook mode: ship `strict` only (recommended default), or approve `restrictive-only` (add suppression on a message-id-bound bounce or unsubscribe)? The owner's rule "must not mutate customer state on an unauthenticated event" is read literally in `strict`.
- **Q2.** Length of the audited v1 rollback window after the v2 flip (recommendation: 60 days, then the removal issue), and whether v1 may be re-enabled after it.
- **Q3.** Criteria and sign-off for the stage 3 flip (recommendation: contract fixtures green, a staging run against the real vendor with a throwaway sender, one production tenant on v2 for 14 days with no unexplained 4xx).
- **Q4.** Confirm the registry (#1140) model over a separate connection table, and the dependency that follows.
- **Q5.** Do we use `GET /lists` and `POST /subscribers` at all? Recommendation: `GET /lists` read-only if useful, never `POST /subscribers`.
- **Q6.** May the owner ask Mailketing for a signed webhook header or configurable secret, a published source-IP list, an event id, an idempotency key and a delete or unsubscribe API? Their answers change Q1 and Q5.
- **Q7.** Should tenant security mail (password reset) use the tenant sender or stay on the deployment sender? Recommendation: stay on the deployment sender so account recovery never depends on a tenant's credit or verification.
- **Q8.** Who classifies `purpose`: the calling module at enqueue (recommended, enforced by an allow-list per template category) or a per-template setting?
- **Q9.** Who owns SPF, DKIM and DMARC checks: advisory read-only DNS evidence from upstream (recommended) or provider-side verification only?
- **Q10.** Is a processing agreement or addendum with Mailketing in place, and where does it process data? (controller action)
- **Q11.** Scope of credit forecasting: a simple advisory moving average (recommended) or an enforced budget that blocks sends?
- **Q12.** Choice between `Authorization: Bearer` and `X-Api-Token` for the v2 header. Recommendation: `Authorization: Bearer`, confirmed by the sandbox.

## Alternatives rejected

- **A second email queue or a Mailketing-side campaign engine.** The `email` outbox already provides lease, retry, templates, suppression and attempts; the provider documents no campaign CRUD.
- **A deployment-wide token for tenant-owned accounts, or tenant tokens in settings JSON.** Violates ADR-0148 I3 and §5.
- **Sender rotation or automatic failover to bypass limits or reputation.** Violates I4 and I5.
- **Treating the remote list or `message_id` as consent proof or idempotency.** The provider documents neither.
- **Trusting a secret URL for webhook state changes.** Rejected by ADR-0150 I9/N5.
- **A Node or Socket.IO service for dispatch or webhooks.** Violates the Bun-only rule (I10).

## Implementation plan (separate issues, after acceptance)

1. **#1159** v2 adapter with the v1 fallback flag, health (`/credits`, `/senders`), contract fixtures, per-connection breaker.
2. **#1160** (after #1140) connections, verified senders, brand mapping, `sender_account_id` and `purpose`, secrets, ABAC and RLS; security review.
3. **#1161** webhook intake in `strict` mode, quarantine ledger and operator confirmation; `restrictive-only` and `authenticated` only after Q1 and Q6.
4. **#1162** admin UI (v2 badge, verified sender, credit, queue status, last sync, migration warning).
5. **awcms-one #461** after a merge-commit subtree sync.
