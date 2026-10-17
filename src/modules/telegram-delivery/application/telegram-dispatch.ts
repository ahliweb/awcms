/**
 * Internal Telegram dispatcher (Issue #965, ADR-0140 section 5). NOT a public HTTP
 * endpoint: invoked by `scripts/telegram-dispatch.ts`, one tenant at a time, the
 * same "trusted internal worker only" boundary as the email, push and WhatsApp
 * dispatchers it copies.
 *
 * Three phases (ADR-0006: never call a provider inside a DB transaction):
 *
 * 1. CLAIM: one short transaction flips due `queued`/`retry_wait` rows to a
 *    transient `sending` (`FOR UPDATE SKIP LOCKED`), reusing `next_attempt_at` as
 *    the claim lease expiry. A `sending` row whose lease has passed is re-claimed.
 * 2. SEND: re-checks everything that can have changed since enqueue, then calls
 *    the `TelegramProvider` OUTSIDE any transaction.
 * 3. FINALISE: one short transaction per row. Every attempt is recorded.
 *
 * At-least-once to the provider is accepted (ADR-0140 section 5.8); the Telegram
 * `message_id` is recorded.
 *
 * ## What is re-checked at SEND time, not only at enqueue
 *
 * - **The tenant gate** (module enabled in Module Management AND the audited
 *   tenant setting on). If either is off the pass revokes every binding of the
 *   tenant and sends nothing.
 * - **The binding**: still `active`. A revocation cancels queued rows at once; this
 *   catches the race where a row was already claimed.
 * - **The principal**: still active and still holding at least one role
 *   (`awcms_telegram_principal_active`, `sql/217`). A deactivated or roleless
 *   principal ends the binding (cause `principal_deactivated`) and the message is
 *   cancelled, never sent.
 * - **Expiry**: a message past `expires_at` is `expired`, not retried late. The
 *   purge job enforces the same independently, as the backstop for a tenant the
 *   dispatcher is not draining.
 *
 * ## Rate rules (ADR-0140 section 5.4)
 *
 * - At least one second per chat: a row for a chat that was sent to within
 *   `TELEGRAM_RATE_PER_CHAT_INTERVAL_MS` is DEFERRED to the next pass, not slept on.
 * - A global ceiling under 30 per second: the adapter's pacer (one instance
 *   shared by every tenant of the run, see `telegram-provider-resolver.ts`).
 * - `429` with `retry_after`: the row is rescheduled to `now + retry_after`
 *   (capped), does NOT consume the retry budget and does NOT escalate the
 *   exponential backoff; the rest of the claimed batch is released to the same
 *   instant instead of being sent into a known rate limit.
 *
 * ## One owner per row: the lease is renewed and checked per row
 *
 * The claim lease must outlive the WHOLE batch (`limit` x the worst-case send
 * time), otherwise a slow pass lets another worker re-claim a row this one has not
 * reached yet. So the claim lease is sized from the batch, and immediately before
 * each row this pass renews it to a short lease and VERIFIES it still holds. Zero
 * rows updated means the lease was lost and the row is skipped, never sent.
 * Finalisation is guarded by the exact lease value this pass wrote.
 *
 * A re-claim of an expired `sending` row bumps `retry_count`, and a row whose
 * count has passed the retry cap is failed instead of sent, so a poison pill that
 * crashes the worker every time reaches `failed`. A throw while processing one row
 * fails THAT row, not the pass.
 *
 * ## Nothing about the chat leaks
 *
 * The chat id is decrypted in memory for one `send` and goes nowhere else. A
 * terminal row has `body` and `variables` cleared.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import {
  isTelegramEnabled,
  resolveTelegramDispatchBatchSize,
  resolveTelegramEncryptionRing,
  resolveTelegramGlobalPerSecond,
  resolveTelegramPerChatIntervalMs,
  resolveTelegramRetryAfterCapSeconds,
  resolveTelegramSendMaxRetries,
  resolveTelegramSendTimeoutMs
} from "../domain/telegram-config";
import { decryptChatId } from "../domain/telegram-chat";
import {
  TELEGRAM_CIRCUIT_BREAKER_KEY,
  TELEGRAM_MODULE_KEY
} from "../domain/telegram-constants";
import type { TelegramProvider } from "../domain/telegram-provider-contract";
import { redactProviderText } from "../domain/telegram-redaction";
import { evaluateTelegramRetry } from "../domain/telegram-retry";
import { getTelegramTemplate } from "../domain/telegram-templates";
import { resolveTelegramProvider } from "../infrastructure/telegram-provider-resolver";
import { auditEndedBindings, endBindings } from "./telegram-bindings";
import { sweepIneligibleBindings } from "./telegram-binding-sweep";

/** The SHORT per-row lease, written immediately before each row is processed. */
export const TELEGRAM_DISPATCH_LEASE_MINUTES = 2;
const MAX_RESPONSE_SNIPPET_LENGTH = 500;

