🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# `telegram_engagement`

**Customer** Telegram conversations through a tenant's own bots (Issue #1156, [ADR-0152](../../../docs/adr/0152-customer-telegram-engagement-is-a-separate-admitted-context-telegram-delivery-stays-staff-only.md); inbound envelope [ADR-0150](../../../docs/adr/0150-inbound-omnichannel-events-enter-as-verified-redacted-envelopes-with-no-generic-interactions-store.md); accounts and secrets [ADR-0148](../../../docs/adr/0148-omnichannel-foundation-is-five-gated-capabilities-with-fail-closed-per-account-capability.md), `channel_accounts` #1140).

It is a context **separate** from [`telegram_delivery`](../telegram-delivery/README.md), which stays staff-only and unchanged (ADR-0140): this module imports nothing from it, shares no table, queue, route, token or setting with it, and refuses to register the staff bot. `tests/telegram-engagement-boundary.test.ts` holds that (T-N1).

Status: `experimental`, **off by default** at three levels: the deployment (`TELEGRAM_ENGAGEMENT_ENABLED`; every route answers `404` and the job claims nothing), the module registry, and the tenant (nothing happens until the tenant registers a bot; the tenant's module toggle also switches the webhook off). No admin screen and therefore no `navigation` entry yet; the API is complete and every admin route is default-deny.

## What it does (E1 and E2 of ADR-0152)

- **Many bots per tenant.** A bot is a `channel_accounts` account (provider `telegram`, kind `bot`, `external_id` = the bot's numeric id) bound to one tenant and one business scope; its token is that account's write-only `channel_secret`. `POST /bots` registers one for a verified webhook. Registration AND every rotation refuse the staff bot (`TELEGRAM_BOT_TOKEN`'s numeric prefix), an account that is revoked, disabled or not a bot-token account, and one with no stored token; the connector's `getMe` then binds the TOKEN to the account's id, so the staff bot cannot slip in through a swapped token either.
- **One verified webhook per bot.** `POST /webhooks/{callbackToken}`. The token `tge1.<tenantId>.<endpointId>.<secret>` names where to look; the route opens THAT tenant, proves the secret against a stored SHA-256, requires an `active` endpoint, a live bot account and the tenant's module toggle, then compares `X-Telegram-Bot-Api-Secret-Token` in constant time. Only then is the body read. Every failure is one generic `401`, counted and audited once a minute in aggregate on the platform tenant.
- **Idempotent ingestion.** Unique `(tenant, account, update_id)`; contact, consent, events and the receipt commit in one short transaction, so a replay, a Telegram retry, a concurrent duplicate or a crash between ingest and commit has one effect.
- **Binding rules.** Private chats only; `from.is_bot` dropped (no bot-to-bot loops); chat id must equal the sender id; a forwarded `/start` is content, not a command; edited messages ignored. The account must hold the `inbound` capability with evidence (ADR-0148 I2), otherwise the update is receipted and nothing else happens.
- **Contacts** exist only after `/start`: an account-scoped keyed hash of the Telegram user id (the same person under two bots or two tenants is two unrelated rows, TG8), the chat id as an AES-256-GCM envelope, a masked label derived from the hash. The first `/start` deep-link parameter is stored as provenance, never as consent.
- **Consent** is append-only evidence per purpose: `/start` grants `support` only; `transactional` and `marketing` need the explicit prompt (`POST /contacts/{id}/consent-prompts`, notice text and version, two buttons), and only a press on THAT message for THAT purpose and version counts. `/stop`, a block (`my_chat_member` kicked) and a provider `403` withdraw every purpose at once and cancel queued rows.
- **Outbound** (`POST /contacts/{id}/messages`) is the module's own durable queue (ADR-0152 O1): addressed to a contact, never a chat id; eligibility and the `dm` capability checked at enqueue and again at dispatch.
- **Events** (AsyncAPI): `awcms.telegram_engagement.interaction.received` (the ADR-0150 envelope: ids, kinds, `provenance: secret_header`, `privacyClass`) and `awcms.telegram_engagement.consent.changed`. Never a Telegram id, username, message text, token or header. The inbox (#1164) and awcms-one #460 consume them.

## The job: `bun run telegram-engagement:dispatch` (every minute)

1. **Connector**: for a `pending` endpoint, `getMe` (the bot id must equal the account's external id, which registration and rotation already checked is not the staff bot), then `setWebhook` with the per-bot URL, the derived secret token and `allowed_updates = [message, my_chat_member, callback_query]`; only then `active`, and the account's health is reported `ok` (which moves it to `connected`). A revoked endpoint gets `deleteWebhook`. A Telegram `401` is terminal and reported as failing health.
2. **Queue**: claim with a lease in a short transaction; re-check contact state, the LATEST consent, the endpoint, the `dm` capability, the breaker and the per-bot daily ceiling (never above `TELEGRAM_ENGAGEMENT_DAILY_CAP`); send outside any transaction through `ssrfSafeFetch` to `api.telegram.org` with per-bot and per-chat pacing; `429` re-queues after `retry_after` without spending budget; `403` blocks the contact; a network error or timeout after the request left is `uncertain` and never retried, as is a row whose lease expired mid-send; five provider failures in a row open the bot's breaker. Text is cleared at every terminal state.

### The dispatcher's own database role (`sql/353`, audit H-2 of PR #1260)

The job connects through `TELEGRAM_ENGAGEMENT_DATABASE_URL` as **`awcms_telegram_engagement_dispatch`**, with **no fallback** (without it the job refuses to run; `config:validate` refuses a deployment that enables the module without it). Neither existing role fits: `awcms_app` sees every channel secret of every tenant, so a compromised job holding `CHANNEL_SECRETS_ENCRYPTION_KEYS` could decrypt WhatsApp, Mailketing and social credentials; `awcms_worker` must never see a bot token (`sql/328`, otherwise `whatsapp:dispatch` could read them). The ADR-0157 section 6 pattern is followed instead:

- NOLOGIN in the migration; a deployment activates LOGIN with a secret, as for `awcms_worker`.
- No table-level privilege anywhere; only pinned column grants on the five module tables, the channel-account columns the capability check and `recordAccountHealth` read and write, the outbox (`awcms_domain_events`, deliveries) for `consent.changed`, and `awcms_tenants (id, status)`.
- A RESTRICTIVE policy on `awcms_channel_secrets` limits its view to a `bot_token` that is the own credential of a live `telegram`/`bot` account with a live endpoint (or a revoked one still owing `deleteWebhook`), and a `webhook_signing_secret` that is a live endpoint's seed. A disabled or revoked bot's credentials leave its view in the same statement.
- Its WRITES are bounded per row by six more RESTRICTIVE policies (re-audit M-B): accounts only `telegram`/`bot`, live, moved to `connected` or `degraded`; health rows of live bots only; consent only `opt_out` by `provider_forbidden`; contacts only `started` -> `blocked`; the outbox only `awcms.telegram_engagement.consent.changed` from this module. A revoked endpoint can never be re-armed (`provider_action` only `delete` -> NULL; a guard in `sql/352`). So the role cannot widen its own secret view (re-enable a disabled bot), touch another module's account, forge consent or forge an unrelated event.
- `security:readiness` (`checkTelegramEngagementDispatchRole`) pins EVERY policy naming the role EXACTLY (the normalised `pg_get_expr` deparse of USING and WITH CHECK, restrictive, that role only, the command) and then probes it AS the role in a rolled-back transaction: a live bot's token and seed are visible; a disabled bot, a fully revoked bot, a WhatsApp credential, a social token and another tenant's token are not; and each forbidden write is refused. It also fails on a table-level grant or a column grant that drifts. `awcms_worker` and `sql/328` are untouched.
- The runner gives the job NO shared login (re-audit H-A): `dedicatedRoleTargets` in `scripts/jobs-env-allowlist.ts` derives, from the import closure, the jobs that reach a dedicated-role client, and `ops/run-job.sh` withholds `DATABASE_URL`, `WORKER_DATABASE_URL` and `SETUP_DATABASE_URL` from them unconditionally. The job itself refuses to start if any of those is in its environment, and checks `current_user` is exactly the dispatch role and neither SUPERUSER nor BYPASSRLS before any work. `config:validate` refuses a `TELEGRAM_ENGAGEMENT_DATABASE_URL` whose user equals the app or worker user.
- **`sql/374` (the #1271 audit, M1).** The delivery INSERT that `sql/353` granted was bounded only by the delivery row's own `event_type`, so the role could read another module's event id and sequence and deliver THAT event to any consumer (verified in a rolled-back transaction: a `workflow_approval` event queued for an `hr_workforce` consumer). No consumer subscribes to `consent.changed`, so the delivery grants and their policy are revoked, and a RESTRICTIVE SELECT policy shows the role only its own event. The start-up check now also requires `session_user` to be the role (a member login that `SET ROLE`s to it is refused, L2), and `config:validate` also refuses a login shared with `SETUP_DATABASE_URL`.
- Residual (stated, not removed): a compromised dispatcher that sets the tenant setting can read and decrypt the customer bot tokens of every tenant, and only those.

## API (`/api/v1/telegram-engagement`, OpenAPI `openapi/modules/telegram-engagement.openapi.yaml`)

| Route                                | Permission        | Notes                                                                  |
| ------------------------------------ | ----------------- | ---------------------------------------------------------------------- |
| `POST webhooks/{callbackToken}`      | none (Telegram)   | Token + constant-time header before the body; one generic `401`        |
| `GET bots`                           | `bots.read`       | Bots the caller may see; never a token, secret or URL                  |
| `POST bots`                          | `bots.configure`  | Register; `Idempotency-Key`, conditional step-up, audited `warning`    |
| `POST bots/{id}/rotate`              | `bots.configure`  | New seed; old URL and header die at once (hard cut, O8)                |
| `POST bots/{id}/revoke`              | `bots.configure`  | Ends the webhook, cancels queued messages, job calls `deleteWebhook`   |
| `GET contacts?accountId=`            | `contacts.read`   | One bot's contacts, masked, keyset                                     |
| `GET contacts/{id}`                  | `contacts.read`   | Per-purpose eligibility, 20 latest message statuses                    |
| `POST contacts/{id}/erase`           | `contacts.delete` | Ends the contact: ciphertext, label and hash erased; evidence kept     |
| `POST contacts/{id}/messages`        | `messages.create` | Queue a reply or an opted-in notice; no chat id, handle or phone field |
| `POST contacts/{id}/consent-prompts` | `messages.create` | Queue the explicit opt-in step                                         |

`{id}` of `bots/*` is the bot's **channel account id**. Per-account access is `channel_accounts`'s (assignments, administrator bypass, business-scope ABAC through the same chokepoint); unknown, foreign and invisible are the same `404` (T-I1).

## Data (`sql/350`, permissions `sql/351`, guards `sql/352`)

All five tables are tenant-scoped with RLS `ENABLE` + `FORCE` (`USING` and `WITH CHECK`) and composite `(tenant_id, id)` foreign keys.

| Table                                 | Retention (`module.ts`)                                                   |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `awcms_telegram_engagement_endpoints` | Retained (one live row per bot; rotations add a revoked row)              |
| `awcms_telegram_engagement_contacts`  | Retained; ended (erased in place) through the erase route                 |
| `awcms_telegram_engagement_consents`  | Retained for the proof horizon; append-only (UPDATE revoked from the app) |
| `awcms_telegram_engagement_inbound`   | Generic purge, default 7 days (1 to 90); append-only                      |
| `awcms_telegram_engagement_messages`  | Generic purge, default 30 days (7 to 365); text cleared at terminal state |

Consent evidence is ordered by `evidence_seq` (an identity drawn while the writer holds the contact's row lock), never by `recorded_at`: `now()` is the START of a transaction, so a `/stop` whose transaction began before a concurrent opt-in committed would otherwise sort first and lose (audit M-1 of PR #1260).

Guards: an endpoint's identity is immutable and a revoked endpoint is terminal (a secret is never swapped; rotation is a new row) and its account must be a live telegram bot; a contact's key changes only in the statement that ends it, and an ended contact is terminal; a message's snapshot is immutable, a terminal status is final and its text can only be removed. CHECKs: `/start` is support-only, a non-support opt-in needs the button and a notice version, an ended contact holds no ciphertext or label, a terminal message holds no text.

## Configuration

`TELEGRAM_ENGAGEMENT_ENABLED`, `TELEGRAM_ENGAGEMENT_KEYS` (the module's own ring: chat ids, queued text, contact hash; must differ from every other ring), `TELEGRAM_ENGAGEMENT_DATABASE_URL` (the dispatcher's own role, job-scoped, no fallback), `TELEGRAM_ENGAGEMENT_DAILY_CAP`, `TELEGRAM_ENGAGEMENT_WEBHOOK_RATE_PER_MINUTE` (FAILED verifications per address: a verified request is never counted, so one tenant's busy bot cannot throttle another's), `TELEGRAM_ENGAGEMENT_ENDPOINT_RATE_PER_MINUTE`; it also needs `CHANNEL_ACCOUNTS_ENABLED`, `CHANNEL_SECRETS_ENCRYPTION_KEYS` and `APP_URL` as an `https` origin (the webhook URL).

## Webhook throttles and what they never drop

- Per caller address: FAILED verifications only (charged up front, refunded when the request verifies), so Telegram's few shared addresses are never throttled by one tenant's legitimate traffic (audit M-3).
- Per bot endpoint: every verified request; an over-limit bot gets `429` and Telegram retries.
- Per chat: chatter only. An update that can change consent (`/start`, `/stop`, a block or unblock, an opt-in or withdrawal button) is never dropped by it (audit M-2).
- Every rejection (failed verification, a rate limit, an oversized or malformed body) is counted and flushed as one aggregated platform audit row a minute (audit L-4).
- The middleware's session-free body boundary exempts exactly this route (`SESSION_FREE_BODY_ENDPOINTS`); `api:spec:check` now fails if a public body operation is not exempt or an exemption has no public operation (audit H-1).

## Residual risks

- **Check-then-send (TOCTOU).** The dispatcher re-checks consent, contact state, endpoint, capability, breaker and ceiling in one transaction and sends in the next step, outside any transaction (ADR-0006: no provider I/O while holding locks). A `/stop` that commits in that window does not stop a message already handed to Telegram; it cancels everything still queued. The window is one provider round trip (bounded by the 10 s timeout).
- **Dispatcher role reach**: see above.
- **Rate-limit availability (two known gaps).** (1) The per-address failure bucket is charged before verification and refunded after it, so a burst of genuine requests arriving at once while that address is near its failure budget can briefly see `429` (Telegram retries). (2) Without Redis the limiters are per process: several instances each allow the full budget, and a restart resets it. Neither weakens verification; both are availability trade-offs, and the per-endpoint bucket still isolates one bot's flood from another's.

## Out of scope (other issues)

Channel publishing (#1157, in `social_publishing`), the cross-channel inbox (#1164, consumes the events), group activity and Telegram Business connections (not admitted, ADR-0152 section 7), broadcast, an admin screen.

## Open decisions (recorded, not guessed)

- **Q4 of ADR-0150, message bodies.** Answered fail-closed: no body is stored or published. A consumer sees that a message arrived (kinds, time, contact), not what it said, until a `content_ref` design is admitted.
- **T-C2 link proof (ADR-0152 section 6, method (a)).** The single-use first-party code that links a contact to a CRM person needs `contact_link_evidence`, which #1144 owns and has not built. Not implemented here; no username, display name or forward is ever treated as evidence.
- **Dispatcher DB role.** Decided by the orchestrator after the audit: its own role (see above). Scheduling it is still a deployment step: the role ships NOLOGIN.
- **The one database read before the header check.** ADR-0152 asks for the header check "before any body read or database work", while also storing the secret by reference (section 3). The two cannot both hold; the route reads one row by primary key (the endpoint named by the token) and decrypts its seed before the header comparison, and reads no body before it. A per-address throttle bounds the cost of forged tokens.
- **Tenant-level default.** Module Management treats an absent tenant row as enabled. "Off by default for the tenant" is therefore "nothing happens until the tenant registers a bot"; the tenant toggle still switches it off.
- **Retention windows and the daily ceiling** (ADR-0152 O3, O10) are proposed defaults for the maintainer and the controller to confirm.
- **Facts marked "to verify" in ADR-0152** (secret-token charset, pacing figures, `allowed_updates` names) follow the public Bot API documentation as written in the ADR and were not re-verified against a live bot.
