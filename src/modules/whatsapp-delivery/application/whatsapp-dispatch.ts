/**
 * Internal WhatsApp dispatcher (Issue #963, ADR-0133 sections 3 and 5). NOT a
 * public HTTP endpoint: invoked by `scripts/whatsapp-dispatch.ts`, one tenant at
 * a time, the same "trusted internal worker only" boundary as the email and
 * push dispatchers it copies.
 *
 * Three phases (ADR-0006 — never call a provider inside a DB transaction):
 *
 * 1. CLAIM — one short transaction flips due `queued`/`retry_wait` rows to a
 *    transient `sending` (`FOR UPDATE SKIP LOCKED`), reusing `next_attempt_at`
 *    as the claim lease expiry. A `sending` row whose lease has passed is
 *    re-claimed, which is what keeps a worker that died mid-flight from
 *    stranding rows.
 * 2. SEND — re-checks expiry and eligibility, then calls the `WhatsappProvider`
 *    OUTSIDE any transaction.
 * 3. FINALISE — one short transaction per row: `sent`, `retry_wait` with
 *    backoff, or a terminal state. Every attempt is recorded.
 *
 * At-least-once to the provider is accepted (ADR-0133 section 5.5): a crash in
 * the window after the provider accepted but before FINALISE can resend, and the
 * recorded provider message id lets reconciliation detect it.
 *
 * ## Two re-checks that happen at dispatch, not only at enqueue
 *
 * - EXPIRY: a message past `expires_at` is `expired`, not retried late. An OTP
 *   that arrives after its validity is worse than none.
 * - ELIGIBILITY: suppression and marketing consent are read again immediately
 *   before the send, so a withdrawal that landed after enqueue still stops the
 *   message even if it was claimed a moment earlier.
 *
 * ## One owner per row: the lease is renewed and checked per row (audit F2)
 *
 * The claim lease must outlive the WHOLE batch (`limit` x the provider timeout),
 * otherwise a slow pass lets another worker re-claim a row this one has not
 * reached yet, and an OTP is sent twice. So the claim lease is sized from the
 * batch, and immediately before each row this pass renews it to a short lease
 * and VERIFIES it still holds (`status = 'sending' AND next_attempt_at > now`);
 * zero rows updated means the lease was lost and the row is skipped, never sent.
 * Finalisation is guarded by the exact lease value this pass wrote, so a
 * reclaiming worker (which writes a different value) can never be overwritten.
 *
 * A re-claim of an expired `sending` row bumps `retry_count`, and a row whose
 * count has passed the retry cap is failed instead of sent, so a poison pill that
 * crashes the worker every time reaches `failed` rather than looping forever. A
 * throw while processing one row fails THAT row, not the pass.
 *
 * ## Secrets
 *
 * A row marked `contains_secret` has `body` and `variables` overwritten when it
 * reaches ANY terminal state. The provider receives the body in memory from the
 * claimed row; the attempt ledger, audit, logs and events never carry it.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import {
  WHATSAPP_CIRCUIT_BREAKER_KEY,
  isWhatsappEnabled,
  resolveWhatsappSendMaxRetries,
  resolveWhatsappSendTimeoutMs
} from "../domain/whatsapp-config";
import { decideEligibility } from "../domain/whatsapp-eligibility";
import {
  WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE,
  WHATSAPP_MESSAGE_FAILED_EVENT_TYPE,
  WHATSAPP_MESSAGE_SENT_EVENT_TYPE
} from "../domain/whatsapp-events";
import type { WhatsappProvider } from "../domain/whatsapp-provider-contract";
import { evaluateWhatsappRetry } from "../domain/whatsapp-retry";
import { getWhatsappTemplate } from "../domain/whatsapp-templates";
import { resolveWhatsappProvider } from "../infrastructure/whatsapp-provider-resolver";
import {
  buildRecipientHashes,
  parseRecipientHashKeys,
  type RecipientKeyRing
} from "../domain/whatsapp-recipient";
import {
  readEligibilityFacts,
  recordHardFailureSuppression
} from "./whatsapp-consent-directory";
import {
  emitWhatsappDispatchFailedEvent,
  emitWhatsappMessageEvent
} from "./whatsapp-event-emit";

const MODULE_KEY = "whatsapp_delivery";

export const WHATSAPP_DISPATCH_DEFAULT_LIMIT = 50;
/** The SHORT per-row lease, written immediately before each row is processed. */
export const WHATSAPP_DISPATCH_LEASE_MINUTES = 2;
const MAX_RESPONSE_SNIPPET_LENGTH = 500;

