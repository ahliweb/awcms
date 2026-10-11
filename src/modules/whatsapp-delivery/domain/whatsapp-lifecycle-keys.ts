/**
 * Lifecycle descriptor keys, in a dependency-free file so the purge and
 * `module.ts` name the same strings without an import cycle (`module.ts` ->
 * purge -> `module.ts`). A legal hold checked against a key nobody registered
 * would return "not held" forever, and read exactly like "no hold in place".
 */
export const WHATSAPP_MESSAGES_LIFECYCLE_KEY = "whatsapp_delivery.messages";
export const WHATSAPP_ATTEMPTS_LIFECYCLE_KEY =
  "whatsapp_delivery.delivery_attempts";
export const WHATSAPP_CONSENTS_LIFECYCLE_KEY = "whatsapp_delivery.consents";
export const WHATSAPP_SUPPRESSIONS_LIFECYCLE_KEY =
  "whatsapp_delivery.suppressions";
