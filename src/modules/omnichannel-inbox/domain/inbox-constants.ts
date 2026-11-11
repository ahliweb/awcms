/**
 * Closed vocabularies and fixed names for `omnichannel_inbox` (Issue #1164,
 * ADR-0160 `Proposed`).
 */
export const OMNICHANNEL_INBOX_MODULE_KEY = "omnichannel_inbox";

export const CONVERSATIONS_ACTIVITY_CODE = "conversations";
export const TAGS_ACTIVITY_CODE = "tags";
export const SLA_POLICIES_ACTIVITY_CODE = "sla_policies";
export const PROJECTION_ACTIVITY_CODE = "projection";

export const OMNICHANNEL_INBOX_GUARDS = {
  readConversations: {
    moduleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    activityCode: CONVERSATIONS_ACTIVITY_CODE,
    action: "read" as const
  },
  updateConversations: {
    moduleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    activityCode: CONVERSATIONS_ACTIVITY_CODE,
    action: "update" as const
  },
  assignConversations: {
    moduleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    activityCode: CONVERSATIONS_ACTIVITY_CODE,
    action: "assign" as const
  },
  configureTags: {
    moduleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    activityCode: TAGS_ACTIVITY_CODE,
    action: "configure" as const
  },
  readSlaPolicies: {
    moduleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    activityCode: SLA_POLICIES_ACTIVITY_CODE,
    action: "read" as const
  },
  configureSlaPolicies: {
    moduleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    activityCode: SLA_POLICIES_ACTIVITY_CODE,
    action: "configure" as const
  },
  configureProjection: {
    moduleKey: OMNICHANNEL_INBOX_MODULE_KEY,
    activityCode: PROJECTION_ACTIVITY_CODE,
    action: "configure" as const
  }
} as const;

/**
 * The permission key that makes a person ELIGIBLE to be an assignee (ADR-0160
 * section 3): somebody who can work the conversation.
 */
export const ASSIGNEE_PERMISSION_KEY = `${OMNICHANNEL_INBOX_MODULE_KEY}.${CONVERSATIONS_ACTIVITY_CODE}.update`;

/** The four envelopes the projector reads. Strings, not imports: the inbox depends on the CONTRACT (AsyncAPI), never on the producing module's code. */
export const TELEGRAM_INTERACTION_RECEIVED_EVENT_TYPE =
  "awcms.telegram_engagement.interaction.received";
export const TELEGRAM_CONSENT_CHANGED_EVENT_TYPE =
  "awcms.telegram_engagement.consent.changed";
export const WEBSITE_SUBMISSION_RECEIVED_EVENT_TYPE =
  "awcms.website_engagement.submission.received";
export const WEBSITE_SUBMISSION_WITHDRAWN_EVENT_TYPE =
  "awcms.website_engagement.submission.withdrawn";

export const PROJECTED_EVENT_TYPES = [
  TELEGRAM_INTERACTION_RECEIVED_EVENT_TYPE,
  TELEGRAM_CONSENT_CHANGED_EVENT_TYPE,
  WEBSITE_SUBMISSION_RECEIVED_EVENT_TYPE,
  WEBSITE_SUBMISSION_WITHDRAWN_EVENT_TYPE
] as const;

export const PROJECTED_EVENT_VERSIONS = ["1.0"] as const;

/** The events that change a customer's state (applied in event-sequence order). */
export const CUSTOMER_STATE_EVENT_TYPES = [
  TELEGRAM_CONSENT_CHANGED_EVENT_TYPE,
  WEBSITE_SUBMISSION_WITHDRAWN_EVENT_TYPE
] as const;

/** The producers' aggregate types (a contact, a submission): what a conversation's opaque reference is the id of. */
export const TELEGRAM_CONTACT_AGGREGATE_TYPE = "telegram_engagement_contact";
export const WEBSITE_SUBMISSION_AGGREGATE_TYPE =
  "website_engagement_submission";

export const PROJECTOR_CONSUMER_NAME =
  "omnichannel_inbox.conversation_projector";

export const SOURCE_KINDS = ["telegram", "website"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const CONVERSATION_STATUSES = [
  "open",
  "pending",
  "resolved",
  "closed"
] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** A status that settles everything received so far (nothing is owed after it). */
export const SETTLING_STATUSES: readonly ConversationStatus[] = [
  "resolved",
  "closed"
];

export const CUSTOMER_STATES = ["active", "opted_out", "withdrawn"] as const;
export type CustomerState = (typeof CUSTOMER_STATES)[number];

export const ACTIVITY_KINDS = [
  "assigned",
  "unassigned",
  "assignee_revoked",
  "status_changed",
  "response_recorded",
  "tag_added",
  "tag_removed",
  "sla_breached"
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export type DueKind = "first" | "next";

export const SLA_STATES = ["none", "on_track", "breached"] as const;
export type SlaState = (typeof SLA_STATES)[number];

export const MAX_TAGS_PER_CONVERSATION = 20;
export const MAX_LIST_LIMIT = 100;
export const DEFAULT_LIST_LIMIT = 25;
export const MAX_ACTIVITY_ON_DETAIL = 50;

/** One rebuild call replays at most this many events; the caller continues from `nextAfterSequence`. */
export const REBUILD_BATCH_LIMIT = 2000;
/**
 * The rebuild window, in days. Capped at the DEFAULT conversation retention, so
 * a rebuild cannot resurrect a conversation the default purge removed; a tenant
 * that shortened its retention passes a smaller window (documented in the
 * module README as a known limitation).
 */
export const DEFAULT_REBUILD_WINDOW_DAYS = 365;
export const MAX_REBUILD_WINDOW_DAYS = 365;

/** E-mail template key of the SLA breach notice (a tenant without it gets no mail: the port is a silent no-op). */
export const SLA_BREACH_TEMPLATE_KEY = "omnichannel_inbox.sla_breached";
/** Per tenant per SLA run, at most this many conversations are visited per step; the next run continues. */
export const SLA_SWEEP_BATCH = 500;
