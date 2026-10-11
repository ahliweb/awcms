import type { HighVolumeTableDescriptor } from "../_shared/module-contract";
import { defineModule } from "../_shared/module-contract";
import {
  WHATSAPP_CONSENT_GRANTED_EVENT_TYPE,
  WHATSAPP_CONSENT_WITHDRAWN_EVENT_TYPE,
  WHATSAPP_DISPATCH_FAILED_EVENT_TYPE,
  WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE,
  WHATSAPP_MESSAGE_FAILED_EVENT_TYPE,
  WHATSAPP_MESSAGE_QUEUED_EVENT_TYPE,
  WHATSAPP_MESSAGE_SENT_EVENT_TYPE,
  WHATSAPP_MODULE_KEY
} from "./domain/whatsapp-events";
import {
  WHATSAPP_ATTEMPTS_LIFECYCLE_KEY,
  WHATSAPP_CONSENTS_LIFECYCLE_KEY,
  WHATSAPP_MESSAGES_LIFECYCLE_KEY,
  WHATSAPP_SUPPRESSIONS_LIFECYCLE_KEY
} from "./domain/whatsapp-lifecycle-keys";

export {
  WHATSAPP_ATTEMPTS_LIFECYCLE_KEY,
  WHATSAPP_CONSENTS_LIFECYCLE_KEY,
  WHATSAPP_MESSAGES_LIFECYCLE_KEY,
  WHATSAPP_SUPPRESSIONS_LIFECYCLE_KEY
};

/**
 * Consents and suppressions are privacy decisions, never purged by age: deleting
 * a suppression would quietly resume sending to someone who asked to stop. They
 * answer the retention question on the record rather than by silence.
 */
function retainedDecision(input: {
  key: string;
  tableName: string;
  why: string;
  indexPurpose: string;
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: WHATSAPP_MODULE_KEY,
    scope: "tenant",
    cursorColumn: "created_at",
    retentionClass: "system_event",
    retentionMinDays: 2555,
    retentionMaxDays: 3650,
    defaultRetentionDays: 3650,
    partition: {
      eligible: false,
      rationale:
        "Bounded by the number of distinct recipients a tenant has dealt with, not by traffic — it does not grow with how much is sent."
    },
    archive: { archivable: false, rationale: input.why },
    deletion: {
      mode: "hard_delete",
      rationale:
        "Not performed by any job. A consent or suppression is a decision the recipient made or that was made about them; removal is an explicit, audited operator action (suppression DELETE) or a data-subject erasure that clears the hash, never an age-based sweep."
    },
    legalHold: { applicable: false, precedence: "not_applicable" },
    requiredIndexes: [
      {
        columns: ["tenant_id", "recipient_hash"],
        purpose: input.indexPurpose
      }
    ],
    batchLimit: 5000,
    backupRestoreNotes:
      "Included in ordinary full-database backup/restore. Restoring an old backup can revive a consent that was withdrawn afterwards; the dispatch-time re-check reads the restored row, so after a restore re-apply withdrawals recorded in the audit log before re-enabling WHATSAPP_ENABLED.",
    executionMode: "delegated",
    existingAdopter: {
      purgeFunctionRef:
        "none — retained for the life of the tenant; see ADR-0133 section 4",
      description:
        "There is deliberately no purge mechanism; this descriptor exists so the table answers the retention question on the record rather than by silence."
    }
  };
}

