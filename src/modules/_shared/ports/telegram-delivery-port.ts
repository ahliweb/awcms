/**
 * `TelegramDeliveryPort` — the capability port of `telegram_delivery`
 * (Issue #965, ADR-0140 section 8, ADR-0011).
 *
 * `booking` (staff reminders), `workflow_approval` (pending approvals) and the
 * platform's own operational alerts depend on THIS type, never on
 * `telegram_delivery`'s `application/` or `domain/` code. It is
 * Telegram-specific on purpose: a `channel` parameter would be notification
 * orchestration admitted by the back door (ADR-0133 section 7, ADR-0139). A
 * caller that wants e-mail or WhatsApp calls THAT port.
 *
 * ## What a consumer can and cannot pass
 *
 * A template key, allow-listed variables, a recipient PRINCIPAL (the tenant user,
 * `awcms_tenant_users.id`) and an expiry. Never a chat id, a phone number or a
 * free-text body: there is no `send(text)`. The recipient set is bound staff
 * only, deliberately: a customer cannot bind a chat.
 *
 * ## Rules a consumer must honour
 *
 * - `enqueue` and `cancelByCorrelation` are plain DB writes in the CALLER's
 *   transaction, which must be a TENANT transaction (the tenant id is read from
 *   the transaction's own RLS context, so a mismatched tenant is unrepresentable).
 *   The provider is called only by the dispatcher job, outside any transaction.
 * - `refused` is RETURNED, never thrown, so a booking is not rolled back because
 *   an alert could not be queued. NOTE the converse hazard: a handler that
 *   RETURNS a 4xx `Response` after a refusal still COMMITS the transaction.
 * - **`NO_BINDING` never triggers another channel.** What the consumer does about
 *   it is its own explicit decision, in its own module (ADR-0139). This module
 *   will not then try e-mail, WhatsApp or anything else, and a terminal Telegram
 *   failure triggers nothing elsewhere.
 * - The port performs NO access check and writes NO audit row: the consumer's
 *   composition root authorises its OWN business action and audits it.
 * - A consumer registers its templates (module-prefixed keys) through
 *   `registerTelegramTemplate`; a template under a payroll-owning module is
 *   refused at registration and fails `bun run telegram:templates:check`.
 */
export type TelegramTenantTx = Bun.TransactionSQL;

export type EnqueueTelegramInput = {
  /** A registered template key, e.g. `booking.staff_reminder`. */
  templateKey: string;
  /** The staff member (tenant user) the notice is for. Never a chat id. */
  recipientPrincipalId: string;
  /** Only the template's allow-listed variables survive; each must satisfy its kind. */
  variables: Record<string, string>;
  /** Required. Unique per tenant; a replay returns `duplicate`. */
  idempotencyKey: string;
  /**
   * Required. A notice that arrives a day late is noise, so a message past this
   * instant is expired, never sent late. Must be in the future and at most
   * seven days out.
   */
  expiresAt: Date;
  /** The caller's own record id, for reading status back. Never a dedupe key. */
  correlationId?: string;
};

export type EnqueueTelegramRefusalReason =
  | "DISABLED"
  | "TEMPLATE_UNKNOWN"
  | "NO_BINDING"
  | "RATE_LIMITED"
  | "EXPIRY_REQUIRED";

export type EnqueueTelegramResult =
  | { status: "queued"; messageId: string }
  | { status: "duplicate"; messageId: string }
  | { status: "refused"; reason: EnqueueTelegramRefusalReason };

export type TelegramMessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "retry_wait"
  | "cancelled"
  | "expired";

/** What a caller may read back: ids and state. Never the chat, body or variables. */
export type TelegramStatus = {
  messageId: string;
  templateKey: string;
  status: TelegramMessageStatus;
  failureCode: string | null;
  sentAt: string | null;
  createdAt: string;
};

export interface TelegramDeliveryPort {
  /** One INSERT in the CALLER's transaction. No network I/O. */
  enqueue(
    tx: TelegramTenantTx,
    input: EnqueueTelegramInput
  ): Promise<EnqueueTelegramResult>;
  /** Reads the queue row back by correlation id. */
  getStatusByCorrelation(
    tx: TelegramTenantTx,
    correlationId: string
  ): Promise<TelegramStatus[]>;
  /** Cancels still-queued messages (the shift was cancelled before the reminder). A no-op (0) once sent. */
  cancelByCorrelation(
    tx: TelegramTenantTx,
    correlationId: string
  ): Promise<number>;
}
