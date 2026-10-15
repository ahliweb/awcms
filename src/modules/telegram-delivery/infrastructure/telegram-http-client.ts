/**
 * The one outbound HTTP seam for the Telegram adapter (Issue #965, ADR-0140
 * section 5). Every network call goes through `ssrfSafeFetch`, never bare
 * `fetch`, and only to `api.telegram.org`: the host is a constant here, not
 * configuration, and the caller supplies a METHOD NAME and a JSON body, never a
 * URL.
 *
 * ## The token never leaves this file as part of a URL
 *
 * The Bot API puts the token in the request path. The URL is therefore built
 * HERE, from the token and a method name, and is never returned, logged or
 * thrown. What leaves is a status, a body and, on a refusal, a reason code that
 * `ssrfSafeFetch` produced (`blocked_address`, `request_failed`, ...), none of
 * which contains the URL. The adapter still redacts everything it forwards
 * (`telegram-redaction.ts`), because a fake client in a test, or a future guard
 * that echoes the URL, must not be able to reintroduce the leak.
 *
 * The seam is a TYPE so tests drive the adapter without network access and
 * without defeating the guard.
 */
import { ssrfSafeFetch } from "../../../lib/auth/ssrf-guard";
import { TELEGRAM_BOT_TOKEN_PATTERN } from "../domain/telegram-config";
import {
  TELEGRAM_API_HOST,
  TELEGRAM_API_ORIGIN
} from "../domain/telegram-constants";

export type TelegramBotMethod = "sendMessage" | "setWebhook" | "deleteWebhook";

export type TelegramHttpRequest = {
  method: TelegramBotMethod;
  /** Serialised JSON object. */
  body: string;
  timeoutMs: number;
};

export type TelegramHttpResult =
  { ok: true; status: number; body: string } | { ok: false; reason: string };

/** `token` is passed per call so it is never held in a long-lived closure beyond the adapter's own. */
export type TelegramHttpClient = (
  token: string,
  request: TelegramHttpRequest
) => Promise<TelegramHttpResult>;

const MAX_RESPONSE_BYTES = 64 * 1024;

/** A non-2xx is a RESPONSE (the adapter maps it); only a guard denial or network error is `ok: false`. */
export const defaultTelegramHttpClient: TelegramHttpClient = async (
  token,
  request
) => {
  // The token goes into a URL PATH. A value that is not a bot token's exact
  // shape (a `/`, `@`, `?` or `#` in it) could re-point the request, so it is
  // refused before a URL exists, and the URL is checked once more after it is built.
  if (!TELEGRAM_BOT_TOKEN_PATTERN.test(token)) {
    return {
      ok: false,
      reason: "outbound request refused: invalid_credential"
    };
  }

  const url = `${TELEGRAM_API_ORIGIN}/bot${token}/${request.method}`;

  if (new URL(url).hostname !== TELEGRAM_API_HOST) {
    return { ok: false, reason: "outbound request refused: host_not_pinned" };
  }

  const result = await ssrfSafeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: request.body,
    timeoutMs: request.timeoutMs,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    // The Bot API never redirects a method call. A 30x is therefore either a
    // fault or an attempt to move the request (token in the path) to another
    // host, so none is followed: it surfaces as a refused request.
    maxRedirects: 0
  });

  if (!result.ok) {
    return { ok: false, reason: `outbound request refused: ${result.reason}` };
  }

  return {
    ok: true,
    status: result.response.status,
    body: await result.response.text()
  };
};
