---
name: awcms-email
description: Send transactional email (password reset, announcement, workflow notification) through the reusable AWCMS email module — provider-neutral (Mailketing adapter), template management, and an outbox dispatcher. Use when a derived domain module needs to send email, or when adding a new category/template.
---

🇬🇧 English (source) · 🇮🇩 [Bahasa Indonesia](SKILL.id.md)

# AWCMS — Email Module

Follow `src/modules/email/README.md` (full architecture: provider contract, Mailketing adapter, dispatcher, template management, i18n). This module is generic — analogous to `sync_storage`'s object storage: Mailketing is _one_ adapter, not a reason for the module to become domain-specific (see README §Relationship to historical issue #390).

## How to use it (for a derived domain module that wants to send email)

1. **Make sure a template exists** for your category — the base categories (6 fixed:
   `auth.password_reset`, `system.announcement`, `system.security_notice`,
   `system.maintenance`, `workflow.task_assigned`,
   `workflow.decision_required`) already have a built-in variable allowlist
   (`domain/email-template-categories.ts`'s `BASE_EMAIL_TEMPLATE_CATEGORIES`).
   Your own categories must be `derived.*` and must be registered first:
   ```ts
   registerDerivedEmailTemplateCategory("derived.order_confirmation", [
     "orderNumber",
     "total",
     "trackingUrl"
   ]);
   ```
   Unknown categories are rejected at template create time (fail-closed) —
   **do not** try to reuse an existing base category for something else,
   register your own new `derived.*` category.
2. **Create/ensure the template** via `POST /api/v1/email/templates`
   (`{templateKey, name, subjectTemplate: {en, id?}, textBodyTemplate?, htmlBodyTemplate?}`)
   or `seedDefaultEmailTemplates` for the built-in base categories
   (`bun run email:templates:seed-defaults -- --tenant=<id> --actor=<tenantUserId>`).
3. **Enqueue** — two options:
   - **Bulk/announcement to users/role/tenant** — use
     `POST /api/v1/email/announcements` (Issue #497) instead of writing it
     by hand: it already handles targeting (`{type: "users"|"role"|"tenant"}`),
     suppression-list filtering, two-level ABAC, a mandatory `Idempotency-Key`,
     and one audit row per request. `POST .../preview` for a dry run
     (count + render sample, never the real recipient list).
   - **Other cases (e.g. your own derived domain module)** — INSERT directly
     into `awcms_email_messages` (`sql/014`) inside your own business
     transaction (ADR-0006: a provider call **must not** happen inside a
     transaction — the outbox pattern is what separates them). Fill
     `to_address`/`to_address_hash`/`to_address_masked` using
     `normalizeIdentifier("email", ...)`/`hashIdentifier`/`maskIdentifier`
     (`profile-identity/domain/identifier.ts` — reuse, do not rebuild),
     `template_key` = your category, `variables` (jsonb) = only the values that
     will pass that category's allowlist (any other value is silently never
     substituted at render time), `subject` = the final subject
     (rendered/decided at enqueue time, not at dispatch time).
4. **The dispatcher** (`bun run email:dispatch`, scheduled by cron/systemd
   timer/k8s CronJob) is what actually sends — you never call the
   provider directly.

## Mandatory rules

- **Do not** store long-lived raw secrets/tokens in `variables` — the password
  reset token itself is hashed when stored in its auth table (Issue
  #496), not stored raw in the outbox.
- **Do not** build a new provider adapter outside the `EmailProvider` port
  (`domain/email-provider-contract.ts`) — a new provider (if genuinely
  needed) implements that same port, is resolved via
  `infrastructure/email-provider-resolver.ts`, and is never imported by
  name in calling code.
- **Do not** call the provider (Mailketing) inside a DB transaction —
  always through the outbox + a separate dispatcher.
- Template bodies are **not** stored rendered — the dispatcher renders from
  `template_key`+`variables` at send time; do not add
  `rendered_html_body`/`rendered_text_body` columns to `email_messages`.
- Preview (`POST /api/v1/email/templates/{id}/preview`) exists only so an admin
  can see the render result with synthetic sample data — never send a real
  recipient address to this endpoint, and the endpoint itself **does not**
  touch `email_messages`/the queue.

## Observability & ops (Issue #499)

- **Failed/pending queue**: `GET /api/v1/email/messages?status=failed|retry_wait`
  (permission `email.message.read`) — admin diagnostics, `to_address_masked`
  only, never the raw address.
- **Cancel a message that has not been sent**: `POST /api/v1/email/messages/{id}/cancel`
  (permission `email.message.cancel`, seeded by `sql/014`) — only
  `queued`/`retry_wait` can be cancelled; the technical mitigation for an
  "accidental bulk send" incident.
- **Queue health**: `GET /api/v1/reports/email-health` — counts of
  queued/retry_wait/failed/suppressed + `isHealthy`.
- **Manual suppression list**: `GET/POST /api/v1/email/suppressions`,
  `DELETE /api/v1/email/suppressions/{id}` (permissions
  `email.suppression.{read,create,delete}`, seeded by `sql/014`,
  the endpoints themselves only arrived in Issue #499). The dispatcher also
  re-checks the suppression list right before sending (not only at enqueue) —
  a recipient suppressed after enqueue is still excluded.
- **Provider outage**: the circuit breaker (`email-mailketing`) opens
  automatically after 5 consecutive failures, and the dispatcher stops claiming
  (`email.dispatch.breaker_open` log) — no manual intervention needed.
  `bun run security:readiness` blocks go-live (critical) when
  `EMAIL_ENABLED=true` but the provider config is incomplete
  (`checkEmailProviderConfigReady`, reusing `validate-env.ts`'s
  `checkEmailConfig`).
- The full incident runbook (provider outage, credential rotation, accidental
  bulk send): `src/modules/email/README.md` §Incident response.

## Verification

- Send with `EMAIL_PROVIDER=log` first (no Mailketing credentials) —
  look at the `email.log_provider.send` log (masked address) to confirm the
  end-to-end flow before switching real Mailketing on.
- `bun run email:provider:health` — check real Mailketing connectivity
  (a live network call; run it manually/as a smoke test, not part of CI).
- `bun test tests/integration/email-*.integration.test.ts` against a
  real Postgres for schema/dispatcher/template regressions.

## Related skills

`awcms-integration` (generic outbox/retry/circuit-breaker patterns),
`awcms-sensitive-data` (normalize/hash/mask an email address),
`awcms-idempotency` (`POST /email/announcements` requires an
`Idempotency-Key` on every request, not only bulk ones), `awcms-abac-guard`
(permissions `email.template.*`/`email.notification.create`/
`email.announcement.create`/`email.message.{read,cancel}`/
`email.suppression.{read,create,delete}` are already seeded — `announcement.create`
is **always additional** on top of `notification.create` for role/tenant targets,
a real example of the "tiered permission for a bulk vs single action" pattern),
`awcms-observability` (the `security:readiness` gate, structured logs per
dispatch stage, `GET /reports/email-health`).
