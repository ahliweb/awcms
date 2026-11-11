/**
 * Retention of publication evidence (Issue #1145, an admission condition of
 * ADR-0157 before the first connector). Shared by the module descriptor
 * (`../module.ts`), the purge (`../application/social-publishing-retention-purge.ts`)
 * and the database floor (`sql/357`).
 *
 * ## The decision, and who may change it
 *
 * A publication is evidence of what was said publicly under the tenant's name,
 * to which account, approved by whom, and what the provider answered. The window
 * is therefore long and conservative: **730 days by default, bounded
 * 365..3650**. This is a proposed default for the OWNER to confirm or change
 * (recorded in `docs/awcms/social-publishing.md`); changing the default is a code
 * change here, and lowering the 365-day minimum also needs a migration, because
 * `sql/357` refuses the worker a DELETE of anything younger, whatever the code
 * asks for.
 */

export const SOCIAL_PUBLICATIONS_LIFECYCLE_KEY =
  "social_publishing.publications";
export const SOCIAL_PUBLISH_JOBS_LIFECYCLE_KEY = "social_publishing.jobs";
export const SOCIAL_PUBLISH_ATTEMPTS_LIFECYCLE_KEY =
  "social_publishing.attempts";

/** Every key whose legal hold stops the purge: the three tables are ONE unit of evidence. */
export const SOCIAL_PUBLISHING_LIFECYCLE_KEYS: readonly string[] = [
  SOCIAL_PUBLICATIONS_LIFECYCLE_KEY,
  SOCIAL_PUBLISH_JOBS_LIFECYCLE_KEY,
  SOCIAL_PUBLISH_ATTEMPTS_LIFECYCLE_KEY
];

export const SOCIAL_PUBLISHING_RETENTION_MIN_DAYS = 365;
export const SOCIAL_PUBLISHING_RETENTION_MAX_DAYS = 3650;
export const SOCIAL_PUBLISHING_DEFAULT_RETENTION_DAYS = 730;

/** Publications per pass. Each brings at most its jobs (20 per manual publication, or one per rule) and their attempts. */
export const SOCIAL_PUBLISHING_PURGE_BATCH_LIMIT = 200;

/** Job statuses after which nothing happens to a job on its own (`needs_reconciliation` waits for a person, so it is NOT one). */
export const SOCIAL_PUBLISH_JOB_RETAINABLE_STATUSES = [
  "published",
  "failed",
  "cancelled"
] as const;

/** Publication states the purge may remove (`pending_approval` is waiting for a person). */
export const SOCIAL_PUBLICATION_RETAINABLE_STATES = [
  "ready",
  "cancelled",
  "refused"
] as const;

/** The window actually applied: clamped into the bounds, never below the database floor. */
export function clampSocialPublishingRetentionDays(days: number): number {
  if (!Number.isFinite(days)) return SOCIAL_PUBLISHING_DEFAULT_RETENTION_DAYS;

  return Math.min(
    SOCIAL_PUBLISHING_RETENTION_MAX_DAYS,
    Math.max(SOCIAL_PUBLISHING_RETENTION_MIN_DAYS, Math.floor(days))
  );
}
