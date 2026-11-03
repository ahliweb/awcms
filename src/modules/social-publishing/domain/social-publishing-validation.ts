/**
 * Request validation for `social_publishing` (Issue #1145). Pure; no I/O.
 *
 * Every validator is STRICT about unknown fields: a credential-shaped field
 * (`token`, `accessToken`, `secret`) sent to an endpoint that takes none must be
 * refused loudly rather than silently ignored or stored. In particular a
 * publication names its accounts by id and carries NO provider, token, phone
 * number or page id: those are read from the account record.
 */
import {
  MAX_CAPTION_LENGTH,
  MAX_LINK_LENGTH,
  MAX_TARGET_ACCOUNTS,
  MAX_TITLE_LENGTH,
  isSocialPublishTrigger,
  type SocialPublishTrigger
} from "./social-publishing-constants";

export type ValidationError = { field: string; message: string };

export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[]
): ValidationError[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ field: key, message: "Unknown field." }));
}

const NOT_AN_OBJECT: ValidationError[] = [
  { field: "body", message: "Request body must be a JSON object." }
];

/** A schedule instant: an ISO-8601 string with an offset, in the future. `null` clears it. */
function parseInstant(
  value: unknown,
  field: string,
  now: Date,
  errors: ValidationError[]
): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(
      value
    )
  ) {
    errors.push({
      field,
      message: "Must be an ISO-8601 timestamp with a UTC offset."
    });
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    errors.push({ field, message: "Not a valid timestamp." });
    return undefined;
  }

  if (date.getTime() <= now.getTime()) {
    errors.push({ field, message: "Must be in the future." });
    return undefined;
  }

  // A year ahead is a typo, not a plan.
  if (date.getTime() > now.getTime() + 366 * 24 * 3600 * 1000) {
    errors.push({ field, message: "Must be within one year." });
    return undefined;
  }

  return date;
}

export type CreatePublicationInput = {
  title: string;
  caption: string;
  linkUrl: string | null;
  mediaObjectId: string | null;
  accountIds: string[];
  notBefore: Date | null;
};

export function validateCreatePublication(
  raw: unknown,
  now: Date
): Validated<CreatePublicationInput> {
  if (!isRecord(raw)) return { valid: false, errors: NOT_AN_OBJECT };

  const errors = unknownFields(raw, [
    "title",
    "caption",
    "linkUrl",
    "mediaObjectId",
    "accountIds",
    "notBefore"
  ]);

  const title = raw.title;

  if (
    typeof title !== "string" ||
    title.trim() === "" ||
    title.length > MAX_TITLE_LENGTH ||
    CONTROL_CHARS.test(title)
  ) {
    errors.push({
      field: "title",
      message: `Required, at most ${MAX_TITLE_LENGTH} characters, no control characters.`
    });
  }

  const caption = raw.caption;

  if (
    typeof caption !== "string" ||
    caption.trim() === "" ||
    caption.length > MAX_CAPTION_LENGTH ||
    CONTROL_CHARS.test(caption)
  ) {
    errors.push({
      field: "caption",
      message: `Required, at most ${MAX_CAPTION_LENGTH} characters, no control characters.`
    });
  }

  let linkUrl: string | null = null;

  if (raw.linkUrl !== undefined && raw.linkUrl !== null) {
    if (
      typeof raw.linkUrl !== "string" ||
      raw.linkUrl.length > MAX_LINK_LENGTH
    ) {
      errors.push({ field: "linkUrl", message: "Must be an https URL." });
    } else {
      linkUrl = raw.linkUrl;
    }
  }

  let mediaObjectId: string | null = null;

  if (raw.mediaObjectId !== undefined && raw.mediaObjectId !== null) {
    if (!isUuid(raw.mediaObjectId)) {
      errors.push({ field: "mediaObjectId", message: "Must be a UUID." });
    } else {
      mediaObjectId = raw.mediaObjectId;
    }
  }

  const accountIds: string[] = [];

  if (!Array.isArray(raw.accountIds)) {
    errors.push({ field: "accountIds", message: "Must be an array of UUIDs." });
  } else if (
    raw.accountIds.length < 1 ||
    raw.accountIds.length > MAX_TARGET_ACCOUNTS
  ) {
    errors.push({
      field: "accountIds",
      message: `Between 1 and ${MAX_TARGET_ACCOUNTS} accounts.`
    });
  } else {
    for (const id of raw.accountIds) {
      if (!isUuid(id)) {
        errors.push({
          field: "accountIds",
          message: "Every id must be a UUID."
        });
        break;
      }

      const normal = id.toLowerCase();

      if (!accountIds.includes(normal)) accountIds.push(normal);
    }
  }

  const notBefore = parseInstant(raw.notBefore, "notBefore", now, errors);

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      title: (title as string).trim(),
      caption: (caption as string).trim(),
      linkUrl,
      mediaObjectId,
      accountIds,
      notBefore: notBefore ?? null
    }
  };
}

