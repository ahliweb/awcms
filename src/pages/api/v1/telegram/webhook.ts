import type { APIRoute } from "astro";

import { fail } from "../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../lib/database/client";
import { log } from "../../../../lib/logging/logger";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import {
  checkSharedRateLimit,
  refundSharedRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import {
  flushWebhookRejections,
  recordWebhookRejection,
  telegramChatRateLimitKey,
  verifyWebhookSecret
} from "../../../../modules/telegram-delivery/application/telegram-webhook-guard";
import { handleTelegramWebhookUpdate } from "../../../../modules/telegram-delivery/application/telegram-webhook";
import {
  isTelegramEnabled,
  resolveTelegramWebhookRatePerMinute,
  TELEGRAM_WEBHOOK_CHAT_RATE_PER_MINUTE
} from "../../../../modules/telegram-delivery/domain/telegram-config";
import { extractUpdateChatKey } from "../../../../modules/telegram-delivery/domain/telegram-link-code";
import { TELEGRAM_MODULE_KEY } from "../../../../modules/telegram-delivery/domain/telegram-constants";

/**
 * `POST /api/v1/telegram/webhook` (Issue #965, ADR-0140 section 7) — Telegram's
 * `message` updates. The ONLY unauthenticated-by-session route of this module,
 * which is exactly why it does so little.
 *
 * Order matters and is the contract:
 *
 * 1. **Off means 404.** Without `TELEGRAM_ENABLED=true` the route does not exist
 *    (no secret comparison, no body read, nothing to probe).
 * 2. **The secret, before anything else.** `X-Telegram-Bot-Api-Secret-Token` is
 *    compared in constant time with `TELEGRAM_WEBHOOK_SECRET`. A missing or wrong
 *    header, or an unset server secret, is a `401` with a generic envelope and
 *    no detail: no database read, no JSON parse, no size read. Repeated failures from one address are
 *    throttled to a `429`, and each is counted for the aggregated audit record.
 * 3. **The body limit** (the `api:body-limit` gate's reader), then a **per-chat
 *    rate limit** (Issue #1008: an over-limit chat gets `200` with no reply and
 *    spends nothing else), then a **coarse per-address rate limit**. The order is
 *    deliberate: Telegram calls from few addresses, so a per-address bucket
 *    consulted first lets one noisy chat 429 everyone.
 * 4. **Two commands only**, from a private chat (`telegram-webhook.ts`).
 *    Everything else is `200` with no reply.
 *
 * No tenant is in the path or trusted from the payload: the tenant comes from the
 * code row or the binding found by the chat's keyed hash.
 *
 * The reply to `/start` and `/stop` is the HTTP RESPONSE to this request (the Bot
 * API's webhook-reply form), not a call this process makes: it holds no bot token
 * and calls no provider. The chat id in that response is Telegram's own, handed
 * straight back to it, and is never logged.
 *
 * Replay needs no update-id store (Issue #1008 re-checked this with the PIN in
 * the picture): a code is consumed atomically, so a replayed `/start` finds it
 * consumed and cannot mint a second PIN or binding; `/stop` on a revoked binding
 * is a no-op. Both commands are idempotent by construction. The one cost is that
 * if Telegram retries a `/start` after the first reply was lost, the retry is
 * answered "code not valid" and the person requests a new link. (Stated so a
 * reviewer does not add a store by reflex.)
 */
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Every refusal is the repo's standard error envelope with a GENERIC code and
 * sentence: it says no more than the status line already did (no hint of which
 * check failed, which header, which setting), and it keeps the contract gate's
 * "every 4xx/5xx is an ApiError" rule true for this route too.
 */
const refuse = (
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>
): Response => fail(status, code, message, {}, undefined, headers);

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!isTelegramEnabled()) {
    return refuse(404, "NOT_FOUND", "Not found.");
  }

  const client = resolveClientIp(request, clientAddress);
  const presented = request.headers.get(SECRET_HEADER);

  if (!verifyWebhookSecret(presented, process.env.TELEGRAM_WEBHOOK_SECRET)) {
    recordWebhookRejection(
      presented === null ? "header_absent" : "header_mismatch"
    );

    // Best effort and never awaited: a rejection must not wait on a database.
    void flushWebhookRejections(getDatabaseClient).catch(() => undefined);

    // Throttle guessing without doing any real work for it. The shared limiter
    // (Redis when configured, the in-process map otherwise) touches no
    // database, and a guess cannot be spread across instances to get around it.
    const throttle = await checkSharedRateLimit(
      `telegram-webhook-denied:${client}`,
      { maxAttempts: 30, windowMs: 60_000 }
    );

    return throttle.allowed
      ? refuse(401, "UNAUTHORIZED", "Unauthorized.")
      : refuse(429, "RATE_LIMITED", "Too many requests.", {
          "retry-after": String(throttle.retryAfterSec)
        });
  }

  // The body is read BEFORE the per-address bucket (it is bounded by the body
  // limit, and the secret already verified), because the per-chat bucket needs the
  // chat and must run first: Telegram calls from a handful of addresses, so if a
  // noisy chat counted against the shared per-address bucket it would cause the
  // 429s for everyone that the per-chat bucket exists to prevent.
  const body = await readJsonBody(request);

  if (body.tooLarge) {
    recordWebhookRejection("too_large");

    return bodyTooLargeResponse(body.limitBytes);
  }

  if (body.malformed || body.value === null) {
    recordWebhookRejection("malformed");

    return refuse(400, "VALIDATION_ERROR", "Invalid request.");
  }

  // Per-chat bucket (Issue #1008, L3). A chat over its ceiling is answered `200`
  // with nothing, never a `429`: Telegram would retry a refusal, and the point is
  // that one noisy user does not hurt anyone else. It also does not spend the
  // per-address allowance. The limiter fails OPEN on a Redis outage, so this is a
  // fairness control and not a security boundary: what bounds abuse regardless is
  // the secret check above, the database-counted PIN attempts and the 256-bit
  // link code.
  const chatKey = extractUpdateChatKey(body.value);
  const chatBucket = {
    maxAttempts: TELEGRAM_WEBHOOK_CHAT_RATE_PER_MINUTE,
    windowMs: 60_000
  };
  const chatBucketKey =
    chatKey === null
      ? null
      : telegramChatRateLimitKey(
          chatKey,
          process.env.TELEGRAM_WEBHOOK_SECRET ?? ""
        );

  if (chatBucketKey !== null) {
    const chatLimit = await checkSharedRateLimit(chatBucketKey, chatBucket);

    if (!chatLimit.allowed) {
      recordWebhookRejection("chat_rate_limited");

      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store"
        }
      });
    }
  }

  const limit = await checkSharedRateLimit(`telegram-webhook:${client}`, {
    maxAttempts: resolveTelegramWebhookRatePerMinute(),
    windowMs: 60_000
  });

  if (!limit.allowed) {
    recordWebhookRejection("rate_limited");

    // Telegram retries a 429. The charge above bought a request that did no
    // work, so give it back: otherwise the retries burn the chat's allowance
    // and a later `/start` is dropped with no PIN (audit L1).
    if (chatBucketKey !== null) {
      await refundSharedRateLimit(chatBucketKey, chatBucket);
    }

    return refuse(429, "RATE_LIMITED", "Too many requests.", {
      "retry-after": String(limit.retryAfterSec)
    });
  }

  try {
    const result = await handleTelegramWebhookUpdate(
      getDatabaseClient,
      body.value,
      {
        correlationId: crypto.randomUUID()
      }
    );

    if (result.reply === null || result.replyChatId === null) {
      return new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store"
        }
      });
    }

    return new Response(
      JSON.stringify({
        method: "sendMessage",
        chat_id: result.replyChatId,
        text: result.reply,
        disable_web_page_preview: true,
        protect_content: true
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store"
        }
      }
    );
  } catch (error) {
    // Telegram retries a non-2xx; both commands are idempotent, so a retry is
    // safe. Name only: an error message could carry a value from the request.
    log("error", "telegram.webhook.failed", {
      moduleKey: TELEGRAM_MODULE_KEY,
      error: error instanceof Error ? error.name : "unknown"
    });

    return refuse(503, "SERVICE_UNAVAILABLE", "Try again later.", {
      "retry-after": "5"
    });
  }
};
