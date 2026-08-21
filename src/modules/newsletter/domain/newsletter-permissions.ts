/**
 * Permission key constants for `newsletter` (Issue #598, ADR-0103, `sql/139`).
 *
 * Two keys, both admin-only. The three PUBLIC endpoints — subscribe, confirm,
 * unsubscribe — are anonymous by design and check no permission at all: a reader
 * has no account, and PRD §30 forbids making them get one to stop receiving
 * mail. What bounds those endpoints is a per-IP rate limit and a neutral
 * response, not authorization.
 *
 * `read` and `configure` are separately grantable on `sql/058`'s reasoning:
 * seeing who subscribed is a different power from suppressing them.
 */
export const NEWSLETTER_MODULE_KEY = "newsletter";
export const NEWSLETTER_ACTIVITY_CODE = "subscribers";

export const NEWSLETTER_PERMISSIONS = {
  /** Read the subscriber list and its status counts. */
  read: "newsletter.subscribers.read",
  /** Suppress a subscriber, or remove one at their request. */
  configure: "newsletter.subscribers.configure"
} as const;
