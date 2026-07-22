export type BlogContentStatus =
  "draft" | "review" | "scheduled" | "published" | "archived";

export const BLOG_CONTENT_STATUSES: readonly BlogContentStatus[] = [
  "draft",
  "review",
  "scheduled",
  "published",
  "archived"
];

export type BlogContentVisibility = "public" | "private" | "unlisted";

export const BLOG_CONTENT_VISIBILITIES: readonly BlogContentVisibility[] = [
  "public",
  "private",
  "unlisted"
];

export function isBlogContentStatus(
  value: unknown
): value is BlogContentStatus {
  return (
    typeof value === "string" &&
    (BLOG_CONTENT_STATUSES as string[]).includes(value)
  );
}

export function isBlogContentVisibility(
  value: unknown
): value is BlogContentVisibility {
  return (
    typeof value === "string" &&
    (BLOG_CONTENT_VISIBILITIES as string[]).includes(value)
  );
}

/**
 * Allowed forward/back transitions between lifecycle states. Applied by the
 * lifecycle-action endpoints landing in Issue #538 (publish/schedule/archive)
 * and Issue #541 (scheduled publishing) — kept here as the single source of
 * truth so both issues reuse the same rule instead of re-deriving it.
 */
const ALLOWED_STATUS_TRANSITIONS: Record<
  BlogContentStatus,
  readonly BlogContentStatus[]
> = {
  draft: ["review", "scheduled", "published", "archived"],
  review: ["draft", "scheduled", "published", "archived"],
  scheduled: ["draft", "published", "archived"],
  published: ["archived", "draft"],
  archived: ["draft"]
};

export function isValidStatusTransition(
  from: BlogContentStatus,
  to: BlogContentStatus
): boolean {
  if (from === to) {
    return true;
  }

  return ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

/** Restore only makes sense for a currently soft-deleted post (Issue #538, same precondition `POST /api/v1/profiles/{id}/restore` already enforces). */
export function canRestorePost(deletedAt: Date | null): boolean {
  return deletedAt !== null;
}

/**
 * Issue #538 §ABAC Rules: "Purge is forbidden for published content unless
 * archived or soft-deleted first." A post already soft-deleted, or one whose
 * lifecycle status is `archived`, may be purged; anything else (including
 * `published`) may not.
 */
export function canPurgePost(
  status: BlogContentStatus,
  deletedAt: Date | null
): boolean {
  return deletedAt !== null || status === "archived";
}