type ClaimedRow = {
  id: string;
  correlation_id: string | null;
  template_key: string;
  principal_id: string;
  binding_id: string;
  body: string;
  variables: Record<string, string> | null;
  expires_at: Date | string;
  retry_count: string | number;
  created_at: Date | string;
};

export type DispatchTelegramQueueOptions = {
  limit?: number;
  now?: Date;
  correlationId?: string;
  resolveProvider?: (env?: NodeJS.ProcessEnv) => TelegramProvider;
  env?: NodeJS.ProcessEnv;
};

export type DispatchTelegramQueueResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  expired: number;
  /** Cancelled at dispatch because the binding or the principal was no longer eligible. */
  cancelled: number;
  /** Rows left for the next pass because the chat was messaged less than the per-chat interval ago. */
  deferred: number;
  /** Rows rescheduled to Telegram's `retry_after` (including the rest of a batch released by one). */
  rateLimited: number;
  /** Bindings suspended (403 / chat not found) or revoked (principal gone, gate closed) by this pass. */
  bindingsEnded: number;
  /** Rows skipped because this pass no longer owned their lease. Never sent by this pass. */
  leaseLost: number;
  breakerOpen: boolean;
};

type Terminal = "failed" | "expired" | "cancelled";

/**
 * The claim predicate MIRRORS the lease it writes: a worker that dies between
 * CLAIM and FINALISE leaves the row `sending`, and every finalise is guarded by
 * `status = 'sending'`, so without the `OR (status = 'sending' AND
 * next_attempt_at <= now)` arm such a row would be unsendable and uncancellable.
 */
async function claimEligibleMessages(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  limit: number,
  leaseExpiry: Date
): Promise<ClaimedRow[]> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      // A MATERIALIZED CTE, not `WHERE id IN (SELECT ... LIMIT n FOR UPDATE SKIP
      // LOCKED)`. With the subquery inline the planner may re-run it as the inner
      // side of a nested loop, and each re-run can lock and return a DIFFERENT set
      // of rows, so a batch of `n` claims more than `n`. That breaks the lease
      // sizing (the lease is sized for `limit` rows) and the per-tick rate budget.
      // Observed against PostgreSQL 16: `LIMIT 1` claimed 2.
      const rows = await tx`
        WITH due AS MATERIALIZED (
          SELECT id FROM awcms_telegram_messages
          WHERE tenant_id = ${tenantId}
            AND (
              (status IN ('queued', 'retry_wait')
                AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
              OR (status = 'sending' AND next_attempt_at <= ${now})
            )
          ORDER BY created_at, id
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE awcms_telegram_messages AS m
        SET status = 'sending', next_attempt_at = ${leaseExpiry},
            -- Re-claiming an EXPIRED sending row is a failed attempt: count it,
            -- so a poison pill reaches the retry cap instead of looping.
            retry_count = m.retry_count
              + CASE WHEN m.status = 'sending' THEN 1 ELSE 0 END,
            updated_at = now()
        FROM due
        WHERE m.id = due.id AND m.tenant_id = ${tenantId}
        RETURNING m.id, m.correlation_id, m.template_key, m.principal_id,
                  m.binding_id, m.body, m.variables, m.expires_at,
                  m.retry_count, m.created_at
      `;

      // `UPDATE ... RETURNING` does not preserve the sub-select's ORDER BY.
      return (rows as unknown as ClaimedRow[]).sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
          a.id.localeCompare(b.id)
      );
    },
    { workClass: "background_sync" }
  );
}

