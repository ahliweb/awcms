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

/**
 * `inventory` (ADR-0126). Declared here — not imported from
 * `inventory/domain/inventory-events.ts` — for the same reason as `comments`
 * above: this foundation module must not depend on a domain module. The
 * literals are kept identical by the AsyncAPI parity gate.
 */
export const INVENTORY_EVENT_VERSION = "1.0";
export const INVENTORY_MOVEMENT_POSTED_EVENT_TYPE =
  "awcms.inventory.movement.posted";
export const INVENTORY_STOCK_LOW_EVENT_TYPE = "awcms.inventory.stock.low";

/**
 * `tax` (ADR-0127). Declared here — not imported from `tax/domain/tax-events.ts` —
 * for the same reason as `comments` above: this foundation module must not depend
 * on a domain module. The AsyncAPI parity gate keeps the literals identical.
 */
export const TAX_EVENT_VERSION = "1.0";
export const TAX_RULE_VERSION_PUBLISHED_EVENT_TYPE =
  "awcms.tax.rule_version.published";
export const TAX_SNAPSHOT_FINALISED_EVENT_TYPE = "awcms.tax.snapshot.finalised";
export const TAX_SNAPSHOT_REVERSED_EVENT_TYPE = "awcms.tax.snapshot.reversed";

/**
 * `procurement` (ADR-0128). Declared here — not imported from
 * `procurement/domain/procurement-events.ts` — for the same reason as
 * `inventory` above. The literals are kept identical by the AsyncAPI parity gate.
 */
export const PROCUREMENT_EVENT_VERSION = "1.0";
export const PROCUREMENT_DOCUMENT_FINALISED_EVENT_TYPE =
  "awcms.procurement.document.finalised";
export const PROCUREMENT_DOCUMENT_REVERSED_EVENT_TYPE =
  "awcms.procurement.document.reversed";

/**
 * `whatsapp_delivery` (ADR-0133). Declared here — not imported from
 * `whatsapp-delivery/domain/whatsapp-events.ts` — for the same reason as
 * `inventory` above. The literals are kept identical by the AsyncAPI parity gate.
 */
export const WHATSAPP_EVENT_VERSION = "1.0";
export const WHATSAPP_MESSAGE_QUEUED_EVENT_TYPE =
  "awcms.whatsapp.message.queued";
export const WHATSAPP_MESSAGE_SENT_EVENT_TYPE = "awcms.whatsapp.message.sent";
export const WHATSAPP_MESSAGE_FAILED_EVENT_TYPE =
  "awcms.whatsapp.message.failed";
export const WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE =
  "awcms.whatsapp.message.expired";
export const WHATSAPP_CONSENT_GRANTED_EVENT_TYPE =
  "awcms.whatsapp.consent.granted";
export const WHATSAPP_CONSENT_WITHDRAWN_EVENT_TYPE =
  "awcms.whatsapp.consent.withdrawn";
export const WHATSAPP_DISPATCH_FAILED_EVENT_TYPE =
  "awcms.whatsapp.dispatch.failed";

/**
 * `hr_commission` (ADR-0132, Issue #1109). Declared here -- not imported from
 * `hr-commission/domain/hr-commission-events.ts` -- for the same reason as
 * `inventory` above. The literals are kept identical by the AsyncAPI parity gate.
 */
export const HR_COMMISSION_EVENT_VERSION = "1.0";
export const HR_COMMISSION_ACCRUAL_VOIDED_EVENT_TYPE =
  "awcms.hr.commission.voided";

/**
 * `booking` (ADR-0131, Issue #941). Declared here -- not imported from
 * `booking/domain/booking-reservation-events.ts` -- for the same reason as
 * `inventory` above. The literals are kept identical by the AsyncAPI parity
 * gate. The nine reservation events share one payload shape.
 */
export const BOOKING_EVENT_VERSION = "1.0";
export const BOOKING_RESERVATION_CREATED_EVENT_TYPE =
  "awcms.booking.reservation.created";
export const BOOKING_RESERVATION_HELD_EVENT_TYPE =
  "awcms.booking.reservation.held";
export const BOOKING_RESERVATION_CONFIRMED_EVENT_TYPE =
  "awcms.booking.reservation.confirmed";
