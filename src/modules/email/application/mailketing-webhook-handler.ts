/**
 * The Mailketing callback, end to end, behind
 * `POST /api/v1/email/webhooks/mailketing/{token}` (Issue #1161, ADR-0151
 * section 5, `strict` mode). The route file only adapts Astro's context.
 *
 * Mailketing documents no way to authenticate a callback (no signature, secret
 * header, source-IP list or event id), so every event is UNAUTHENTICATED and
 * changes no customer state: an event bound to a message this account sent
 * lands in the quarantine ledger, and only an operator can turn a bounce or an
 * unsubscribe into a suppression. The opaque token in the path only LOCATES the
 * tenant and account (ADR-0150 N5).
 *
 * Order of work, and why (audit M-1 of PR #1272, the pattern of
 * `telegram-engagement/application/webhook-handler.ts`):
 *
 * 1. **Off means 404** (`EMAIL_WEBHOOK_ENABLED`): nothing is read.
 * 2. **Failure bucket, charged first.** Every request is charged to a
 *    per-address bucket of FAILED proofs before any parsing or database work,
 *    and the charge is REFUNDED once the request verifies. Mailketing calls
 *    every tenant's URLs from a few shared addresses: a bucket that counted
 *    every request would let one busy tenant 429 every other tenant. An
 *    address over its failure budget is refused without a query. The key is
 *    the resolved client address, never a value the caller chose.
 * 3. **Token shape** (pure) and **body size** (32 KiB, streaming).
 * 4. **Proof**: the tenant opened FROM the token, the secret's hash compared in
 *    constant time, the subscription live on a connected account. Every
 *    failure is the same `401` and stays charged.
 * 5. **Per-callback bucket** for verified traffic (the legitimate rate of ONE
 *    URL, never shared across tenants), then the events.
 *
 * After proof the answer is always `200 {"received": true}`: Mailketing
 * retries non-2xx, and nothing about a recipient or a message is echoed.
 */
import { fail } from "../../_shared/api-response";
import { log } from "../../../lib/logging/logger";
import {
  bodyTooLargeResponse,
  readCappedText
} from "../../../lib/security/request-body-limit";
import {
  checkSharedRateLimit,
  refundSharedRateLimit,
  resolveClientIp
} from "../../../lib/security/rate-limit";
import {
  EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE,
  isEmailWebhookEnabled,
  resolveEmailWebhookRatePerMinute
} from "../domain/email-webhook-config";
import {
  MAILKETING_WEBHOOK_MAX_BODY_BYTES,
  parseCallbackToken,
  parseMailketingWebhookBody
} from "../domain/mailketing-webhook";
import type { EmailWebhookSubscriptionDirectory } from "../infrastructure/channel-account-loaders";
import {
  recordMailketingEvents,
  verifyMailketingCallback
} from "./email-webhook-intake";
import {
  flushEmailWebhookRejections,
  recordEmailWebhookRejection,
  type EmailWebhookRejectionReason
} from "./email-webhook-guard";

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

export type MailketingWebhookDeps = {
  getSql: () => Bun.SQL;
  loadDirectory: () => Promise<EmailWebhookSubscriptionDirectory | null>;
  env?: NodeJS.ProcessEnv;
};

/** The per-address bucket of FAILED proofs; exported for tests. */
export function emailWebhookFailureBucketKey(client: string): string {
  return `email-webhook-denied:${client}`;
}

export async function handleMailketingWebhook(
  request: Request,
  rawToken: string | undefined,
  clientAddress: string | undefined,
  deps: MailketingWebhookDeps
): Promise<Response> {
  const env = deps.env ?? process.env;

  if (!isEmailWebhookEnabled(env)) {
    return refuse(404, "NOT_FOUND", "Not found.");
  }

  const rejected = (reason: EmailWebhookRejectionReason) => {
    recordEmailWebhookRejection(reason);
    void flushEmailWebhookRejections(deps.getSql).catch(() => undefined);
  };

  const client = resolveClientIp(request, clientAddress);
  const failureBucket = emailWebhookFailureBucketKey(client);
  const failureBudget = {
    maxAttempts: EMAIL_WEBHOOK_DENIED_RATE_PER_MINUTE,
    windowMs: 60_000
  };
  const charge = await checkSharedRateLimit(failureBucket, failureBudget);

  if (!charge.allowed) {
    rejected("denied_rate_limited");

    return refuse(429, "RATE_LIMITED", "Too many requests.", {
      "retry-after": String(charge.retryAfterSec)
    });
  }

  const denied = (reason: EmailWebhookRejectionReason): Response => {
    rejected(reason);

    return refuse(401, "UNAUTHORIZED", "Unauthorized.");
  };

  const token = parseCallbackToken(rawToken);

  if (!token) return denied("proof_malformed");

  const text = await readCappedText(request, MAILKETING_WEBHOOK_MAX_BODY_BYTES);

  if (text.tooLarge) {
    rejected("too_large");

    return bodyTooLargeResponse(MAILKETING_WEBHOOK_MAX_BODY_BYTES);
  }

  let body: unknown;

  try {
    body = text.text.length === 0 ? null : JSON.parse(text.text);
  } catch {
    body = undefined;
  }

  const directory = await deps.loadDirectory();

  if (!directory) {
    // Default-deny: the credential store cannot be consulted.
    return refuse(503, "SERVICE_UNAVAILABLE", "Try again later.", {
      "retry-after": "60"
    });
  }

  const sql = deps.getSql();

  try {
    const callback = await verifyMailketingCallback(sql, token, directory);

    if (!callback) return denied("proof_mismatch");

    // Verified: not a failure, so it does not stay charged.
    await refundSharedRateLimit(failureBucket, failureBudget);

    const callbackLimit = await checkSharedRateLimit(
      `email-webhook-callback:${callback.subscriptionId}`,
      { maxAttempts: resolveEmailWebhookRatePerMinute(env), windowMs: 60_000 }
    );

    if (!callbackLimit.allowed) {
      rejected("callback_rate_limited");

      return refuse(429, "RATE_LIMITED", "Too many requests.", {
        "retry-after": String(callbackLimit.retryAfterSec)
      });
    }

    const events = body === undefined ? null : parseMailketingWebhookBody(body);

    if (events === null) {
      rejected("malformed");

      return refuse(400, "VALIDATION_ERROR", "Invalid request.");
    }

    const result = await recordMailketingEvents(
      sql,
      callback,
      events,
      directory
    );

    log(
      result.quotaExceeded > 0 ? "warning" : "info",
      "email.webhook.received",
      {
        moduleKey: "email",
        tenantId: callback.tenantId,
        recorded: result.recorded,
        duplicate: result.duplicate,
        unmatched: result.unmatched,
        stale: result.stale,
        quotaExceeded: result.quotaExceeded,
        ignored: result.ignored
      }
    );

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
}
