/**
 * `comments` domain-event type/version constants (ADR-0041, ported from
 * awcms-micro Issue #271). Kept in `domain/` with no imports so the application
 * producers, the `domain_event_runtime` registry, and the AsyncAPI parity check
 * all reference the same literals rather than three hand-typed strings.
 *
 * The matching entries live in
 * `domain-event-runtime/domain/event-type-registry.ts` and in
 * `asyncapi/awcms-domain-events.asyncapi.yaml`. They are kept in sync by
 * convention plus the contract gates — deliberately NOT by a cross-module
 * import, which would make every content module depend on the runtime.
 *
 * Recipient addresses are NEVER carried in these events. A reply-notification
 * event references an opaque subscription id, thread id, and hash only; the
 * email dispatcher resolves the real address from minimized storage at send
 * time (`subscriber-crypto.ts`).
 */
export const COMMENTS_EVENT_VERSION = "1.0";

export const COMMENT_SUBMITTED_EVENT_TYPE = "awcms.comments.comment.submitted";
export const COMMENT_APPROVED_EVENT_TYPE = "awcms.comments.comment.approved";
export const REPLY_CREATED_EVENT_TYPE = "awcms.comments.reply.created";

export const COMMENTS_AGGREGATE_TYPE = "comments.comment";
