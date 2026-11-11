/**
 * Mailketing webhook: the callback token and the payload, as pure functions
 * (Issue #1161, ADR-0151 section 5, ADR-0150 I9/N5). No database, no I/O.
 *
 * ## What the vendor documents, and what it does not
 *
 * Re-verified 2026-11-11 against https://api.mailketing.co.id/docs/webhook.html
 * and https://api.mailketing.co.id/docs/ (v2.0.2, changelog 2026-10-23):
 *
 * - `POST`, `Content-Type: application/json`, one URL configured per event type
 *   in the Mailketing dashboard (Integrations, Webhook).
 * - Payloads (`type` names the event):
 *   `emailopen`   `email`, `date`, `message_id`
 *   `emailclick`  `email`, `link_clicked`, `date`        (NO message id)
 *   `bounce`      `email`, `reason`, `date`, `message_id`
 *   `newsubscriber` `email`, `first_name`, `last_name`, `list_id`, `mobile`, `date`
 *   `unsubscribe` `email`, `date`                        (NO message id)
 *   `delivered`   `send_time`, `orig`, `rcpt`, `jobid`, `dsndiag` (Business API
 *                 only; `jobid` is documented as the bounce's `message_id`)
 * - **No authentication of any kind**: no signature, HMAC, secret header,
 *   token, source-IP list, mTLS or event id. No message-status polling endpoint
 *   and no unsubscribe/suppression API exist to verify a report against.
 *
 * So nothing here can tell a real Mailketing callback from a forged one. The
 * per-account callback token only LOCATES the tenant and account (ADR-0150 N5:
 * URL secrecy is not authentication); every event is recorded as
 * `unauthenticated` and changes no state by itself (ADR-0151 `strict` mode).
 *
 * ## Minimisation
 *
 * The bounce `reason` text is never kept (a remote MTA's diagnostic can quote
 * the address and other mailbox detail): only a class and an RFC 3463 code. The
 * clicked link is reduced to its host and a hash; it is never stored, rendered
 * as a link, or fetched. `newsubscriber`'s name and mobile number are never
 * read.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// The callback token
// ---------------------------------------------------------------------------

/**
 * `mkw1.<tenantId>.<subscriptionId>.<secret>`.
 *
 * The callback endpoint has no session and no tenant context, and the
 * subscription table is behind `FORCE ROW LEVEL SECURITY`. As in
 * `website-engagement/domain/source-token.ts`, the token NAMES the tenant and
 * the subscription so the server opens that tenant's context and verifies the
 * secret half there, instead of a cross-tenant `SECURITY DEFINER` lookup. The
 * two ids select where to look; the 256-bit secret is the proof of the URL.
 */
export const MAILKETING_CALLBACK_TOKEN_VERSION = "mkw1";

/** Bound before any parsing: an anonymous endpoint must not split an arbitrary string. */
export const MAX_CALLBACK_TOKEN_LENGTH = 160;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ParsedCallbackToken = {
  tenantId: string;
  subscriptionId: string;
  secret: string;
};

export function generateCallbackSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function formatCallbackToken(
  tenantId: string,
  subscriptionId: string,
  secret: string
): string {
  return [
    MAILKETING_CALLBACK_TOKEN_VERSION,
    tenantId,
    subscriptionId,
    secret
  ].join(".");
}

/** `null` for anything that is not exactly the format above. Never throws. */
export function parseCallbackToken(value: unknown): ParsedCallbackToken | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CALLBACK_TOKEN_LENGTH
  ) {
    return null;
  }

  const parts = value.split(".");

  if (parts.length !== 4 || parts[0] !== MAILKETING_CALLBACK_TOKEN_VERSION) {
    return null;
  }

  const [, tenantId, subscriptionId, secret] = parts as [
    string,
    string,
    string,
    string
  ];

  if (
    !UUID_PATTERN.test(tenantId) ||
    !UUID_PATTERN.test(subscriptionId) ||
    !SECRET_PATTERN.test(secret)
  ) {
    return null;
  }

  return { tenantId, subscriptionId, secret };
}

/**
 * What `awcms_channel_webhook_subscriptions.callback_token_hash` stores
 * (`sha256:<hex>`, the table's CHECK). Bound to the tenant and subscription, so
 * a secret copied onto another subscription id verifies nothing.
 */
export function hashCallbackSecret(
  tenantId: string,
  subscriptionId: string,
  secret: string
): string {
  return `sha256:${createHash("sha256")
    .update(`awcms:email-webhook:v1:${tenantId}:${subscriptionId}:${secret}`)
    .digest("hex")}`;
}

/** The same SHAPE as a stored hash, so an unknown subscription costs the same compare. */
export const DUMMY_CALLBACK_HASH = `sha256:${"0".repeat(64)}`;

