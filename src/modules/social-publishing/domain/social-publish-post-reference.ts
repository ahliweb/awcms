/**
 * What a provider says a published post IS (Issue #1145, residual L6 of the
 * ADR-0157 audit): the post id and the post URL an adapter returns with a
 * `published` outcome.
 *
 * Both are written to `awcms_social_publish_jobs` and then appear in responses,
 * events and audit rows. Before L6 they were stored as given (the id trimmed and
 * cut to 255 characters, the URL only https-checked), so any string an adapter
 * returned could carry a provider body or a credential into all three. Now:
 *
 * - the id must match the adapter's own declared, ANCHORED pattern
 *   (`SocialPublishAdapter.externalPostIdPattern`) AND the generic identifier
 *   alphabet the database enforces (`sql/359`). An id that fails either is not
 *   stored at all: the dispatcher records the outcome as UNKNOWN
 *   (`INVALID_POST_ID`), because "the provider said published but we cannot
 *   name the post" is exactly a post that may exist and cannot be reconciled;
 * - the URL must be a safe https URL whose host is one the adapter declares
 *   (`SocialPublishAdapter.postUrlHosts`, exact match). A URL that fails is
 *   DROPPED (stored as NULL): the id is the post's identity, the URL is a
 *   convenience, and a post that really exists must not be re-sent because of
 *   an odd link. A kept URL is reduced to its origin and path: the query and
 *   the fragment, where a token could ride, are never stored (L-2 of the #1261
 *   audit). A pattern with a top-level `|` is not anchored (L-1).
 */
import { isSafeLinkUrl } from "./social-publish-content";

/** The database's floor (`sql/359`): every supported provider's ids fit it. */
export const EXTERNAL_POST_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/**
 * Whether `source` has an alternation (`|`) at the TOP level, outside every
 * group and character class. `^a|b$` is "starts with a" OR "ends with b": its
 * `^` and `$` anchor only one alternative each (L-1 of the #1261 audit).
 */
export function hasTopLevelAlternation(source: string): boolean {
  let depth = 0;
  let inClass = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === "\\") {
      i += 1;
      continue;
    }

    if (inClass) {
      if (ch === "]") inClass = false;
      continue;
    }

    if (ch === "[") inClass = true;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (ch === "|" && depth === 0) return true;
  }

  return false;
}

/** Whether a pattern is anchored at both ends AS A WHOLE, so it cannot match a substring of a longer string. */
export function isAnchoredPattern(pattern: RegExp): boolean {
  return (
    pattern.source.startsWith("^") &&
    pattern.source.endsWith("$") &&
    !pattern.source.endsWith("\\$") &&
    !pattern.flags.includes("m") &&
    !hasTopLevelAlternation(pattern.source)
  );
}

/** The post id to store, or `null` when it must not be stored (the outcome is then unknown). */
export function acceptExternalPostId(
  pattern: RegExp,
  raw: unknown
): string | null {
  if (typeof raw !== "string") return null;
  if (!isAnchoredPattern(pattern)) return null;
  if (!EXTERNAL_POST_ID_SHAPE.test(raw)) return null;

  // A fresh RegExp, wrapped so the anchors apply to the whole pattern whatever
  // it contains, and without `g`/`y` (they would make `test` stateful).
  const own = new RegExp(
    `^(?:${pattern.source})$`,
    pattern.flags.replace(/[gym]/g, "")
  );

  return own.test(raw) ? raw : null;
}

/** The post URL to store, or `null` (dropped) when it is unsafe or on a host the adapter did not declare. */
export function acceptExternalPostUrl(
  hosts: readonly string[],
  raw: unknown
): string | null {
  if (typeof raw !== "string" || !isSafeLinkUrl(raw)) return null;

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();

  if (!hosts.some((allowed) => allowed.toLowerCase() === host)) return null;

  // L-2 of the #1261 audit: the query and the fragment are DROPPED. A provider
  // (or a buggy adapter) can put an `access_token=` or any other secret there,
  // and this URL reaches responses, events and audit rows. A post's address is
  // its origin and path.
  url.search = "";
  url.hash = "";

  return url.toString();
}
