/**
 * The publish dispatcher (Issue #1145, ADR-0157 section 6): claim, send,
 * finalise, one tenant per call. Run by `bun run social-publishing:dispatch`
 * as `awcms_worker`.
 *
 * ## No network inside a transaction
 *
 * Three phases, each its own short transaction, with the provider call BETWEEN
 * them and inside none:
 *
 * 1. CLAIM (one transaction): select due jobs `FOR UPDATE SKIP LOCKED`, take a
 *    per-account advisory lock, enforce fair share and the daily cap, re-resolve
 *    each account through the `channel_accounts` port, and flip the usable ones
 *    to `publishing` with a lease. Database reads and writes only.
 * 2. SEND (no transaction): decrypt the credential in a transaction of its own
 *    that closes before the call, hand it to the adapter in memory, call the
 *    provider with an `ssrfSafeFetch` client, a timeout and a per-account
 *    circuit breaker.
 * 3. FINALISE (one transaction per job): compare-and-set on the attempt number
 *    that was claimed, write the ledger, the event and the audit row.
 *
 * ## What it guarantees
 *
 * - A revoked or disabled account, a revoked connection or a withdrawn
 *   capability fails the job terminally; a degraded account or an expired grant
 *   HOLDS it (no attempt consumed, bounded number of holds). No job is ever
 *   rerouted to another account or provider (ADR-0148 I5).
 * - The daily cap and the fair share are decided under a per-account advisory
 *   lock, so concurrent dispatchers cannot overshoot.
 * - A job that reached the provider is `published` and terminal (a database
 *   trigger): a sibling's failure, a retry of another job or a replayed pass
 *   cannot send it again. The one window that remains is a crash between "the
 *   provider accepted the post" and "the job is finalised": the job's
 *   idempotency key is passed to the provider so a provider that honours one
 *   dedupes the re-claim. The window is stated, not hidden.
 * - The credential is in memory for one call, is never logged, stored, evented,
 *   audited or put in an error, and a thrown adapter error's MESSAGE is never
 *   kept (only a fixed code).
 */
import type {
  ChannelPublisherCredentialPort,
  ChannelPublisherPort,
  PublisherUnavailableReason
} from "../../_shared/ports/channel-account-port";
import { ssrfSafeFetch } from "../../../lib/auth/ssrf-guard";
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type {
  SocialPublishAdapter,
  SocialPublishContent,
  SocialPublishHttp,
  SocialPublishOutcome
} from "../domain/social-publish-adapter";
import {
  isSafeLinkUrl,
  type MediaSnapshot
} from "../domain/social-publish-content";
import {
  classifyAccountReason,
  decideRetry,
  holdDelayUntil,
  holdsExhausted
} from "../domain/social-publish-retry";
import {
  DEFAULT_ACCOUNT_DAILY_CAP,
  DISPATCH_DEFAULT_LIMIT,
  DISPATCH_LEASE_MINUTES,
  DISPATCH_PER_ACCOUNT_BATCH,
  PROVIDER_CALL_TIMEOUT_MS,
  SOCIAL_PUBLISHING_MODULE_KEY,
  isSocialPublishingEnabled,
  socialPublishBreakerKey,
  type PublishVariant
} from "../domain/social-publishing-constants";
import {
  socialAdapterRegistry,
  type SocialAdapterRegistry
} from "../infrastructure/social-adapter-registry";
import {
  emitJobFailed,
  emitJobPublished
} from "./social-publishing-event-emit";

/**
 * Every transaction the dispatcher opens is `background_sync` work: a tolerant
 * -of-delay queue drain that must not compete with login and interactive
 * requests for the same pool slots (the same class `whatsapp:dispatch` uses).
 */
function inTenantWork<T>(
  sql: Bun.SQL,
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(sql, tenantId, fn, {
    workClass: "background_sync"
  });
}

