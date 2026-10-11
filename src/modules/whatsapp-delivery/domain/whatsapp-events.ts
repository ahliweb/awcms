/**
 * `whatsapp_delivery` domain-event constants (Issue #963, ADR-0133 section 8).
 * No imports, so the producer, the `domain_event_runtime` registry and the
 * AsyncAPI parity gate reference the same literals. Payloads carry ids, enums
 * and the MASKED recipient only — never a phone number, body or variable.
 */
export const WHATSAPP_EVENT_VERSION = "1.0";

export const WHATSAPP_MESSAGE_QUEUED_EVENT_TYPE =
  "awcms.whatsapp.message.queued";
export const WHATSAPP_MESSAGE_SENT_EVENT_TYPE = "awcms.whatsapp.message.sent";
export const WHATSAPP_MESSAGE_FAILED_EVENT_TYPE =
  "awcms.whatsapp.message.failed";
export const WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE =
  "awcms.whatsapp.message.expired";
export const WHATSAPP_CONSENT_GRANTED_EVENT_TYPE =
  "awcms.whatsapp.consent.granted";
export const WHATSAPP_CONSENT_WITHDRAWN_EVENT_TYPE =
  "awcms.whatsapp.consent.withdrawn";
export const WHATSAPP_DISPATCH_FAILED_EVENT_TYPE =
  "awcms.whatsapp.dispatch.failed";

export const WHATSAPP_MESSAGE_AGGREGATE_TYPE = "whatsapp_message";
export const WHATSAPP_CONSENT_AGGREGATE_TYPE = "whatsapp_consent";
export const WHATSAPP_DISPATCH_AGGREGATE_TYPE = "whatsapp_dispatch";

export const WHATSAPP_MODULE_KEY = "whatsapp_delivery";
