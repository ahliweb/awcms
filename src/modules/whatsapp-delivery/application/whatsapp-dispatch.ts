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
 * ## Sender lanes: fair claiming, per-sender breaker and quota (Issue #1141)
 *
 * The one queue holds rows of several senders (`sender_account_id`; NULL is the
 * deployment sender, today's behaviour). A pass discovers the senders that have
 * due rows and serves each as its own LANE, oldest-waiting lane first, claiming
 * at most `limit / lanes` rows per lane, so one stalled or throttled number can
 * never starve the others. Each lane has its own circuit breaker (the
 * deployment lane keeps `WHATSAPP_CIRCUIT_BREAKER_KEY`), its own hourly and
 * daily cap counted from what it really sent, and its own provider adapter and
 * credential, resolved from THAT sender's record in THIS tenant
 * (`ChannelAccountPort`, `ChannelSenderCredentialPort`), in memory, once per
 * lane per pass, never from a request. Revocation therefore takes effect on the
 * next claim.
 *
 * A sender that cannot send now never sends through anything else:
 *
 * - revoked, disabled, disconnected, unapproved, another tenant's, or a provider
 *   with no adapter: the row is `failed` with `sender_unavailable` (terminal);
 * - degraded, pending, a token awaiting refresh, no key ring, the control plane
 *   switched off: the lane is HELD (rows stay waiting, nothing is claimed);
 * - an open per-sender breaker or a reached cap: the lane waits.
 *
 * There is no rotation to another number to escape a limit, a quality rating or
 * a failure (ADR-0148 I4, I5).
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
import type {
  ChannelAccountPort,
  ChannelSenderCredentialPort,
  ResolveWhatsappSenderResult,
  WhatsappSenderCapability
} from "../../_shared/ports/channel-account-port";
import {
  WHATSAPP_CIRCUIT_BREAKER_KEY,
  isWhatsappEnabled,
  resolveWhatsappSendMaxRetries,
  resolveWhatsappSendTimeoutMs,
  whatsappSenderBreakerKey
} from "../domain/whatsapp-config";
import { decideEligibility } from "../domain/whatsapp-eligibility";
import {
  WHATSAPP_MESSAGE_EXPIRED_EVENT_TYPE,
  WHATSAPP_MESSAGE_FAILED_EVENT_TYPE,
  WHATSAPP_MESSAGE_SENT_EVENT_TYPE
} from "../domain/whatsapp-events";
import type { WhatsappProvider } from "../domain/whatsapp-provider-contract";
import { evaluateWhatsappRetry } from "../domain/whatsapp-retry";
import {
  SENDER_UNAVAILABLE_FAILURE_CODE,
  capabilityForSend,
  classifySenderUnavailable,
  senderScopeAllows
} from "../domain/whatsapp-sender";
import { getWhatsappTemplate } from "../domain/whatsapp-templates";
import { loadChannelAccountPort } from "../infrastructure/channel-account-port-loader";
import { resolveWhatsappProvider } from "../infrastructure/whatsapp-provider-resolver";
import {
  buildWhatsappSenderProvider,
  isWhatsappMetaApiVersionValid,
  type BuildSenderProviderInput
} from "../infrastructure/whatsapp-sender-providers";
import { senderAllowance } from "./whatsapp-sender-directory";
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

/** How long a row is parked when its sender cannot send for a reason that is not the message's own (the lane is HELD). */
const SENDER_HOLD_MS = 5 * 60_000;
/** Holds that COUNT an attempt and end in a terminal failure, not an indefinite wait (Issue #1233 L1). */
const BOUNDED_HOLD_REASONS: ReadonlySet<string> = new Set([
  "CREDENTIAL_REJECTED",
  "PROVIDER_CONFIG_INVALID"
]);
/** Most lanes one pass serves; the oldest-waiting come first, so a lane past this limit is served by the next pass, not starved. */
const MAX_LANES_PER_PASS = 64;

type ClaimedRow = {
  id: string;
  sender_account_id: string | null;
  sender_selection: string;
  business_scope_type: string | null;
  business_scope_id: string | null;
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
  /** The DEPLOYMENT sender's provider (`senderAccountId = null`). Unchanged. */
  resolveProvider?: (env?: NodeJS.ProcessEnv) => WhatsappProvider;
  env?: NodeJS.ProcessEnv;
  /** Issue #1141. Resolves a tenant-owned sender (no secret). Omitted: the `channel_accounts` adapter, loaded lazily. */
  senders?: ChannelAccountPort;
  /** Issue #1141. Decrypts a sender's credential, in memory, per lane. Supplied ONLY by the dispatcher's composition root; omitted, every tenant-owned sender lane is held (fail closed). */
  credentials?: ChannelSenderCredentialPort;
  /** Issue #1141. A test seam for the sender adapter factory (no network). */
  buildSenderProvider?: (
    input: BuildSenderProviderInput
  ) => WhatsappProvider | null;
};

/** What one pass did for one sender. `senderAccountId` is `null` for the deployment sender. */
export type WhatsappSenderPassSummary = {
  senderAccountId: string | null;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  /** Rows parked this pass (their lane's sender could not send for a reason that is not theirs). */
  held: number;
  /** Why the lane was not served: `breaker_open`, `quota_reached`, or the sender-unavailable reason code. */
  skipped: string | null;
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
  /** Issue #1141. Rows parked because their sender could not send now (never sent through another sender). */
  held: number;
  /** The DEPLOYMENT sender's breaker (unchanged meaning). A tenant-owned sender's breaker is in `senders`. */
  breakerOpen: boolean;
  /** Issue #1141. One entry per sender lane this pass saw. */
  senders: WhatsappSenderPassSummary[];
};

type Terminal = "failed" | "expired" | "cancelled";

/**
 * The senders that have rows due now, oldest-waiting first (`null` is the
 * deployment sender). The due predicate is the claim's own, so a lane listed
 * here has something the claim below can take.
 */
async function discoverLanes(
  sql: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<(string | null)[]> {
  const rows = (await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      SELECT sender_account_id
      FROM awcms_whatsapp_messages
      WHERE tenant_id = ${tenantId}
        AND (
          (status IN ('queued', 'retry_wait')
            AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
          OR (status = 'sending' AND next_attempt_at <= ${now})
        )
      GROUP BY sender_account_id
      ORDER BY min(created_at), sender_account_id NULLS FIRST
      LIMIT ${MAX_LANES_PER_PASS}
    `,
    { workClass: "background_sync" }
  )) as { sender_account_id: string | null }[];

  return rows.map((row) => row.sender_account_id);
}

/**
 * The claim predicate MIRRORS the lease it writes: a worker that dies between
 * CLAIM and FINALISE leaves the row `sending`, and every finalise is guarded by
 * `status = 'sending'`, so without the `OR (status = 'sending' AND
 * next_attempt_at <= now)` arm such a row would be unsendable, uncancellable and
 * unretryable.
 *
 * `laneSenderId` narrows the claim to ONE sender's rows (`null`: the deployment
 * sender's). The lane predicate sits in the SAME locking select as the due
 * predicate, so a concurrent claimer's `SKIP LOCKED` and the re-check after a
 * lock wait both see it: two workers cannot claim one row, and neither can
 * claim a row of a lane it was not serving.
 */
async function claimEligibleMessages(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  limit: number,
  leaseMs: number,
  laneSenderId: string | null
): Promise<ClaimedRow[]> {
  const leaseExpiry = new Date(now.getTime() + leaseMs);

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      // `MATERIALIZED` is load-bearing. Without it the planner may inline the
      // locking sub-select into the UPDATE, and on stale statistics for a
      // near-empty table it then re-runs the `LIMIT` once per outer row, so
      // one statement can claim more than `limit` rows (Issue #1007). The
      // CTE forces the locked, limited id set to be computed exactly once.
      const rows = await tx`
        WITH due AS MATERIALIZED (
          SELECT id FROM awcms_whatsapp_messages
          WHERE tenant_id = ${tenantId}
            AND (
              (status IN ('queued', 'retry_wait')
                AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
              OR (status = 'sending' AND next_attempt_at <= ${now})
            )
            AND (
              sender_account_id = ${laneSenderId}::uuid
              OR (${laneSenderId}::uuid IS NULL AND sender_account_id IS NULL)
            )
          ORDER BY
            CASE purpose WHEN 'security' THEN 0 WHEN 'transactional' THEN 1
                         ELSE 2 END,
            created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE awcms_whatsapp_messages AS t
        SET status = 'sending', next_attempt_at = ${leaseExpiry},
            -- Re-claiming an EXPIRED sending row is a failed attempt: count it,
            -- so a poison pill reaches the retry cap instead of looping.
            retry_count = t.retry_count
              + CASE WHEN t.status = 'sending' THEN 1 ELSE 0 END,
            updated_at = now()
        FROM due
        WHERE t.id = due.id
        RETURNING t.id, t.sender_account_id, t.sender_selection,
                  t.business_scope_type, t.business_scope_id,
                  t.correlation_id, t.template_key, t.purpose,
                  t.recipient, t.recipient_hash, t.recipient_masked, t.body,
                  t.variables, t.contains_secret, t.expires_at, t.retry_count,
                  t.created_at
      `;

      // `UPDATE ... RETURNING` does not preserve the CTE's ORDER BY, so the
      // priority order (security first, then oldest first) is applied here.
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
 * Parks a row whose sender cannot send for a reason that is not the message's
 * own: back to `retry_wait` with the retry count UNCHANGED (this is not a failed
 * attempt), guarded by the exact lease this pass wrote. The row is never
 * re-pointed at another sender; it waits for this one.
 */
async function holdMessage(
  sql: Bun.SQL,
  tenantId: string,
  messageId: string,
  until: Date,
  leaseUntil: Date
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_whatsapp_messages
      SET status = 'retry_wait', next_attempt_at = ${until}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${messageId}
        AND status = 'sending' AND next_attempt_at = ${leaseUntil}
    `,
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
            senderAccountId: row.sender_account_id,
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
            senderAccountId: row.sender_account_id,
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
 * What a lane (one sender's rows) needs to send, resolved lazily and cached for
 * the lane's pass only. A fresh pass resolves again, so a revoked sender, a
 * rotated credential or a withdrawn capability is picked up on the next claim.
 */
type LaneProvider = {
  provider: WhatsappProvider;
  providerName: string;
};

type LaneState = {
  senderAccountId: string | null;
  breakerKey: string;
  verdicts: Map<WhatsappSenderCapability, ResolveWhatsappSenderResult>;
  /** The deployment lane's provider, resolved from the environment once something is claimed. */
  deployment: LaneProvider | null;
  /** A tenant-owned lane's provider, built from that sender's own record and credential. */
  provider: LaneProvider | null;
  providerFailure: { kind: "terminal" | "hold"; reason: string } | null;
  /** The provider rejected this sender's credential: the rest of the lane fails closed without another call. */
  credentialRejected: boolean;
};

type RowGate =
  | ({ ok: true } & LaneProvider)
  | { ok: false; kind: "terminal" | "hold"; reason: string };

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
    held: 0,
    breakerOpen,
    senders: []
  };

  // Feature-flag rule: off means the provider is never touched AND nothing is
  // claimed, so a disabled deployment cannot strand rows in `sending` limbo.
  if (!isWhatsappEnabled(env)) {
    return result;
  }

  if (breakerOpen) {
    // Only the DEPLOYMENT sender's lane waits: a tenant-owned sender has its own
    // breaker, and one stalled provider path must not stop the others.
    log("warning", "whatsapp.dispatch.breaker_open", {
      correlationId,
      tenantId,
      moduleKey: MODULE_KEY
    });
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

  const startedAt = Date.now();
  const clock = () => new Date(now.getTime() + (Date.now() - startedAt));
  const lanes = await discoverLanes(sql, tenantId, now);

  if (lanes.length === 0) {
    return result;
  }

  // Fair share: no lane can take the whole pass from the others. The deployment
  // lane counts only while its breaker is closed.
  const servable = lanes.filter((lane) => lane !== null || !breakerOpen);
  const share = Math.max(1, Math.floor(limit / Math.max(1, servable.length)));
  let channelPort: ChannelAccountPort | null | undefined;

  for (const laneSenderId of lanes) {
    const summary: WhatsappSenderPassSummary = {
      senderAccountId: laneSenderId,
      claimed: 0,
      sent: 0,
      retried: 0,
      failed: 0,
      held: 0,
      skipped: null
    };

    result.senders.push(summary);

    if (laneSenderId === null && breakerOpen) {
      summary.skipped = "breaker_open";
      continue;
    }

    const lane: LaneState = {
      senderAccountId: laneSenderId,
      breakerKey:
        laneSenderId === null
          ? WHATSAPP_CIRCUIT_BREAKER_KEY
          : whatsappSenderBreakerKey(laneSenderId),
      verdicts: new Map(),
      deployment: null,
      provider: null,
      providerFailure: null,
      credentialRejected: false
    };
    let take = share;

    if (laneSenderId !== null) {
      if (!getProviderCircuitBreaker(lane.breakerKey).canAttempt(now)) {
        summary.skipped = "breaker_open";
        continue;
      }

      // Account-level availability, asked once, BEFORE anything is claimed: a
      // held lane leaves its rows exactly where they are. A missing capability
      // is not decided here (a marketing row needs `broadcast`, not `dm`): each
      // row asks for its own below.
      const availability = await resolveLaneSender(lane, "dm");
      const accountLevelDenial =
        !availability.usable && availability.reason !== "CAPABILITY_DENIED";

      if (
        !availability.usable &&
        accountLevelDenial &&
        classifySenderUnavailable(availability.reason) === "hold"
      ) {
        summary.skipped = availability.reason;
        log("warning", "whatsapp.dispatch.sender_held", {
          correlationId,
          tenantId,
          moduleKey: MODULE_KEY,
          senderAccountId: laneSenderId,
          reason: availability.reason
        });
        continue;
      }

      // The cap applies to EVERY lane that is not gone at account level, whatever
      // capability it holds: a sender approved only for `broadcast` or `reply` is
      // `CAPABILITY_DENIED` for `dm` and must not escape its quota because of it.
      // A sender that is gone (terminal at account level) fails its rows, which
      // sends nothing, so it spends no quota and is not throttled.
      if (availability.usable || !accountLevelDenial) {
        const allowance = await withTenantOrThrow(
          sql,
          tenantId,
          (tx) => senderAllowance(tx, tenantId, laneSenderId, env),
          { workClass: "background_sync" }
        );

        take = Math.min(share, allowance);

        if (take <= 0) {
          summary.skipped = "quota_reached";
          continue;
        }
      }
    }

    // The claim lease must outlive the whole lane batch (see the header): `take`
    // rows at the worst-case provider timeout, plus a margin.
    const claimLeaseMs =
      take * resolveWhatsappSendTimeoutMs(env) +
      WHATSAPP_DISPATCH_LEASE_MINUTES * 60_000;
    const claimed = await claimEligibleMessages(
      sql,
      tenantId,
      now,
      take,
      claimLeaseMs,
      laneSenderId
    );

    result.claimed += claimed.length;
    summary.claimed = claimed.length;

    if (claimed.length === 0) {
      continue;
    }

    if (laneSenderId === null) {
      // The deployment sender: from the environment exactly as before, and only
      // once something is claimed.
      lane.deployment = {
        provider: (options.resolveProvider ?? resolveWhatsappProvider)(env),
        providerName: env.WHATSAPP_PROVIDER ?? "unknown"
      };
    }

    log("info", "whatsapp.dispatch.claimed", {
      correlationId,
      tenantId,
      moduleKey: MODULE_KEY,
      count: claimed.length,
      ...(laneSenderId ? { senderAccountId: laneSenderId } : {})
    });

    for (const entry of claimed) {
      const owned: { lease: Date | null } = { lease: null };

      try {
        await processRow(entry, owned, lane, summary);
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
        summary.failed += 1;

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
  }

  return result;

  async function senderPort(): Promise<ChannelAccountPort | null> {
    if (channelPort !== undefined) return channelPort;

    try {
      channelPort = options.senders ?? (await loadChannelAccountPort());
    } catch {
      // tx-swallow-ok: not a transaction; the lane is held and the cause logged.
      log("error", "whatsapp.dispatch.channel_account_port_unavailable", {
        correlationId,
        tenantId,
        moduleKey: MODULE_KEY
      });
      channelPort = null;
    }

    return channelPort;
  }

  /**
   * The lane's account-level verdict for one capability, cached for the pass. A
   * thrown error is a denial by the port's contract, and a HOLD (it says nothing
   * about the message), never a fallback to another sender.
   */
  async function resolveLaneSender(
    lane: LaneState,
    capability: WhatsappSenderCapability
  ): Promise<ResolveWhatsappSenderResult> {
    const cached = lane.verdicts.get(capability);

    if (cached) return cached;

    let verdict: ResolveWhatsappSenderResult;

    try {
      const port = await senderPort();

      verdict = port
        ? await withTenantOrThrow(
            sql,
            tenantId,
            (tx) =>
              port.resolveWhatsappSender(tx, {
                tenantId,
                accountId: lane.senderAccountId!,
                capability
              }),
            { workClass: "background_sync" }
          )
        : { usable: false, reason: "SECRET_STORE_UNAVAILABLE" };
    } catch {
      // tx-swallow-ok: not a transaction handle (see above).
      verdict = { usable: false, reason: "SECRET_STORE_UNAVAILABLE" };
    }

    lane.verdicts.set(capability, verdict);

    return verdict;
  }

  /**
   * The provider this row is sent through, or the reason it cannot be. The
   * deployment lane is the environment's provider, unchanged. A tenant-owned lane
   * is built from that sender's own record and credential, once per pass.
   */
  async function gateRow(lane: LaneState, entry: ClaimedRow): Promise<RowGate> {
    if (lane.senderAccountId === null) {
      return { ok: true, ...lane.deployment! };
    }

    const accountId = lane.senderAccountId;

    if (lane.credentialRejected) {
      // A 401 is as likely to be a token the tenant is about to reconnect (or a
      // transient provider fault) as a revoked one: the row waits and is retried
      // with backoff, bounded by `WHATSAPP_SEND_MAX_RETRIES` (Issue #1233 L1).
      return { ok: false, kind: "hold", reason: "CREDENTIAL_REJECTED" };
    }

    // This sender's breaker only: another sender's failures never reach it.
    if (!getProviderCircuitBreaker(lane.breakerKey).canAttempt(clock())) {
      return { ok: false, kind: "hold", reason: "BREAKER_OPEN" };
    }

    const verdict = await resolveLaneSender(
      lane,
      capabilityForSend(
        entry.purpose as "transactional" | "security" | "marketing",
        entry.sender_selection === "reply"
      )
    );

    if (!verdict.usable) {
      return {
        ok: false,
        kind: classifySenderUnavailable(verdict.reason),
        reason: verdict.reason
      };
    }

    const rowScope =
      entry.business_scope_type && entry.business_scope_id
        ? { type: entry.business_scope_type, id: entry.business_scope_id }
        : null;

    if (!senderScopeAllows(verdict.sender.businessScope, rowScope)) {
      return { ok: false, kind: "terminal", reason: "SCOPE_MISMATCH" };
    }

    if (lane.providerFailure) {
      return { ok: false, ...lane.providerFailure };
    }

    if (!lane.provider) {
      const credentials = options.credentials;

      if (!credentials) {
        // Only the dispatcher's composition root supplies the credential port.
        lane.providerFailure = {
          kind: "hold",
          reason: "SECRET_STORE_UNAVAILABLE"
        };

        return { ok: false, ...lane.providerFailure };
      }

      let credential;

      try {
        credential = await withTenantOrThrow(
          sql,
          tenantId,
          (tx) =>
            credentials.resolveWhatsappCredential(tx, { tenantId, accountId }),
          { workClass: "background_sync" }
        );
      } catch {
        // tx-swallow-ok: not a transaction handle; a thrown error is a refusal
        // (held), and nothing of it is logged.
        credential = {
          ok: false as const,
          reason: "SECRET_STORE_UNAVAILABLE" as const
        };
      }

      if (!credential.ok) {
        lane.providerFailure = {
          kind: classifySenderUnavailable(credential.reason),
          reason: credential.reason
        };

        return { ok: false, ...lane.providerFailure };
      }

      if (
        verdict.sender.provider === "whatsapp_cloud" &&
        !isWhatsappMetaApiVersionValid(env)
      ) {
        // An operator misconfiguration, not a fact about this message or sender:
        // the row waits (bounded retries) until the deployment is fixed. It is
        // never sent through another sender or provider (Issue #1233 L1).
        lane.providerFailure = {
          kind: "hold",
          reason: "PROVIDER_CONFIG_INVALID"
        };

        return { ok: false, ...lane.providerFailure };
      }

      const built = (
        options.buildSenderProvider ?? buildWhatsappSenderProvider
      )({
        sender: verdict.sender,
        credential: credential.credential,
        breakerKey: lane.breakerKey,
        env
      });

      if (!built) {
        lane.providerFailure = {
          kind: "terminal",
          reason: "PROVIDER_UNAVAILABLE"
        };

        return { ok: false, ...lane.providerFailure };
      }

      lane.provider = {
        provider: built,
        providerName: verdict.sender.provider
      };
    }

    return { ok: true, ...lane.provider };
  }

  /**
   * Processes one claimed row. It records the lease it owns in `owned` as soon as
   * it has one, so the caller's catch can fail the row if this throws midway.
   */
  async function processRow(
    entry: ClaimedRow,
    owned: { lease: Date | null },
    lane: LaneState,
    summary: WhatsappSenderPassSummary
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
      summary.failed += 1;

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

    // 2b. The sender (Issue #1141). A sender that cannot send now never sends
    //     through anything else: terminal for a sender that is gone or was never
    //     approved, a hold (the row waits, retry count untouched) for one that
    //     is only unavailable for now. No other sender, number or provider.
    const gate = await gateRow(lane, entry);

    if (!gate.ok) {
      if (gate.kind === "hold" && BOUNDED_HOLD_REASONS.has(gate.reason)) {
        // Retry with backoff and COUNT the attempt, so a sender whose credential
        // stays rejected (or a deployment that stays misconfigured) ends in a
        // terminal failure instead of waiting forever. No send was attempted
        // this time, so no delivery attempt is recorded.
        const retry = evaluateWhatsappRetry(retryCount, maxRetries, now);

        if (retry.eligible && retry.nextAttemptAt) {
          const delay = retry.nextAttemptAt.getTime() - now.getTime();

          await scheduleRetry(
            sql,
            tenantId,
            entry.id,
            retryCount + 1,
            new Date(clock().getTime() + delay),
            SENDER_UNAVAILABLE_FAILURE_CODE,
            `The sender cannot send this message yet (${gate.reason}).`,
            leaseUntil
          );
          result.retried += 1;
          summary.retried += 1;

          return;
        }

        await terminal(
          "failed",
          retryCount + 1,
          SENDER_UNAVAILABLE_FAILURE_CODE,
          `The sender cannot send this message (${gate.reason}).`
        );
        log("warning", "whatsapp.dispatch.sender_unavailable", {
          correlationId: messageCorrelationId,
          tenantId,
          moduleKey: MODULE_KEY,
          senderAccountId: lane.senderAccountId,
          reason: gate.reason
        });
        result.failed += 1;
        summary.failed += 1;

        return;
      }

      if (gate.kind === "hold") {
        await holdMessage(
          sql,
          tenantId,
          entry.id,
          new Date(clock().getTime() + SENDER_HOLD_MS),
          leaseUntil
        );
        result.held += 1;
        summary.held += 1;

        return;
      }

      await terminal(
        "failed",
        retryCount,
        SENDER_UNAVAILABLE_FAILURE_CODE,
        `The sender cannot send this message (${gate.reason}).`
      );
      log("warning", "whatsapp.dispatch.sender_unavailable", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        senderAccountId: lane.senderAccountId,
        reason: gate.reason
      });
      result.failed += 1;
      summary.failed += 1;

      return;
    }

    const { provider, providerName } = gate;

    // 3. Eligibility, read again immediately before the send, under EVERY ring key.
    //    Keyed by the recipient, never by the sender (ADR-0148 section 4).
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
      summary.failed += 1;

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
        recipient: entry.recipient_masked,
        ...(lane.senderAccountId
          ? { senderAccountId: lane.senderAccountId }
          : {})
      });
      result.sent += 1;
      summary.sent += 1;

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

    if (sendResult.failureCode === "unauthorized" && lane.senderAccountId) {
      // The provider rejected THIS sender's credential. The rest of the lane
      // fails closed without another call; the credential is the tenant's to
      // fix, and no other sender or credential is tried.
      lane.credentialRejected = true;
    }

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
      summary.failed += 1;

      return;
    }

    // A tenant-owned sender's 401 is retried with backoff like any transient
    // failure (bounded), not failed on the spot: the tenant may reconnect, and the
    // rest of this lane is held meanwhile (Issue #1233 L1).
    const retryable =
      sendResult.retryable ||
      (sendResult.failureCode === "unauthorized" &&
        lane.senderAccountId !== null);
    const retry = retryable
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
      summary.retried += 1;

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
    summary.failed += 1;

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
