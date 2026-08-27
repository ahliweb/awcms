import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../lib/database/client";
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
import { newsletterPreflightResponse } from "../../../../modules/newsletter/application/public-newsletter-preflight";
import { withPublicNewsletterTenant } from "../../../../modules/newsletter/application/public-newsletter-tenant";
import { unsubscribeByToken } from "../../../../modules/newsletter/application/subscriber-directory";
import {
  hashSubscriptionToken,
  isWellFormedSubscriptionToken
} from "../../../../modules/newsletter/domain/subscription-token";

/**
 * `POST /api/v1/newsletter/unsubscribe` (Issue #598, ADR-0103) — anonymous, and
 * that is a requirement rather than a convenience.
 *
 * PRD §30: unsubscribing must be easy and must not require a login. This takes
 * the token and NOTHING else — no session, no tenant header, no email address.
 * Requiring any of those would mean a person who wants out has to prove who they
 * are first, which is hostile and unnecessary: the token already proves they
 * hold the link.
 *
 * ## The row is kept
 *
 * "This person asked to stop, on this date" is the record that answers a later
 * complaint, and deleting it leaves nothing to answer with. Subject-rights
 * erasure (ADR-0094) is the path that removes it, and that is a different
 * request made by a different person for a different reason.
 *
 * ## A suppressed row is not touched
 *
 * Suppression is the operator's decision. Unsubscribing from it would let
 * whoever holds an old link move a row out of the one state it must not leave.
 *
 * Neutral response, rate-limited per IP — as with `confirm`, for the same
 * oracle reason.
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
  "If that link was valid, you will not receive any further newsletters.";

export const POST: APIRoute = async ({ request, clientAddress, locals }) => {
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = await checkSharedRateLimit(
    `newsletter:unsubscribe:${clientIp}`,
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
      {
        "retry-after": String(rateLimit.retryAfterSec),
        // The limiter answers before the origin is ever classified, so this
        // response carries no CORS grant — but it is still one of the answers
        // this URL gives, and a cache must not hand it to another origin as if
        // it were origin-independent (ADR-0118, following ADR-0107).
        vary: "Origin"
      }
    );
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const token = (bodyRead.value as { token?: unknown } | null)?.token;

  if (!isWellFormedSubscriptionToken(token)) {
    // Classified before the origin is, so no CORS grant — see the 429 above.
    return fail(
      400,
      "VALIDATION_ERROR",
      "An unsubscribe token is required.",
      {},
      undefined,
      { vary: "Origin" }
    );
  }

  const sql = getDatabaseClient();
  const tokenHash = hashSubscriptionToken(token);

  const { corsHeaders } = await withPublicNewsletterTenant(
    sql,
    request,
    async (tx, tenant) =>
      unsubscribeByToken(tx, tenant.tenantId, tokenHash, locals.correlationId)
  );

  return ok({ message: NEUTRAL_MESSAGE }, {}, corsHeaders);
};

/**
 * The preflight (ADR-0118). Same shape as its two siblings, and it matters most
 * here: PRD §30 says leaving must be easy, and a link that a reader's browser
 * cannot complete is not easy, it is impossible.
 */
export const OPTIONS: APIRoute = async ({ request, clientAddress }) =>
  newsletterPreflightResponse(
    getDatabaseClient(),
    request,
    clientAddress,
    "newsletter:unsubscribe",
    { maxAttempts: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_SEC * 1000 }
  );
