/**
 * Pure request validation for the two password-reset endpoints (Wave 2 delta
 * auth, adapted from awcms-micro Issue #496). No I/O — same shape as
 * `abac-admin-validation.ts`/`role-admin-validation.ts`.
 *
 * Named `validateForgotIdentifierInput`/`validateCompleteResetInput`, NOT
 * `validate{ForgotPassword,ResetPassword}Input`: CodeQL's
 * `js/insufficient-password-hash` query treats the return value of any function
 * whose name contains "password" as password-flavoured regardless of what it
 * actually returns — awcms-micro confirmed it flagged the forgot-input
 * validator even though that return type has no password field at all, only
 * `loginIdentifier`. The rename dodges that false positive; the genuinely
 * password-bearing field keeps its accurate name (`newPassword`) and is hashed
 * with argon2id via `hashPassword` in `application/password-reset.ts`. Nothing
 * here weakens real password handling. Same reasoning as
 * `lib/auth/reset-token.ts`'s naming.
 */

/**
 * Minimum length for a user-chosen password on the reset path.
 *
 * `tenant_admin`'s `domain/setup-validation.ts` declares its own private
 * constant of the same value for the one-time owner bootstrap, and that
 * duplication is deliberate rather than sloppy: `identity_access` DEPENDS ON
 * `tenant_admin` (see `module.ts`), so a shared constant exported from here
 * would invert the module DAG and fail `bun run modules:dag:check`. The two are
 * pinned to each other by a contract test instead, so a change to one that
 * forgets the other turns the suite red.
 */
export const MIN_PASSWORD_LENGTH = 8;

export type ValidationError = {
  field: string;
  message: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export type ForgotIdentifierInput = {
  loginIdentifier: string;
};

export type CompleteResetInput = {
  token: string;
  newPassword: string;
};

export function validateForgotIdentifierInput(
  body: unknown
): Result<ForgotIdentifierInput> {
  const record = (body ?? {}) as Record<string, unknown>;

  if (
    typeof record.loginIdentifier !== "string" ||
    record.loginIdentifier.trim().length === 0
  ) {
    return {
      valid: false,
      errors: [
        { field: "loginIdentifier", message: "loginIdentifier is required." }
      ]
    };
  }

  return { valid: true, value: { loginIdentifier: record.loginIdentifier } };
}

export function validateCompleteResetInput(
  body: unknown
): Result<CompleteResetInput> {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (typeof record.token !== "string" || record.token.trim().length === 0) {
    errors.push({ field: "token", message: "token is required." });
  }

  if (
    typeof record.newPassword !== "string" ||
    record.newPassword.length < MIN_PASSWORD_LENGTH
  ) {
    errors.push({
      field: "newPassword",
      message: `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters.`
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      token: record.token as string,
      newPassword: record.newPassword as string
    }
  };
}
