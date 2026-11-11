/**
 * Internal email dispatcher (Issue #495). NOT a public HTTP endpoint — same
 * "trusted internal worker only" boundary as
 * `sync-storage/application/object-dispatch.ts`. Invoked by
 * `scripts/email-dispatch.ts`, one tenant at a time.
 *
 * Three-phase pattern (ADR-0006 — never call a provider inside a DB
 * transaction), directly mirroring `object-dispatch.ts`:
 *
 * 1. CLAIM — one short transaction flips eligible `queued`/`retry_wait`
 *    rows to a transient `sending` status (`FOR UPDATE SKIP LOCKED`),
 *    reusing `next_attempt_at` as the claim lease expiry (no new column —
 *    same reuse `sql/020`'s own comment documents). The lease is
 *    *readable*, not write-only: a `sending` row whose lease has expired is
 *    re-claimed by a later pass (Issue #143).
 * 2. SEND — for each claimed row, renders the body from its
 *    `template_key`/`variables` (`../domain/email-template-render.ts`,
 *    safe rendering: per-category variable allowlist + locale resolution,
 *    Issue #498) and calls the resolved `EmailProvider`
 *    (`../infrastructure/email-provider-resolver.ts`) *outside* any
 *    transaction. Rendering locale is the tenant's `default_locale`
 *    (`awcms_tenants`, no per-message override yet — #496/#497 can add
 *    one if a real need surfaces).
 * 3. FINALIZE — one short transaction per row flips `sending` to `sent`,
 *    or (on failure) to `retry_wait` with backoff
 *    (`../domain/email-retry.ts`) or `failed` once retries are exhausted
 *    or the failure is marked non-retryable. Every attempt — success or
 *    failure — is recorded in `awcms_email_delivery_attempts`.
 *
 * If `EMAIL_ENABLED` is not `"true"`, `dispatchEmailQueue` returns
 * immediately without claiming anything — a disabled/misconfigured
 * provider never causes claimed rows to pile up in `sending` limbo (doc 18
 * feature-flag rule: provider off never touches the provider at all).
 */
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import type {
  ChannelEmailCredentialPort,
  ChannelEmailSenderPort
} from "../../_shared/ports/channel-account-port";
import { fetchActiveEmailTemplateByKey } from "./email-template-directory";
import {
  emailSenderAllowance,
  loadEmailSenderHealth
} from "./email-sender-directory";
import {
  isEmailSenderRoutingEnabled,
  resolveEmailMailketingCreditFloor,
  resolveEmailSendMaxRetries,
  resolveEmailSendTimeoutMs,
  resolveEmailSenderHealthMaxAgeMs
} from "../domain/email-config";
import { redactEmailAddressesInText } from "../domain/email-log-redaction";
import {
  EMAIL_CREDIT_HOLD_BUDGET_MS,
  EMAIL_SENDER_HOLD_BUDGET_MS,
  EMAIL_SENDER_HOLD_MS,
  evaluateEmailRetry
} from "../domain/email-retry";
import {
  EMAIL_SENDER_UNAVAILABLE_CODE,
  capabilityForEmailPurpose,
  classifyEmailSenderUnavailable,
  emailSenderBreakerKey,
  emailSenderScopeAllows,
  evaluateEmailSenderHealth,
  type EmailPurpose
} from "../domain/email-sender";
import {
  MAILKETING_V2_UNVERIFIED_WARNING,
  isMailketingTokenHeaderSafe,
  isMailketingV2Verified
} from "../domain/mailketing-v2-contract";
import { createMailketingV2Provider } from "../infrastructure/mailketing-v2-provider";
import { fetchSuppressedRecipientHashes } from "./suppression-directory";
import {
  renderEmailTemplate,
  type EmailTemplateSource
} from "../domain/email-template-render";
import type { EmailProvider } from "../domain/email-provider-contract";
import { resolveEmailProvider } from "../infrastructure/email-provider-resolver";

const DEFAULT_RENDER_LOCALE = "en";

const MODULE_KEY = "email";
const CIRCUIT_BREAKER_KEY = "email-mailketing";

export const EMAIL_DISPATCH_DEFAULT_LIMIT = 25;
export const EMAIL_DISPATCH_LEASE_MINUTES = 2;
const MAX_RESPONSE_SNIPPET_LENGTH = 500;
const RECLAIMED_PREFIX =
  "[uncertain: re-claimed after an expired lease; a previous attempt may have been accepted]";
const UNCERTAIN_REDELIVERY_NOTE =
  "Uncertain delivery: re-sent after an expired claim lease; a previous attempt may have been accepted by the provider (possible duplicate).";

type ClaimedRow = {
  id: string;
  correlation_id: string | null;
  category: string;
  template_key: string | null;
  to_address: string;
  to_address_hash: string;
  subject: string;
  variables: Record<string, unknown> | null;
  retry_count: string | number;
  /** True when this claim took over a `sending` row whose lease had expired (Issue #1159). */
  reclaimed: boolean;
  /** Anchors the credit-hold budget; absent only in fakes. */
  created_at?: Date | string;
};

/** Issue #1160: a row of a tenant sender's lane carries its immutable sender snapshot. */
type ClaimedSenderRow = ClaimedRow & {
  sender_account_id: string;
  sender_address: string;
  sender_name: string | null;
  business_scope_type: string | null;
  business_scope_id: string | null;
  purpose: EmailPurpose;
};

