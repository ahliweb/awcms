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
import { newsletterPreflightResponse } from "../../../../modules/newsletter/application/public-newsletter-preflight";
import { withPublicNewsletterTenant } from "../../../../modules/newsletter/application/public-newsletter-tenant";
import { subscribe } from "../../../../modules/newsletter/application/subscriber-directory";
import type { NewsletterOriginDecision } from "../../../../modules/newsletter/domain/newsletter-cors";
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

/**
 * How long an address waits before a SECOND confirmation email can be sent to
 * it. A different axis from the limiter above, not a duplicate of it: that one
 * bounds how fast one SENDER may submit, and this one bounds how much mail one
 * RECIPIENT receives.
 *
 * The distinction is the whole point. The person being mailed contributes no IP
 * to the request, so no per-IP ceiling can protect them — and without this,
 * every repeat submission of the same address re-issued a token and enqueued
 * another email, so anyone willing to rotate IPs could have this deployment
 * mail-bomb a stranger in its own name.
 *
 * Fifteen minutes: longer than "it did not arrive, let me try again", far
 * shorter than a confirmation link's own lifetime. Parsed rather than coerced
 * for the reason above — a non-numeric value would otherwise become `NaN`, and
 * every comparison against `NaN` is false, which switches the ceiling OFF.
 */
const CONFIRMATION_COOLDOWN_SEC = parsePositiveIntSetting(
  process.env.NEWSLETTER_CONFIRMATION_COOLDOWN_SEC,
  900,
  "NEWSLETTER_CONFIRMATION_COOLDOWN_SEC"
);

/** One sentence, and it is true whatever happened. */
const NEUTRAL_MESSAGE =
  "If that address can be subscribed, a confirmation email is on its way.";

/**
 * Which origin the confirmation link points at (ADR-0118).
 *
 * For a GRANTED cross-origin request it is the caller's own origin — and it is
 * safe to echo precisely because it is not taken on trust: the request only
 * reached this branch because that hostname resolved a tenant through
 * `awcms_tenant_domains`. An unverified `Origin` here would be a way to have
 * this deployment email a stranger a valid token pointing at a site the sender
 * chose.
 *
 * For everything else it stays what it was: the origin this request arrived on.
 *
 * ## What this does NOT fix, and it is worth naming
 *
 * `NEWSLETTER_CONFIRM_PATH` is `/newsletter/confirm`, and this repo serves no
 * such page — `src/pages/newsletter/` does not exist. A same-origin
 * subscription therefore still emails a link to a 404 here, exactly as it did
 * before this change. That is not an oversight of this change: the family's
 * public surface belongs to `awcms-astro` (ADR-0070), which serves both pages
 * and posts the token back here. A deployment with no site in front of it has
 * nowhere for a reader to confirm, and adding public reader pages to this repo
 * to paper over that would contradict the decision that put them there.
 */
function confirmationOrigin(
  decision: NewsletterOriginDecision,
  url: URL,
  request: Request
): string {
  return decision.kind === "granted"
    ? decision.origin
    : resolveRequestOrigin(url, request);
}

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

  const validation = validateSubscriptionRequest(bodyRead.value);

  if (!validation.valid) {
    recordCounter("newsletter_subscribe_total", { outcome: "invalid" });
    // About the REQUEST, not about any address — so it leaks nothing.
    // Same reasoning as the 429 above: classified before the origin is, so no
    // grant — a cross-origin caller sees a failed request rather than this
    // body, which is the same information a neutral endpoint gives it anyway.
    return fail(
      400,
      "VALIDATION_ERROR",
      "A valid email address is required.",
      {},
      validation.errors,
      { vary: "Origin" }
    );
  }

  const sql = getDatabaseClient();

  const { corsHeaders, decision } = await withPublicNewsletterTenant(
    sql,
    request,
    async (tx, tenant) => {
      const outcome = await subscribe(
        tx,
        tenant.tenantId,
        validation.value,
        "public_form",
        CONFIRMATION_COOLDOWN_SEC
      );

      // `null` means no mail should go out: suppressed, already active, or
      // inside the per-address cooldown. The caller cannot tell which, and
      // neither can the person who submitted the form.
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
          confirmUrl: buildConfirmationUrl(
            confirmationOrigin(decision, url, request),
            outcome.confirmationToken
          ),
          siteName: tenant.tenantName
        },
        locals.correlationId,
        validation.value.locale ?? "en"
      );

      return null;
    }
  );

  recordCounter("newsletter_subscribe_total", { outcome: "accepted" });

  // Deliberately outside the branch above: an unresolved tenant, a disabled
  // module and a real subscription all end here.
  return ok({ message: NEUTRAL_MESSAGE }, {}, corsHeaders);
};

/**
 * The preflight (ADR-0118). It exists because the contract is JSON, which makes
 * every cross-origin POST here preflighted — and until this handler, nothing
 * answered, so the POST was never sent.
 *
 * `OPTIONS` is in Astro's `SAFE_METHODS`, so `security.checkOrigin` lets the
 * preflight through and the decision is entirely this handler's to make. It
 * shares the POST's per-IP limiter under the SAME key rather than opening a
 * second budget: a preflight is part of the request it precedes, not a separate
 * one, and `Access-Control-Max-Age` keeps a reader from paying for it twice.
 */
export const OPTIONS: APIRoute = async ({ request, clientAddress }) =>
  newsletterPreflightResponse(
    getDatabaseClient(),
    request,
    clientAddress,
    "newsletter:subscribe",
    { maxAttempts: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_SEC * 1000 }
  );
