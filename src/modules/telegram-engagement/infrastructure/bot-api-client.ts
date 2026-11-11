/**
 * The ONE outbound HTTP seam of `telegram_engagement` (ADR-0152 sections 3 and
 * 5). Its own copy, not `telegram_delivery`'s (TG1).
 *
 * Every call goes through `ssrfSafeFetch` to the constant host
 * `api.telegram.org`, under a timeout, with no redirect followed (a 30x is either
 * a fault or an attempt to move a request whose PATH holds the token). The
 * caller supplies a method name from a closed list and a JSON body, never a URL.
 *
 * ## The token never leaves this file
 *
 * The URL is built here from the token and the method name and is never
 * returned, logged or thrown. What leaves is a parsed outcome with fixed codes;
 * any provider text is passed through `redactProviderText` first, so a test
 * fake or a future guard that echoes the URL cannot reintroduce the leak.
 *
 * ## Delivery uncertainty
 *
 * A guard refusal happens before anything is sent (`not_sent`). A network error
 * or timeout may happen AFTER Telegram accepted the message, so it is
 * `uncertain` and the dispatcher never blindly retries it (ADR-0152 TG10).
 */
import { ssrfSafeFetch } from "../../../lib/auth/ssrf-guard";
import {
  BOT_TOKEN_PATTERN,
  redactProviderText
} from "../domain/telegram-engagement-redaction";

export const TELEGRAM_API_HOST = "api.telegram.org";
const TELEGRAM_API_ORIGIN = "https://api.telegram.org";
const MAX_RESPONSE_BYTES = 64 * 1024;
export const DEFAULT_TIMEOUT_MS = 10_000;

export type BotApiMethod =
  | "getMe"
  | "setWebhook"
  | "deleteWebhook"
  | "getWebhookInfo"
  | "sendMessage"
  | "answerCallbackQuery";

export type BotApiOutcome =
  | { kind: "ok"; result: unknown }
  /** Telegram answered `ok: false` (or a non-2xx); `errorCode` is its numeric code. */
  | {
      kind: "error";
      httpStatus: number;
      errorCode: number | null;
      retryAfterSeconds: number | null;
      /** Redacted, bounded; for a stored diagnostic code mapping only. */
      description: string;
    }
  /** Nothing left this process (a guard refusal or a malformed token). */
  | { kind: "not_sent"; reason: string }
  /** The request may or may not have reached Telegram (network error, timeout). */
  | { kind: "uncertain"; reason: string };

export type BotApiTransport = (
  token: string,
  method: BotApiMethod,
  body: Record<string, unknown>,
  timeoutMs: number
) => Promise<BotApiOutcome>;

function parseEnvelope(
  status: number,
  text: string,
  token: string
): BotApiOutcome {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      kind: "error",
      httpStatus: status,
      errorCode: null,
      retryAfterSeconds: null,
      description: redactProviderText(text, token)
    };
  }

  const record =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};

  if (record.ok === true && status >= 200 && status < 300) {
    return { kind: "ok", result: record.result };
  }

  const parameters =
    typeof record.parameters === "object" && record.parameters !== null
      ? (record.parameters as Record<string, unknown>)
      : {};
  const retryAfter = parameters.retry_after;

  return {
    kind: "error",
    httpStatus: status,
    errorCode: typeof record.error_code === "number" ? record.error_code : null,
    retryAfterSeconds:
      typeof retryAfter === "number" && retryAfter > 0 && retryAfter <= 86_400
        ? Math.ceil(retryAfter)
        : null,
    description: redactProviderText(
      typeof record.description === "string" ? record.description : "",
      token
    )
  };
}

export const defaultBotApiTransport: BotApiTransport = async (
  token,
  method,
  body,
  timeoutMs
) => {
  // The token goes into a URL PATH: anything but its exact shape could re-point
  // the request, so it is refused before a URL exists.
  if (!BOT_TOKEN_PATTERN.test(token)) {
    return { kind: "not_sent", reason: "INVALID_CREDENTIAL_SHAPE" };
  }

  const url = `${TELEGRAM_API_ORIGIN}/bot${token}/${method}`;

  if (new URL(url).hostname !== TELEGRAM_API_HOST) {
    return { kind: "not_sent", reason: "HOST_NOT_PINNED" };
  }

  const result = await ssrfSafeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    maxRedirects: 0
  });

  if (!result.ok) {
    // `request_failed` covers a timeout and a dropped connection, either of
    // which can follow a request Telegram already accepted.
    // A response too large to read was still a response to a sent request.
    return result.reason === "request_failed" ||
      result.reason === "response_too_large"
      ? { kind: "uncertain", reason: "REQUEST_FAILED" }
      : { kind: "not_sent", reason: "OUTBOUND_REFUSED" };
  }

  return parseEnvelope(
    result.response.status,
    await result.response.text(),
    token
  );
};

/** For tests: builds an outcome exactly as the default transport would. */
export function parseBotApiResponseForTests(
  status: number,
  text: string,
  token: string
): BotApiOutcome {
  return parseEnvelope(status, text, token);
}
