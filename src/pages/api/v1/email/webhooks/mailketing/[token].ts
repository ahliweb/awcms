import type { APIRoute } from "astro";

import { fail } from "../../../../../../modules/_shared/api-response";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { log } from "../../../../../../lib/logging/logger";
import {
  bodyTooLargeResponse,
  readCappedText
} from "../../../../../../lib/security/request-body-limit";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../../../lib/security/rate-limit";
import {
  recordMailketingEvents,
  verifyMailketingCallback
} from "../../../../../../modules/email/application/email-webhook-intake";
import {
  flushEmailWebhookRejections,
  recordEmailWebhookRejection
} from "../../../../../../modules/email/application/email-webhook-guard";
import {
  EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE,
  EMAIL_WEBHOOK_PRE_VERIFY_RATE_PER_MINUTE,
  isEmailWebhookEnabled,
  resolveEmailWebhookRatePerMinute
} from "../../../../../../modules/email/domain/email-webhook-config";
import {
  MAILKETING_WEBHOOK_MAX_BODY_BYTES,
  parseCallbackToken,
  parseMailketingWebhookBody
} from "../../../../../../modules/email/domain/mailketing-webhook";
import { tryLoadWebhookSubscriptionDirectory } from "../../../../../../modules/email/infrastructure/channel-account-loaders";

/**
 * `POST /api/v1/email/webhooks/mailketing/{token}` (Issue #1161, ADR-0151
 * section 5, `strict` mode) — Mailketing's delivery callbacks for ONE tenant
 * Mailketing account.
 *
 * Mailketing documents no way to authenticate a callback (no signature, secret
 * header, source-IP list or event id), so this route treats every event as
 * UNAUTHENTICATED and changes no customer state: an event bound to a message
 * this account sent lands in the quarantine ledger, and only an operator can
 * turn a bounce or an unsubscribe into a suppression. The opaque token in the
 * path only LOCATES the tenant and account (ADR-0150 N5).
 *
 * Order of work, and why:
 *
 * 1. **Off means 404** (`EMAIL_WEBHOOK_ENABLED`): nothing is read.
 * 2. **Per-address pre-verification bucket**, counted for EVERY request before
 *    any parsing or database work, keyed by the resolved client address only
 *    (never by a value the caller chose, so it cannot be dodged by varying the
 *    token, nor aimed at someone else's bucket).
 * 3. **Token shape** (pure) and **body size** (32 KiB cap, streaming), still
 *    without the database.
 * 4. **Proof**: the tenant opened FROM the token, the secret's hash compared in
 *    constant time, the subscription live on a connected account. Every failure
 *    is the same `401`; repeated failures from one address are `429`.
 * 5. **Per-callback bucket**, then the events: each bound to OUR message
 *    (provider message id + recipient, or recipient-only for the two event
 *    types Mailketing sends without an id) or discarded; replay collapses on the
 *    dedupe key.
 *
 * After proof the answer is always `200 {"received": true}` with counts
 * withheld: Mailketing retries non-2xx, and nothing about a recipient or a
 * message is echoed to whoever holds the URL.
 */
const refuse = (
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>
): Response => fail(status, code, message, {}, undefined, headers);

const accepted = (): Response =>
  new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });

export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  if (!isEmailWebhookEnabled()) {
    return refuse(404, "NOT_FOUND", "Not found.");
  }

  const client = resolveClientIp(request, clientAddress);
  const preVerify = await checkSharedRateLimit(`email-webhook-ip:${client}`, {
    maxAttempts: EMAIL_WEBHOOK_PRE_VERIFY_RATE_PER_MINUTE,
    windowMs: 60_000
  });

  if (!preVerify.allowed) {
    recordEmailWebhookRejection("pre_verify_rate_limited");
    void flushEmailWebhookRejections(getDatabaseClient).catch(() => undefined);

    return refuse(429, "RATE_LIMITED", "Too many requests.", {
      "retry-after": String(preVerify.retryAfterSec)
    });
  }

  const deny = async (
    reason: "proof_malformed" | "proof_mismatch"
  ): Promise<Response> => {
    recordEmailWebhookRejection(reason);
    void flushEmailWebhookRejections(getDatabaseClient).catch(() => undefined);

    const throttle = await checkSharedRateLimit(
      `email-webhook-denied:${client}`,
      { maxAttempts: EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE, windowMs: 60_000 }
    );

    if (!throttle.allowed) {
      recordEmailWebhookRejection("denied_rate_limited");

      return refuse(429, "RATE_LIMITED", "Too many requests.", {
        "retry-after": String(throttle.retryAfterSec)
      });
    }

    return refuse(401, "UNAUTHORIZED", "Unauthorized.");
  };

  const token = parseCallbackToken(params.token);

  if (!token) return deny("proof_malformed");

  const text = await readCappedText(request, MAILKETING_WEBHOOK_MAX_BODY_BYTES);

  if (text.tooLarge) {
    recordEmailWebhookRejection("too_large");

    return bodyTooLargeResponse(MAILKETING_WEBHOOK_MAX_BODY_BYTES);
  }

  let body: unknown;

  try {
    body = text.text.length === 0 ? null : JSON.parse(text.text);
  } catch {
    body = undefined;
  }

  const directory = await tryLoadWebhookSubscriptionDirectory();

  if (!directory) {
    // Default-deny: the credential store cannot be consulted.
    return refuse(503, "SERVICE_UNAVAILABLE", "Try again later.", {
      "retry-after": "60"
    });
  }

  const sql = getDatabaseClient();

  try {
    const callback = await verifyMailketingCallback(sql, token, directory);

    if (!callback) return deny("proof_mismatch");

    const callbackLimit = await checkSharedRateLimit(
      `email-webhook-callback:${callback.subscriptionId}`,
      { maxAttempts: resolveEmailWebhookRatePerMinute(), windowMs: 60_000 }
    );

    if (!callbackLimit.allowed) {
      recordEmailWebhookRejection("callback_rate_limited");

      return refuse(429, "RATE_LIMITED", "Too many requests.", {
        "retry-after": String(callbackLimit.retryAfterSec)
      });
    }

    const events = body === undefined ? null : parseMailketingWebhookBody(body);

    if (events === null) {
      recordEmailWebhookRejection("malformed");

      return refuse(400, "VALIDATION_ERROR", "Invalid request.");
    }

    const result = await recordMailketingEvents(
      sql,
      callback,
      events,
      directory
    );

    log("info", "email.webhook.received", {
      moduleKey: "email",
      tenantId: callback.tenantId,
      recorded: result.recorded,
      duplicate: result.duplicate,
      unmatched: result.unmatched,
      stale: result.stale,
      ignored: result.ignored
    });

    return accepted();
  } catch (error) {
    // Mailketing retries a non-2xx; recording is idempotent on the dedupe key.
    log("error", "email.webhook.failed", {
      moduleKey: "email",
      error: error instanceof Error ? error.name : "unknown"
    });

    return refuse(503, "SERVICE_UNAVAILABLE", "Try again later.", {
      "retry-after": "5"
    });
  }
};
