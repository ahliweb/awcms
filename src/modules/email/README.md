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
  or writing an attempt; **429** = retry no sooner than `Retry-After` (clamped
  1 s to 1 h); 5xx / timeout / network / non-JSON = retryable. Results carry
  fixed text plus a status code, never provider body text or a recipient.
  Breaker key is shared with v1 (`email-mailketing`) and counts service-level
  faults plus 401/402/403 (they fail the whole deployment sender). Health probe
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
4. `email:dispatch` prints `uncertain=N`: messages re-claimed after a lease
   expired may have been accepted by the provider before the worker died (a
   possible duplicate, the documented ADR-0151 trade-off; no provider-side
   dedupe exists). Such a sent row carries a `last_error` note. OTP / password
   reset mail is delivered by the same queue and is unchanged.
5. A 401/402/403 streak opens the breaker (5 consecutive) and the dispatcher
   stops claiming until it closes; fix the token, credit or sender, then check
   `bun run email:provider:health`.

All `.env.example` values are placeholders, never real credentials. When
`EMAIL_ENABLED=false` (the default) nothing blocks the app: messages sit in
the outbox and drain once the module is enabled online — offline/LAN
deployments run fully without email.

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
