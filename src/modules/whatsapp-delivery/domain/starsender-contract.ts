/**
 * StarSender wire contract (Issue #1142, ADR-0148 section 4 and 7; the points that go beyond ADR-0148 are the Proposed ADR-0158). Pure: no I/O,
 * so every verdict below is a table a test can walk without a network.
 *
 * ## What is evidenced, and what is not
 *
 * Evidence is ONE public page, https://docs.starsender.online/docs/message-api/kirim-pesan/
 * (read 3 November 2026, not exercised against the live API):
 *
 *   POST https://api.starsender.online/api/send
 *   Authorization: <device API key>                (raw value, no scheme)
 *   { "messageType": "text" | "media", "to": "...", "body": "...", ... }
 *   success: { "success": true, "data": {}, "message": "Success sent message" }
 *
 * The page documents NO error response, NO rate limit, NO message id in `data`,
 * NO device-status call and NO webhook authentication. This file therefore:
 *
 *   * validates the one shape it knows (`success` boolean, `message` string when
 *     present) and treats anything else as MALFORMED, never as success;
 *   * classifies failures from the HTTP status first and from `message` text only
 *     for reversible verdicts (hold the lane, retry later), never to create a
 *     permanent verdict against a recipient (the Fonnte audit F7 lesson);
 *   * treats ANY 5xx, like a timeout, as an UNKNOWN outcome and never as a
 *     refusal: a failing gateway may already have forwarded the message, and with
 *     no idempotency key a retry could message the recipient twice;
 *   * returns NO provider message id (the field is unevidenced); a success is
 *     "accepted by StarSender", never "delivered" or "read";
 *   * never copies provider text into an error: each failure carries a FIXED
 *     sentence for its code, so a reply that echoes the device key, the number or
 *     the body cannot reach a log, an attempt row, an event or a screen.
 *
 * Every field name here must be re-checked against the live API before a
 * production rollout (docs/awcms/starsender-adapter-runbook.md).
 */
import type { WhatsappSendResult } from "./whatsapp-provider-contract";

export const STARSENDER_SEND_URL = "https://api.starsender.online/api/send";

/** The ONLY origin the adapter will talk to. The URL is a constant, never read from a record, a request or the environment. */
export const STARSENDER_ALLOWED_ORIGIN = "https://api.starsender.online";

/** Codes the adapter can return, all coarse and non-sensitive. */
export const STARSENDER_FAILURE_CODES = [
  "network_error",
  "endpoint_refused",
  "unexpected_redirect",
  "outcome_unknown",
  "rate_limited",
  "unauthorized",
  "device_disconnected",
  "rejected",
  "malformed_response",
  "recipient_unusable"
] as const;

export type StarsenderFailureCode = (typeof STARSENDER_FAILURE_CODES)[number];

type Failure = Extract<WhatsappSendResult, { ok: false }>;

const FIXED_ERROR: Readonly<Record<StarsenderFailureCode, string>> = {
  network_error: "StarSender could not be reached; the request was not sent.",
  endpoint_refused: "The outbound request to StarSender was refused.",
  unexpected_redirect:
    "StarSender answered with a redirect; it was not followed and the device key was not forwarded.",
  outcome_unknown:
    "The request may have reached StarSender and its outcome is unknown; it was not retried, to avoid a duplicate message.",
  rate_limited: "StarSender limited the request rate.",
  unauthorized: "StarSender rejected the configured device key.",
  device_disconnected: "StarSender reported that the device is not connected.",
  rejected: "StarSender rejected the message.",
  malformed_response:
    "StarSender answered in a shape this adapter does not recognise.",
  recipient_unusable:
    "The recipient number is not in a form StarSender accepts."
};

/** Which codes may be retried later. The dispatcher also bounds them by `WHATSAPP_SEND_MAX_RETRIES`. */
const RETRYABLE: ReadonlySet<StarsenderFailureCode> = new Set([
  "network_error",
  "rate_limited",
  "device_disconnected"
]);

export function starsenderFailure(code: StarsenderFailureCode): Failure {
  return {
    ok: false,
    error: FIXED_ERROR[code],
    retryable: RETRYABLE.has(code),
    failureCode: code
  };
}

/** Whether a failed send counts against the device's circuit breaker (provider ill-health), as opposed to a verdict about one message or credential. */
export function starsenderFailureFeedsBreaker(code: string): boolean {
  switch (code) {
    case "network_error":
    case "outcome_unknown":
    case "rate_limited":
    case "device_disconnected":
    case "malformed_response":
    case "unexpected_redirect":
      return true;
    default:
      return false;
  }
}

