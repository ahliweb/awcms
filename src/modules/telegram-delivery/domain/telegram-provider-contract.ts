/**
 * Provider-neutral Telegram contract (Issue #965, ADR-0140 section 5). Pure
 * types. `TelegramProvider` is the adapter port (`send`, `healthCheck`); the
 * dispatcher calls it OUTSIDE any DB transaction. Telegram-shaped on purpose: a
 * channel parameter here would be notification orchestration admitted by the
 * back door (ADR-0133 section 7, ADR-0139).
 */

/**
 * `chatId` is the decrypted Telegram chat id. It reaches an adapter because
 * delivery is impossible without it and must reach nothing else: logs and error
 * text never carry it.
 */
export type TelegramSendRequest = {
  chatId: string;
  /** Rendered plain text. Sent with no `parse_mode`. */
  text: string;
  templateKey: string;
  /** Propagated to logs. Never a dedupe key. */
  correlationId?: string;
};

/**
 * - `retryable`: timeout, `429`, `5xx` and a transient auth/config problem. A
 *   `400` rejection of the MESSAGE is terminal.
 * - `retryAfterSeconds`: Telegram's own `parameters.retry_after` on a `429`. The
 *   dispatcher reschedules to exactly that (bounded by a cap) WITHOUT escalating
 *   the exponential backoff and without spending the retry budget.
 * - `bindingUnreachable`: `403` (blocked, user deleted) or "chat not found". The
 *   dispatcher suspends the binding and never retries it.
 * - `failureCode`: a coarse, non-sensitive code the dispatcher stores.
 */
export type TelegramSendResult =
  | { ok: true; providerMessageId?: string }
  | {
      ok: false;
      error: string;
      retryable: boolean;
      failureCode: string;
      retryAfterSeconds?: number;
      bindingUnreachable?: boolean;
    };

export type TelegramHealthResult = { ok: true } | { ok: false; error: string };

export type TelegramProvider = {
  send(request: TelegramSendRequest): Promise<TelegramSendResult>;
  healthCheck(): Promise<TelegramHealthResult>;
};
