/**
 * Pure validation for `POST /api/v1/email/suppressions` (Issue #499). Same
 * shape/style as `announcement-validation.ts` — no I/O here; the identifier
 * is normalized/hashed in the application layer
 * (`../application/suppression-directory.ts`), reusing
 * `profile-identity/domain/identifier.ts` exactly as the announcement/
 * password-reset flows already do.
 */
export type ValidationError = {
  field: string;
  message: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export type SuppressionReason =
  "bounced" | "complained" | "manual" | "unsubscribed";

export type SuppressionInput = {
  recipient: string;
  reason: SuppressionReason;
};

const KNOWN_REASONS: ReadonlySet<string> = new Set([
  "bounced",
  "complained",
  "manual",
  "unsubscribed"
]);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSuppressionInput(
  body: unknown
): Result<SuppressionInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  let recipient: string | undefined;
  if (
    typeof record.recipient !== "string" ||
    !EMAIL_PATTERN.test(record.recipient.trim())
  ) {
    errors.push({
      field: "recipient",
      message: "recipient must be a valid email address."
    });
  } else {
    recipient = record.recipient.trim();
  }

  let reason: SuppressionReason | undefined;
  if (typeof record.reason !== "string" || !KNOWN_REASONS.has(record.reason)) {
    errors.push({
      field: "reason",
      message:
        'reason must be one of "bounced", "complained", "manual", "unsubscribed".'
    });
  } else {
    reason = record.reason as SuppressionReason;
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: { recipient: recipient!, reason: reason! } };
}
