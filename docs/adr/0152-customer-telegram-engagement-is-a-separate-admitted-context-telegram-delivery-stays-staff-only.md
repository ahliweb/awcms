🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](0152-customer-telegram-engagement-is-a-separate-admitted-context-telegram-delivery-stays-staff-only.id.md)

# ADR-0152 — Customer Telegram engagement is a separate admitted context; `telegram_delivery` stays staff-only and unchanged; many bots per tenant are admitted through `channel_accounts`

- **Status:** Proposed
- **Review:** becomes Accepted after maintainer review. Until then it is a recommendation. Nothing in it authorises code, and the downstream issues #1156 and #1157 stay blocked on it (their Definition of Ready names this ADR).
- **Date:** 2026-10-27
- **Decision maker:** @ahliweb (maintainer review pending)
- **Resolves:** Issue #1155 (the Telegram customer-messaging admission that [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) §9 left to a separate decision)
- **Extends:** [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) (invariants I1 to I13 are binding here; Telegram bots and channels are account kinds of `channel_accounts`), [ADR-0140](0140-telegram-delivery-adapter-ops-staff-alerts-only.md) (staff-only, one bot per deployment: **unchanged**), [ADR-0139](0139-cross-channel-notification-orchestration-not-admitted.md) (no facade, no fallback), [ADR-0133](0133-generic-delivery-capability-whatsapp-promotion.md) §3 and §4 (see the open question O1 on §3), [ADR-0137](0137-payout-account-encryption-at-rest-and-keyed-hashing.md) (the shared field-encryption helper), [ADR-0094](0094-a-data-subject-is-answered-per-tenant.md), [ADR-0134](0134-descriptor-declared-domain-event-consumers.md)
- **Related:** Issues #1139, #1140 (account registry), #1144 (inbound boundary), #1145 (publishing engine), #1156 (implementation: multi-bot accounts and conversations), #1157 (implementation: channel publishing), #1167, #1168 (Bun runtime and realtime), downstream `ahliweb/awcms-one` #460 (CRM adapter); the pack [`docs/awcms/omnichannel-foundation.md`](../awcms/omnichannel-foundation.md) §3 (capability matrix), [`docs/awcms/omnichannel-ui-ux-screen-contracts.md`](../awcms/omnichannel-ui-ux-screen-contracts.md); [`src/modules/telegram-delivery/README.md`](../../src/modules/telegram-delivery/README.md)

