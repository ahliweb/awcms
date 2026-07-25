/**
 * The versioned catalog of event types this runtime is aware of ("runtime
 * registry and AsyncAPI event types/versions pass bidirectional parity
 * checks"). `appendDomainEvent` (`application/append-domain-event.ts`)
 * REFUSES to persist an event whose `(eventType, eventVersion)` is not
 * listed here — this is the mechanism (not just documentation) that stops
 * "event types/versions silently drifting" from the published AsyncAPI
 * contract: a new/changed event type must be added HERE first (reviewed
 * source code), which `tests/domain-event-registry-parity.test.ts` then
 * cross-checks against `asyncapi/awcms-domain-events.asyncapi.yaml` in both
 * directions (registry entry without a channel = fail; a channel this
 * runtime's own consumer registry subscribes to without a matching entry
 * here = fail).
 *
 * Scope note: this module ships exactly one registered event type — a
 * self-contained reference/example (`sample.recorded`) used to exercise and
 * prove the outbox/dispatcher/ordering/retry/DLQ/replay mechanism
 * end-to-end. Future producer modules add their OWN entries here (and their
 * own `module.ts` `events.publishes` entries, and their own AsyncAPI
 * channels) when they start calling `appendDomainEvent`.
 */
export type RegisteredDomainEventType = {
  eventType: string;
  eventVersion: string;
  description: string;
};

export const SAMPLE_RECORDED_EVENT_TYPE =
  "awcms.domain-event-runtime.sample.recorded";
export const SAMPLE_RECORDED_EVENT_VERSION = "1.0";

/**
 * `workflow_approval`'s real producer registration (ported from
 * awcms-mini). A small, real event set (instance lifecycle + task
 * escalation + delegation lifecycle), not an exhaustive taxonomy:
 * `workflow-approval/application/workflow-instance.ts`,
 * `workflow-instance-decision.ts`, `workflow-recovery.ts`,
 * `workflow-escalation.ts`, and `workflow-delegation-directory.ts` call
 * `appendDomainEvent` with these inside the SAME transaction as the state
 * change they describe. All share one contract version string
 * (`WORKFLOW_EVENT_VERSION`) since they were introduced together; bump
 * per-event if any one payload shape changes independently later.
 */
export const WORKFLOW_EVENT_VERSION = "1.0";
export const WORKFLOW_INSTANCE_STARTED_EVENT_TYPE =
  "awcms.workflow.instance.started";
export const WORKFLOW_INSTANCE_ADVANCED_EVENT_TYPE =
  "awcms.workflow.instance.advanced";
export const WORKFLOW_INSTANCE_APPROVED_EVENT_TYPE =
  "awcms.workflow.instance.approved";
export const WORKFLOW_INSTANCE_REJECTED_EVENT_TYPE =
  "awcms.workflow.instance.rejected";
export const WORKFLOW_INSTANCE_CANCELLED_EVENT_TYPE =
  "awcms.workflow.instance.cancelled";
export const WORKFLOW_TASK_ESCALATED_EVENT_TYPE =
  "awcms.workflow.task.escalated";
export const WORKFLOW_DELEGATION_CREATED_EVENT_TYPE =
  "awcms.workflow.delegation.created";
export const WORKFLOW_DELEGATION_REVOKED_EVENT_TYPE =
  "awcms.workflow.delegation.revoked";

/**
 * `comments` (ADR-0041). Declared here — not imported from
 * `comments/domain/comment-events.ts` — deliberately: this foundation module
 * must not depend on a domain module. The literals are kept identical on both
 * sides by the AsyncAPI parity gate, which reads the registry and the spec.
 */
export const COMMENTS_EVENT_VERSION = "1.0";
export const COMMENT_SUBMITTED_EVENT_TYPE = "awcms.comments.comment.submitted";
export const COMMENT_APPROVED_EVENT_TYPE = "awcms.comments.comment.approved";
export const COMMENT_REPLY_CREATED_EVENT_TYPE = "awcms.comments.reply.created";

export const DOMAIN_EVENT_TYPE_REGISTRY: readonly RegisteredDomainEventType[] =
  [
    {
      eventType: SAMPLE_RECORDED_EVENT_TYPE,
      eventVersion: SAMPLE_RECORDED_EVENT_VERSION,
      description:
        "Reference/example event type used to exercise the domain-event-runtime outbox, dispatcher, ordering, retry/backoff, dead-letter, and replay mechanism end-to-end. Real producer modules publish their OWN event types the same way, via appendDomainEvent — this one is intentionally self-contained rather than tied to another module's business logic in this foundation module."
    },
    {
      eventType: WORKFLOW_INSTANCE_STARTED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      description:
        "A workflow instance was started, pinned to the currently-active workflow definition version."
    },
    {
      eventType: WORKFLOW_INSTANCE_ADVANCED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      description:
        "A workflow instance's active task was decided and the instance advanced to its next node(s), without yet reaching a terminal outcome."
    },
    {
      eventType: WORKFLOW_INSTANCE_APPROVED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      description:
        "A workflow instance reached an `end` node with outcome `approved`."
    },
    {
      eventType: WORKFLOW_INSTANCE_REJECTED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      description:
        "A workflow instance reached an `end` node with outcome `rejected`, or was force-rejected."
    },
    {
      eventType: WORKFLOW_INSTANCE_CANCELLED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      description:
        "An administrator cancelled a running workflow instance (`application/workflow-recovery.ts`)."
    },
    {
      eventType: WORKFLOW_TASK_ESCALATED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      description:
        "A pending workflow task passed its due date and was escalated by the scheduled escalation/timeout job."
    },
    {
      eventType: WORKFLOW_DELEGATION_CREATED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      description: "A workflow delegation/substitute assignment was created."
    },
    {
      eventType: WORKFLOW_DELEGATION_REVOKED_EVENT_TYPE,
      eventVersion: WORKFLOW_EVENT_VERSION,
      description: "A workflow delegation/substitute assignment was revoked."
    },
    {
      eventType: COMMENT_SUBMITTED_EVENT_TYPE,
      eventVersion: COMMENTS_EVENT_VERSION,
      description:
        "A comment was submitted against a published, public commentable resource. Carries opaque references only (comment/thread id, resource type + server-derived public URL, resulting status) — never an author address, body text, or any identity hash."
    },
    {
      eventType: COMMENT_APPROVED_EVENT_TYPE,
      eventVersion: COMMENTS_EVENT_VERSION,
      description:
        "A comment became publicly visible, either by auto-approval under the thread policy or by a moderator's approve action. The reply-notification consumer keys off this event, not the submitted one, so a pending comment never triggers a notification."
    },
    {
      eventType: COMMENT_REPLY_CREATED_EVENT_TYPE,
      eventVersion: COMMENTS_EVENT_VERSION,
      description:
        "A submitted comment was a reply to an existing comment. Published alongside comment.submitted so a consumer can distinguish thread replies without re-reading the row; the recipient address is resolved from encrypted storage by the dispatcher at send time, never carried here."
    }
  ];

export function isRegisteredDomainEventType(
  eventType: string,
  eventVersion: string
): boolean {
  return DOMAIN_EVENT_TYPE_REGISTRY.some(
    (entry) =>
      entry.eventType === eventType && entry.eventVersion === eventVersion
  );
}
