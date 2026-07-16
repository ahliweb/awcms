/**
 * Provider-neutral email service contract (Issue #493, epic #492).
 *
 * Pure types only — no implementation here. `EmailProvider` is the port;
 * the Mailketing adapter (Issue #495) and any future adapter (e.g. a
 * logging/fake provider for local dev and tests) both implement it. Mirrors
 * `sync-storage/infrastructure/object-storage-uploader.ts`'s `ObjectUploader`
 * port — one interface, resolved to a concrete implementation at the edge,
 * never imported by name (`Mailketing...`) anywhere outside the adapter
 * itself and its resolver (Issue #495).
 *
 * Callers build an `EmailMessage`, enqueue it (Issue #494's outbox table),
 * and a separate dispatcher (Issue #495) calls `EmailProvider.send` OUTSIDE
 * any DB transaction — same rule ADR-0006 already applies to object
 * storage uploads (`doc 16 §Transactional outbox`). Nothing in this module
 * may call a provider from inside `withTenant`/`sql.begin`.
 */

/** A single recipient/sender address. `name` is optional display name. */
export type EmailAddress = {
  address: string;
  name?: string;
};

/**
 * Reference to an already-durable object (Issue #494's schema decides the
 * exact storage shape) — never raw attachment bytes. Keeps large payloads
 * out of the message DTO and out of any provider request/response log.
 */
export type EmailAttachmentRef = {
  objectKey: string;
  fileName: string;
  contentType: string;
};

export type EmailMessage = {
  to: EmailAddress[];
  from: EmailAddress;
  subject: string;
  /** At least one of `textBody`/`htmlBody` must be present; enforced by the caller (Issue #494/#498), not this type. */
  textBody?: string;
  htmlBody?: string;
  attachments?: EmailAttachmentRef[];
  /** Propagated to provider requests/logs for tracing — never used as a dedupe key (the outbox's own idempotency key, Issue #494, owns that). */
  correlationId?: string;
};

export type EmailDeliveryResult =
  | { ok: true; providerMessageId?: string }
  | { ok: false; error: string; retryable: boolean };

export type EmailHealthCheckResult =
  { ok: true } | { ok: false; error: string };

/**
 * The port. `retryable` on a failed send tells the dispatcher (Issue #495)
 * whether to schedule a retry (`queued → retry_wait`) or move straight to
 * a terminal `failed`/`suppressed` state — e.g. an invalid recipient
 * address is not retryable, a provider timeout is.
 */
export type EmailProvider = {
  send(message: EmailMessage): Promise<EmailDeliveryResult>;
  healthCheck(): Promise<EmailHealthCheckResult>;
};
