/**
 * Pure invitation validity evaluation and input validation (Gelombang 4 of
 * Issue #423, ADR-0082). No I/O — the application layer does the fetching, and
 * anti-enumeration handling lives with the routes.
 *
 * Same "pure decision, the caller does the fetching" shape as
 * `password-reset-policy.ts`'s `evaluatePasswordResetToken`, and the check
 * order is deliberate for the same reason: a token that was revoked and has
 * since aged out reports the reason that actually describes it. Only the audit
 * log ever sees these reasons — both public endpoints collapse every one of
 * them into a single `404`, so no unauthenticated caller can use them to
 * fingerprint an invitation's state.
 *
 * ## The identifier is trimmed and NEVER lowercased
 *
 * `awcms_identities.login_identifier` is compared with exact equality on every
 * path in this repository — login, the registration duplicate check, the
 * password-reset request, SSO linking — and `validateRegistrationInput` stores
 * `.trim()` only. `Foo@x.com` and `foo@x.com` are therefore two distinct
 * accounts under `awcms_identities_tenant_login_key`.
 *
 * An invitation flow that lowercased would collide-or-miss differently from
 * every path that already exists: it would resolve to a different row than the
 * one login will look up, so the invitee could accept an invitation and then be
 * unable to sign in with the address they accepted it at. Repo-wide
 * normalization is a change worth making, but it is its own ADR and it is not
 * this one. `tests/invitation-domain.test.ts` pins the current behaviour so
 * that changing it has to be deliberate.
 */
import { isMailableLoginIdentifier } from "./password-reset-policy";

export type ValidationError = {
  field: string;
  message: string;
};

type Result<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

export const MAX_DISPLAY_NAME_LENGTH = 120;
/** RFC 5321's practical ceiling for an address — the same bound `self-registration-validation.ts` uses. */
export const MAX_IDENTIFIER_LENGTH = 320;
/** Mirrors `awcms_invitations_resend_count_check`. The database owns the limit; this is the friendly error. */
export const INVITATION_MAX_RESEND_COUNT = 5;
/** An invitation may carry roles, but not an unbounded list of them. */
export const MAX_INVITATION_ROLE_COUNT = 20;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CreateInvitationInput = {
  loginIdentifier: string;
  displayName: string;
  roleIds: string[];
  skipEmailConfirmation: boolean;
};

export type AcceptInvitationInput = {
  password: string;
  displayName?: string;
};

export type InvitationSnapshot = {
  status: string;
  expiresAt: Date;
};

export type InvitationDenyReason =
  "not_found" | "revoked" | "already_accepted" | "expired";

export type InvitationEvaluation =
  { outcome: "valid" } | { outcome: "invalid"; reason: InvitationDenyReason };

/**
 * Whether an invitation token may still be previewed or redeemed.
 *
 * Order: absent, then revoked, then accepted, then expired. Revocation is
 * decided first because it is the only one an administrator performed
 * deliberately — an audit trail that reported "expired" for a link somebody
 * killed on purpose would describe the clock instead of the decision.
 */
export function evaluateInvitation(
  row: InvitationSnapshot | null,
  now: Date
): InvitationEvaluation {
  if (!row) {
    return { outcome: "invalid", reason: "not_found" };
  }

  if (row.status === "revoked") {
    return { outcome: "invalid", reason: "revoked" };
  }

  if (row.status === "accepted") {
    return { outcome: "invalid", reason: "already_accepted" };
  }

  // `<=`, not `<`: an invitation whose expiry instant is exactly now is spent.
  // Checked against the column rather than the `expired` status value, because
  // nothing sweeps that status — the row ages out before any job notices, and
  // the column is what makes the answer true at read time.
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { outcome: "invalid", reason: "expired" };
  }

  if (row.status !== "pending") {
    return { outcome: "invalid", reason: "not_found" };
  }

  return { outcome: "valid" };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateCreateInvitationInput(
  body: unknown
): Result<CreateInvitationInput> {
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

  // Absent means "no roles", which is a real and useful invitation: it admits
  // the person and leaves what they may do to a later, separately audited
  // decision. It is NOT the same as an empty array, and both are accepted.
  let roleIds: string[] = [];
  if (record.roleIds !== undefined && record.roleIds !== null) {
    if (!Array.isArray(record.roleIds)) {
      errors.push({ field: "roleIds", message: "roleIds must be an array." });
    } else if (record.roleIds.length > MAX_INVITATION_ROLE_COUNT) {
      errors.push({
        field: "roleIds",
        message: `roleIds must contain at most ${MAX_INVITATION_ROLE_COUNT} entries.`
      });
    } else if (
      record.roleIds.some(
        (value) => typeof value !== "string" || !UUID_PATTERN.test(value)
      )
    ) {
      errors.push({
        field: "roleIds",
        message: "roleIds must contain UUIDs."
      });
    } else {
      roleIds = [...new Set(record.roleIds as string[])];
    }
  }

  // Only the literal `true` opts in. Coercing a truthy value here would let a
  // caller reach a PLATFORM-gated behaviour with `"false"`, `1`, or `{}`.
  if (
    record.skipEmailConfirmation !== undefined &&
    typeof record.skipEmailConfirmation !== "boolean"
  ) {
    errors.push({
      field: "skipEmailConfirmation",
      message: "skipEmailConfirmation must be a boolean."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      loginIdentifier: (record.loginIdentifier as string).trim(),
      displayName: (record.displayName as string).trim(),
      roleIds,
      skipEmailConfirmation: record.skipEmailConfirmation === true
    }
  };
}

/**
 * The body an invitee sends when accepting.
 *
 * `roleIds` and every other privilege field are absent from the type on
 * purpose, exactly as they are for self-registration: what the invitee may hold
 * was decided by the administrator who sent the invitation, and is read from
 * `awcms_invitation_policies` — never from this body.
 *
 * Password strength is deliberately NOT re-derived here. It is
 * `validateCredentialChangeInput`'s rule, and the acceptance path reuses that
 * so the two cannot drift into demanding different passwords for the same
 * account.
 */
export function validateAcceptInvitationInput(
  body: unknown,
  passwordCheck: (password: string) => ValidationError | null
): Result<AcceptInvitationInput> {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  if (!isNonEmptyString(record.password)) {
    errors.push({ field: "password", message: "password is required." });
  } else {
    const failure = passwordCheck(record.password);
    if (failure) {
      errors.push(failure);
    }
  }

  if (record.displayName !== undefined && record.displayName !== null) {
    if (!isNonEmptyString(record.displayName)) {
      errors.push({
        field: "displayName",
        message: "displayName must be a non-empty string when provided."
      });
    } else if (record.displayName.trim().length > MAX_DISPLAY_NAME_LENGTH) {
      errors.push({
        field: "displayName",
        message: `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const displayName = isNonEmptyString(record.displayName)
    ? (record.displayName as string).trim()
    : undefined;

  return {
    valid: true,
    value: {
      password: record.password as string,
      ...(displayName === undefined ? {} : { displayName })
    }
  };
}