/** Issue #1160: what the composition root may hand a tenant-sender lane's provider factory. */
export type BuildEmailSenderProviderInput = {
  apiToken: string;
  breakerKey: string;
  env: NodeJS.ProcessEnv;
};

export type DispatchEmailQueueOptions = {
  limit?: number;
  now?: Date;
  correlationId?: string;
  resolveProvider?: (env?: NodeJS.ProcessEnv) => EmailProvider;
  fromAddress?: string;
  fromName?: string;
  env?: NodeJS.ProcessEnv;
  /**
   * Issue #1160. Resolves a tenant-owned Mailketing sender (no secret). Omitted
   * (or `EMAIL_SENDER_ROUTING_ENABLED` not `"true"`): tenant-sender rows are not
   * claimed at all; they wait, untouched, and nothing else sends them.
   */
  senders?: ChannelEmailSenderPort;
  /**
   * Issue #1160. Decrypts a sender's borrowed Mailketing token, in memory, per
   * lane. Supplied ONLY by the dispatcher's composition root
   * (`scripts/email-dispatch.ts`); omitted, tenant-sender rows are not claimed
   * (fail closed).
   */
  credentials?: ChannelEmailCredentialPort;
  /** Issue #1160. Test seam for the per-account v2 provider (no network). */
  buildSenderProvider?: (input: BuildEmailSenderProviderInput) => EmailProvider;
};

export type DispatchEmailQueueResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
  /**
   * Finding D6 — claimed messages the provider refused to even attempt (the
   * breaker opening MID-pass). Returned to `queued` untouched: no
   * `awcms_email_delivery_attempts` row, no `retry_count` increment. Counted
   * separately from `failed`/`retried` precisely because it is neither.
   */
  deferred: number;
  /**
   * Issue #1159 — messages sent on a re-claim of an expired lease: a previous
   * worker may have died AFTER the provider accepted the message and BEFORE
   * finalize, so this send may be a duplicate. Counted (and the sent row
   * annotated) rather than hidden; no provider-side dedupe exists (ADR-0151).
   * These rows are ALSO counted in `sent`/`retried`/`failed`. Counted only
   * for rows actually sent to the provider (a deferred row was never re-sent),
   * plus a provider answer that left the delivery state unknown (a malformed
   * 200). The note is written to `last_error` for every outcome of such a row.
   */
  uncertain: number;
  /**
   * Issue #1159 — claimed messages deferred because the email configuration is
   * wrong (a subset of `deferred`). They stay `queued` and send once the
   * configuration is fixed; a configuration error never fails a message.
   */
  misconfigured: number;
  /** The DEPLOYMENT sender's breaker (unchanged meaning). A tenant sender's breaker is per Mailketing account and reported in `senderLanesSkipped`. */
  breakerOpen: boolean;
  /** Issue #1160: tenant-sender lanes this pass looked at. */
  senderLanes: number;
  /** Issue #1160: lanes not served this pass (their account's breaker open, or the sender's hourly cap reached). Nothing was claimed or rerouted. */
  senderLanesSkipped: number;
  /** Issue #1160: claimed rows of a tenant sender that could not send right now and were parked (a subset of `deferred`). */
  senderHeld: number;
};

function toStringVariables(
  variables: Record<string, unknown> | null
): Record<string, string> {
  if (!variables) {
    return {};
  }

  const output: Record<string, string> = {};

  for (const [key, value] of Object.entries(variables)) {
    output[key] = typeof value === "string" ? value : String(value);
  }

  return output;
}

/**
 * Issue #143 — the claim predicate must mirror the lease it writes.
 * `next_attempt_at = ${leaseExpiry}` is the claim lease; a worker that dies
 * between CLAIM and FINALIZE leaves the row `sending` forever, and since
 * every finalize is guarded by `status = 'sending'` and
 * `cancelEmailMessage` refuses `sending`, such a row becomes permanent
 * limbo — unsendable, uncancellable, unretryable. Re-claiming expired
 * leases (`OR (status = 'sending' AND next_attempt_at <= ${now})`) is
 * exactly what the sibling dispatcher
 * `sync-storage/application/object-dispatch.ts` already does.
 *
 * The accepted trade-off (identical to `object-dispatch`'s): a crash in the
 * narrow window *after* the provider accepted the message but *before*
 * FINALIZE can produce one duplicate send. Mailketing is single-recipient
 * per call, so the blast radius is one duplicate email — strictly better
 * than a message stuck forever. `recordDeliveryAttempt` is idempotent per
 * `(message_id, attempt_no)` so the re-claim cannot crash the pass.
 */
async function claimEligibleEntries(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  limit: number
): Promise<ClaimedRow[]> {
  const leaseExpiry = new Date(
    now.getTime() + EMAIL_DISPATCH_LEASE_MINUTES * 60_000
  );

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      // `MATERIALIZED` is load-bearing: an inlined locking sub-select can be
      // re-run per outer row on stale statistics and claim more than `limit`
      // (Issue #1007). The CTE computes the locked, limited id set once.
      const rows = await tx`
        WITH due AS MATERIALIZED (
          SELECT id, (status = 'sending') AS reclaimed FROM awcms_email_messages
          WHERE tenant_id = ${tenantId}
            -- Issue #1160: the DEPLOYMENT lane only. A tenant sender's row is
            -- claimed by its own lane, never sent with the deployment token.
            AND sender_account_id IS NULL
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
        UPDATE awcms_email_messages AS t
        SET status = 'sending', next_attempt_at = ${leaseExpiry}
        FROM due
        WHERE t.id = due.id
        RETURNING t.id, t.correlation_id, t.category, t.template_key,
                  t.to_address, t.to_address_hash, t.subject, t.variables,
                  t.retry_count, t.created_at, due.reclaimed
      `;

      return rows as unknown as ClaimedRow[];
    },
    { workClass: "background_sync" }
  );
}

