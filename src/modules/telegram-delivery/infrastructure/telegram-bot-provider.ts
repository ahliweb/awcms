/**
 * Telegram Bot API adapter (Issue #965, ADR-0140 section 5) — `sendMessage` only.
 *
 * ## What is sent, and what never is
 *
 * - **Plain text.** No `parse_mode`, ever, so a variable cannot inject Markdown or
 *   HTML into a staff message.
 * - `disable_web_page_preview: true` (and `link_preview_options.is_disabled`, the
 *   Bot API 7 spelling; a client that knows only one honours it) and
 *   `protect_content: true` (best effort against forwarding).
 * - **No token in any output.** The token is in the URL path; the HTTP seam builds
 *   the URL and never returns it, and every string leaving this file passes
 *   `redactProviderText` — including text from a `catch`, a refusal reason, a
 *   Telegram `description`, and a fake client's error in a test.
 *
 * ## Rate rules, in the adapter because they are Telegram's
 *
 * - A **global pacer**: no two `sendMessage` calls start less than
 *   `1000 / TELEGRAM_RATE_GLOBAL_PER_SECOND` ms apart in this process, which is
 *   what keeps a bot under 30 messages a second regardless of how many tenants a
 *   dispatch run drains (ADR-0140 section 5.4).
 * - A **`429` pause**: `parameters.retry_after` (or the `Retry-After` header) arms
 *   a deadline; until it passes, `send` answers `rate_limited` WITHOUT touching
 *   the network, so every remaining row in the pass backs off instead of
 *   hammering. This is "opens the circuit for the adapter".
 *
 * Only the adapter feeds the circuit breaker. A per-message rejection (`400`, a
 * blocked chat) is a message outcome, not provider ill-health.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTimeout } from "../../../lib/integration/timeout";
import { TELEGRAM_CIRCUIT_BREAKER_KEY } from "../domain/telegram-constants";
import type {
  TelegramHealthResult,
  TelegramProvider,
  TelegramSendRequest,
  TelegramSendResult
} from "../domain/telegram-provider-contract";
import { redactProviderText } from "../domain/telegram-redaction";
import {
  defaultTelegramHttpClient,
  type TelegramHttpClient
} from "./telegram-http-client";

export type TelegramBotProviderOptions = {
  token: string;
  timeoutMs: number;
  /** Minimum spacing between two sends, from `TELEGRAM_RATE_GLOBAL_PER_SECOND`. */
  minSendIntervalMs: number;
  /** Upper bound on any honoured `retry_after`. */
  retryAfterCapSeconds: number;
  http?: TelegramHttpClient;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

type TelegramErrorBody = {
  description?: unknown;
  error_code?: unknown;
  parameters?: { retry_after?: unknown };
};

function readBody(text: string): {
  ok: boolean;
  messageId?: string;
  description: string;
  retryAfter?: number;
} {
  try {
    const parsed = JSON.parse(text) as TelegramErrorBody & {
      ok?: unknown;
      result?: { message_id?: unknown };
    };
    const messageId = parsed.result?.message_id;
    const retryAfter = parsed.parameters?.retry_after;

    return {
      ok: parsed.ok === true,
      ...(typeof messageId === "number" && Number.isSafeInteger(messageId)
        ? { messageId: String(messageId) }
        : {}),
      description:
        typeof parsed.description === "string" ? parsed.description : "",
      ...(typeof retryAfter === "number" && Number.isFinite(retryAfter)
        ? { retryAfter }
        : {})
    };
  } catch {
    return { ok: false, description: "" };
  }
}

/**
 * Blocked bot, deleted user, or a chat Telegram does not know. The binding is
 * dead, not the message.
 */