/** Constant time over the bytes of two `sha256:<hex>` strings of equal shape. */
export function callbackHashesEqual(
  stored: string,
  candidate: string
): boolean {
  const left = Buffer.from(stored, "utf8");
  const right = Buffer.from(candidate, "utf8");

  if (left.length !== right.length) {
    // Still spend a comparison so the length mismatch is not a faster answer.
    timingSafeEqual(right, right);
    return false;
  }

  return timingSafeEqual(left, right);
}

/** A short, non-sensitive handle an administrator can recognise a URL by. */
export function callbackTokenPrefix(secret: string): string {
  return secret.slice(0, 6);
}

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------

/** A Mailketing request carries one event; an array is accepted up to this. */
export const MAX_EVENTS_PER_REQUEST = 25;

/** The webhook's own body cap, far below the API default: an event is a few hundred bytes. */
export const MAILKETING_WEBHOOK_MAX_BODY_BYTES = 32 * 1024;

export type BounceClass = "hard" | "soft" | "unknown";

export type ProviderEventType =
  "bounce" | "open" | "click" | "unsubscribe" | "delivered";

export type NormalizedProviderEvent =
  | {
      type: "bounce";
      providerMessageId: string;
      recipient: string;
      bounceClass: BounceClass;
      statusCode: string | null;
      reportedAtRaw: string | null;
    }
  | {
      type: "open" | "delivered";
      providerMessageId: string;
      recipient: string;
      reportedAtRaw: string | null;
    }
  | {
      type: "click";
      recipient: string;
      linkHost: string;
      linkHash: string;
      reportedAtRaw: string | null;
    }
  | {
      type: "unsubscribe";
      recipient: string;
      reportedAtRaw: string | null;
    };

/** Why an event was not recorded. Fixed codes: never provider text. */
export type IgnoredEventReason =
  "newsubscriber_ignored" | "unknown_type" | "invalid_event";

export type ParsedProviderEvent =
  | { ok: true; event: NormalizedProviderEvent }
  | { ok: false; reason: IgnoredEventReason };

const EMAIL_PATTERN = /^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,253}$/;
const PROVIDER_MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:@<>+=/-]{1,128}$/;
const MAX_DATE_LENGTH = 64;
const MAX_LINK_LENGTH = 2048;
const MAX_REASON_LENGTH = 1024;

function readEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  return trimmed.length <= 254 && EMAIL_PATTERN.test(trimmed) ? trimmed : null;
}

function readProviderMessageId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }

  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  return PROVIDER_MESSAGE_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function readDate(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();

  return trimmed.length > 0 && trimmed.length <= MAX_DATE_LENGTH
    ? trimmed
    : null;
}

/**
 * Hard / soft / unknown from the remote MTA's diagnostic, which is then
 * DISCARDED. An enhanced status code (RFC 3463) decides when present; then a
 * basic SMTP reply code; then a few unambiguous phrases. Anything else is
 * `unknown`, which is treated like `soft` (it needs the threshold before an
 * operator may suppress on it): over-suppressing on a misread reason is the
 * expensive mistake, a missed suppression is one more bounce.
 */
export function classifyBounceReason(reason: unknown): {
  bounceClass: BounceClass;
  statusCode: string | null;
} {
  if (typeof reason !== "string" || reason.length === 0) {
    return { bounceClass: "unknown", statusCode: null };
  }

  const text = reason.slice(0, MAX_REASON_LENGTH);
  const enhanced = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/.exec(text);

  if (enhanced) {
    const statusCode = `${enhanced[1]}.${enhanced[2]}.${enhanced[3]}`;

    if (enhanced[1] === "5") return { bounceClass: "hard", statusCode };
    if (enhanced[1] === "4") return { bounceClass: "soft", statusCode };

    return { bounceClass: "unknown", statusCode };
  }

  const basic = /\b([45])\d\d\b/.exec(text);

  if (basic) {
    return {
      bounceClass: basic[1] === "5" ? "hard" : "soft",
      statusCode: null
    };
  }

  if (
    /user unknown|no such user|does not exist|unknown recipient|invalid recipient|recipient rejected|mailbox unavailable|address rejected/i.test(
      text
    )
  ) {
    return { bounceClass: "hard", statusCode: null };
  }

  if (
    /mailbox full|over quota|quota exceeded|temporar|try again later|deferred/i.test(
      text
    )
  ) {
    return { bounceClass: "soft", statusCode: null };
  }

  return { bounceClass: "unknown", statusCode: null };
}

/**
 * The host and a hash of a clicked link, or `null` when it is not an absolute
 * http(s) URL. The URL is never stored, rendered as a link, or fetched.
 */