type ClaimedRow = {
  id: string;
  correlation_id: string | null;
  template_key: string;
  purpose: string;
  recipient: string;
  recipient_hash: string;
  recipient_masked: string;
  body: string;
  variables: Record<string, string> | null;
  contains_secret: boolean;
  expires_at: Date | string | null;
  retry_count: string | number;
  created_at: Date | string;
};

export type DispatchWhatsappQueueOptions = {
  limit?: number;
  now?: Date;
  correlationId?: string;
  resolveProvider?: (env?: NodeJS.ProcessEnv) => WhatsappProvider;
  env?: NodeJS.ProcessEnv;
};

export type DispatchWhatsappQueueResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  expired: number;
  /** Cancelled at dispatch because the recipient became suppressed or lost consent. */
  cancelled: number;
  /** Numbers the provider reported as unable to receive WhatsApp; now hard-failure suppressed. */
  recipientsSuppressed: number;
  /** Rows skipped because this pass no longer owned their lease (another worker re-claimed them). Never sent by this pass. */
  leaseLost: number;
  breakerOpen: boolean;
};

type Terminal = "failed" | "expired" | "cancelled";

/**
 * The claim predicate MIRRORS the lease it writes: a worker that dies between
 * CLAIM and FINALISE leaves the row `sending`, and every finalise is guarded by
 * `status = 'sending'`, so without the `OR (status = 'sending' AND
 * next_attempt_at <= now)` arm such a row would be unsendable, uncancellable and
 * unretryable.
 */
