/**
 * Pure validation for the public self-registration endpoint (Wave 2 delta
 * auth). No I/O — existence and anti-enumeration handling happen in the
 * application layer against the database.
 *
 * ## It accepts NO privilege field, and no password
 *
 * No `roleIds`, no `status`, no `tenantUserId`: a public caller must never be
 * able to choose its own permissions, and an extra key in the body is simply
 * ignored rather than trusted. There is no password either — approval creates
 * the account with an unusable credential and sends a password-reset link, so
 * an anonymous submitter never supplies a secret this system has to store. See
 * `sql/074`'s header for why that is a deliberate departure from awcms-micro.
 *
 * ## The identifier must be mailable
 *
 * Enforced here rather than only at approval time, because the whole flow
 * depends on reaching the applicant by email: an approval that cannot deliver
 * a password-reset link produces an account nobody can ever sign into. Reuses
 * `isMailableLoginIdentifier` — the same predicate the password-reset request
 * path uses — so the two cannot drift into disagreeing about what an address is.
 */
import { isMailableLoginIdentifier } from "./password-reset-policy";

export type ValidationError = {
  field: string;
  message: string;
};

export type RegistrationInput = {
  loginIdentifier: string;
  displayName: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export const MAX_DISPLAY_NAME_LENGTH = 120;
/** RFC 5321's practical ceiling for an address, and the bound on what a public caller can make this row hold. */
export const MAX_IDENTIFIER_LENGTH = 320;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateRegistrationInput(
  body: unknown
): Result<RegistrationInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(record.displayName)) {
    errors.push({ field: "displayName", message: "displayName is required." });
  } else if (record.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH) {
    errors.push({
      field: "displayName",
      message: `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`
    });
  }

  if (!isNonEmptyString(record.loginIdentifier)) {
    errors.push({
      field: "loginIdentifier",
      message: "loginIdentifier is required."
    });
  } else if (record.loginIdentifier.trim().length > MAX_IDENTIFIER_LENGTH) {
    errors.push({
      field: "loginIdentifier",
      message: `loginIdentifier must be at most ${MAX_IDENTIFIER_LENGTH} characters.`
    });
  } else if (!isMailableLoginIdentifier(record.loginIdentifier)) {
    errors.push({
      field: "loginIdentifier",
      message: "loginIdentifier must be an email address."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      loginIdentifier: (record.loginIdentifier as string).trim(),
      displayName: (record.displayName as string).trim()
    }
  };
}
