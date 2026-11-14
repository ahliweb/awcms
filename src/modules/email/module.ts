import { defineModule } from "../_shared/module-contract";

/**
 * Lifecycle descriptor keys (Issue #468). Exported so
 * `application/email-queue-purge.ts` names the same strings the registry does,
 * rather than repeating two literals that could drift apart silently — a legal
 * hold checked against a key nobody registered would return "not held" forever,
 * and read exactly like "no hold in place".
 */
export const EMAIL_MESSAGES_LIFECYCLE_KEY = "email.messages";
export const EMAIL_ATTEMPTS_LIFECYCLE_KEY = "email.delivery_attempts";
/** Issue #1161: the quarantine of provider-reported Mailketing events (`sql/379`). */
export const EMAIL_PROVIDER_EVENTS_LIFECYCLE_KEY = "email.provider_events";

export const emailModule = defineModule({
  key: "email",
  name: "Email",
  version: "0.6.0",
  status: "active",
  description:
    "Reusable, provider-neutral email service (ported from awcms-mini epic #492): message/recipient/attachment DTOs, an `EmailProvider` port, Mailketing configuration, the tenant-scoped schema/RLS/delivery queue (`sql/014`), the real Mailketing adapter plus a safe `log` provider, the claim/send/finalize dispatcher (`bun run email:dispatch`, dispatch-time suppression re-check), template management (CRUD + soft-delete/restore, per-category variable allowlists, i18n locale variants, admin preview) at `/api/v1/email/templates`, bulk announcement/notification workflows (`/api/v1/email/announcements`, tenant/role/explicit-user targeting, two-tier ABAC, idempotent), and admin observability/ops (`/api/v1/email/messages` queue diagnostics + cancel, `/api/v1/email/suppressions` manual suppression CRUD). Generic infrastructure — analogous to `sync_storage`'s object-storage port — for password reset, system announcements, and workflow notifications; not a domain-specific 'send a receipt' feature.",
  dependencies: ["tenant_admin", "profile_identity", "identity_access"],
  /**
   * `auth_notification` (ADR-0011 capability port,
   * `_shared/ports/auth-notification-port.ts`) — how `identity_access` delivers
   * a password-reset link without importing this module's application tree, and
   * without `awcms_email_messages` gaining a writer that does not own it
   * (ADR-0013 §6).
   *
   * It has to be a capability rather than a `dependencies` edge in the other
   * direction: `email` already depends on `identity_access`, so
   * `identity_access → email` as a dependency would close a cycle.
   * `capabilities.consumes` deliberately carries no lifecycle ordering, which is
   * exactly the relationship here — the consumer degrades (reports
   * `enqueued: false` and audits it) rather than failing.
   *
   * `workflow_notification` (`_shared/ports/workflow-notification-port.ts`) —
   * listed since #1044, the first caller that actually imports its adapter:
   * `hr_workforce`'s attendance-correction settler tells the requester the
   * outcome through it. (The workflow `notify` node still does not wire it.)
   * Enqueue only: the adapter writes outbox rows, `email:dispatch` sends later.
   */
  capabilities: {
    provides: ["auth_notification", "workflow_notification"],
    // Issue #1160, ADR-0151 section 2: a message may be sent as a tenant-owned
    // Mailketing sender (a `channel_accounts` account). Optional: with routing
    // off, or no sender named and no policy configured, nothing here is
    // consulted and the deployment sender is used exactly as before. Loaded
    // lazily by `infrastructure/channel-account-loaders.ts` (no secret); the
    // credential port is composed only by `scripts/email-dispatch.ts` and
    // `scripts/email-senders-verify.ts`. A soft edge, NOT a `dependencies`
    // entry: switching `channel_accounts` off must not strand the queue.
    consumes: [
      {
        capability: "channel_account",
        providedBy: "channel_accounts",
        optional: true
      }
    ]
  },
  api: {
    openApiPath: "openapi/modules/email.openapi.yaml",
    basePath: "/api/v1/email"
  },
  navigation: [
    {
      labelKey: "admin.layout.nav_email_templates",
      path: "/admin/email-templates",
      order: 32,
      requiredPermission: "email.template.read"
    },
    // Issue #544. Its own entry rather than a section on the templates screen:
    // an operator reaching for this is answering "why did our mail not arrive",
    // not editing copy, and a control they cannot FIND is the same as one that
    // does not exist. 33, not 32 — two entries sharing an order leave the
    // sidebar's sequence to whatever the sort happened to do that build.
    {
      labelKey: "admin.layout.nav_email_suppression",
      path: "/admin/email-suppression",
      order: 33,
      requiredPermission: "email.suppression.read"
    },
    // Issue #1162. The operations view of the Mailketing accounts and sender
    // identities (verification, credit, freshness, queue, default sender); it
    // reuses the screens beside it rather than duplicating them. 34 follows 33
    // so the sidebar keeps a stable order within the email group.
    {
      labelKey: "admin.layout.nav_email_senders",
      path: "/admin/email-senders",
      order: 34,
      requiredPermission: "email.senders.read"
    }
  ],
  /**
   * Mirrors `sql/014`'s seed EXACTLY — same twelve (activityCode, action) pairs,
   * same descriptions. `GET /api/v1/modules/email/permissions` compares the two
   * and reports `orphaned` for a seeded row with no descriptor entry and
   * `mismatched_description` when the text drifts, so a paraphrase here is a
   * reported defect, not a stylistic choice.
   *
   * `email` was the last module without this block: 20 of 21 declared theirs,
   * and its twelve rows therefore showed as permanently `orphaned` — a standing
   * false positive that trains readers to ignore the report, which is the one
   * thing a drift report must not do.
   */
  permissions: [
    {
      activityCode: "template",
      action: "read",
      description: "Read tenant email templates"
    },
    {
      activityCode: "template",
      action: "create",
      description: "Create an email template"
    },
    {
      activityCode: "template",
      action: "update",
      description: "Update an email template"
    },
    {
      activityCode: "template",
      action: "delete",
      description: "Delete (soft) an email template"
    },
    {
      activityCode: "template",
      action: "restore",
      description: "Restore a soft-deleted email template"
    },
    {
      activityCode: "message",
      action: "read",
      description: "Read/diagnose tenant email queue"
    },
    {
      activityCode: "message",
      action: "cancel",
      description:
        "Cancel a still-queued (queued/retry_wait) email message before it sends"
    },
    {
      activityCode: "suppression",
      action: "read",
      description: "Read the email suppression list"
    },
    {
      activityCode: "suppression",
      action: "create",
      description: "Manually suppress a recipient address"
    },
    {
      activityCode: "suppression",
      action: "delete",
      description: "Remove a manual suppression entry"
    },
    {
      activityCode: "notification",
      action: "create",
      description: "Enqueue an email notification to an explicit set of users"
    },
    {
      activityCode: "announcement",
      action: "create",
      description:
        "Enqueue a bulk email announcement to a role or the whole tenant"
    },
    // Issue #1160 (`sql/347`). Each is enforced by a route added in the same
    // change: GET /email/senders, the announcement route's sender selection,
    // and PUT /email/sender-policy.
    {
      activityCode: "senders",
      action: "read",
      description:
        "Read this tenant's Mailketing email senders with queue, quota, verification and credit diagnostics, and the default-sender policy (never a credential)"
    },
    {
      activityCode: "senders",
      action: "use",
      description:
        "Send email as a tenant-owned Mailketing sender identity (explicit sender or business scope on an announcement)"
    },
    {
      activityCode: "sender_policy",
      action: "configure",
      description:
        "Set or clear the default email sender of a business scope; affects later messages only (high-risk, audited at warning)"
    },
    // Issue #1161 (`sql/380`). Enforced by GET/POST /email/webhook-callbacks,
    // POST /email/webhook-callbacks/{id}/revoke, GET /email/provider-events and
    // POST /email/provider-events/{id}/review.
    {
      activityCode: "webhook",
      action: "read",
      description:
        "Read Mailketing webhook callback credentials (never the token) and the quarantine of provider-reported, unauthenticated delivery events (recipients masked)"
    },
    {
      activityCode: "webhook",
      action: "configure",
      description:
        "Issue, rotate or revoke the webhook callback URL of a Mailketing account (high-risk, audited at warning)"
    },
    {
      activityCode: "provider_events",
      action: "approve",
      description:
        "Confirm a quarantined bounce or unsubscribe into the suppression list, or dismiss it (high-risk, audited at warning)"
    }
  ],
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      "awcms.email.message.queued",
      "awcms.email.message.sent",
      "awcms.email.message.failed",
      "awcms.email.message.suppressed",
      "awcms.email.message.cancelled"
    ]
  },
  jobs: [
    {
      command: "bun run email:dispatch",
      schedule: {
        mode: "cron",
        expression: "*/2 * * * *",
        backlog: "bounded"
      },
      purpose:
        "Drain the due email delivery queue (claim-lease, retry/backoff, circuit breaker) for every active tenant.",
      recommendedSchedule: "Every 1-2 minutes via cron/systemd timer.",
      environmentNotes:
        'No-op when EMAIL_ENABLED is not "true" — safe to schedule regardless of deployment profile (e.g. offline/LAN).',
      safeInOfflineLan: true
    },
    {
      command: "bun run email:provider:health",
      schedule: {
        mode: "manual",
        because:
          "An operator probe used while diagnosing delivery problems, and a deploy smoke check. On a timer it would poll a third-party API for no consumer."
      },
      purpose:
        "Live network check against the configured email provider's health endpoint.",
      recommendedSchedule:
        "On-demand — operators run manually or from a deployment smoke-test step, not on a recurring schedule.",
      environmentNotes:
        'Exits 0 (no-op) when EMAIL_ENABLED is not "true". Requires real network egress to the provider — not run in CI.',
      safeInOfflineLan: false
    },
    {
      command: "bun run email:senders:verify",
      schedule: { mode: "cron", expression: "0 * * * *", backlog: "bounded" },
      purpose:
        "Read each tenant Mailketing account's credit balance and verified senders (read-only GET /credits and GET /senders) and record them as account health; a sender becomes usable only when the provider reports it verified (Issue #1160).",
      recommendedSchedule:
        "Hourly via cron/systemd timer. Must run more often than EMAIL_SENDER_HEALTH_MAX_AGE_MINUTES (default 360), or every tenant sender is held as stale (fail closed).",
      environmentNotes:
        'No-op when EMAIL_SENDER_ROUTING_ENABLED is not "true". Runs as awcms_app through DATABASE_URL, a recorded scheduled exception (ADR-0162, listed in APP_ROLE_SCHEDULED_EXCEPTIONS): it writes channel-account health, which only the request role may. Provider calls are read-only GETs; one tenant failing does not stop the others. Requires network egress to the provider and the channel secrets key ring.',
      safeInOfflineLan: false
    },
    {
      command: "bun run email:templates:seed-defaults",
      schedule: {
        mode: "manual",
        because:
          "Runs once per tenant, right after that tenant is created. There is nothing periodic about it, and re-running it on a schedule would fight an operator who deliberately edited a template."
      },
      purpose:
        "Seed the default system email templates for one tenant (idempotent — skips any template_key that already has an active row).",
      recommendedSchedule:
        "On-demand — once per tenant, typically right after tenant setup.",
      environmentNotes:
        "Requires --tenant=<tenantId> --actor=<tenantUserId> arguments.",
      safeInOfflineLan: true
    },
    {
      command: "bun run email:queue:purge",
      schedule: {
        mode: "cron",
        expression: "20 3 * * *",
        backlog: "bounded"
      },
      purpose:
        "Delete terminal email queue rows and spent delivery attempts past their retention windows (legal-hold gated, bounded batches).",
      recommendedSchedule: "Daily, off-peak.",
      environmentNotes:
        "Runs regardless of EMAIL_ENABLED: a deployment that turned email OFF still holds rows from when it was on, and those are exactly the ones nothing else will ever clean up.",
      safeInOfflineLan: true
    }
  ],
  /**
   * Issue #468, ADR-0072. These two tables sat on
   * `TABLES_PREDATING_THE_RULE` — the debt ledger in
   * `scripts/data-lifecycle-table-coverage-check.ts` — which was honest about
   * what it could not do: *"tell you that an EXISTING table on that ledger is
   * quietly eating the disk"*. Both lines are removed in the same PR as these
   * descriptors, because the gate treats a ledgered table that HAS a descriptor
   * as an error rather than a tolerated duplicate.
   *
   * ## Both are `delegated`, and that is the whole safety argument
   *
   * `HighVolumeTableDescriptor` carries a `cursorColumn` and NO status
   * predicate, so the generic executor deletes purely by age. Pointed at a
   * QUEUE that deletes mail that has not been sent yet — a message stuck behind
   * a provider outage longer than the window would vanish, and the vanishing
   * would look exactly like successful housekeeping.
   * `application/email-queue-purge.ts` names the terminal statuses in the
   * statement itself.
   */
  /**
   * ADR-0094 wave 2 (Issue #557).
   *
   * Mail is addressed to PEOPLE, and the address is stored three ways: in the
   * clear (`to_address`), hashed for lookup, and masked for display. The clear
   * and hashed forms never leave, and erasure has to reach in and clear them —
   * severing the identity does not touch a copy taken at send time.
   *
   * The recipient is matched by ADDRESS rather than by account, which is why
   * neither the message log nor the suppression list can be reached from a
   * per-tenant subject id: both say so outright.
   */
  subjectData: [
    {
      key: "email.email_messages",
      tableName: "awcms_email_messages",
      ownerModuleKey: "email",
      subjectColumns: [{ column: "created_by", references: "tenant_user" }],
      exportable: true,
      erasure: "anonymize",
      rationale:
        "Mail this person SENT, including subject line and the merge variables behind it. Reached as their action; mail they RECEIVED is keyed by address rather than by account, so it is answered only where the address is theirs — and the address columns are cleared on erasure because they are a copy no severance reaches.",
      redactedColumns: [
        "to_address",
        "to_address_hash",
        "variables",
        "variables_hash"
      ],
      // Same four, and `variables` is why the executor learned to empty a JSON
      // document: it is the merge data a message was rendered with, which is
      // where the recipient's own name lives, and no text sentinel fits a
      // `jsonb`. It used to be reported as "skipped" and left intact.
      anonymizedColumns: [
        "to_address",
        "to_address_hash",
        "variables",
        "variables_hash"
      ]
    },
    {
      key: "email.email_suppression_list",
      tableName: "awcms_email_suppression_list",
      ownerModuleKey: "email",
      subjectColumns: [{ column: "created_by", references: "tenant_user" }],
      exportable: true,
      // The row is a HASH of an address plus a reason. Anonymising the identity
      // does not touch it, and deleting it would silently re-enable mail to
      // somebody who asked to stop receiving it — the one outcome a privacy
      // feature must never produce.
      erasure: "anonymize",
      rationale:
        "Addresses that have stopped receiving mail, and who suppressed them. A suppression is itself a privacy decision, so the record survives erasure with the actor detached; deleting it would quietly resume sending to a person who opted out.",
      redactedColumns: ["recipient_hash"],
      // `recipient_masked` too: a masked address is still a display of the
      // address, and clearing the hash while leaving `a***@b***` erases the
      // part nobody looks at. `recipient_hash` is under
      // `(tenant_id, recipient_hash)` UNIQUE, so it takes a per-row sentinel —
      // a person who suppressed two addresses used to abort the erasure.
      anonymizedColumns: ["recipient_hash", "recipient_masked"]
    },
    {
      key: "email.email_templates",
      tableName: "awcms_email_templates",
      ownerModuleKey: "email",
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "updated_by", references: "tenant_user" },
        { column: "deleted_by", references: "tenant_user" },
        { column: "restored_by", references: "tenant_user" }
      ],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Reusable message bodies belonging to the tenant. `subject_template` is a template string, not anybody's subject line; the only people here are the editors."
    },
    {
      // Issue #1160 (`sql/346`). Configuration, not personal data: which
      // sender speaks for a business scope. The only person is who changed it.
      key: "email.email_sender_policies",
      tableName: "awcms_email_sender_policies",
      ownerModuleKey: "email",
      subjectColumns: [{ column: "changed_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "The tenant's default email sender per business scope. Holds no recipient and no address of a person; the only person referenced is the operator who last changed it."
    },
    {
      // Issue #1161 (`sql/379`). Keyed by a recipient HASH bound to our own
      // message, never by account, so no per-tenant subject id reaches it; the
      // only person-shaped column is the reviewer stamp.
      key: "email.email_provider_events",
      tableName: "awcms_email_provider_events",
      ownerModuleKey: "email",
      subjectColumns: [{ column: "reviewed_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Provider-reported, unauthenticated Mailketing delivery events (bounce, open, click, unsubscribe, delivered) quarantined for operator review. The recipient appears only as a lookup hash and a masked display form, a click only as a link host and hash; no address, URL, bounce text or provider payload is stored. The only person reached by account is the operator who reviewed a row; the rows themselves are bounded by this module's retention (90 days, a pending one 365).",
      redactedColumns: ["recipient_hash", "link_hash", "dedupe_key"]
    },
    {
      key: "email.email_delivery_attempts",
      tableName: "awcms_email_delivery_attempts",
      ownerModuleKey: "email",
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Per-attempt provider outcomes hanging off a message row. No column names a person — the link is the message, which answers for itself — and the provider snippet is operational telemetry kept under this module's own retention.",
      redactedColumns: ["provider_response_snippet"]
    }
  ],
  dataLifecycle: [
    {
      key: EMAIL_ATTEMPTS_LIFECYCLE_KEY,
      tableName: "awcms_email_delivery_attempts",
      ownerModuleKey: "email",
      scope: "tenant",
      cursorColumn: "attempted_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "One row per ATTEMPT rather than per message, so a message that exhausts EMAIL_SEND_MAX_RETRIES writes up to six — the highest row rate of the pair. The answer to that is the short retention window it now has, not partitioning: the table is drained continuously and keeps no long history to range-scan."
      },
      archive: {
        archivable: false,
        rationale:
          "A truncated, pre-redacted provider reply is a debugging aid with a half-life of days. It deliberately never contains the recipient address or the message body, so once the incident it belongs to is closed there is nothing in it worth preserving."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Append-only diagnostic rows with no status to transition to and no identifying column to anonymize — the recipient never appears here, only a message FK."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "attempted_at"],
          purpose:
            "awcms_email_delivery_attempts_tenant_idx (sql/014) — declared DESC, which serves this purge's ascending scan without a sort because PostgreSQL reads a btree backwards. An ascending twin was considered and rejected in sql/095's header: write amplification on a per-attempt table to buy nothing."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists. The unique (message_id, attempt_no) constraint means a restore cannot produce duplicate attempt records for a message that is re-dispatched afterwards.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run email:queue:purge",
        purgeFunctionRef:
          "src/modules/email/application/email-queue-purge.ts#purgeEmailQueue",
        description:
          "Deletes attempt rows older than the cutoff in bounded batches, BEFORE the messages step so the foreign key ordering holds. Skips the whole step when a legal hold covers email.delivery_attempts."
      }
    },
    {
      key: EMAIL_MESSAGES_LIFECYCLE_KEY,
      tableName: "awcms_email_messages",
      ownerModuleKey: "email",
      scope: "tenant",
      // `updated_at`, not `created_at`: the moment the row stopped moving. A
      // message that retried for a day would otherwise be measured from before
      // its last attempt.
      cursorColumn: "updated_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      // Longer than the attempt ledger's window would suggest is needed,
      // because this is the row an operator names when a recipient says they
      // never received something: 90 days covers a billing cycle's worth of
      // "did you send my invoice".
      defaultRetentionDays: 90,
      partition: {
        eligible: false,
        rationale:
          "Bounded by delivery throughput and drained continuously, so the live set is small and the historical tail is deleted rather than kept. Partitioning pays for tables that retain a long history, which this one specifically does not."
      },
      archive: {
        archivable: false,
        rationale:
          "The row carries `to_address` — a recipient address in the clear, which is why the table also stores a hash and a mask. Archiving would copy exactly that column into a second, longer-lived artifact, which is the opposite of what retention is for here. The BUSINESS record of what was communicated belongs to whatever produced the message, not to its transport."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Only terminal rows (`sent`/`failed`/`cancelled`/`suppressed`) are eligible; non-terminal rows are pending work, not history. There is nothing to anonymize short of deleting the recipient column, which would leave a row that answers no question anyone asks of it."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "status", "updated_at"],
          purpose:
            "awcms_email_messages_retention_idx (sql/095) — the purge's own path. Added rather than reusing awcms_email_messages_dispatch_idx, which covers the OPPOSITE status set (`queued`/`retry_wait`) and is keyed on next_attempt_at."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists. Restoring an old backup revives queue rows that were terminal at backup time — they stay terminal, because status is stored rather than recomputed. A row restored in `sending` is re-claimed by the next dispatcher pass once its lease is past, which is the same path a worker crash takes.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run email:queue:purge",
        purgeFunctionRef:
          "src/modules/email/application/email-queue-purge.ts#purgeEmailQueue",
        description:
          "Deletes terminal (`sent`/`failed`/`cancelled`/`suppressed`) messages older than the cutoff in bounded batches, skipping any that still have attempt rows so the foreign key holds. Skips the whole step when a legal hold covers email.messages."
      }
    },
    {
      key: EMAIL_PROVIDER_EVENTS_LIFECYCLE_KEY,
      tableName: "awcms_email_provider_events",
      ownerModuleKey: "email",
      scope: "tenant",
      // Written ONLY by the table's trigger (database clock at insert), so no
      // role can make a fresh row look old to the purge or to the floor.
      cursorColumn: "received_at",
      retentionClass: "operational_queue",
      retentionMinDays: 30,
      retentionMaxDays: 365,
      defaultRetentionDays: 90,
      partition: {
        eligible: false,
        rationale:
          "Bounded by construction, not by the rate limit alone: an event that binds to no message this account sent is discarded; dedupe ignores the provider timestamp, so there is at most one row per (account, type, message) for bounce/open/delivered and one per (account, type, recipient, UTC day) for click/unsubscribe, with at most one pending unsubscribe per recipient; pending rows are capped per tenant (EMAIL_WEBHOOK_MAX_PENDING); and a 90-day window (365 for pending). There is no long history to range-scan."
      },
      archive: {
        archivable: false,
        rationale:
          "Unauthenticated provider reports with a recipient hash and masked address: evidence for an operator's decision, whose outcome (a suppression) is kept in the suppression list. Nothing here is worth a second, longer-lived copy."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Reviewed and informational rows after the window; a still-pending bounce or unsubscribe only after 365 days, because it may be a person's request nobody has acted on yet. A RESTRICTIVE policy (sql/379) refuses the worker any row younger than 30 days, or a pending one younger than 365."
      },
      legalHold: {
        applicable: true,
        precedence: "overrides_retention"
      },
      requiredIndexes: [
        {
          columns: ["tenant_id", "received_at"],
          purpose:
            "awcms_email_provider_events_retention_idx (sql/379) — the purge's own oldest-first scan."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists. A restore can bring back events past the window: the next purge removes them. A replayed provider delivery after a restore collapses on the (tenant, dedupe_key) unique key.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run email:queue:purge",
        purgeFunctionRef:
          "src/modules/email/application/email-queue-purge.ts#purgeEmailQueue",
        description:
          "Deletes reviewed and informational provider events older than 90 days, and pending ones older than 365, in bounded batches. Skips the step when a legal hold covers email.provider_events."
      }
    }
  ]
});
