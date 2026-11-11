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
 *   an odd link.
 */
import { isSafeLinkUrl } from "./social-publish-content";

/** The database's floor (`sql/359`): every supported provider's ids fit it. */
export const EXTERNAL_POST_ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Whether a pattern is anchored at both ends, so it cannot match a substring of a longer string. */
export function isAnchoredPattern(pattern: RegExp): boolean {
  return (
    pattern.source.startsWith("^") &&
    pattern.source.endsWith("$") &&
    !pattern.source.endsWith("\\$") &&
    !pattern.flags.includes("m")
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

  // A fresh RegExp: a `g` or `y` flag would make `test` stateful.
  const own = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));

  return own.test(raw) ? raw : null;
}

/** The post URL to store, or `null` (dropped) when it is unsafe or on a host the adapter did not declare. */
export function acceptExternalPostUrl(
  hosts: readonly string[],
  raw: unknown
): string | null {
  if (typeof raw !== "string" || !isSafeLinkUrl(raw)) return null;

  let host: string;

  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }

  return hosts.some((allowed) => allowed.toLowerCase() === host) ? raw : null;
}
