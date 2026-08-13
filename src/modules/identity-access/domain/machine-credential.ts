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

/**
 * The WRITE class (ADR-0092, Gelombang 8 PR 8.5) — actions a machine credential
 * may perform beyond `read`, **if and only if** its own column names them too.
 *
 *     effective = MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS ∩ allowed_write_actions
 *
 * The order matters and it is the whole design. If the action list were a
 * COLUMN alone, one restored backup, one hand-written INSERT, or one
 * provisioning path that lost its `WHERE` could mint a credential that writes
 * the entire catalogue — with every gate in this repo green, because no gate
 * reads row contents. The ceiling therefore lives somewhere that only changes
 * through a reviewed commit.
 *
 * ## What is in it, and the rule that keeps it honest
 *
 * `create` and `update`. Nothing that destroys, nothing that confers authority,
 * nothing irreversible — the property is checked mechanically rather than
 * asserted: `tests/machine-credential-write-class.test.ts` computes
 * `WRITE_ALLOWED ∩ HIGH_RISK_ACTIONS` from the LIVE constants and requires it
 * empty. A literal list of "the high-risk ones" would drift the moment a new
 * high-risk action is added; deriving it cannot.
 *
 * Adding a member here is an ADR, for the same reason ADR-0049 said it about
 * the read set: each addition is a new class of thing a stolen token can do,
 * and it is invisible in the diff of the endpoint that suddenly accepts it.
 */
export const MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS: ReadonlySet<AccessAction> =
  new Set<AccessAction>(["create", "update"]);

/**
 * Maximum lifetime of a credential that can WRITE — ADR-0092.
 *
 * A read credential may live a year (ADR-0049 §5). A write credential may not:
 * it can change data, and the time until somebody notices it has leaked is
 * measured in weeks. `sql/121` enforces 31 days, one day looser, because
 * `created_at` DEFAULT `now()` is the TRANSACTION START while `expires_at` is
 * computed from the application clock — the same trap `sql/117` documents.
 */
export const MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS = 30;

/**
 * Deny-only. `true` means REFUSE — it never permits anything.
 *
 * Three refusals in one function, in the order that matters:
 *
 *   1. the action is not `read` and not in the CODE ceiling → refuse;
 *   2. the credential's own column does not name it → refuse;
 *   3. the credential can write but the caller's IP is unknown → refuse.
 *
 * The third is the one that would be easiest to leave out and hardest to
 * notice. A route that has not been taught to pass `clientIp` would silently
 * turn the IP condition off for every credential it serves — a control that
 * READS as enforced and is not. Failing closed makes such a route return 403
 * instead, which is a bug report rather than a breach.
 */
export function isMachineCredentialWriteRefused(input: {
  action: AccessAction;
  allowedWriteActions: readonly string[];
  allowedIpCidrs: readonly string[];
  clientIp: string | undefined;
}): boolean {
  if (isMachineCredentialAllowedAction(input.action)) return false;

  if (!MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS.has(input.action)) return true;
  if (!input.allowedWriteActions.includes(input.action)) return true;

  // A write-capable credential always carries CIDRs (`sql/121` CHECK), so an
  // empty list here means the row predates the class — and a credential that
  // cannot be IP-bound cannot write.
  if (input.allowedIpCidrs.length === 0) return true;
  if (!input.clientIp) return true;

  return !isIpInAnyCidr(input.clientIp, input.allowedIpCidrs);
}

/**
 * IPv4/IPv6 membership, exact-match or CIDR, with no dependency.
 *
 * Unparseable input is NOT a match. That direction is deliberate: a malformed
 * CIDR in a credential row must narrow to nothing rather than widen to
 * everything, and a client address the parser cannot read is an address that
 * cannot be shown to be inside the allow-list.
 */
export function isIpInAnyCidr(ip: string, cidrs: readonly string[]): boolean {
  const address = parseIpBytes(ip);
  if (!address) return false;

  for (const entry of cidrs) {
    const slash = entry.indexOf("/");
    const rawBase = slash === -1 ? entry : entry.slice(0, slash);
    const base = parseIpBytes(rawBase.trim());
    if (!base || base.length !== address.length) continue;

    const maxBits = base.length * 8;
    const bits = slash === -1 ? maxBits : Number(entry.slice(slash + 1));
    if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) continue;

    if (sharesPrefix(address, base, bits)) return true;
  }

  return false;
}

