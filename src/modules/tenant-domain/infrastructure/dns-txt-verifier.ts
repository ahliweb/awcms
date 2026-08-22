/**
 * The one outbound call domain verification makes: a public DNS TXT lookup
 * (ADR-0106).
 *
 * ## Why DNS and not HTTP
 *
 * The `file` method — fetch `https://<host>/.well-known/...` — would mean this
 * server issuing an HTTP request to a hostname the caller chose, which is the
 * definition of SSRF and would need the full `isBlockedAddress` treatment plus
 * redirect handling plus a response-size cap to be safe. A DNS query is not
 * that: it goes to the configured resolver, never to the claimed host, carries
 * no credentials, and cannot be pointed at `169.254.169.254`. `file` is
 * therefore not in the vocabulary at all rather than half-built.
 *
 * ## Where this runs
 *
 * OUTSIDE any database transaction, always (ADR-0006). The verify route reads
 * the challenge in one transaction, calls this, and writes the outcome in a
 * second — see `src/pages/api/v1/tenant/domains/[id]/verify.ts`.
 *
 * ## Absent is not unavailable, and the difference is the whole design
 *
 * `NXDOMAIN`/`NODATA` is a fact about the CLAIMED DOMAIN: the record is not
 * published, which is a perfectly ordinary answer meaning "not yet". A
 * `SERVFAIL`, a refusal or a timeout is a fact about OUR RESOLVER, and tells
 * us nothing about the domain.
 *
 * Only the second kind feeds the circuit breaker, and only the second kind
 * leaves the domain's status untouched. Collapsing them is exactly the defect
 * finding D6 recorded against the email provider, where per-message rejections
 * — facts about the row — were tripping a breaker that then stopped delivery
 * for the whole deployment. Here the same mistake would be worse in both
 * directions at once: every tenant who mistypes a hostname would push the
 * breaker toward open and lock out everybody else's verification, and a
 * resolver outage would mark honest, correctly-published domains `failed`.
 */
import { promises as dns } from "node:dns";

import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { TimeoutError, withTimeout } from "../../../lib/integration/timeout";

const PROVIDER_KEY = "tenant-domain-dns-verify";

/**
 * Short on purpose: this sits on a request path an operator is watching, and a
 * wedged resolver must degrade to "try again" quickly rather than hold the
 * request open. A correctly-configured resolver answers a cached negative in
 * single-digit milliseconds and an uncached lookup well inside this.
 */
export const DNS_VERIFY_TIMEOUT_MS = 5_000;

export type DnsTxtLookupResult =
  /** The name resolved; `records` may still not contain the challenge. */
  | { outcome: "records"; records: string[][] }
  /** The name (or the TXT record set at it) does not exist. Not an error. */
  | { outcome: "absent" }
  /** We could not find out. The domain's status must not move. */
  | { outcome: "unavailable"; reason: string };

/**
 * c-ares codes that are statements about the QUERIED NAME. `ENOTFOUND` is
 * NXDOMAIN, `ENODATA` is "the name exists, but has no TXT records" — a zone
 * that exists and simply has not published the challenge yet, which is the
 * single most common answer this function gives.
 */
const NAME_LEVEL_CODES = new Set(["ENOTFOUND", "ENODATA", "NOTFOUND"]);

function classifyLookupError(error: unknown): DnsTxtLookupResult {
  if (error instanceof TimeoutError) {
    return { outcome: "unavailable", reason: "timeout" };
  }

  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown";

  if (NAME_LEVEL_CODES.has(code)) {
    return { outcome: "absent" };
  }

  // Everything else — `ESERVFAIL`, `EREFUSED`, `ECONNREFUSED`, `EBADRESP`, and
  // anything this list does not know about — is treated as OUR problem, not the
  // domain's. Fail-safe in the direction that matters: an unrecognised code
  // must never be read as "the record is definitely not there" and mark a
  // correctly-configured domain `failed`.
  return { outcome: "unavailable", reason: code };
}

export type DnsTxtResolver = (name: string) => Promise<string[][]>;

/**
 * Injection seam for tests only. Production calls this with the record name
 * and nothing else.
 */
export type DnsTxtLookupDeps = {
  /**
   * Defaults to `dns.resolveTxt`, which uses the process's configured
   * resolvers. No attempt is made to pick our own: a deployment that has an
   * opinion about which resolver to trust expresses it in `/etc/resolv.conf`,
   * and an app-level override would be a second place to keep that in step.
   */
  resolver?: DnsTxtResolver;
  now?: Date;
  timeoutMs?: number;
};

/**
 * Resolves the TXT records at `recordName`, timeout-bounded and behind the
 * shared provider circuit breaker.
 */
export async function resolveVerificationTxtRecords(
  recordName: string,
  deps: DnsTxtLookupDeps = {}
): Promise<DnsTxtLookupResult> {
  const resolver = deps.resolver ?? dns.resolveTxt;
  const now = deps.now ?? new Date();
  const timeoutMs = deps.timeoutMs ?? DNS_VERIFY_TIMEOUT_MS;
  const breaker = getProviderCircuitBreaker(PROVIDER_KEY);

  if (!breaker.canAttempt(now)) {
    return { outcome: "unavailable", reason: "circuit_open" };
  }

  try {
    const records = await withTimeout(
      resolver(recordName),
      timeoutMs,
      "tenant-domain DNS TXT verification"
    );

    breaker.recordSuccess(now);

    return { outcome: "records", records };
  } catch (error) {
    const classified = classifyLookupError(error);

    // A name-level answer is a SUCCESSFUL resolver interaction. Recording it as
    // a failure would let a few tenants with unpublished records open the
    // breaker for everybody.
    if (classified.outcome === "absent") {
      breaker.recordSuccess(now);
    } else {
      breaker.recordFailure(now);
    }

    return classified;
  }
}
