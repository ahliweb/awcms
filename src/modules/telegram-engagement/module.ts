import { defineModule } from "../_shared/module-contract";
import type {
  HighVolumeTableDescriptor,
  SubjectDataDescriptor
} from "../_shared/module-contract";
import {
  BOTS_ACTIVITY_CODE,
  CONTACTS_ACTIVITY_CODE,
  MESSAGES_ACTIVITY_CODE,
  TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE,
  TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE,
  TELEGRAM_ENGAGEMENT_MODULE_KEY
} from "./domain/telegram-engagement-constants";

function stamps(input: {
  key: string;
  tableName: string;
  columns: string[];
  rationale: string;
}): SubjectDataDescriptor {
  return {
    key: `${TELEGRAM_ENGAGEMENT_MODULE_KEY}.${input.key}`,
    tableName: input.tableName,
    ownerModuleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    subjectColumns: input.columns.map((column) => ({
      column,
      references: "tenant_user" as const
    })),
    exportable: false,
    erasure: "severed_with_subject_row",
    rationale: input.rationale
  };
}

function purged(input: {
  key: string;
  tableName: string;
  cursorColumn: string;
  min: number;
  max: number;
  defaultDays: number;
  indexPurpose: string;
  why: string;
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    scope: "tenant",
    cursorColumn: input.cursorColumn,
    retentionClass: "communication_log",
    retentionMinDays: input.min,
    retentionMaxDays: input.max,
    // ADR-0152 O3: proposed defaults for the maintainer and the controller to
    // confirm; the tenant sets the final window within these bounds.
    defaultRetentionDays: input.defaultDays,
    partition: {
      eligible: false,
      rationale:
        "Bounded by a tenant's customer conversations through its own bots: thousands of rows a day at most. The purge removes aged rows through the (tenant, cursor) index; partitioning would add operational surface to a table that stays small."
    },
    archive: { archivable: false, rationale: input.why },
    deletion: {
      mode: "hard_delete",
      rationale:
        "Past the window the row has no further use: a receipt only guards against a Telegram retry (hours), and a message row's text is already cleared at its terminal state. Nothing references these rows except their own module."
    },
    legalHold: { applicable: true, precedence: "overrides_retention" },
    requiredIndexes: [
      {
        columns: ["tenant_id", input.cursorColumn],
        purpose: input.indexPurpose
      }
    ],
    batchLimit: 1000,
    backupRestoreNotes:
      "A restore without the TELEGRAM_ENGAGEMENT_KEYS ring keeps the rows but cannot decrypt a queued text or a chat id (fail closed). Back the ring up OUTSIDE the database. Run the retention purge after a restore so rows past their window are not resurrected.",
    executionMode: "generic"
  };
}

/**
 * Consent evidence and contacts are privacy decisions and proof: never purged
 * by age (ADR-0152 section 6.4: "consent evidence the longest", and an ended
 * contact is already erased in the statement that ends it). They answer the
 * retention question on the record rather than by silence.
 */
function retained(input: {
  key: string;
  tableName: string;
  cursorColumn: string;
  indexColumns: string[];
  indexPurpose: string;
  why: string;
}): HighVolumeTableDescriptor {
  return {
    key: input.key,
    tableName: input.tableName,
    ownerModuleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    scope: "tenant",
    cursorColumn: input.cursorColumn,
    retentionClass: "system_event",
    retentionMinDays: 2555,
    retentionMaxDays: 3650,
    defaultRetentionDays: 3650,
    partition: {
      eligible: false,
      rationale:
        "Bounded by the number of people who started a tenant's bots and the few consent facts each produces, not by traffic."
    },
    archive: { archivable: false, rationale: input.why },
    deletion: {
      mode: "hard_delete",
      rationale:
        "Not performed by any job. A contact is ENDED (its chat ciphertext, label and hash erased in one statement) through the audited erase route; consent evidence is the tenant's proof of what it was allowed to do and is kept for the proof horizon the controller decides (ADR-0152 O3)."
    },
    legalHold: { applicable: false, precedence: "not_applicable" },
    requiredIndexes: [
      { columns: input.indexColumns, purpose: input.indexPurpose }
    ],
    batchLimit: 1000,
    backupRestoreNotes:
      "Included in ordinary backups. Restoring an old backup can revive a consent that was withdrawn afterwards or an un-ended contact; the dispatch-time re-check reads the restored row, so after a restore re-apply withdrawals and erasures recorded in the audit log before re-enabling TELEGRAM_ENGAGEMENT_ENABLED.",
    executionMode: "delegated",
    existingAdopter: {
      purgeFunctionRef:
        "none — retained; ended through the audited erase route (ADR-0152 section 6.4)",
      description:
        "There is deliberately no age-based purge; this descriptor exists so the table answers the retention question on the record rather than by silence."
    }
  };
}

