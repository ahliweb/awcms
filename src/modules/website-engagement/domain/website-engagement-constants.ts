/**
 * Closed vocabularies and fixed names for `website_engagement` (Issue #1153,
 * ADR-0155). Every list here is closed ON PURPOSE: a public, unauthenticated
 * write surface that accepts an open vocabulary is a free-text storage
 * primitive, and each value below is also a CHECK constraint in `sql/325` and
 * `sql/326`, so the database refuses what the validator should already have.
 *
 * Pure module: no database, no I/O.
 */

export const WEBSITE_ENGAGEMENT_MODULE_KEY = "website_engagement";

export const SOURCES_ACTIVITY_CODE = "sources";
export const SUBMISSIONS_ACTIVITY_CODE = "submissions";

export const WEBSITE_ENGAGEMENT_GUARDS = {
  readSources: {
    moduleKey: WEBSITE_ENGAGEMENT_MODULE_KEY,
    activityCode: SOURCES_ACTIVITY_CODE,
    action: "read" as const
  },
  manageSources: {
    moduleKey: WEBSITE_ENGAGEMENT_MODULE_KEY,
    activityCode: SOURCES_ACTIVITY_CODE,
    action: "manage" as const
  },
  readSubmissions: {
    moduleKey: WEBSITE_ENGAGEMENT_MODULE_KEY,
    activityCode: SUBMISSIONS_ACTIVITY_CODE,
    action: "read" as const
  },
  revealSubmissions: {
    moduleKey: WEBSITE_ENGAGEMENT_MODULE_KEY,
    activityCode: SUBMISSIONS_ACTIVITY_CODE,
    action: "reveal" as const
  },
  withdrawSubmissions: {
    moduleKey: WEBSITE_ENGAGEMENT_MODULE_KEY,
    activityCode: SUBMISSIONS_ACTIVITY_CODE,
    action: "withdraw" as const
  }
} as const;

/**
 * The version of the PUBLIC submission contract (the request body a website
 * posts). A source records which version it was created for, so a v2 can add
 * fields without silently changing what a v1 site is allowed to send.
 */
export const SUBMISSION_CONTRACT_VERSION = "1";

/** `contact` and `lead` carry a person's own words; `interaction` carries none. */
export const SUBMISSION_KINDS = ["contact", "lead", "interaction"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

/** The only `interaction` types. Anything else is a validation error, never a stored string. */
export const INTERACTION_TYPES = [
  "form_view",
  "form_start",
  "cta_click",
  "call_click",
  "whatsapp_click",
  "map_click",
  "download_click"
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

/**
 * Responding to the inquiry and marketing follow-up are SEPARATE purposes with
 * separate boxes; the second is never implied by the first (ADR-0148 I8).
 */
export const CONSENT_PURPOSES = [
  "respond_to_inquiry",
  "marketing_follow_up"
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const SOURCE_STATUSES = ["active", "paused", "revoked"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/**
 * `turnstile` asks for the Turnstile challenge wherever the deployment runs it
 * (online profile with `TURNSTILE_ENABLED`); `none` is the explicit, visible
 * statement that this source relies on the non-third-party controls alone.
 */
export const CHALLENGE_MODES = ["turnstile", "none"] as const;
export type ChallengeMode = (typeof CHALLENGE_MODES)[number];

/** What actually protected one stored submission. Recorded so "none" is never mistaken for "verified". */
export const CHALLENGE_OUTCOMES = [
  "turnstile_verified",
  "not_required",
  "source_none"
] as const;
export type ChallengeOutcome = (typeof CHALLENGE_OUTCOMES)[number];

export const SUBMISSION_STATUSES = ["received", "withdrawn"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Why a controller withdrew a submission: a closed code, never free text. */
export const WITHDRAWAL_REASONS = [
  "data_subject_request",
  "consent_withdrawn",
  "controller_decision"
] as const;
export type WithdrawalReason = (typeof WITHDRAWAL_REASONS)[number];

/** Turnstile `action` the widget must have been rendered with for this endpoint. */
export const WEBSITE_ENGAGEMENT_TURNSTILE_ACTION = "website_engagement";

/** A source's token: `wes1.<tenantId>.<sourceId>.<secret>`. The prefix versions the format. */
export const SOURCE_TOKEN_VERSION = "wes1";

export const SOURCE_TOKEN_HASH_PURPOSE = "website_engagement.source_token";
export const SUBMISSION_CONTACT_AAD_PURPOSE = "website_engagement.contact:v1";
export const SUBMISSION_EMAIL_HASH_PURPOSE = "website_engagement.email";
export const SUBMISSION_PHONE_HASH_PURPOSE = "website_engagement.phone";

/** Public body ceiling. A contact form is a few hundred bytes; this is not a storage primitive. */
export const SUBMISSION_BODY_LIMIT_BYTES = 16 * 1024;

export const MAX_SOURCE_DOMAINS = 20;

/** Event types (registered in `domain-event-runtime`, declared in AsyncAPI). */
export const WEBSITE_ENGAGEMENT_EVENT_VERSION = "1.0";
export const WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE =
  "awcms.website_engagement.submission.received";
export const WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE =
  "awcms.website_engagement.submission.withdrawn";
export const WEBSITE_ENGAGEMENT_SUBMISSION_AGGREGATE_TYPE =
  "website_engagement.submission";

/** Privacy classes carried on an event (ADR-0148 section 6). */
export type SubmissionPrivacyClass = "personal" | "anonymous";
