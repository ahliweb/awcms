/**
 * Request validation for `omnichannel_inbox` (Issue #1164). Pure; closed field
 * sets (an unknown field is a `400`); error messages never echo a value.
 */
import {
  CONVERSATION_STATUSES,
  DEFAULT_LIST_LIMIT,
  DEFAULT_REBUILD_WINDOW_DAYS,
  MAX_LIST_LIMIT,
  MAX_REBUILD_WINDOW_DAYS,
  MAX_TAGS_PER_CONVERSATION,
  SOURCE_KINDS,
  type ConversationStatus,
  type SourceKind
} from "./inbox-constants";
import { validateCalendar, type SlaCalendar } from "./sla-calendar";

export type FieldError = { field: string; message: string };

export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: FieldError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_TYPE_PATTERN = /^[a-z][a-z0-9_]*$/;
const TAG_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[]
): FieldError[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((field) => ({ field, message: "Unknown field." }));
}

function expectedVersion(
  body: Record<string, unknown>,
  errors: FieldError[]
): number {
  const value = body.expectedVersion;

  if (!Number.isInteger(value) || (value as number) < 1) {
    errors.push({
      field: "expectedVersion",
      message: "expectedVersion must be the conversation's current version."
    });
    return 0;
  }

  return value as number;
}

export type ListConversationsQuery = {
  status: ConversationStatus | null;
  /** `me`, `unassigned`, or a tenant user id. */
  assignee: string | null;
  slaState: "breached" | null;
  tagId: string | null;
  sourceKind: SourceKind | null;
  limit: number;
  cursor: { lastInboundAt: Date; id: string } | null;
};

const LIST_PARAMS = [
  "status",
  "assignee",
  "slaState",
  "tagId",
  "sourceKind",
  "limit",
  "cursor"
];

function decodeCursor(raw: string): ListConversationsQuery["cursor"] {
  if (raw.length > 200) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8")
    ) as unknown;

    if (!isPlainObject(parsed)) return null;

    const at = typeof parsed.t === "string" ? new Date(parsed.t) : null;

    if (!at || Number.isNaN(at.getTime()) || !isUuid(parsed.i)) return null;

    return { lastInboundAt: at, id: parsed.i.toLowerCase() };
  } catch {
    return null;
  }
}

export function validateListConversationsQuery(
  params: URLSearchParams
): Validated<ListConversationsQuery> {
  const errors: FieldError[] = [];

  for (const key of params.keys()) {
    if (!LIST_PARAMS.includes(key)) {
      errors.push({ field: key, message: "Unknown query parameter." });
    }
  }

  const status = params.get("status");

  if (status !== null && !CONVERSATION_STATUSES.includes(status as never)) {
    errors.push({ field: "status", message: "status is not a known status." });
  }

  const assignee = params.get("assignee");

  if (
    assignee !== null &&
    assignee !== "me" &&
    assignee !== "unassigned" &&
    !isUuid(assignee)
  ) {
    errors.push({
      field: "assignee",
      message: "assignee must be me, unassigned or a UUID."
    });
  }

  const slaState = params.get("slaState");

  if (slaState !== null && slaState !== "breached") {
    errors.push({ field: "slaState", message: "slaState must be breached." });
  }

  const tagId = params.get("tagId");

  if (tagId !== null && !isUuid(tagId)) {
    errors.push({ field: "tagId", message: "tagId must be a UUID." });
  }

  const sourceKind = params.get("sourceKind");

  if (sourceKind !== null && !SOURCE_KINDS.includes(sourceKind as never)) {
    errors.push({
      field: "sourceKind",
      message: "sourceKind must be telegram or website."
    });
  }

  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? DEFAULT_LIST_LIMIT : Number(limitRaw);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    errors.push({
      field: "limit",
      message: `limit must be an integer from 1 to ${MAX_LIST_LIMIT}.`
    });
  }

  const cursorRaw = params.get("cursor");
  const cursor = cursorRaw === null ? null : decodeCursor(cursorRaw);

  if (cursorRaw !== null && !cursor) {
    errors.push({ field: "cursor", message: "cursor is not valid." });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      status: (status as ConversationStatus | null) ?? null,
      assignee:
        assignee && isUuid(assignee) ? assignee.toLowerCase() : assignee,
      slaState: slaState === "breached" ? "breached" : null,
      tagId: tagId ? tagId.toLowerCase() : null,
      sourceKind: (sourceKind as SourceKind | null) ?? null,
      limit,
      cursor
    }
  };
}

export function validateStatusBody(
  raw: unknown
): Validated<{ status: ConversationStatus; expectedVersion: number }> {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  const errors = unknownFields(raw, ["status", "expectedVersion"]);

  if (!CONVERSATION_STATUSES.includes(raw.status as never)) {
    errors.push({ field: "status", message: "status is not a known status." });
  }

  const version = expectedVersion(raw, errors);

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          status: raw.status as ConversationStatus,
          expectedVersion: version
        }
      };
}

export function validateVersionOnlyBody(
  raw: unknown
): Validated<{ expectedVersion: number }> {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  const errors = unknownFields(raw, ["expectedVersion"]);
  const version = expectedVersion(raw, errors);

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: { expectedVersion: version } };
}

export function validateAssignmentBody(raw: unknown): Validated<{
  assigneeTenantUserId: string | null;
  expectedVersion: number;
}> {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  const errors = unknownFields(raw, [
    "assigneeTenantUserId",
    "expectedVersion"
  ]);
  const assignee = raw.assigneeTenantUserId;

  if (assignee !== null && !isUuid(assignee)) {
    errors.push({
      field: "assigneeTenantUserId",
      message: "assigneeTenantUserId must be a UUID or null (unassign)."
    });
  }

  const version = expectedVersion(raw, errors);

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          assigneeTenantUserId: isUuid(assignee)
            ? assignee.toLowerCase()
            : null,
          expectedVersion: version
        }
      };
}

