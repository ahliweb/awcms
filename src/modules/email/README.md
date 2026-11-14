🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](README.id.md)

# Email

Reusable, provider-neutral email service ported from awcms-mini (epic #492).
Generic infrastructure — analogous to `sync_storage`'s object-storage port —
for password reset, system announcements, and workflow notifications; **not**
a domain-specific "send a receipt" feature. Mailketing is _one_ adapter, not
a reason the module becomes domain-specific.

Schema, RLS, delivery queue, and ABAC permissions live in
`sql/014_awcms_email_schema.sql`. The module depends on `tenant_admin`,
`profile_identity`, and `identity_access`.

## Provider contract — `domain/email-provider-contract.ts`

The `EmailProvider` port (`send`, `healthCheck`) plus the DTOs
`EmailMessage`/`EmailAddress`/`EmailAttachmentRef` (attachment references,
never raw bytes) and `EmailDeliveryResult` (`retryable` distinguishes a
transient failure worth retrying from a permanent one). Directly analogous to
`sync-storage`'s `ObjectUploader` — one interface, concrete adapters resolved
at a single edge (`infrastructure/email-provider-resolver.ts`), never
imported by name anywhere else.

Provider calls **never** happen inside a DB transaction (ADR-0006, doc 16
§Transactional outbox). Callers write an `awcms_email_messages` row inside
their own business transaction; a separate dispatcher
(`application/email-dispatch.ts`, `bun run email:dispatch`) claims rows in a
short transaction (`FOR UPDATE SKIP LOCKED`, reusing `next_attempt_at` as the
claim lease), calls `EmailProvider.send` **outside** any transaction, then
finalizes to `sent`/`retry_wait`/`failed`/`suppressed` and records an
`awcms_email_delivery_attempts` row.

The claim lease is **read back**, not just written (Issue #143): a row left
`sending` by a worker that died mid-pass is re-claimed once its lease
(`EMAIL_DISPATCH_LEASE_MINUTES`) expires — same rule as
`sync-storage/application/object-dispatch.ts`. Without that, such a row is
permanent limbo: every finalize is guarded by `status = 'sending'` and
`cancelEmailMessage` refuses `sending`. The accepted trade-off is one possible
duplicate send when the crash lands between "provider accepted" and FINALIZE;
the attempts ledger is idempotent per `(message_id, attempt_no)`, so a
re-claim can never abort the pass. Templates are looked up once per distinct
`template_key` per pass, not once per message.

### Adapters

- `infrastructure/mailketing-provider.ts` — the real adapter.
  `POST {baseUrl}/api/v1/send`, form-urlencoded
  `api_token`/`recipient`/`from_email`/`from_name`/`subject`/`content`,
  JSON response `{status, response, message_id?}`. Auth is token-only
  (`EMAIL_MAILKETING_ACCOUNT_ID` is an operator label, never sent to the
  provider). One send = one recipient — hence one `awcms_email_messages` row
  per recipient. HTTP/network/timeout/5xx failures are `retryable: true`; a
  `status:"failed"` business rejection is `retryable: false`. Timeout +
  per-provider circuit breaker (`getProviderCircuitBreaker("email-mailketing")`).
- `infrastructure/mailketing-v2-provider.ts` — **optional** Mailketing REST
  API **v2** adapter (Issue #1159, ADR-0151 §1), selected only by
  `EMAIL_MAILKETING_API_VERSION=v2`. `POST /api/v2/send` as JSON; the token is
  sent in `Authorization: Bearer` **only** (never URL, query, body, log or
  result). Egress goes through `ssrfSafeFetch` to the **fixed** host
  `https://api.mailketing.co.id` (`EMAIL_MAILKETING_API_BASE_URL` must be unset
  or exactly that origin), with `maxRedirects: 0`, a total timeout and a
  response-size cap. Classification (pure, `domain/mailketing-v2-contract.ts`):
  200 `success:true` = **accepted/queued by the provider, not delivered** (stored
  as `sent`, `message_id` kept as `provider_message_id`, never an idempotency
  key); 200 `success:false` = refusal (terminal); 401 / 403 / 404 / 422
  terminal; **402** = held in `queued` for 15 minutes without spending a retry
  or writing an attempt, and **bounded**: once the message is older than 1 hour
  it fails with `CREDIT_HOLD_BUDGET_EXCEEDED` instead of arriving late;
  **429** = retry no sooner than `Retry-After` (clamped 1 s to 1 h); 5xx /
  timeout / network / egress-policy denial = retryable. A **200 with no boolean
  `success`** (or non-JSON) is **uncertain**: the provider may have accepted it,
  so it is terminal, never retried (no duplicate copies), and counted
  `uncertain`. Results carry
  fixed text plus a status code, never provider body text or a recipient.
  Breaker key is shared with v1 (`email-mailketing`) and counts service-level
  faults, malformed 200s, egress denials and 401/402/403 **and also refusals**
  (`success:false`, 404/422/other 4xx): 5 consecutive open it and any success
  resets it, so one bad recipient never trips it but a wrong field name cannot
  silently mark the whole queue `failed`. Health probe
  is `GET /api/v2/credits` (read-only, never sends mail). **The v2 send-body
  field names and all provider statuses come from the documented contract
  (v2.0.2); they have not been verified against the live API.**
- `infrastructure/log-email-provider.ts` — `EMAIL_PROVIDER=log`. Writes a
  structured log line (recipient masked, reusing
  `profile-identity/domain/identifier.ts`) instead of calling a real
  provider; used for local dev without credentials and for tests. This is
  **different** from `EMAIL_ENABLED=false` (the dispatcher never claims rows
  at all in that case).

## Template management

`template_key` doubles as the category for allowlist purposes
(`domain/email-template-categories.ts`). Six fixed base categories
(`auth.password_reset`, `system.announcement`, `system.security_notice`,
`system.maintenance`, `workflow.task_assigned`, `workflow.decision_required`)
plus `derived.transactional` each carry an allowed-variable list, and (#1044) the
three `hr.attendance_correction_{applied,rejected,cancelled}` categories
(`userName`, `employeeName`, `correctionDate`; never a reason) that
`hr_workforce` sends through the `workflow_notification` capability this module
now provides (`application/workflow-notification-port-adapter.ts`, subject
rendered in the tenant's default locale). A derived
app registers its own `derived.<name>` category via
`registerDerivedEmailTemplateCategory` before use; an unknown category is
rejected at create (fail-closed).

- Body columns are `jsonb` per-locale (`{"en": "...", "id": "..."}`, doc 04
  §Multi-language content). Rendering (`domain/email-template-render.ts`)
  resolves the locale, filters caller variables through the category
  allowlist (unlisted variables are silently dropped, never substituted),
  then substitutes `{{key}}` tokens — HTML-escaped for `htmlBody` only.
- Validation (`domain/email-template-validation.ts`) enforces the
  `templateKey` format + known category, an `en` entry on each localized
  text, 2-letter locale codes, and rejects `htmlBodyTemplate` containing
  `<script>`/`<iframe>`/inline event handlers/`javascript:` (defense in depth
  on top of render-time escaping).
- CRUD + soft-delete/restore + preview:
  `POST/GET/PATCH/DELETE /api/v1/email/templates[/{id}]`,
  `POST /api/v1/email/templates/{id}/restore` (dedicated action),
  `POST /api/v1/email/templates/{id}/preview` (renders with synthetic sample
  data — never a real recipient address, never touches the queue).
- Default template copy (EN+ID) for the base categories lives in
  `domain/email-default-templates.ts`; `seedDefaultEmailTemplates` inserts
  them for one tenant (idempotent — never overwrites a tenant customization),
  run via `bun run email:templates:seed-defaults -- --tenant=<id> --actor=<tenantUserId>`.

## Announcement / notification workflows

`POST /api/v1/email/announcements` (bulk-capable enqueue) and
`.../preview` (dry-run) —
`application/announcement-directory.ts` + `domain/announcement-validation.ts`.

- **Targeting** — `{type:"users", userIds}` (explicit, bound via
  `tx.array(ids,"uuid")`), `{type:"role", roleId}`, or `{type:"tenant"}`.
  Each target resolves only **active** identities and always excludes anyone
  on `awcms_email_suppression_list`.
- **Two-tier ABAC** — `email.notification.create` is required for every
  request; `target.type = "role"|"tenant"` (unbounded) **additionally**
  requires `email.announcement.create`.
- **Idempotency required** — `Idempotency-Key` is always demanded (reuses
  `_shared/idempotency.ts`).
- **Preview is safe** — returns only `matchedCount` + a rendered synthetic
  sample; never a recipient list/address, never touches the queue.
- One `awcms_email_messages` row per recipient sharing a `correlation_id`;
  the subject is rendered per-recipient at enqueue. Audit is one row per
  request (`announcement_sent`) with counts only, never a recipient list.
- **Bounded + batched** (Issue #153) — `role`/`tenant` targets resolve at most
  `ANNOUNCEMENT_MAX_RECIPIENTS` (5000) rows, ordered deterministically, and are
  enqueued with multi-row `unnest` INSERTs of 500 rows each rather than one
  INSERT per recipient. Hitting the cap returns `truncated: true` from
  `enqueueAnnouncement` and logs `email.announcement.recipients_truncated` at
  `warning` — reaching an audience larger than the cap needs an async enqueue
  job, which does not exist yet.

## Observability & ops

- **Queue diagnostics** — `GET /api/v1/email/messages?status=...`
  (`email.message.read`), keyset-paginated, `to_address_masked` only.
- **Cancel** — `POST /api/v1/email/messages/{id}/cancel`
  (`email.message.cancel`); only `queued`/`retry_wait` are cancellable
  (mitigation for accidental bulk send).
- **Suppression list** — `GET/POST /api/v1/email/suppressions`,
  `DELETE /api/v1/email/suppressions/{id}`
  (`email.suppression.{read,create,delete}`). The dispatcher re-checks
  suppression right before sending, so a recipient suppressed after enqueue
  is still excluded (moved straight to `suppressed`, no delivery attempt).
- **Provider outage** — the circuit breaker opens after 5 consecutive
  failures; the dispatcher stops claiming (`email.dispatch.breaker_open`) and
  drains automatically once it closes. Because the provider call is strictly
  outside any DB transaction, an email outage never blocks unrelated writes.
- **Structured logs** — every lifecycle stage is a JSON log line carrying
  `correlationId`/`tenantId`/`moduleKey`, never a raw recipient:
  `email.message.queued`, `email.dispatch.claimed`, `email.dispatch.sent`,
  `email.dispatch.retry_scheduled`, `email.dispatch.failed`,
  `email.dispatch.suppressed`, `email.dispatch.breaker_open`,
  `email.message.cancelled`. The queued/sent/failed/suppressed/cancelled
  lines are also documented AsyncAPI channels
  (`asyncapi/awcms-domain-events.asyncapi.yaml`) — contract-only, the
  structured logger is the producer (same convention as
  `awcms.database.pool.saturated`; no live pub/sub bus in this repo).

## Configuration

| Var                             | Required        | Default | Function                      |
| ------------------------------- | --------------- | ------- | ----------------------------- |
| `EMAIL_ENABLED`                 | –               | `false` | Enable the email module       |
| `EMAIL_PROVIDER`                | when enabled    | –       | `"mailketing"` or `"log"`     |
| `EMAIL_FROM_ADDRESS`            | when enabled    | –       | Default sender address        |
| `EMAIL_FROM_NAME`               | –               | `AWCMS` | Default sender name           |
| `EMAIL_SEND_TIMEOUT_MS`         | –               | `10000` | Per-attempt send timeout      |
| `EMAIL_SEND_MAX_RETRIES`        | –               | `5`     | Retry ceiling before `failed` |
| `EMAIL_MAILKETING_ACCOUNT_ID`   | when mailketing | –       | Operator label (never sent)   |
| `EMAIL_MAILKETING_API_TOKEN`    | when mailketing | –       | Mailketing API token (secret) |
| `EMAIL_MAILKETING_API_BASE_URL` | when mailketing | –       | Mailketing API base URL       |
| `EMAIL_MAILKETING_API_VERSION`  | –               | `v1`    | `v1` (default) or `v2`        |
| `EMAIL_MAILKETING_V2_VERIFIED`  | –               | unset   | Stage-2 acknowledgement flag  |

**Production v2 is NOT approved** until the live stage-2 check (send-body field
names, auth scheme, `/credits` shape) is done. Until `EMAIL_MAILKETING_V2_VERIFIED=true`
is set, `config:validate`, `email:provider:health`, `email:dispatch` and every
dispatch pass print/log "Mailketing v2 contract UNVERIFIED". The flag only
silences that warning; it changes no behaviour.

**A configuration error never fails a message.** A missing token, an unknown
version, a bad base URL or a token that cannot be a header value makes the
resolver return a provider whose sends are _deferred_ (`skipped`): the claim is
undone, the row stays `queued` (held 5 minutes), no attempt row is written and no
retry is spent. `email:dispatch` logs `email.dispatch.misconfigured`, prints
`misconfigured=N` plus a `CONFIGURATION ERROR` line and exits non-zero; once the
configuration is fixed the queue drains. This also covers the pre-existing
missing-token case for v1.

`EMAIL_MAILKETING_API_VERSION` is fail-closed: unset/blank is `v1`; anything
other than exactly `v1` or `v2` is a configuration error (the resolver returns a
provider that refuses every send, `config:validate` reports it) — it is never
silently read as `v1`. With `v2`, `EMAIL_MAILKETING_API_BASE_URL` must be unset
or exactly `https://api.mailketing.co.id`; v1 keeps its configurable base URL.

### Mailketing v2 rollout and rollback (ops)

v1 stays the default until the owner flips it (ADR-0151 stages 0–3); this change
only delivers stage 1 (adapter exists, off by default).

1. Set `EMAIL_MAILKETING_API_VERSION=v2` in a non-production environment with a
   throwaway sender, run `bun run config:validate`, `bun run email:provider:health`
   (read-only `GET /credits`), then send a real test message and **verify the
   request field names and statuses against the live API** — not yet done.
2. Install the updated `ops/awcms-jobs.env-global` beside `ops/run-job.sh`.
3. **Rollback:** unset the variable (or set `v1`) and restart the web/jobs
   processes. Nothing in the outbox is version-specific, so queued rows continue.
4. `email:dispatch` prints `uncertain=N`: messages re-sent after a lease expired
   may have been accepted by the provider before the worker died (a possible
   duplicate, the documented ADR-0151 trade-off; no provider-side dedupe
   exists), plus 200s with no boolean `success`. The note is written to
   `last_error` for every outcome of such a row (sent, retried, failed,
   deferred); only rows actually sent to the provider are counted. OTP / password
   reset mail is delivered by the same queue and is unchanged.
5. A 401/402/403 streak opens the breaker (5 consecutive) and the dispatcher
   stops claiming until it closes; fix the token, credit or sender, then check
   `bun run email:provider:health`.

All `.env.example` values are placeholders, never real credentials. When
`EMAIL_ENABLED=false` (the default) nothing blocks the app: messages sit in
the outbox and drain once the module is enabled online — offline/LAN
deployments run fully without email.

## Tenant Mailketing accounts and verified senders (Issue #1160, ADR-0151 §2)

Each tenant (or brand, as a business scope) can connect **N Mailketing
accounts** and send from **N verified from-addresses** per account, on the
**same single queue** (`awcms_email_messages`, `email:dispatch`). There is no
second queue, no per-account or per-campaign mailer, and no token in settings
JSON or in the browser.

- **Model (registry #1140).** A Mailketing account is a `channel_accounts`
  account `mailketing`/`esp_account` (a container) whose API token is a
  `channel_secrets` row (envelope-encrypted, referenced by id, never returned).
  Each from-address is a child `mailketing`/`sender_identity` whose
  `external_id` is the address; it holds no credential and borrows its parent's
  token only while the parent is `connected`. Capabilities (`dm` for
  transactional mail) are granted with evidence through the existing
  `channel_accounts` routes.
- **Verified means the provider said so.** `bun run email:senders:verify`
  (as `awcms_app`) calls the read-only `GET /api/v2/credits` and
  `GET /api/v2/senders` per account and records health: a sender listed as
  verified becomes `connected`; not listed is `degraded`/`SENDER_UNVERIFIED`;
  an unrecognised response, or contradictory entries for one address, is
  `unknown`; a 401 takes the account out of service; a probe that learnt
  nothing writes nothing (the fact goes stale); results are discarded when the
  account's token was replaced while the probe ran. **The job is scheduled hourly on
  the generated crontab** (`0 * * * *`, ADR-0162), as a named `awcms_app`
  exception (it writes channel-account health, which only `awcms_app` may; the
  exception is listed in `APP_ROLE_SCHEDULED_EXCEPTIONS` and tested in both
  directions). It stays a no-op unless `EMAIL_SENDER_ROUTING_ENABLED` is
  `true`. It must keep running more often than
  `EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES` (360): without a run every tenant
  sender goes stale after 360 minutes, its mail is held and then FAILS
  (`SENDER_HOLD_BUDGET_EXCEEDED`) one hour after enqueue; nothing falls back to
  the deployment sender.
  This repo **does not create or verify domains at Mailketing**: the
  documented API offers no such call. SPF/DKIM/DMARC are set up by people at
  the tenant's DNS and in the provider; only the provider's verdict is read.
- **Enqueue.** `POST /api/v1/email/announcements` accepts optional
  `senderAccountId` / `businessScope`. The sender is explicit, else the scope's
  (or the tenant-wide) prospective default (`PUT /api/v1/email/sender-policy`,
  `email.sender_policy.configure`, high-risk, idempotent, audited), else the
  deployment sender. Whenever the result is a TENANT sender (named, or chosen
  by a policy, tenant-wide included) or a business scope is named, the caller
  needs `email.senders.use` AND the channel-account access rules on that sender
  (assignment, scope); a policy says which brand speaks, it does not let every
  mailer speak as it. A tenant sender must belong to a Mailketing account whose
  business scope contains its own (enforced at registration, at every token
  lend, and by trigger). The chosen sender, its verified address and display name,
  the policy version and the business scope are **snapshotted immutably** on
  every row (`sql/346`, enforced by trigger for every role). A sender that
  cannot send is `422 SENDER_UNAVAILABLE` (one answer for unknown, foreign,
  unverified, disabled or out-of-scope), never swapped.
- **Security mail stays on the deployment sender** (ADR-0151 Q7): `auth.*` and
  `system.security_notice` get `purpose = 'security'`, and the database refuses
  a tenant sender on them.
- **Dispatch.** The deployment lane is unchanged. Each tenant sender is its own
  lane: re-resolved every pass for the row's tenant; held when its verification
  or its account's credit is stale, unknown or below
  `EMAIL_MAILKETING_CREDIT_FLOOR`; claimed under an hourly cap
  (`EMAIL_SENDER_RATE_PER_HOUR`, advisory lock per sender); sent through a v2
  provider with that account's token (decrypted in memory, `sql/348` lets the
  worker see only a CONNECTED `esp_account`'s own token; `security:readiness`
  pins that policy exactly and probes it) and that account's own breaker
  (`email-mailketing:account:<id>`), FROM the row's snapshotted address.
  Holds are bounded (`SENDER_HOLD_BUDGET_EXCEEDED` one hour after enqueue, also
  for rows that wait unclaimed behind routing switched off, an open account
  breaker or a reached hourly cap); revoked,
  disabled or foreign senders fail with `SENDER_UNAVAILABLE`. **No automatic
  rotation** across senders or accounts, ever.
- **Backward compatibility.** `EMAIL_SENDER_ROUTING_ENABLED` is off by default:
  the single-account env path (`EMAIL_MAILKETING_API_TOKEN`,
  `EMAIL_FROM_ADDRESS`) keeps working byte for byte, named senders are refused
  (`409 SENDER_ROUTING_DISABLED`) and tenant-sender rows are never claimed.
  Cut-over is turning the flag on after accounts and senders are verified;
  rollback is turning it off (nothing is copied; queued tenant rows wait, and
  fail once they are an hour old).
- **Not here:** marketing purpose and its consent gate (the
  `purpose` CHECK admits only `transactional`/`security`). Webhooks: see the
  next section (#1161).

Open decisions (fail-closed choices taken, need maintainer confirmation):
the live `/senders` and `/credits` response shapes are unverified (the parsers
only accept explicit `verified: true` / `status: "verified"` and a numeric
balance); `email:senders:verify` runs as `awcms_app` on the crontab, a choice made in the implementing PR and provisional until the owner confirms it (ADR-0162 O1: confirm, or move it to a dedicated database role; meanwhile the runner withholds `WORKER_DATABASE_URL` from it and the job exits non-zero when the secret store is unavailable or nothing could be probed); a 401/403 at send time does not degrade the
account immediately (the worker cannot write health; the per-account breaker
stops the lane and the next verify pass records it); workflow notifications do
not consult the default policy (only announcements do).

## Mailketing webhooks: quarantine, suppression precedence (Issue #1161)

ADR-0151 section 5, **`strict` mode**. Off by default (`EMAIL_WEBHOOK_ENABLED`).

**Vendor evidence (re-verified 2026-11-11).** The official documentation
(<https://api.mailketing.co.id/docs/webhook.html>,
<https://api.mailketing.co.id/docs/>, v2.0.2) describes `POST` JSON callbacks,
one URL per event type configured in the Mailketing dashboard, with payloads
`emailopen` (`email`, `date`, `message_id`), `emailclick` (`email`,
`link_clicked`, `date`, no id), `bounce` (`email`, `reason`, `date`,
`message_id`), `newsubscriber` (`email`, names, `list_id`, `mobile`, `date`),
`unsubscribe` (`email`, `date`, no id) and Business-API-only `delivered`
(`send_time`, `orig`, `rcpt`, `jobid`, `dsndiag`). It describes **no
authentication at all**: no signature or HMAC, no secret header, no token, no
source-IP list, no mTLS, no event id; and no message-status, unsubscribe or
suppression endpoint to re-verify a report against. So nothing can tell a real
callback from a forged one, and a "verify by pulling from the vendor" design has
nothing to pull.

What was built, fail-closed:

- **Callback URL per Mailketing account.** `POST /api/v1/email/webhook-callbacks`
  (`email.webhook.configure`, high-risk, idempotent, audited) issues or rotates
  `/api/v1/email/webhooks/mailketing/mkw1.<tenantId>.<callbackId>.<secret>`
  (256-bit secret), shown once. It is a `channel_accounts` webhook subscription
  (`verification_mode = 'unauthenticated'`); only a SHA-256 bound to tenant and
  callback id is stored. Issuing revokes the previous URL; revoke
  (`.../{id}/revoke`), disconnecting or deleting the account stops it at once.
  The URL **locates** the account, it does not authenticate Mailketing
  (ADR-0150 N5).
- **Intake** (`application/mailketing-webhook-handler.ts`). 404 when off. Every
  request is charged to a per-address bucket of FAILED proofs (30/min) before
  any parsing or database work, and the charge is refunded once the request
  verifies: Mailketing calls every tenant's URL from a few shared addresses, so
  legitimate traffic never fills the shared bucket (one tenant cannot 429
  another), while an address that keeps failing is refused without a query.
  Then the token shape and a 32 KiB cap; the token verified in constant time
  inside the tenant it names (tenant active, `email` enabled, callback live,
  account `connected`), one `401` for every failure; then a per-CALLBACK bucket
  for verified traffic (`EMAIL_WEBHOOK_RATE_PER_MINUTE`). Rejections are counted
  and audited in aggregate on the platform tenant. Listed in
  `SESSION_FREE_BODY_ENDPOINTS`.
- **Binding.** An event is kept only if it names a `sent` message THIS tenant
  sent through a sender identity of THIS account: by the provider message id we
  stored at acceptance AND the recipient (`bounce`, `emailopen`, `delivered`),
  or, for `emailclick`/`unsubscribe` (no id in the payload), by the recipient
  having been mailed by this account in the last 30 days. Another tenant's or
  account's id, or a mismatched recipient, is discarded. `newsubscriber` is
  never stored and never creates a subscriber or consent.
- **Flood bounds.** The provider timestamp is parsed strictly: the vendor's
  documented zone-less `YYYY-MM-DD HH:MM:SS` (read as UTC, with a 14-hour
  future skew for WIB/WITA/WIT values) or ISO-8601 with an explicit zone;
  anything else, a date older than 30 days or further in the future is
  discarded as stale. Dedupe ignores that timestamp, so a valid URL cannot mint
  rows by varying it: one row per (account, type, message) for bounce, open and
  delivered, one per (account, type, recipient, UTC day) for click and
  unsubscribe, and at most ONE pending unsubscribe per recipient (unique index).
  At most `EMAIL_WEBHOOK_MAX_PENDING` (default 5000) pending events per tenant:
  past that, further bounces and unsubscribes are NOT recorded (counted as
  `quotaExceeded`, logged at warning) until operators review the queue. That is
  fail-closed for this mode: strict mode acts on nothing by itself, so nothing
  it would have done is lost, and the queue already waiting is not buried.
- **Quarantine, not state.** Events land in `awcms_email_provider_events`
  (`sql/379`), always `authenticity = 'unauthenticated'`, recipient as hash and
  mask, bounce reason reduced to hard/soft/unknown and an RFC 3463 code, a click
  to its link host and a hash (never stored, rendered as a link or fetched). No
  message status, suppression, subscriber, consent or customer changes.
  Immutable except a one-time review; `received_at` is the database clock.
- **Operator review.** `GET /api/v1/email/provider-events` (`email.webhook.read`)
  lists the quarantine; with `emailMessageId` it adds the provider-reported
  projection (`accepted` < `delivered` < `bounced`, the maximum over the
  message's events, so it only moves forward; never written onto the message;
  there is no `complained` because Mailketing reports none).
  `POST /api/v1/email/provider-events/{id}/review`
  (`email.provider_events.approve`, high-risk, idempotent, audited with ids
  only; a signed-in person and operator access to the event's account under
  the `channel_accounts` rules, else the same 404) confirms a bounce (hard;
  soft/unknown only once the recipient soft-bounced on
  `EMAIL_WEBHOOK_SOFT_BOUNCE_THRESHOLD`, default 3, DISTINCT messages in 30
  days: repeats about one message count once) or an
  unsubscribe into the suppression list with `source = 'provider_report'`, or
  dismisses it. One suppression per recipient, so a bounce and an unsubscribe
  for one person do not race.
- **Suppression precedence (ADR-0151 section 4), at enqueue AND dispatch**
  (`domain/suppression-policy.ts`):

  | Entry                                          | transactional | security |
  | ---------------------------------------------- | ------------- | -------- |
  | `operator` `manual` / `bounced` / `complained` | blocked       | blocked  |
  | `operator` `unsubscribed`                      | blocked       | allowed  |
  | `provider_report` (any reason)                 | blocked       | allowed  |

  A marketing opt-out never stops a password reset, invitation or security
  notice, and an unauthenticated provider report never does either.

- **Security mail is sent only by the system.** Because that exemption exists,
  a `security` message must be one the system decided to send. The
  announcement routes (`POST /api/v1/email/announcements`, `.../preview`) no
  longer accept auth/security templates (`auth.*`, `system.security_notice`):
  `422 TEMPLATE_CATEGORY_RESERVED`. As defence in depth, `enqueueAnnouncement`
  and `enqueueDirectAddressEmail` throw `SecurityMailNotPermittedError` for a
  security category unless the caller presents `SECURITY_MAIL_GRANT`
  (`application/security-mail-grant.ts`), which only the internal auth
  notification port holds (pinned by a test).
- **Retention.** `email:queue:purge` deletes reviewed and informational events
  after 90 days and pending ones after 365 (legal-hold gated, its own
  descriptor; `--dry-run` counts them too). Three layers keep anything younger:
  `awcms_app` has no DELETE on the table; a RESTRICTIVE policy refuses the
  worker anything younger than 30 days, or a pending row younger than 365; and
  a BEFORE DELETE trigger refuses the same rows for EVERY role (an owner, or a
  single-role deployment the policy does not bind). `security:readiness` pins
  the policy and both triggers to their exact text and probes the floor as
  `awcms_worker` on back-dated rows in a rolled-back transaction. A failing
  tenant no longer stops the purge for the others.

Open decisions (fail-closed choices taken, need maintainer confirmation):

- **Q1 / Q6 of ADR-0151 stay open.** Only `strict` exists; `restrictive-only`
  (automatic suppression on a message-bound bounce or unsubscribe) and
  `authenticated` need the ADR decision, and the vendor has not been asked for
  a signature, source-IP list or event id in this change.
- **`unsubscribed` still blocks transactional mail.** ADR-0151 rule 2 lets an
  unsubscribe stop `marketing` only, but there is no `marketing` purpose yet,
  so it is today the only way a person stops tenant announcements. Narrowing it
  belongs to the campaign issue that adds `marketing` and its consent gate.
- **Newsletter opt-out is not propagated.** A confirmed unsubscribe suppresses
  the address in `email`; it does not change a `newsletter` subscriber
  (ADR-0103 owns consent) and nothing is called at Mailketing (no such API).
- **The deployment sender gets no callback.** It has no account to bind to, and
  binding by provider id across tenants is what this refuses to do.
- **A confirmed unsubscribe is tenant-wide.** The suppression list is keyed by
  (tenant, recipient), so an unsubscribe reported through ONE brand's
  Mailketing account, once an operator confirms it, stops that tenant's
  transactional mail to the person from EVERY brand (never security mail).
  Fail-safe in direction (it only stops mail), but broader than a per-brand
  opt-out; the analogous decision for WhatsApp marketing consent is #1231 M4.
  A per-brand scope needs a suppression key change and a decision.
- **Zone-less provider timestamps are accepted.** The audit asked for ISO-8601
  with an explicit zone; Mailketing's documented payloads carry none
  (`2026-08-18 10:30:00`), so that exact form is accepted as UTC with a wide
  future skew. Every other form is discarded as stale.
- The webhook callback URLs and the quarantine review queue still have no
  screen (see the next section). No AsyncAPI channel is added: nothing here
  publishes a domain event.

## Admin screen: email senders (Issue #1162, ADR-0151 §2, §6, §7)

`/admin/email-senders` (nav entry gated on `email.senders.read`) is the
operations view of the tenant's Mailketing accounts and sender identities. It
reuses what exists rather than building a second mail console: templates stay
on `/admin/email-templates`, suppression on `/admin/email-suppression`,
subscriptions on `/admin/newsletter`, and connecting, replacing a credential or
disconnecting an account on `/admin/channel-accounts/{id}` (the page links
there; it holds no destructive control of its own).

What it shows, per caller and per tenant:

- each Mailketing account: connection (connected, credential rejected, out of
  credit, answer not recognised, disconnected, pending), credit and when it was
  last checked, number of senders, bound business scope, and an **API v2**
  label (tenant senders always use v2);
- each sender identity: the verification the provider last reported
  (verified, not verified, check out of date, never checked, failing), the
  dispatcher's own hold reason, last check, queue (waiting, sending, failed in
  the last day, oldest waiting, hourly cap) and whether it is the default of its
  brand; the address is masked (`n•••@domain`);
- the deployment sender's lane and whether it is the tenant-wide default, for a
  caller who is not confined to business scopes;
- the v1 to v2 **migration notice** of the deployment sender: not Mailketing,
  still v1, v2 unverified (`EMAIL_MAILKETING_V2_VERIFIED` not `true`), invalid
  version, v2 verified.

**Stale is not unknown.** A check older than
`EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES` reads "out of date", a check that never
happened reads "never checked", and neither is shown as verified. "Can send
now" is `evaluateEmailSenderHealth`, the same gate the dispatcher holds mail by
(`domain/email-senders-view.ts`), so the page cannot say "ready" about a sender
the queue would hold.

**Visibility is the API's, not a copy.** Accounts come from the channel registry
under its own rules (assignment gate, business scope decided per row at the
access chokepoint); lanes and policies go through `filterVisibleEmailSenders`,
the function `GET /api/v1/email/senders` now also calls. A person of another
tenant, a caller confined to another brand, and a person an account is not
assigned to see nothing of it. An account whose Mailketing login the caller may
not see contributes no credit fact: its senders read "credit unknown" and are
held. A channel registry that cannot be loaded is "unavailable", never an empty
list.

**The one control is "Make default sender"** (`PUT /api/v1/email/sender-policy`,
which is permission-gated, idempotent, audited at `warning`). It is offered only
where that endpoint would accept it, and otherwise rendered **disabled with its
reason** (not permitted, routing off, not connected, not ready, not assigned as
operator, brand scope not held). It applies to later messages only.

**Shown as not available yet, disabled and explained:** a test send (needs an
allow-listed address and a confirmation step that do not exist) and remote
list/campaign management (Mailketing has no documented API for it). Mailketing
is outbound only; the page says there is no inbox.

Not here (recorded follow-ups of #1162): the Mailketing webhook callback
management and the provider-event quarantine review queue
(`email.webhook.*`, `email.provider_events.approve`), a message-level queue
list, "use the deployment sender" as an explicit default, a connect wizard
(`channel_accounts` #1154), a test send, and an approval flow for disconnect or
rotation (the endpoints exist under `channel_accounts` with step-up and audit).

Open decisions: the sender address is masked on this screen (the API never
returns it); whether operators should see it whole is a product decision. The
screen loads at most 100 Mailketing accounts and says when there are more.

Visibility follow-up (audit of #1303): a sender whose Mailketing login the caller
cannot see reads one generic reason (`PARENT_UNAVAILABLE`) whatever state the
login is in; when a tenant-wide default exists but names a sender the caller
cannot see, the deployment lane's "is default" is unknown (`null`) and the page
says the default is not shown, instead of claiming the deployment sender; health
facts are loaded only for the accounts the caller may see.

## Disabled / offline-LAN behavior

`EMAIL_ENABLED=false` must never stop the app or any business path.
`dispatchEmailQueue` returns early without claiming any row — not "try and
fail", it simply does not try. Queued messages are processed on a later run
once the module is enabled.

## Ported subset / intentional drops vs awcms-mini

- The password-reset flow (`/api/v1/auth/password/*`) lives in
  `identity_access` in mini and is **not** part of this email-module port —
  the outbox contract is available for it to enqueue against when that flow
  is ported.
- `GET /api/v1/reports/email-health` and the `security:readiness`
  provider-config gate are **dropped** here — the `reporting` module and the
  `security:readiness` script do not exist in this repo yet. The equivalent
  data is available via `GET /api/v1/email/messages?status=...`.
- Integration tests against a live PostgreSQL are not part of this repo's
  test suite; the ported tests are the pure-domain unit tests.

## Related skills

`awcms-integration` (outbox/retry/circuit-breaker), `awcms-sensitive-data`
(normalize/hash/mask), `awcms-idempotency`, `awcms-abac-guard`,
`awcms-audit-log`.

## Email Bun runtime / planned UI status

Existing `bun run email:dispatch` is a Bun queue worker calling HTTP provider outside DB transaction. Future campaigns, multi-account Mailketing and realtime progress must keep Bun; WebSocket/SSE would only display authorized status, not send email. [Runtime standard](../../../docs/awcms/bun-delivery-realtime-runtime.md).
