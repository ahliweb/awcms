/**
 * `isSameOriginPath` — is this string a safe path-absolute, same-origin target?
 *
 * ## Why this is NOT a duplicate of `classifyRedirectTarget`
 *
 * `seo_distribution`'s `domain/redirect-target-classification.ts` is the FROZEN
 * open-redirect guard (ADR-0039), and it answers a strictly BIGGER question: it
 * must also accept ABSOLUTE `http(s)` URLs and decide whether their host is one
 * of the tenant's registered hosts. That is what forces its blocklist shape — it
 * has to admit `https://tenant.example/x` while rejecting `//evil.com`,
 * `/\evil.com`, embedded control characters, and `javascript:`.
 *
 * The question here is smaller and closed: **is this a relative path on this
 * origin?** Absolute URLs are not merely unnecessary, they are not wanted at all.
 * That lets this be an ALLOW-LIST over a character set rather than a list of
 * known bypasses — the difference between "everything I remembered to forbid" and
 * "only what I can name", which is the direction this repo's `theming` CSS
 * validation already argues for (reject, never sanitize).
 *
 * Two reasons not to simply import the frozen guard, both real:
 *
 *  1. **Module graph.** It lives in a domain module. A route owned by
 *     `identity_access` importing `seo_distribution` is an undeclared cross-module
 *     dependency (`tests/module-boundary.test.ts` catches it), and declaring it
 *     would say authentication depends on SEO — which is false, and would outlive
 *     the convenience that motivated it.
 *  2. **ADR-0039 homed it deliberately.** Its header argues at length for living
 *     in "the module that actually owns redirects". Relocating a frozen security
 *     artifact to `src/lib/` as a side effect of adding a language switcher would
 *     be exactly the kind of drive-by that ADR exists to prevent.
 *
 * So: one narrow function, in infrastructure, with the bypasses this repo has
 * already paid to learn about covered by `tests/same-origin-path.test.ts`.
 */

/**
 * Characters legal in a path, query or fragment we are willing to redirect to.
 *
 * Deliberately EXCLUDES the backslash (browsers normalise `\` to `/`, which is how
 * `/\evil.com` becomes protocol-relative) and every C0 control character and DEL
 * (the WHATWG URL parser strips TAB/LF/CR before parsing, so `"/\t/evil.com"`
 * collapses to `//evil.com` — a verified bypass of naive `startsWith("/")`
 * checks). Both are excluded by CONSTRUCTION here rather than by a rule that has
 * to remember them: they are simply not in the allowed set.
 *
 * Note `%` is allowed, so percent-encoded input passes through. That is safe
 * because the value is only ever used as a `Location` header on this origin: a
 * percent sequence cannot introduce an authority component, which is the only
 * thing that could change the origin.
 */
const ALLOWED_PATH_CHARS = /^[A-Za-z0-9._~!$&'()*+,;=:@%/?#[\]-]*$/;

/**
 * True when `value` is a path-absolute reference that cannot leave this origin.
 *
 * Requires: a leading `/`, NOT followed by a second `/` or a backslash
 * (protocol-relative and its normalised variants), and every remaining character
 * drawn from `ALLOWED_PATH_CHARS`.
 *
 * Bounded: a length ceiling, because this is called on attacker-supplied form
 * input on an unauthenticated route, and a megabyte-long `return_to` should cost
 * nothing. The regex is linear with no nested quantifier, so the ceiling bounds
 * total work rather than backtracking.
 */
export function isSameOriginPath(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 2048) return false;

  // Must be path-absolute.
  if (value[0] !== "/") return false;

  // `//host` and `/\host` are read by browsers as absolute cross-origin.
  if (value[1] === "/" || value[1] === "\\") return false;

  return ALLOWED_PATH_CHARS.test(value);
}

/**
 * `value` when it is a safe same-origin path, else `fallback`.
 *
 * Falls back rather than throwing on purpose: every current caller has ALREADY
 * completed the action the redirect merely returns from, so refusing the whole
 * request because the return path looked odd would turn a successful operation
 * into a visible error.
 */
export function sameOriginPathOr(value: unknown, fallback: string): string {
  return isSameOriginPath(value) ? value : fallback;
}
