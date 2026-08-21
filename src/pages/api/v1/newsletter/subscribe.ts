import type { APIRoute } from "astro";

import { getDatabaseClient } from "../../../../lib/database/client";
import { recordCounter } from "../../../../lib/observability/metrics-port";
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
import { enqueueDirectAddressEmail } from "../../../../modules/email/application/direct-address-notification";
import { withNewsletterTenant } from "../../../../modules/newsletter/application/public-newsletter-tenant";
import { subscribe } from "../../../../modules/newsletter/application/subscriber-directory";
import {
  NEWSLETTER_CONFIRMATION_TEMPLATE_KEY,
  buildConfirmationUrl
} from "../../../../modules/newsletter/domain/newsletter-mail";
import { validateSubscriptionRequest } from "../../../../modules/newsletter/domain/subscription-request";
import { resolveRequestOrigin } from "../../../../lib/http/site-origin";

/**
 * `POST /api/v1/newsletter/subscribe` (Issue #598, ADR-0103) — anonymous.
 *
 * ## It tells nobody anything
 *
 * The SAME neutral body for every outcome: a new address, an address already
 * active, one that is suppressed, one whose tenant does not resolve, and one
 * that failed the shape check. It never says which.
 *
 * That is the decision that costs something and is worth it. A distinguishing
 * response turns this into a way to ask "is this person subscribed to this
 * newsroom's list", and for a news site in Central Kalimantan that is a question
 * with consequences for the person being asked about. The cost is that somebody
 * who mistypes their address gets no feedback beyond "check your mail" —
 * accepted, and the same trade `POST /api/v1/auth/password/forgot` already makes
 * here.
 *
 * A malformed body still answers 400: that is a statement about the REQUEST, not
 * about any address, so it leaks nothing. An address that is well-formed but
 * does not exist is indistinguishable from one that does.
 *
 * ## Idempotent by construction (FR-NWL-005)
 *
 * A second POST for the same address does not create a second row — the unique
 * index on `(tenant_id, email_normalized)` and one `ON CONFLICT` statement do
 * that, not a read-then-write a concurrent request could interleave with.
 *
 * ## Rate-limited per IP
 *
 * An anonymous endpoint that sends mail is an anonymous endpoint that sends mail
 * on somebody else's behalf. The limiter is parsed rather than coerced:
 * `Number(x ?? 60)` yields `NaN` for a non-numeric value and `count > NaN` is
 * false, which switches a limiter OFF while its metric reads zero.
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

/** One sentence, and it is true whatever happened. */
const NEUTRAL_MESSAGE =
  "If that address can be subscribed, a confirmation email is on its way.";

export const POST: APIRoute = async ({
  request,
  url,
  clientAddress,
  locals
}) => {
  const clientIp = resolveClientIp(request, clientAddress);
  const rateLimit = await checkSharedRateLimit(
    `newsletter:subscribe:${clientIp}`,
    {
      maxAttempts: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_SEC * 1000
    }
  );

  if (!rateLimit.allowed) {
    recordCounter("newsletter_subscribe_total", { outcome: "rate_limited" });
    return fail(
      429,
      "RATE_LIMITED",
      "Too many subscription requests from this source. Try again later.",
      {},
      undefined,
      { "retry-after": String(rateLimit.retryAfterSec) }
    );
  }

  const bodyRead = await readJsonBody(request);

  if (bodyRead.tooLarge) {
    return bodyTooLargeResponse(bodyRead.limitBytes);
  }

  const validation = validateSubscriptionRequest(bodyRead.value);

  if (!validation.valid) {
    recordCounter("newsletter_subscribe_total", { outcome: "invalid" });
    // About the REQUEST, not about any address — so it leaks nothing.
    return fail(
      400,
      "VALIDATION_ERROR",
      "A valid email address is required.",
      {},
      validation.errors
    );
  }

  const sql = getDatabaseClient();
  const origin = resolveRequestOrigin(url, request);

  await withNewsletterTenant(sql, request, async (tx, tenant) => {
    const outcome = await subscribe(
      tx,
      tenant.tenantId,
      validation.value,
      "public_form"
    );

    // `null` means no mail should go out: suppressed, or already active. The
    // caller cannot tell, and neither can the person who submitted the form.
    if (!outcome.confirmationToken) {
      return null;
    }

    // A tenant with no ACTIVE confirmation template gets `{ enqueued: false }`
    // and the row stays `pending`. That is the correct failure — silently
    // activating without confirmation would be the wrong one — and the admin
    // screen's pending count is where it becomes visible.
    await enqueueDirectAddressEmail(
      tx,
      tenant.tenantId,
      NEWSLETTER_CONFIRMATION_TEMPLATE_KEY,
      validation.value.email,
      {
        confirmUrl: buildConfirmationUrl(origin, outcome.confirmationToken),
        siteName: tenant.tenantName
      },
      locals.correlationId,
      validation.value.locale ?? "en"
    );

    return null;
  });

  recordCounter("newsletter_subscribe_total", { outcome: "accepted" });

  // Deliberately outside the branch above: an unresolved tenant, a disabled
  // module and a real subscription all end here.
  return ok({ message: NEUTRAL_MESSAGE });
};
