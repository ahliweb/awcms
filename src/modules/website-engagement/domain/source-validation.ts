/**
 * Validation for the ADMIN source endpoints (create, change). Pure module: no
 * database, no I/O. Error text never echoes the offending value.
 */
import {
  CHALLENGE_MODES,
  MAX_SOURCE_DOMAINS,
  SOURCE_STATUSES,
  SUBMISSION_KINDS,
  WITHDRAWAL_REASONS,
  type ChallengeMode,
  type SourceStatus,
  type SubmissionKind,
  type SubmissionStatus,
  type WithdrawalReason
} from "./website-engagement-constants";

export type FieldError = { field: string; message: string };
export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: FieldError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_-]{1,39}$/;
const COPY_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type CreateSourceInput = {
  code: string;
  name: string;
  consentCopyVersion: string;
  challengeMode: ChallengeMode;
  acceptedKinds: SubmissionKind[];
  domainIds: string[];
};

export type UpdateSourceInput = {
  name?: string;
  consentCopyVersion?: string;
  challengeMode?: ChallengeMode;
  acceptedKinds?: SubmissionKind[];
  status?: Exclude<SourceStatus, "revoked">;
  domainIds?: string[];
};

const CREATE_KEYS = new Set([
  "code",
  "name",
  "consentCopyVersion",
  "challengeMode",
  "acceptedKinds",
  "domainIds"
]);
const UPDATE_KEYS = new Set([
  "name",
  "consentCopyVersion",
  "challengeMode",
  "acceptedKinds",
  "status",
  "domainIds"
]);

function readName(
  raw: unknown,
  errors: FieldError[],
  required: boolean
): string | undefined {
  if (raw === undefined) {
    if (required) errors.push({ field: "name", message: "name is required." });
    return undefined;
  }

  if (typeof raw !== "string" || raw.trim().length === 0 || raw.length > 120) {
    errors.push({
      field: "name",
      message: "name must be between 1 and 120 characters."
    });
    return undefined;
  }

  return raw.normalize("NFC").trim();
}

function readKinds(
  raw: unknown,
  errors: FieldError[]
): SubmissionKind[] | undefined {
  if (raw === undefined) return undefined;

  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > SUBMISSION_KINDS.length ||
    raw.some(
      (kind) =>
        typeof kind !== "string" ||
        !(SUBMISSION_KINDS as readonly string[]).includes(kind)
    )
  ) {
    errors.push({
      field: "acceptedKinds",
      message: "acceptedKinds must list recognised kinds."
    });
    return undefined;
  }

  return [...new Set(raw as SubmissionKind[])];
}

function readDomainIds(
  raw: unknown,
  errors: FieldError[]
): string[] | undefined {
  if (raw === undefined) return undefined;

  if (
    !Array.isArray(raw) ||
    raw.length > MAX_SOURCE_DOMAINS ||
    raw.some((id) => !isUuid(id))
  ) {
    errors.push({
      field: "domainIds",
      message: `domainIds must be at most ${MAX_SOURCE_DOMAINS} identifiers.`
    });
    return undefined;
  }

  return [...new Set((raw as string[]).map((id) => id.toLowerCase()))];
}

function readCopyVersion(
  raw: unknown,
  errors: FieldError[],
  required: boolean
): string | undefined {
  if (raw === undefined) {
    if (required) {
      errors.push({
        field: "consentCopyVersion",
        message: "consentCopyVersion is required."
      });
    }
    return undefined;
  }

  if (typeof raw !== "string" || !COPY_VERSION_PATTERN.test(raw)) {
    errors.push({
      field: "consentCopyVersion",
      message: "consentCopyVersion is not a version label."
    });
    return undefined;
  }

  return raw;
}

function readChallengeMode(
  raw: unknown,
  errors: FieldError[]
): ChallengeMode | undefined {
  if (raw === undefined) return undefined;

  if (
    typeof raw !== "string" ||
    !(CHALLENGE_MODES as readonly string[]).includes(raw)
  ) {
    errors.push({
      field: "challengeMode",
      message: "challengeMode is not recognised."
    });
    return undefined;
  }

  return raw as ChallengeMode;
}

