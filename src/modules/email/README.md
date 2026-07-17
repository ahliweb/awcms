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
plus `derived.transactional` each carry an allowed-variable list. A derived
app registers its own `derived.<name>` category via
`registerDerivedEmailTemplateCategory` before use; an unknown category is
rejected at create (fail-closed).

- Body columns are `jsonb` per-locale (`{"en": "...", "id": "..."}`, doc 04
  §Konten multi-bahasa). Rendering (`domain/email-template-render.ts`)
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
