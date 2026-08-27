/**
 * The `OPTIONS` half of the newsletter's cross-origin policy (ADR-0118).
 *
 * One implementation for all three routes, because a preflight that differs
 * between `subscribe`, `confirm` and `unsubscribe` is three chances to grant
 * something one of them did not mean to. The routes supply only what genuinely
 * differs: their own rate-limiter key.
 *
 * ## CORS is not authorization
 *
 * A preflight carries NO BODY, so this cannot know which token or which address
 * the eventual POST will name. It answers a narrower question — "is this
 * `Origin` an active, verified domain of some tenant on this deployment" — and
 * the POST goes on resolving its own tenant and validating its own body exactly
 * as before. Neither check substitutes for the other: this one decides whether
 * a browser may read our answer, that one decides whose list is being written
 * to.
 *
 * ## Why the preflight is rate-limited at all
 *
 * The allow-list lookup is a database read on an anonymous, unauthenticated
 * request. It sits behind the same per-IP limiter the POST uses, under the SAME
 * key, so a preflight and the POST it precedes share one budget rather than
 * doubling it — the beacon's decision in #637, for the same reason.
 */
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../lib/security/rate-limit";
import {
  isCrossOriginRequest,
  parseRequestOrigin
} from "../../../lib/security/request-origin";
import { newsletterPreflightHeaders } from "../domain/newsletter-cors";
import { resolvePublicNewsletterOrigin } from "./public-newsletter-tenant";

export type NewsletterPreflightLimits = {
  maxAttempts: number;
  windowMs: number;
};

/**
 * Answer one preflight.
 *
 * Always `204`, whatever the decision. A refusal is the ABSENCE of
 * `Access-Control-Allow-Origin` and not a status code: an origin that learns it
 * was refused has learned that some OTHER origin would not have been, which is
 * the same oracle the bodies of these endpoints refuse to be.
 *
 * @param sql - the caller's database handle; the domain lookup runs on it
 */
export async function newsletterPreflightResponse(
  sql: Bun.SQL,
  request: Request,
  clientAddress: string,
  limiterKey: string,
  limits: NewsletterPreflightLimits
): Promise<Response> {
  // Classified from the header alone FIRST, and the order is load-bearing: the
  // full decision below costs a database read, and doing it before the limiter
  // would let one address spend this deployment's query budget by sending
  // preflights. Parsing twice costs nothing and keeps
  // `resolvePublicNewsletterOrigin` the single authority for the verdict.
  const parsed = parseRequestOrigin(request.headers.get("origin"));

  // A same-origin request has nothing to preflight, and paying for a limiter
  // slot on it would let a same-origin caller exhaust the budget of the POST
  // that follows.
  if (!parsed || !isCrossOriginRequest(parsed, request.url)) {
    return new Response(null, {
      status: 204,
      headers: newsletterPreflightHeaders({ kind: "same_origin" })
    });
  }

  const budget = await checkSharedRateLimit(
    `${limiterKey}:${resolveClientIp(request, clientAddress)}`,
    limits
  );

  if (!budget.allowed) {
    return new Response(null, {
      status: 429,
      headers: {
        ...newsletterPreflightHeaders({ kind: "refused" }),
        "retry-after": String(budget.retryAfterSec)
      }
    });
  }

  const { decision } = await resolvePublicNewsletterOrigin(sql, request);

  return new Response(null, {
    status: 204,
    headers: newsletterPreflightHeaders(decision)
  });
}
