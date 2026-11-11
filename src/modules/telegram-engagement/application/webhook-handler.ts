/**
 * `POST /api/v1/telegram-engagement/webhooks/{callbackToken}` (ADR-0152
 * section 4). The ONLY unauthenticated-by-session route of the module, kept in
 * the application layer so the route file is one line and the order below is
 * testable.
 *
 * Order is the contract:
 *
 *   1. **Off means 404.** Without `TELEGRAM_ENGAGEMENT_ENABLED=true` the route
 *      does not exist: no parse, no database, nothing to probe.
 *   2. **The token and the header, before the body.** A malformed token, an
 *      unknown or revoked endpoint, a wrong tenant, a missing or wrong
 *      `X-Telegram-Bot-Api-Secret-Token` and a disabled account all answer the
 *      SAME `401` (T-W1). Rejections are counted and audited once a minute in
 *      aggregate on the platform tenant; repeated FAILURES from one address
 *      are throttled to `429` (a verified request is not counted, so one
 *      tenant's busy bot cannot throttle another tenant's).
 *   3. **Body limit, then per-endpoint and per-chat buckets.** Telegram calls
 *      from few addresses, so the per-endpoint bucket is what stops one bot's
 *      flood from starving another, and an over-limit CHAT is answered `200`
 *      with nothing done (a refusal would only make Telegram retry it) --
 *      except an update that changes consent, which is never dropped.
 *   4. **Idempotent ingest** in one short transaction; `200` quickly. A
 *      database error is `503` and Telegram retries; the replay key makes the
 *      retry safe.
 *
 * The reply is `{}`, or an `answerCallbackQuery` for a consent button (the Bot
 * API's webhook-reply form, carrying only Telegram's own opaque callback id).
 * No chat id, no token and no header ever appears in a log line here.
 */
import { createHmac } from "node:crypto";

import { fail } from "../../_shared/api-response";
import { log } from "../../../lib/logging/logger";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../lib/security/request-body-limit";
import {
  checkSharedRateLimit,
  refundSharedRateLimit,
  resolveClientIp
} from "../../../lib/security/rate-limit";
import {
  isTelegramEngagementEnabled,
  resolveEndpointRatePerMinute,
  resolveTelegramEngagementRing,
  resolveWebhookRatePerMinute
} from "../domain/telegram-engagement-config";
import { TELEGRAM_ENGAGEMENT_MODULE_KEY } from "../domain/telegram-engagement-constants";
import { parseTelegramUpdate } from "../domain/update-parser";
import { parseCallbackToken } from "../domain/webhook-secrets";
import {
  flushWebhookRejections,
  ingestVerifiedUpdate,
  recordWebhookRejection,
  verifyWebhookRequest
} from "./webhook-ingest";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";
const PER_CHAT_PER_MINUTE = 30;

const json200 = (body: Record<string, unknown> = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });

const refuse = (
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>
): Response => fail(status, code, message, {}, undefined, headers);

/** The private chat id of an update, for the rate-limit key only (hashed below). */
function chatKeyOf(raw: unknown): string | null {
  const record =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  for (const key of ["message", "my_chat_member"]) {
    const part = record[key] as Record<string, unknown> | undefined;
    const chat = part?.chat as Record<string, unknown> | undefined;

    if (typeof chat?.id === "number") return String(chat.id);
  }

  const callback = record.callback_query as Record<string, unknown> | undefined;
  const from = callback?.from as Record<string, unknown> | undefined;

  return typeof from?.id === "number" ? String(from.id) : null;
}

/** `/start`, `/stop`, a block/unblock and a consent button: never rate-dropped. */
export function changesConsent(raw: unknown): boolean {
  const kind = parseTelegramUpdate(raw).kind;

  return (
    kind === "start" ||
    kind === "stop" ||
    kind === "membership" ||
    kind === "consent_button"
  );
}

export type WebhookHandlerDeps = {
  getSql: () => Bun.SQL;
  env?: NodeJS.ProcessEnv;
};

