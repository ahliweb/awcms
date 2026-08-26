/**
 * Turning one HTTP redirect chain into the verdict model the cutover already
 * has (Issues #599 / #711, ADR-0114 / ADR-0115).
 *
 * ## The layer `blog:legacy:cutover:verify` cannot see
 *
 * That job makes ZERO HTTP requests — its own docstring says so — and asks the
 * database "is there a rule, and is there a row at the end of it". Under
 * ADR-0114 the SeputarBorneo 301s execute at the EDGE, which is not that
 * database, so a green run there says the DB agrees with itself and nothing
 * about what a reader receives.
 *
 * That gap has already cost a merged ADR. ADR-0113 §Consequences said
 * `awcms-astro` "needs no change… the redirect is resolved in this repo before
 * its routes are reached", and the 67 rubrik entries committed AT THE TIME, replayed
 * against that repo's real built server, returned **404 with zero `Location`
 * headers** (the map holds 68 today; the 68th landed afterwards on the same
 * branch and has not been replayed — it targets `/kategori/mitra-borneo` like
 * the 23 siblings that were). No gate here could see it, because the answer was a build
 * configuration in another repository. **An HTTP probe can see it**, because it
 * asks the origin rather than reasoning about it — which is the whole reason
 * this module exists.
 *
 * ## It reuses the verdict model rather than inventing a second one
 *
 * `classifyCutoverOutcome` is pure and takes four facts. This module produces
 * exactly those four from a chain of real responses, so an edge run and a
 * database run are reported in one vocabulary and an operator does not have to
 * learn which "ok" they are reading. Two facts change meaning and neither
 * changes shape:
 *
 *  - `hops` counts the 3xx responses actually followed, not the rules matched.
 *    PRD §9.2's one-hop rule is therefore checked on the wire, where it is
 *    actually a property — the reason ADR-0114 gives the edge the job in the
 *    first place is that an application only ever sees hop two.
 *  - `targetLive` is the FINAL response's status: `true` for 2xx, `false` for
 *    404/410, `null` for anything the probe cannot honestly call either
 *    (a 5xx, a network failure). `null` becomes `target_unverifiable`, never
 *    `ok` — the distinction that verdict was added to protect.
 *
 * Pure: it takes a chain that has already been walked. The walking is I/O and
 * lives in the script, so every classification below is provable without a
 * server.
 */

import { isIP } from "node:net";

import { isBlockedAddress } from "../../../lib/auth/ssrf-guard";
import type { CutoverFacts } from "./cutover-verification";

export type HopRefusal =
  "scheme_not_allowed" | "credentials_in_url" | "private_address";

/**
 * Whether the probe may issue a request for this URL, and why not when it may
 * not.
 *
 * ## The threat, and why this is not `validateOutboundUrl`
 *
 * `Location` is written by whatever answered the previous request. A legacy
 * origin that has been taken over — or simply misconfigured — can therefore
 * point this tool at anything the machine running it can reach, and the tool
 * would have fetched it and reported `ok`. Measured before this existed:
 * `Location: file:///etc/hostname` and `Location: data:text/plain,hi` were both
 * resolved and recorded as a 200, and a redirect to a loopback port reached the
 * server listening on it.
 *
 * `src/lib/auth/ssrf-guard.ts` already owns this question, and its
 * `validateOutboundUrl` is exported for exactly this ("so the redirect loop
 * below can re-validate each hop"). It cannot be used here as-is, and the
 * reason is not laziness: it refuses `http:` outright unless the host is in an
 * env allow-list that is documented as "never set on a real deployment". The
 * whole premise of this job is starting from the URL a CRAWLER holds —
 * `http://www.seputarborneo.com/news/…` — so that rule would refuse the primary
 * use case. `ssrfSafeFetch` is likewise wrong here for a different reason: it
 * follows redirects internally and returns only the final `Response`, which
 * destroys the hop-by-hop visibility this job exists to produce.
 *
 * So the pieces are reused rather than the wrapper: `isBlockedAddress` is the
 * same address rule, imported not restated.
 *
 * ## What this deliberately does NOT do, stated so it is a boundary and not a hole
 *
 * It does not RESOLVE hostnames. A host that resolves to a private address
 * passes here, and DNS rebinding is out of scope. Two reasons, and they are
 * proportionate rather than convenient: this is an operator-run CLI over a
 * corpus the operator chose, sending no credentials and reading no response
 * body; and a resolution per hop over a 25,029-URL archive is a different tool
 * with a different runtime. A server endpoint taking a URL from a request must
 * use `validateOutboundUrl`, which does resolve.
 */
