/**
 * Translated labels for `BlogContentStatus`/`BlogContentVisibility` (Issue
 * #861, item 4 of #854).
 *
 * `BlogContentStatus` is rendered on TWO admin screens —
 * `src/pages/admin/blog.astro` (posts) and `src/pages/admin/blog-pages.astro`
 * (pages, via the `BlogPageStatus` subset) — so its label map lives here once
 * rather than being duplicated per screen, per the design decision recorded on
 * #861: the SAME enum on 2+ screens gets ONE shared helper.
 *
 * Both `Record`s are keyed by the full domain union, so a new
 * `BlogContentStatus`/`BlogContentVisibility` member fails typecheck here
 * until it is given a label — the exhaustiveness the issue asks for.
 */
import type { Translator } from "../catalog";
import {
  isBlogContentStatus,
  type BlogContentStatus,
  type BlogContentVisibility
} from "../../../modules/blog-content/domain/post-status";

/**
 * Accepts a plain `string` (not just `BlogContentStatus`) because
 * `blog_revisions.status` — a point-in-time snapshot of the post's status —
 * is stored and typed as `string`, not the narrowed union. An unrecognised
 * value (there should never be one) falls back to the raw text rather than
 * throwing or rendering blank.
 */
export function blogContentStatusLabel(
  t: Translator["t"],
  status: BlogContentStatus | string
): string {
  if (!isBlogContentStatus(status)) return status;

  const LABELS: Record<BlogContentStatus, string> = {
    draft: t("Draft"),
    review: t("In review"),
    scheduled: t("Scheduled"),
    published: t("Published"),
    archived: t("Archived")
  };

  return LABELS[status];
}

export function blogContentVisibilityLabel(
  t: Translator["t"],
  visibility: BlogContentVisibility
): string {
  const LABELS: Record<BlogContentVisibility, string> = {
    public: t("Public"),
    private: t("Private"),
    unlisted: t("Unlisted")
  };

  return LABELS[visibility] ?? visibility;
}
