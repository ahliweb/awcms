/**
 * Internal push dispatcher (Issue #465, epic #463, ADR-0074). NOT a public HTTP
 * endpoint — the same "trusted internal worker only" boundary as
 * `email/application/email-dispatch.ts` and
 * `sync-storage/application/object-dispatch.ts`. Invoked by
 * `scripts/push-dispatch.ts`, one tenant at a time.
 *
 * Three-phase pattern (ADR-0006 — never call a provider inside a DB
 * transaction), copied from `email-dispatch.ts` rather than reinvented:
 *
 * 1. CLAIM — one short transaction flips eligible `queued`/`retry_wait` rows to
 *    a transient `sending` (`FOR UPDATE SKIP LOCKED`), reusing
 *    `next_attempt_at` as the claim lease expiry. No new column: the same reuse
 *    `sql/014` and `object-dispatch.ts` established. The lease is READABLE, not
 *    write-only — a `sending` row whose lease has expired is re-claimed by a
 *    later pass, which is what keeps a worker that died mid-flight from
 *    stranding rows in permanent limbo (Issue #143).
 * 2. SEND — resolves the delivery target and calls the `PushProvider` OUTSIDE
 *    any transaction.
 * 3. FINALIZE — one short transaction per row: `sent`, or `retry_wait` with
 *    backoff, or terminal `failed`. Every attempt is recorded.
 *
 * The accepted trade-off is identical to its two siblings': a crash in the
 * narrow window after the provider accepted but before FINALIZE can produce one
 * duplicate notification. For a push that is a repeated banner, which is
 * strictly better than a notification stuck forever.
 *
 * ## The one thing this dispatcher does that email's does not
 *
 * It can DISABLE its target. A push service answering `404`/`410`, or FCM
 * answering `UNREGISTERED`, is not a delivery failure and not a provider
 * outage: it is the subscription reporting that it is dead. Retrying it wastes
 * the budget; failing it silently leaves a tombstone endpoint that collects one
 * permanent failure per message forever. So `subscriptionGone` is its own
 * result branch, and it takes the subscription out of every future fan-out.
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import {
  PUSH_CIRCUIT_BREAKER_KEY,
  isPushEnabled,
  resolvePushSendMaxRetries
} from "../domain/push-config";
import { evaluatePushRetry } from "../domain/push-retry";
import type { PushProvider } from "../domain/push-provider-contract";
import { resolvePushProvider } from "../infrastructure/push-provider-resolver";
import {
  disablePushSubscription,
  fetchDeliveryTarget,
  markSubscriptionDelivered
} from "./subscription-directory";

const MODULE_KEY = "push_delivery";

export const PUSH_DISPATCH_DEFAULT_LIMIT = 50;
export const PUSH_DISPATCH_LEASE_MINUTES = 2;
const MAX_RESPONSE_SNIPPET_LENGTH = 500;

type ClaimedRow = {
  id: string;
  correlation_id: string | null;
  category: string;
  subscription_id: string;
  title: string;
  body: string;
  target_path: string | null;
  data: Record<string, string> | null;
  retry_count: string | number;
};

export type DispatchPushQueueOptions = {
  limit?: number;
  now?: Date;
  correlationId?: string;
  resolveProvider?: (env?: NodeJS.ProcessEnv) => PushProvider;
  env?: NodeJS.ProcessEnv;
};

export type DispatchPushQueueResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  /** Rows whose subscription the push service reported gone. Counted apart from `failed` because it is not an error to chase. */
  subscriptionsDisabled: number;
  breakerOpen: boolean;
};

/**
 * The claim predicate MIRRORS the lease it writes (Issue #143). A worker that
 * dies between CLAIM and FINALIZE leaves the row `sending`; since every
 * finalize is guarded by `status = 'sending'` and `cancelPushMessage` refuses
 * `sending`, such a row would be unsendable, uncancellable, and unretryable
 * without the `OR (status = 'sending' AND next_attempt_at <= now)` arm.
 */
