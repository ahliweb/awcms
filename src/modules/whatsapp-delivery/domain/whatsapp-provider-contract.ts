/**
 * Provider-neutral WhatsApp contract (Issue #963, ADR-0133 section 2/5). Pure
 * types. `WhatsappProvider` is the adapter port (`send`, `healthCheck`); the
 * dispatcher calls it OUTSIDE any DB transaction. Not a multi-channel facade:
 * the shape is WhatsApp's, and a channel parameter here would be notification
 * orchestration admitted by the back door (ADR-0133 section 7).
 */

/**
 * `to` is the RAW E.164 number — credential-grade personal data. It reaches an
 * adapter because delivery is impossible without it, and must not reach
 * anything else: logs and error text read `toMasked`.
 */
export type WhatsappSendRequest = {
  to: string;
  toMasked: string;
  /** Rendered free text. Used by adapters that send free text. */
  body: string;
  templateKey: string;
  /** Pre-approved template identity for providers that require one (Meta). */
  providerTemplate?: { name: string; language: string };
  /** The allow-listed variables in the template's declared order, for template parameters. */
  parameters: readonly string[];
  /** Propagated to provider requests and logs. Never a dedupe key. */
  correlationId?: string;
  /**
   * Issue #1143, Meta only. Set by the DISPATCHER (never a caller) when the row
   * has no provider template and it verified, immediately before the send,
   * that the recipient's 24-hour customer-service window with THIS sender is
   * open: the adapter may then send `body` as a free-text service message.
   * Absent: a Meta adapter sends templates only, exactly as before.
   */
  serviceWindowOpen?: boolean;
};

/**
 * - `retryable`: timeout/429/5xx — schedule a backoff; a 4xx rejection of the
 *   MESSAGE is terminal.
 * - `recipientInvalid`: the provider says this number cannot receive WhatsApp.
 *   Not an error to chase and not an outage: the dispatcher suppresses the
 *   number (`hard_failure`) so nothing else is queued to it.
 * - `failureCode`: a coarse, non-sensitive code the dispatcher stores and emits.
 */
export type WhatsappSendResult =
  | { ok: true; providerMessageId?: string }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      failureCode: string;
      recipientInvalid?: boolean;
    };

export type WhatsappHealthResult = { ok: true } | { ok: false; error: string };

export type WhatsappProvider = {
  send(request: WhatsappSendRequest): Promise<WhatsappSendResult>;
  healthCheck(): Promise<WhatsappHealthResult>;
};