export type DispatchSocialPublishOptions = {
  publishers: ChannelPublisherPort;
  credentials: ChannelPublisherCredentialPort;
  registry?: SocialAdapterRegistry;
  env?: NodeJS.ProcessEnv;
  /** The dispatch clock. Tests pass a fixed one; everything time-shaped here (due, lease, cap window, backoff) uses it. */
  clock?: () => Date;
  correlationId?: string;
  limit?: number;
  perAccountBatch?: number;
  accountDailyCap?: number;
  leaseMinutes?: number;
  /** Replaces the `ssrfSafeFetch`-backed client handed to adapters. Tests only. */
  http?: SocialPublishHttp;
};

export type DispatchSocialPublishResult = {
  claimed: number;
  published: number;
  retried: number;
  failed: number;
  held: number;
  /** Finalise found the job no longer ours (lease expired and re-claimed): nothing was written. */
  superseded: number;
  skippedBreaker: number;
  skippedQuota: number;
};

type Candidate = {
  id: string;
  publication_id: string;
  channel_account_id: string;
  provider: string;
  account_kind: string;
  variant: PublishVariant;
  attempt_count: number;
  max_attempts: number;
  hold_count: number;
  idempotency_key: string;
  title: string;
  caption: string;
  link_url: string | null;
  media_snapshot: MediaSnapshot | null;
};

type Claimed = Candidate & {
  /** The attempt number this claim holds: the compare-and-set key of finalise. */
  attemptNo: number;
  externalId: string;
};

function zero(): DispatchSocialPublishResult {
  return {
    claimed: 0,
    published: 0,
    retried: 0,
    failed: 0,
    held: 0,
    superseded: 0,
    skippedBreaker: 0,
    skippedQuota: 0
  };
}

/** Fixed, code-defined phrases: a provider body or a thrown message never reaches a row. */
const PHRASES: Record<string, string> = {
  PUBLISHED: "Published.",
  PROVIDER_ADAPTER_UNAVAILABLE: "No adapter is registered for this provider.",
  ADAPTER_ERROR: "The provider adapter failed unexpectedly.",
  PROVIDER_TIMEOUT: "The provider did not answer in time.",
  CIRCUIT_OPEN: "The provider was failing; the attempt was not made.",
  RETRIES_EXHAUSTED: "The retry budget is spent.",
  HOLD_EXHAUSTED: "The account stayed unavailable for too long.",
  NEEDS_REAUTH: "The account must be re-authorised.",
  REJECTED: "The provider refused this content."
};

function phraseFor(code: string): string {
  if (PHRASES[code]) return PHRASES[code]!;
  if (code.startsWith("ACCOUNT_")) return "The account cannot publish.";
  if (code.startsWith("HELD_")) return "Waiting for the account to be usable.";

  return "The attempt did not succeed.";
}

/** An adapter-supplied code is shape-checked before it can touch a CHECK constraint or a row. */
function sanitizeCode(
  raw: string,
  fallback: string,
  allowed: readonly string[]
): string {
  // A failure code is a CLOSED vocabulary the adapter declares
  // (`SocialPublishAdapter.errorCodes`). An adapter-supplied string is never
  // written to a row on its own authority: any shape can carry a secret, and a
  // regex on the charset does not make a token short or meaningless.
  return allowed.includes(raw) && /^[A-Z][A-Z0-9_]{2,63}$/.test(raw)
    ? raw
    : fallback;
}

export function buildAdapterHttp(env: NodeJS.ProcessEnv): SocialPublishHttp {
  return (url, init) =>
    ssrfSafeFetch(url, {
      timeoutMs: PROVIDER_CALL_TIMEOUT_MS,
      maxResponseBytes: 1_000_000,
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
      env
    });
}

