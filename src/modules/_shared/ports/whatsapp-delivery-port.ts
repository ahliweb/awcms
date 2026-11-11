/**
 * `WhatsappDeliveryPort` — the capability port of `whatsapp_delivery`
 * (Issue #963, ADR-0133 section 8, ADR-0011).
 *
 * Booking (reminders), hr_payroll (notices), and a downstream commerce adapter
 * depend on THIS type, never on `whatsapp_delivery`'s `application/` or
 * `domain/` code. It is WhatsApp-specific on purpose: a `channel` parameter
 * would be notification orchestration admitted by the back door (ADR-0133
 * section 7). A caller that wants e-mail calls the e-mail port.
 *
 * ## Rules a consumer must honour
 *
 * - `enqueue` and `cancelByCorrelation` are plain DB writes in the CALLER's
 *   transaction (so a rolled-back booking never sends a reminder). There is no
 *   `send`: the provider is called only by the dispatcher job, outside any
 *   transaction. The caller never learns the provider's answer synchronously.
 * - `refused` and `suppressed` are RETURNED, never thrown, so a booking is not
 *   rolled back because a reminder could not be queued. NOTE the converse
 *   hazard: a handler that RETURNS a 4xx `Response` after a refusal still
 *   COMMITS the transaction.
 * - The port performs NO access check and writes NO audit row: the consumer's
 *   composition root authorises its OWN business action and audits it.
 * - Status is read back by `correlationId` and is never copied into the
 *   caller's table, so it cannot drift.
 * - A consumer registers its templates (module-prefixed keys) through
 *   `registerWhatsappTemplate`; it never adds its own WhatsApp table,
 *   dispatcher or provider call (ADR-0133 section 3: one queue per channel).
 *
 * ## Port version 1.1.0 — sender-aware routing (Issue #1141, ADR-0148 section 4)
 *
 * `1.0.0` was the shape of Issue #963. `1.1.0` is ADDITIVE: three OPTIONAL
 * input fields (`senderAccountId`, `inReplyToMessageId`, `businessScope`) and
 * three new refusal reasons. No existing signature or field changed, so every
 * existing consumer (booking, the commerce adapter behind `awcms-one`'s
 * `legacy`/`upstream` mode router, ADR-0047) compiles and behaves exactly as
 * before: a call that sets none of the new fields and a tenant with no sender
 * policy is queued with `senderAccountId = null`, which IS the deployment
 * sender, and takes the same path, the same provider and the same credential as
 * `1.0.0`. A consumer that does an exhaustive `switch` over the refusal reasons
 * (none in this repository does; booking maps an unknown reason to a coarse
 * code) must add the three new members before it passes a sender.
 *
 * ## Port version 1.2.0 — brand-scoped marketing consent (Issue #1231 M4)
 *
 * ADDITIVE: two new refusal reasons, `CONSENT_SCOPE_REQUIRED` and
 * `BUSINESS_SCOPE_UNRESOLVED` (a marketing message's scope must resolve in the
 * tenant). A marketing
 * opt-in covers only the business scope (brand) it was collected for; an
 * unscoped or legacy opt-in covers only marketing that names no scope. Opt-out
 * and suppression stay tenant-wide. Transactional and security messages are
 * unchanged.
 *
 * - The sender is `senderAccountId`, else the prospective default of the
 *   message's business scope, else the deployment sender, and is SNAPSHOTTED on
 *   the queue row. It is never a token, a phone number id or a device id: the
 *   adapter and the credential are resolved from the tenant's own account
 *   record, never from the caller.
 * - A sender that is not usable gives `refused: SENDER_UNAVAILABLE`. There is
 *   NO fallback to the default, to the deployment sender, to another number or
 *   to another provider (ADR-0148 I5); an explicit reroute is a NEW enqueue.
 * - A caller that accepts a sender id from a USER must authorise that choice
 *   itself (the port performs no access check): tenant authority is enforced
 *   here, per-person assignment is not.
 */
export type WhatsappTenantTx = Bun.TransactionSQL;

export type WhatsappPurpose = "transactional" | "security" | "marketing";

export type WhatsappRecipient =
  { kind: "profile"; profileId: string } | { kind: "address"; phone: string };

