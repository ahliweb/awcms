import type { BlogContentStatus } from "./post-status";

/**
 * Page lifecycle rules (ADR-0057) — deliberately SEPARATE from
 * `post-status.ts`'s `ALLOWED_STATUS_TRANSITIONS`, not a re-export of it.
 *
 * Pages and posts share a status column (`sql/035` created
 * `awcms_blog_pages.status` identically to the post one, CHECK included) but
 * they do NOT share a lifecycle. `sql/036` seeds eight `pages.*` permissions
 * and there is no `pages.schedule` among them, while posts have one — so the
 * narrower page lifecycle is a decision the catalogue already made, not an
 * omission to patch here.
 *
 * ADR-0057 §B records the substance: a page is structural site content (about,
 * contact, privacy policy). Editorial review queues and timed publishing are
 * newsroom needs, and `blog_content` already has both where they belong, on
 * posts. Copying them onto pages would mean two more permissions to seed, gate
 * and screen for a workflow nobody has asked for.
 *
 * Sharing one table between the two callers would leave it correct for one and
 * too permissive for the other, which is the failure this file exists to avoid:
 * without it, `isValidStatusTransition` would happily let a page reach
 * `scheduled` — a status no page permission can ever be granted for, and one
 * `blog-scheduled-publish.ts` (posts only) would never move on again.
 */

/** The three states a page can be in. A strict subset of `BlogContentStatus`. */
export type BlogPageStatus = Extract<
  BlogContentStatus,
  "draft" | "published" | "archived"
>;

export const BLOG_PAGE_STATUSES: readonly BlogPageStatus[] = [
  "draft",
  "published",
  "archived"
];

export function isBlogPageStatus(value: unknown): value is BlogPageStatus {
  return (
    typeof value === "string" &&
    (BLOG_PAGE_STATUSES as string[]).includes(value)
  );
}

/**
 * ```
 * draft ──────► published ──────► archived
 *   ▲               │                 │
 *   └───────────────┴─────────────────┘
 * ```
 *
 * Every edge is reversible back to `draft`, which is what makes `archived` a
 * recoverable state rather than a one-way door — the same shape posts have,
 * minus the two statuses pages cannot reach.
 */
const ALLOWED_PAGE_STATUS_TRANSITIONS: Record<
  BlogPageStatus,
  readonly BlogPageStatus[]
> = {
  draft: ["published", "archived"],
  published: ["archived", "draft"],
  archived: ["draft"]
};

/**
 * A page row read from the database carries `BlogContentStatus`, because the
 * column's CHECK still accepts all five. A row already sitting in `review` or
 * `scheduled` therefore cannot be reached by any code path in this repo — but
 * it is not impossible in a database someone has edited by hand, and answering
 * "no valid transition" is the fail-closed reading.
 */
export function isValidPageStatusTransition(
  from: BlogContentStatus,
  to: BlogPageStatus
): boolean {
  if (!isBlogPageStatus(from)) {
    return false;
  }

  if (from === to) {
    return true;
  }

  return ALLOWED_PAGE_STATUS_TRANSITIONS[from].includes(to);
}

/** Restore only makes sense for a currently soft-deleted page — same precondition `canRestorePost` states for posts. */
export function canRestorePage(deletedAt: Date | null): boolean {
  return deletedAt !== null;
}

/**
 * ADR-0057 §C reuses the post precondition verbatim: purge is forbidden for
 * live content unless it has been archived or soft-deleted first. Kept as its
 * own function rather than importing `canPurgePost` so the page lifecycle owns
 * its own rules end to end — the two agreeing today is a fact about the
 * decision, not a dependency between them.
 */
export function canPurgePage(
  status: BlogContentStatus,
  deletedAt: Date | null
): boolean {
  return deletedAt !== null || status === "archived";
}