/** Most tenant-sender lanes one pass looks at; the oldest-waiting come first, so a lane past this limit is served by the next pass, not starved. */
const MAX_SENDER_LANES_PER_PASS = 64;

/**
 * Issue #1160: the tenant senders that have due rows, oldest-waiting first. One
 * statement, bounded, over the tenant's own queue (RLS and the predicate).
 */
async function discoverSenderLanes(
  sql: Bun.SQL,
  tenantId: string,
  now: Date
): Promise<string[]> {
  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = (await tx`
        SELECT sender_account_id
        FROM awcms_email_messages
        WHERE tenant_id = ${tenantId}
          AND sender_account_id IS NOT NULL
          AND (
            (status IN ('queued', 'retry_wait')
              AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
            OR (status = 'sending' AND next_attempt_at <= ${now})
          )
        GROUP BY sender_account_id
        ORDER BY min(created_at), sender_account_id
        LIMIT ${MAX_SENDER_LANES_PER_PASS}
      `) as { sender_account_id: string }[];

      return rows.map((row) => row.sender_account_id);
    },
    { workClass: "background_sync" }
  );
}

/**
 * Issue #1160: claims due rows of ONE tenant sender. With `quotaEnv` the
 * sender's hourly allowance is computed and CLAIMED in this one transaction,
 * under a lock keyed on the sender (the WhatsApp lesson of Issue #1231 M2):
 * two overlapping passes would otherwise both read the same allowance and
 * together exceed the cap. The lock is taken first, before any row lock (the
 * claim is `SKIP LOCKED` and never waits), and released at COMMIT; it is never
 * held across a network send.
 */
async function claimSenderLane(
  sql: Bun.SQL,
  tenantId: string,
  senderAccountId: string,
  now: Date,
  limit: number,
  quotaEnv: NodeJS.ProcessEnv | null
): Promise<{ rows: ClaimedSenderRow[]; quotaReached: boolean }> {
  const leaseExpiry = new Date(
    now.getTime() + EMAIL_DISPATCH_LEASE_MINUTES * 60_000
  );

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      let take = limit;

      if (quotaEnv !== null) {
        await tx`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`awcms_email_sender_quota:${tenantId}:${senderAccountId}`}, 0)
          )
        `;

        take = Math.min(
          limit,
          await emailSenderAllowance(tx, tenantId, senderAccountId, quotaEnv)
        );

        if (take <= 0) return { rows: [], quotaReached: true };
      }

      const rows = await tx`
        WITH due AS MATERIALIZED (
          SELECT id, (status = 'sending') AS reclaimed FROM awcms_email_messages
          WHERE tenant_id = ${tenantId}
            AND sender_account_id = ${senderAccountId}::uuid
            AND (
              (status IN ('queued', 'retry_wait')
                AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
              OR (status = 'sending' AND next_attempt_at <= ${now})
            )
          ORDER BY
            CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
            created_at
          LIMIT ${take}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE awcms_email_messages AS t
        SET status = 'sending', next_attempt_at = ${leaseExpiry}
        FROM due
        WHERE t.id = due.id
        RETURNING t.id, t.correlation_id, t.category, t.template_key,
                  t.to_address, t.to_address_hash, t.subject, t.variables,
                  t.retry_count, t.created_at, due.reclaimed,
                  t.sender_account_id, t.sender_address, t.sender_name,
                  t.business_scope_type, t.business_scope_id, t.purpose
      `;

      return {
        rows: rows as unknown as ClaimedSenderRow[],
        quotaReached: false
      };
    },
    { workClass: "background_sync" }
  );
}

/**
 * Issue #1160 audit L4: the hold budget for tenant-sender rows nothing claims
 * (routing switched off, the account's breaker open, the sender's hourly cap
 * reached). Waiting rows older than `EMAIL_SENDER_HOLD_BUDGET_MS` FAIL with a
 * named reason instead of going out hours late. Bounded per pass; never sends
 * anything and never re-points a row. `senderAccountId` NULL means every
 * tenant sender of the tenant (the routing-off case); the deployment sender's
 * rows (`sender_account_id` NULL) are never touched.
 */
async function expireOverdueSenderRows(
  sql: Bun.SQL,
  tenantId: string,
  now: Date,
  senderAccountId: string | null
): Promise<number> {
  const cutoff = new Date(now.getTime() - EMAIL_SENDER_HOLD_BUDGET_MS);

  return withTenantOrThrow(
    sql,
    tenantId,
    async (tx) => {
      const rows = await tx`
        WITH overdue AS MATERIALIZED (
          SELECT id FROM awcms_email_messages
          WHERE tenant_id = ${tenantId}
            AND sender_account_id IS NOT NULL
            AND (${senderAccountId}::uuid IS NULL
                 OR sender_account_id = ${senderAccountId}::uuid)
            AND status IN ('queued', 'retry_wait')
            AND created_at <= ${cutoff}
          ORDER BY created_at
          LIMIT 500
          FOR UPDATE SKIP LOCKED
        )
        UPDATE awcms_email_messages AS t
        SET status = 'failed', next_attempt_at = null,
            last_error = 'SENDER_HOLD_BUDGET_EXCEEDED: the sender could not send (routing off, breaker open or hourly cap reached) for longer than the hold budget; the message was not sent and was not rerouted.'
        FROM overdue
        WHERE t.id = overdue.id
        RETURNING t.id
      `;

      return (rows as unknown[]).length;
    },
    { workClass: "background_sync" }
  );
}

