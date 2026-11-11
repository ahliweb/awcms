import type { APIContext } from "astro";

import { log } from "../../../lib/logging/logger";
import { recordCounter } from "../../../lib/observability/metrics-port";
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../lib/security/rate-limit";
import { readCappedText } from "../../../lib/security/request-body-limit";
import { fail, ok } from "../../_shared/api-response";
import {
  checkSourceRules,
  recordSubmission,
  runChallenge,
  verifyIntake
} from "./submission-intake";
import { submissionPreflightResponse } from "./public-preflight";
import {
  resolveIntakeLimits,
  resolveWebsiteEngagementRings
} from "../domain/engagement-config";
import { rateLimitClientKey } from "../domain/client-key";
import { submissionCorsHeaders } from "../domain/origin-policy";
import { publicMessage } from "../domain/public-messages";
import { parseSourceToken } from "../domain/source-token";
import {
  MIN_HUMAN_FILL_MS,
  validateSubmissionRequest
} from "../domain/submission-request";
import { SUBMISSION_BODY_LIMIT_BYTES } from "../domain/website-engagement-constants";

/**
 * `POST /api/v1/website-engagement/submissions` (Issue #1153, ADR-0155) —
 * PUBLIC and unauthenticated BY DESIGN: it is called by a visitor's browser on
 * a tenant's website. It is authenticated by the source token in the body and
 * by the request's verified Origin host, and everything else is default-deny.
 *
 * Order, cheapest first and before any database work (ADR-0155 section 4):
 * per-IP limit, content type, capped body, SHAPE validation, then the token,
 * tenant, module, source and Origin proof (https, or a localhost dev host); then
 * the rules only the source can judge, the honeypot, the challenge (none for an
 * interaction), THEN the per-SOURCE budget (interactions have their own, lower
 * one), and finally one transaction that stores the submission and its outbox
 * event. There is no duplicate probe before the challenge: a duplicate is
 * decided by the insert and answers like a new submission.
 *
 * ## One refusal before proof
 *
 * Every failure before the source is proven answers the SAME `403
 * SUBMISSION_REFUSED`, with no CORS grant: an unparseable token, a tenant or
 * source that does not exist, a wrong secret, a paused or revoked source, a
 * disabled module and an unregistered Origin cannot be told apart. The body also
 * never reveals whether this `eventId` or this person was seen before: a new
 * submission, a duplicate and a honeypot catch all answer the same `200`.
 *
 * ## A body or query `tenantId` is never believed
 *
 * The tenant comes from the token. A `tenantId`/`sourceId` in the body or the
 * query that disagrees with it is refused with the uniform answer; a
 * `tenant_code` in the query is refused outright.
 *
 * ## Never logged
 *
 * The body, the token, the address and the challenge token are never logged or
 * put in a metric label; only a coded outcome is.
 */
const IDENTITY_QUERY_KEYS = [
  "tenant_id",
  "tenantId",
  "source_id",
  "sourceId"
] as const;
const TENANT_CODE_QUERY_KEYS = ["tenant_code", "tenantCode"] as const;

function refused(locale: string | null): Response {
  return fail(
    403,
    "SUBMISSION_REFUSED",
    publicMessage("submissionRefused", locale),
    {},
    undefined,
    submissionCorsHeaders(null)
  );
}

