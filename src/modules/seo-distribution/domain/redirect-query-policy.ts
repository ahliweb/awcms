/**
 * Explicit query-string policy for a resolved redirect (ADR-0039; adapted from
 * awcms-micro ADR-0028 §8). Query parameters are DROPPED by default and only
 * preserved when a rule opts in via `preserve_query` — and even then only for a
 * relative same-tenant target that carries no query of its own. This is
 * deliberately conservative: silently forwarding an arbitrary query string can
 * propagate tokens/tracking params in ways the operator did not intend, so the
 * default is drop, and preservation is a per-rule choice.
 */
import type { RedirectTargetType } from "./redirect-rule";

export type RedirectQueryPolicyInput = {
  target: string;
  targetType: RedirectTargetType;
  preserveQuery: boolean;
  /** The incoming request's raw query string INCLUDING the leading `?` (or ""). */
  incomingSearch: string;
};

/**
 * Apply the query policy to the final target. Returns the target unchanged unless
 * (a) `preserveQuery` is set, (b) the target is `relative_same_tenant`, (c) the
 * target has no query of its own, and (d) the incoming request had a non-empty
 * query — in which case the incoming query is appended. Absolute
 * (`verified_external`) targets never get the incoming query appended.
 */
export function applyRedirectQueryPolicy(
  input: RedirectQueryPolicyInput
): string {
  const { target, targetType, preserveQuery, incomingSearch } = input;

  if (!preserveQuery) return target;
  if (targetType !== "relative_same_tenant") return target;
  if (target.includes("?")) return target;

  const search = incomingSearch && incomingSearch !== "?" ? incomingSearch : "";
  if (search === "") return target;

  // `incomingSearch` already begins with `?`.
  return `${target}${search.startsWith("?") ? search : `?${search}`}`;
}
