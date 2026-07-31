import type { AccessAction } from "./access-control";

/**
 * Pure rules for machine credentials (ADR-0049). No I/O — every function here
 * is a decision that must be testable without a database, because these are the
 * rules that stop a non-human caller from becoming a second, looser way in.
 */

/**
 * Actions a machine-authenticated request may perform AT ALL — checked before
 * any permission is looked up, and independent of what the service account was
 * granted (ADR-0049 §3).
 *
 * It holds exactly one value on purpose. A leaked build token must not be able
 * to change anything even if an operator pointed it at an `owner` account, and
 * "read" is the entire job of the build feed and the portal BFF. Widening this
 * set needs its own ADR: every addition is a new class of thing a stolen token
 * can do, and additions here are invisible in a diff of the endpoint that
 * suddenly accepts them.
 */
export const MACHINE_CREDENTIAL_ALLOWED_ACTIONS: ReadonlySet<AccessAction> =
  new Set<AccessAction>(["read"]);

export function isMachineCredentialAllowedAction(
  action: AccessAction
): boolean {
  return MACHINE_CREDENTIAL_ALLOWED_ACTIONS.has(action);
}

/** Maximum credential lifetime. No perpetual credential — ADR-0049 §5. */
export const MACHINE_CREDENTIAL_MAX_LIFETIME_DAYS = 365;

/** Permission key shape: `module_key.activity_code.action`. */
const PERMISSION_KEY_PATTERN =
  /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

const NAME_MAX_LENGTH = 120;
const ALLOWED_KEYS_MAX = 50;

export type MachineCredentialValidationError = {
  field: string;
  message: string;
};

export type IssueMachineCredentialInput = {
  name: string;
  tenantUserId: string;
  allowedPermissionKeys: string[];
  expiresAt: Date;
};

export type IssueMachineCredentialValidation =
  | { valid: true; value: IssueMachineCredentialInput }
  | { valid: false; errors: MachineCredentialValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates an issuance request. Collects EVERY problem rather than failing on
 * the first: an operator issuing a credential is filling in a form, and one
 * error at a time turns that into a guessing game.
 */
export function validateIssueMachineCredentialInput(
  body: unknown,
  now: Date
): IssueMachineCredentialValidation {
  const errors: MachineCredentialValidationError[] = [];

  if (typeof body !== "object" || body === null) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be a JSON object." }]
    };
  }

  const input = body as Record<string, unknown>;

  const rawName = typeof input.name === "string" ? input.name.trim() : "";
  if (rawName.length === 0) {
    errors.push({ field: "name", message: "Name is required." });
  } else if (rawName.length > NAME_MAX_LENGTH) {
    errors.push({
      field: "name",
      message: `Name must be at most ${NAME_MAX_LENGTH} characters.`
    });
  }

  const tenantUserId =
    typeof input.tenantUserId === "string" ? input.tenantUserId.trim() : "";
  if (!UUID_PATTERN.test(tenantUserId)) {
    errors.push({
      field: "tenantUserId",
      message: "tenantUserId must be a uuid of an existing tenant user."
    });
  }

  const rawKeys = input.allowedPermissionKeys;
  const allowedPermissionKeys: string[] = [];
  if (!Array.isArray(rawKeys) || rawKeys.length === 0) {
    // Fail-closed: an absent or empty list is NOT "unrestricted" (ADR-0049 §2).
    errors.push({
      field: "allowedPermissionKeys",
      message:
        "allowedPermissionKeys must be a non-empty array of permission keys."
    });
  } else if (rawKeys.length > ALLOWED_KEYS_MAX) {
    errors.push({
      field: "allowedPermissionKeys",
      message: `allowedPermissionKeys must contain at most ${ALLOWED_KEYS_MAX} keys.`
    });
  } else {
    for (const key of rawKeys) {
      if (typeof key !== "string" || !PERMISSION_KEY_PATTERN.test(key)) {
        errors.push({
          field: "allowedPermissionKeys",
          message: `Invalid permission key: ${typeof key === "string" ? key : typeof key}.`
        });
        continue;
      }
      if (!allowedPermissionKeys.includes(key)) allowedPermissionKeys.push(key);
    }
  }

  const expiresAtRaw = input.expiresAt;
  let expiresAt: Date | null = null;
  if (typeof expiresAtRaw !== "string") {
    errors.push({
      field: "expiresAt",
      message: "expiresAt must be an ISO-8601 timestamp string."
    });
  } else {
    const parsed = new Date(expiresAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      errors.push({
        field: "expiresAt",
        message: "expiresAt must be an ISO-8601 timestamp string."
      });
    } else if (parsed.getTime() <= now.getTime()) {
      errors.push({
        field: "expiresAt",
        message: "expiresAt must be in the future."
      });
    } else if (
      parsed.getTime() - now.getTime() >
      MACHINE_CREDENTIAL_MAX_LIFETIME_DAYS * 24 * 60 * 60 * 1000
    ) {
      errors.push({
        field: "expiresAt",
        message: `expiresAt must be at most ${MACHINE_CREDENTIAL_MAX_LIFETIME_DAYS} days away.`
      });
    } else {
      expiresAt = parsed;
    }
  }

  if (errors.length > 0 || expiresAt === null) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      name: rawName,
      tenantUserId,
      allowedPermissionKeys,
      expiresAt
    }
  };
}

/**
 * Effective permissions of a machine-authenticated request: the INTERSECTION of
 * what the service account holds and what the credential allows (ADR-0049 §2).
 *
 * Intersection, never union: granting the service account another role must not
 * widen a credential that was already issued, and a credential must never name
 * a permission into existence.
 */
export function narrowPermissionKeys(
  grantedPermissionKeys: ReadonlySet<string>,
  allowedPermissionKeys: readonly string[]
): Set<string> {
  const narrowed = new Set<string>();

  for (const key of allowedPermissionKeys) {
    if (grantedPermissionKeys.has(key)) narrowed.add(key);
  }

  return narrowed;
}
