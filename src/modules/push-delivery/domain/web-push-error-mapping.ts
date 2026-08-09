/**
 * Web Push (RFC 8030) response → dispatcher outcome (Issue #466). Pure: a
 * status code in, a decision out.
 *
 * Same three-way split as the FCM mapper, and the same reasoning about the
 * circuit breaker: a `404`/`410` is one subscription reporting its own death,
 * not a statement about whether the push SERVICE is healthy. A queue routinely
 * carries thousands of them, and counting them as provider failures would stop
 * delivery to every live subscriber on that service.
 *
 * ## Why there are several push services, and why that matters here
 *
 * Unlike FCM, "the provider" is not one host: Chrome subscriptions live on
 * `fcm.googleapis.com`, Firefox on `updates.push.services.mozilla.com`, Edge on
 * `*.notify.windows.com`. They fail independently. The breaker key is shared
 * across all of them today (`PUSH_CIRCUIT_BREAKER_KEY`), which means one
 * service's outage can pause delivery to the others — stated here rather than
 * discovered, because the fix (a breaker per audience) is only worth its
 * complexity once a real deployment has subscribers on more than one.
 */

export type WebPushOutcome =
  | { kind: "success" }
  | { kind: "subscription_gone"; error: string }
  | {
      kind: "failure";
      error: string;
      retryable: boolean;
      tripsBreaker: boolean;
    };

const MAX_SNIPPET = 300;

export function mapWebPushResponse(
  status: number,
  body: string
): WebPushOutcome {
  const snippet = body.slice(0, MAX_SNIPPET);

  // RFC 8030 §5: a successful push is 201 Created. 200/202 are accepted too —
  // some services answer 200, and refusing a 2xx because it is not the exact
  // code the RFC prefers would fail deliveries that actually happened.
  if (status >= 200 && status < 300) {
    return { kind: "success" };
  }

  // 404: the subscription never existed here. 410 Gone: it did and was removed
  // (permission revoked, browser data cleared). Both mean the same to us.
  if (status === 404 || status === 410) {
    return { kind: "subscription_gone", error: `${status}: ${snippet}` };
  }

  // 401/403: the VAPID token was refused — wrong key pair, wrong `aud`, or a
  // subject the service rejects. A configuration fact, identical next time.
  if (status === 401 || status === 403) {
    return {
      kind: "failure",
      error: `VAPID rejected (${status}): ${snippet}`,
      retryable: false,
      tripsBreaker: false
    };
  }

  // 413: the encrypted payload exceeded what the service accepts. Retrying the
  // same bytes cannot help.
  if (status === 413) {
    return {
      kind: "failure",
      error: `payload too large (413): ${snippet}`,
      retryable: false,
      tripsBreaker: false
    };
  }

  if (status === 429 || status >= 500) {
    return {
      kind: "failure",
      error: `${status}: ${snippet}`,
      retryable: true,
      tripsBreaker: true
    };
  }

  return {
    kind: "failure",
    error: `${status}: ${snippet}`,
    retryable: false,
    tripsBreaker: false
  };
}