async function claim(
  sql: Bun.SQL,
  tenantId: string,
  options: Required<
    Pick<
      DispatchSocialPublishOptions,
      "limit" | "perAccountBatch" | "accountDailyCap" | "leaseMinutes"
    >
  > & {
    publishers: ChannelPublisherPort;
    now: Date;
    correlationId: string | undefined;
    result: DispatchSocialPublishResult;
  }
): Promise<Claimed[]> {
  const { now, result } = options;
  const lease = new Date(now.getTime() + options.leaseMinutes * 60_000);
  const windowStart = new Date(now.getTime() - 24 * 3600 * 1000);

  return inTenantWork(sql, tenantId, async (tx) => {
    const candidates = (await tx`
      SELECT j.id, j.publication_id, j.channel_account_id, j.provider,
             j.account_kind, j.variant, j.attempt_count, j.max_attempts,
             j.hold_count, j.idempotency_key, p.title, p.caption, p.link_url,
             p.media_snapshot
      FROM awcms_social_publish_jobs AS j
      JOIN awcms_social_publications AS p
        ON p.tenant_id = j.tenant_id AND p.id = j.publication_id
      WHERE j.tenant_id = ${tenantId}
        AND p.state = 'ready'
        AND (p.not_before IS NULL OR p.not_before <= ${now}::timestamptz)
        AND j.status IN ('queued', 'retry_wait', 'publishing')
        AND j.next_attempt_at <= ${now}::timestamptz
      ORDER BY j.next_attempt_at, j.id
      LIMIT ${options.limit * 4}
      FOR UPDATE OF j SKIP LOCKED
    `) as Candidate[];

    // Group by account, keeping the order of first appearance, so one account's
    // backlog cannot starve another's.
    const byAccount = new Map<string, Candidate[]>();

    for (const row of candidates) {
      const list = byAccount.get(row.channel_account_id) ?? [];

      list.push(row);
      byAccount.set(row.channel_account_id, list);
    }

    const claimed: Claimed[] = [];

    for (const [accountId, rows] of byAccount) {
      if (claimed.length >= options.limit) break;

      const breaker = getProviderCircuitBreaker(
        socialPublishBreakerKey(accountId)
      );

      if (!breaker.canAttempt(now)) {
        result.skippedBreaker += rows.length;
        continue;
      }

      // The cap is decided under a per-account lock so two dispatchers cannot
      // each see room for the same last slot.
      await tx`
        SELECT pg_advisory_xact_lock(hashtextextended(${`social_publishing:${tenantId}:${accountId}`}, 0))
      `;

      const usedRows = (await tx`
        SELECT count(*)::int AS used FROM awcms_social_publish_jobs
        WHERE tenant_id = ${tenantId} AND channel_account_id = ${accountId}
          AND (
            (status = 'published' AND published_at > ${windowStart}::timestamptz)
            OR (status = 'publishing' AND next_attempt_at > ${now}::timestamptz)
          )
      `) as { used: number }[];
      const room = Math.max(
        0,
        options.accountDailyCap - (usedRows[0]?.used ?? 0)
      );

      if (room === 0) {
        result.skippedQuota += rows.length;
        continue;
      }

      const take = Math.min(
        room,
        options.perAccountBatch,
        options.limit - claimed.length
      );

      for (const row of rows.slice(0, take)) {
        const resolved = await options.publishers.resolvePublisher(tx, {
          tenantId,
          accountId
        });

        if (!resolved.usable) {
          await settleUnavailable(tx, tenantId, row, resolved.reason, now, {
            correlationId: options.correlationId,
            result
          });
          continue;
        }

        const attemptNo = row.attempt_count + 1;

        await tx`
          UPDATE awcms_social_publish_jobs
          SET status = 'publishing', attempt_count = ${attemptNo},
              next_attempt_at = ${lease}::timestamptz, failure_code = NULL,
              last_error = NULL, updated_at = ${now}::timestamptz
          WHERE tenant_id = ${tenantId} AND id = ${row.id}
        `;
        claimed.push({
          ...row,
          attemptNo,
          externalId: resolved.publisher.externalId
        });
      }
    }

    return claimed;
  });
}