/**
 * Whether a string is an IP literal or a CIDR the matcher above can actually
 * read — the ISSUANCE-time counterpart to `isIpInAnyCidr`, and deliberately a
 * different question.
 *
 * At enforcement time an unreadable entry narrows to nothing, because a row the
 * parser cannot read must never widen anything. At issuance time that same
 * silence is the defect: an operator who typed `10.0.0.0/33` would be handed a
 * credential that READS as IP-bound and is bound to nothing it can ever match,
 * and would find out at the first request rather than at the form. Refusing
 * here is the only moment where the typo is still cheap.
 */
export function isValidIpCidr(value: string): boolean {
  const slash = value.indexOf("/");
  const base = parseIpBytes(slash === -1 ? value : value.slice(0, slash));

  if (!base) return false;
  if (slash === -1) return true;

  // A digits-only suffix, checked before `Number`: `Number("")` is 0 and
  // `Number(" 8")` is 8, so `10.0.0.0/` and `10.0.0.0/ 8` would both slip
  // through a bare numeric parse — the first as a prefix length of ZERO, which
  // is every address on the internet.
  const suffix = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(suffix)) return false;

  return Number(suffix) <= base.length * 8;
}

function sharesPrefix(a: Uint8Array, b: Uint8Array, bits: number): boolean {
  const fullBytes = Math.floor(bits / 8);

  for (let i = 0; i < fullBytes; i += 1) {
    if (a[i] !== b[i]) return false;
  }

  const remainder = bits % 8;
  if (remainder === 0) return true;

  const mask = (0xff << (8 - remainder)) & 0xff;
  return (a[fullBytes]! & mask) === (b[fullBytes]! & mask);
}

/** `null` for anything that is not a plain IPv4 or IPv6 literal. */
function parseIpBytes(value: string): Uint8Array | null {
  if (value.includes(":")) return parseIpv6Bytes(value);

  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const part = parts[i]!;
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes[i] = n;
  }

  return bytes;
}

function parseIpv6Bytes(value: string): Uint8Array | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0]!.split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1]!.split(":") : [];

  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > 8) return null;

  const groups: string[] = [
    ...head,
    ...Array<string>(8 - head.length - tail.length).fill("0"),
    ...tail
  ];

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const group = groups[i]!;
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    const n = Number.parseInt(group, 16);
    bytes[i * 2] = n >> 8;
    bytes[i * 2 + 1] = n & 0xff;
  }

  return bytes;
}

/** Permission key shape: `module_key.activity_code.action`. */
const PERMISSION_KEY_PATTERN =
  /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

const NAME_MAX_LENGTH = 120;
const ALLOWED_KEYS_MAX = 50;

/**
 * An allow-list is a thing an incident responder has to read out loud. Fifty
 * permission keys is already a lot; fifty networks is a list nobody audits, and
 * a write credential whose binding cannot be audited is not really bound.
 */
const ALLOWED_CIDRS_MAX = 20;

export type MachineCredentialValidationError = {
  field: string;
  message: string;
};

