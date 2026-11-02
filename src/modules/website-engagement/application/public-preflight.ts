/**
 * The `OPTIONS` half of the public intake's cross-origin policy (ADR-0155
 * section 3.3), following `newsletter` and `site_search` rather than inventing a
 * third shape.
 *
 * ## CORS is not authorization
 *
 * A preflight carries no body, so it cannot know which token the eventual POST
 * will present. It answers a narrower question: "is this `Origin` an active,
 * verified domain of some tenant on this deployment" (the existing host
 * bootstrap lookup, no new cross-tenant read path). The POST then verifies the
 * token and that the host is registered for THAT source, exactly as before; this
 * decides only whether a browser may send and read it.
 *
 * Always `204`: a refusal is the ABSENCE of `Access-Control-Allow-Origin`, never
 * a status an origin could use to learn which other origins would be accepted.
 * Same-origin requests have nothing to preflight and cost no limiter slot.
 */
import {
  checkSharedRateLimit,
  resolveClientIp
} from "../../../lib/security/rate-limit";
import { resolvePublicTenantByHost } from "../../../lib/tenant/public-host-tenant-resolver";
import {
  isCrossOriginRequest,
  submissionPreflightHeaders
} from "../domain/origin-policy";
import { parseRequestOrigin } from "../../../lib/security/request-origin";

export async function submissionPreflightResponse(
  sql: Bun.SQL,
  request: Request,
  clientAddress: string | undefined,
  limits: { maxAttempts: number; windowMs: number }
): Promise<Response> {
  const parsed = parseRequestOrigin(request.headers.get("origin"));

  if (!parsed || !isCrossOriginRequest(parsed, request.url)) {
    return new Response(null, {
      status: 204,
      headers: submissionPreflightHeaders(null)
    });
  }

  const budget = await checkSharedRateLimit(
    `website_engagement:ip:${resolveClientIp(request, clientAddress)}`,
    limits
  );

  if (!budget.allowed) {
    return new Response(null, {
      status: 429,
      headers: {
        ...submissionPreflightHeaders(null),
        "retry-after": String(budget.retryAfterSec)
      }
    });
  }

  const tenant = await resolvePublicTenantByHost(sql, parsed.hostname);

  return new Response(null, {
    status: 204,
    headers: submissionPreflightHeaders(tenant ? parsed.origin : null)
  });
}
