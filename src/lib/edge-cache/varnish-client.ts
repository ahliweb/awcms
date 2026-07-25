/**
 * Varnish invalidation client — ADR-0042 §10.
 *
 * Sends one `BAN` request per surrogate key. The bundled VCL turns it into
 * `ban(obj.http.Surrogate-Key ~ "(^| )<key>( |$)")`.
 *
 * ## Why the key travels raw and the regex is assembled at the edge
 *
 * The alternative — build the full regex here and have the VCL `ban()` it
 * verbatim — hands a remote party a regex compiler. A key of `.*` would flush
 * the entire cache onto the origin: a one-request denial of service. So the app
 * sends only the key, restricted at construction to `[A-Za-z0-9:._-]`
 * (`sanitizeKeySegment`), and the VCL **re-validates that charset** before
 * building the expression. Two independent checks, because the mechanism is
 * remotely triggerable and the failure is a site-wide outage.
 *
 * ## Timeouts and why failure is quiet-but-recorded
 *
 * Every send is bounded by an `AbortController`. A hung edge must not hold a
 * worker: the row's lease simply expires and another pass retries it. A failed
 * BAN is written to `last_error` rather than thrown, because the correct
 * response to "the cache did not acknowledge" is to retry, not to abort the
 * remaining invalidations in the batch.
 */
import { loadEdgeCacheConfig, type EdgeCacheConfig } from "./config";

export const PURGE_TOKEN_HEADER = "X-Edge-Purge-Token";
export const PURGE_KEY_HEADER = "X-Edge-Purge-Key";

/** Bounds one BAN. Short: a healthy Varnish answers a ban in single-digit ms. */
const PURGE_TIMEOUT_MS = 5_000;

export type PurgeOutcome =
  { ok: true } | { ok: false; detail: string; retryable: boolean };

/** Injectable for tests — the real one is `globalThis.fetch`. */
export type FetchLike = (
  input: string,
  init: RequestInit & { signal: AbortSignal }
) => Promise<Response>;

/**
 * Mirrors the charset enforced by `sanitizeKeySegment`, plus the `:` that joins
 * segments in an assembled key. Checked again here so a key that reached the
 * queue by some path other than `buildSurrogateKey` (a hand-written row, a
 * future caller) still cannot inject a regex.
 */
const SAFE_KEY = /^[A-Za-z0-9:._-]{1,512}$/;

export async function sendEdgeCachePurge(
  surrogateKey: string,
  options: {
    config?: EdgeCacheConfig;
    fetchImpl?: FetchLike;
  } = {}
): Promise<PurgeOutcome> {
  const config = options.config ?? loadEdgeCacheConfig();
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike);

  if (!config.purgeEndpoint) {
    return {
      ok: false,
      detail: "EDGE_CACHE_PURGE_ENDPOINT is not configured.",
      // Not retryable: retrying a configuration error just burns the row's
      // attempts until it parks in `failed`, hiding the real cause.
      retryable: false
    };
  }

  if (!SAFE_KEY.test(surrogateKey)) {
    return {
      ok: false,
      detail: "Refusing to send a surrogate key with unsafe characters.",
      retryable: false
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PURGE_TIMEOUT_MS);

  try {
    const response = await fetchImpl(config.purgeEndpoint, {
      method: "BAN",
      headers: {
        [PURGE_KEY_HEADER]: surrogateKey,
        ...(config.purgeToken
          ? { [PURGE_TOKEN_HEADER]: config.purgeToken }
          : {})
      },
      signal: controller.signal
    });

    if (response.ok) {
      return { ok: true };
    }

    // 4xx is a rejected request (bad token, bad key) — retrying is pointless
    // and would mask a misconfiguration behind five identical failures. 5xx and
    // anything else is worth another pass.
    return {
      ok: false,
      detail: `Varnish rejected the BAN with status ${response.status}.`,
      retryable: response.status >= 500
    };
  } catch (error) {
    return {
      ok: false,
      detail:
        error instanceof Error && error.name === "AbortError"
          ? `BAN timed out after ${PURGE_TIMEOUT_MS}ms.`
          : "BAN request failed before a response was received.",
      retryable: true
    };
  } finally {
    clearTimeout(timeout);
  }
}
