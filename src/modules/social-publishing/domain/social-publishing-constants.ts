/**
 * `social_publishing` constants (Issue #1145, ADR-0157). No imports, so the
 * module descriptor, the domain-event registry and the contract tests reference
 * the same literals.
 */
export const SOCIAL_PUBLISHING_MODULE_KEY = "social_publishing";

/**
 * The deployment switch. Off unless the value is exactly `"true"`: with it
 * unset, the composition roots keep `blog_content`'s no-op adapter, every route
 * answers `503 SOCIAL_PUBLISHING_DISABLED` after authorization, and the
 * dispatcher claims nothing. Read on every call (never cached) so a test or an
 * operator toggling it takes effect at once.
 */
export function isSocialPublishingEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.SOCIAL_PUBLISHING_ENABLED === "true";
}

/** The three events `blog_content` can raise, as `SocialPublishingTriggerEvent` names them. */
export const SOCIAL_PUBLISH_TRIGGERS = [
  "post_published",
  "scheduled_published",
  "manual_editor_action"
] as const;

export type SocialPublishTrigger = (typeof SOCIAL_PUBLISH_TRIGGERS)[number];

export function isSocialPublishTrigger(
  value: unknown
): value is SocialPublishTrigger {
  return (
    typeof value === "string" &&
    (SOCIAL_PUBLISH_TRIGGERS as readonly string[]).includes(value)
  );
}

export const PUBLICATION_SOURCE_KINDS = ["article", "manual"] as const;
export type PublicationSourceKind = (typeof PUBLICATION_SOURCE_KINDS)[number];

/** Approval and cancellation lifecycle of a publication. The publish status is derived from its jobs. */
export const PUBLICATION_STATES = [
  "pending_approval",
  "ready",
  "cancelled",
  "refused"
] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];

export const JOB_STATUSES = [
  "queued",
  "publishing",
  "retry_wait",
  "published",
  "failed",
  "cancelled",
  /**
   * The request may have reached the provider and published (a timeout, or an
   * adapter that threw, after the request was sent). The dispatcher NEVER retries
   * it; an operator reconciles and retries with an explicit confirmation.
   */
  "needs_reconciliation"
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** The closed vocabulary of content shapes a job can have. This slice produces `text` and `image`. */
export const PUBLISH_VARIANTS = [
  "text",
  "image",
  "video",
  "short",
  "story"
] as const;
export type PublishVariant = (typeof PUBLISH_VARIANTS)[number];

/** Derived from a publication's jobs; never stored. */
export const AGGREGATE_STATUSES = [
  "refused",
  "needs_reconciliation",
  "pending_approval",
  "queued",
  "in_progress",
  "partially_published",
  "published",
  "failed",
  "cancelled"
] as const;
export type AggregateStatus = (typeof AGGREGATE_STATUSES)[number];

export const MAX_TARGET_ACCOUNTS = 20;
export const MAX_TITLE_LENGTH = 300;
export const MAX_CAPTION_LENGTH = 2000;
export const MAX_LINK_LENGTH = 2048;

/** Media a social post may carry, whatever a provider's own map says: the intersection with the provider's map applies at enqueue. */
export const SOCIAL_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp"
] as const;
export const SOCIAL_MEDIA_MAX_BYTES = 10 * 1024 * 1024;

export const DEFAULT_JOB_MAX_ATTEMPTS = 5;
/** A job held for a recoverable account problem stops waiting after this many holds. */
export const MAX_HOLDS = 12;
export const HOLD_DELAY_MINUTES = 15;
export const DISPATCH_LEASE_MINUTES = 5;
export const DISPATCH_DEFAULT_LIMIT = 10;
export const DISPATCH_PER_ACCOUNT_BATCH = 3;
export const DEFAULT_ACCOUNT_DAILY_CAP = 25;
export const PROVIDER_CALL_TIMEOUT_MS = 20_000;

export function socialPublishBreakerKey(accountId: string): string {
  return `social_publishing:account:${accountId}`;
}

export const SOCIAL_PUBLISHING_EVENT_VERSION = "1.0";
export const SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE =
  "awcms.social_publishing.publication.queued";
export const SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE =
  "awcms.social_publishing.publication.cancelled";
export const SOCIAL_JOB_PUBLISHED_EVENT_TYPE =
  "awcms.social_publishing.job.published";
export const SOCIAL_JOB_FAILED_EVENT_TYPE =
  "awcms.social_publishing.job.failed";
export const SOCIAL_PUBLICATION_AGGREGATE_TYPE = "social_publication";
export const SOCIAL_JOB_AGGREGATE_TYPE = "social_publish_job";

export const PUBLICATIONS_ACTIVITY_CODE = "publications";
export const JOBS_ACTIVITY_CODE = "jobs";
export const RULES_ACTIVITY_CODE = "rules";
export const SETTINGS_ACTIVITY_CODE = "settings";

export const SOCIAL_PUBLISHING_GUARDS = {
  publicationsRead: {
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    activityCode: PUBLICATIONS_ACTIVITY_CODE,
    action: "read"
  },
  publicationsPublish: {
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    activityCode: PUBLICATIONS_ACTIVITY_CODE,
    action: "publish"
  },
  publicationsSchedule: {
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    activityCode: PUBLICATIONS_ACTIVITY_CODE,
    action: "schedule"
  },
  publicationsApprove: {
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    activityCode: PUBLICATIONS_ACTIVITY_CODE,
    action: "approve"
  },
  publicationsCancel: {
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    activityCode: PUBLICATIONS_ACTIVITY_CODE,
    action: "cancel"
  },
  jobsRetry: {
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    activityCode: JOBS_ACTIVITY_CODE,
    action: "retry"
  },
  rulesRead: {
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    activityCode: RULES_ACTIVITY_CODE,
    action: "read"
  },
  rulesConfigure: {
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    activityCode: RULES_ACTIVITY_CODE,
    action: "configure"
  },
  settingsConfigure: {
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    activityCode: SETTINGS_ACTIVITY_CODE,
    action: "configure"
  }
} as const;