/** An account that cannot publish: hold a recoverable problem, fail a terminal one. No attempt is consumed. */
async function settleUnavailable(
  tx: Bun.SQL,
  tenantId: string,
  row: Pick<
    Candidate,
    "id" | "publication_id" | "channel_account_id" | "provider" | "hold_count"
  >,
  reason: PublisherUnavailableReason,
  now: Date,
  context: {
    correlationId: string | undefined;
    result: DispatchSocialPublishResult;
  }
): Promise<void> {
  const verdict = classifyAccountReason(reason);
  const holdCount = row.hold_count + 1;

  if (verdict.kind === "hold" && !holdsExhausted(holdCount)) {
    const code = `HELD_${reason}`.slice(0, 64);

    await tx`
      UPDATE awcms_social_publish_jobs
      SET status = 'queued', hold_count = ${holdCount},
          next_attempt_at = ${holdDelayUntil(now)}::timestamptz,
          failure_code = ${code}, last_error = ${phraseFor(code)},
          updated_at = ${now}::timestamptz
      WHERE tenant_id = ${tenantId} AND id = ${row.id}
    `;
    context.result.held += 1;

    return;
  }

  await failBeforeAttempt(
    tx,
    tenantId,
    row,
    verdict.kind === "fail" ? verdict.code : "HOLD_EXHAUSTED",
    holdCount,
    now,
    context
  );
}

/**
 * A terminal failure of a job whose account cannot (or can no longer) publish it:
 * no attempt was consumed (ledger row 0), the provider was never called.
 */
async function failBeforeAttempt(
  tx: Bun.SQL,
  tenantId: string,
  row: Pick<
    Candidate,
    "id" | "publication_id" | "channel_account_id" | "provider"
  >,
  code: string,
  holdCount: number,
  now: Date,
  context: {
    correlationId: string | undefined;
    result: DispatchSocialPublishResult;
  }
): Promise<void> {
  await tx`
    UPDATE awcms_social_publish_jobs
    SET status = 'failed', hold_count = ${holdCount}, failure_code = ${code},
        last_error = ${phraseFor(code)}, updated_at = ${now}::timestamptz
    WHERE tenant_id = ${tenantId} AND id = ${row.id}
  `;
  await tx`
    INSERT INTO awcms_social_publish_attempts
      (tenant_id, job_id, attempt_no, outcome, error_code, error_message)
    VALUES (${tenantId}, ${row.id}, 0, 'account_unavailable', ${code},
            ${phraseFor(code)})
    ON CONFLICT (job_id, attempt_no) DO NOTHING
  `;
  await emitJobFailed(tx, tenantId, {
    jobId: row.id,
    publicationId: row.publication_id,
    accountId: row.channel_account_id,
    provider: row.provider,
    failureCode: code,
    attemptNo: 0,
    correlationId: context.correlationId ?? null
  });
  await recordAuditEvent(tx, {
    tenantId,
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    action: "social_publishing.job.failed",
    resourceType: "social_publish_job",
    resourceId: row.id,
    severity: "warning",
    message: "A social publish job failed because its account cannot publish.",
    attributes: {
      publicationId: row.publication_id,
      accountId: row.channel_account_id,
      failureCode: code
    },
    correlationId: context.correlationId
  });
  context.result.failed += 1;
}

type FinalOutcome =
  | {
      kind: "published";
      externalPostId: string;
      externalPostUrl: string | null;
    }
  | { kind: "retry"; code: string; retryAfterSeconds?: number }
  | {
      kind: "fail";
      code: string;
      outcome: "needs_reauth" | "rejected" | "retryable";
    };