export function validateSchedule(
  raw: unknown,
  now: Date
): Validated<{ notBefore: Date | null }> {
  if (!isRecord(raw)) return { valid: false, errors: NOT_AN_OBJECT };

  const errors = unknownFields(raw, ["notBefore"]);

  if (!("notBefore" in raw)) {
    errors.push({ field: "notBefore", message: "Required (null clears it)." });
  }

  const notBefore = parseInstant(raw.notBefore, "notBefore", now, errors);

  if (errors.length > 0) return { valid: false, errors };

  return { valid: true, value: { notBefore: notBefore ?? null } };
}

export function validateCancel(
  raw: unknown
): Validated<{ reason: string | null }> {
  if (raw === undefined || raw === null) {
    return { valid: true, value: { reason: null } };
  }

  if (!isRecord(raw)) return { valid: false, errors: NOT_AN_OBJECT };

  const errors = unknownFields(raw, ["reason"]);
  let reason: string | null = null;

  if (raw.reason !== undefined && raw.reason !== null) {
    if (
      typeof raw.reason !== "string" ||
      raw.reason.trim() === "" ||
      raw.reason.length > 300 ||
      CONTROL_CHARS.test(raw.reason)
    ) {
      errors.push({
        field: "reason",
        message: "At most 300 characters, no control characters."
      });
    } else {
      reason = raw.reason.trim();
    }
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: { reason } };
}

export function validateRetry(
  raw: unknown
): Validated<{ confirmPossiblyPublished: boolean }> {
  if (raw === undefined || raw === null) {
    return { valid: true, value: { confirmPossiblyPublished: false } };
  }

  if (!isRecord(raw)) return { valid: false, errors: NOT_AN_OBJECT };

  const errors = unknownFields(raw, ["confirmPossiblyPublished"]);

  if (
    raw.confirmPossiblyPublished !== undefined &&
    typeof raw.confirmPossiblyPublished !== "boolean"
  ) {
    errors.push({
      field: "confirmPossiblyPublished",
      message: "Must be a boolean."
    });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          confirmPossiblyPublished: raw.confirmPossiblyPublished === true
        }
      };
}

export type CreateRuleInput = {
  trigger: SocialPublishTrigger;
  accountId: string;
};

export function validateCreateRule(raw: unknown): Validated<CreateRuleInput> {
  if (!isRecord(raw)) return { valid: false, errors: NOT_AN_OBJECT };

  const errors = unknownFields(raw, ["trigger", "accountId"]);

  if (!isSocialPublishTrigger(raw.trigger)) {
    errors.push({
      field: "trigger",
      message:
        "Must be one of post_published, scheduled_published, manual_editor_action."
    });
  }

  if (!isUuid(raw.accountId)) {
    errors.push({ field: "accountId", message: "Must be a UUID." });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          trigger: raw.trigger as SocialPublishTrigger,
          accountId: (raw.accountId as string).toLowerCase()
        }
      };
}

export function validateRulePatch(
  raw: unknown
): Validated<{ enabled: boolean }> {
  if (!isRecord(raw)) return { valid: false, errors: NOT_AN_OBJECT };

  const errors = unknownFields(raw, ["enabled"]);

  if (typeof raw.enabled !== "boolean") {
    errors.push({ field: "enabled", message: "Must be a boolean." });
  }

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: { enabled: raw.enabled as boolean } };
}

export type SettingsPatch = {
  autoPublishEnabled?: boolean;
  approvalRequired?: boolean;
};

export function validateSettingsPatch(raw: unknown): Validated<SettingsPatch> {
  if (!isRecord(raw)) return { valid: false, errors: NOT_AN_OBJECT };

  const errors = unknownFields(raw, ["autoPublishEnabled", "approvalRequired"]);
  const value: SettingsPatch = {};

  for (const field of ["autoPublishEnabled", "approvalRequired"] as const) {
    if (raw[field] === undefined) continue;

    if (typeof raw[field] !== "boolean") {
      errors.push({ field, message: "Must be a boolean." });
    } else {
      value[field] = raw[field] as boolean;
    }
  }

  if (errors.length === 0 && Object.keys(value).length === 0) {
    errors.push({ field: "body", message: "Provide at least one field." });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true, value };
}

export type ListPublicationsParams = {
  limit: number;
  cursor: string | null;
  state: "pending_approval" | "ready" | "cancelled" | "refused" | null;
};

export function validateListPublicationsQuery(
  params: URLSearchParams
): Validated<ListPublicationsParams> {
  const errors: ValidationError[] = [];
  const state = params.get("state");
  const limitRaw = params.get("limit");
  let limit = 25;

  if (
    state !== null &&
    !["pending_approval", "ready", "cancelled", "refused"].includes(state)
  ) {
    errors.push({
      field: "state",
      message: "Must be pending_approval, ready, cancelled or refused."
    });
  }

  if (limitRaw !== null) {
    const parsed = Number(limitRaw);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      errors.push({ field: "limit", message: "Must be an integer 1-100." });
    } else {
      limit = parsed;
    }
  }

  return errors.length > 0
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          limit,
          cursor: params.get("cursor"),
          state: state as ListPublicationsParams["state"]
        }
      };
}
