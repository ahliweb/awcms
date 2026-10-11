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
  | "MISCONFIGURED";

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