export async function handlePublicSubmission(
  {
    request,
    url,
    clientAddress,
    locals
  }: Pick<APIContext, "request" | "url" | "clientAddress" | "locals">,
  sql: Bun.SQL
): Promise<Response> {
  const limits = resolveIntakeLimits();
  const clientIp = resolveClientIp(request, clientAddress);
  const ipBudget = await checkSharedRateLimit(
    `website_engagement:ip:${rateLimitClientKey(clientIp)}`,
    { maxAttempts: limits.perIpMax, windowMs: limits.perIpWindowSec * 1000 }
  );

  if (!ipBudget.allowed) {
    recordCounter("website_engagement_submission_total", {
      outcome: "rate_limited"
    });
    return fail(
      429,
      "RATE_LIMITED",
      publicMessage("rateLimited", null),
      {},
      undefined,
      {
        ...submissionCorsHeaders(null),
        "retry-after": String(ipBudget.retryAfterSec)
      }
    );
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().startsWith("application/json")) {
    // A non-JSON content type is what a cross-origin form post uses to skip the
    // preflight; it is never accepted here.
    recordCounter("website_engagement_submission_total", {
      outcome: "invalid"
    });
    return fail(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json.",
      {},
      undefined,
      submissionCorsHeaders(null)
    );
  }

  const bodyRead = await readCappedText(request, SUBMISSION_BODY_LIMIT_BYTES);

  if (bodyRead.tooLarge) {
    recordCounter("website_engagement_submission_total", {
      outcome: "invalid"
    });
    return fail(
      413,
      "PAYLOAD_TOO_LARGE",
      "Request body is too large.",
      {},
      undefined,
      submissionCorsHeaders(null)
    );
  }

  let parsedBody: unknown = null;

  try {
    parsedBody = JSON.parse(bodyRead.text);
  } catch {
    parsedBody = null;
  }

  const validation = validateSubmissionRequest(parsedBody);

  if (!validation.valid) {
    recordCounter("website_engagement_submission_total", {
      outcome: "invalid"
    });
    // About the REQUEST's shape, decided before the token is looked at, so it
    // is the same answer whether or not the token is valid.
    return fail(
      400,
      "VALIDATION_ERROR",
      "The submission is not valid.",
      {},
      validation.errors,
      submissionCorsHeaders(null)
    );
  }

  const submission = validation.value;
  const keys = resolveWebsiteEngagementRings();

  if (!keys.ok) {
    // A fixed cause code, never a value (#1269 L-1).
    log("error", "website_engagement.ring_unavailable", { cause: keys.code });
    recordCounter("website_engagement_submission_total", {
      outcome: "unavailable"
    });
    return fail(
      503,
      "SERVICE_UNAVAILABLE",
      publicMessage("unavailable", submission.locale),
      {},
      undefined,
      submissionCorsHeaders(null)
    );
  }

  const token = parseSourceToken(submission.sourceToken);

  const claimedElsewhere =
    TENANT_CODE_QUERY_KEYS.some((key) => url.searchParams.has(key)) ||
    (token !== null &&
      (IDENTITY_QUERY_KEYS.some((key) => {
        const value = url.searchParams.get(key);

        if (value === null) return false;

        const lowered = value.toLowerCase();
        const expected = key.startsWith("tenant")
          ? token.tenantId
          : token.sourceId;

        return lowered !== expected;
      }) ||
        (submission.claimedTenantId !== null &&
          submission.claimedTenantId !== token.tenantId) ||
        (submission.claimedSourceId !== null &&
          submission.claimedSourceId !== token.sourceId)));

  if (!token || claimedElsewhere) {
    recordCounter("website_engagement_submission_total", {
      outcome: "refused"
    });
    return refused(submission.locale);
  }

  const source = await verifyIntake(sql, token, request, keys.rings);

  if (!source) {
    recordCounter("website_engagement_submission_total", {
      outcome: "refused"
    });
    return refused(submission.locale);
  }

  // From here the caller has PROVEN the token and the Origin host, so errors may
  // be specific and the verified origin may read them.
  const corsHeaders = submissionCorsHeaders(source.origin.origin);
  const neutral = () =>
    ok(
      { received: true, message: publicMessage("received", submission.locale) },
      {},
      corsHeaders
    );

  const rules = checkSourceRules(source, submission);

  if (!rules.ok) {
    recordCounter("website_engagement_submission_total", {
      outcome: "rule_refused"
    });
    return fail(
      rules.status,
      rules.code,
      publicMessage("submissionRefused", submission.locale),
      {},
      undefined,
      corsHeaders
    );
  }

  // Cheap bot signals: answered like a success and stored as nothing. They spend
  // no per-source budget.
  if (
    submission.honeypotTripped ||
    (submission.fillMs !== null && submission.fillMs < MIN_HUMAN_FILL_MS)
  ) {
    recordCounter("website_engagement_submission_total", {
      outcome: "accepted"
    });
    return neutral();
  }

  // Interactions carry no contact data, so they get NO per-event challenge (a
  // widget solve per click would be absurd and they store nothing personal) and
  // are bounded by their own, lower, per-source ceiling below (audit M1).
  const isInteraction = submission.kind === "interaction";
  const challenge = isInteraction
    ? source.challengeMode === "none"
      ? "source_none"
      : "not_required"
    : await runChallenge(
        source,
        submission.challengeToken,
        clientIp === "unknown" ? undefined : clientIp
      );

  if (challenge === null) {
    recordCounter("website_engagement_submission_total", {
      outcome: "challenge_failed"
    });
    return fail(
      403,
      "SUBMISSION_REFUSED",
      publicMessage("submissionRefused", submission.locale),
      {},
      undefined,
      corsHeaders
    );
  }

  // The per-source budget is spent only AFTER the challenge succeeded (audit
  // H1): a scraped real token with a forged Origin is refused in `verifyIntake`
  // and a failed challenge returns above, so neither can keep a real source at
  // 429. A duplicate is decided by the insert below and spends the budget like
  // any other success, so it is no oracle either (audit M2).
  const sourceBudget = await checkSharedRateLimit(
    `website_engagement:source${isInteraction ? "-interaction" : ""}:${source.sourceId}`,
    {
      maxAttempts: isInteraction
        ? limits.perSourceInteractionMax
        : limits.perSourceMax,
      windowMs: limits.perSourceWindowSec * 1000
    }
  );

  if (!sourceBudget.allowed) {
    recordCounter("website_engagement_submission_total", {
      outcome: "rate_limited"
    });
    return fail(
      429,
      "RATE_LIMITED",
      publicMessage("rateLimited", submission.locale),
      {},
      undefined,
      { ...corsHeaders, "retry-after": String(sourceBudget.retryAfterSec) }
    );
  }

  const result = await recordSubmission(
    sql,
    source,
    submission,
    challenge,
    keys.rings,
    locals.correlationId
  );

  if (result.outcome === "source_gone") {
    recordCounter("website_engagement_submission_total", {
      outcome: "refused"
    });
    return refused(submission.locale);
  }

  recordCounter("website_engagement_submission_total", {
    outcome: "accepted"
  });

  // `created` and `duplicate` answer identically.
  return neutral();
}

/**
 * The preflight. `OPTIONS` is in Astro's `SAFE_METHODS`, so `checkOrigin` lets
 * it through and the decision is this handler's. It shares the POST's per-IP
 * limiter key: a preflight is part of the request it precedes.
 */
export async function handlePublicPreflight(
  { request, clientAddress }: Pick<APIContext, "request" | "clientAddress">,
  sql: Bun.SQL
): Promise<Response> {
  const limits = resolveIntakeLimits();

  return submissionPreflightResponse(sql, request, clientAddress, {
    maxAttempts: limits.perIpMax,
    windowMs: limits.perIpWindowSec * 1000
  });
}