export function validateCreateSource(
  raw: unknown
): Validated<CreateSourceInput> {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !CREATE_KEYS.has(key))) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body is not valid." }]
    };
  }

  const errors: FieldError[] = [];

  if (typeof raw.code !== "string" || !CODE_PATTERN.test(raw.code)) {
    errors.push({
      field: "code",
      message:
        "code must be 2 to 40 lower-case letters, digits, dashes or underscores, starting with a letter."
    });
  }

  const name = readName(raw.name, errors, true);
  const consentCopyVersion = readCopyVersion(
    raw.consentCopyVersion,
    errors,
    true
  );
  const challengeMode = readChallengeMode(raw.challengeMode, errors);
  const acceptedKinds = readKinds(raw.acceptedKinds, errors);
  const domainIds = readDomainIds(raw.domainIds, errors);

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      code: raw.code as string,
      name: name as string,
      consentCopyVersion: consentCopyVersion as string,
      challengeMode: challengeMode ?? "turnstile",
      acceptedKinds: acceptedKinds ?? [...SUBMISSION_KINDS],
      domainIds: domainIds ?? []
    }
  };
}

export function validateUpdateSource(
  raw: unknown
): Validated<UpdateSourceInput> {
  if (!isRecord(raw) || Object.keys(raw).some((key) => !UPDATE_KEYS.has(key))) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body is not valid." }]
    };
  }

  const errors: FieldError[] = [];
  const value: UpdateSourceInput = {};

  const name = readName(raw.name, errors, false);
  if (name !== undefined) value.name = name;

  const consentCopyVersion = readCopyVersion(
    raw.consentCopyVersion,
    errors,
    false
  );
  if (consentCopyVersion !== undefined) {
    value.consentCopyVersion = consentCopyVersion;
  }

  const challengeMode = readChallengeMode(raw.challengeMode, errors);
  if (challengeMode !== undefined) value.challengeMode = challengeMode;

  const acceptedKinds = readKinds(raw.acceptedKinds, errors);
  if (acceptedKinds !== undefined) value.acceptedKinds = acceptedKinds;

  const domainIds = readDomainIds(raw.domainIds, errors);
  if (domainIds !== undefined) value.domainIds = domainIds;

  if (raw.status !== undefined) {
    // Revocation is its own endpoint: it is one-way and audited as such.
    if (raw.status !== "active" && raw.status !== "paused") {
      errors.push({
        field: "status",
        message: "status must be active or paused."
      });
    } else {
      value.status = raw.status;
    }
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({ field: "body", message: "Nothing to change." });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

export type ListSubmissionsQuery = {
  limit: number;
  cursor: string | null;
  sourceId: string | null;
  kind: SubmissionKind | null;
  status: SubmissionStatus | null;
};

export function validateListSubmissionsQuery(
  params: URLSearchParams
): Validated<ListSubmissionsQuery> {
  const errors: FieldError[] = [];

  let limit = 25;
  const rawLimit = params.get("limit");

  if (rawLimit !== null) {
    const parsed = Number(rawLimit);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      errors.push({ field: "limit", message: "limit must be 1 to 100." });
    } else {
      limit = parsed;
    }
  }

  const sourceId = params.get("sourceId");

  if (sourceId !== null && !isUuid(sourceId)) {
    errors.push({ field: "sourceId", message: "sourceId must be a UUID." });
  }

  const kind = params.get("kind");

  if (
    kind !== null &&
    !(SUBMISSION_KINDS as readonly string[]).includes(kind)
  ) {
    errors.push({ field: "kind", message: "kind is not recognised." });
  }

  const status = params.get("status");

  if (status !== null && status !== "received" && status !== "withdrawn") {
    errors.push({ field: "status", message: "status is not recognised." });
  }

  const cursor = params.get("cursor");

  if (cursor !== null && (cursor.length === 0 || cursor.length > 200)) {
    errors.push({ field: "cursor", message: "cursor is invalid." });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      limit,
      cursor,
      sourceId: sourceId?.toLowerCase() ?? null,
      kind: kind as SubmissionKind | null,
      status: status as SubmissionStatus | null
    }
  };
}

export type WithdrawInput = { reason: WithdrawalReason };

export function validateWithdraw(raw: unknown): Validated<WithdrawInput> {
  if (
    !isRecord(raw) ||
    Object.keys(raw).some((key) => key !== "reason") ||
    typeof raw.reason !== "string" ||
    !(WITHDRAWAL_REASONS as readonly string[]).includes(raw.reason)
  ) {
    return {
      valid: false,
      errors: [{ field: "reason", message: "reason is not recognised." }]
    };
  }

  return { valid: true, value: { reason: raw.reason as WithdrawalReason } };
}

export { SOURCE_STATUSES };
