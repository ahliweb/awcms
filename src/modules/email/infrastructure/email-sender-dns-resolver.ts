/**
 * The one outbound call the advisory SPF/DKIM/DMARC evidence makes: public DNS
 * TXT lookups (Issue #1479, owner decision K19.2: DNS egress from the jobs
 * container ONLY).
 *
 * Reached only from `scripts/email-senders-verify.ts` (the jobs container); no
 * request path and no other job imports it (`tests/email-sender-dns-evidence`
 * pins that), so the web process makes no DNS query on a tenant's behalf. A
 * query goes to the process's configured resolver, never to the claimed host,
 * carries no credentials, and runs OUTSIDE every database transaction
 * (ADR-0006). Name-level absence (`ENOTFOUND`, `ENODATA`) is a fact about the
 * domain; everything else is a fact about our resolver and is `unavailable`.
 */
import { promises as dns } from "node:dns";

import { TimeoutError, withTimeout } from "../../../lib/integration/timeout";
import type { TxtLookup, TxtResolver } from "../domain/email-sender-dns";

/** Short and bounded: a wedged resolver degrades to "unavailable" quickly. */
export const EMAIL_SENDER_DNS_TIMEOUT_MS = 3_000;

const NAME_LEVEL_CODES = new Set(["ENOTFOUND", "ENODATA", "NOTFOUND"]);

export function classifyDnsFailure(error: unknown): TxtLookup {
  if (error instanceof TimeoutError) return { outcome: "unavailable" };

  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "unknown";

  // An unrecognised code is OUR problem, never "the record is not there".
  return NAME_LEVEL_CODES.has(code)
    ? { outcome: "absent" }
    : { outcome: "unavailable" };
}

export function createEmailSenderTxtResolver(
  options: {
    lookup?: (name: string) => Promise<string[][]>;
    timeoutMs?: number;
  } = {}
): TxtResolver {
  const lookup = options.lookup ?? ((name) => dns.resolveTxt(name));
  const timeoutMs = options.timeoutMs ?? EMAIL_SENDER_DNS_TIMEOUT_MS;

  return async (name) => {
    try {
      const records = await withTimeout(
        lookup(name),
        timeoutMs,
        "email-sender-dns"
      );

      return { outcome: "records", records };
    } catch (error) {
      return classifyDnsFailure(error);
    }
  };
}