export type IssueMachineCredentialInput = {
  name: string;
  tenantUserId: string;
  allowedPermissionKeys: string[];
  /**
   * ADR-0092. Empty on every credential ADR-0049 could issue, and empty is what
   * an absent field means — the read-only class stays the default, never a
   * thing the caller has to remember to ask for.
   */
  allowedWriteActions: AccessAction[];
  /** Non-empty if and only if `allowedWriteActions` is (`sql/121` CHECK). */
  allowedIpCidrs: string[];
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

  // ADR-0092 — the write class. Absent means empty, and empty means the
  // read-only credential ADR-0049 shipped: opening this class must not change
  // what a request that does not mention it gets.
  const rawWriteActions = input.allowedWriteActions ?? [];
  const allowedWriteActions: AccessAction[] = [];
  if (!Array.isArray(rawWriteActions)) {
    errors.push({
      field: "allowedWriteActions",
      message: "allowedWriteActions must be an array of actions."
    });
  } else {
    for (const action of rawWriteActions) {
      if (
        typeof action === "string" &&
        isMachineCredentialAllowedAction(action as AccessAction)
      ) {
        // Named separately from the generic refusal below because it is the
        // mistake an operator is most likely to make, and "read is not allowed"
        // is a confusing thing to be told about a credential that can read.
        errors.push({
          field: "allowedWriteActions",
          message:
            "read is implicit — every credential may read whatever its allowedPermissionKeys name."
        });
        continue;
      }

      if (
        typeof action !== "string" ||
        !MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS.has(action as AccessAction)
      ) {
        errors.push({
          field: "allowedWriteActions",
          message: `Not a write action a machine credential may hold: ${
            typeof action === "string" ? action : typeof action
          }. Allowed: ${[...MACHINE_CREDENTIAL_WRITE_ALLOWED_ACTIONS].join(", ")}.`
        });
        continue;
      }

      const writeAction = action as AccessAction;
      if (!allowedWriteActions.includes(writeAction))
        allowedWriteActions.push(writeAction);
    }
  }

  // Derived from what was ASKED FOR, not from what survived parsing.
  //
  // Deriving it from `allowedWriteActions` reads more natural and is wrong: a
  // request naming `delete` with a perfectly good CIDR would end up with an
  // EMPTY parsed list, be reclassified as read-only, and then be told its CIDR
  // is the problem. One mistake, two errors, and the second one contradicts
  // what the operator plainly asked for.
  const writeClassRequested =
    Array.isArray(rawWriteActions) && rawWriteActions.length > 0;

  const rawCidrs = input.allowedIpCidrs ?? [];
  const allowedIpCidrs: string[] = [];
  if (!Array.isArray(rawCidrs)) {
    errors.push({
      field: "allowedIpCidrs",
      message: "allowedIpCidrs must be an array of IP addresses or CIDR blocks."
    });
  } else if (!writeClassRequested && rawCidrs.length > 0) {
    // The direction nothing else enforces. `isMachineCredentialWriteRefused`
    // answers `false` for `read` BEFORE it looks at the CIDR list, so a
    // read-only credential carrying networks is not restricted to them — it is
    // a control that READS as enforced and is not. Refused rather than silently
    // dropped: dropping it still leaves an operator believing they bound it.
    //
    // Reported INSTEAD OF per-entry parse errors, not in addition: "that is not
    // a CIDR" is noise next to "this field does nothing here".
    errors.push({
      field: "allowedIpCidrs",
      message:
        "allowedIpCidrs is only enforced for credentials that can write; a read-only credential is not restricted by it."
    });
  } else if (rawCidrs.length > ALLOWED_CIDRS_MAX) {
    errors.push({
      field: "allowedIpCidrs",
      message: `allowedIpCidrs must contain at most ${ALLOWED_CIDRS_MAX} entries.`
    });
  } else if (writeClassRequested && rawCidrs.length === 0) {
    // Mirrors the `sql/121` CHECK rather than trusting it. A 422 naming the
    // field is what an operator can act on; a 23514 is a stack trace.
    errors.push({
      field: "allowedIpCidrs",
      message:
        "A credential that can write must name at least one IP address or CIDR block."
    });
  } else {
    for (const entry of rawCidrs) {
      const trimmed = typeof entry === "string" ? entry.trim() : "";

      if (!isValidIpCidr(trimmed)) {
        errors.push({
          field: "allowedIpCidrs",
          message: `Not an IP address or CIDR block: ${
            typeof entry === "string" ? entry : typeof entry
          }.`
        });
        continue;
      }

      // Stored trimmed, because the matcher is what has to agree with this
      // string later and it does not trim the prefix length.
      if (!allowedIpCidrs.includes(trimmed)) allowedIpCidrs.push(trimmed);
    }
  }

  const maxLifetimeDays = writeClassRequested
    ? MACHINE_CREDENTIAL_WRITE_MAX_LIFETIME_DAYS
    : MACHINE_CREDENTIAL_MAX_LIFETIME_DAYS;

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
      maxLifetimeDays * 24 * 60 * 60 * 1000
    ) {
      errors.push({
        field: "expiresAt",
        message: writeClassRequested
          ? `expiresAt must be at most ${maxLifetimeDays} days away for a credential that can write.`
          : `expiresAt must be at most ${maxLifetimeDays} days away.`
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
      allowedWriteActions,
      allowedIpCidrs,
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
