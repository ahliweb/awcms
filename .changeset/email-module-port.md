---
"awcms": minor
---

Add the email module: a reusable, provider-neutral transactional email
service ported from awcms-mini (epic #492). Generic infrastructure —
analogous to `sync_storage`'s object-storage port — for password reset,
system announcements, and workflow notifications; Mailketing is one adapter,
not a domain-specific feature.

- New migration `014_awcms_email_schema.sql`: adds `awcms_email_templates`
  (per-locale `jsonb` bodies, soft-delete/restore), `awcms_email_messages`
  (outbox delivery queue, one row per recipient), `awcms_email_delivery_attempts`,
  and `awcms_email_suppression_list`. All tenant-scoped tables have RLS
  tenant-isolation policies with FORCE and FK indexes. Seeds the
  `email.{template,message,suppression,notification,announcement}.*` ABAC
  permissions.
- New `EmailProvider` port with a real Mailketing adapter and a safe `log`
  adapter, resolved at one edge; provider calls happen strictly outside any
  DB transaction (ADR-0006), via an outbox + claim/send/finalize dispatcher
  (`bun run email:dispatch`) with retry/backoff, circuit breaker, and
  dispatch-time suppression re-check.
- New REST endpoints under `/api/v1/email`: template CRUD + restore + preview
  (`/templates`), bulk announcement/notification enqueue + dry-run preview
  (`/announcements`, two-tier ABAC, `Idempotency-Key`-guarded), delivery-queue
  diagnostics + cancel (`/messages`), and suppression-list CRUD
  (`/suppressions`). All guarded by default-deny ABAC and audited.
- Template management with per-category variable allowlists (fail-closed),
  i18n locale variants, and XSS-safe rendering (allowlist filtering +
  HTML-escaping).
- New AsyncAPI channels `awcms.email.message.{queued,sent,failed,suppressed,cancelled}`
  (contract-only; the structured logger is the producer).
- New worker jobs `bun run email:dispatch`, `bun run email:provider:health`,
  and `bun run email:templates:seed-defaults`. Registered in
  `src/modules/index.ts`.

The password-reset flow, the `reporting` email-health endpoint, and the
`security:readiness` provider-config gate from awcms-mini are intentionally
out of scope for this port (their host modules/scripts do not exist in this
repo yet).
