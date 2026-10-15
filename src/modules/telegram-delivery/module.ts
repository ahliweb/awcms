import type { HighVolumeTableDescriptor } from "../_shared/module-contract";
import { defineModule } from "../_shared/module-contract";
import {
  TELEGRAM_ATTEMPTS_LIFECYCLE_KEY,
  TELEGRAM_BINDINGS_LIFECYCLE_KEY,
  TELEGRAM_LINK_CODES_LIFECYCLE_KEY,
  TELEGRAM_MESSAGES_LIFECYCLE_KEY,
  TELEGRAM_MODULE_KEY,
  TELEGRAM_SETTINGS_LIFECYCLE_KEY
} from "./domain/telegram-constants";

export {
  TELEGRAM_ATTEMPTS_LIFECYCLE_KEY,
  TELEGRAM_BINDINGS_LIFECYCLE_KEY,
  TELEGRAM_LINK_CODES_LIFECYCLE_KEY,
  TELEGRAM_MESSAGES_LIFECYCLE_KEY,
  TELEGRAM_SETTINGS_LIFECYCLE_KEY
};

const PURGE_JOB = "bun run telegram:queue:purge";
const PURGE_REF =
  "src/modules/telegram-delivery/application/telegram-queue-purge.ts#purgeTelegramQueue";

/** The shared shape of the four purged tables: delegated, legal-hold gated, bounded batches. */
function purgedTable(input: {
  key: string;
  tableName: string;
  cursorColumn: string;
  retentionMinDays: number;
  retentionMaxDays: number;
  defaultRetentionDays: number;
  archiveWhy: string;
  deletionWhy: string;
  indexColumns: string[];
  indexPurpose: string;
  backupNotes: string;
  adopterDescription: string;
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: TELEGRAM_MODULE_KEY,
    scope: "tenant",
    cursorColumn: input.cursorColumn,
    retentionClass: "operational_queue",
    retentionMinDays: input.retentionMinDays,
    retentionMaxDays: input.retentionMaxDays,
    defaultRetentionDays: input.defaultRetentionDays,
    partition: {
      eligible: false,
      rationale:
        "Bounded by operational-alert volume for a tenant's own staff and drained continuously; the historical tail is deleted, not kept."
    },
    archive: { archivable: false, rationale: input.archiveWhy },
    deletion: { mode: "hard_delete", rationale: input.deletionWhy },
    legalHold: { applicable: true, precedence: "overrides_retention" },
    requiredIndexes: [
      { columns: input.indexColumns, purpose: input.indexPurpose }
    ],
    batchLimit: 5000,
    backupRestoreNotes: input.backupNotes,
    executionMode: "delegated",
    existingAdopter: {
      jobCommand: PURGE_JOB,
      purgeFunctionRef: PURGE_REF,
      description: input.adopterDescription
    }
  };
}