/** `awcms_tenants` has no RLS (it's the root table, not tenant-scoped data — same reasoning `object-sync-dispatch.ts` relies on) — queried directly, no `withTenant` needed. Falls back to `DEFAULT_RENDER_LOCALE` if the tenant row is somehow missing (defensive; should never happen for an active tenant). */
async function fetchTenantDefaultLocale(
  sql: Bun.SQL,
  tenantId: string
): Promise<string> {
  const rows = (await sql`
    SELECT default_locale FROM awcms_tenants WHERE id = ${tenantId}
  `) as { default_locale: string }[];

  return rows[0]?.default_locale ?? DEFAULT_RENDER_LOCALE;
}

/**
 * `ON CONFLICT DO NOTHING` on `awcms_email_delivery_attempts_unique_attempt`
 * (`UNIQUE (message_id, attempt_no)`, `sql/014`) — required by the expired-
 * lease re-claim above (Issue #143). A crash *after* this insert but
 * *before* FINALIZE leaves `retry_count` untouched, so the re-claiming pass
 * computes the same `attempt_no` and would hit the unique constraint; an
 * unhandled `23505` would abort the whole dispatch pass and take the other
 * claimed messages down with it. The ledger keeps the first record for that
 * attempt number, which is the truthful one: it is the attempt that actually
 * reached the provider.
 */