**Docs and governance only.** This ADR adds no module, table, migration, route, OpenAPI path, AsyncAPI channel, dependency or Telegram call. Table and route names below are **illustrative** so that the invariants can be stated; the implementation issues fix the real ones. Nothing here is evidence that a customer Telegram connector works. Statements about what the Telegram Bot API allows come from the issue text and the public documentation (<https://core.telegram.org/bots>, <https://core.telegram.org/bots/api>, <https://core.telegram.org/bots/features>) and are marked **to verify** where the implementation issue must re-check them against the documentation in force on the day it is built.

## Context

Verified on `main` at 27 October 2026:

- `telegram_delivery` is an off-by-default **staff_ops-only** module ([ADR-0140](0140-telegram-delivery-adapter-ops-staff-alerts-only.md)): **one bot per deployment** (token, username and webhook secret are environment values), a private chat bound by a **staff member** through a handshake plus a PIN confirmed in an authenticated admin session, one purpose (`staff_ops`), typed variables that cannot carry free text, no groups, no channels. Its README says it refuses, "with no exception and no override flag", payroll, personal data, **customer-facing messages**, `security`-class messages, **marketing** and any fallback of another channel.
- `TelegramDeliveryPort.enqueue` takes a **tenant staff principal** (`recipientPrincipalId`, an `awcms_tenant_users.id`), never a chat id. Its webhook is one deployment-wide route that acts on private chats only (`allowed_updates=["message"]`) and holds no outbound token.
- [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) (Accepted, 24 October 2026) admitted a `channel_accounts` control plane (#1140) and bound every channel to invariants I1 to I13. Its matrix row for "Telegram bot / channel (customer scope)" is: publish `candidate` (bot as channel administrator), reply `candidate`, dm `candidate` **only after the user starts the bot, no cold DM**, inbound `candidate` (webhook secret token), comments `unverified`, broadcast `restricted` (rate limits, consent). It states that nothing in ADR-0148 changes `telegram_delivery`.
- Nothing in this repository represents a customer's Telegram identity, a consent given on Telegram, or more than one bot.

The product ask is Telegram as an omnichannel CRM channel: several bots per tenant (for example a support bot and a brand bot), several channels and groups per bot, customer conversations, bot-published channel content and opt-in notices. The risk is the usual one: "relax" the staff module until it fits, and in doing so erase the very guarantees (staff-only, no free text, one bot, no customer data) that make the module safe to leave enabled.

### What the Telegram surfaces really are (to verify at implementation)

They differ in who may be addressed and under what authority, which is why one "Telegram send" abstraction is rejected:

| Surface                       | Who is the counterparty                                                      | What authorises a message                                                                                    | Notes that drive the design                                                                                                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer support DM           | A person who **started** the bot (a private chat)                            | The person's own first contact; they can block the bot at any time (the API then answers 403)                | A bot **cannot** message a user who has not started it, and cannot look a user up by phone or handle. A private chat id equals the Telegram user id, so it is the same id under every bot. |
| Bot-published channel content | An audience that follows a channel; the tenant is the publisher              | The bot being an **administrator** of the channel with the post right                                        | Following a channel is not a contact, a consent or an identity. Destination ids are not interchangeable with chat ids. Admin rights can be revoked at any time.                            |
| Group activity                | Many members of a group the bot was added to                                 | Group membership of the bot, **privacy mode** (on by default, the bot sees commands and mentions) and rights | Harvesting members is not a feature of the Bot API and is barred here. A group may migrate to a supergroup and **change its chat id**.                                                     |
| Telegram Business connection  | A person's own business account that connected the bot                       | The account owner's consent and the rights they granted the bot                                              | Availability and semantics are **unverified** against the documentation in force; not admitted in v1.                                                                                      |
| Opt-in marketing notice       | A person who started the bot **and** separately opted in to a stated purpose | A recorded, purpose-specific opt-in, re-checked at dispatch                                                  | `/start` alone is the start of a conversation, not marketing consent.                                                                                                                      |

## Decision

### 1. `telegram_delivery` is staff-only and unchanged

`telegram_delivery`, its queue, its templates, its storage, its webhook, its `TelegramDeliveryPort`, its permissions, its environment values and its refusals are **not modified in any way** by this decision or by anything that implements it: no new purpose, no recipient other than a staff principal, no second bot, no group or channel, no free-text variable, no code path that lets a customer id reach it. A change to `telegram_delivery` needs its own ADR that supersedes [ADR-0140](0140-telegram-delivery-adapter-ops-staff-alerts-only.md). A test (§8, T-N1) holds the module's public port signature and its purpose list fixed.

**The two stay physically apart.** The deployment's staff bot (`TELEGRAM_BOT_TOKEN`) must never be registered as a customer bot. Registration of a customer bot compares the bot identity returned by `getMe` with the staff bot's and refuses a match (a bot has one webhook, so sharing it would also merge two security models on one URL). The customer-bot code does not import `telegram_delivery` and does not read its environment values or its tables.

### 2. A new module, `telegram_engagement`, with its own purposes and rules

Customer Telegram is admitted as a **new system module `telegram_engagement`**, off by default at deployment, module and tenant level, with its own permission namespace (`telegram_engagement.*`, separately grantable; account and secret permissions are high-risk and step-up-gated per ADR-0148 §5). It has three jobs and no more:

- **E1, customer conversations (DM).** Per-bot verified inbound, a platform-scoped contact, per-purpose eligibility, an outbound queue for replies and opted-in notices.
- **E2, consent evidence.** `/start`, `/stop` and the explicit opt-in or opt-out, as append-only evidence (§6).
- **E3, the bot-side half of publishing.** Verification of a bot's administrator rights on a destination channel, and nothing else. **The act of publishing belongs to `social_publishing`** (#1145 and #1157), through its adapter, because publishing is content-shaped, scheduled and approval-gated while a conversation is not (ADR-0148 §1, C3). `telegram_engagement` offers `social_publishing` a narrow port ("is this bot allowed to post to this destination, and how do I send with it"); it never owns a publishing queue.

Group activity and Telegram Business connections are **not admitted in v1** (§7).

### 3. Accounts: many bots, channels and groups, all as `channel_accounts` (#1140)

- A **bot** is a `channel_account` of kind `telegram_bot`, unique per `(tenant, provider, external id)` (I1). The external id is the bot's numeric id from `getMe`, **not** its username (usernames can be changed). A second tenant claiming the same bot is refused, never merged.
- A **destination** (a channel, and later a group) is a `channel_account` of its own kind (`telegram_channel`, `telegram_group`), linked to the authorising bot by a grant row. A destination chat id is stored as an external id of that kind; it is a different type from a private chat id and the two cannot be substituted for each other (schema and port types both distinguish them). Many destinations per bot and many bots per tenant are allowed.
- The **bot token is a `channel_secret`** (ADR-0148 §5): envelope-encrypted with `src/lib/security/field-encryption.ts`, addressed by an opaque reference, written through an audited, high-risk, step-up-gated permission, **never** in settings JSON, an API response, a browser, a log, an audit row, an event, a job payload, a campaign definition or any AI or CRM-AI context (I3, I11). The Telegram token is part of the API URL path, so, as in `telegram_delivery`, the request URL is built only inside one infrastructure client (a fixed host through `ssrfSafeFetch`, under a timeout), and every error that leaves it passes the redactor that strips the token and token-shaped strings.
- A brand or business unit is a **business scope** (I1); a bot is bound to exactly one tenant and one business scope at registration, and a conversation inherits both.
- **Connection ceremony.** Registering a bot is: an administrator pastes the token once (server-side, never echoed), the server calls `getMe` to learn the bot id and username, `getWebhookInfo` and `setWebhook` with the per-bot parameters of §4, and records capability evidence. Registering a channel is: the bot's administrator rights are read from the API (`getChatMember` for the bot on that chat, to verify) and stored as the capability grant with its evidence time; **rights are re-verified before scheduling and at delivery** (#1157) because they can change between the two.
- **Revocation and rotation.** Disabling an account ends its webhook (`deleteWebhook`), cancels waiting outbound rows terminally and makes the next claim fail closed (ADR-0148 I5). Rotating a token after a BotFather revoke is a new `channel_secret` version, followed by `setWebhook` again; the old callback token and secret stop working with it (§4).

### 4. Inbound: verified, per bot, bound by the route and not by the payload

Per [ADR-0148](0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md) I9 and the per-bot extension of ADR-0140 §7:

- **One independent callback route per bot account**, `POST /api/v1/telegram-engagement/webhooks/{callbackToken}` (illustrative), where `callbackToken` is an opaque high-entropy value generated by the server, stored only as a keyed hash, and unique per account. **The bot, the tenant and the business scope are resolved from the callback token**, never from anything in the payload (the update body carries no bot identity and must not be trusted for one).
- **`setWebhook` carries a per-bot `secret_token`** (a random value within Telegram's allowed character set and length, to verify), stored as a `channel_secret`. Telegram sends it back as `X-Telegram-Bot-Api-Secret-Token`; it is compared in **constant time** with the account's secret **before any body read or database work**. A missing or wrong header, an unknown callback token and a disabled account all answer the **same generic response**, so the route is not an oracle for which tokens exist.
- **`allowed_updates` is the minimal list** the admitted features need (to verify: `message`, `my_chat_member` for block and unblock, and `callback_query` for the consent buttons). No update type is enabled "in case".
- **TLS and ports** follow the Bot API's webhook requirements (HTTPS, a supported port, a valid certificate chain): the route is served only behind the deployment's TLS; the account's health shows `getWebhookInfo` errors and pending counts.
- **Idempotent ingestion.** A unique key on `(account, update_id)` makes a replay or a Telegram retry a no-op; the handler writes the immutable inbound evidence in a short transaction and answers 200 quickly; any outbound call happens later through the queue (ADR-0006, I10). `update_id` is a per-bot sequence, so it is never compared across bots.
- **Binding checks on every update:** the account is active and bound to this tenant; the chat is private for E1 (a group or channel update for a bot not admitted for it is dropped with a counter and no reply); the sender is not a bot (`from.is_bot`), so **bot-to-bot loops are impossible by construction**; the message is not an edited or forwarded message treated as new identity (forward and reply metadata are untrusted content, never an identity claim).
- **Throttles:** a per-account and a per-chat rate limit on the route (an over-limit chat gets a silent 200 and spends nothing else, as in `telegram_delivery`), a body-size cap, and a per-account cost ceiling for outbound work. Unauthenticated rejections are audited in aggregate on the platform tenant, never per request.
- **Webhook and polling do not mix:** a bot with a webhook set does not use `getUpdates`; the connector never polls.

### 5. Outbound ownership, rate limits and the second-queue question

| Traffic                              | Owner and path                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replies and opted-in notices to a DM | A **`telegram_engagement`-owned outbound queue** (not `telegram_delivery`'s). One queue for the module; the sender is the bot account key on it (ADR-0148 I4). A row snapshots account, contact, purpose and consent version; it carries a contact reference, **never a chat id**. |
| Channel posts                        | `social_publishing`'s job and per-target result model (#1145, #1157). Evidence is `(bot account, destination, message id)`. No second queue is created for it.                                                                                                                     |
| Group messages, Business connection  | Not admitted in v1.                                                                                                                                                                                                                                                                |
| Staff alerts                         | `telegram_delivery`, unchanged.                                                                                                                                                                                                                                                    |

- **Dispatch discipline** is the repository's (ADR-0006, ADR-0148 I10): claim in a short transaction, send outside it with `ssrfSafeFetch`, bounded timeouts, per-row leases, a per-account circuit breaker, pinned Bun, and no Node-only service. SSE or WebSocket may show **redacted status**; they are never the send path nor a delivery acknowledgement (#1167, #1168).
- **Rate and cost.** Telegram documents a per-chat pacing of about one message a second, a lower rate for a group, and a global broadcast ceiling around 30 messages a second per bot (to verify the current figures). The dispatcher paces **per bot** (one bot has one budget, which is why `telegram_delivery`'s pacer is one instance for the whole dispatch run; the new one is one instance per **account**), honours `429` with `retry_after` without spending retry budget, and enforces a per-account daily cost ceiling set by the tenant. A tenant cannot raise a bot's ceiling above the deployment's cap.
- **Delivery uncertainty.** A provider `ok` is "accepted by Telegram", never "read". A timeout after send is `uncertain` and is not blindly retried (the same rule as #1157's duplicate-send test).
- **Domain events** reuse the standard infrastructure ([ADR-0134](0134-descriptor-declared-domain-event-consumers.md)): inbound is published as the ADR-0148 §6 envelope with `channel_account_id`, platform-scoped sender and `privacy_class`; no new event bus, no WebSocket.

**Open question O1 (below) concerns ADR-0133 §3 ("one queue per channel").** A customer queue next to `telegram_delivery`'s queue is a second Telegram queue. This ADR recommends it, because the two have different purposes, privacy classes, retention and failure semantics, and merging them is the very relaxation §1 forbids. It is recorded as a **narrow amendment to be approved**, not assumed.

### 6. Consent, identity and AI-safe classification

**Consent is evidence, per purpose, and never inferred.**

- Purposes in `telegram_engagement`: `support` (a reply within a conversation the person opened), `transactional` (a notice about something the person has asked for), `marketing` (a promotional notice). None is `staff_ops`, which stays in `telegram_delivery`.
- **`/start` creates a contact and starts a conversation.** It grants `support` eligibility only. It is **not** `marketing` or `transactional` consent. The deep-link parameter of `/start` is recorded as **provenance** (which form, campaign or page sent the person), never as consent.
- **A marketing or transactional opt-in is a separate, explicit step**: the bot presents the notice text and a confirm control, and the recorded evidence is the notice **version**, the purpose, the Telegram update id, the event time and the method. Withdrawal is `/stop` or an in-chat control (effective immediately) or the provider answering 403 because the person blocked the bot (treated as revoked, never retried). A withdrawal wins over everything queued (ADR-0133 §4). Eligibility is checked **at enqueue and again at dispatch** (I8).
- **Following a channel is not consent** and not a contact; no list of channel members is ever built; a group membership is not consent.
- **Evidence is append-only** (a correction is a new row) and survives the contact's soft delete for the retention window of §6.4 so the tenant can prove what it had; it carries no message text.

**Identity.**

- A contact is **platform-scoped and account-scoped**: its key is the keyed hash of `(tenant, channel_account, telegram user id)`. Because a private chat id is the same number under every bot, scoping the hash to the account means two bots (or two tenants) **do not correlate the same person** unless a recorded linking decision says so (ADR-0148 I7, a deliberate privacy choice; see O5). The raw id is stored only as envelope-encrypted ciphertext with the masked form for display, as in ADR-0140 §6, with its own key ring and rekey job.
- **No cross-platform merge.** A Telegram id is never joined to a WhatsApp number, an email or a social id. **Linking a contact to a CRM person** needs a `contact_link_evidence` record from the closed list of ADR-0148 §6. On Telegram the admitted deterministic methods are: **(a)** the customer, authenticated on a first-party page, gets a single-use code and presents it to the bot (the ADR-0140 handshake pattern, with the tenant and person taken from the code row, never from the payload); **(b)** a shared-contact button where Telegram marks the contact as the sender's own (to verify), matched only by exact normalised value and **confirmed by a human**. A username, a display name, a forwarded message and a channel follow are **never** evidence.
- The CRM customer remains owned downstream (ADR-0148 C5; see ADR-0153 for the lead boundary). `telegram_engagement` stores a contact and a link reference, not a customer master.

**AI-safe classification** (every published event and every read model carries `privacy_class`):

| Class               | Examples                                                                       | AI or agent context                                                                           |
| ------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `operational`       | account health, webhook errors, queue counts, rate-limit state                 | allowed, redacted ids only                                                                    |
| `consent`           | opt-in, opt-out, purpose, notice version                                       | allowed as booleans and versions; never the evidence payload                                  |
| `conversation_meta` | contact opened, assignment, timestamps                                         | allowed with opaque ids                                                                       |
| `customer_content`  | message text, media, captions                                                  | **not** by default; released only by a recorded human decision in the approval workflow (I11) |
| `identity`          | Telegram user id, chat id, username, display name, phone from a shared contact | **never**                                                                                     |
| `secret`            | token, `secret_token`, callback token                                          | **never**, anywhere                                                                           |

**6.4 Retention (declared on day one, ADR-0148 I12).** Every table ships its `subjectData` and `data_lifecycle` descriptors in the migration that creates it. Message content has the shortest window (default and bounds decided by the maintainer, O3); consent evidence the longest (the proof horizon); inbound dedup keys only as long as Telegram can retry; ended contacts erase the ciphertext and the captured display fields in the same statement that ends them (the `endBindings` pattern). A legal hold skips deletes. A data-subject request is answered **per tenant and per account** (ADR-0094). Deleting a message on Telegram's side is a best-effort provider action constrained by the documented limits (to verify); the platform's own deletion does not depend on it. Chat migrations (a group becoming a supergroup) are handled for destinations by an audited external-id update, never by creating a duplicate destination.

### 7. What is deferred, and why

- **Group activity**: not admitted in v1. Registering a group as a _publishing_ destination is future scope after a permissions-and-moderation review (#1157). Group conversation is a separate ADR if ever wanted; privacy mode stays on, and no member listing or harvesting is ever admitted.
- **Telegram Business connections**: `unverified`, treated as denied. It needs its own evidence of availability, the consent of the account owner and an ADR amendment before any code.
- **Unsolicited messaging**: no feature exists that messages a person who has not started the bot, by handle, phone, scraped list or import. A test asserts the enqueue path refuses a contact with no `started` state (T-N2).
- **Payments, Mini Apps, Login Widget, inline mode, bot-to-bot**: not part of this decision.

### 8. Binding invariants for the downstream issues

Everything below **binds #1156, #1157, #1144's Telegram adapter and awcms-one #460**. They inherit ADR-0148 I1 to I13 and add:

- **TG1.** `telegram_delivery` is unchanged (§1). No import, no shared table, no shared token, no shared webhook route, no shared queue.
- **TG2.** A bot is a `channel_account` (#1140); its token is a `channel_secret`; the bot is bound to one tenant and one business scope; `(tenant, provider, bot id)` is unique and a second tenant claiming it is refused.
- **TG3.** The callback route is per bot and opaque; the bot, tenant and scope come from the callback token; the `secret_token` header is verified in constant time before any body read; failures answer one generic response.
- **TG4.** `(account, update_id)` is unique; ingestion is idempotent and acknowledges quickly; processing and every provider call are outside the ingestion transaction.
- **TG5.** Chat, bot and tenant are bound on every update and on every outbound row; a private chat id, a channel id and a group id are different types that cannot be substituted; outbound rows carry a contact or destination reference, never a raw chat id.
- **TG6.** A DM is allowed only to a contact in `started` state with the purpose's eligibility, checked at enqueue and at dispatch; a 403 or a block ends eligibility; there is no cold messaging and no fallback to another channel or account.
- **TG7.** `/start` is `support` only; `marketing` and `transactional` need a separate explicit opt-in with notice version evidence; channel follow and group membership are never consent.
- **TG8.** The contact key is account-scoped and keyed; no cross-bot, cross-tenant or cross-platform merge without recorded deterministic evidence and, for Telegram, a human confirmation where §6 says so.
- **TG9.** Channel publishing runs in `social_publishing`'s engine; admin rights are verified before scheduling and at delivery; evidence is `(bot, destination, message id)`; the destination id is never accepted from a request body without a matching granted destination row of the caller's tenant.
- **TG10.** Per-account pacing, `429 retry_after`, a per-account cost ceiling and a circuit breaker; delivery `ok` is "accepted"; an uncertain send is not blindly retried.
- **TG11.** Tokens, `secret_token`s, callback tokens and raw chat ids never appear in logs, audit, events, errors, job payloads, API responses, the browser, campaign definitions or AI context; the redactor handles token-shaped strings.
- **TG12.** Every table has `FORCE` RLS, default-deny ABAC, a `subjectData` and a `data_lifecycle` descriptor and a migration that is forward-only; retention windows are declared.
- **TG13.** Off by default at three levels (deployment, module, tenant); with nothing configured, behaviour is byte-for-byte today's.
- **TG14.** All runtime is pinned Bun, provider I/O is HTTPS through the durable queue, and SSE or WebSocket carries redacted UI state only.
- **TG15.** The OpenAPI and AsyncAPI documents, the data dictionary and the English and Indonesian mirrors ship with each implementation issue, and the security review for webhooks, credentials and the dispatcher is mandatory.

### 9. Test matrix the implementation issues must carry

| ID   | Case                                                                                                                                                                         | Owner |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| T-N1 | `telegram_delivery` port signature, purpose list and refusals are unchanged; the customer module imports nothing from it                                                     | #1156 |
| T-N2 | Enqueue for a contact that never started the bot, or a handle, a phone or an imported id, is refused                                                                         | #1156 |
| T-A1 | 2 tenants and 3 bots in one tenant, each with a distinct callback token and secret; a wrong-bot or wrong-tenant update is refused with the same reply                        | #1156 |
| T-A2 | The same bot claimed by a second tenant is refused; the staff bot cannot be registered as a customer bot                                                                     | #1156 |
| T-W1 | Missing, wrong and unset secret header; unknown callback token; disabled account: one generic response and no body read                                                      | #1156 |
| T-W2 | Replayed update, duplicate `update_id`, crash between ingest and process, Telegram retry: one effect                                                                         | #1156 |
| T-W3 | Forwarded and edited payloads, a group or channel update for a DM-only bot, a bot sender: no identity or state change                                                        | #1156 |
| T-C1 | `/start` creates `support` only; marketing needs the explicit step; `/stop` and a 403 revoke at once; revoked consent blocks queued rows at dispatch                         | #1156 |
| T-C2 | Link proof: single-use code replay, a code from another tenant, username or display name as "proof"                                                                          | #1156 |
| T-K1 | Token rotation: old token, secret and callback token stop working; no token in any log, audit, event, error or response (feed token-bearing errors through every path)       | #1156 |
| T-R1 | Per-account pacing, `429 retry_after`, cost ceiling, uncertain send, crash and retry                                                                                         | #1156 |
| T-P1 | 1 tenant with 2 bots and 3 channels, another with 1; wrong admin rights; a foreign destination id; deleted bot access; duplicate scheduled send; partial failure per channel | #1157 |
| T-I1 | IDOR on contacts, conversations and accounts across tenants and business scopes                                                                                              | #1156 |
| T-D1 | Erasure and retention: ciphertext erased on end, evidence kept for its window, legal hold, per-tenant data-subject answer                                                    | #1156 |

### 10. Logical data dictionary and threat summary (working names)

Names are illustrative; the implementing issue fixes the physical design. Every table is tenant-scoped with RLS `FORCE` and ships its `subjectData` and `data_lifecycle` descriptors in the migration that creates it.

| Entity                          | Purpose                                                     | Key fields (logical)                                                                                                                                          | Notes                                                                        |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `channel_account` (#1140)       | A bot, a channel or a group                                 | tenant, business scope, provider `telegram`, kind (`telegram_bot` / `telegram_channel` / `telegram_group`), external id, status, parent bot                   | Owned by `channel_accounts`; this ADR only adds kinds and capability rows    |
| `telegram_webhook_endpoint`     | One callback route per bot                                  | account, callback token hash, `secret_token` reference, registered at, last update at, pending count, last error                                              | Token and secret never returned; rotation creates a new row and ends the old |
| `telegram_contact`              | A platform-scoped person who started a bot                  | account, keyed hash of the user id, chat ciphertext, masked label, state (`started` / `blocked` / `ended`), started at, provenance ref                        | Hash scoped to `(tenant, account)`; ciphertext erased when the contact ends  |
| `telegram_consent_evidence`     | Append-only consent facts                                   | contact, purpose, action (`opt_in` / `opt_out`), notice version, update id, occurred at, method                                                               | No message text; kept for the proof window                                   |
| `telegram_inbound_update`       | Immutable ingest record and dedup key                       | account, `update_id` (unique together), received at, privacy class, minimal parsed payload reference                                                          | Short retention; body not kept longer than the content window                |
| `telegram_outbound_message`     | Queue row for a reply or an opted-in notice                 | account, contact reference, purpose, consent version snapshot, expires at, idempotency key, status (`queued` / `sent` / `uncertain` / `failed` / `cancelled`) | No chat id; leased and finalised per row                                     |
| `telegram_link_code`            | Single-use handshake from an authenticated first-party page | tenant, person reference, code hash, expires at, consumed at                                                                                                  | Mirrors the ADR-0140 pattern; tenant and person come from the row            |
| `contact_link_evidence` (#1144) | Link of a contact to a CRM person                           | contact, person reference, method (closed list), provenance, who and when, revoked at                                                                         | Owned by the inbound boundary; Telegram supplies the method values of §6     |

| Threat                                                          | Control (invariant)                                                                                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Forged update posted to a callback route                        | Opaque per-bot callback token and constant-time `secret_token` check before any body read (TG3)            |
| Update for bot A delivered to bot B's route                     | Bot and tenant resolved from the route; contact key scoped to the account (TG3, TG8)                       |
| Replay or Telegram retry                                        | Unique `(account, update_id)`, idempotent ingest (TG4)                                                     |
| Token leak through logs, errors or the browser                  | URL built in one client, redactor on every path, secret by reference (TG11)                                |
| Cold messaging or marketing without consent                     | `started` state required, separate explicit opt-in, re-check at dispatch (TG6, TG7)                        |
| Staff bot reused for customers, or customer data in staff queue | Identity comparison at registration, no shared code or tables (TG1)                                        |
| Cross-tenant or cross-bot person correlation                    | Account-scoped keyed hash, no merge without evidence (TG8)                                                 |
| Bot loop, forwarded or edited payload treated as identity       | `from.is_bot` dropped, forward metadata untrusted (TG3, §4)                                                |
| Channel post by a bot that lost its admin right                 | Rights verified before scheduling and at delivery (TG9)                                                    |
| Burst against Telegram limits, provider ban                     | Per-bot pacing, `retry_after`, cost ceiling, breaker (TG10)                                                |
| Compromised dispatcher reaches tokens                           | Decrypt in call for the claimed row's tenant, decrypt counter, key ring outside the database (ADR-0148 §5) |

## Options considered

| Criterion              | **B. New `telegram_engagement` module; publishing in `social_publishing` (chosen)**                             | A. Widen `telegram_delivery` to customers                                              | C. Extension ports on `telegram_delivery` (a customer adapter plugs in)             | D. One `telegram` module for staff, DM, channels and groups       | E. Downstream (`awcms-one`) only                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Security               | Staff guarantees untouched; customer path has its own purposes, tokens, webhooks and review; small blast radius | Breaks "no customer data, no free text, one bot"; one flaw reaches staff and customers | The staff queue and storage become reachable from a path that carries customer data | One module holds every Telegram credential and every inbound path | The upstream security gates and RLS tests cannot see the token-holding code |
| Privacy and UU PDP     | Purpose and consent are per purpose; contact keys are account-scoped; retention is declared per table           | Staff `staff_ops` and customer data share tables, retention and key rings              | Same sharing, behind a seam                                                         | Mixed purposes in one retention policy                            | Same code, outside the upstream data-subject and lifecycle gates            |
| Performance            | One queue per module, paced per bot; no change to the staff dispatcher                                          | Customer volume competes with staff alerts in one dispatcher                           | Same contention                                                                     | One dispatcher                                                    | Same as B                                                                   |
| Maintainability        | Clear ownership; the module can be removed alone; reuses the account and secret model                           | A module with contradictory rules (refuse customers, serve customers)                  | A seam designed around a module whose contract forbids the use                      | Large surface, slow review                                        | Back-porting in the wrong direction (ADR-0034, ADR-0055)                    |
| Scalability            | Adds accounts and adapters, not queues, per bot; a second Telegram queue is the one new concept (O1)            | Scales, but unsafely                                                                   | Same                                                                                | Scales as one unit                                                | Same as B                                                                   |
| Operational complexity | One new module, three off-by-default levels, per-bot webhook health                                             | Lowest in code, highest in policy risk                                                 | A new seam to operate and document                                                  | One large concern                                                 | Lowest upstream, highest downstream                                         |
| Long-term implications | New Telegram features are rows and adapters; invariants bind later ADRs                                         | The staff module can never again be described as safe to enable                        | The seam becomes a back door                                                        | Becomes the facade ADR-0139 refused                               | Every product re-derives it                                                 |

### Compliance reading

- **UU PDP No. 27/2022.** Consent and purpose are recorded per purpose and withdrawal is immediate (TG7); the Telegram user id, username and phone are personal data held minimally, encrypted and masked (TG5, TG11); a follower of a channel is not profiled (§6); the data-protection impact assessment for large-scale or systematic processing (Art. 34) must be answered by the **controller** per deployment before CRM-grade Telegram processing is enabled (a checklist item, not decided here); security safeguards (Art. 35) are the secret and webhook rules; **cross-border transfer** (Art. 56) arises because Telegram processes data abroad and is the controller's disclosure to make; breach notification (Art. 46) needs the audit and decrypt telemetry. Telegram's own role (processor or independent controller) is a legal reading this ADR does not make (O6).
- **PP 71/2019 and ISO/IEC 27001:2022, 27002:2022, 27005, 27701, 27034.** As in ADR-0148's compliance reading: access control and authentication information (webhook secret, step-up), supplier relationships (Telegram is a supplier whose terms are inputs), cryptography, logging, information deletion and PII protection. The risk register row to add to the pack: a compromised dispatcher now reaches customer-bot tokens as well as staff-channel ones; mitigated by decrypt-in-call, a decrypt counter, a key ring outside the database and revocation effective on the next claim (ADR-0148 §5).

## Consequences

- **Positive:** the staff module's guarantees are preserved and made testable (T-N1); customer Telegram has its own purposes, consent evidence and privacy classes before code exists; #1156 and #1157 receive binding invariants and a test matrix; many bots per tenant fit the one account model; a bot cannot be mistaken for a channel or a chat.
- **Negative / trade-off:** a new module and, on recommendation, a second Telegram queue (O1); more webhook surface to secure (one route per bot); account-scoped contact keys mean the same person under two bots is two contacts until a link is recorded; several provider facts stay **to verify** until the implementation issues check the live documentation.
- **Neutral:** nothing changes for any deployment until a bot account is registered; every flag is off by default.
- **Human sign-off still needed (not performed here):** the maintainer on the open questions below; the controller or DPO for the DPIA, the opt-in notice copy and the retention windows; and the mandatory security review of #1156 before merge.

## Alternatives rejected

- **Widening `telegram_delivery` (A) or hanging a customer seam on it (C).** The refusal list in its README is the module's guarantee, and a seam is a weaker form of the same relaxation.
- **One module for every Telegram surface (D).** The facade ADR-0139 refused, with every credential in one place.
- **Downstream only (E).** Removes the upstream security gates from the code that holds the tokens.
- **Treating `/start`, a channel follow or a group join as marketing consent.** It conflates starting a conversation with agreeing to promotion.
- **A chat id hash shared across bots and tenants.** It would let two bots correlate one person by default.
- **Automatic fallback to email or WhatsApp when a DM is refused, or messaging by handle, phone or scraped list.** Policy and contract violations before they are engineering choices (ADR-0139, ADR-0148 I5, I6).

## Open questions for the maintainer

- **O1.** Approve a **second Telegram queue** (customer, owned by `telegram_engagement`) as a narrow amendment of ADR-0133 §3, or require the customer traffic to share `telegram_delivery`'s queue with a purpose key? Recommended: separate queue; sharing is the relaxation §1 forbids.
- **O2.** Are **Telegram Business connections** wanted at all? Recommended: not admitted until the feature's availability and the account owner's consent model are verified and an amendment is written.
- **O3.** Retention windows: message content, consent evidence, inbound dedup keys, ended contacts. Recommended starting point: content short (days to weeks, tenant-configurable within bounds), evidence for the proof horizon you choose, dedup keys a few days.
- **O4.** Is the **shared-contact** method of §6 (human-confirmed, exact normalised match) admitted as link evidence, or only the authenticated single-use code? Recommended: the code only in v1.
- **O5.** Account-scoped contact keys (recommended) versus a tenant-wide key that lets the tenant recognise the same Telegram user across its bots. The second is more convenient and more privacy-invasive; it needs a stated purpose and a DPIA line.
- **O6.** The deployment's **controller or processor role** for Telegram customer data (ADR-0148's O5) and whether Telegram is treated as a processor or an independent controller in the disclosure copy.
- **O7.** Does #1140 model a channel or group as a **child `channel_account`** (recommended here) or as a separate destination table? This ADR's invariants hold either way; the choice is #1140's.
- **O8.** A **grace window** for the previous `secret_token` and callback token during rotation (Telegram holds one webhook, so any overlap is on our side), or a hard cut. Recommended: a hard cut with a short documented gap.
- **O9.** Whether the customer inbound adapter lives in `telegram_engagement` (recommended) or in a generic `interactions` module if #1144 admits one.
- **O10.** The default per-bot daily cost ceiling and the deployment cap.

## Follow-up links

- #1156 implements E1 and E2 and carries T-N1 to T-D1; #1157 implements publishing in `social_publishing` and carries T-P1; #1144 decides the inbound boundary this ADR plugs into; #1140 supplies the account and secret model; awcms-one #460 is the downstream CRM adapter and waits for the upstream issues **and** a subtree sync as a merge commit (ADR-0148 §10). Each is built, reviewed and gated as an ordinary change after this ADR is Accepted.
