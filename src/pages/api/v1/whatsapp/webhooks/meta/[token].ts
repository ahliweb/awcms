import type { APIRoute } from "astro";

import { fail } from "../../../../../../modules/_shared/api-response";
import { parseChannelCallbackToken } from "../../../../../../modules/_shared/channel-webhook-token";
import type { VerifyMetaWebhookRefusal } from "../../../../../../modules/_shared/ports/channel-account-port";
import { getDatabaseClient } from "../../../../../../lib/database/client";
import { log } from "../../../../../../lib/logging/logger";
import {
  BODY_SIZE_TIER_BYTES,
  bodyTooLargeResponse,
  readCappedBytes
} from "../../../../../../lib/security/request-body-limit";
import {
  checkSharedRateLimit,
  refundSharedRateLimit,
  resolveClientIp
} from "../../../../../../lib/security/rate-limit";
import {
  handleMetaHandshake,
  handleMetaWebhook
} from "../../../../../../modules/whatsapp-delivery/application/whatsapp-meta-webhook";
import { isWhatsappEnabled } from "../../../../../../modules/whatsapp-delivery/domain/whatsapp-config";
import { WHATSAPP_MODULE_KEY } from "../../../../../../modules/whatsapp-delivery/domain/whatsapp-events";
import { parseRecipientHashKeys } from "../../../../../../modules/whatsapp-delivery/domain/whatsapp-recipient";
import { loadChannelWebhookVerifier } from "../../../../../../modules/whatsapp-delivery/infrastructure/channel-webhook-verifier-loader";

/**
 * `GET` and `POST /api/v1/whatsapp/webhooks/meta/{token}` (Issue #1143,
 * ADR-0148 I9) — Meta Cloud API webhooks for ONE tenant-owned number.
 *
 * Public on purpose (no session; declared in `SESSION_FREE_BODY_ENDPOINTS`).
 * Authentication is two facts, both required, both compared in constant time:
 * the opaque per-account callback TOKEN in the path (256 random bits, only its
 * hash stored) and Meta's `X-Hub-Signature-256` HMAC of the exact body under
 * that number's app secret. Tenant and account come from the token, never
 * from the payload.
 *
 * Order (the contract):
 *
 * 1. **Off means 404.** Without `WHATSAPP_ENABLED=true` the route does not
 *    exist (nothing read, nothing compared).
 * 2. **Two buckets BEFORE any database work.** A per-ADDRESS bucket of
 *    unverified requests (refunded once the token matched: a verified request,
 *    or a refusal that is the token's own tenant's, which goes to that tenant's
 *    denial bucket instead; #1267 audit M1), which a caller
 *    cannot dodge by choosing tenant uuids (security review M-2); then a
 *    per-(tenant, address) attempt bucket, so one tenant's genuine volume never
 *    spends another tenant's allowance. Over either: `429` with `retry-after` —
 *    Meta retries a non-200, so a status or an inbound message is DELAYED,
 *    never dropped.
 * 3. **The body**, capped (`128 KiB`), read as the raw bytes Meta signed: the
 *    HMAC is computed over these bytes, and they are decoded only afterwards.
 * 4. **Verification** in the token's tenant transaction. Every refusal (bad
 *    token, unknown or revoked subscription, number without a live WABA,
 *    missing app secret, wrong or missing signature) is the same `401`, and is
 *    counted against a smaller per-(tenant, address) denial bucket (`429` when
 *    exhausted).
 * 5. **Processing**, same transaction: dedupe by body hash, read within the
 *    binding, reconcile forward-only. Answered `200` with `{}` (Meta needs no
 *    body); a server fault is `503` so Meta retries.
 *
 * `GET` is Meta's subscription handshake: `hub.mode=subscribe`,
 * `hub.verify_token` (which must equal the callback token itself) and
 * `hub.challenge` (echoed as plain text). Anything else is `403`.
 */
const ATTEMPTS_PER_MINUTE = 1200;
const DENIALS_PER_MINUTE = 30;
const SIGNATURE_HEADER = "x-hub-signature-256";
const CHALLENGE = /^[A-Za-z0-9._-]{1,256}$/;

const refuse = (
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>
): Response => fail(status, code, message, {}, undefined, headers);

const okEmpty = (): Response =>
  new Response("{}", {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });

function bucketTenant(token: { tenantId: string } | null): string {
  return token ? token.tenantId : "malformed";
}

