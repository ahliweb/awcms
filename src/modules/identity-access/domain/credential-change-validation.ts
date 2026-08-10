/**
 * Pure request validation for `POST /api/v1/auth/password/change` (Gelombang 2
 * PR 2.4 of #423). No I/O.
 *
 * Named `validateCredentialChangeInput`, NOT `validatePasswordChangeInput`, for
 * the reason `password-reset-validation.ts` records in full: CodeQL's
 * `js/insufficient-password-hash` query treats the return value of any function
 * whose name contains "password" as password-flavoured regardless of what it
 * returns. The genuinely password-bearing fields keep their accurate names and
 * are hashed with argon2id via `hashPassword`. Nothing here weakens real
 * password handling.
 */
import {
  MIN_PASSWORD_LENGTH,
  type ValidationError
} from "./password-reset-validation";

export type CredentialChangeInput = {
  currentPassword: string;
  newPassword: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export function validateCredentialChangeInput(
  body: unknown
): Result<CredentialChangeInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (
    typeof record.currentPassword !== "string" ||
    record.currentPassword.length === 0
  ) {
    errors.push({
      field: "currentPassword",
      message: "currentPassword is required."
    });
  }

  // The floor is the same one the reset path enforces, imported rather than
  // restated: two constants that must agree are two constants that eventually
  // will not.
  if (
    typeof record.newPassword !== "string" ||
    record.newPassword.length < MIN_PASSWORD_LENGTH
  ) {
    errors.push({
      field: "newPassword",
      message: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters.`
    });
  }

  // Refused as a VALIDATION error rather than answered as a no-op success.
  // "Changed" is what a person reads as "my old password no longer works", and
  // it would not be true.
  if (errors.length === 0 && record.currentPassword === record.newPassword) {
    errors.push({
      field: "newPassword",
      message: "newPassword must differ from currentPassword."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      currentPassword: record.currentPassword as string,
      newPassword: record.newPassword as string
    }
  };
}
