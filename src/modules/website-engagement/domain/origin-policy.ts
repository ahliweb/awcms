/**
 * Origin provenance and the cross-origin answer for the public intake
 * (ADR-0155 section 3).
 *
 * ## The Origin check is defence in depth, never the only gate
 *
 * A browser sends the real `Origin` and a script cannot change it; a
 * non-browser client (curl, a bot) can send any value. So a matching `Origin`
 * proves only that a BROWSER on a registered host made the request, and it is
 * one of four co-equal controls with the token, the challenge and the rate
 * limit. Server-to-server submission is a different, signed mode that this
 * first slice does not offer.
 *
 * ## What counts as an origin here
 *
 * 1. A well-formed `Origin` header (`parseRequestOrigin`: no `null`, no
 *    extension schemes, no path or userinfo).
 * 2. Only when there is NO `Origin` header at all: the `Referer` host. A present
 *    but unusable `Origin` (`null`, a sandboxed frame) is refused, never
 *    downgraded to a `Referer` an attacker could shape.
 * 3. Neither: refused. There is no anonymous, origin-less path.
 *
 * ## CORS is never `*` and never credentialed
 *
 * The allowed origin is echoed verbatim and ONLY after the host matched a
 * domain registered for the source. No cookie is read or set, so credentials
 * are never granted. `Vary: Origin` is on EVERY response, refusals included.
 *
 * Pure module: no database, no I/O.
 */
import {
  isCrossOriginRequest,
  parseRequestOrigin
} from "../../../lib/security/request-origin";

export type SubmissionOrigin = {
  origin: string;
  hostname: string;
  via: "origin" | "referer";
};

/** `null` when the request names no usable origin. Never throws. */
export function classifySubmissionOrigin(
  request: Request
): SubmissionOrigin | null {
  const originHeader = request.headers.get("origin");

  if (originHeader !== null) {
    const parsed = parseRequestOrigin(originHeader);

    return parsed ? { ...parsed, via: "origin" } : null;
  }

  const referer = request.headers.get("referer");

  if (referer === null || referer.length === 0 || referer.length > 2048) {
    return null;
  }

  try {
    const url = new URL(referer);

    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    if (url.username !== "" || url.password !== "") return null;

    return {
      origin: url.origin,
      hostname: url.hostname.toLowerCase(),
      via: "referer"
    };
  } catch {
    return null;
  }
}

/**
 * A hostname that is the developer's own machine. Only these may use plain
 * `http` (audit L2): a production source is `https` or it is refused, so the
 * CORS grant can never echo an `http` origin for it.
 */
export function isLocalDevHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1"
  );
}

/** `https`, or `http` for an explicit localhost/dev host only. */
export function isAcceptableOriginScheme(origin: {
  origin: string;
  hostname: string;
}): boolean {
  return (
    origin.origin.startsWith("https://") || isLocalDevHost(origin.hostname)
  );
}

/** Exact, case-insensitive hostname match against the hosts registered for a source. */
export function isRegisteredHost(
  hostname: string,
  registeredHosts: readonly string[]
): boolean {
  const wanted = hostname.toLowerCase();

  return registeredHosts.some((host) => host.toLowerCase() === wanted);
}

export const SUBMISSION_PREFLIGHT_MAX_AGE_SECONDS = 600;

/** Headers for the POST's own answer. A refusal is the ABSENCE of the grant. */
export function submissionCorsHeaders(
  verifiedOrigin: string | null
): Record<string, string> {
  return verifiedOrigin === null
    ? { vary: "Origin" }
    : { "access-control-allow-origin": verifiedOrigin, vary: "Origin" };
}

/**
 * Headers for a preflight. `content-type` is the only allowed request header:
 * the token travels in the JSON body, so no `Authorization` header is ever
 * negotiated and this cannot grow into a general-purpose cross-origin API.
 */
export function submissionPreflightHeaders(
  grantedOrigin: string | null
): Record<string, string> {
  if (grantedOrigin === null) return { vary: "Origin" };

  return {
    ...submissionCorsHeaders(grantedOrigin),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": String(SUBMISSION_PREFLIGHT_MAX_AGE_SECONDS)
  };
}

export { isCrossOriginRequest };