async function claimEligibleMessages(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  limit: number
): Promise<ClaimedRow[]> {
  const leaseExpiry = new Date(
    now.getTime() + PUSH_DISPATCH_LEASE_MINUTES * 60_000
  );

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = await tx`
        UPDATE awcms_push_messages
        SET status = 'sending', next_attempt_at = ${leaseExpiry},
            updated_at = now()
        WHERE id IN (
          SELECT id FROM awcms_push_messages
          WHERE tenant_id = ${tenantId}
            AND (
              (status IN ('queued', 'retry_wait')
                AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
              OR (status = 'sending' AND next_attempt_at <= ${now})
            )
          ORDER BY
            CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
            created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id, correlation_id, category, subscription_id, title, body,
                  target_path, data, retry_count
      `;

      return rows as unknown as ClaimedRow[];
    },
    { workClass: "background_sync" }
  );
}

/**
 * `ON CONFLICT DO NOTHING` is required by the expired-lease re-claim above: a
 * crash after this insert but before FINALIZE leaves `retry_count` untouched,
 * so the re-claiming pass computes the same `attempt_no`. An unhandled 23505
 * would abort the whole pass and take the other claimed messages with it.
 */
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
      INSERT INTO awcms_push_delivery_attempts
        (tenant_id, message_id, attempt_no, outcome, provider_name,
         provider_response_snippet, error_message)
      VALUES (
        ${tenantId}, ${messageId}, ${attemptNo}, ${outcome}, ${providerName},
        ${snippet}, ${errorMessage}
      )
      ON CONFLICT ON CONSTRAINT awcms_push_delivery_attempts_unique_attempt
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
  now: Date
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      await tx`
        UPDATE awcms_push_messages
        SET status = 'sent', sent_at = now(), next_attempt_at = null,
            updated_at = now(), provider_name = ${providerName},
            provider_message_id = ${providerMessageId ?? null}
        WHERE tenant_id = ${tenantId} AND id = ${row.id}
          AND status = 'sending'
      `;

      await markSubscriptionDelivered(tx, tenantId, row.subscription_id, now);
    },
    { workClass: "background_sync" }
  );
}

async function finalizeFailure(
  sql: Bun.SQL,
  tenantId: string,
  messageId: string,
  currentRetryCount: number,
  maxRetries: number,
  retryable: boolean,
  now: Date,
  errorMessage: string
): Promise<{ eligible: boolean }> {
  const evaluation = retryable
    ? evaluatePushRetry(currentRetryCount, maxRetries, now)
    : { eligible: false as const };

  if (evaluation.eligible) {
    await withTenantOrThrow(
      sql,
      tenantId,
      (tx) => tx`
        UPDATE awcms_push_messages
        SET status = 'retry_wait', retry_count = ${currentRetryCount + 1},
            next_attempt_at = ${evaluation.nextAttemptAt},
            last_error = ${errorMessage}, updated_at = now()
        WHERE tenant_id = ${tenantId} AND id = ${messageId}
          AND status = 'sending'
      `,
      { workClass: "background_sync" }
    );

    return { eligible: true };
  }

  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_push_messages
      SET status = 'failed', retry_count = ${currentRetryCount + 1},
          next_attempt_at = null, last_error = ${errorMessage},
          updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${messageId}
        AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );

  return { eligible: false };
}

/**
 * Dispatches one batch of due `awcms_push_messages` rows for a single tenant.
 * Safe to call repeatedly (claim-lease pattern); the CLI loops per tenant to
 * drain a larger backlog.
 */