/**
 * Renews the per-row lease and verifies ownership in one statement. Returns the
 * lease value written (the ownership token finalisation must match), or `null`
 * when the row is no longer `sending` under an unexpired lease.
 */
async function renewLease(
  sql: Bun.SQL,
  tenantId: string,
  messageId: string,
  at: Date
): Promise<Date | null> {
  const until = new Date(
    at.getTime() + TELEGRAM_DISPATCH_LEASE_MINUTES * 60_000
  );
  const rows = await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_telegram_messages
      SET next_attempt_at = ${until}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${messageId}
        AND status = 'sending' AND next_attempt_at > ${at}
      RETURNING id
    `,
    { workClass: "background_sync" }
  );

  return (rows as unknown[]).length > 0 ? until : null;
}

/**
 * Provider text is stored, logged and shown to operators. It is redacted for the
 * bot token and number runs by the adapter already; this also removes the exact
 * values of the row's own body and variables, in case a provider echoes them.
 */
export function sanitizeProviderError(
  error: string,
  row: Pick<ClaimedRow, "body" | "variables">,
  token?: string
): string {
  let text = redactProviderText(error, token, MAX_RESPONSE_SNIPPET_LENGTH);
  const values = [row.body, ...Object.values(row.variables ?? {})]
    .filter((value) => typeof value === "string" && value.length >= 3)
    .sort((a, b) => b.length - a.length);

  for (const value of values) {
    text = text.split(value).join("[redacted]");
  }

  return text;
}

async function recordDeliveryAttempt(
  sql: Bun.SQL,
  tenantId: string,
  messageId: string,
  attemptNo: number,
  outcome: "success" | "failure",
  providerName: string,
  snippet: string | null,
  errorMessage: string | null
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      INSERT INTO awcms_telegram_delivery_attempts
        (tenant_id, message_id, attempt_no, outcome, provider_name,
         provider_response_snippet, error_message)
      VALUES (${tenantId}, ${messageId}, ${attemptNo}, ${outcome},
              ${providerName}, ${snippet}, ${errorMessage})
      ON CONFLICT ON CONSTRAINT awcms_telegram_delivery_attempts_unique_attempt
      DO NOTHING
    `,
    { workClass: "background_sync" }
  );
}

async function finalizeSent(
  sql: Bun.SQL,
  tenantId: string,
  row: ClaimedRow,
  providerMessageId: string | undefined,
  leaseUntil: Date
): Promise<void> {
  const updated = (await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_telegram_messages
      SET status = 'sent', sent_at = now(), next_attempt_at = NULL,
          updated_at = now(), provider_message_id = ${providerMessageId ?? null},
          failure_code = NULL, last_error = NULL,
          body = '', variables = '{}'::jsonb
      WHERE tenant_id = ${tenantId} AND id = ${row.id} AND status = 'sending'
        AND next_attempt_at = ${leaseUntil}
      RETURNING id
    `,
    { workClass: "background_sync" }
  )) as { id: string }[];

  if (updated.length === 0) {
    // The provider already accepted it; the row moved on (cancelled, or
    // re-claimed after a lease loss). Never overwrite another owner.
    log("warning", "telegram.dispatch.finalize_lost", {
      tenantId,
      moduleKey: TELEGRAM_MODULE_KEY,
      templateKey: row.template_key
    });
  }
}

async function finalizeTerminal(
  sql: Bun.SQL,
  tenantId: string,
  row: ClaimedRow,
  status: Terminal,
  retryCount: number,
  failureCode: string,
  errorMessage: string,
  leaseUntil: Date
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_telegram_messages
      SET status = ${status}, retry_count = ${retryCount},
          next_attempt_at = NULL, failure_code = ${failureCode},
          last_error = ${errorMessage}, updated_at = now(),
          body = '', variables = '{}'::jsonb
      WHERE tenant_id = ${tenantId} AND id = ${row.id} AND status = 'sending'
        AND next_attempt_at = ${leaseUntil}
    `,
    { workClass: "background_sync" }
  );
}

