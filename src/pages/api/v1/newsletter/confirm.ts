import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../lib/database/client";
import { hashClientIp } from "../../../../lib/security/client-fingerprint";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../../lib/security/rate-limit";
import { parsePositiveIntSetting } from "../../../../lib/security/env-thresholds";
import {
  bodyTooLargeResponse,
  readJsonBody
} from "../../../../lib/security/request-body-limit";
import { ok, fail } from "../../../../modules/_shared/api-response";
import { withNewsletterTenant } from "../../../../modules/newsletter/application/public-newsletter-tenant";
import { confirmSubscription } from "../../../../modules/newsletter/application/subscriber-directory";
import {
  hashSubscriptionToken,
  isWellFormedSubscriptionToken
} from "../../../../modules/newsletter/domain/subscription-token";

/**
 * `POST /api/v1/newsletter/confirm` (Issue #598, ADR-0103) — anonymous.
 *
 * The moment consent is actually recorded. A row starts `pending` and carries no
 * consent timestamp; `consent_at` and `consent_ip_hash` are written HERE,
 * because what happened is that somebody followed a link from an inbox, not that
 * a form was submitted.
 *
 * ## The token is spent
 *
 * `confirmation_token_hash` is cleared on use. Keeping a used bearer credential
 * is keeping a credential, and this one confirms a subscription.
 *
 * ## Neutral, like its sibling
 *
 * A token that matches nothing, a token already spent, and a row in the wrong
 * state answer the same body as a successful confirmation. Distinguishing them
 * would let somebody holding a guessed token learn whether it was ever valid.
 * A MALFORMED token still answers 400 — that is a statement about the request.
 *
 * Rate-limited per IP: without it this is an oracle you can ask 10,000 times.
 */
const RATE_LIMIT_MAX = parsePositiveIntSetting(
  process.env.NEWSLETTER_RATE_LIMIT_MAX,
  5,
  "NEWSLETTER_RATE_LIMIT_MAX"
);
const RATE_LIMIT_WINDOW_SEC = parsePositiveIntSetting(
  process.env.NEWSLETTER_RATE_LIMIT_WINDOW_SEC,
  300,
  "NEWSLETTER_RATE_LIMIT_WINDOW_SEC"
);

const NEUTRAL_MESSAGE =
  "If that link was still valid, the subscription is now confirmed.";

export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = await checkSharedRateLimit(
    `newsletter:confirm:${clientIp}`,
    {
      maxAttempts: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_SEC * 1000
    }
  );

  if (!rateLimit.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many requests from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const token = (bodyRead.value as { token?: unknown } | null)?.token;

  if (!isWellFormedSubscriptionToken(token)) {
    return fail(400, "VALIDATION_ERROR", "A confirmation token is required.");
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSubscriptionToken(token);

  await withNewsletterTenant(sql, request, async (tx, tenant) =>
    confirmSubscription(
      tx,
      tenant.tenantId,
      tokenHash,
      // Records WHERE the confirmation came from, which is the consent-bearing
      // event. Keyed and non-reversible; see `client-fingerprint.ts` for why it
      // must not be compared across process restarts.
      hashClientIp(clientIp),
      locals.correlationId
    )
  );

  return ok({ message: NEUTRAL_MESSAGE });
};