function isBindingUnreachable(status: number, description: string): boolean {
  if (status === 403) {
    return true;
  }

  return (
    status === 400 &&
    /chat not found|user is deactivated|PEER_ID_INVALID|bot was blocked|bot can't initiate/i.test(
      description
    )
  );
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createTelegramBotProvider(
  options: TelegramBotProviderOptions
): TelegramProvider {
  const http = options.http ?? defaultTelegramHttpClient;
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? defaultSleep;
  const breaker = getProviderCircuitBreaker(TELEGRAM_CIRCUIT_BREAKER_KEY);
  const clean = (text: string) => redactProviderText(text, options.token);

  let nextSendNotBefore = 0;
  let pausedUntil = 0;

  /** Reserves the next send slot and waits for it. Reservation happens BEFORE the wait so concurrent callers queue. */
  async function pace(): Promise<void> {
    const at = Math.max(now().getTime(), nextSendNotBefore);

    nextSendNotBefore = at + options.minSendIntervalMs;

    const wait = at - now().getTime();

    if (wait > 0) {
      await sleep(wait);
    }
  }

  return {
    async send(request: TelegramSendRequest): Promise<TelegramSendResult> {
      const attemptedAt = now();

      if (pausedUntil > attemptedAt.getTime()) {
        return {
          ok: false,
          error: "Telegram asked this bot to slow down.",
          retryable: true,
          failureCode: "rate_limited",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((pausedUntil - attemptedAt.getTime()) / 1000)
          )
        };
      }

      await pace();

      let response: Awaited<ReturnType<TelegramHttpClient>>;

      try {
        response = await withTimeout(
          http(options.token, {
            method: "sendMessage",
            body: JSON.stringify({
              chat_id: request.chatId,
              text: request.text,
              disable_web_page_preview: true,
              link_preview_options: { is_disabled: true },
              protect_content: true
            }),
            timeoutMs: options.timeoutMs
          }),
          options.timeoutMs + 2000,
          "telegram-send"
        );
      } catch (error) {
        breaker.recordFailure(attemptedAt);

        // An exception message can carry the URL (and so the token). Only the
        // redacted form survives, and the error name tells an operator the class.
        return {
          ok: false,
          error: clean(
            error instanceof Error
              ? `${error.name}: ${error.message}`
              : "Unknown transport error."
          ),
          retryable: true,
          failureCode: "network_error"
        };
      }

      if (!response.ok) {
        breaker.recordFailure(attemptedAt);

        return {
          ok: false,
          error: clean(response.reason),
          retryable: true,
          failureCode: "network_error"
        };
      }

      const body = readBody(response.body);

      if (response.status >= 200 && response.status < 300 && body.ok) {
        breaker.recordSuccess(attemptedAt);

        return {
          ok: true,
          ...(body.messageId ? { providerMessageId: body.messageId } : {})
        };
      }

      const description = clean(body.description);

      if (response.status === 429) {
        const retryAfter = Math.min(
          Math.max(1, Math.ceil(body.retryAfter ?? 5)),
          options.retryAfterCapSeconds
        );

        pausedUntil = attemptedAt.getTime() + retryAfter * 1000;
        breaker.recordFailure(attemptedAt);

        return {
          ok: false,
          error: description || "Telegram rate limit.",
          retryable: true,
          failureCode: "rate_limited",
          retryAfterSeconds: retryAfter
        };
      }

      if (response.status >= 500) {
        breaker.recordFailure(attemptedAt);

        return {
          ok: false,
          error: description || `Telegram answered HTTP ${response.status}.`,
          retryable: true,
          failureCode: "provider_error"
        };
      }

      if (isBindingUnreachable(response.status, body.description)) {
        return {
          ok: false,
          error: description || "The chat cannot be reached.",
          retryable: false,
          failureCode: "chat_unreachable",
          bindingUnreachable: true
        };
      }

      // A wrong or revoked token answers 401 (or 404 for a malformed path). That
      // is the deployment's problem, not the message's: retry under the backoff
      // (the message expires on its own) and let the breaker stop the hammering.
      if (response.status === 401 || response.status === 404) {
        breaker.recordFailure(attemptedAt);

        return {
          ok: false,
          error: "Telegram rejected the configured bot token.",
          retryable: true,
          failureCode: "unauthorized"
        };
      }

      return {
        ok: false,
        error:
          description ||
          `Telegram rejected the message (HTTP ${response.status}).`,
        retryable: false,
        failureCode: "rejected"
      };
    },

    async healthCheck(): Promise<TelegramHealthResult> {
      return breaker.canAttempt(now())
        ? { ok: true }
        : { ok: false, error: "Circuit breaker is open." };
    }
  };
}