export async function dispatchPushQueue(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchPushQueueOptions = {}
): Promise<DispatchPushQueueResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const limit = options.limit ?? PUSH_DISPATCH_DEFAULT_LIMIT;
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const maxRetries = resolvePushSendMaxRetries(env);
  const breaker = getProviderCircuitBreaker(PUSH_CIRCUIT_BREAKER_KEY);
  const breakerOpen = !breaker.canAttempt(now);

  const result: DispatchPushQueueResult = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    subscriptionsDisabled: 0,
    breakerOpen
  };

  // Feature-flag rule: off means the provider is never touched AND nothing is
  // claimed, so a disabled deployment can never accumulate rows stranded in
  // `sending` limbo.
  if (!isPushEnabled(env)) {
    return result;
  }

  if (breakerOpen) {
    log("warning", "push.dispatch.breaker_open", {
      correlationId,
      tenantId,
      moduleKey: MODULE_KEY
    });

    return result;
  }

  const claimed = await claimEligibleMessages(sql, tenantId, now, limit);
  result.claimed = claimed.length;

  if (claimed.length === 0) {
    return result;
  }

  const provider = (options.resolveProvider ?? resolvePushProvider)(env);
  const providerName = env.PUSH_PROVIDER ?? "unknown";

  log("info", "push.dispatch.claimed", {
    correlationId,
    tenantId,
    moduleKey: MODULE_KEY,
    count: claimed.length
  });

  for (const entry of claimed) {
    const retryCount = Number(entry.retry_count);
    const attemptNo = retryCount + 1;
    const messageCorrelationId = entry.correlation_id ?? correlationId;

    const target = await withTenantOrThrow(
      sql,
      tenantId,
      (tx) => fetchDeliveryTarget(tx, tenantId, entry.subscription_id),
      { workClass: "background_sync" }
    );

    if (!target) {
      const reason = "Subscription is no longer active.";

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
      await finalizeFailure(
        sql,
        tenantId,
        entry.id,
        retryCount,
        maxRetries,
        false,
        now,
        reason
      );
      result.failed += 1;
      continue;
    }

    if (!provider.supportedTransports.includes(target.transport)) {
      // Checked here rather than discovered at the wire: a `web_push` row under
      // `PUSH_PROVIDER=fcm` is a configuration mismatch, and burning retries on
      // it would hide that behind an exhausted retry count.
      const reason = `Configured provider cannot deliver transport '${target.transport}'.`;

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
      await finalizeFailure(
        sql,
        tenantId,
        entry.id,
        retryCount,
        maxRetries,
        false,
        now,
        reason
      );
      result.failed += 1;
      continue;
    }

    const deliveryResult = await provider.send(target, {
      title: entry.title,
      body: entry.body,
      ...(entry.target_path ? { targetPath: entry.target_path } : {}),
      ...(entry.data ? { data: entry.data } : {}),
      correlationId: messageCorrelationId
    });

    if (deliveryResult.ok) {
      await recordDeliveryAttempt(
        sql,
        tenantId,
        entry.id,
        attemptNo,
        "success",
        providerName,
        deliveryResult.providerMessageId?.slice(
          0,
          MAX_RESPONSE_SNIPPET_LENGTH
        ) ?? null,
        null
      );
      await finalizeSent(
        sql,
        tenantId,
        entry,
        providerName,
        deliveryResult.providerMessageId,
        now
      );

      log("info", "push.dispatch.sent", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category
      });
      result.sent += 1;
      continue;
    }

    const safeError = deliveryResult.error.slice(
      0,
      MAX_RESPONSE_SNIPPET_LENGTH
    );

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

    if (deliveryResult.subscriptionGone) {
      await withTenantOrThrow(
        sql,
        tenantId,
        (tx) =>
          disablePushSubscription(
            tx,
            tenantId,
            entry.subscription_id,
            safeError
          ),
        { workClass: "background_sync" }
      );

      // Terminal for this row and every future one aimed at this target — the
      // subscription is out of the fan-out from here on.
      await finalizeFailure(
        sql,
        tenantId,
        entry.id,
        retryCount,
        maxRetries,
        false,
        now,
        safeError
      );
      result.subscriptionsDisabled += 1;
      continue;
    }

    const finalized = await finalizeFailure(
      sql,
      tenantId,
      entry.id,
      retryCount,
      maxRetries,
      deliveryResult.retryable,
      now,
      safeError
    );

    if (finalized.eligible) {
      log("warning", "push.dispatch.retry_scheduled", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        retryCount: retryCount + 1,
        error: safeError
      });
      result.retried += 1;
    } else {
      log("error", "push.dispatch.failed", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        retryCount: retryCount + 1,
        error: safeError
      });
      result.failed += 1;
    }
  }

  return result;
}