/**
 * `telegram_engagement` -- customer Telegram conversations through a tenant's
 * own bots (Issue #1156, ADR-0152; inbound envelope ADR-0150; accounts and
 * secrets ADR-0148 / #1140).
 *
 * ## Separate from `telegram_delivery`, by construction
 *
 * The staff-only module (ADR-0140) is untouched: this module imports nothing
 * from it, shares no table, queue, route, token or setting with it, and refuses
 * to register the staff bot (T-N1, T-A2).
 *
 * ## Status
 *
 * `experimental`: the operator screen is a follow-up, so the module declares no
 * `navigation` entry (a nav entry without a page is a permanent 404). The API is
 * complete and every admin route is default-deny. Off by default at the
 * deployment (`TELEGRAM_ENGAGEMENT_ENABLED`), module and tenant level (nothing
 * happens for a tenant until it registers a bot).
 */
export const telegramEngagementModule = defineModule({
  key: TELEGRAM_ENGAGEMENT_MODULE_KEY,
  name: "Telegram Engagement",
  version: "0.1.0",
  status: "experimental",
  description:
    "Customer Telegram conversations through a tenant's own bots (Issue #1156, ADR-0152). Many bots per tenant, each a `channel_accounts` account whose token is a channel secret; one verified webhook per bot (an opaque per-bot callback token naming the tenant and endpoint, proven against a stored hash, plus a constant-time `X-Telegram-Bot-Api-Secret-Token` check before the body is read, one generic refusal for every failure); idempotent ingestion keyed by (account, update_id); private chats only, no bot senders, forwarded or edited payloads never treated as identity. A contact exists only after the person sent `/start`, keyed by an account-scoped keyed hash with the chat id encrypted; `/start` grants support only, marketing and transactional need an explicit button opt-in with a notice version, and `/stop`, a block or a provider 403 withdraw at once (append-only evidence). Replies and opted-in notices go through the module's own durable queue and a pinned-Bun dispatcher (claim, send outside any transaction through `ssrfSafeFetch`, per-bot and per-chat pacing, `429 retry_after` without spending budget, per-bot breaker and daily ceiling, an uncertain send never blindly retried). Inbound is announced as a redacted envelope event (ids, kinds and privacy class; never a Telegram id, username or message text). The staff-only `telegram_delivery` module is unchanged and shares nothing with it.",
  dependencies: [
    "tenant_admin",
    "identity_access",
    "logging",
    "module_management",
    "domain_event_runtime",
    // A customer bot IS a channel account; its token IS a channel secret.
    "channel_accounts"
  ],
  type: "system",
  api: {
    openApiPath: "openapi/modules/telegram-engagement.openapi.yaml",
    basePath: "/api/v1/telegram-engagement"
  },
  events: {
    asyncApiPath: "asyncapi/awcms-domain-events.asyncapi.yaml",
    publishes: [
      TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE,
      TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE
    ]
  },
  permissions: [
    {
      activityCode: BOTS_ACTIVITY_CODE,
      action: "read",
      description:
        "Read this tenant's customer Telegram bots: webhook state, verified bot id and username, health and daily ceiling (never a token, a secret or a callback URL)"
    },
    {
      activityCode: BOTS_ACTIVITY_CODE,
      action: "configure",
      description:
        "Register a customer Telegram bot (an existing channel account) for verified webhooks, rotate its webhook secret and revoke it (high-risk, step-up, audited at warning)"
    },
    {
      activityCode: CONTACTS_ACTIVITY_CODE,
      action: "read",
      description:
        "Read the contacts who started a customer bot, with a masked label, their state and their per-purpose eligibility (never a Telegram user id, chat id, username or message)"
    },
    {
      activityCode: CONTACTS_ACTIVITY_CODE,
      action: "delete",
      description:
        "End a contact at the data subject's request or the controller's decision: erases the encrypted chat id and the masked label, withdraws every purpose and cancels queued messages; consent evidence is kept for its proof window (high-risk, audited at warning)"
    },
    {
      activityCode: MESSAGES_ACTIVITY_CODE,
      action: "create",
      description:
        "Queue a reply or an opted-in notice, or an explicit opt-in prompt, to a contact who started the bot and is eligible for the purpose (audited)"
    }
  ],
  jobs: [
    {
      command: "bun run telegram-engagement:dispatch",
      schedule: { mode: "cron", expression: "* * * * *", backlog: "bounded" },
      purpose:
        "For every active tenant: finish bot registrations, rotations and revocations with Telegram (getMe, setWebhook, deleteWebhook) and drain the customer outbound queue (claim lease, re-check consent and capability, per-bot and per-chat pacing, 429 retry_after, per-bot breaker and daily ceiling, uncertain sends never retried).",
      recommendedSchedule: "Every minute via cron/systemd timer.",
      environmentNotes:
        'No-op when TELEGRAM_ENGAGEMENT_ENABLED is not "true". Connects ONLY through TELEGRAM_ENGAGEMENT_DATABASE_URL as its own role awcms_telegram_engagement_dispatch (sql/353; NOLOGIN until the deployment activates it), with no fallback: without it the job exits 1 and does nothing. That role sees only live customer bot tokens and webhook seeds of the channel secrets (a RESTRICTIVE policy), never awcms_app\'s view of every secret. It decrypts them with CHANNEL_SECRETS_ENCRYPTION_KEYS and chat ids and texts with TELEGRAM_ENGAGEMENT_KEYS (see the module README). Requires outbound HTTPS to api.telegram.org and APP_URL as an https origin; on an offline/LAN deployment it stays a no-op.',
      safeInOfflineLan: true
    }
  ],
  dataLifecycle: [
    purged({
      key: "telegram_engagement.inbound",
      tableName: "awcms_telegram_engagement_inbound",
      cursorColumn: "received_at",
      min: 1,
      max: 90,
      defaultDays: 7,
      indexPurpose:
        "awcms_telegram_engagement_inbound_received_at_idx (sql/350) -- the (tenant, cursor) composite the generic purge filters and orders by.",
      why: "A receipt is a replay key and an audit anchor for a few days of Telegram retries (ADR-0150 section 2). It holds no body and no sender; keeping it longer proves nothing the consent evidence does not."
    }),
    purged({
      key: "telegram_engagement.messages",
      tableName: "awcms_telegram_engagement_messages",
      cursorColumn: "created_at",
      min: 7,
      max: 365,
      defaultDays: 30,
      indexPurpose:
        "awcms_telegram_engagement_messages_created_at_idx (sql/350) -- the (tenant, cursor) composite the generic purge filters and orders by.",
      why: "An outbound row's text is cleared at its terminal state; what is left is a delivery status the conversation authority downstream keeps if it needs it. Archiving would only keep a person's delivery history beyond the window."
    }),
    retained({
      key: "telegram_engagement.endpoints",
      tableName: "awcms_telegram_engagement_endpoints",
      cursorColumn: "created_at",
      indexColumns: ["tenant_id", "account_id", "created_at"],
      indexPurpose:
        "awcms_telegram_engagement_endpoints_account_idx (sql/350) -- the per-bot history a delegated sweep would walk.",
      why: "One webhook row per customer bot, authored by an administrator (register, rotate, revoke), never accumulated by traffic: the ceiling is bots times deliberate rotations. It holds no customer data, and its seed is a channel secret hard-deleted with the revocation."
    }),
    retained({
      key: "telegram_engagement.contacts",
      tableName: "awcms_telegram_engagement_contacts",
      cursorColumn: "started_at",
      indexColumns: ["tenant_id", "account_id", "started_at"],
      indexPurpose:
        "awcms_telegram_engagement_contacts_list_idx (sql/350) -- the admin list and any future delegated sweep.",
      why: "A contact row is the anchor of the consent evidence and is erased in place (not archived) when it ends."
    }),
    retained({
      key: "telegram_engagement.consents",
      tableName: "awcms_telegram_engagement_consents",
      cursorColumn: "recorded_at",
      indexColumns: ["tenant_id", "recorded_at"],
      indexPurpose:
        "awcms_telegram_engagement_consents_recorded_at_idx (sql/350) -- the (tenant, cursor) composite a delegated sweep would walk.",
      why: "Consent evidence is the tenant's proof of what it was allowed to send; it carries no message text, and archiving it elsewhere would only duplicate a privacy record."
    })
  ],
  subjectData: [
    stamps({
      key: "endpoints",
      tableName: "awcms_telegram_engagement_endpoints",
      columns: ["created_by", "revoked_by"],
      rationale:
        "One verified webhook per customer bot. The row describes a bot, not a person; its only person-shaped columns are the stamps of the administrators who registered or revoked it. The secret is a reference and is never exported."
    }),
    {
      key: `${TELEGRAM_ENGAGEMENT_MODULE_KEY}.contacts`,
      tableName: "awcms_telegram_engagement_contacts",
      ownerModuleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
      // A Telegram customer has no account, session or tenant membership here,
      // so there is no `tenant_user_id` to reach them by (ADR-0094 scopes a
      // subject request to a MEMBER). The controller answers a customer's
      // request per tenant and per account through the erase route.
      unreachableBySubject: true,
      subjectColumns: [],
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "A person who started one of the tenant's bots: an account-scoped keyed hash, the chat id as an envelope and a masked label. 'retain_under_obligation' here means 'until the controller ends the contact': the registry cannot find a customer by tenant user, so the controller answers the request through POST contacts/{id}/erase, which erases the ciphertext, the label and the hash in one statement.",
      redactedColumns: ["contact_hash", "chat_ciphertext", "masked_label"]
    },
    {
      key: `${TELEGRAM_ENGAGEMENT_MODULE_KEY}.consents`,
      tableName: "awcms_telegram_engagement_consents",
      ownerModuleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
      subjectColumns: [{ column: "recorded_by", references: "tenant_user" }],
      exportable: false,
      erasure: "severed_with_subject_row",
      rationale:
        "Append-only consent evidence about a CUSTOMER contact (purpose, action, method, notice version, update id): no message text. The only tenant-member column is the stamp of an operator who recorded a withdrawal, which resolves to nobody once that identity is anonymised."
    },
    {
      key: `${TELEGRAM_ENGAGEMENT_MODULE_KEY}.inbound`,
      tableName: "awcms_telegram_engagement_inbound",
      ownerModuleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
      subjectColumns: [],
      unreachableBySubject: true,
      exportable: false,
      erasure: "retain_under_obligation",
      rationale:
        "The receipt ledger: a per-bot update id, a closed kind and outcome, a payload hash and an opaque contact reference. No body, no sender id, no text; removed by retention within days."
    },
    stamps({
      key: "messages",
      tableName: "awcms_telegram_engagement_messages",
      columns: ["created_by"],
      rationale:
        "An outbound reply or notice to a customer contact; the text is an envelope cleared at the terminal state and the row is purged by retention. The only tenant-member column is the stamp of the operator who queued it."
    })
  ]
});