export const BOOKING_RESERVATION_RESCHEDULED_EVENT_TYPE =
  "awcms.booking.reservation.rescheduled";
export const BOOKING_RESERVATION_CANCELLED_EVENT_TYPE =
  "awcms.booking.reservation.cancelled";
export const BOOKING_RESERVATION_CHECKED_IN_EVENT_TYPE =
  "awcms.booking.reservation.checked_in";
export const BOOKING_RESERVATION_COMPLETED_EVENT_TYPE =
  "awcms.booking.reservation.completed";
export const BOOKING_RESERVATION_NO_SHOW_EVENT_TYPE =
  "awcms.booking.reservation.no_show";
export const BOOKING_RESERVATION_EXPIRED_EVENT_TYPE =
  "awcms.booking.reservation.expired";

/**
 * `website_engagement` (ADR-0155, Issue #1153). Declared here -- not imported
 * from `website-engagement/domain/website-engagement-constants.ts` -- for the
 * same reason as `inventory` above. The literals are kept identical by the
 * AsyncAPI parity gate and by `tests/website-engagement-contract.test.ts`.
 */
export const WEBSITE_ENGAGEMENT_EVENT_VERSION = "1.0";
export const WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE =
  "awcms.website_engagement.submission.received";
export const WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE =
  "awcms.website_engagement.submission.withdrawn";

/**
 * `social_publishing` (ADR-0157, Issue #1145). Declared here -- not imported
 * from `social-publishing/domain/social-publishing-constants.ts` -- for the same
 * reason as `website_engagement` above. The literals are kept identical by the
 * AsyncAPI parity gate and by `tests/social-publishing-contract.test.ts`.
 */
export const SOCIAL_PUBLISHING_EVENT_VERSION = "1.0";
export const SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE =
  "awcms.social_publishing.publication.queued";
export const SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE =
  "awcms.social_publishing.publication.cancelled";
export const SOCIAL_JOB_PUBLISHED_EVENT_TYPE =
  "awcms.social_publishing.job.published";
export const SOCIAL_JOB_FAILED_EVENT_TYPE =
  "awcms.social_publishing.job.failed";

/**
 * `crm_leads` (ADR-0153, Issue #1166). Declared here -- not imported from
 * `crm-leads/domain/crm-leads-constants.ts` -- for the same reason as
 * `website_engagement` above. The literals are kept identical by the AsyncAPI
 * parity gate and by `tests/crm-leads-contract.test.ts`.
 */
export const CRM_LEADS_EVENT_VERSION = "1.0";
const CRM_LEADS_EVENT_DESCRIPTIONS: readonly [string, string][] = [
  [
    "awcms.crm_leads.lead.created",
    "A lead was created through an intake path, in the transaction that stored it. Carries the opaque lead, pipeline, revision and first-touch ids, the initial stage key and category, the source kind with its opaque channel-account and campaign references, the KINDS of contact point held (never their values), and the source's effective and recorded times; never a name, an address, a phone number or a note. A replayed intake publishes nothing."
  ],
  [
    "awcms.crm_leads.lead.stage_changed",
    "A lead's stage changed (a move, a stage migration on a new revision, a conversion, a conversion reversal, a merge or its rollback), in the transaction that appended the transition row. Carries the lead, pipeline, revision and transition ids, the transition kind, the from/to stage keys and closed categories and the effective and recorded times; never a reason or a note."
  ],
  [
    "awcms.crm_leads.lead.assigned",
    "A lead's owner changed. Carries the lead id and the previous and new owner tenant-user ids only."
  ],
  [
    "awcms.crm_leads.lead.merged",
    "Two leads of one pipeline were merged after human review. Carries the merge, survivor and absorbed lead ids and the undo deadline; never the reviewer's note."
  ],
  [
    "awcms.crm_leads.lead.merge_reverted",
    "A lead merge was rolled back within its undo window. Carries the merge, survivor and absorbed lead ids only."
  ],
  [
    "awcms.crm_leads.lead.converted",
    "A conversion was recorded for a lead: confirmed by the customer authority (with its opaque external customer reference) or a flagged manual conversion (authority_unconfirmed). Carries the lead and conversion ids, the mode, the opaque customer and evidence references and the converted stage key; never a note. A replayed confirmation publishes nothing."
  ],
  [
    "awcms.crm_leads.lead.conversion_reversed",
    "The customer authority reversed a conversion (a refund, a cancellation). Carries the lead and conversion ids, the opaque reversal evidence reference and the stage key the lead returned to."
  ],
  [
    "awcms.crm_leads.lead.lost",
    "A lead entered a lost or disqualified stage. Carries the lead, pipeline and transition ids, the stage key and its category; a stop signal for follow-up cadences."
  ]
];

