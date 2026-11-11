/**
 * Closed vocabularies and fixed names for `telegram_engagement` (Issue #1156,
 * ADR-0152). Every list is closed on purpose and mirrored by a CHECK constraint
 * in `sql/350`, so the database refuses what the validator should already have.
 *
 * Nothing here is shared with `telegram_delivery` (ADR-0152 TG1): this module
 * imports nothing from it, reads none of its tables and none of its settings.
 *
 * Pure module: no database, no I/O.
 */

export const TELEGRAM_ENGAGEMENT_MODULE_KEY = "telegram_engagement";

export const BOTS_ACTIVITY_CODE = "bots";
export const CONTACTS_ACTIVITY_CODE = "contacts";
export const MESSAGES_ACTIVITY_CODE = "messages";

export const TELEGRAM_ENGAGEMENT_GUARDS = {
  readBots: {
    moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    activityCode: BOTS_ACTIVITY_CODE,
    action: "read" as const
  },
  configureBots: {
    moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    activityCode: BOTS_ACTIVITY_CODE,
    action: "configure" as const
  },
  readContacts: {
    moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    activityCode: CONTACTS_ACTIVITY_CODE,
    action: "read" as const
  },
  deleteContacts: {
    moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    activityCode: CONTACTS_ACTIVITY_CODE,
    action: "delete" as const
  },
  createMessages: {
    moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
    activityCode: MESSAGES_ACTIVITY_CODE,
    action: "create" as const
  }
} as const;

/** The channel-account shape a customer bot must have (provider matrix row `telegram`, kind `bot`). */
export const TELEGRAM_PROVIDER = "telegram";
export const TELEGRAM_BOT_KIND = "bot";

/**
 * `/start` is SUPPORT only; `transactional` and `marketing` need the explicit
 * opt-in button (ADR-0152 TG7). `staff_ops` is deliberately absent: it lives in
 * `telegram_delivery` and nowhere else.
 */
export const PURPOSES = ["support", "transactional", "marketing"] as const;
export type Purpose = (typeof PURPOSES)[number];

/** The purposes an explicit opt-in prompt may ask for. */
export const PROMPTABLE_PURPOSES = ["transactional", "marketing"] as const;
export type PromptablePurpose = (typeof PROMPTABLE_PURPOSES)[number];

export const CONTACT_STATES = [
  "started",
  "stopped",
  "blocked",
  "ended"
] as const;
export type ContactState = (typeof CONTACT_STATES)[number];

export const CONSENT_METHODS = [
  "start_command",
  "stop_command",
  "consent_button",
  "withdraw_button",
  "bot_blocked",
  "provider_forbidden",
  "operator_withdrawal"
] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const ENDPOINT_STATES = [
  "pending",
  "active",
  "failed",
  "revoked"
] as const;
export type EndpointState = (typeof ENDPOINT_STATES)[number];

export const MESSAGE_STATUSES = [
  "queued",
  "sending",
  "sent",
  "uncertain",
  "failed",
  "cancelled"
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** ADR-0152 section 6, the AI-safe classification every event and read model carries. */
export const PRIVACY_CLASSES = [
  "operational",
  "consent",
  "conversation_meta",
  "customer_content"
] as const;
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

/**
 * The minimal `allowed_updates` (ADR-0152 section 4): private messages (and the
 * two commands), `my_chat_member` for block/unblock, `callback_query` for the
 * consent buttons. No update type is enabled "in case".
 */
export const ALLOWED_UPDATES = [
  "message",
  "my_chat_member",
  "callback_query"
] as const;

/** Rejections at the webhook, named so the audit redactor never blanks them. */
export type WebhookRejectionReason =
  | "token_malformed"
  | "endpoint_unknown"
  | "header_mismatch"
  | "header_absent"
  | "rate_limited"
  | "too_large"
  | "malformed";

/** Bounds of the outbound text and the opt-in notice, in characters. */
export const MAX_TEXT_LENGTH = 4000;
export const MAX_NOTICE_LENGTH = 1500;
/** A queued row that cannot be sent within this window expires (never sent late). */
export const MESSAGE_TTL_HOURS = 24;
/** The deployment-wide ceiling a tenant's per-bot daily ceiling can never exceed (ADR-0152 O10). */
export const DEFAULT_DEPLOYMENT_DAILY_CAP = 5000;
export const DEFAULT_BOT_DAILY_CEILING = 500;
export const MAX_DISPATCH_ATTEMPTS = 5;
/** Telegram's documented per-bot pacing, kept below the ~30/s global ceiling (to verify). */
export const PER_BOT_MIN_INTERVAL_MS = 40;
/** About one message a second per chat (to verify). */
export const PER_CHAT_MIN_INTERVAL_MS = 1000;
export const BREAKER_THRESHOLD = 5;
export const BREAKER_OPEN_SECONDS = 300;

export const CONTACT_HASH_PURPOSE = "telegram_engagement:contact:v1";
export const CHAT_AAD_PURPOSE = "telegram_engagement:chat:v1";
export const TEXT_AAD_PURPOSE = "telegram_engagement:text:v1";

/** Event names (AsyncAPI). Kept identical to the registry literals by tests. */
export const TELEGRAM_ENGAGEMENT_EVENT_VERSION = "1.0";
export const TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE =
  "awcms.telegram_engagement.interaction.received";
export const TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE =
  "awcms.telegram_engagement.consent.changed";
export const TELEGRAM_ENGAGEMENT_CONTACT_AGGREGATE_TYPE =
  "telegram_engagement_contact";
