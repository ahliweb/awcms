/**
 * `telegram_delivery` constants (Issue #965, ADR-0140). No imports, so the
 * module descriptor, the purge and the gates name the same literals without an
 * import cycle (`module.ts` -> purge -> `module.ts`). A legal hold checked
 * against a key nobody registered would return "not held" forever, and read
 * exactly like "no hold in place".
 *
 * This module publishes NO domain events (ADR-0140 section 9 left it to this
 * issue; decided: none, see the module README). The queue row is the ledger for
 * a message, the binding row for a chat, and the audit log for every decision.
 */
export const TELEGRAM_MODULE_KEY = "telegram_delivery";

export const TELEGRAM_MESSAGES_LIFECYCLE_KEY = "telegram_delivery.messages";
export const TELEGRAM_ATTEMPTS_LIFECYCLE_KEY =
  "telegram_delivery.delivery_attempts";
export const TELEGRAM_BINDINGS_LIFECYCLE_KEY = "telegram_delivery.bindings";
export const TELEGRAM_LINK_CODES_LIFECYCLE_KEY = "telegram_delivery.link_codes";
export const TELEGRAM_SETTINGS_LIFECYCLE_KEY = "telegram_delivery.settings";

/** The only purpose class this adapter carries (ADR-0140 section 1). */
export const TELEGRAM_PURPOSE = "staff_ops" as const;
export type TelegramPurpose = typeof TELEGRAM_PURPOSE;

/** Why a binding stopped being live. Mirrors the CHECK on `revoke_cause` (`sql/216`). */
export const TELEGRAM_REVOKE_CAUSES = [
  "self_admin",
  "self_stop",
  "admin",
  "principal_deactivated",
  "module_disabled",
  "tenant_disabled",
  "tenant_suspended",
  "provider_blocked",
  "rejected",
  "confirmation_expired",
  "rebound",
  "superseded",
  "erasure"
] as const;

export type TelegramRevokeCause = (typeof TELEGRAM_REVOKE_CAUSES)[number];

export const TELEGRAM_BINDING_STATUSES = [
  "pending_confirmation",
  "active",
  "revoked",
  "suspended"
] as const;

export type TelegramBindingStatus = (typeof TELEGRAM_BINDING_STATUSES)[number];

export const TELEGRAM_MESSAGE_STATUSES = [
  "queued",
  "retry_wait",
  "sending",
  "sent",
  "failed",
  "cancelled",
  "expired"
] as const;

export type TelegramMessageStatus = (typeof TELEGRAM_MESSAGE_STATUSES)[number];

/** The AAD purpose of `chat_ciphertext` (ADR-0140 section 6): `telegram_chat:v1`. */
export const TELEGRAM_CHAT_ENCRYPTION_PURPOSE = "telegram_chat:v1";

/** The hash domain of `chat_hash` (ADR-0137 section 3): `telegram:chat`. */
export const TELEGRAM_CHAT_HASH_PURPOSE = "telegram:chat";

/** The hash domain of `pin_hash` (Issue #1008): `telegram:pin`, separate from `telegram:chat` so one value never hashes alike under both. */
export const TELEGRAM_PIN_HASH_PURPOSE = "telegram:pin";

/** The key the adapter FEEDS and the dispatcher READS. One constant so the two cannot drift. */
export const TELEGRAM_CIRCUIT_BREAKER_KEY = "telegram-delivery";

/** The only host this adapter ever calls. Not configurable. */
export const TELEGRAM_API_HOST = "api.telegram.org";
export const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