async function scheduleRetry(
  sql: Bun.SQL,
  tenantId: string,
  messageId: string,
  retryCount: number,
  nextAttemptAt: Date,
  failureCode: string,
  errorMessage: string | null,
  leaseUntil: Date
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_telegram_messages
      SET status = 'retry_wait', retry_count = ${retryCount},
          next_attempt_at = ${nextAttemptAt}, failure_code = ${failureCode},
          last_error = ${errorMessage}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${messageId}
        AND status = 'sending' AND next_attempt_at = ${leaseUntil}
    `,
    { workClass: "background_sync" }
  );
}

/**
 * Returns rows this pass will not process to the queue at `until`, without
 * touching `retry_count`. Guarded by the lease value the rows still carry from
 * the claim, so a row another worker has since re-claimed is left alone.
 */
async function releaseRows(
  sql: Bun.SQL,
  tenantId: string,
  messageIds: readonly string[],
  claimLease: Date,
  until: Date,
  failureCode: string
): Promise<number> {
  if (messageIds.length === 0) {
    return 0;
  }

  const rows = (await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_telegram_messages
      SET status = 'retry_wait', next_attempt_at = ${until},
          failure_code = ${failureCode}, updated_at = now()
      WHERE tenant_id = ${tenantId}
        AND id = ANY(string_to_array(${messageIds.join(",")}, ',')::uuid[])
        AND status = 'sending' AND next_attempt_at = ${claimLease}
      RETURNING id
    `,
    { workClass: "background_sync" }
  )) as { id: string }[];

  return rows.length;
}

type SendTimeFacts = {
  bindingStatus: string | null;
  chatCiphertext: string | null;
  principalActive: boolean;
  lastSentAt: Date | null;
  dbNow: Date;
};