/** The request body, from a rendered WhatsApp message. `to` is digits only (E.164 without `+`), the form the docs describe. */
export function buildStarsenderRequestBody(input: {
  to: string;
  body: string;
}): string | null {
  const to = input.to.replace(/^\+/, "");

  if (!/^[1-9]\d{7,14}$/.test(to) || input.body.trim() === "") return null;

  return JSON.stringify({ messageType: "text", to, body: input.body });
}

/** A device API key must be a printable header value: no whitespace or control characters (header injection) and a sane length. */
export function isPlausibleStarsenderDeviceKey(key: string): boolean {
  return /^[\x21-\x7e]{8,512}$/.test(key);
}

/**
 * A transport failure from the shared outbound seam
 * (`outbound request refused: <ssrf reason>`), classified by what it proves about
 * whether the request left this host:
 *
 *   * `dns_resolution_failed`: it did not. Safe to retry.
 *   * `blocked_address`, `invalid_url`, `scheme_not_allowed`,
 *     `credentials_in_url`: it did not, and retrying cannot help (configuration).
 *   * `too_many_redirects`: a redirect (`maxRedirects` is 0) was refused, not
 *     followed, so the device key never left for another host.
 *   * anything else (`request_failed`: a timeout, a reset, a body that never
 *     finished; `response_too_large`): the request MAY have been processed. StarSender
 *     documents no idempotency key, so a retry could message the recipient twice:
 *     the outcome is recorded as unknown and NOT retried.
 */
export function classifyStarsenderTransportFailure(
  reason: string
): StarsenderFailureCode {
  const detail = reason.slice(reason.lastIndexOf(":") + 1).trim();

  switch (detail) {
    case "dns_resolution_failed":
      return "network_error";
    case "blocked_address":
    case "invalid_url":
    case "scheme_not_allowed":
    case "credentials_in_url":
      return "endpoint_refused";
    case "too_many_redirects":
      return "unexpected_redirect";
    default:
      return "outcome_unknown";
  }
}

type ParsedBody =
  | { shape: "valid"; success: boolean; message: string }
  | { shape: "malformed" };

/** The response schema this adapter knows: a JSON object with a boolean `success`, an optional string `message`, and an optional `data`. */
export function parseStarsenderBody(text: string): ParsedBody {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return { shape: "malformed" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { shape: "malformed" };
  }

  const record = parsed as Record<string, unknown>;

  if (typeof record.success !== "boolean") return { shape: "malformed" };

  if (record.message !== undefined && typeof record.message !== "string") {
    return { shape: "malformed" };
  }

  return {
    shape: "valid",
    success: record.success,
    message: typeof record.message === "string" ? record.message : ""
  };
}

const DEVICE_DISCONNECTED =
  /(device|perangkat|whatsapp)[^.]{0,40}(disconnect|not connected|offline|terputus|belum terhubung|tidak terhubung)|(disconnect|terputus|logged out)[^.]{0,40}(device|perangkat)/i;
const RATE_LIMITED =
  /(rate limit|too many|terlalu banyak|limit (exceeded|tercapai))/i;

/**
 * The verdict of one HTTP answer. A 2xx `success: true` is the ONLY acceptance.
 * A 2xx with `success: false` is a semantic failure (the HTTP-200 trap, as with
 * Fonnte). Statuses decide first; `message` text only picks between REVERSIBLE
 * verdicts (hold the device's lane, retry later), and a free-text match never
 * produces a recipient-level or permanent verdict.
 */
export function classifyStarsenderResponse(
  status: number,
  bodyText: string
): WhatsappSendResult {
  if (status === 401 || status === 403)
    return starsenderFailure("unauthorized");

  const body = parseStarsenderBody(bodyText);

  if (status >= 200 && status < 300) {
    if (body.shape === "malformed")
      return starsenderFailure("malformed_response");

    if (body.success) {
      // Accepted by StarSender. No message id: the field is unevidenced. NOT delivered.
      return { ok: true };
    }
  }

  if (status === 429) return starsenderFailure("rate_limited");

  // A 5xx is NOT proof that the message was refused: a gateway that crashes,
  // times out upstream or sits behind a failing proxy may already have handed the
  // message to WhatsApp (audit M3, Issue #1142). StarSender documents no
  // idempotency key, so a retry could message the recipient twice: the outcome
  // is unknown and is NOT retried, exactly like a timeout. It still counts
  // against the device's breaker. Decided before any message text, because text
  // from a failing gateway proves even less.
  if (status >= 500) return starsenderFailure("outcome_unknown");

  const message = body.shape === "valid" ? body.message : "";

  if (DEVICE_DISCONNECTED.test(message)) {
    return starsenderFailure("device_disconnected");
  }

  if (RATE_LIMITED.test(message)) return starsenderFailure("rate_limited");

  return starsenderFailure("rejected");
}
