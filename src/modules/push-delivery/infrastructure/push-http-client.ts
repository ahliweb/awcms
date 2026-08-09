/**
 * The one outbound HTTP seam for push adapters (Issue #466).
 *
 * Every network call this module makes goes through `ssrfSafeFetch`
 * (`src/lib/auth/ssrf-guard.ts`) rather than bare `fetch`. That is not
 * ceremony: the destinations here are resolved from a service-account
 * credential (`token_uri`) and from a subscription row (a Web Push endpoint
 * URL), and both are values that arrive from outside this code. A hostile or
 * merely wrong one pointing at `169.254.169.254` or at a loopback admin port
 * would otherwise be fetched by the worker with whatever network position it
 * holds — and the worker holds a database connection.
 *
 * The seam is a TYPE, not a wrapper around `fetch`, so tests can drive an
 * adapter without network access and without having to defeat the guard. A
 * test that had to disable the guard to run would be testing a different code
 * path than production runs.
 */
import { ssrfSafeFetch } from "../../../lib/auth/ssrf-guard";

export type PushHttpRequest = {
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
};

export type PushHttpResult =
  { ok: true; status: number; body: string } | { ok: false; reason: string };

export type PushHttpClient = (
  url: string,
  request: PushHttpRequest
) => Promise<PushHttpResult>;

/**
 * Deliberately caps the response body. Neither Google's token endpoint nor
 * FCM's send endpoint returns anything large, and an adapter that would buffer
 * a multi-megabyte reply from a host it was redirected to is a memory
 * amplification the guard cannot see.
 */
const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * A non-2xx is NOT a transport failure — it is a response, and the adapters
 * need its status and body to decide retryable/non-retryable/subscription-gone.
 * Only a guard denial or a network error yields `ok: false` here.
 */
export const defaultPushHttpClient: PushHttpClient = async (url, request) => {
  const result = await ssrfSafeFetch(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    timeoutMs: request.timeoutMs,
    maxResponseBytes: MAX_RESPONSE_BYTES
  });

  if (!result.ok) {
    return { ok: false, reason: `outbound request refused: ${result.reason}` };
  }

  return {
    ok: true,
    status: result.response.status,
    body: await result.response.text()
  };
};