export const whatsappDeliveryModule = defineModule({
  key: WHATSAPP_MODULE_KEY,
  name: "WhatsApp Delivery",
  version: "0.1.0",
  /**
   * `active`: the operator screen (`/admin/whatsapp`) lands with its
   * `navigation` entry in this same change, which is ADR-0021 criterion 1 and
   * what `tests/admin-media-page-contract.test.ts` measures. The capability
   * itself ships INERT — `WHATSAPP_ENABLED` is off by default and the dispatcher
   * claims nothing without it.
   */
  status: "active",
  description:
    "Generic WhatsApp delivery capability (Issue #963, ADR-0133 phase 1) for any module that must send a WhatsApp message — booking reminders, hr_payroll notices, a downstream commerce adapter. A WhatsApp-specific `WhatsappDeliveryPort` (`_shared/ports/whatsapp-delivery-port.ts`, deliberately NOT a multi-channel facade) whose `enqueue` is one INSERT in the CALLER's transaction; a tenant-scoped queue and per-attempt ledger (`sql/178`); a claim/send/finalise dispatcher (`bun run whatsapp:dispatch`) with lease-based claiming, backoff, a circuit breaker and no network I/O inside a transaction; provider adapters for Meta Cloud API and Fonnte plus a safe `log` adapter, chosen per DEPLOYMENT from the environment (never per tenant); a template registry keyed by module-prefixed `templateKey` with ONE purpose per template and a variable allow-list that drops unlisted variables; purpose classes (transactional, security, marketing) with an independent consent store (marketing needs an explicit recorded opt-in, checked at enqueue AND again at dispatch, and never inferred from segment membership), a suppression list that provider hard failures feed, security-class expiry (`expired`, never sent late) and secrets cleared from the row at a terminal state; the phone number is E.164-normalised, stored raw in exactly one column and masked or hashed everywhere else, including logs, audit rows and domain events. It is a channel queue table, the repo's third after email and push — ADR-0133 section 3: what is refused is a SECOND WHATSAPP queue, one per consuming domain, so booking, hr and commerce all enqueue through this module's single queue. Operator surface: /admin/whatsapp. Ships INERT — without WHATSAPP_ENABLED=true enqueue returns `refused: DISABLED` and the dispatcher claims nothing.",
  dependencies: [
    "tenant_admin",
    "profile_identity",
    "logging",
    "domain_event_runtime"
  ],
  type: "system",
  capabilities: {
    provides: ["whatsapp_delivery"]
  },
  api: {
    openApiPath: "openapi/modules/whatsapp-delivery.openapi.yaml",
    basePath: "/api/v1/whatsapp"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      WHATSAPP_MESSAGE_QUEUED_EVENT_TYPE,
      WHATSAPP_MESSAGE_SENT_EVENT_TYPE,
      WHATSAPP_MESSAGE_FAILED_EVENT_TYPE,
      WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE,
      WHATSAPP_CONSENT_GRANTED_EVENT_TYPE,
      WHATSAPP_CONSENT_WITHDRAWN_EVENT_TYPE,
      WHATSAPP_DISPATCH_FAILED_EVENT_TYPE
    ],
    subscribes: []
  },
  /**
   * Ten permissions, every one enforced by an endpoint added in the same
   * change and seeded by `sql/179`. Queueing a message is deliberately NOT a
   * permission here: it is a capability-port call authorised by the CONSUMER's
   * own permission for its own business action.
   */
  permissions: [
    {
      activityCode: "messages",
      action: "read",
      description:
        "Read this tenant's WhatsApp queue state and recent delivery attempts (recipients masked)"
    },
    {
      activityCode: "messages",
      action: "cancel",
      description:
        "Cancel a WhatsApp message that is still waiting in the queue (refused once it is being sent)"
    },
    {
      activityCode: "suppressions",
      action: "read",
      description: "Read the WhatsApp suppression list (recipients masked)"
    },
    {
      activityCode: "suppressions",
      action: "create",
      description: "Suppress a number so no WhatsApp message is sent to it"
    },
    {
      activityCode: "suppressions",
      action: "delete",
      description:
        "Remove a WhatsApp suppression entry, resuming delivery to that number"
    },
    {
      activityCode: "consents",
      action: "read",
      description:
        "Read recorded WhatsApp marketing consents (recipients masked)"
    },
    {
      activityCode: "consents",
      action: "create",
      description:
        "Record a recipient's explicit WhatsApp marketing opt-in with its source"
    },
    {
      activityCode: "consents",
      action: "restore",
      description:
        "Reinstate a WhatsApp marketing opt-in over a recipient's recorded opt-out, citing evidence (high-risk: it reverses an opt-out)"
    },
    {
      activityCode: "consents",
      action: "withdraw",
      description:
        "Record a recipient's WhatsApp marketing opt-out; queued marketing messages to them are cancelled"
    },
    {
      activityCode: "templates",
      action: "read",
      description:
        "Read the registered WhatsApp templates (key, purpose, allowed variables)"
    }
  ],
  navigation: [
    {
      labelKey: "admin.layout.nav_whatsapp",
      path: "/admin/whatsapp",
      order: 81,
      requiredPermission: "whatsapp_delivery.messages.read"
    }
  ],
  jobs: [
    {
      command: "bun run whatsapp:dispatch",
      schedule: {
        mode: "cron",
        expression: "*/2 * * * *",
        backlog: "bounded"
      },
      purpose:
        "Drain the due WhatsApp queue (claim-lease, expiry and consent re-check, retry/backoff, circuit breaker, hard-failure suppression) for every active tenant.",
      recommendedSchedule: "Every 1-2 minutes via cron/systemd timer.",
      environmentNotes:
        'No-op when WHATSAPP_ENABLED is not "true" — safe to schedule regardless of deployment profile. On an offline/LAN deployment it stays a no-op, since no provider is reachable.',
      safeInOfflineLan: true
    },
    {
      command: "bun run whatsapp:queue:purge",
      schedule: {
        mode: "cron",
        expression: "55 3 * * *",
        backlog: "bounded"
      },
      purpose:
        "Expire non-terminal WhatsApp messages past their expiry (clearing a secret-bearing body) for every tenant, then delete TERMINAL queue rows and spent delivery attempts past their retention windows (legal-hold gated, bounded batches). Never deletes a waiting message, a consent or a suppression.",
      recommendedSchedule: "Daily, off-peak.",
      environmentNotes:
        "Runs regardless of WHATSAPP_ENABLED: a deployment that turned WhatsApp OFF still has rows from when it was on, and nothing else will ever clean them up.",
      safeInOfflineLan: true
    }
  ],
  /**
   * ADR-0094. A message is addressed to a number, so the person is reached
   * through the optional `profile_id` (a profile-addressed message) and the
   * sender stamp; the number columns are cleared on erasure because they are a
   * copy no severance reaches.
   */
  subjectData: [
    {
      key: "whatsapp_delivery.whatsapp_messages",
      tableName: "awcms_whatsapp_messages",
      ownerModuleKey: WHATSAPP_MODULE_KEY,
      subjectColumns: [
        { column: "profile_id", references: "profile" },
        { column: "created_by", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "anonymize",
      rationale:
        "WhatsApp messages addressed to this person's profile or queued by them, with the recipient number, rendered body and merge variables. A message to a bare number (a guest) is reached only where that number is theirs; the number, hash, body and variables are cleared on erasure because they are a copy no severance reaches.",
      redactedColumns: [
        "recipient",
        "recipient_hash",
        "variables",
        "body",
        "idempotency_key"
      ],
      anonymizedColumns: [
        "recipient",
        "recipient_hash",
        "recipient_masked",
        "variables",
        "body"
      ]
    },
    {
      key: "whatsapp_delivery.whatsapp_consents",
      tableName: "awcms_whatsapp_consents",
      ownerModuleKey: WHATSAPP_MODULE_KEY,
      subjectColumns: [
        { column: "created_by", references: "tenant_user" },
        { column: "withdrawn_by", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "anonymize",
      rationale:
        "Recorded WhatsApp marketing opt-ins and opt-outs, and who recorded them. Keyed by a hash of the number, so it is reached by the operator's stamp; the hash and masked number are cleared on erasure, which can only remove a consent (never create one), so the safe direction.",
      redactedColumns: ["recipient_hash"],
      anonymizedColumns: ["recipient_hash", "recipient_masked"]
    },
    {
      key: "whatsapp_delivery.whatsapp_suppressions",
      tableName: "awcms_whatsapp_suppressions",
      ownerModuleKey: WHATSAPP_MODULE_KEY,
      subjectColumns: [{ column: "created_by", references: "tenant_user" }],
      exportable: true,
      erasure: "anonymize",
      rationale:
        "Numbers that stopped receiving WhatsApp, why, and who suppressed them. A suppression is itself a privacy decision, so the record survives erasure with the actor detached; the hash and masked number are cleared.",
      redactedColumns: ["recipient_hash"],
      anonymizedColumns: ["recipient_hash", "recipient_masked"]
    },
    {
      key: "whatsapp_delivery.whatsapp_delivery_attempts",
      tableName: "awcms_whatsapp_delivery_attempts",
      ownerModuleKey: WHATSAPP_MODULE_KEY,
      subjectColumns: [],
      unreachableBySubject: true,
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Per-attempt provider outcomes hanging off a message row. No column names a person — the link is the message, which the descriptor above answers for — and the provider reply is scrubbed of numbers before it is stored, as operational telemetry the module keeps for its own retention window.",
      redactedColumns: ["provider_response_snippet", "error_message"]
    }
  ],
  dataLifecycle: [
    {
      key: WHATSAPP_MESSAGES_LIFECYCLE_KEY,
      tableName: "awcms_whatsapp_messages",
      ownerModuleKey: WHATSAPP_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "updated_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "Bounded by delivery throughput and drained continuously, so the live set is small and the historical tail is deleted rather than kept."
      },
      archive: {
        archivable: false,
        rationale:
          "A delivered message is a copy of information that already exists in the record it points at (via correlation id). Archiving the queue would preserve a second copy of recipient-facing text and a phone number for longer than the queue needs them."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Only terminal rows (`sent`/`failed`/`cancelled`/`expired`) are eligible — a waiting message, including a reminder scheduled days ahead, is pending work, not history. A secret-bearing row had its body and variables cleared at the terminal state already."
      },
      legalHold: { applicable: true, precedence: "overrides_retention" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "status", "updated_at"],
          purpose:
            "awcms_whatsapp_messages_retention_idx (sql/178) — the purge's own path (WHERE tenant_id = ? AND status IN (terminal) AND updated_at < ?), separate from the dispatch index whose status values are the opposite set."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore; no standalone archive artifact exists. Rows restored in `sending` are re-claimed once their lease has passed, the same path a worker crash takes; an already-sent row restored as `queued` can be sent twice, which the recorded provider message id lets reconciliation detect.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run whatsapp:queue:purge",
        purgeFunctionRef:
          "src/modules/whatsapp-delivery/application/whatsapp-queue-purge.ts#purgeWhatsappQueue",
        description:
          "Deletes terminal messages older than the cutoff in bounded batches, skipping any that still have attempt rows so the foreign key holds. Skips the step when a legal hold covers whatsapp_delivery.messages."
      }
    },
    {
      key: WHATSAPP_ATTEMPTS_LIFECYCLE_KEY,
      tableName: "awcms_whatsapp_delivery_attempts",
      ownerModuleKey: WHATSAPP_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "created_at",
      retentionClass: "operational_queue",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 30,
      partition: {
        eligible: false,
        rationale:
          "One row per ATTEMPT, so the highest count of the module's tables, but the same continuously-drained profile as the queue it describes; the answer to its volume is a short retention window."
      },
      archive: {
        archivable: false,
        rationale:
          "A scrubbed provider reply is a debugging aid with a half-life of days; it never contains the body or the number."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Append-only diagnostic rows with no status to transition and no identifying column to anonymize."
      },
      legalHold: { applicable: true, precedence: "overrides_retention" },
      requiredIndexes: [
        {
          columns: ["tenant_id", "created_at"],
          purpose:
            "awcms_whatsapp_delivery_attempts_created_idx (sql/178) — the purge's cursor path."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore. The unique (message_id, attempt_no) constraint means a restore cannot produce duplicate attempt records for a message that is re-dispatched afterwards.",
      executionMode: "delegated",
      existingAdopter: {
        jobCommand: "bun run whatsapp:queue:purge",
        purgeFunctionRef:
          "src/modules/whatsapp-delivery/application/whatsapp-queue-purge.ts#purgeWhatsappQueue",
        description:
          "Deletes attempt rows older than the cutoff in bounded batches, before the messages step so the foreign key ordering holds. Skips the step when a legal hold covers whatsapp_delivery.delivery_attempts."
      }
    },
    retainedDecision({
      key: WHATSAPP_CONSENTS_LIFECYCLE_KEY,
      tableName: "awcms_whatsapp_consents",
      why: "A consent record is evidence that a recipient opted in (or out); archiving it away would make 'did we have consent' unanswerable.",
      indexPurpose:
        "awcms_whatsapp_consents_recipient_unique (sql/178) — leading columns of the unique key; nothing scans this table by age."
    }),
    retainedDecision({
      key: WHATSAPP_SUPPRESSIONS_LIFECYCLE_KEY,
      tableName: "awcms_whatsapp_suppressions",
      why: "A suppression is the standing instruction not to message a number; archiving it away would resume sending.",
      indexPurpose:
        "awcms_whatsapp_suppressions_recipient_unique (sql/178) — leading columns of the unique key; nothing scans this table by age."
    })
  ]
});