export function hopRefusalFor(
  rawUrl: string,
  options: { allowPrivateAddresses: boolean }
): HopRefusal | null {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return "scheme_not_allowed";
  }

  // `file:` and `data:` have no legitimate meaning for a page a reader would
  // be redirected to, and both were followed before this line existed. Refused
  // unconditionally — there is no flag for them, because there is no use.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "scheme_not_allowed";
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return "credentials_in_url";
  }

  // Default DENY, with an opt-in: verifying a build on 127.0.0.1 is a real and
  // useful thing to do (it is how ADR-0113's claim was falsified), so the flag
  // exists — but an operator pointing this at a live archive gets the guard
  // without having to know it is there.
  if (!options.allowPrivateAddresses) {
    const literal = ipLiteralHost(url.hostname);
    if (literal !== null && isBlockedAddress(literal)) {
      return "private_address";
    }
  }

  return null;
}

/**
 * The bare IP a URL's `hostname` names, or `null` when it names a DNS name.
 *
 * ## The brackets are the whole reason this function exists
 *
 * WHATWG `URL` keeps an IPv6 host in its BRACKETED form —
 * `new URL("http://[::1]:8080/").hostname` is `"[::1]"`, not `"::1"` — and
 * `node:net`'s `isIP` answers **0** for the bracketed string. The guard above
 * was written as `isIP(url.hostname) !== 0`, so for every IPv6 literal it
 * short-circuited to "allowed" and `isBlockedAddress` — the rule this module
 * says it reuses rather than restates — was never consulted at all. `[::1]`,
 * `[fd00::1]` and `[::ffff:127.0.0.1]` were all fetched with the guard ON.
 *
 * `isBlockedAddress` itself handles both spellings, so the defect was purely
 * the reachability test in front of it. Stripping here rather than there keeps
 * the ssrf-guard's contract unchanged and puts the URL-parsing quirk next to
 * the URL parsing.
 */
function ipLiteralHost(hostname: string): string | null {
  const bare =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  return isIP(bare) === 0 ? null : bare;
}

/** One response in a redirect chain, reduced to what a verdict needs. */
export type ProbeResponse = {
  /** The absolute URL that was requested. */
  url: string;
  /** HTTP status, or `null` when the request never completed (DNS, refused, timeout). */
  status: number | null;
  /** The `Location` header verbatim, when the response carried one. */
  location: string | null;
};

export type ProbeChain = {
  /** In request order. The first entry is the legacy URL itself. */
  responses: ProbeResponse[];
  /**
   * True when the walk stopped because it ran out of budget rather than
   * because it reached a non-3xx response.
   *
   * Distinct from a loop: a chain of five DIFFERENT hops is not circular and is
   * still a chain far too long, and the two need different words in a report.
   */
  exhausted: boolean;
  /** True when a URL repeated in the chain — a genuine cycle. */
  looped: boolean;
  /**
   * Set when the walk stopped because a hop pointed somewhere the probe
   * refuses to follow. `null` when it did not.
   *
   * Its own field rather than a `status`-shaped stand-in, because it is a
   * SECURITY observation and `unsafe_redirect` has to outrank the hop count:
   * a chain refused at hop 3 is not "chain_too_long", it is a redirect into a
   * place a legacy origin should never be sending anyone.
   */
  unsafeHop?: { url: string; refusal: HopRefusal } | null;
};

/** 5xx: the origin failed to answer the question, as distinct from answering "no". */
function isServerError(status: number): boolean {
  return status >= 500;
}

function isRedirect(status: number | null): boolean {
  return status !== null && status >= 300 && status < 400;
}

/**
 * The four facts `classifyCutoverOutcome` needs, from a walked chain.
 *
 * `eligible` is always `true` here and that is not a shortcut: eligibility is
 * `isRedirectEligiblePath`, a rule about which paths THIS application's tenant
 * redirect table is allowed to claim. The edge is under no such restriction —
 * it is in front of both origins and answers for paths neither of them route —
 * so importing that predicate would mark a URL the edge redirects correctly as
 * `ineligible`. The honest statement is that the question does not apply at
 * this layer.
 */