export const telegramDeliveryModule = defineModule({
  key: TELEGRAM_MODULE_KEY,
  name: "Telegram Delivery",
  version: "0.1.0",
  /**
   * `active`: the operator screen (`/admin/telegram`) lands with its
   * `navigation` entry in this same change, which is ADR-0021 criterion 1 and what
   * `tests/admin-navigation-registry.test.ts` measures. The capability itself ships
   * INERT: `TELEGRAM_ENABLED` is off by default and the dispatcher claims nothing
   * without it.
   */
  status: "active",
  description:
    "Optional, off-by-default Telegram delivery adapter for OPERATIONAL AND STAFF ALERTS ONLY (Issue #965, ADR-0140): a staff booking reminder, an approval-pending ping, an operational alert, addressed to a member of staff who has bound their own private Telegram chat. A Telegram-specific `TelegramDeliveryPort` (`_shared/ports/telegram-delivery-port.ts`, deliberately NOT a multi-channel facade and never a fallback for another channel) whose `enqueue` is one INSERT in the CALLER's transaction and returns refusals (DISABLED, TEMPLATE_UNKNOWN, NO_BINDING, RATE_LIMITED, EXPIRY_REQUIRED) instead of throwing; ONE tenant-scoped queue per deployment and a per-attempt ledger (`sql/216`); a claim/send/finalise dispatcher (`bun run telegram:dispatch`) with lease-based claiming, per-chat spacing, a global rate ceiling under 30 per second, Telegram `retry_after` honoured without escalating the backoff, a circuit breaker and no network I/O inside a transaction; one bot per DEPLOYMENT from the environment (never per tenant) whose token is redacted from every error, breaker record and log line; a template registry that admits only the `staff_ops` purpose, typed variables that cannot carry free text, a deny list of PII-like variable names that fails at registration and a CI gate (`bun run telegram:templates:check`) that fails if a payroll-owning module registers a template. A chat is bound only by an audited, revocable handshake: a one-time code (SHA-256 stored, 10 minutes, atomically consumed) opened in a PRIVATE chat creates a `pending_confirmation` binding that the staff member must confirm in their own authenticated session; the chat id is stored only as AES-256-GCM ciphertext (the ADR-0137 helper, AAD bound to tenant and binding) plus a keyed HMAC hash and a mask, and revocation erases the ciphertext at once. The unauthenticated webhook (`POST /api/v1/telegram/webhook`) verifies a timing-safe secret header before any work, handles only `/start <code>` and `/stop`, and ignores everything else with no reply. Off by default at three levels: deployment (`TELEGRAM_ENABLED`), tenant (Module Management plus the audited high-risk `settings.configure` setting) and person (no message before a confirmed binding). Operator surface: /admin/telegram. Ships INERT.",
  dependencies: ["tenant_admin", "identity_access", "logging"],
  type: "system",
  capabilities: {
    provides: ["telegram_delivery"]
  },
  api: {
    openApiPath: "openapi/modules/telegram-delivery.openapi.yaml",
    basePath: "/api/v1/telegram"
  },
  /**
   * Six permissions, every one enforced by an endpoint added in the same change,
   * claimed by `/admin/telegram` and seeded by `sql/218`. Queueing a message is
   * deliberately NOT a permission here: it is a capability-port call authorised by
   * the CONSUMER's own permission for its own business action.
   */
  permissions: [
    {
      activityCode: "messages",
      action: "read",
      description:
        "Read this tenant's Telegram queue state and recent delivery attempts (no chat ids, bodies or variables)"
    },
    {
      activityCode: "templates",
      action: "read",
      description:
        "Read the registered Telegram operational-notice templates (key, allowed variables)"
    },
    {
      activityCode: "bindings",
      action: "read",
      description:
        "Read the tenant's Telegram chat bindings (staff member, state and a masked chat reference)"
    },
    {
      activityCode: "bindings",
      action: "revoke",
      description:
        "Revoke another staff member's Telegram binding, stopping delivery and erasing the stored chat id (high-risk, audited at warning)"
    },
    {
      activityCode: "links",
      action: "create",
      description:
        "Link your OWN Telegram chat: request a one-time link code, confirm or reject the chat that used it, and unlink it"
    },
    {
      activityCode: "settings",
      action: "configure",
      description:
        "Turn Telegram delivery on or off for this tenant (high-risk, audited; turning it off revokes every binding)"
    }
  ],
  navigation: [
    {
      labelKey: "admin.layout.nav_telegram",
      path: "/admin/telegram",
      order: 82,
      requiredPermission: "telegram_delivery.links.create",
      // The screen has a panel for each of the six permissions, so the link is
      // shown to a holder of ANY of them (a diagnostics-only administrator
      // holds `messages.read` and nothing else). Each panel still gates on its
      // own key, and the page's own guard is the authorization.
      requiredAnyPermission: [
        "telegram_delivery.messages.read",
        "telegram_delivery.templates.read",
        "telegram_delivery.bindings.read",
        "telegram_delivery.bindings.revoke",
        "telegram_delivery.settings.configure"
      ]
    }
  ],
  jobs: [
    {
      command: "bun run telegram:dispatch",
      schedule: {
        mode: "cron",
        expression: "* * * * *",
        backlog: "bounded"
      },
      purpose:
        "Drain the due Telegram queue (tenant gate, binding and principal re-check, per-chat spacing, global rate ceiling, retry_after handling, circuit breaker, suspension of an unreachable chat) for every active tenant.",
      recommendedSchedule: "Every minute via cron/systemd timer.",
      environmentNotes:
        'No-op when TELEGRAM_ENABLED is not "true", so it is safe to schedule regardless of deployment profile. On an offline/LAN deployment it stays a no-op, since api.telegram.org is not reachable. Run it from ONE cron entry (flock): the global rate ceiling is per process.',
      safeInOfflineLan: true
    },
    {
      command: PURGE_JOB,
      schedule: {
        mode: "cron",
        expression: "10 4 * * *",
        backlog: "bounded"
      },
      purpose:
        "Expire non-terminal Telegram messages past their expiry, end unconfirmed bindings past their confirmation window and the bindings of any tenant whose module or switch is off or whose person was deactivated or lost every role (erasing the stored chat id), then delete TERMINAL queue rows and spent attempts past retention, revoked bindings past 90 days and expired link codes (legal-hold gated, bounded batches). Never deletes a waiting message or a live binding.",
      recommendedSchedule: "Daily, off-peak.",
      environmentNotes:
        "Runs regardless of TELEGRAM_ENABLED and of a tenant's module or switch state: a deployment that turned Telegram OFF still has rows and encrypted chat ids from when it was on, and nothing else will clean them up or notice a person who has since left.",
      safeInOfflineLan: true
    }
  ],
  /**
   * ADR-0094. A binding is data about a person (their chat), reached through
   * `principal_id`, a tenant user. Erasure overwrites the ciphertext, the hash and
   * the masked references with the erasure sentinel. A binding left `active` with
   * an overwritten ciphertext cannot be decrypted, so each message addressed to it
   * fails (`chat_undecryptable`) rather than being sent; it is NOT suspended by
   * that. What ends the binding is the principal-liveness sweep (`sql/217`'s
   * `awcms_telegram_principal_active`): every dispatcher pass and the nightly
   * purge, which runs even with `TELEGRAM_ENABLED` off, end the binding of a
   * deactivated or roleless person (cause `principal_deactivated`), erasing the
   * ciphertext. An erasure request ordinarily accompanies deactivation, so the
   * binding is ended by the next sweep; if the person is still active, an
   * administrator revokes it.
   */
  subjectData: [
    {
      key: "telegram_delivery.telegram_bindings",
      tableName: "awcms_telegram_bindings",
      ownerModuleKey: TELEGRAM_MODULE_KEY,
      subjectColumns: [
        { column: "principal_id", references: "tenant_user" },
        { column: "revoked_by", references: "tenant_user" }
      ],
      exportable: true,
      erasure: "anonymize",
      rationale:
        "The person's own Telegram chat binding: its state, when it was confirmed or revoked and why, and a masked reference to the chat. The ciphertext, the keyed hashes (chat and verification PIN) are never exported; on erasure they are overwritten with the erasure sentinel, so the stored chat id can no longer be decrypted (messages to it fail, nothing is sent) and a replayed link is inert.",
      redactedColumns: [
        "chat_ciphertext",
        "chat_hash",
        "hash_key_id",
        "pin_hash"
      ],
      anonymizedColumns: [
        "chat_ciphertext",
        "chat_hash",
        "chat_masked",
        "display_name",
        "username_masked",
        "pin_hash"
      ]
    },
    {
      key: "telegram_delivery.telegram_link_codes",
      tableName: "awcms_telegram_link_codes",
      ownerModuleKey: TELEGRAM_MODULE_KEY,
      subjectColumns: [{ column: "principal_id", references: "tenant_user" }],
      exportable: false,
      erasure: "hard_delete",
      rationale:
        "One-time link codes the person requested. Only the SHA-256 of a single-use secret is stored, which says nothing about the person that the binding row does not, so it is withheld from an export and removed on erasure.",
      redactedColumns: ["code_hash"]
    },
    {
      key: "telegram_delivery.telegram_messages",
      tableName: "awcms_telegram_messages",
      ownerModuleKey: TELEGRAM_MODULE_KEY,
      subjectColumns: [{ column: "principal_id", references: "tenant_user" }],
      exportable: true,
      erasure: "anonymize",
      rationale:
        "Operational notices addressed to this member of staff. A message is cleared at its terminal state already; on erasure the rendered text and variables of any row still waiting are overwritten too. The chat is reached only through the binding, so no chat id is ever in this table.",
      redactedColumns: ["idempotency_key", "body", "variables"],
      anonymizedColumns: ["body", "variables"]
    },
    {
      key: "telegram_delivery.telegram_delivery_attempts",
      tableName: "awcms_telegram_delivery_attempts",
      ownerModuleKey: TELEGRAM_MODULE_KEY,
      subjectColumns: [],
      unreachableBySubject: true,
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "Per-attempt provider outcomes hanging off a message row. No column names a person (the link is the message, which the descriptor above answers for), and the provider reply is redacted of the bot token and number runs before it is stored, as operational telemetry the module keeps for its own retention window.",
      redactedColumns: ["provider_response_snippet", "error_message"]
    },
    {
      key: "telegram_delivery.telegram_settings",
      tableName: "awcms_telegram_settings",
      ownerModuleKey: TELEGRAM_MODULE_KEY,
      subjectColumns: [{ column: "updated_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "One row per tenant holding the on/off switch. Its only link to a person is the `updated_by` stamp of the administrator who last changed it, which resolves to nobody once the identity is anonymised."
    }
  ],
  dataLifecycle: [
    purgedTable({
      key: TELEGRAM_MESSAGES_LIFECYCLE_KEY,
      tableName: "awcms_telegram_messages",
      cursorColumn: "updated_at",
      retentionMinDays: 1,
      retentionMaxDays: 90,
      defaultRetentionDays: 14,
      archiveWhy:
        "An operational notice has no value as a record: it points at a record that already exists elsewhere (via the correlation id) and was cleared of its text at its terminal state. Archiving the queue would keep a second copy for longer than the queue needs.",
      deletionWhy:
        "Only terminal rows (`sent`/`failed`/`cancelled`/`expired`) are eligible, measured from `updated_at` (the moment a row stopped moving), never age alone. A waiting message is pending work, not history.",
      indexColumns: ["tenant_id", "status", "updated_at"],
      indexPurpose:
        "awcms_telegram_messages_retention_idx (sql/216) — the purge's own path (WHERE tenant_id = ? AND status IN (terminal) AND updated_at < ?), separate from the dispatch index whose status values are the opposite set.",
      backupNotes:
        "Included in ordinary full-database backup/restore. Rows restored in `sending` are re-claimed once their lease has passed, the same path a worker crash takes; an already-sent row restored as `queued` can be sent twice, which the recorded Telegram message id lets reconciliation detect. Its binding reference restores with the binding row, whose ciphertext was erased if it was revoked.",
      adopterDescription:
        "Marks non-terminal messages past their expiry as expired (independently of the dispatcher), then deletes terminal messages older than the cutoff in bounded batches, skipping any that still have attempt rows so the foreign key holds. Skips the step when a legal hold covers telegram_delivery.messages."
    }),
    purgedTable({
      key: TELEGRAM_ATTEMPTS_LIFECYCLE_KEY,
      tableName: "awcms_telegram_delivery_attempts",
      cursorColumn: "created_at",
      retentionMinDays: 1,
      retentionMaxDays: 90,
      defaultRetentionDays: 14,
      archiveWhy:
        "A redacted provider reply is a debugging aid with a half-life of days; it never contains the body, the chat id or the token.",
      deletionWhy:
        "Append-only diagnostic rows with no status to transition and no identifying column to anonymize.",
      indexColumns: ["tenant_id", "created_at"],
      indexPurpose:
        "awcms_telegram_delivery_attempts_created_idx (sql/216) — the purge's cursor path.",
      backupNotes:
        "Included in ordinary full-database backup/restore. The unique (message_id, attempt_no) constraint means a restore cannot produce duplicate attempt records for a message that is re-dispatched afterwards.",
      adopterDescription:
        "Deletes attempt rows older than the cutoff in bounded batches, before the messages step so the foreign key ordering holds. Skips the step when a legal hold covers telegram_delivery.delivery_attempts."
    }),
    purgedTable({
      key: TELEGRAM_BINDINGS_LIFECYCLE_KEY,
      tableName: "awcms_telegram_bindings",
      cursorColumn: "updated_at",
      retentionMinDays: 7,
      retentionMaxDays: 365,
      defaultRetentionDays: 90,
      archiveWhy:
        "A revoked binding keeps only a keyed hash as a tombstone (so the same chat cannot be re-linked without a fresh handshake) and a masked reference; its ciphertext was erased at revocation. There is nothing worth archiving.",
      deletionWhy:
        "Only `revoked` and `suspended` bindings are eligible, 90 days after they ended, and only once no message row references them. A live binding (`active`, `pending_confirmation`) is never deleted by any job; it ends by revocation, which erases the chat id first.",
      indexColumns: ["tenant_id", "status", "updated_at"],
      indexPurpose:
        "awcms_telegram_bindings_retention_idx (sql/216) — the purge's path (WHERE tenant_id = ? AND status IN ('revoked','suspended') AND updated_at < ?).",
      backupNotes:
        "Included in ordinary full-database backup/restore. Restoring an old backup can revive a binding that was revoked afterwards, WITH its ciphertext: after a restore, revoke every Telegram binding (turn the tenant setting off and on) and have staff re-link before re-enabling TELEGRAM_ENABLED.",
      adopterDescription:
        "Deletes revoked and suspended bindings older than the cutoff that no message references, in bounded batches. Also ends pending bindings past their confirmation window (erasing the ciphertext), which is a state change and not gated. Skips the delete when a legal hold covers telegram_delivery.bindings."
    }),
    purgedTable({
      key: TELEGRAM_LINK_CODES_LIFECYCLE_KEY,
      tableName: "awcms_telegram_link_codes",
      cursorColumn: "expires_at",
      retentionMinDays: 1,
      retentionMaxDays: 30,
      defaultRetentionDays: 1,
      archiveWhy:
        "A spent or expired single-use code has no value after its window; only its SHA-256 was ever stored.",
      deletionWhy:
        "A code is dead the moment it is consumed, invalidated or expired. It is kept one day past expiry for support and then deleted.",
      indexColumns: ["tenant_id", "expires_at"],
      indexPurpose:
        "awcms_telegram_link_codes_retention_idx (sql/216) — the purge's cursor path.",
      backupNotes:
        "Included in ordinary full-database backup/restore. A restored unexpired code could be redeemed, but its binding still needs the staff member's confirmation in their own session.",
      adopterDescription:
        "Deletes link codes whose expiry is older than the cutoff in bounded batches. Skips the step when a legal hold covers telegram_delivery.link_codes."
    }),
    {
      key: TELEGRAM_SETTINGS_LIFECYCLE_KEY,
      tableName: "awcms_telegram_settings",
      ownerModuleKey: TELEGRAM_MODULE_KEY,
      scope: "tenant",
      cursorColumn: "updated_at",
      retentionClass: "system_event",
      retentionMinDays: 2555,
      retentionMaxDays: 3650,
      defaultRetentionDays: 3650,
      partition: {
        eligible: false,
        rationale:
          "At most one row per tenant, so it does not grow with traffic."
      },
      archive: {
        archivable: false,
        rationale:
          "The tenant's current on/off decision; the history of changes is in the audit log."
      },
      deletion: {
        mode: "hard_delete",
        rationale:
          "Not performed by any job. The switch lives as long as the tenant; a change is an audited administrator action."
      },
      legalHold: { applicable: false, precedence: "not_applicable" },
      requiredIndexes: [
        {
          columns: ["tenant_id"],
          purpose:
            "awcms_telegram_settings primary key (sql/216) — one row per tenant; nothing scans this table by age."
        }
      ],
      batchLimit: 5000,
      backupRestoreNotes:
        "Included in ordinary full-database backup/restore. Restoring an old backup can turn the switch back on; re-check it before re-enabling TELEGRAM_ENABLED.",
      executionMode: "delegated",
      existingAdopter: {
        purgeFunctionRef:
          "none — retained for the life of the tenant; see ADR-0140 section 9",
        description:
          "There is deliberately no purge mechanism; this descriptor exists so the table answers the retention question on the record rather than by silence."
      }
    }
  ]
});
