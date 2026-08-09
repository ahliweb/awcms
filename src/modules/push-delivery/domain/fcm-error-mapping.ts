/**
 * FCM HTTP v1 response → dispatcher outcome (Issue #466). Pure: a status code
 * and a body string in, a decision out. No network, no clock, no I/O — which is
 * what lets every branch below be tested against real FCM error bodies instead
 * of being reasoned about.
 *
 * ## Three outcomes, not two
 *
 * `subscriptionGone` is separate from `retryable: false` (ADR-0074). FCM
 * answers `UNREGISTERED` for a token whose app was uninstalled or whose
 * registration was rotated — that is the subscription reporting its own death,
 * and the dispatcher disables it. Treating it as an ordinary permanent failure
 * would leave a tombstone token collecting one failure per message forever.
 *
 * ## `tripsBreaker` is the decision most likely to be got wrong
 *
 * The circuit breaker exists to stop hammering a provider that is DOWN. A
 * per-message rejection — a dead token, a malformed payload — says nothing
 * about whether FCM is healthy, and there can be thousands of them in a normal
 * queue. If those tripped the breaker, one batch of stale tokens would stop
 * delivery to every healthy device in the tenant, and the symptom ("push
 * stopped") would point at FCM rather than at the tokens.
 *
 * So only signals about the SERVICE trip it: transport failures, 429, and 5xx.
 * A 401 does not, either — it means our access token was rejected, which the
 * adapter fixes by minting a new one.
 *
 * ## Order matters, and a test proved it
 *
 * The error CODE is read before the status. FCM overloads statuses in both
 * directions, and 401 is the sharpest case: it is BOTH "your access token
 * expired" (no error code) and `THIRD_PARTY_AUTH_ERROR` (APNs/web credentials
 * an operator has to fix). Checking the status first turned the second into the
 * first — a fresh token minted and replayed, refused for the same reason, and a
 * standing configuration fault reported as an expiry.
 */

export type FcmOutcome =
  | { kind: "success" }
  | { kind: "subscription_gone"; error: string }
  | {
      kind: "failure";
      error: string;
      retryable: boolean;
      tripsBreaker: boolean;
    }
  /** The access token was rejected — drop the cached one and retry. */
  | { kind: "unauthorized"; error: string };

/** Error codes FCM returns in `error.details[].errorCode`, and what each means for us. */
const SUBSCRIPTION_GONE_CODES = new Set(["UNREGISTERED"]);

const PERMANENT_CODES = new Set([
  // The payload or the target is wrong, and will be wrong next time too.
  "INVALID_ARGUMENT",
  // The token belongs to a different sender/project — a configuration mistake.
  "SENDER_ID_MISMATCH",
  // APNs/web credentials rejected by the third party — an operator fix.
  "THIRD_PARTY_AUTH_ERROR"
]);

const RETRYABLE_CODES = new Set(["UNAVAILABLE", "INTERNAL", "QUOTA_EXCEEDED"]);

/** Pulls `error.details[].errorCode` out of an FCM v1 error body; `null` when the body is not one. */
export function extractFcmErrorCode(body: string): string | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  const details = (
    parsed as { error?: { details?: { errorCode?: unknown }[] } }
  )?.error?.details;

  if (!Array.isArray(details)) {
    return null;
  }

  for (const detail of details) {
    if (typeof detail?.errorCode === "string") {
      return detail.errorCode;
    }
  }

  return null;
}

const MAX_SNIPPET = 300;

export function mapFcmResponse(status: number, body: string): FcmOutcome {
  if (status >= 200 && status < 300) {
    return { kind: "success" };
  }

  const code = extractFcmErrorCode(body);
  const snippet = body.slice(0, MAX_SNIPPET);
  const described = code ? `${code}: ${snippet}` : snippet;

  // The error CODE is consulted before the status, because FCM overloads
  // statuses in both directions: 404 is `UNREGISTERED` but a 400 can carry it
  // too, and 401 is BOTH "our access token expired" (no error code) and
  // `THIRD_PARTY_AUTH_ERROR` (APNs/web credentials the operator must fix).
  //
  // An earlier version of this function checked `status === 401` first, and a
  // test caught it: `THIRD_PARTY_AUTH_ERROR` was reported as `unauthorized`,
  // so the adapter would mint a fresh token and replay — spending a round-trip
  // to be refused for the same reason, and labelling a standing configuration
  // fault as an expiry. The code is the specific signal; the status is the
  // fallback, and never the other way round.
  if (code && SUBSCRIPTION_GONE_CODES.has(code)) {
    return { kind: "subscription_gone", error: described };
  }

  if (code && PERMANENT_CODES.has(code)) {
    return {
      kind: "failure",
      error: described,
      retryable: false,
      tripsBreaker: false
    };
  }

  if (code && RETRYABLE_CODES.has(code)) {
    return {
      kind: "failure",
      error: described,
      retryable: true,
      // QUOTA_EXCEEDED and UNAVAILABLE/INTERNAL are all statements about the
      // service, so they do count toward the breaker.
      tripsBreaker: true
    };
  }

  // No FCM error code, so this is Google's own auth layer refusing the bearer
  // token rather than FCM refusing the message.
  if (status === 401) {
    return { kind: "unauthorized", error: described };
  }

  if (status === 404) {
    return { kind: "subscription_gone", error: described };
  }

  if (status === 429 || status >= 500) {
    return {
      kind: "failure",
      error: described,
      retryable: true,
      tripsBreaker: true
    };
  }

  // Every other 4xx: the request was understood and refused. Retrying an
  // identical request would be refused identically.
  return {
    kind: "failure",
    error: described,
    retryable: false,
    tripsBreaker: false
  };
}