/**
 * #1298 L6: the per-(tenant, address) attempt bucket is charged BEFORE any
 * verification (so it throttles an unverified flood), and handed back once the
 * request turned out to be a verified, NEW delivery. Without the refund a
 * tenant whose number genuinely receives more than 1200 signed events a minute
 * from Meta's address was answered `429` and its deliveries delayed by its own
 * volume. A refusal, a malformed body and a verified DUPLICATE (a replay or a
 * provider retry, which still costs a transaction) keep their charge, so none
 * of them can be turned into free work; and a request that never verified can
 * never earn a refund.
 */
const ATTEMPT_BUCKET = {
  maxAttempts: ATTEMPTS_PER_MINUTE,
  windowMs: 60_000
} as const;
const attemptBucketKey = (tenant: string, client: string) =>
  `whatsapp-meta-webhook:${tenant}:${client}`;

async function attemptAllowed(
  tenant: string,
  client: string
): Promise<{ allowed: true } | { allowed: false; retryAfterSec: number }> {
  const limit = await checkSharedRateLimit(
    attemptBucketKey(tenant, client),
    ATTEMPT_BUCKET
  );

  return limit.allowed
    ? { allowed: true }
    : { allowed: false, retryAfterSec: limit.retryAfterSec };
}

async function denied(tenant: string, client: string): Promise<Response> {
  const throttle = await checkSharedRateLimit(
    `whatsapp-meta-webhook-denied:${tenant}:${client}`,
    { maxAttempts: DENIALS_PER_MINUTE, windowMs: 60_000 }
  );

  return throttle.allowed
    ? refuse(401, "UNAUTHORIZED", "Unauthorized.")
    : refuse(429, "RATE_LIMITED", "Too many requests.", {
        "retry-after": String(throttle.retryAfterSec)
      });
}

/**
 * Security review M-2: the per-(tenant, address) buckets are keyed by a tenant
 * the CALLER chooses (it is in the token), so 300 random tenant uuids from one
 * address were 300 fresh buckets, 300 x `401`, no `429`, and a database
 * transaction each. This bucket is keyed by the ADDRESS ALONE and is charged
 * BEFORE the transaction; a request that then verifies gets its unit back, so
 * only refusals (and requests in flight) spend it. Exhausted: `429` with no
 * database work. A burst of genuine deliveries from one Meta address larger
 * than this, all in flight at once, can see a transient `429`; Meta retries it.
 */
const IP_PENDING_PER_MINUTE = 120;
const IP_BUCKET = {
  maxAttempts: IP_PENDING_PER_MINUTE,
  windowMs: 60_000
} as const;
const ipBucketKey = (client: string) =>
  `whatsapp-meta-webhook-unverified:${client}`;

/**
 * Refusals that come AFTER the callback token matched its stored hash (the
 * verifier checks the token first). Only `DISABLED` and `TOKEN_INVALID` are
 * requests whose token proved nothing; they keep spending the address bucket,
 * so random or guessed tokens are still throttled by address (M-2).
 */
const TOKEN_MATCHED_REFUSALS: ReadonlySet<VerifyMetaWebhookRefusal> = new Set([
  "SUBSCRIPTION_INACTIVE",
  "BINDING_INVALID",
  "SECRET_UNAVAILABLE",
  "SIGNATURE_INVALID"
]);

