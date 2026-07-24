/**
 * Bounded, non-recursive redirect-chain resolution (ADR-0039; adapted from
 * awcms-micro ADR-0028 §8) — the loop/chain-prevention control. Given a start path
 * and an injected `lookup` (one indexed point-query per hop, NEVER a recursive SQL
 * CTE), it follows a chain of exact-path rules up to a hard hop cap and collapses it
 * to a SINGLE redirect to the final destination, or refuses (fail closed) when it
 * detects a self-redirect, a loop, or a chain longer than the cap.
 *
 * Purity: this function performs NO I/O. `lookup(pathKey)` is the only outside
 * interaction and is supplied by the caller (the resolution service does one DB
 * point lookup; create-time validation does an in-memory overlay lookup). The hop
 * cap bounds the number of `lookup` calls to `maxHops + 1`, so a request can never
 * fan out an unbounded number of queries.
 */
import { redirectPathKey } from "./redirect-path";
import type { RedirectStatusCode, RedirectTargetType } from "./redirect-rule";

/** The hard default hop cap. A chain longer than this is rejected (fail closed). */
export const MAX_REDIRECT_HOPS = 5;

export type RedirectHopRule = {
  id: string;
  targetType: RedirectTargetType;
  /** Normalized target: a relative path (possibly with query) or an absolute same-tenant URL. */
  target: string;
  statusCode: RedirectStatusCode;
  /** Whether this rule opts into forwarding the incoming query string (query policy). */
  preserveQuery: boolean;
};

/**
 * Resolve the ACTIVE rule matching `pathKey` (normalized, no query), or `null`.
 * May be sync (in-memory, for unit tests) or async (one DB point-query per hop,
 * for the resolution service) — `resolveRedirectChain` awaits it either way.
 */
export type RedirectChainLookup = (
  pathKey: string
) => (RedirectHopRule | null) | Promise<RedirectHopRule | null>;

export type RedirectChainOutcome =
  | { outcome: "none" }
  | {
      outcome: "redirect";
      finalTarget: string;
      finalTargetType: RedirectTargetType;
      statusCode: RedirectStatusCode;
      hops: RedirectHopRule[];
    }
  | { outcome: "loop"; hops: RedirectHopRule[] }
  | { outcome: "chain_too_long"; hops: RedirectHopRule[] };

const isPermanent = (c: RedirectStatusCode): boolean => c === 301 || c === 308;
const isMethodPreserving = (c: RedirectStatusCode): boolean =>
  c === 307 || c === 308;

/**
 * Combine a chain's per-hop status codes into the single code emitted for the
 * collapsed redirect. Permanent ONLY when EVERY hop is permanent (so a client
 * never permanently caches a destination that passed through a temporary hop);
 * otherwise temporary, preserving the first hop's method-preservation intent.
 */
export function combineChainStatus(
  hops: readonly RedirectHopRule[]
): RedirectStatusCode {
  const first = hops[0]!.statusCode;
  if (hops.every((h) => isPermanent(h.statusCode))) {
    return first; // 301 or 308
  }
  return isMethodPreserving(first) ? 307 : 302;
}

function buildRedirect(hops: RedirectHopRule[]): RedirectChainOutcome {
  const last = hops[hops.length - 1]!;
  return {
    outcome: "redirect",
    finalTarget: last.target,
    finalTargetType: last.targetType,
    statusCode: combineChainStatus(hops),
    hops
  };
}

/**
 * When a `verified_external` hop's absolute target points at one of the tenant's
 * OWN currently-verified hosts, it is not really a terminal external destination —
 * it denotes the same-tenant path `url.pathname`, which a browser will re-request
 * and which can re-enter the SAME redirect rules (an intra-tenant loop). Return
 * that same-tenant path key so the caller can fold it back into the identical
 * self-redirect / visited-set logic used for relative hops. Returns `null` when the
 * target is unparseable OR its host is NOT among `allowedHosts` — in that case the
 * hop stays terminal (and the resolve-time frozen-guard re-validation fails it
 * closed anyway if the host was since removed).
 */
function verifiedExternalSameHostPathKey(
  target: string,
  allowedHosts: readonly string[]
): string | null {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return null;
  }
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  if (!allowed.has(url.hostname.toLowerCase())) {
    return null;
  }
  // Strip any query with `redirectPathKey`, exactly as the relative branch does,
  // so `/a` and `/a?x=1` collapse to the same loop key.
  return redirectPathKey(url.pathname);
}

export type ResolveRedirectChainOptions = {
  maxHops?: number;
  /**
   * The tenant's currently-verified hosts. When provided, a `verified_external`
   * hop whose host is one of these is folded back into the chain (its `pathname`
   * re-enters the loop/visited-set + self-redirect detection) instead of being a
   * clean terminal — closing the `verified_external` same-host loop. When
   * omitted/empty, every `verified_external` hop is terminal (legacy behavior).
   */
  allowedHosts?: readonly string[];
};

/**
 * Resolve the redirect chain starting at `startPathKey` (a normalized path, no
 * query). Follows `relative_same_tenant` hops; a `verified_external` (absolute)
 * hop is terminal UNLESS its host is one of the tenant's own `allowedHosts`, in
 * which case its `pathname` is folded back into the chain so a same-host redirect
 * loop is detected. Detects self-redirect + loops via a visited-set and caps the
 * chain length.
 */
export async function resolveRedirectChain(
  startPathKey: string,
  lookup: RedirectChainLookup,
  options: ResolveRedirectChainOptions = {}
): Promise<RedirectChainOutcome> {
  const maxHops = options.maxHops ?? MAX_REDIRECT_HOPS;
  const allowedHosts = options.allowedHosts ?? [];

  let current = startPathKey;
  const visited = new Set<string>([current]);
  const hops: RedirectHopRule[] = [];

  for (let i = 0; i < maxHops; i++) {
    const rule = await lookup(current);

    if (!rule) {
      return hops.length === 0 ? { outcome: "none" } : buildRedirect(hops);
    }

    hops.push(rule);

    let nextKey: string;
    if (rule.targetType === "verified_external") {
      const sameHostKey = verifiedExternalSameHostPathKey(
        rule.target,
        allowedHosts
      );
      // Cross-host / unknown-host absolute target — genuinely terminal.
      if (sameHostKey === null) {
        return buildRedirect(hops);
      }
      // Same-host absolute target — fold its path back into the chain.
      nextKey = sameHostKey;
    } else {
      nextKey = redirectPathKey(rule.target);
    }

    // Self-redirect (target path equals the path we just matched) or revisiting a
    // path already in the chain — both are loops. Fail closed (no redirect emitted).
    if (nextKey === current || visited.has(nextKey)) {
      return { outcome: "loop", hops };
    }

    visited.add(nextKey);
    current = nextKey;
  }

  // Hit the cap. One more lookup decides: if the chain actually terminates exactly
  // at the cap, emit it; if it would keep going, it is too long — fail closed.
  return (await lookup(current))
    ? { outcome: "chain_too_long", hops }
    : buildRedirect(hops);
}