export function validateTagsBody(
  raw: unknown
): Validated<{ tagIds: string[]; expectedVersion: number }> {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  const errors = unknownFields(raw, ["tagIds", "expectedVersion"]);
  const tags = raw.tagIds;

  if (
    !Array.isArray(tags) ||
    tags.length > MAX_TAGS_PER_CONVERSATION ||
    !tags.every(isUuid)
  ) {
    errors.push({
      field: "tagIds",
      message: `tagIds must be at most ${MAX_TAGS_PER_CONVERSATION} tag UUIDs.`
    });
  }

  const version = expectedVersion(raw, errors);

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          tagIds: [
            ...new Set((tags as string[]).map((tag) => tag.toLowerCase()))
          ],
          expectedVersion: version
        }
      };
}

export function validateTagCreateBody(
  raw: unknown
): Validated<{ code: string; label: string }> {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  const errors = unknownFields(raw, ["code", "label"]);

  if (typeof raw.code !== "string" || !TAG_CODE_PATTERN.test(raw.code)) {
    errors.push({
      field: "code",
      message: "code must be 1-48 lower-case letters, digits, '-' or '_'."
    });
  }

  const label = typeof raw.label === "string" ? raw.label.trim() : "";

  if (label.length < 1 || label.length > 60 || /[\u0000-\u001f]/.test(label)) {
    errors.push({
      field: "label",
      message: "label must be 1-60 printable characters."
    });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: { code: raw.code as string, label } };
}

export type SlaPolicyCreateInput = {
  businessScope: { type: string; id: string } | null;
  name: string;
  firstResponseMinutes: number;
  nextResponseMinutes: number;
  calendar: SlaCalendar;
};

const MINUTES_LIMIT = 43_200;

export function validateSlaPolicyCreateBody(
  raw: unknown
): Validated<SlaPolicyCreateInput> {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  const errors = unknownFields(raw, [
    "businessScope",
    "name",
    "firstResponseMinutes",
    "nextResponseMinutes",
    "timezone",
    "workingHours",
    "holidays"
  ]);
  let businessScope: SlaPolicyCreateInput["businessScope"] = null;

  if (raw.businessScope !== undefined && raw.businessScope !== null) {
    const scope = raw.businessScope;

    if (
      !isPlainObject(scope) ||
      Object.keys(scope).length !== 2 ||
      typeof scope.type !== "string" ||
      !SCOPE_TYPE_PATTERN.test(scope.type) ||
      !isUuid(scope.id)
    ) {
      errors.push({
        field: "businessScope",
        message: "businessScope must be {type, id} or null (tenant default)."
      });
    } else {
      businessScope = {
        type: scope.type,
        id: (scope.id as string).toLowerCase()
      };
    }
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";

  if (name.length < 1 || name.length > 120 || /[\u0000-\u001f]/.test(name)) {
    errors.push({
      field: "name",
      message: "name must be 1-120 printable characters."
    });
  }

  for (const field of ["firstResponseMinutes", "nextResponseMinutes"]) {
    const value = raw[field];

    if (
      !Number.isInteger(value) ||
      (value as number) < 1 ||
      (value as number) > MINUTES_LIMIT
    ) {
      errors.push({
        field,
        message: `${field} must be an integer from 1 to ${MINUTES_LIMIT}.`
      });
    }
  }

  const calendar = validateCalendar({
    timezone: raw.timezone,
    workingHours: raw.workingHours,
    holidays: raw.holidays
  });

  if (!calendar.valid) errors.push(...calendar.errors);

  if (errors.length > 0 || !calendar.valid) return { valid: false, errors };

  return {
    valid: true,
    value: {
      businessScope,
      name,
      firstResponseMinutes: raw.firstResponseMinutes as number,
      nextResponseMinutes: raw.nextResponseMinutes as number,
      calendar: calendar.value
    }
  };
}

/** PostgreSQL `bigint` maximum: `event_sequence`'s type. */
const MAX_EVENT_SEQUENCE = 9223372036854775807n;

export function validateRebuildBody(
  raw: unknown
): Validated<{ afterSequence: string; windowDays: number }> {
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      errors: [{ field: "body", message: "Body must be an object." }]
    };
  }

  const errors = unknownFields(raw, ["afterSequence", "windowDays"]);
  const after = raw.afterSequence ?? "0";

  // At most the bigint maximum (#1275 audit, L-2): 19 digits alone admit
  // 9999999999999999999, which PostgreSQL refuses with a 500.
  if (
    typeof after !== "string" ||
    !/^\d{1,19}$/.test(after) ||
    BigInt(after) > MAX_EVENT_SEQUENCE
  ) {
    errors.push({
      field: "afterSequence",
      message:
        "afterSequence must be a decimal event sequence (at most 9223372036854775807)."
    });
  }

  const window = raw.windowDays ?? DEFAULT_REBUILD_WINDOW_DAYS;

  if (
    !Number.isInteger(window) ||
    (window as number) < 1 ||
    (window as number) > MAX_REBUILD_WINDOW_DAYS
  ) {
    errors.push({
      field: "windowDays",
      message: `windowDays must be an integer from 1 to ${MAX_REBUILD_WINDOW_DAYS}.`
    });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: { afterSequence: after as string, windowDays: window as number }
      };
}

export function validateEmptyBody(raw: unknown): Validated<null> {
  return isPlainObject(raw) && Object.keys(raw).length === 0
    ? { valid: true, value: null }
    : {
        valid: false,
        errors: [{ field: "body", message: "Body must be empty or {}." }]
      };
}