export function probeFactsFrom(chain: ProbeChain): CutoverFacts {
  const responses = chain.responses;
  const last = responses[responses.length - 1];

  // Checked FIRST, before the loop and the budget and before the "nothing was
  // observed" branch. A hostile origin can produce a cycle or a long chain as
  // easily as a single hop, and reporting either of those — or `unreachable`,
  // which a refused first hop would otherwise land on — hides the one thing an
  // operator has to act on.
  if (chain.unsafeHop) {
    return {
      eligible: true,
      hops: responses.length,
      refusal: "unsafe_redirect",
      targetLive: null
    };
  }

  if (chain.looped) {
    return {
      eligible: true,
      hops: responses.length,
      refusal: "loop",
      targetLive: null
    };
  }

  if (chain.exhausted) {
    return {
      eligible: true,
      hops: responses.length,
      refusal: "chain_too_long",
      targetLive: null
    };
  }

  // Every response except the last was a redirect that was followed.
  const hops = responses.filter((response) =>
    isRedirect(response.status)
  ).length;

  // No response at all.
  //
  // Unreachable through the production path today — `walkRedirectChain` always
  // records at least one response before returning, and a refused first hop is
  // caught by the `unsafeHop` branch above. Kept, and stated as unreachable
  // rather than justified with a call shape that does not exist: this function
  // is exported and pure, so a caller constructing a chain by hand is exactly
  // what a test does, and falling through to `last.status` would throw.
  if (last === undefined) {
    return {
      eligible: true,
      hops: 0,
      refusal: "unreachable",
      targetLive: null
    };
  }

  // The chain ended without an answer anyone can reason about: the request
  // never completed at all.
  //
  // Narrowed to `status === null` deliberately. It used to be "anything
  // `finalLiveness` cannot judge", which swept in 401, 403, 429 and 451 — and
  // `unreachable`'s operator text says "the request never produced an answer",
  // which for a 403 is simply false: the origin answered, and what it said is
  // the most useful fact in the row. Those now fall through to
  // `target_unverifiable`, which claims only that nobody checked the
  // destination. A 5xx keeps `unreachable` because the origin genuinely did not
  // answer the question that was asked.
  //
  // This branch is the whole reason `unreachable` exists. Without it these
  // land on `hops === 0` and classify as `no_rule`, whose reason text is the
  // confident "this URL will answer 404 after cutover, and its ranking is
  // lost" — a claim about a request that produced no observation. A 502 while
  // the origin restarts would have read as a missing redirect rule, and an
  // operator would go looking for a row that is already correct.
  if (hops === 0 && (last.status === null || isServerError(last.status))) {
    return {
      eligible: true,
      hops: 0,
      refusal: "unreachable",
      targetLive: null
    };
  }

  return {
    eligible: true,
    hops,
    refusal: null,
    targetLive: finalLiveness(last.status)
  };
}

/**
 * Whether the page at the end of the chain exists.
 *
 * The three-way split is the point. A 5xx is NOT `false`: an origin that is
 * having a bad minute has not told us the page is missing, and reporting
 * `target_missing` for it would send an operator to delete a rule that is
 * correct. `null` says "nobody checked", which `target_unverifiable` was added
 * to spell — and which used to be spelled `ok`.
 *
 * A 3xx here means the walk stopped mid-chain, so the destination is likewise
 * unseen.
 */
export function finalLiveness(status: number | null): boolean | null {
  if (status === null) return null;
  if (status >= 200 && status < 300) return true;
  // 404 and 410 are the two ways an origin says "not here". A 401/403 is a page
  // that EXISTS behind a gate, which is not this check's business — but it is
  // not a public archive page either, so it is unverifiable rather than live.
  if (status === 404 || status === 410) return false;
  return null;
}

/**
 * The absolute URL a `Location` names, resolved against the response it came
 * from, or `null` when it cannot be resolved.
 *
 * Relative `Location` values are common and legal, and `new URL(location, base)`
 * is the same resolution a browser performs — restating it by hand is how a
 * verifier ends up proving that its own reimplementation agrees with itself.
 */
export function resolveLocation(from: string, location: string): string | null {
  try {
    return new URL(location, from).toString();
  } catch {
    return null;
  }
}