async function recordDeliveryAttempt(
  sql: Bun.SQL,
  tenantId: string,
  messageId: string,
  attemptNo: number,
  outcome: "success" | "failure",
  providerName: string,
  providerResponseSnippet: string | null,
  errorMessage: string | null
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      INSERT INTO awcms_email_delivery_attempts
        (tenant_id, message_id, attempt_no, outcome, provider_name, provider_response_snippet, error_message)
      VALUES (
        ${tenantId}, ${messageId}, ${attemptNo}, ${outcome}, ${providerName},
        ${providerResponseSnippet}, ${errorMessage}
      )
      ON CONFLICT ON CONSTRAINT awcms_email_delivery_attempts_unique_attempt
      DO NOTHING
    `,
    { workClass: "background_sync" }
  );
}

async function finalizeSent(
  sql: Bun.SQL,
  tenantId: string,
  id: string,
  providerName: string,
  providerMessageId: string | undefined,
  uncertainNote: string | null
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_email_messages
      SET status = 'sent', sent_at = now(), next_attempt_at = null,
          provider_name = ${providerName}, provider_message_id = ${providerMessageId ?? null},
          last_error = COALESCE(${uncertainNote}, last_error)
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );
}

/**
 * A recipient can land on the suppression list (bounce/complaint/manual/
 * unsubscribe) *after* a message was enqueued but *before* the dispatcher
 * gets to it — `enqueueAnnouncement`/`requestPasswordReset` only check the
 * list at enqueue time. Checked again here, right before the provider call,
 * so a fresh suppression always wins. No provider call is made and no
 * `awcms_email_delivery_attempts` row is written (that table's
 * `outcome` constraint only allows `success`/`failure` — this was never a
 * delivery attempt at all).
 */
async function finalizeSuppressed(
  sql: Bun.SQL,
  tenantId: string,
  id: string
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_email_messages
      SET status = 'suppressed', next_attempt_at = null,
          last_error = 'Recipient is on the suppression list.'
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );
}

/**
 * Finding D6 — the provider declined to attempt this message at all, so the
 * claim is simply undone.
 *
 * `status = 'queued'` with `next_attempt_at = null` restores exactly the
 * pre-claim state: the row was already due when `claimEligibleEntries` picked
 * it up, so it is due again. No backoff is skipped, because no backoff was
 * consumed — `retry_count` is deliberately not touched.
 *
 * What this replaced: `recordDeliveryAttempt(… 'failure' …)` followed by
 * `finalizeFailure(…)`. That wrote a delivery-attempt row for a contact that
 * never happened and spent one of the message's retries on it, so a breaker
 * that opened part-way through a pass could push the rest of the batch to
 * terminal `failed` without a single one of them having been sent.
 *
 * `last_error` carries the reason with an explicit non-attempt prefix, so the
 * queue explains itself to an operator without the string being mistakable
 * for a delivery failure.
 */
async function finalizeDeferred(
  sql: Bun.SQL,
  tenantId: string,
  id: string,
  reason: string,
  holdUntil: Date | null = null
): Promise<void> {
  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_email_messages
      SET status = 'queued', next_attempt_at = ${holdUntil},
          last_error = ${`Deferred (no attempt made): ${reason}`}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );
}

async function finalizeFailure(
  sql: Bun.SQL,
  tenantId: string,
  id: string,
  currentRetryCount: number,
  maxRetries: number,
  retryable: boolean,
  now: Date,
  errorMessage: string,
  retryAfterMs?: number
): Promise<{ eligible: boolean }> {
  const evaluation = retryable
    ? evaluateEmailRetry(currentRetryCount, maxRetries, now, retryAfterMs)
    : { eligible: false as const };

  if (evaluation.eligible) {
    await withTenantOrThrow(
      sql,
      tenantId,
      (tx) => tx`
        UPDATE awcms_email_messages
        SET status = 'retry_wait', retry_count = ${currentRetryCount + 1},
            next_attempt_at = ${evaluation.nextAttemptAt}, last_error = ${errorMessage}
        WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
      `,
      { workClass: "background_sync" }
    );

    return { eligible: true };
  }

  await withTenantOrThrow(
    sql,
    tenantId,
    (tx) => tx`
      UPDATE awcms_email_messages
      SET status = 'failed', retry_count = ${currentRetryCount + 1},
          next_attempt_at = null, last_error = ${errorMessage}
      WHERE tenant_id = ${tenantId} AND id = ${id} AND status = 'sending'
    `,
    { workClass: "background_sync" }
  );

  return { eligible: false };
}

/**
 * Per-pass template cache (Issue #153). `fetchActiveEmailTemplateByKey` was
 * called inside the per-message loop, each wrapped in its own `withTenant`
 * transaction — a batch of 25 announcement rows sharing one `template_key`
 * cost 25 transactions running 25 identical queries. Templates are
 * low-cardinality admin data; one lookup per distinct key per pass is
 * enough. Cache lifetime is deliberately a single `dispatchEmailQueue`
 * call: a template edited between passes is picked up by the next pass, and
 * every message in one pass renders from one consistent template version.
 * Negative results (`null` — no active template) are cached too, so 25
 * messages pointing at a deleted template also cost one query.
 */
function createTemplateLoader(
  sql: Bun.SQL,
  tenantId: string
): (templateKey: string) => Promise<EmailTemplateSource | null> {
  const cache = new Map<string, EmailTemplateSource | null>();

  return async (templateKey: string) => {
    const cached = cache.get(templateKey);

    if (cached !== undefined) {
      return cached;
    }

    const template = await withTenantOrThrow(
      sql,
      tenantId,
      (tx) => fetchActiveEmailTemplateByKey(tx, tenantId, templateKey),
      { workClass: "background_sync" }
    );

    cache.set(templateKey, template);

    return template;
  };
}

/**
 * Dispatches one batch (default `EMAIL_DISPATCH_DEFAULT_LIMIT` rows) of due
 * `awcms_email_messages` entries for a single tenant. Safe to call
 * repeatedly (claim-lease pattern); the CLI script loops per tenant to
 * drain a larger backlog.
 *
 * ## Lanes (Issue #1160, ADR-0151 sections 1 and 2)
 *
 * The ONE queue is served in lanes. The DEPLOYMENT lane (`sender_account_id`
 * NULL) is exactly the dispatcher it always was: the deployment provider from
 * the environment, the global `email-mailketing` breaker, `EMAIL_FROM_*`.
 *
 * Each TENANT SENDER is its own lane, served only when routing is switched on
 * and the composition root supplied both ports. Per lane, before anything is
 * claimed: the sender is re-resolved for the row's tenant (verified, its
 * Mailketing account connected, capability granted), its verification and its
 * account's credit must be known and fresh, and its account's own breaker must
 * be closed. Then the rows are claimed under the sender's hourly cap, the
 * account's token is decrypted in memory, and each row is sent FROM ITS OWN
 * SNAPSHOTTED ADDRESS through a v2 provider keyed to that account. A sender that
 * cannot send makes its rows wait (bounded) or fail; nothing is ever rerouted
 * to the deployment sender, another sender or another account (M5, M6).
 */
export async function dispatchEmailQueue(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchEmailQueueOptions = {}
): Promise<DispatchEmailQueueResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const limit = options.limit ?? EMAIL_DISPATCH_DEFAULT_LIMIT;
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const maxRetries = resolveEmailSendMaxRetries(env);
  const breaker = getProviderCircuitBreaker(CIRCUIT_BREAKER_KEY);
  const breakerOpen = !breaker.canAttempt(now);

  const result: DispatchEmailQueueResult = {
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    suppressed: 0,
    deferred: 0,
    uncertain: 0,
    misconfigured: 0,
    breakerOpen,
    senderLanes: 0,
    senderLanesSkipped: 0,
    senderHeld: 0
  };

  if (env.EMAIL_ENABLED !== "true") {
    return result;
  }

  let renderLocale: string | null = null;
  let loadTemplate:
    ((templateKey: string) => Promise<EmailTemplateSource | null>) | null =
    null;
  let suppressedHashes: Set<string> | null = null;

  /** Loaded once per pass, on first need, for every lane alike. */
  async function prepareRendering(): Promise<void> {
    if (renderLocale === null) {
      renderLocale = await fetchTenantDefaultLocale(sql, tenantId);
      loadTemplate = createTemplateLoader(sql, tenantId);
      suppressedHashes = await withTenantOrThrow(
        sql,
        tenantId,
        (tx) => fetchSuppressedRecipientHashes(tx, tenantId),
        { workClass: "background_sync" }
      );
    }
  }

  type SendContext = {
    provider: EmailProvider;
    from: { address: string; name: string };
    providerName: string;
  };

  /**
   * The suppression re-check, render, send and finalize of ONE claimed row.
   * Identical for every lane: what differs is only the provider and the
   * from-address the lane hands it.
   */
  async function sendClaimedEntry(
    entry: ClaimedRow,
    context: SendContext
  ): Promise<void> {
    await prepareRendering();

    if (suppressedHashes!.has(entry.to_address_hash)) {
      await finalizeSuppressed(sql, tenantId, entry.id);
      log("info", "email.dispatch.suppressed", {
        correlationId: entry.correlation_id ?? correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category
      });
      result.suppressed += 1;
      return;
    }

    const retryCount = Number(entry.retry_count);
    const attemptNo = retryCount + 1;
    const messageCorrelationId = entry.correlation_id ?? correlationId;
    const providerName = context.providerName;

    let template: EmailTemplateSource | null = null;

    if (entry.template_key) {
      template = await loadTemplate!(entry.template_key);
    }

    if (!template) {
      const errorMessage = entry.template_key
        ? `Template not found or inactive: ${entry.template_key}`
        : "Message has no template_key.";

      await recordDeliveryAttempt(
        sql,
        tenantId,
        entry.id,
        attemptNo,
        "failure",
        providerName,
        null,
        errorMessage
      );
      await finalizeFailure(
        sql,
        tenantId,
        entry.id,
        retryCount,
        maxRetries,
        false,
        now,
        errorMessage
      );
      result.failed += 1;
      return;
    }

    const rendered = renderEmailTemplate(
      template,
      toStringVariables(entry.variables),
      entry.template_key!,
      renderLocale!
    );

    const deliveryResult = await context.provider.send({
      to: [{ address: entry.to_address }],
      from: context.from,
      subject: entry.subject || rendered.subject,
      textBody: rendered.textBody,
      htmlBody: rendered.htmlBody,
      correlationId: messageCorrelationId
    });

    // Issue #1159 uncertain-delivery classification. A row re-claimed from an
    // expired lease may already have been accepted by the provider; a provider
    // answer can also leave the state unknown. Counted only when the provider
    // was actually asked (a deferred row was not re-sent), but the note is
    // written for EVERY outcome of such a row.
    const providerAsked = deliveryResult.ok || !deliveryResult.skipped;
    const providerUncertain = !deliveryResult.ok && !!deliveryResult.uncertain;

    if ((entry.reclaimed && providerAsked) || providerUncertain) {
      result.uncertain += 1;
      log("warning", "email.dispatch.uncertain_redelivery", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        reclaimed: entry.reclaimed,
        providerUncertain
      });
    }

    const annotate = (message: string): string =>
      entry.reclaimed ? `${RECLAIMED_PREFIX} ${message}` : message;

    if (deliveryResult.ok) {
      await recordDeliveryAttempt(
        sql,
        tenantId,
        entry.id,
        attemptNo,
        "success",
        providerName,
        deliveryResult.providerMessageId
          ? redactEmailAddressesInText(
              deliveryResult.providerMessageId.slice(
                0,
                MAX_RESPONSE_SNIPPET_LENGTH
              )
            )
          : null,
        null
      );
      await finalizeSent(
        sql,
        tenantId,
        entry.id,
        providerName,
        deliveryResult.providerMessageId,
        entry.reclaimed ? UNCERTAIN_REDELIVERY_NOTE : null
      );
      log("info", "email.dispatch.sent", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        ...senderLogField(entry)
      });
      result.sent += 1;
      return;
    }

    const safeError = redactEmailAddressesInText(
      deliveryResult.error.slice(0, MAX_RESPONSE_SNIPPET_LENGTH)
    );

    if (
      deliveryResult.skipped &&
      deliveryResult.creditHold &&
      entry.created_at !== undefined &&
      now.getTime() - new Date(entry.created_at).getTime() >=
        EMAIL_CREDIT_HOLD_BUDGET_MS
    ) {
      // L1: the credit-hold budget is spent. Deliver an OTP / reset mail hours
      // late? No: fail with a named reason an operator can act on.
      const budgetError =
        "CREDIT_HOLD_BUDGET_EXCEEDED: the provider reported insufficient credit for longer than the hold budget; the message was not sent.";

      await recordDeliveryAttempt(
        sql,
        tenantId,
        entry.id,
        attemptNo,
        "failure",
        providerName,
        budgetError,
        annotate(budgetError)
      );
      await finalizeFailure(
        sql,
        tenantId,
        entry.id,
        retryCount,
        maxRetries,
        false,
        now,
        annotate(budgetError)
      );
      log("error", "email.dispatch.failed", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        retryCount: retryCount + 1,
        error: budgetError,
        ...senderLogField(entry)
      });
      result.failed += 1;
      return;
    }

    if (deliveryResult.skipped) {
      // Nothing reached the provider. Undo the claim and move on — the loop
      // deliberately does NOT break, because every remaining claimed row also
      // needs releasing; breaking would leave them in `sending` until their
      // lease expires. `provider.send` returns immediately once the breaker is
      // open, so finishing the batch costs nothing outbound.
      await finalizeDeferred(
        sql,
        tenantId,
        entry.id,
        annotate(safeError),
        deliveryResult.holdMs
          ? new Date(now.getTime() + deliveryResult.holdMs)
          : null
      );

      if (deliveryResult.configError) {
        log("error", "email.dispatch.misconfigured", {
          correlationId: messageCorrelationId,
          tenantId,
          moduleKey: MODULE_KEY,
          category: entry.category,
          error: safeError
        });
        result.misconfigured += 1;
      } else {
        log("warning", "email.dispatch.deferred", {
          correlationId: messageCorrelationId,
          tenantId,
          moduleKey: MODULE_KEY,
          category: entry.category,
          error: safeError
        });
      }

      result.deferred += 1;
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
      annotate(safeError)
    );

    const finalized = await finalizeFailure(
      sql,
      tenantId,
      entry.id,
      retryCount,
      maxRetries,
      deliveryResult.retryable,
      now,
      annotate(safeError),
      deliveryResult.retryAfterMs
    );

    if (finalized.eligible) {
      log("warning", "email.dispatch.retry_scheduled", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        retryCount: retryCount + 1,
        error: safeError
      });
      result.retried += 1;
    } else {
      log("error", "email.dispatch.failed", {
        correlationId: messageCorrelationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        retryCount: retryCount + 1,
        error: safeError,
        ...senderLogField(entry)
      });
      result.failed += 1;
    }
  }

  // -------------------------------------------------------------------------
  // The deployment lane: unchanged behaviour.
  // -------------------------------------------------------------------------
  if (breakerOpen) {
    log("warning", "email.dispatch.breaker_open", {
      correlationId,
      tenantId,
      moduleKey: MODULE_KEY
    });
  } else {
    const claimed = await claimEligibleEntries(sql, tenantId, now, limit);
    result.claimed += claimed.length;

    if (claimed.length > 0) {
      log("info", "email.dispatch.claimed", {
        correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
        count: claimed.length
      });

      if (
        env.EMAIL_PROVIDER === "mailketing" &&
        env.EMAIL_MAILKETING_API_VERSION?.trim() === "v2" &&
        !isMailketingV2Verified(env)
      ) {
        log("warning", "email.dispatch.mailketing_v2_unverified", {
          correlationId,
          tenantId,
          moduleKey: MODULE_KEY,
          warning: MAILKETING_V2_UNVERIFIED_WARNING
        });
      }

      const provider = (options.resolveProvider ?? resolveEmailProvider)(env);
      const deploymentContext: SendContext = {
        provider,
        from: {
          address: options.fromAddress ?? env.EMAIL_FROM_ADDRESS ?? "",
          name: options.fromName ?? env.EMAIL_FROM_NAME ?? ""
        },
        providerName: env.EMAIL_PROVIDER ?? "unknown"
      };

      for (const entry of claimed) {
        await sendClaimedEntry(entry, deploymentContext);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Tenant-sender lanes (Issue #1160).
  // -------------------------------------------------------------------------
  const senders = options.senders;
  const credentials = options.credentials;

  if (!senders || !credentials) {
    return result;
  }

  if (!isEmailSenderRoutingEnabled(env)) {
    // Audit L4: with routing switched off nothing claims a tenant-sender row,
    // so the hold budget is applied here instead: a row older than it FAILS
    // (`SENDER_HOLD_BUDGET_EXCEEDED`) rather than going out hours later when
    // routing is turned back on. It is never sent through the deployment.
    result.failed += await expireOverdueSenderRows(sql, tenantId, now, null);

    return result;
  }

  const lanes = await discoverSenderLanes(sql, tenantId, now);

  for (const laneSenderId of lanes) {
    result.senderLanes += 1;
    await serveSenderLane(laneSenderId, senders, credentials);
  }

  return result;

  /** Parks or fails every claimed row of a lane whose sender cannot send now. Nothing is sent; no attempt is written. */
  async function refuseLaneRows(
    rows: ClaimedSenderRow[],
    kind: "hold" | "terminal",
    reason: string
  ): Promise<void> {
    for (const entry of rows) {
      const retryCount = Number(entry.retry_count);
      const budgetSpent =
        kind === "hold" &&
        entry.created_at !== undefined &&
        now.getTime() - new Date(entry.created_at).getTime() >=
          EMAIL_SENDER_HOLD_BUDGET_MS;

      if (kind === "hold" && !budgetSpent) {
        await finalizeDeferred(
          sql,
          tenantId,
          entry.id,
          `${EMAIL_SENDER_UNAVAILABLE_CODE} (${reason}); waiting for this sender, never rerouted.`,
          new Date(now.getTime() + EMAIL_SENDER_HOLD_MS)
        );
        log("warning", "email.dispatch.sender_held", {
          correlationId: entry.correlation_id ?? correlationId,
          tenantId,
          moduleKey: MODULE_KEY,
          category: entry.category,
          senderAccountId: entry.sender_account_id,
          reason
        });
        result.deferred += 1;
        result.senderHeld += 1;
        continue;
      }

      const message = budgetSpent
        ? `SENDER_HOLD_BUDGET_EXCEEDED: the sender could not send (${reason}) for longer than the hold budget; the message was not sent and was not rerouted.`
        : `${EMAIL_SENDER_UNAVAILABLE_CODE}: the sender cannot send (${reason}); the message was not sent and was not rerouted.`;

      await finalizeFailure(
        sql,
        tenantId,
        entry.id,
        retryCount,
        maxRetries,
        false,
        now,
        message
      );
      log("error", "email.dispatch.failed", {
        correlationId: entry.correlation_id ?? correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
        category: entry.category,
        senderAccountId: entry.sender_account_id,
        error: message
      });
      result.failed += 1;
    }
  }

  async function serveSenderLane(
    laneSenderId: string,
    senderPort: ChannelEmailSenderPort,
    credentialPort: ChannelEmailCredentialPort
  ): Promise<void> {
    // 1. The lane's verdict, for THIS tenant, re-evaluated every pass: the
    //    account record, its parent account, the capability, then the
    //    freshness of its verification and its account's credit.
    const gate = await withTenantOrThrow(
      sql,
      tenantId,
      async (tx) => {
        const verdict = await senderPort.resolveEmailSender(tx, {
          tenantId,
          accountId: laneSenderId,
          capability: capabilityForEmailPurpose("transactional")
        });

        if (!verdict.usable) {
          return {
            usable: false as const,
            kind: classifyEmailSenderUnavailable(verdict.reason),
            reason: verdict.reason as string
          };
        }

        const health = await loadEmailSenderHealth(
          tx,
          tenantId,
          verdict.sender
        );
        const hold = evaluateEmailSenderHealth({
          sender: health.sender,
          account: health.account,
          now,
          maxAgeMs: resolveEmailSenderHealthMaxAgeMs(env),
          creditFloor: resolveEmailMailketingCreditFloor(env)
        });

        return hold
          ? { usable: false as const, kind: "hold" as const, reason: hold }
          : { usable: true as const, sender: verdict.sender };
      },
      { workClass: "background_sync" }
    );

    if (!gate.usable) {
      // Claimed only to park (bounded) or fail them; never sent elsewhere.
      const claimed = await claimSenderLane(
        sql,
        tenantId,
        laneSenderId,
        now,
        limit,
        null
      );

      result.claimed += claimed.rows.length;
      await refuseLaneRows(claimed.rows, gate.kind, gate.reason);
      return;
    }

    const sender = gate.sender;
    const breakerKey = emailSenderBreakerKey(sender.espAccountId);

    // 2. This ACCOUNT's breaker only: another tenant's (or the deployment's)
    //    failures never reach it, and its failures never reach them (M9).
    if (!getProviderCircuitBreaker(breakerKey).canAttempt(now)) {
      result.senderLanesSkipped += 1;
      log("warning", "email.dispatch.sender_breaker_open", {
        correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
        senderAccountId: laneSenderId
      });
      // Audit L4: the lane waits, but not past the hold budget.
      result.failed += await expireOverdueSenderRows(
        sql,
        tenantId,
        now,
        laneSenderId
      );
      return;
    }

    // 3. Claim under the sender's hourly cap.
    const claimed = await claimSenderLane(
      sql,
      tenantId,
      laneSenderId,
      now,
      limit,
      env
    );

    if (claimed.quotaReached) {
      result.senderLanesSkipped += 1;
      log("info", "email.dispatch.sender_quota_reached", {
        correlationId,
        tenantId,
        moduleKey: MODULE_KEY,
        senderAccountId: laneSenderId
      });
      result.failed += await expireOverdueSenderRows(
        sql,
        tenantId,
        now,
        laneSenderId
      );
      return;
    }

    result.claimed += claimed.rows.length;

    if (claimed.rows.length === 0) return;

    // 4. The borrowed token, decrypted in memory for this lane only. Never
    //    logged, stored, put in a URL or a result (M1).
    const credential = await withTenantOrThrow(
      sql,
      tenantId,
      (tx) =>
        credentialPort.resolveEmailCredential(tx, {
          tenantId,
          accountId: laneSenderId
        }),
      { workClass: "background_sync" }
    );

    if (!credential.ok) {
      await refuseLaneRows(
        claimed.rows,
        classifyEmailSenderUnavailable(credential.reason),
        credential.reason
      );
      return;
    }

    if (!isMailketingTokenHeaderSafe(credential.credential)) {
      await refuseLaneRows(claimed.rows, "hold", "CREDENTIAL_UNUSABLE");
      return;
    }

    const provider = (
      options.buildSenderProvider ??
      ((input: BuildEmailSenderProviderInput) =>
        createMailketingV2Provider({
          apiToken: input.apiToken,
          timeoutMs: resolveEmailSendTimeoutMs(input.env),
          env: input.env,
          breakerKey: input.breakerKey
        }))
    )({ apiToken: credential.credential, breakerKey, env });

    for (const entry of claimed.rows) {
      // The row is sent FROM ITS OWN SNAPSHOT, and only while the account still
      // carries that address and the row's scope is one the sender may serve.
      const rowScope =
        entry.business_scope_type && entry.business_scope_id
          ? { type: entry.business_scope_type, id: entry.business_scope_id }
          : null;

      if (
        entry.sender_address !== sender.address ||
        !emailSenderScopeAllows(sender.businessScope, rowScope) ||
        entry.purpose === "security"
      ) {
        await refuseLaneRows([entry], "terminal", "SENDER_SNAPSHOT_MISMATCH");
        continue;
      }

      await sendClaimedEntry(entry, {
        provider,
        from: { address: entry.sender_address, name: entry.sender_name ?? "" },
        providerName: "mailketing"
      });
    }
  }
}

/** The sender key on a log line (never its address or credential); absent for the deployment lane. */
function senderLogField(
  entry: ClaimedRow
): { senderAccountId: string } | Record<string, never> {
  const senderAccountId = (entry as Partial<ClaimedSenderRow>)
    .sender_account_id;

  return senderAccountId ? { senderAccountId } : {};
}
