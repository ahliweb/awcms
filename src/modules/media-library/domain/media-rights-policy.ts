/**
 * Photo usage-rights metadata (Issue #615, `sql/137`).
 *
 * ## Why this is not a form-field change
 *
 * `alt_text` and `caption` have existed since `sql/041` and neither is a rights
 * statement. Alt text is ACCESSIBILITY — what a screen reader says. A caption is
 * EDITORIAL — what the reader is told about the scene. A credit line is neither:
 * it is what the licence obliges the publisher to print, and it fails for a
 * different reason and in front of a different person.
 *
 * Folding all three into one "required" would make the word meaningless. Here
 * they stay separate, and this module governs only the third.
 *
 * ## Rights verification is NOT `media.verify`
 *
 * `status = 'verified'` means the BYTES were checked: MIME sniffed from magic
 * bytes, checksum matched, dimensions read. A machine answering a question about
 * a file. `rightsVerificationStatus` is a person answering a question about a
 * contract. Reusing one word would make one of them wrong, and it would be the
 * legal one — a file that passes a MIME sniff would read as rights-cleared.
 *
 * Pure module: no database, no I/O.
 */

export const COPYRIGHT_STATUSES = [
  /** Nobody has established it. The DEFAULT, and a real answer for a legacy archive rather than an empty field. */
  "unknown",
  /** The newsroom holds the copyright — staff photographer, commissioned work. */
  "owned",
  /** Used under a licence: agency subscription, stock, Creative Commons. */
  "licensed",
  /** No longer under copyright, or never was. */
  "public_domain",
  /** The holder gave explicit permission for this use. */
  "permission_granted",
  /** Published under a fair-use / fair-dealing argument. Deliberately last: it is a defence, not a right. */
  "fair_use"
] as const;

export type CopyrightStatus = (typeof COPYRIGHT_STATUSES)[number];

export const RIGHTS_VERIFICATION_STATUSES = [
  /** No one has adjudicated. The default. */
  "unverified",
  /** A person checked the licence and cleared it for publication. */
  "verified",
  /** A person checked and it may NOT be published. */
  "rejected"
] as const;

export type RightsVerificationStatus =
  (typeof RIGHTS_VERIFICATION_STATUSES)[number];

/** The two statuses that are an adjudication — somebody decided, so the row must record who and when. */
export function isRightsAdjudication(
  status: RightsVerificationStatus
): boolean {
  return status !== "unverified";
}

export function isCopyrightStatus(value: unknown): value is CopyrightStatus {
  return (
    typeof value === "string" &&
    (COPYRIGHT_STATUSES as readonly string[]).includes(value)
  );
}

export function isRightsVerificationStatus(
  value: unknown
): value is RightsVerificationStatus {
  return (
    typeof value === "string" &&
    (RIGHTS_VERIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

/** Long enough for an agency's full attribution requirement, short enough that nobody pastes a contract into it. */
export const MAX_CREDIT_LINE_LENGTH = 300;
export const MAX_SOURCE_NAME_LENGTH = 200;
export const MAX_RIGHTS_NOTES_LENGTH = 2000;

export type MediaRightsUpdateInput = {
  /**
   * `undefined` means "leave alone", `null` means "clear". The distinction is
   * load-bearing on a PATCH: a form that omits a field must not erase a credit
   * someone else entered, and there has to be a way to remove a wrong one.
   */
  creditLine?: string | null;
  sourceName?: string | null;
  rightsNotes?: string | null;
  copyrightStatus?: CopyrightStatus;
  rightsVerificationStatus?: RightsVerificationStatus;
};

export type MediaRightsValidationResult =
  | { valid: true; value: MediaRightsUpdateInput }
  | { valid: false; errors: { field: string; message: string }[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads one optional free-text field.
 *
 * A blank string normalizes to `null` rather than to `""`: an empty credit is
 * the ABSENCE of a credit, and letting both spellings into the column would make
 * "does this image have a credit" a question with two right answers.
 */
function readOptionalText(
  record: Record<string, unknown>,
  field: string,
  maxLength: number,
  errors: { field: string; message: string }[]
): string | null | undefined {
  const raw = record[field];

  if (raw === undefined) {
    return undefined;
  }

  if (raw === null) {
    return null;
  }

  if (typeof raw !== "string") {
    errors.push({ field, message: `${field} must be a string or null.` });
    return undefined;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > maxLength) {
    errors.push({
      field,
      message: `${field} must be at most ${maxLength} characters.`
    });
    return undefined;
  }

  return trimmed;
}

/**
 * Validates a rights-metadata PATCH body.
 *
 * An empty patch is REFUSED. A request that changes nothing but still writes an
 * `updated_at` and an audit row is indistinguishable in the record from one that
 * did something, and this is the surface a rights dispute gets argued from.
 */
export function validateMediaRightsUpdateInput(
  body: unknown
): MediaRightsValidationResult {
  if (!isRecord(body)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  const errors: { field: string; message: string }[] = [];

  const creditLine = readOptionalText(
    body,
    "creditLine",
    MAX_CREDIT_LINE_LENGTH,
    errors
  );
  const sourceName = readOptionalText(
    body,
    "sourceName",
    MAX_SOURCE_NAME_LENGTH,
    errors
  );
  const rightsNotes = readOptionalText(
    body,
    "rightsNotes",
    MAX_RIGHTS_NOTES_LENGTH,
    errors
  );

  let copyrightStatus: CopyrightStatus | undefined;
  if (body.copyrightStatus !== undefined) {
    if (!isCopyrightStatus(body.copyrightStatus)) {
      errors.push({
        field: "copyrightStatus",
        message: `copyrightStatus must be one of: ${COPYRIGHT_STATUSES.join(", ")}.`
      });
    } else {
      copyrightStatus = body.copyrightStatus;
    }
  }

  let rightsVerificationStatus: RightsVerificationStatus | undefined;
  if (body.rightsVerificationStatus !== undefined) {
    if (!isRightsVerificationStatus(body.rightsVerificationStatus)) {
      errors.push({
        field: "rightsVerificationStatus",
        message: `rightsVerificationStatus must be one of: ${RIGHTS_VERIFICATION_STATUSES.join(", ")}.`
      });
    } else {
      rightsVerificationStatus = body.rightsVerificationStatus;
    }
  }

  const value: MediaRightsUpdateInput = {};
  if (creditLine !== undefined) value.creditLine = creditLine;
  if (sourceName !== undefined) value.sourceName = sourceName;
  if (rightsNotes !== undefined) value.rightsNotes = rightsNotes;
  if (copyrightStatus !== undefined) value.copyrightStatus = copyrightStatus;
  if (rightsVerificationStatus !== undefined) {
    value.rightsVerificationStatus = rightsVerificationStatus;
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({
      field: "body",
      message: "At least one rights field must be provided."
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}

/**
 * Would this patch change the rights ADJUDICATION?
 *
 * Callers use it to decide the audit severity: clearing up a credit line is
 * housekeeping, while declaring an image cleared for publication — or refusing
 * it — is the decision anyone later reconstructing a takedown will look for.
 */
export function changesRightsAdjudication(
  input: MediaRightsUpdateInput,
  current: RightsVerificationStatus
): boolean {
  return (
    input.rightsVerificationStatus !== undefined &&
    input.rightsVerificationStatus !== current
  );
}