async function finalise(
  sql: Bun.SQL,
  tenantId: string,
  job: Claimed,
  outcome: FinalOutcome,
  now: Date,
  context: {
    correlationId: string | undefined;
    result: DispatchSocialPublishResult;
  }
): Promise<void> {
  await inTenantWork(sql, tenantId, async (tx) => {
    if (outcome.kind === "published") {
      const rows = (await tx`
        UPDATE awcms_social_publish_jobs
        SET status = 'published', external_post_id = ${outcome.externalPostId},
            external_post_url = ${outcome.externalPostUrl},
            published_at = ${now}::timestamptz, failure_code = NULL,
            last_error = NULL, updated_at = ${now}::timestamptz
        WHERE tenant_id = ${tenantId} AND id = ${job.id}
          AND status = 'publishing' AND attempt_count = ${job.attemptNo}
        RETURNING id
      `) as { id: string }[];

      if (rows.length === 0) {
        context.result.superseded += 1;

        return;
      }

      await tx`
        INSERT INTO awcms_social_publish_attempts
          (tenant_id, job_id, attempt_no, outcome, error_code, error_message)
        VALUES (${tenantId}, ${job.id}, ${job.attemptNo}, 'published', NULL, NULL)
        ON CONFLICT (job_id, attempt_no) DO NOTHING
      `;
      await emitJobPublished(tx, tenantId, {
        jobId: job.id,
        publicationId: job.publication_id,
        accountId: job.channel_account_id,
        provider: job.provider,
        attemptNo: job.attemptNo,
        correlationId: context.correlationId ?? null
      });
      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
        action: "social_publishing.job.published",
        resourceType: "social_publish_job",
        resourceId: job.id,
        severity: "info",
        message: "A social publish job was accepted by the provider.",
        attributes: {
          publicationId: job.publication_id,
          accountId: job.channel_account_id,
          provider: job.provider,
          attemptNo: job.attemptNo
        },
        correlationId: context.correlationId
      });
      context.result.published += 1;

      return;
    }

    const errorCode = outcome.code;
    const attemptOutcome =
      outcome.kind === "retry"
        ? outcome.retryAfterSeconds !== undefined
          ? "rate_limited"
          : "retryable"
        : outcome.outcome;
    const decision =
      outcome.kind === "retry"
        ? decideRetry(
            job.attemptNo,
            job.max_attempts,
            now,
            outcome.retryAfterSeconds
          )
        : ({ retry: false } as const);

    if (outcome.kind === "retry" && decision.retry) {
      const rows = (await tx`
        UPDATE awcms_social_publish_jobs
        SET status = 'retry_wait',
            next_attempt_at = ${decision.nextAttemptAt}::timestamptz,
            failure_code = ${errorCode}, last_error = ${phraseFor(errorCode)},
            updated_at = ${now}::timestamptz
        WHERE tenant_id = ${tenantId} AND id = ${job.id}
          AND status = 'publishing' AND attempt_count = ${job.attemptNo}
        RETURNING id
      `) as { id: string }[];

      if (rows.length === 0) {
        context.result.superseded += 1;

        return;
      }

      await tx`
        INSERT INTO awcms_social_publish_attempts
          (tenant_id, job_id, attempt_no, outcome, error_code, error_message)
        VALUES (${tenantId}, ${job.id}, ${job.attemptNo}, ${attemptOutcome},
                ${errorCode}, ${phraseFor(errorCode)})
        ON CONFLICT (job_id, attempt_no) DO NOTHING
      `;
      context.result.retried += 1;

      return;
    }

    // Terminal: a non-retryable outcome, or the retry budget is spent.
    const exhausted = outcome.kind === "retry";
    const finalCode = exhausted ? "RETRIES_EXHAUSTED" : errorCode;
    const rows = (await tx`
      UPDATE awcms_social_publish_jobs
      SET status = 'failed', failure_code = ${finalCode},
          last_error = ${phraseFor(finalCode)}, updated_at = ${now}::timestamptz
      WHERE tenant_id = ${tenantId} AND id = ${job.id}
        AND status = 'publishing' AND attempt_count = ${job.attemptNo}
      RETURNING id
    `) as { id: string }[];

    if (rows.length === 0) {
      context.result.superseded += 1;

      return;
    }

    await tx`
      INSERT INTO awcms_social_publish_attempts
        (tenant_id, job_id, attempt_no, outcome, error_code, error_message)
      VALUES (${tenantId}, ${job.id}, ${job.attemptNo}, ${attemptOutcome},
              ${errorCode}, ${phraseFor(errorCode)})
      ON CONFLICT (job_id, attempt_no) DO NOTHING
    `;
    await emitJobFailed(tx, tenantId, {
      jobId: job.id,
      publicationId: job.publication_id,
      accountId: job.channel_account_id,
      provider: job.provider,
      failureCode: finalCode,
      attemptNo: job.attemptNo,
      correlationId: context.correlationId ?? null
    });
    await recordAuditEvent(tx, {
      tenantId,
      moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
      action: "social_publishing.job.failed",
      resourceType: "social_publish_job",
      resourceId: job.id,
      severity: "warning",
      message: "A social publish job failed.",
      attributes: {
        publicationId: job.publication_id,
        accountId: job.channel_account_id,
        provider: job.provider,
        attemptNo: job.attemptNo,
        failureCode: finalCode
      },
      correlationId: context.correlationId
    });
    context.result.failed += 1;
  });
}

