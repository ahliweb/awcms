/**
 * Revision rules (Issue #541, doc issue #541 §Revision Rules).
 * `awcms_blog_revisions` (migration 026) is append-only — restoring a
 * revision means inserting a *new* revision row with the old content and
 * writing that content back onto the live post, never `UPDATE`/`DELETE`ing
 * an existing revision row (module README §Skema data, point 5).
 */

import type { PortableTextDocument } from "./portable-text";

/** The subset of an update input relevant to "was this a significant change". */
export type ContentChangeInput = {
  title?: string;
  contentJson?: Record<string, unknown>;
  contentText?: string;
  /**
   * ADR-0100 made Portable Text the canonical body, and it is an accepted
   * field on both `PATCH /api/v1/blog/posts/{id}` and `.../pages/{id}`. The
   * admin editor and the preview overlay send ONLY this field on an ordinary
   * body correction, so a policy that cannot see it records no revision for
   * the most common editorial action there is.
   */
  bodyPortableText?: PortableTextDocument;
};

/**
 * A change is significant when it touches the content itself — title,
 * contentJson, contentText, or bodyPortableText (the canonical body). Cosmetic-only fields (seoTitle,
 * canonicalUrl, featuredMediaId, visibility, locale, menuOrder, slug, ...)
 * do not trigger a new revision; `awcms_blog_revisions` has no `slug`
 * column (migration 026), so a slug-only change has nothing to snapshot
 * beyond what the previous revision already recorded.
 */
export function isSignificantContentChange(input: ContentChangeInput): boolean {
  return (
    input.title !== undefined ||
    input.contentJson !== undefined ||
    input.contentText !== undefined ||
    input.bodyPortableText !== undefined
  );
}