async function claimEligibleMessages(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  limit: number,
  leaseMs: number
): Promise<ClaimedRow[]> {
  const leaseExpiry = new Date(now.getTime() + leaseMs);

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = await tx`
        UPDATE awcms_whatsapp_messages
        SET status = 'sending', next_attempt_at = ${leaseExpiry},
            -- Re-claiming an EXPIRED sending row is a failed attempt: count it,
            -- so a poison pill reaches the retry cap instead of looping.
            retry_count = retry_count
              + CASE WHEN status = 'sending' THEN 1 ELSE 0 END,
            updated_at = now()
        WHERE id IN (
          SELECT id FROM awcms_whatsapp_messages
          WHERE tenant_id = ${tenantId}
            AND (
              (status IN ('queued', 'retry_wait')
                AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
              OR (status = 'sending' AND next_attempt_at <= ${now})
            )
          ORDER BY
            CASE purpose WHEN 'security' THEN 0 WHEN 'transactional' THEN 1
                         ELSE 2 END,
            created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, correlation_id, template_key, purpose, recipient,
                  recipient_hash, recipient_masked, body, variables,
                  contains_secret, expires_at, retry_count, created_at
      `;

      // `UPDATE ... RETURNING` does not preserve the sub-select's ORDER BY, so
      // the priority order (security first, then oldest first) is applied here.
      const rank = (purpose: string) =>
        purpose === "security" ? 0 : purpose === "transactional" ? 1 : 2;

      return (rows as unknown as ClaimedRow[]).sort(
        (a, b) =>
          rank(a.purpose) - rank(b.purpose) ||
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
    at.getTime() + WHATSAPP_DISPATCH_LEASE_MINUTES * 60_000
  );
  const rows = await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_whatsapp_messages
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
 * Provider text is stored, logged and shown to operators, and a provider may
 * echo what it was sent (audit F6). A row that carries a secret keeps NO provider
 * detail at all; any other row has the exact values of its own body and
 * variables redacted first.
 */
export function sanitizeProviderError(
  error: string,
  row: Pick<ClaimedRow, "body" | "variables" | "contains_secret">,
  failureCode: string
): string {
  if (row.contains_secret) {
    return `Provider reported ${failureCode}.`;
  }

  let text = error;
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
      INSERT INTO awcms_whatsapp_delivery_attempts
        (tenant_id, message_id, attempt_no, outcome, provider_name,
         provider_response_snippet, error_message)
      VALUES (${tenantId}, ${messageId}, ${attemptNo}, ${outcome},
              ${providerName}, ${snippet}, ${errorMessage})
      ON CONFLICT ON CONSTRAINT awcms_whatsapp_delivery_attempts_unique_attempt
      DO NOTHING
    `,
    { workClass: "background_sync" }
  );
}

async function finalizeSent(
  sql: Bun.SQL,
  tenantId: string,
  row: ClaimedRow,
  providerName: string,
  providerMessageId: string | undefined,
  leaseUntil: Date
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const updated = (await tx`
        UPDATE awcms_whatsapp_messages
        SET status = 'sent', sent_at = now(), next_attempt_at = NULL,
            updated_at = now(), provider_name = ${providerName},
            provider_message_id = ${providerMessageId ?? null},
            body = CASE WHEN contains_secret THEN '' ELSE body END,
            variables = CASE WHEN contains_secret THEN '{}'::jsonb
                             ELSE variables END
        WHERE tenant_id = ${tenantId} AND id = ${row.id} AND status = 'sending'
          AND next_attempt_at = ${leaseUntil}
        RETURNING id
      `) as { id: string }[];

      if (updated.length === 0) {
        // The provider already accepted it; the row moved on (cancelled, or
        // re-claimed after a lease loss). Never overwrite another owner.
        log("warning", "whatsapp.dispatch.finalize_lost", {
          tenantId,
          moduleKey: MODULE_KEY,
          templateKey: row.template_key
        });
      }

      if (updated.length > 0) {
        await emitWhatsappMessageEvent(
          tx,
          tenantId,
          WHATSAPP_MESSAGE_SENT_EVENT_TYPE,
          {
            messageId: row.id,
            templateKey: row.template_key,
            purpose: row.purpose,
            recipientMasked: row.recipient_masked,
            status: "sent",
            correlationId: row.correlation_id
          }
        );
      }
    },
    { workClass: "background_sync" }
  );
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
    async (tx) => {
      const updated = (await tx`
        UPDATE awcms_whatsapp_messages
        SET status = ${status}, retry_count = ${retryCount},
            next_attempt_at = NULL, failure_code = ${failureCode},
            last_error = ${errorMessage}, updated_at = now(),
            body = CASE WHEN contains_secret THEN '' ELSE body END,
            variables = CASE WHEN contains_secret THEN '{}'::jsonb
                             ELSE variables END
        WHERE tenant_id = ${tenantId} AND id = ${row.id} AND status = 'sending'
          AND next_attempt_at = ${leaseUntil}
        RETURNING id
      `) as { id: string }[];

      // `cancelled` here is a dispatch-time policy outcome (suppressed or
      // consent withdrawn), already represented by the consent/suppression
      // event or audit row that caused it; it has no message event of its own.
      if (updated.length > 0 && status !== "cancelled") {
        await emitWhatsappMessageEvent(
          tx,
          tenantId,
          status === "expired"
            ? WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE
            : WHATSAPP_MESSAGE_FAILED_EVENT_TYPE,
          {
            messageId: row.id,
            templateKey: row.template_key,
            purpose: row.purpose,
            recipientMasked: row.recipient_masked,
            status,
            failureCode,
            correlationId: row.correlation_id
          }
        );
      }
    },
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
  errorMessage: string,
  leaseUntil: Date
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_whatsapp_messages
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
 * Dispatches one batch of due `awcms_whatsapp_messages` rows for ONE tenant.
 * Safe to call repeatedly (claim-lease pattern); the CLI loops per tenant.
 */
export async function dispatchWhatsappQueue(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchWhatsappQueueOptions = {}
): Promise<DispatchWhatsappQueueResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const limit = options.limit ?? WHATSAPP_DISPATCH_DEFAULT_LIMIT;
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const maxRetries = resolveWhatsappSendMaxRetries(env);
  const breaker = getProviderCircuitBreaker(WHATSAPP_CIRCUIT_BREAKER_KEY);
  const breakerOpen = !breaker.canAttempt(now);

  const result: DispatchWhatsappQueueResult = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    expired: 0,
    cancelled: 0,
    recipientsSuppressed: 0,
    leaseLost: 0,
    breakerOpen
  };

  // Feature-flag rule: off means the provider is never touched AND nothing is
  // claimed, so a disabled deployment cannot strand rows in `sending` limbo.
  if (!isWhatsappEnabled(env)) {
    return result;
  }

  if (breakerOpen) {
    log("warning", "whatsapp.dispatch.breaker_open", {
      correlationId,
      tenantId,
      moduleKey: MODULE_KEY
    });

    return result;
  }

  // Fail closed: eligibility is read by recipient hash, and without the key ring
  // no hash can be computed. Claiming rows we cannot check would either send to
  // a suppressed number or strand rows in `sending`.
  const ring = parseRecipientHashKeys(env);

  if (!ring.ok) {
    log("error", "whatsapp.dispatch.hash_keys_unavailable", {
      correlationId,
      tenantId,
      moduleKey: MODULE_KEY
    });

    return result;
  }

  // The claim lease must outlive the whole batch (see the header): `limit` rows
  // at the worst-case provider timeout, plus a margin.
  const startedAt = Date.now();
  const clock = () => new Date(now.getTime() + (Date.now() - startedAt));
  const claimLeaseMs =
    limit * resolveWhatsappSendTimeoutMs(env) +
    WHATSAPP_DISPATCH_LEASE_MINUTES * 60_000;
  const claimed = await claimEligibleMessages(
    sql,
    tenantId,
    now,
    limit,
    claimLeaseMs
  );
  result.claimed = claimed.length;

  if (claimed.length === 0) {
    return result;
  }

  const provider = (options.resolveProvider ?? resolveWhatsappProvider)(env);
  const providerName = env.WHATSAPP_PROVIDER ?? "unknown";

  log("info", "whatsapp.dispatch.claimed", {
    correlationId,
    tenantId,
    moduleKey: MODULE_KEY,
    count: claimed.length
  });

  for (const entry of claimed) {
    const owned: { lease: Date | null } = { lease: null };

    try {
      await processRow(entry, owned);
    } catch (error) {
      // One bad row must not take the pass (and every other claimed row) with
      // it. Fail THIS row, only if this pass still owns it.
      log("error", "whatsapp.dispatch.row_error", {
        correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
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

    // 0. Renew and VERIFY the lease before anything else (audit F2).
    const leaseUntil = await renewLease(sql, tenantId, entry.id, clock());

    if (!leaseUntil) {
      log("warning", "whatsapp.dispatch.lease_lost", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
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
    if (
      entry.expires_at &&
      new Date(entry.expires_at).getTime() <= clock().getTime()
    ) {
      await terminal(
        "expired",
        retryCount,
        "expired",
        "Message passed its expiry before it was sent."
      );
      result.expired += 1;

      return;
    }

    // 3. Eligibility, read again immediately before the send, under EVERY ring key.
    const hashes = buildRecipientHashes(
      tenantId,
      entry.recipient,
      ring as Extract<RecipientKeyRing, { ok: true }>
    );
    const decision = decideEligibility(
      entry.purpose as "transactional" | "security" | "marketing",
      await withTenantOrThrow(
        sql,
        tenantId,
        (tx) => readEligibilityFacts(tx, tenantId, hashes),
        { workClass: "background_sync" }
      )
    );

    if (!decision.eligible) {
      const code =
        decision.kind === "consent_required"
          ? "consent_required"
          : decision.reason === "hard_failure"
            ? "suppressed"
            : "consent_withdrawn";

      await terminal(
        "cancelled",
        retryCount,
        code,
        "Recipient is no longer eligible to receive this message."
      );
      result.cancelled += 1;

      return;
    }

    // 4. The template must still be registered (a module may have been removed
    //    since enqueue); an unknown key is terminal, not retryable.
    const template = getWhatsappTemplate(entry.template_key);

    if (!template) {
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

    const variables = entry.variables ?? {};

    // 5. SEND — outside any transaction.
    const sendResult = await provider.send({
      to: entry.recipient,
      toMasked: entry.recipient_masked,
      body: entry.body,
      templateKey: entry.template_key,
      ...(template.providerTemplate
        ? { providerTemplate: template.providerTemplate }
        : {}),
      parameters: template.variables.map((name) => variables[name] ?? ""),
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
        providerName,
        sendResult.providerMessageId,
        leaseUntil
      );

      log("info", "whatsapp.dispatch.sent", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        templateKey: entry.template_key,
        recipient: entry.recipient_masked
      });
      result.sent += 1;

      return;
    }

    const safeError = sanitizeProviderError(
      sendResult.error,
      entry,
      sendResult.failureCode
    ).slice(0, MAX_RESPONSE_SNIPPET_LENGTH);

    await recordDeliveryAttempt(
      sql,
      tenantId,
      entry.id,
      attemptNo,
      "failure",
      providerName,
      entry.contains_secret ? null : safeError,
      safeError
    );

    if (sendResult.recipientInvalid) {
      // Not a delivery failure to retry and not an outage: the provider says
      // this number cannot receive WhatsApp. Suppress it so nothing else is
      // queued to it, and fail this row terminally.
      await withTenantOrThrow(
        sql,
        tenantId,
        (tx) =>
          recordHardFailureSuppression(
            tx,
            tenantId,
            hashes,
            entry.recipient_masked
          ),
        { workClass: "background_sync" }
      );
      await terminal(
        "failed",
        retryCount + 1,
        sendResult.failureCode,
        safeError
      );
      result.recipientsSuppressed += 1;
      result.failed += 1;

      return;
    }

    const retry = sendResult.retryable
      ? evaluateWhatsappRetry(retryCount, maxRetries, now)
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
      log("warning", "whatsapp.dispatch.retry_scheduled", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        templateKey: entry.template_key,
        retryCount: retryCount + 1,
        failureCode: sendResult.failureCode
      });
      result.retried += 1;

      return;
    }

    await terminal("failed", retryCount + 1, sendResult.failureCode, safeError);
    log("error", "whatsapp.dispatch.failed", {
      correlationId: messageCorrelationId,
      tenantId,
      moduleKey: MODULE_KEY,
      templateKey: entry.template_key,
      failureCode: sendResult.failureCode
    });
    result.failed += 1;

    return;
  }
}

/**
 * Job-level failure: a dispatcher pass that threw as a whole (not one message).
 * Records the `whatsapp.dispatch.failed` event in its own short transaction so
 * the failure is observable even though the pass itself aborted.
 */
export async function recordWhatsappDispatchFailure(
  sql: Bun.SQL,
  tenantId: string,
  failureCode: string,
  now: Date = new Date()
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) =>
      emitWhatsappDispatchFailedEvent(tx, tenantId, {
        failureCode,
        occurredAt: now
      }),
    { workClass: "background_sync" }
  );
}
