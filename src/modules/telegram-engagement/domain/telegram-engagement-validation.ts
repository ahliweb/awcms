/**
 * Request validation for the admin routes (Issue #1156). Every body is a CLOSED
 * object: an unknown key is an error, not ignored, so a caller cannot smuggle a
 * `chatId`, a `username`, a `phone` or a tenant id into a request and have it
 * silently dropped while believing it was used (T-N2: there is no way to address
 * anyone but an existing contact). Error messages never echo a value.
 *
 * Pure module.
 */
import {
  MAX_NOTICE_LENGTH,
  MAX_TEXT_LENGTH,
  PROMPTABLE_PURPOSES,
  PURPOSES,
  type PromptablePurpose,
  type Purpose
} from "./telegram-engagement-constants";

export type ValidationError = { field: string; message: string };

export type Validated<T> =
  { valid: true; value: T } | { valid: false; errors: ValidationError[] };

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const NOTICE_VERSION = /^[A-Za-z0-9._-]{1,40}$/;
/** C0 controls other than tab and newline, DEL and C1: never part of a chat message. */
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function asObject(raw: unknown): Record<string, unknown> | null {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function unknownKeys(
  body: Record<string, unknown>,
  allowed: readonly string[]
): ValidationError[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({
      field: key.slice(0, 64),
      message: "is not an accepted field"
    }));
}

function validText(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max &&
    !CONTROL_CHARACTERS.test(value)
  );
}

export type RegisterBotInput = {
  accountId: string;
  dailySendCeiling: number | null;
};

export function validateRegisterBot(raw: unknown): Validated<RegisterBotInput> {
  const body = asObject(raw);

  if (!body) {
    return {
      valid: false,
      errors: [{ field: "body", message: "must be an object" }]
    };
  }

  const errors = unknownKeys(body, ["accountId", "dailySendCeiling"]);

  if (!isUuid(body.accountId)) {
    errors.push({ field: "accountId", message: "must be a UUID" });
  }

  const ceiling = body.dailySendCeiling;

  if (
    ceiling !== undefined &&
    ceiling !== null &&
    !(
      typeof ceiling === "number" &&
      Number.isInteger(ceiling) &&
      ceiling >= 1 &&
      ceiling <= 100_000
    )
  ) {
    errors.push({
      field: "dailySendCeiling",
      message: "must be an integer between 1 and 100000"
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      accountId: (body.accountId as string).toLowerCase(),
      dailySendCeiling: typeof ceiling === "number" ? ceiling : null
    }
  };
}

/** Rotate and revoke take no body; an empty object (or none) is the only valid one. */
export function validateEmptyBody(
  raw: unknown
): Validated<Record<string, never>> {
  const body = asObject(raw);

  if (!body) {
    return {
      valid: false,
      errors: [{ field: "body", message: "must be an object" }]
    };
  }

  const errors = unknownKeys(body, []);

  return errors.length > 0
    ? { valid: false, errors }
    : { valid: true, value: {} };
}

export type SendMessageInput = { purpose: Purpose; text: string };

export function validateSendMessage(raw: unknown): Validated<SendMessageInput> {
  const body = asObject(raw);

  if (!body) {
    return {
      valid: false,
      errors: [{ field: "body", message: "must be an object" }]
    };
  }

  const errors = unknownKeys(body, ["purpose", "text"]);

  if (!(PURPOSES as readonly unknown[]).includes(body.purpose)) {
    errors.push({
      field: "purpose",
      message: `must be one of ${PURPOSES.join(", ")}`
    });
  }

  if (!validText(body.text, MAX_TEXT_LENGTH)) {
    errors.push({
      field: "text",
      message: `must be 1 to ${MAX_TEXT_LENGTH} characters without control characters`
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: { purpose: body.purpose as Purpose, text: body.text as string }
  };
}

export type ConsentPromptInput = {
  purpose: PromptablePurpose;
  noticeVersion: string;
  noticeText: string;
};

export function validateConsentPrompt(
  raw: unknown
): Validated<ConsentPromptInput> {
  const body = asObject(raw);

  if (!body) {
    return {
      valid: false,
      errors: [{ field: "body", message: "must be an object" }]
    };
  }

  const errors = unknownKeys(body, ["purpose", "noticeVersion", "noticeText"]);

  if (!(PROMPTABLE_PURPOSES as readonly unknown[]).includes(body.purpose)) {
    errors.push({
      field: "purpose",
      message: `must be one of ${PROMPTABLE_PURPOSES.join(", ")}`
    });
  }

  if (
    typeof body.noticeVersion !== "string" ||
    !NOTICE_VERSION.test(body.noticeVersion)
  ) {
    errors.push({
      field: "noticeVersion",
      message: "must be 1 to 40 characters of A-Z a-z 0-9 . _ -"
    });
  }

  if (!validText(body.noticeText, MAX_NOTICE_LENGTH)) {
    errors.push({
      field: "noticeText",
      message: `must be 1 to ${MAX_NOTICE_LENGTH} characters without control characters`
    });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: {
      purpose: body.purpose as PromptablePurpose,
      noticeVersion: body.noticeVersion as string,
      noticeText: body.noticeText as string
    }
  };
}

export type ListContactsQuery = {
  accountId: string;
  limit: number;
  cursor: { startedAt: string; id: string } | null;
};

export function encodeContactCursor(startedAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ s: startedAt.toISOString(), i: id }),
    "utf8"
  ).toString("base64url");
}

function decodeContactCursor(
  raw: string
): { startedAt: string; id: string } | null {
  if (raw.length > 200) return null;

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));

    if (
      typeof parsed?.s === "string" &&
      !Number.isNaN(Date.parse(parsed.s)) &&
      isUuid(parsed?.i)
    ) {
      return { startedAt: parsed.s, id: parsed.i.toLowerCase() };
    }
  } catch {
    return null;
  }

  return null;
}

export function validateListContactsQuery(
  params: URLSearchParams
): Validated<ListContactsQuery> {
  const errors: ValidationError[] = [];
  const accountId = params.get("accountId");

  if (!isUuid(accountId)) {
    errors.push({
      field: "accountId",
      message: "is required and must be a UUID"
    });
  }

  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? 50 : Number(limitRaw);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    errors.push({
      field: "limit",
      message: "must be an integer between 1 and 100"
    });
  }

  const cursorRaw = params.get("cursor");
  const cursor = cursorRaw === null ? null : decodeContactCursor(cursorRaw);

  if (cursorRaw !== null && cursor === null) {
    errors.push({ field: "cursor", message: "is invalid" });
  }

  if (errors.length > 0) return { valid: false, errors };

  return {
    valid: true,
    value: { accountId: (accountId as string).toLowerCase(), limit, cursor }
  };
}