async function readSendTimeFacts(
  sql: Bun.SQL,
  tenantId: string,
  row: ClaimedRow
): Promise<SendTimeFacts> {
  const rows = (await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      SELECT
        b.status AS binding_status,
        b.chat_ciphertext,
        awcms_telegram_principal_active(${tenantId}::uuid, ${row.principal_id}::uuid) AS principal_active,
        (SELECT max(m.sent_at) FROM awcms_telegram_messages m
          WHERE m.tenant_id = ${tenantId} AND m.binding_id = ${row.binding_id}
            AND m.sent_at IS NOT NULL
            AND m.sent_at > now() - interval '1 minute') AS last_sent_at,
        now() AS db_now
      FROM (SELECT 1) one
      LEFT JOIN awcms_telegram_bindings b
        ON b.tenant_id = ${tenantId} AND b.id = ${row.binding_id}
    `,
    { workClass: "background_sync" }
  )) as {
    binding_status: string | null;
    chat_ciphertext: string | null;
    principal_active: boolean;
    last_sent_at: Date | string | null;
    db_now: Date | string;
  }[];

  const fact = rows[0];

  return {
    bindingStatus: fact?.binding_status ?? null,
    chatCiphertext: fact?.chat_ciphertext ?? null,
    principalActive: fact?.principal_active === true,
    lastSentAt: fact?.last_sent_at ? new Date(fact.last_sent_at) : null,
    dbNow: fact?.db_now ? new Date(fact.db_now) : new Date()
  };
}

/**
 * Dispatches one batch of due `awcms_telegram_messages` rows for ONE tenant.
 * Safe to call repeatedly (claim-lease pattern); the CLI loops per tenant.
 */
export async function dispatchTelegramQueue(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchTelegramQueueOptions = {}
): Promise<DispatchTelegramQueueResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const limit = options.limit ?? resolveTelegramDispatchBatchSize(env);
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const maxRetries = resolveTelegramSendMaxRetries(env);
  const perChatIntervalMs = resolveTelegramPerChatIntervalMs(env);
  const retryAfterCapSeconds = resolveTelegramRetryAfterCapSeconds(env);
  const breaker = getProviderCircuitBreaker(TELEGRAM_CIRCUIT_BREAKER_KEY);
  const breakerOpen = !breaker.canAttempt(now);

  const result: DispatchTelegramQueueResult = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    expired: 0,
    cancelled: 0,
    deferred: 0,
    rateLimited: 0,
    bindingsEnded: 0,
    leaseLost: 0,
    breakerOpen
  };

  // Level 1 of ADR-0140 section 2: off means the provider is never touched AND
  // nothing is claimed, so a disabled deployment cannot strand rows in `sending`.
  if (!isTelegramEnabled(env)) {
    return result;
  }

  // Fail closed: without the encryption ring no chat id can be read, so nothing
  // is claimed (a claimed row would sit `sending` until its lease passed).
  const encryptionRing = resolveTelegramEncryptionRing(env);

  if (!encryptionRing.ok) {
    log("error", "telegram.dispatch.encryption_keys_unavailable", {
      correlationId,
      tenantId,
      moduleKey: TELEGRAM_MODULE_KEY
    });

    return result;
  }

  // Levels 2 and 3 of section 2, re-read at send time. A closed gate ends every
  // binding of the tenant (erasing the stored chat ids) and sends nothing.
  const gate = await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      // Closed gate: every binding ends. Open gate: unconfirmed bindings past
      // their window end, and so does the binding of anyone deactivated or left
      // without a role. The nightly purge runs the same sweep with the flag off.
      const swept = await sweepIneligibleBindings(tx, tenantId, now, {
        correlationId
      });

      return {
        open: swept.gateOpen,
        ended: swept.endedByGate + swept.endedByPrincipal + swept.expiredPending
      };
    },
    { workClass: "background_sync" }
  );

  result.bindingsEnded += gate.ended;

  if (!gate.open) {
    return result;
  }

  if (breakerOpen) {
    log("warning", "telegram.dispatch.breaker_open", {
      correlationId,
      tenantId,
      moduleKey: TELEGRAM_MODULE_KEY
    });

    return result;
  }

  // The claim lease must outlive the whole batch (see the header): `limit` rows at
  // the worst-case provider timeout plus the pacing interval, plus a margin.
  const startedAt = Date.now();
  const clock = () => new Date(now.getTime() + (Date.now() - startedAt));
  const paceMs = Math.ceil(1000 / resolveTelegramGlobalPerSecond(env));
  const claimLeaseMs =
    limit * (resolveTelegramSendTimeoutMs(env) + paceMs + 2000) +
    TELEGRAM_DISPATCH_LEASE_MINUTES * 60_000;
  const claimLease = new Date(now.getTime() + claimLeaseMs);
  const claimed = await claimEligibleMessages(
    sql,
    tenantId,
    now,
    limit,
    claimLease
  );
  result.claimed = claimed.length;

  if (claimed.length === 0) {
    return result;
  }

  const provider = (options.resolveProvider ?? resolveTelegramProvider)(env);
  const providerName = "telegram_bot";
  const token = env.TELEGRAM_BOT_TOKEN?.trim();

  log("info", "telegram.dispatch.claimed", {
    correlationId,
    tenantId,
    moduleKey: TELEGRAM_MODULE_KEY,
    count: claimed.length
  });

  let rateLimitedUntil: Date | null = null;

  for (let index = 0; index < claimed.length; index += 1) {
    const entry = claimed[index]!;

    if (rateLimitedUntil) {
      // Telegram told this bot to slow down: do not send the rest of the batch
      // into a known rate limit. Release it to the same instant.
      const released = await releaseRows(
        sql,
        tenantId,
        claimed.slice(index).map((row) => row.id),
        claimLease,
        rateLimitedUntil,
        "rate_limited"
      );

      result.rateLimited += released;
      break;
    }

    const owned: { lease: Date | null } = { lease: null };

    try {
      await processRow(entry, owned);
    } catch (error) {
      // One bad row must not take the pass (and every other claimed row) with
      // it. Fail THIS row, only if this pass still owns it.
      log("error", "telegram.dispatch.row_error", {
        correlationId,
        tenantId,
        moduleKey: TELEGRAM_MODULE_KEY,
        templateKey: entry.template_key,
        error: error instanceof Error ? error.name : "unknown"
      });
      result.failed += 1;

      if (owned.lease) {
        try {
          await finalizeTerminal(
            sql,
            tenantId,
            entry,
            "failed",
            Number(entry.retry_count) + 1,
            "dispatch_error",
            "Dispatcher error while processing this message.",
            owned.lease
          );
        } catch {
          // tx-swallow-ok: The handle here is a pooled client, not a
          // transaction (each statement autocommits), so a caught failure
          // leaves nothing aborted.
          // The row stays `sending`; the re-claim bumps its retry count.
        }
      }
    }
  }

  return result;

  /**
   * Processes one claimed row. It records the lease it owns in `owned` as soon as
   * it has one, so the caller's catch can fail the row if this throws midway.
   */
  async function processRow(
    entry: ClaimedRow,
    owned: { lease: Date | null }
  ): Promise<void> {
    const retryCount = Number(entry.retry_count);
    const attemptNo = retryCount + 1;
    const messageCorrelationId = entry.correlation_id ?? correlationId;

    // 0. Renew and VERIFY the lease before anything else.
    const leaseUntil = await renewLease(sql, tenantId, entry.id, clock());

    if (!leaseUntil) {
      log("warning", "telegram.dispatch.lease_lost", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: TELEGRAM_MODULE_KEY,
        templateKey: entry.template_key
      });
      result.leaseLost += 1;

      return;
    }

    owned.lease = leaseUntil;

    const terminal = (
      status: Terminal,
      count: number,
      code: string,
      text: string
    ) =>
      finalizeTerminal(
        sql,
        tenantId,
        entry,
        status,
        count,
        code,
        text,
        leaseUntil
      );

    // 1. Poison pill: a row that keeps being re-claimed past the cap is failed.
    if (retryCount > maxRetries) {
      await terminal(
        "failed",
        retryCount,
        "retry_exhausted",
        "Message was claimed repeatedly without completing."
      );
      result.failed += 1;

      return;
    }

    // 2. Expiry: expired, never retried late.
    if (new Date(entry.expires_at).getTime() <= clock().getTime()) {
      await terminal(
        "expired",
        retryCount,
        "expired",
        "Message passed its expiry before it was sent."
      );
      result.expired += 1;

      return;
    }

    // 3. Binding, principal and per-chat spacing, read immediately before the send.
    const facts = await readSendTimeFacts(sql, tenantId, entry);

    if (facts.bindingStatus !== "active" || facts.chatCiphertext === null) {
      await terminal(
        "cancelled",
        retryCount,
        "binding_inactive",
        "The recipient's Telegram binding is no longer active."
      );
      result.cancelled += 1;

      return;
    }

    if (!facts.principalActive) {
      // The person left or lost every role: the binding goes with them, and this
      // message is cancelled rather than sent to a chat nobody answers for.
      await withTenantOrThrow(
        sql,
        tenantId,
        async (tx) => {
          const ended = await endBindings(
            tx,
            tenantId,
            { bindingId: entry.binding_id },
            "principal_deactivated"
          );

          await auditEndedBindings(
            tx,
            tenantId,
            ended,
            "principal_deactivated",
            {
              correlationId
            }
          );
          result.bindingsEnded += ended.ended.length;
        },
        { workClass: "background_sync" }
      );
      await terminal(
        "cancelled",
        retryCount,
        "principal_inactive",
        "The recipient is no longer an active member of staff."
      );
      result.cancelled += 1;

      return;
    }

    if (
      facts.lastSentAt &&
      facts.dbNow.getTime() - facts.lastSentAt.getTime() < perChatIntervalMs
    ) {
      // Less than a second since this chat was last messaged: leave the row for
      // the next pass instead of sleeping on it.
      const until = new Date(
        clock().getTime() +
          (perChatIntervalMs -
            (facts.dbNow.getTime() - facts.lastSentAt.getTime()))
      );

      await scheduleRetry(
        sql,
        tenantId,
        entry.id,
        retryCount,
        until,
        "chat_spacing",
        null,
        leaseUntil
      );
      result.deferred += 1;

      return;
    }

    // 4. The template must still be registered (a module may have been removed
    //    since enqueue); an unknown key is terminal, not retryable.
    if (!getTelegramTemplate(entry.template_key)) {
      const reason = "Template is no longer registered.";

      await recordDeliveryAttempt(
        sql,
        tenantId,
        entry.id,
        attemptNo,
        "failure",
        providerName,
        null,
        reason
      );
      await terminal("failed", retryCount + 1, "template_unknown", reason);
      result.failed += 1;

      return;
    }

    // 5. Decrypt the chat id in memory. A failure fails THIS message only and
    //    never falls back to anything: the usual cause is a ring misconfigured
    //    by an operator, which must not destroy every staff member's binding.
    let chatId: string;

    try {
      chatId = decryptChatId(
        facts.chatCiphertext,
        tenantId,
        entry.binding_id,
        encryptionRing as Extract<typeof encryptionRing, { ok: true }>
      );
    } catch {
      const reason = "The stored chat id could not be decrypted.";

      await recordDeliveryAttempt(
        sql,
        tenantId,
        entry.id,
        attemptNo,
        "failure",
        providerName,
        null,
        reason
      );
      await terminal("failed", retryCount + 1, "chat_undecryptable", reason);
      result.failed += 1;

      return;
    }

    // 6. SEND: outside any transaction.
    const sendResult = await provider.send({
      chatId,
      text: entry.body,
      templateKey: entry.template_key,
      correlationId: messageCorrelationId
    });

    if (sendResult.ok) {
      await recordDeliveryAttempt(
        sql,
        tenantId,
        entry.id,
        attemptNo,
        "success",
        providerName,
        sendResult.providerMessageId?.slice(0, MAX_RESPONSE_SNIPPET_LENGTH) ??
          null,
        null
      );
      await finalizeSent(
        sql,
        tenantId,
        entry,
        sendResult.providerMessageId,
        leaseUntil
      );

      log("info", "telegram.dispatch.sent", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: TELEGRAM_MODULE_KEY,
        templateKey: entry.template_key
      });
      result.sent += 1;

      return;
    }

    const safeError = sanitizeProviderError(sendResult.error, entry, token);

    if (sendResult.retryAfterSeconds !== undefined) {
      // 429: Telegram's own delay, bounded, not an exponential, and not charged to
      // the retry budget (a rate limit is not this message's fault). No attempt
      // row either: the message was never accepted or rejected.
      const seconds = Math.min(
        Math.max(1, sendResult.retryAfterSeconds),
        retryAfterCapSeconds
      );
      const until = new Date(clock().getTime() + seconds * 1000);

      await scheduleRetry(
        sql,
        tenantId,
        entry.id,
        retryCount,
        until,
        "rate_limited",
        safeError,
        leaseUntil
      );
      rateLimitedUntil = until;
      result.rateLimited += 1;
      log("warning", "telegram.dispatch.rate_limited", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: TELEGRAM_MODULE_KEY,
        retryAfterSeconds: seconds
      });

      return;
    }

    await recordDeliveryAttempt(
      sql,
      tenantId,
      entry.id,
      attemptNo,
      "failure",
      providerName,
      safeError,
      safeError
    );

    if (sendResult.bindingUnreachable) {
      // 403 (blocked, user deleted) or "chat not found": the binding is dead, not
      // the message. Suspend it (ciphertext erased), cancel the rest of its queue,
      // never retry.
      await withTenantOrThrow(
        sql,
        tenantId,
        async (tx) => {
          const ended = await endBindings(
            tx,
            tenantId,
            { bindingId: entry.binding_id },
            "provider_blocked",
            { status: "suspended" }
          );

          await auditEndedBindings(tx, tenantId, ended, "provider_blocked", {
            correlationId
          });
          result.bindingsEnded += ended.ended.length;
        },
        { workClass: "background_sync" }
      );
      await terminal(
        "failed",
        retryCount + 1,
        sendResult.failureCode,
        safeError
      );
      result.failed += 1;

      return;
    }

    const retry = sendResult.retryable
      ? evaluateTelegramRetry(retryCount, maxRetries, now)
      : { eligible: false as const };

    if (retry.eligible && retry.nextAttemptAt) {
      // Backoff counts from the real clock, not the pass's start.
      const delay = retry.nextAttemptAt.getTime() - now.getTime();

      await scheduleRetry(
        sql,
        tenantId,
        entry.id,
        retryCount + 1,
        new Date(clock().getTime() + delay),
        sendResult.failureCode,
        safeError,
        leaseUntil
      );
      log("warning", "telegram.dispatch.retry_scheduled", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: TELEGRAM_MODULE_KEY,
        templateKey: entry.template_key,
        retryCount: retryCount + 1,
        failureCode: sendResult.failureCode
      });
      result.retried += 1;

      return;
    }

    await terminal("failed", retryCount + 1, sendResult.failureCode, safeError);
    log("error", "telegram.dispatch.failed", {
      correlationId: messageCorrelationId,
      tenantId,
      moduleKey: TELEGRAM_MODULE_KEY,
      templateKey: entry.template_key,
      failureCode: sendResult.failureCode
    });
    result.failed += 1;
  }
}