export type EnqueueWhatsappInput = {
  tenantId: string;
  templateKey: string;
  variables: Record<string, string>;
  recipient: WhatsappRecipient;
  /** Required. Unique per `(tenantId, idempotencyKey)`; a replay returns `duplicate`. */
  idempotencyKey: string;
  correlationId?: string;
  /** Scheduled send (a reminder). Defaults to "as soon as the dispatcher runs". */
  notBefore?: Date;
  /** Mandatory when the template's purpose is `security`; a message past it is expired, not sent late. */
  expiresAt?: Date;
  /** The acting tenant user, when there is one, for the row's `created_by`. */
  createdBy?: string;
  /**
   * Port 1.1.0. The tenant-owned `channel_accounts` row that should send this
   * message. Omitted: the default sender of `businessScope`, else the
   * deployment sender. Pinned on the row at enqueue. A foreign, unknown,
   * revoked, disabled, disconnected or unapproved account is
   * `refused: SENDER_UNAVAILABLE`.
   */
  senderAccountId?: string;
  /**
   * Port 1.1.0. Thread affinity: this message continues the thread of an
   * earlier message of the SAME tenant and recipient, and so keeps that
   * message's sender (the provider's customer-service window is per sender and
   * recipient). A `senderAccountId` that names a different sender is
   * `refused: SENDER_AFFINITY_CONFLICT`; an unknown or foreign target, or one
   * addressed to someone else, is `refused: REPLY_TARGET_UNKNOWN`.
   */
  inReplyToMessageId?: string;
  /**
   * Port 1.1.0. The business scope (a brand or unit) this message belongs to,
   * the key of the default-sender policy. A scoped sender account may only
   * send for its own scope; a tenant-wide account may send for any.
   */
  businessScope?: { type: string; id: string };
};

export type EnqueueWhatsappRefusalReason =
  | "CONSENT_REQUIRED"
  | "TEMPLATE_UNKNOWN"
  | "DISABLED"
  | "RATE_LIMITED"
  | "RECIPIENT_INVALID"
  | "RECIPIENT_UNRESOLVED"
  | "EXPIRY_REQUIRED"
  /** The deployment has no usable recipient-hash key ring; nothing is queued (fail closed). */
  | "MISCONFIGURED"
  /** Port 1.1.0. The chosen sender may not send (foreign, unknown, revoked, disabled, disconnected, unapproved, no adapter). Never falls to another sender. */
  | "SENDER_UNAVAILABLE"
  /** Port 1.1.0. `senderAccountId` names a different sender than the thread's. A reroute is a separate, authorised request. */
  | "SENDER_AFFINITY_CONFLICT"
  /** Port 1.1.0. `inReplyToMessageId` is unknown, foreign, or addressed to another recipient. */
  | "REPLY_TARGET_UNKNOWN"
  /**
   * Issue #1231 M4. A marketing message whose recipient HAS a granted opt-in,
   * but not for this message's business scope (brand): the opt-in lists other
   * brands, or it is unscoped while the message names a brand, or it names
   * brands while the message names none. Nothing is queued; record a consent
   * for that brand first. Never downgraded to another purpose.
   */
  | "CONSENT_SCOPE_REQUIRED"
  /**
   * Issue #1231 M4. A MARKETING message names a `businessScope` that is not a
   * real scope of the tenant (unknown type, unknown, foreign, deleted or
   * inactive id; only `office` resolves today). Nothing is queued.
   */
  | "BUSINESS_SCOPE_UNRESOLVED";

export type EnqueueWhatsappResult =
  | { status: "queued"; messageId: string }
  | { status: "duplicate"; messageId: string }
  | { status: "suppressed"; reason: "hard_failure" | "opt_out" }
  | { status: "refused"; reason: EnqueueWhatsappRefusalReason };

export type WhatsappMessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "retry_wait"
  | "cancelled"
  | "expired";

/** What a caller may read back: ids, state and the MASKED recipient. Never the number, body or variables. */
export type WhatsappStatus = {
  messageId: string;
  templateKey: string;
  purpose: WhatsappPurpose;
  status: WhatsappMessageStatus;
  recipientMasked: string;
  failureCode: string | null;
  sentAt: string | null;
  createdAt: string;
};

export interface WhatsappDeliveryPort {
  /** One INSERT in the CALLER's transaction. No network I/O. */
  enqueue(
    tx: WhatsappTenantTx,
    input: EnqueueWhatsappInput
  ): Promise<EnqueueWhatsappResult>;
  /** Reads the outbox row back by correlation id. */
  getStatusByCorrelation(
    tx: WhatsappTenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<WhatsappStatus[]>;
  /** Cancels still-queued messages (booking cancelled before the reminder). A no-op (0) once sent. */
  cancelByCorrelation(
    tx: WhatsappTenantTx,
    tenantId: string,
    correlationId: string
  ): Promise<number>;
}