function toContent(job: Claimed): SocialPublishContent {
  const media = job.media_snapshot;

  return {
    variant: job.variant,
    title: job.title,
    caption: job.caption,
    linkUrl: job.link_url,
    media: media
      ? {
          publicUrl: media.publicUrl,
          mimeType: media.mimeType,
          sizeBytes: media.sizeBytes,
          altText: media.altText,
          creditLine: media.creditLine
        }
      : null
  };
}

async function callProvider(
  adapter: SocialPublishAdapter,
  job: Claimed,
  tenantId: string,
  credential: string,
  http: SocialPublishHttp,
  correlationId: string | undefined
): Promise<SocialPublishOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_CALL_TIMEOUT_MS);

  try {
    return await Promise.race([
      adapter.publish({
        tenantId,
        accountId: job.channel_account_id,
        provider: job.provider,
        accountKind: job.account_kind,
        externalId: job.externalId,
        credential,
        content: toContent(job),
        idempotencyKey: job.idempotency_key,
        correlationId,
        http,
        signal: controller.signal
      }),
      new Promise<SocialPublishOutcome>((resolve) => {
        controller.signal.addEventListener("abort", () =>
          resolve({ outcome: "retryable", errorCode: "PROVIDER_TIMEOUT" })
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchSocialPublishQueue(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchSocialPublishOptions
): Promise<DispatchSocialPublishResult> {
  const env = options.env ?? process.env;
  const result = zero();

  // The deployment switch: nothing is claimed, nothing is read.
  if (!isSocialPublishingEnabled(env)) return result;

  const clock = options.clock ?? (() => new Date());
  const registry = options.registry ?? socialAdapterRegistry;
  const http = options.http ?? buildAdapterHttp(env);
  const claimed = await claim(sql, tenantId, {
    publishers: options.publishers,
    now: clock(),
    correlationId: options.correlationId,
    result,
    limit: options.limit ?? DISPATCH_DEFAULT_LIMIT,
    perAccountBatch: options.perAccountBatch ?? DISPATCH_PER_ACCOUNT_BATCH,
    accountDailyCap: options.accountDailyCap ?? DEFAULT_ACCOUNT_DAILY_CAP,
    leaseMinutes: options.leaseMinutes ?? DISPATCH_LEASE_MINUTES
  });

  result.claimed = claimed.length;

  const ctx = { correlationId: options.correlationId, result };

  for (const job of claimed) {
    const breaker = getProviderCircuitBreaker(
      socialPublishBreakerKey(job.channel_account_id)
    );
    const adapter = registry.get(job.provider);

    if (!adapter) {
      await finalise(
        sql,
        tenantId,
        job,
        {
          kind: "fail",
          code: "PROVIDER_ADAPTER_UNAVAILABLE",
          outcome: "rejected"
        },
        clock(),
        ctx
      );
      continue;
    }

    if (!breaker.canAttempt(clock())) {
      await finalise(
        sql,
        tenantId,
        job,
        { kind: "retry", code: "CIRCUIT_OPEN" },
        clock(),
        ctx
      );
      continue;
    }

    // The credential is decrypted in a transaction of its own that CLOSES before
    // the provider call. A refusal is a returned reason; only a database error
    // throws (and that job's lease simply expires and it is claimed again).
    const credential = await inTenantWork(sql, tenantId, (tx) =>
      options.credentials.resolvePublishCredential(tx, {
        tenantId,
        accountId: job.channel_account_id
      })
    );

    if (!credential.ok) {
      const verdict = classifyAccountReason(credential.reason);

      await finalise(
        sql,
        tenantId,
        job,
        verdict.kind === "hold"
          ? {
              kind: "retry",
              code: `HELD_${credential.reason}`.slice(0, 64)
            }
          : {
              kind: "fail",
              code: verdict.code,
              outcome: "needs_reauth"
            },
        clock(),
        ctx
      );
      continue;
    }

    const startedAt = clock();
    let providerOutcome: SocialPublishOutcome;

    try {
      providerOutcome = await callProvider(
        adapter,
        job,
        tenantId,
        credential.credential,
        http,
        options.correlationId
      );
    } catch {
      // The thrown message is never kept: it could carry a provider body or the
      // credential. A fixed code is all that is recorded.
      log("error", "social_publishing.dispatch.adapter_threw", {
        tenantId,
        moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
        provider: job.provider
      });
      providerOutcome = { outcome: "retryable", errorCode: "ADAPTER_ERROR" };
    }

    const durationMs = clock().getTime() - startedAt.getTime();

    switch (providerOutcome.outcome) {
      case "published": {
        breaker.recordSuccess(clock(), durationMs);

        const rawId = String(providerOutcome.externalPostId ?? "").trim();
        const rawUrl = providerOutcome.externalPostUrl;

        await finalise(
          sql,
          tenantId,
          job,
          {
            kind: "published",
            // An adapter bug (an empty id, a non-https URL) must not make the
            // finalise statement violate a CHECK: that would leave the job
            // `publishing`, and its lease would expire into a SECOND post.
            externalPostId: rawId.length > 0 ? rawId.slice(0, 255) : "unknown",
            externalPostUrl:
              typeof rawUrl === "string" && isSafeLinkUrl(rawUrl)
                ? rawUrl
                : null
          },
          clock(),
          ctx
        );
        break;
      }
      case "retryable":
        breaker.recordFailure(clock(), durationMs);
        await finalise(
          sql,
          tenantId,
          job,
          {
            kind: "retry",
            code: sanitizeCode(
              providerOutcome.errorCode,
              "ADAPTER_ERROR",
              adapter.errorCodes
            )
          },
          clock(),
          ctx
        );
        break;
      case "rate_limited":
        await finalise(
          sql,
          tenantId,
          job,
          {
            kind: "retry",
            code: sanitizeCode(
              providerOutcome.errorCode,
              "RATE_LIMITED",
              adapter.errorCodes
            ),
            retryAfterSeconds: providerOutcome.retryAfterSeconds ?? 1
          },
          clock(),
          ctx
        );
        break;
      case "needs_reauth":
        await finalise(
          sql,
          tenantId,
          job,
          { kind: "fail", code: "NEEDS_REAUTH", outcome: "needs_reauth" },
          clock(),
          ctx
        );
        break;
      default:
        await finalise(
          sql,
          tenantId,
          job,
          {
            kind: "fail",
            code: sanitizeCode(
              (providerOutcome as { errorCode?: string }).errorCode ?? "",
              "REJECTED",
              adapter.errorCodes
            ),
            outcome: "rejected"
          },
          clock(),
          ctx
        );
    }
  }

  return result;
}
