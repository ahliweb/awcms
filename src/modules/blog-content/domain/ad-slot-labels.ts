/**
 * The one string an unsold advertisement slot shows (Issue #594, FR-ADS-007).
 *
 * ## Why it is a constant here rather than `t("…")` at the call site
 *
 * The public `/blog/{tenantCode}` route family has never used the gettext
 * catalogue: every reader-facing string in it — "No posts yet.", "Back to blog",
 * "Previous"/"Next" — is an English literal passed in by the route. Introducing
 * `getTranslatorFor` to one string on four routes would leave those pages
 * half-translated, which is worse than consistently untranslated: a reader would
 * see one Indonesian sentence in an otherwise English shell and conclude
 * something is broken.
 *
 * Translating the public surface is a real piece of work with its own decisions
 * (which locale wins when the path prefix and the tenant default disagree, what
 * the cache key does about it) and it belongs in its own change. Until then this
 * lives beside the other public literals, in one place, so that change has one
 * line to find rather than four.
 *
 * The sentence itself is the PRD's ("Ruang Iklan Tersedia") in the language the
 * rest of this surface already speaks.
 */
export const AD_SLOT_AVAILABLE_LABEL = "Ad space available — contact us.";