/**
 * `telegram_engagement` (ADR-0152, Issue #1156). Declared here -- not imported
 * from `telegram-engagement/domain/telegram-engagement-constants.ts` -- for the
 * same reason as `website_engagement` above. The literals are kept identical by
 * the AsyncAPI parity gate and by `tests/telegram-engagement-contract.test.ts`.
 */
export const TELEGRAM_ENGAGEMENT_EVENT_VERSION = "1.0";
export const TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE =
  "awcms.telegram_engagement.interaction.received";
export const TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE =
  "awcms.telegram_engagement.consent.changed";

export const DOMAIN_EVENT_TYPE_REGISTRY: readonly RegisteredDomainEventType[] =
  [
    ...CRM_LEADS_EVENT_DESCRIPTIONS.map(([eventType, description]) => ({
      eventType,
      eventVersion: CRM_LEADS_EVENT_VERSION,
      description
    })),
    {
      eventType: TELEGRAM_ENGAGEMENT_INTERACTION_RECEIVED_EVENT_TYPE,
      eventVersion: TELEGRAM_ENGAGEMENT_EVENT_VERSION,
      description:
        "A verified customer Telegram update was ingested (ADR-0150 envelope), in the transaction that receipted it: a message or a command from a contact who started the bot. Carries the channel account id, the opaque account-scoped contact reference as sender and conversation, the per-bot update id, a closed event kind, the content KINDS, the provenance (secret_header) and the privacy class; never a Telegram user id, chat id, username, display name, message text, token or header."
    },
    {
      eventType: TELEGRAM_ENGAGEMENT_CONSENT_CHANGED_EVENT_TYPE,
      eventVersion: TELEGRAM_ENGAGEMENT_EVENT_VERSION,
      description:
        "A customer Telegram contact's consent changed for one purpose (support from /start; marketing or transactional through the explicit button; a withdrawal through /stop, the button, a block, a provider 403 or the controller), in the transaction that recorded the evidence. Carries the channel account id, the opaque contact reference, the purpose, the action, the method and the notice version; never the evidence payload or any identity."
    },
    {
      eventType: SOCIAL_PUBLICATION_QUEUED_EVENT_TYPE,
      eventVersion: SOCIAL_PUBLISHING_EVENT_VERSION,
      description:
        "Social publish jobs were queued for a publication, in the transaction that queued them (one event per enqueue call that created at least one job, however many accounts it targets). Carries the publication id, its source kind and article id, the trigger, the approval state, the number of jobs and the target account ids; never a caption, a title, a link or a credential."
    },
    {
      eventType: SOCIAL_PUBLICATION_CANCELLED_EVENT_TYPE,
      eventVersion: SOCIAL_PUBLISHING_EVENT_VERSION,
      description:
        "A social publication was cancelled by an operator. Carries the publication id, how many unsent jobs were cancelled and how many had already been published (those are untouched); never content."
    },
    {
      eventType: SOCIAL_JOB_PUBLISHED_EVENT_TYPE,
      eventVersion: SOCIAL_PUBLISHING_EVENT_VERSION,
      description:
        "One per-account social publish job was accepted by its provider, in the transaction that finalised it. Carries the job, publication and account ids, the provider key and the attempt number; the provider's post id and URL are read through the API, not carried."
    },
    {
      eventType: SOCIAL_JOB_FAILED_EVENT_TYPE,
      eventVersion: SOCIAL_PUBLISHING_EVENT_VERSION,
      description:
        "One per-account social publish job failed terminally (retry budget spent, a rejection, a revoked or disabled account, an account that stayed unavailable). Carries the job, publication and account ids, the provider key, a fixed failure code and the attempt number; never a provider message. A failed job does not affect a published sibling."
    },
    {
      eventType: WEBSITE_ENGAGEMENT_SUBMISSION_RECEIVED_EVENT_TYPE,
      eventVersion: WEBSITE_ENGAGEMENT_EVENT_VERSION,
      description:
        "A website form or interaction was accepted by the public intake, in the transaction that stored it. Carries the opaque submission id, the source, the kind, the authenticated provenance (source authenticated, Origin host verified, which challenge protected it), the explicit consent provenance and the source attribution; never a name, address, phone number or message. A downstream CRM adapter reads the details through the audited reveal endpoint."
    },
    {
      eventType: WEBSITE_ENGAGEMENT_SUBMISSION_WITHDRAWN_EVENT_TYPE,
      eventVersion: WEBSITE_ENGAGEMENT_EVENT_VERSION,
      description:
        "A controller withdrew a website submission (data subject request, consent withdrawn or controller decision). Downstream consumers must honour it. Carries the opaque submission id, the source, a coded reason and the instant only."
    },
    {
      eventType: HR_COMMISSION_ACCRUAL_VOIDED_EVENT_TYPE,
      eventVersion: HR_COMMISSION_EVENT_VERSION,
      description:
        "A commission accrual was voided (a pending or approved accrual, by the HTTP void route or by the CommissionAccrualPort when the sale it came from was voided, refunded or cancelled), in the transaction that voided it. Carries opaque ids, the source TYPE, the rule key and version, the status it left and a coded reason only: never an amount, a source reference, a payment reference or a name."
    },
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
    },
    {
      eventType: INVENTORY_MOVEMENT_POSTED_EVENT_TYPE,
      eventVersion: INVENTORY_EVENT_VERSION,
      description:
        "A stock movement was posted to the append-only inventory ledger and its balance updated, in one transaction. Carries opaque item and source references and decimal-string quantities only — never a note or anything identifying a person. Ordered per balance (location + item)."
    },
    {
      eventType: INVENTORY_STOCK_LOW_EVENT_TYPE,
      eventVersion: INVENTORY_EVENT_VERSION,
      description:
        "A stock balance crossed to or below its low-stock threshold — by a movement or by a threshold change. Published once per downward crossing, not on every movement while the balance stays low."
    },
    {
      eventType: TAX_RULE_VERSION_PUBLISHED_EVENT_TYPE,
      eventVersion: TAX_EVENT_VERSION,
      description:
        "A tax rule version was published and became the rule in force from its effective date; carries the id of the predecessor version whose window it closed, if any. Identifiers, codes and dates only."
    },
    {
      eventType: TAX_SNAPSHOT_FINALISED_EVENT_TYPE,
      eventVersion: TAX_EVENT_VERSION,
      description:
        "A document's tax was finalised into an immutable snapshot. Carries the opaque document reference, the rule version it was computed under and decimal-string totals — no customer data."
    },
    {
      eventType: TAX_SNAPSHOT_REVERSED_EVENT_TYPE,
      eventVersion: TAX_EVENT_VERSION,
      description:
        "A finalised document's tax was reversed (refund/return) from its original snapshot. Totals are negative decimal strings; carries the original snapshot id."
    },
    {
      eventType: PROCUREMENT_DOCUMENT_FINALISED_EVENT_TYPE,
      eventVersion: PROCUREMENT_EVENT_VERSION,
      description:
        "A procurement document (receive, supplier return, requisition or transfer) was finalised and its inventory movements posted through the ledger, in one transaction. Carries opaque ids, the document number and decimal-string cost only — never a supplier name, identifier, note or reason."
    },
    {
      eventType: PROCUREMENT_DOCUMENT_REVERSED_EVENT_TYPE,
      eventVersion: PROCUREMENT_EVENT_VERSION,
      description:
        "A finalised procurement document was reversed: compensating inventory movements were posted and the document marked reversed, in one transaction. Same payload shape as document.finalised."
    },
    {
      eventType: WHATSAPP_MESSAGE_QUEUED_EVENT_TYPE,
      eventVersion: WHATSAPP_EVENT_VERSION,
      description:
        "A message was accepted into the WhatsApp outbox, in the same transaction as the caller's fact. Carries the message id, template key, purpose and the masked recipient only — never a phone number, body or variable."
    },
    {
      eventType: WHATSAPP_MESSAGE_SENT_EVENT_TYPE,
      eventVersion: WHATSAPP_EVENT_VERSION,
      description:
        "The provider accepted the WhatsApp message. Same payload shape as message.queued."
    },
    {
      eventType: WHATSAPP_MESSAGE_FAILED_EVENT_TYPE,
      eventVersion: WHATSAPP_EVENT_VERSION,
      description:
        "A WhatsApp message reached a terminal failure; carries a coarse failureCode. Same payload shape as message.queued."
    },
    {
      eventType: WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE,
      eventVersion: WHATSAPP_EVENT_VERSION,
      description:
        "A WhatsApp message passed its expiry before it was sent and was not retried late. Same payload shape as message.queued."
    },
    {
      eventType: WHATSAPP_CONSENT_GRANTED_EVENT_TYPE,
      eventVersion: WHATSAPP_EVENT_VERSION,
      description:
        "A recipient's WhatsApp marketing consent was recorded. Carries the consent id, purpose and the masked recipient only."
    },
    {
      eventType: WHATSAPP_CONSENT_WITHDRAWN_EVENT_TYPE,
      eventVersion: WHATSAPP_EVENT_VERSION,
      description:
        "A recipient's WhatsApp marketing consent was withdrawn; their waiting marketing messages were cancelled in the same transaction. Same payload shape as consent.granted."
    },
    {
      eventType: WHATSAPP_DISPATCH_FAILED_EVENT_TYPE,
      eventVersion: WHATSAPP_EVENT_VERSION,
      description:
        "A WhatsApp dispatcher pass failed as a whole (job level, not one message). Carries a coarse failureCode and the failure instant."
    },
    {
      eventType: BOOKING_RESERVATION_CREATED_EVENT_TYPE,
      eventVersion: BOOKING_EVENT_VERSION,
      description:
        "A reservation exists: held, or confirmed when the offering confirms immediately. Carries ids, the interval, resources, offerings, party size and the adapter's opaque external reference; never a customer reference, note, reason or amount."
    },
    {
      eventType: BOOKING_RESERVATION_HELD_EVENT_TYPE,
      eventVersion: BOOKING_EVENT_VERSION,
      description:
        "A hold was placed (not emitted when the offering confirms immediately). Same payload shape as reservation.created."
    },
    {
      eventType: BOOKING_RESERVATION_CONFIRMED_EVENT_TYPE,
      eventVersion: BOOKING_EVENT_VERSION,
      description:
        "A hold became confirmed, or a reservation was created already confirmed (an immediate offering, or the replacement of a reschedule). Same payload shape as reservation.created."
    },
    {
      eventType: BOOKING_RESERVATION_RESCHEDULED_EVENT_TYPE,
      eventVersion: BOOKING_EVENT_VERSION,
      description:
        "A confirmed reservation was superseded by a replacement in one transaction; carries supersededById. The replacement announces itself with created and confirmed, naming rescheduledFromId."
    },
    {
      eventType: BOOKING_RESERVATION_CANCELLED_EVENT_TYPE,
      eventVersion: BOOKING_EVENT_VERSION,
      description:
        "A held or confirmed reservation was cancelled and its allocations released; carries lateCancellation. Same payload shape as reservation.created."
    },
    {
      eventType: BOOKING_RESERVATION_CHECKED_IN_EVENT_TYPE,
      eventVersion: BOOKING_EVENT_VERSION,
      description:
        "A confirmed reservation was checked in. Same payload shape as reservation.created."
    },
    {
      eventType: BOOKING_RESERVATION_COMPLETED_EVENT_TYPE,
      eventVersion: BOOKING_EVENT_VERSION,
      description:
        "A checked-in reservation was completed (checked out). Same payload shape as reservation.created."
    },
    {
      eventType: BOOKING_RESERVATION_NO_SHOW_EVENT_TYPE,
      eventVersion: BOOKING_EVENT_VERSION,
      description:
        "A confirmed reservation was marked no-show by a person after its start plus the grace. Same payload shape as reservation.created."
    },
    {
      eventType: BOOKING_RESERVATION_EXPIRED_EVENT_TYPE,
      eventVersion: BOOKING_EVENT_VERSION,
      description:
        "A hold expired, found by the sweep job or reclaimed by a claim that wanted its units, and its allocations were released. Same payload shape as reservation.created."
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