export async function handleTelegramEngagementWebhook(
  request: Request,
  rawToken: string | undefined,
  clientAddress: string | undefined,
  deps: WebhookHandlerDeps
): Promise<Response> {
  const env = deps.env ?? process.env;

  if (!isTelegramEngagementEnabled(env)) {
    return refuse(404, "NOT_FOUND", "Not found.");
  }

  const client = resolveClientIp(request, clientAddress);
  const rejected = (reason: Parameters<typeof recordWebhookRejection>[0]) => {
    recordWebhookRejection(reason);
    void flushWebhookRejections(deps.getSql).catch(() => undefined);
  };

  // The per-address bucket counts FAILED VERIFICATIONS only (audit M-3 of PR
  // #1260). Telegram calls every tenant's bots from a handful of addresses, so
  // a bucket that counted every request would let one busy (or hostile) bot
  // 429 every other tenant's bot. A request is charged here up front, so an
  // address already over its failure budget costs no database work, and the
  // charge is REFUNDED as soon as the request verifies.
  const failureBucket = `telegram-engagement-webhook-denied:${client}`;
  const failureBudget = {
    maxAttempts: resolveWebhookRatePerMinute(env),
    windowMs: 60_000
  };
  const charge = await checkSharedRateLimit(failureBucket, failureBudget);

  if (!charge.allowed) {
    rejected("rate_limited");

    return refuse(429, "RATE_LIMITED", "Too many requests.", {
      "retry-after": String(charge.retryAfterSec)
    });
  }

  const denied = (reason: Parameters<typeof recordWebhookRejection>[0]) => {
    rejected(reason);

    return refuse(401, "UNAUTHORIZED", "Unauthorized.");
  };

  const token = parseCallbackToken(rawToken);

  if (!token) return denied("token_malformed");

  // The module ring is needed to ingest; without it nothing can be stored, so
  // the request is refused like any other unverifiable one (fail closed).
  const ring = resolveTelegramEngagementRing(env);

  if (!ring.ok) return denied("endpoint_unknown");

  let verification;

  try {
    verification = await verifyWebhookRequest(
      deps.getSql(),
      token,
      request.headers.get(SECRET_HEADER)
    );
  } catch (error) {
    log("error", "telegram_engagement.webhook.verify_failed", {
      moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
      error: error instanceof Error ? error.name : "unknown"
    });

    return refuse(503, "SERVICE_UNAVAILABLE", "Try again later.", {
      "retry-after": "5"
    });
  }

  if (!verification.ok) return denied(verification.reason);

  // Verified: this request was not a failure, so it does not stay charged.
  await refundSharedRateLimit(failureBucket, failureBudget);

  const endpoint = verification.endpoint;
  const endpointLimit = await checkSharedRateLimit(
    `telegram-engagement-endpoint:${endpoint.endpointId}`,
    { maxAttempts: resolveEndpointRatePerMinute(env), windowMs: 60_000 }
  );

  if (!endpointLimit.allowed) {
    rejected("rate_limited");

    return refuse(429, "RATE_LIMITED", "Too many requests.", {
      "retry-after": String(endpointLimit.retryAfterSec)
    });
  }

  const body = await readJsonBody(request);

  if (body.tooLarge) {
    rejected("too_large");

    return bodyTooLargeResponse(body.limitBytes);
  }

  if (body.malformed || body.value === null) {
    rejected("malformed");

    return refuse(400, "VALIDATION_ERROR", "Invalid request.");
  }

  // The per-chat bucket is a fairness control for CHATTER only. An update that
  // can change consent (`/start`, `/stop`, a block, an opt-in or withdrawal
  // button) is NEVER dropped by it (audit M-2 of PR #1260): answering 200 and
  // discarding a /stop would keep sending to someone who asked us to stop.
  const chatKey = changesConsent(body.value) ? null : chatKeyOf(body.value);

  if (chatKey !== null) {
    // HMAC-ed with a per-endpoint salt derived from the seed: the limiter's
    // store (Redis, when configured) never holds a chat id.
    const bucket = `telegram-engagement-chat:${createHmac(
      "sha256",
      endpoint.rateKeySalt
    )
      .update(chatKey, "utf8")
      .digest("hex")
      .slice(0, 32)}`;
    const chatLimit = await checkSharedRateLimit(bucket, {
      maxAttempts: PER_CHAT_PER_MINUTE,
      windowMs: 60_000
    });

    if (!chatLimit.allowed) return json200();
  }

  try {
    const result = await ingestVerifiedUpdate(
      deps.getSql(),
      endpoint,
      body.value,
      ring,
      { correlationId: crypto.randomUUID() }
    );

    if (result.callbackQueryId !== null) {
      return json200({
        method: "answerCallbackQuery",
        callback_query_id: result.callbackQueryId
      });
    }

    return json200();
  } catch (error) {
    log("error", "telegram_engagement.webhook.ingest_failed", {
      moduleKey: TELEGRAM_ENGAGEMENT_MODULE_KEY,
      error: error instanceof Error ? error.name : "unknown"
    });

    return refuse(503, "SERVICE_UNAVAILABLE", "Try again later.", {
      "retry-after": "5"
    });
  }
}
