/**
 * Redacts email-address-shaped substrings from free text before it is
 * persisted (`email_delivery_attempts.provider_response_snippet`/
 * `error_message`, Issue #494/#495) or logged. Complements
 * `_shared/redaction.ts` (which redacts by *object key* name) — a
 * provider's raw response/error text has no keys, just prose that might
 * happen to echo a recipient address back (e.g. "Invalid recipient:
 * user@example.com"). Pure string replace, not a general PII scrubber.
 */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

export function redactEmailAddressesInText(text: string): string {
  return text.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");
}