export const POST: APIRoute = async ({ request, params, clientAddress }) => {
  if (!isWhatsappEnabled()) return refuse(404, "NOT_FOUND", "Not found.");

  const client = resolveClientIp(request, clientAddress);
  const token = parseChannelCallbackToken(params.token);
  const tenant = bucketTenant(token);
  const ipGate = await checkSharedRateLimit(ipBucketKey(client), IP_BUCKET);

  if (!ipGate.allowed) {
    return refuse(429, "RATE_LIMITED", "Too many requests.", {
      "retry-after": String(ipGate.retryAfterSec)
    });
  }

  const attempt = await attemptAllowed(tenant, client);

  if (!attempt.allowed) {
    return refuse(429, "RATE_LIMITED", "Too many requests.", {
      "retry-after": String(attempt.retryAfterSec)
    });
  }

  const body = await readCappedBytes(request, BODY_SIZE_TIER_BYTES.default);

  if (body.tooLarge) return bodyTooLargeResponse(BODY_SIZE_TIER_BYTES.default);

  const ring = parseRecipientHashKeys();

  if (!token) return denied(tenant, client);

  if (!ring.ok) {
    // Fail closed: without the ring no window or recipient check can be made.
    log("error", "whatsapp.meta_webhook.hash_keys_unavailable", {
      moduleKey: WHATSAPP_MODULE_KEY
    });

    return refuse(503, "SERVICE_UNAVAILABLE", "Try again later.", {
      "retry-after": "60"
    });
  }

  try {
    const verifier = await loadChannelWebhookVerifier();
    const outcome = await handleMetaWebhook(
      getDatabaseClient(),
      token,
      {
        rawBody: body.bytes,
        signatureHeader: request.headers.get(SIGNATURE_HEADER)
      },
      { verifier, ring }
    );

    if (outcome.kind === "refused") {
      log("warning", "whatsapp.meta_webhook.refused", {
        moduleKey: WHATSAPP_MODULE_KEY,
        reason: outcome.reason
      });

      // #1267 audit M1: once the TOKEN matched, the refusal is that tenant's
      // own (a wrong or stale app secret, a revoked subscription, a broken
      // binding). Charging it to the address bucket let one misconfigured
      // tenant 429 every other tenant's genuine deliveries from the same Meta
      // address; it is charged to the tenant's own denial bucket instead.
      if (TOKEN_MATCHED_REFUSALS.has(outcome.reason)) {
        await refundSharedRateLimit(ipBucketKey(client), IP_BUCKET);
      }

      return denied(tenant, client);
    }

    // Verified: this request does not count against the address's
    // unverified allowance (M-2).
    await refundSharedRateLimit(ipBucketKey(client), IP_BUCKET);

    // #1298 L6: nor, when it was new work, against the tenant's own volume.
    if (!outcome.result.duplicate) {
      await refundSharedRateLimit(
        attemptBucketKey(token.tenantId, client),
        ATTEMPT_BUCKET
      );
    }

    log("info", "whatsapp.meta_webhook.accepted", {
      moduleKey: WHATSAPP_MODULE_KEY,
      tenantId: token.tenantId,
      duplicate: outcome.result.duplicate,
      statusesApplied: outcome.result.statusesApplied,
      statusesUnmatched: outcome.result.statusesUnmatched,
      windowsOpened: outcome.result.windowsOpened,
      templatesUpdated: outcome.result.templatesUpdated,
      signalsUpdated: outcome.result.signalsUpdated,
      bindingMismatches: outcome.result.bindingMismatches,
      ignored: outcome.result.ignored
    });

    return okEmpty();
  } catch (error) {
    // Name only: an error message could carry a value from the request.
    log("error", "whatsapp.meta_webhook.failed", {
      moduleKey: WHATSAPP_MODULE_KEY,
      error: error instanceof Error ? error.name : "unknown"
    });

    return refuse(503, "SERVICE_UNAVAILABLE", "Try again later.", {
      "retry-after": "5"
    });
  }
};

export const GET: APIRoute = async ({
  request,
  params,
  clientAddress,
  url
}) => {
  if (!isWhatsappEnabled()) return refuse(404, "NOT_FOUND", "Not found.");

  const client = resolveClientIp(request, clientAddress);
  const token = parseChannelCallbackToken(params.token);
  const tenant = bucketTenant(token);
  const ipGate = await checkSharedRateLimit(ipBucketKey(client), IP_BUCKET);

  if (!ipGate.allowed) {
    return refuse(429, "RATE_LIMITED", "Too many requests.", {
      "retry-after": String(ipGate.retryAfterSec)
    });
  }

  const attempt = await attemptAllowed(tenant, client);

  if (!attempt.allowed) {
    return refuse(429, "RATE_LIMITED", "Too many requests.", {
      "retry-after": String(attempt.retryAfterSec)
    });
  }

  const mode = url.searchParams.get("hub.mode");
  const challenge = url.searchParams.get("hub.challenge");
  const verifyToken = url.searchParams.get("hub.verify_token");

  if (
    !token ||
    mode !== "subscribe" ||
    challenge === null ||
    !CHALLENGE.test(challenge)
  ) {
    return refuse(403, "FORBIDDEN", "Forbidden.");
  }

  try {
    const verifier = await loadChannelWebhookVerifier();
    const accepted = await handleMetaHandshake(
      getDatabaseClient(),
      token,
      verifyToken,
      verifier
    );

    if (!accepted) {
      await denied(tenant, client);

      return refuse(403, "FORBIDDEN", "Forbidden.");
    }

    await refundSharedRateLimit(ipBucketKey(client), IP_BUCKET);

    return new Response(challenge, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  } catch (error) {
    log("error", "whatsapp.meta_webhook.handshake_failed", {
      moduleKey: WHATSAPP_MODULE_KEY,
      error: error instanceof Error ? error.name : "unknown"
    });

    return refuse(503, "SERVICE_UNAVAILABLE", "Try again later.", {
      "retry-after": "5"
    });
  }
};