export function summarizeClickedLink(
  value: unknown
): { linkHost: string; linkHash: string } | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length > MAX_LINK_LENGTH) return null;

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const host = url.hostname.toLowerCase();

  if (!/^[a-z0-9.-]{1,253}$/.test(host)) return null;

  return {
    linkHost: host,
    linkHash: createHash("sha256").update(url.href).digest("hex")
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** One event object. Never throws; never echoes provider text. */
export function parseMailketingEvent(value: unknown): ParsedProviderEvent {
  const record = asRecord(value);

  if (!record || typeof record.type !== "string") {
    return { ok: false, reason: "invalid_event" };
  }

  switch (record.type) {
    case "newsubscriber":
      // ADR-0151 section 5: it must never create a subscriber or consent, so it
      // is not even stored.
      return { ok: false, reason: "newsubscriber_ignored" };

    case "bounce": {
      const recipient = readEmail(record.email);
      const providerMessageId = readProviderMessageId(record.message_id);

      if (!recipient || !providerMessageId) {
        return { ok: false, reason: "invalid_event" };
      }

      return {
        ok: true,
        event: {
          type: "bounce",
          providerMessageId,
          recipient,
          ...classifyBounceReason(record.reason),
          reportedAtRaw: readDate(record.date)
        }
      };
    }

    case "emailopen": {
      const recipient = readEmail(record.email);
      const providerMessageId = readProviderMessageId(record.message_id);

      if (!recipient || !providerMessageId) {
        return { ok: false, reason: "invalid_event" };
      }

      return {
        ok: true,
        event: {
          type: "open",
          providerMessageId,
          recipient,
          reportedAtRaw: readDate(record.date)
        }
      };
    }

    case "delivered": {
      const recipient = readEmail(record.rcpt);
      const providerMessageId = readProviderMessageId(record.jobid);

      if (!recipient || !providerMessageId) {
        return { ok: false, reason: "invalid_event" };
      }

      return {
        ok: true,
        event: {
          type: "delivered",
          providerMessageId,
          recipient,
          reportedAtRaw: readDate(record.send_time)
        }
      };
    }

    case "emailclick": {
      const recipient = readEmail(record.email);
      const link = summarizeClickedLink(record.link_clicked);

      if (!recipient || !link) return { ok: false, reason: "invalid_event" };

      return {
        ok: true,
        event: {
          type: "click",
          recipient,
          ...link,
          reportedAtRaw: readDate(record.date)
        }
      };
    }

    case "unsubscribe": {
      const recipient = readEmail(record.email);

      if (!recipient) return { ok: false, reason: "invalid_event" };

      return {
        ok: true,
        event: {
          type: "unsubscribe",
          recipient,
          reportedAtRaw: readDate(record.date)
        }
      };
    }

    default:
      return { ok: false, reason: "unknown_type" };
  }
}

/**
 * The request body: one event object, or an array of at most
 * `MAX_EVENTS_PER_REQUEST`. `null` is a malformed request (refused as a whole).
 */
export function parseMailketingWebhookBody(
  value: unknown
): ParsedProviderEvent[] | null {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.length > MAX_EVENTS_PER_REQUEST) {
      return null;
    }

    return value.map(parseMailketingEvent);
  }

  if (asRecord(value) === null) return null;

  return [parseMailketingEvent(value)];
}

/** Reports older than this are discarded as stale (a replay of old traffic). */
export const MAX_REPORT_AGE_DAYS = 30;

/**
 * The provider's timestamp. Mailketing documents the open time as UTC and gives
 * no format; a `YYYY-MM-DD HH:MM[:SS]` value without a zone is read as UTC.
 *
 * - `value: null, outOfWindow: false` — absent or unreadable: "unknown", never
 *   "now"; the event is still recorded (dedupe then rests on the raw text).
 * - `outOfWindow: true` — a readable date more than 5 minutes in the future or
 *   older than `MAX_REPORT_AGE_DAYS`: the event is discarded as stale.
 */
export function parseReportedAt(
  raw: string | null,
  now: Date,
  maxAgeDays = MAX_REPORT_AGE_DAYS
): { value: Date | null; outOfWindow: boolean } {
  if (raw === null) return { value: null, outOfWindow: false };

  const isoLike =
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?$/.test(raw)
      ? `${raw.replace(" ", "T")}Z`
      : raw;
  const parsed = new Date(isoLike);

  if (Number.isNaN(parsed.getTime())) {
    return { value: null, outOfWindow: false };
  }

  const ms = parsed.getTime();

  if (
    ms > now.getTime() + 5 * 60_000 ||
    ms < now.getTime() - maxAgeDays * 86_400_000
  ) {
    return { value: null, outOfWindow: true };
  }

  return { value: parsed, outOfWindow: false };
}

/**
 * ADR-0151 section 5's replay key: account, event type, provider message id,
 * recipient hash and the provider's own timestamp text. Two deliveries of the
 * same report collapse to one row; two genuinely different reports (another
 * time) do not.
 */
export function providerEventDedupeKey(input: {
  espAccountId: string;
  type: ProviderEventType;
  providerMessageId: string | null;
  recipientHash: string;
  reportedAtRaw: string | null;
  linkHash?: string | null;
}): string {
  return createHash("sha256")
    .update(
      [
        "awcms:email-provider-event:v1",
        input.espAccountId,
        input.type,
        input.providerMessageId ?? "",
        input.recipientHash,
        input.reportedAtRaw ?? "",
        input.linkHash ?? ""
      ].join("\u0000")
    )
    .digest("hex");
}
