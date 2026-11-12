/**
 * The publish dispatcher (Issue #1145, ADR-0157 section 6): claim, send,
 * finalise, one tenant per call. Run by `bun run social-publishing:dispatch`
 * as its OWN database role, `awcms_social_dispatch` (sql/358 + sql/373).
 *
 * ## Where the credential comes from (ADR-0157 section 6, Issue #1146)
 *
 * From a `ChannelPublisherCredentialPort`. The script that runs this
 * (`scripts/social-publishing-dispatch.ts`) composes the REAL one only when a
 * connector is switched on (`SOCIAL_PUBLISHING_FACEBOOK_ENABLED`); otherwise it
 * hands {@link noPublishCredentialPort}, which refuses every request. Either way
 * the job never runs as `awcms_worker` (which `whatsapp:dispatch` shares, with
 * the same key ring) and never holds that role's login: a compromised WhatsApp
 * worker still cannot decrypt a social token, and a compromised social
 * dispatcher cannot decrypt a WhatsApp one. With no adapter for a provider a
 * claimed job fails closed as `PROVIDER_ADAPTER_UNAVAILABLE` before any
 * credential is asked for.
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
 * 2. SEND (no transaction): in a transaction of its own that closes before the
 *    call, RE-CHECK the source (below) and only then decrypt the credential;
 *    hand it to the adapter in memory, call the
 *    provider with an `ssrfSafeFetch` client bound to the call's abort signal
 *    (a timeout CANCELS the request, it does not abandon it), no redirects, and a
 *    per-account circuit breaker.
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
 *   cannot send it again.
 * - An UNKNOWN outcome is never retried blindly (the #1145 audit, M1). A timeout,
 *   or an adapter that threw after the request was sent, may have published. For a
 *   provider that dedupes on the idempotency key (`adapter.supportsIdempotencyKey`)
 *   the job is retried automatically with the same key; for any other the job
 *   becomes `needs_reconciliation` and only an operator, who confirms the post is
 *   not already there, retries it. The same applies to a crash between "the
 *   provider accepted the post" and "the job is finalised" (the lease expires and
 *   the job is claimed again): that window, a slow provider and a lost response
 *   are all the same case, and for a provider without a dedupe key the only
 *   protection is the operator, not the dispatcher.
 * - A source that can no longer be published is never sent (ADR-0157 L8). The
 *   snapshot decides WHAT is sent; immediately before the call the dispatcher
 *   asks the modules that own the facts whether it may still be sent at all: the
 *   source article through `ArticlePublicationStatusPort` (`blog_content`) and
 *   the media object through `MediaPublicationRecheckPort` (`media_library`).
 *   An article unpublished, archived, made private or deleted after enqueue
 *   (`SOURCE_RETRACTED`), a media object taken down (`MEDIA_UNAVAILABLE`) or
 *   whose rights were withdrawn (`MEDIA_RIGHTS_REVOKED`) fails the job
 *   terminally: no credential is decrypted, the provider is not called, the
 *   breaker is not charged, nothing retries it, and the audit row carries ids
 *   and the code only. A check that cannot be answered (a database error) is
 *   never read as "may send": the job waits and is retried
 *   (`SOURCE_CHECK_UNAVAILABLE`), within its retry budget.
 * - The credential is in memory for one call, is never logged, stored, evented,
 *   audited or put in an error, and a thrown adapter error's MESSAGE is never
 *   kept (only a fixed code).
 */
import type {
  ChannelPublisherCredentialPort,
  ChannelPublisherHealthPort,
  ChannelPublisherPort,
  PublisherUnavailableReason
} from "../../_shared/ports/channel-account-port";
import { ssrfSafeFetch } from "../../../lib/auth/ssrf-guard";
import { getProviderCircuitBreaker } from "../../../lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../../lib/database/tenant-context";
import { log } from "../../../lib/logging/logger";
import { resolveModuleEnabled } from "../../identity-access/application/auth-context";
import { recordAuditEvent } from "../../logging/application/audit-log";
import type { ArticlePublicationStatusPort } from "../../_shared/ports/article-publication-status-port";
import type {
  MediaPublicationRecheckPort,
  MediaPublicationRefusal
} from "../../_shared/ports/media-library-port";
import type {
  SocialPublishAdapter,
  SocialPublishContent,
  SocialPublishHttp,
  SocialPublishOutcome
} from "../domain/social-publish-adapter";
import type { MediaSnapshot } from "../domain/social-publish-content";
import {
  acceptExternalPostId,
  acceptExternalPostUrl
} from "../domain/social-publish-post-reference";
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

/**
 * The two questions asked immediately before every provider call (ADR-0157
 * L8). REQUIRED: a dispatcher that cannot ask them cannot be composed, so there
 * is no "unchecked" default to fall back to.
 */
export type PublicationSourceChecks = {
  articles: ArticlePublicationStatusPort;
  media: MediaPublicationRecheckPort;
};

export type DispatchSocialPublishOptions = {
  publishers: ChannelPublisherPort;
  credentials: ChannelPublisherCredentialPort;
  sources: PublicationSourceChecks;
  /**
   * Where a credential the PROVIDER refused is reported (Issue #1146): the
   * account goes `degraded`, so its other jobs are held, not failed one by one.
   * Absent, the job still fails `NEEDS_REAUTH` and nothing else changes.
   */
  health?: ChannelPublisherHealthPort;
  registry?: SocialAdapterRegistry;
  env?: NodeJS.ProcessEnv;
  /** The dispatch clock. Tests pass a fixed one; everything time-shaped here (due, lease, cap window, backoff) uses it. */
  clock?: () => Date;
  correlationId?: string;
  limit?: number;
  perAccountBatch?: number;
  accountDailyCap?: number;
  leaseMinutes?: number;
  /** How long the dispatcher waits for ONE provider call before it cancels it. */
  providerTimeoutMs?: number;
  /** Replaces the `ssrfSafeFetch`-backed client handed to adapters (given the call's abort signal). Tests only. */
  http?: (signal: AbortSignal) => SocialPublishHttp;
};

export type DispatchSocialPublishResult = {
  claimed: number;
  published: number;
  retried: number;
  failed: number;
  held: number;
  /** The outcome was unknown and the adapter's provider does not dedupe: the job now waits for an operator. */
  unknown: number;
  /** Finalise found the job no longer ours (lease expired and re-claimed): nothing was written. */
  superseded: number;
  skippedBreaker: number;
  skippedQuota: number;
  /** Another dispatcher held the account's lock: not claimed in this pass, taken by the next. */
  skippedBusy: number;
};

type Candidate = {
  id: string;
  /** `publishing` here means the LEASE EXPIRED (a due `publishing` row): an unknown outcome. */
  status: "queued" | "retry_wait" | "publishing";
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
  /** Which source the publication names: re-checked before the call (L8). */
  source_kind: "article" | "manual";
  source_id: string | null;
  media_object_id: string | null;
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
    unknown: 0,
    superseded: 0,
    skippedBreaker: 0,
    skippedQuota: 0,
    skippedBusy: 0
  };
}

/** Fixed, code-defined phrases: a provider body or a thrown message never reaches a row. */
const PHRASES: Record<string, string> = {
  PUBLISHED: "Published.",
  PROVIDER_ADAPTER_UNAVAILABLE: "No adapter is registered for this provider.",
  ADAPTER_ERROR: "The provider adapter failed unexpectedly.",
  PROVIDER_TIMEOUT: "The provider did not answer in time.",
  INVALID_POST_ID:
    "The provider reported a post this adapter cannot identify: the post may exist. An operator must check before it is sent again.",
  UNKNOWN_OUTCOME:
    "The outcome is unknown: the post may already exist. An operator must check before it is sent again.",
  CIRCUIT_OPEN: "The provider was failing; the attempt was not made.",
  RETRIES_EXHAUSTED: "The retry budget is spent.",
  HOLD_EXHAUSTED: "The account stayed unavailable for too long.",
  NEEDS_REAUTH: "The account must be re-authorised.",
  REJECTED: "The provider refused this content.",
  SOURCE_RETRACTED:
    "The source article is no longer published; nothing was sent.",
  MEDIA_UNAVAILABLE:
    "The media object is no longer available; nothing was sent.",
  MEDIA_RIGHTS_REVOKED:
    "The media object's rights no longer clear it; nothing was sent.",
  SOURCE_CHECK_UNAVAILABLE:
    "Whether the source may still be published could not be checked; nothing was sent."
};

/** The terminal verdicts of the source re-check: the job is never sent and never retried by the dispatcher. */
type SourceWithdrawnCode = "SOURCE_RETRACTED" | MediaPublicationRefusal;

/** What the pre-send transaction decided. Only `checked` may go on to a provider call. */
type PreSend =
  | { kind: "unchecked"; sqlState: string | null }
  | { kind: "withdrawn"; code: SourceWithdrawnCode }
  | {
      kind: "checked";
      credential: Awaited<
        ReturnType<ChannelPublisherCredentialPort["resolvePublishCredential"]>
      >;
    };

const SOURCE_WITHDRAWN_CODES: ReadonlySet<string> =
  new Set<SourceWithdrawnCode>([
    "SOURCE_RETRACTED",
    "MEDIA_UNAVAILABLE",
    "MEDIA_RIGHTS_REVOKED"
  ]);

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

/**
 * The ONLY network primitive an adapter has. `maxRedirects: 0`: a provider API
 * does not redirect a publish call, and the shared guard forwards request headers
 * (an `Authorization` bearer among them) to the redirect target, so following one
 * could hand a credential to another origin (the #1145 audit, M3). `signal`
 * cancels the in-flight request when the dispatcher gives up.
 */
export function buildAdapterHttp(
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  timeoutMs: number = PROVIDER_CALL_TIMEOUT_MS
): SocialPublishHttp {
  return (url, init) =>
    ssrfSafeFetch(url, {
      timeoutMs,
      maxRedirects: 0,
      signal,
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
    registry: SocialAdapterRegistry;
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
      SELECT j.id, j.status, j.publication_id, j.channel_account_id, j.provider,
             j.account_kind, j.variant, j.attempt_count, j.max_attempts,
             j.hold_count, j.idempotency_key, p.title, p.caption, p.link_url,
             p.media_snapshot, p.source_kind, p.source_id, p.media_object_id
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
      //
      // TRY, never wait (PR #1261 follow-up, a real 40P01 in CI): the work
      // order above is fairness order (first appearance), and two dispatchers
      // can meet the same accounts in OPPOSITE orders, so a blocking lock per
      // account can deadlock. An account another dispatcher holds right now is
      // skipped for this pass (`skippedBusy`) and taken by the next one; its
      // rows were never claimed, so nothing is lost. The quota semantics are
      // unchanged: the cap is still decided only while this lock is held.
      const locked = (await tx`
        SELECT pg_try_advisory_xact_lock(hashtextextended(${`social_publishing:${tenantId}:${accountId}`}, 0)) AS ok
      `) as { ok: boolean }[];

      if (locked[0]?.ok !== true) {
        result.skippedBusy += rows.length;
        continue;
      }

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
        const dedupes =
          options.registry.get(row.provider)?.supportsIdempotencyKey === true;

        // A `publishing` row whose lease expired is a request whose answer was
        // lost (a crash, an OOM, a redeploy after the provider accepted it): the
        // post may already be public (M-1 of the #1145 re-audit). Only a provider
        // that dedupes on the idempotency key can be sent it again; for every
        // other the job waits for an operator. `sql/330` refuses the re-claim of a
        // non-deduping job as well.
        if (row.status === "publishing" && !dedupes) {
          await reconcileExpiredLease(tx, tenantId, row, now, {
            correlationId: options.correlationId,
            result
          });
          continue;
        }

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
              dedupe_key_supported = ${dedupes},
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

/**
 * A due `publishing` job of a provider that does not dedupe: the lease expired,
 * so the outcome of the claimed attempt is UNKNOWN. It is never sent again by the
 * dispatcher; an operator reconciles it.
 */
async function reconcileExpiredLease(
  tx: Bun.SQL,
  tenantId: string,
  row: Pick<
    Candidate,
    | "id"
    | "publication_id"
    | "channel_account_id"
    | "provider"
    | "attempt_count"
  >,
  now: Date,
  context: {
    correlationId: string | undefined;
    result: DispatchSocialPublishResult;
  }
): Promise<void> {
  const rows = (await tx`
    UPDATE awcms_social_publish_jobs
    SET status = 'needs_reconciliation', failure_code = 'LEASE_EXPIRED_UNKNOWN',
        last_error = ${PHRASES.UNKNOWN_OUTCOME}, updated_at = ${now}::timestamptz
    WHERE tenant_id = ${tenantId} AND id = ${row.id} AND status = 'publishing'
    RETURNING id
  `) as { id: string }[];

  if (rows.length === 0) return;

  await tx`
    INSERT INTO awcms_social_publish_attempts
      (tenant_id, job_id, attempt_no, outcome, error_code, error_message)
    VALUES (${tenantId}, ${row.id}, ${row.attempt_count}, 'unknown',
            'LEASE_EXPIRED_UNKNOWN', ${PHRASES.UNKNOWN_OUTCOME})
    ON CONFLICT (job_id, attempt_no) DO NOTHING
  `;
  await recordAuditEvent(tx, {
    tenantId,
    moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
    action: "social_publishing.job.outcome_unknown",
    resourceType: "social_publish_job",
    resourceId: row.id,
    severity: "warning",
    message:
      "A social publish job lost its lease while in flight; its outcome is unknown and it waits for an operator.",
    attributes: {
      publicationId: row.publication_id,
      accountId: row.channel_account_id,
      provider: row.provider,
      attemptNo: row.attempt_count,
      code: "LEASE_EXPIRED_UNKNOWN"
    },
    correlationId: context.correlationId
  });
  context.result.unknown += 1;
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
  | { kind: "unknown"; code: string }
  | {
      kind: "fail";
      code: string;
      outcome: "needs_reauth" | "rejected" | "retryable";
      /** The provider itself refused the credential: degrade the account (Issue #1146). */
      credentialRejected?: boolean;
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
    health?: ChannelPublisherHealthPort;
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

    if (outcome.kind === "unknown") {
      const rows = (await tx`
        UPDATE awcms_social_publish_jobs
        SET status = 'needs_reconciliation', failure_code = ${outcome.code},
            last_error = ${PHRASES.UNKNOWN_OUTCOME},
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
        VALUES (${tenantId}, ${job.id}, ${job.attemptNo}, 'unknown',
                ${outcome.code}, ${PHRASES.UNKNOWN_OUTCOME})
        ON CONFLICT (job_id, attempt_no) DO NOTHING
      `;
      await recordAuditEvent(tx, {
        tenantId,
        moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
        action: "social_publishing.job.outcome_unknown",
        resourceType: "social_publish_job",
        resourceId: job.id,
        severity: "warning",
        message:
          "A social publish job's outcome is unknown; it waits for an operator and will not be retried automatically.",
        attributes: {
          publicationId: job.publication_id,
          accountId: job.channel_account_id,
          provider: job.provider,
          attemptNo: job.attemptNo,
          code: outcome.code
        },
        correlationId: context.correlationId
      });
      context.result.unknown += 1;

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

    // The provider refused the account's credential (Issue #1146): the
    // account itself is degraded in the same transaction, so every other job of
    // it is HELD at its next claim instead of being sent with a dead token.
    const accountDegraded =
      outcome.kind === "fail" &&
      outcome.credentialRejected === true &&
      context.health !== undefined
        ? (
            await context.health.reportPublishCredentialRejected(tx, {
              tenantId,
              accountId: job.channel_account_id
            })
          ).recorded
        : false;

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
      message: SOURCE_WITHDRAWN_CODES.has(finalCode)
        ? "A social publish job was stopped before sending: its source can no longer be published."
        : "A social publish job failed.",
      attributes: {
        publicationId: job.publication_id,
        accountId: job.channel_account_id,
        provider: job.provider,
        attemptNo: job.attemptNo,
        failureCode: finalCode,
        accountDegraded
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

/**
 * `ssrfSafeFetch` collapses "could not connect" and "the request was sent and the
 * answer was lost" into `request_failed`. Of its results these mean the provider
 * MAY have processed the request (L-7 of the #1145 re-audit); the others
 * (`invalid_url`, `scheme_not_allowed`, `credentials_in_url`,
 * `dns_resolution_failed`, `blocked_address`) mean nothing was ever sent.
 */
const AMBIGUOUS_HTTP_REASONS: ReadonlySet<string> = new Set([
  "request_failed",
  "response_too_large",
  "too_many_redirects"
]);

type ProviderCall =
  | {
      kind: "adapter";
      outcome: SocialPublishOutcome;
      /** Some `request.http` call ended ambiguously: an adapter's `retryable` is then not believed. */
      ambiguousHttp: boolean;
    }
  /** The dispatcher's OWN verdicts (never an adapter-supplied string, so they are never rewritten by the adapter's vocabulary). */
  | { kind: "dispatcher"; code: "PROVIDER_TIMEOUT" | "ADAPTER_ERROR" };

/**
 * One provider call, bounded in time. On the deadline the call's signal fires,
 * which cancels the in-flight request (`request.http` is bound to it), and the
 * result is a dispatcher-owned `PROVIDER_TIMEOUT`: the request may already have
 * been processed, so the caller treats it as UNKNOWN, never as "not sent". A
 * late completion of an abandoned adapter promise is ignored.
 */
async function callProvider(
  adapter: SocialPublishAdapter,
  job: Claimed,
  tenantId: string,
  credential: string,
  buildHttp: (signal: AbortSignal) => SocialPublishHttp,
  correlationId: string | undefined,
  timeoutMs: number
): Promise<ProviderCall> {
  const controller = new AbortController();
  let ambiguousHttp = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const trackedHttp = (signal: AbortSignal): SocialPublishHttp => {
    const inner = buildHttp(signal);

    return async (url, init) => {
      const result = await inner(url, init);

      if (!result.ok && AMBIGUOUS_HTTP_REASONS.has(result.reason)) {
        ambiguousHttp = true;
      }

      return result;
    };
  };
  const timedOut = new Promise<ProviderCall>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "dispatcher", code: "PROVIDER_TIMEOUT" });
    }, timeoutMs);
  });
  const call = (async (): Promise<ProviderCall> => {
    try {
      const outcome = await adapter.publish({
        tenantId,
        accountId: job.channel_account_id,
        provider: job.provider,
        accountKind: job.account_kind,
        externalId: job.externalId,
        credential,
        content: toContent(job),
        idempotencyKey: job.idempotency_key,
        correlationId,
        http: trackedHttp(controller.signal),
        signal: controller.signal
      });

      return { kind: "adapter", outcome, ambiguousHttp };
    } catch {
      // The thrown message is never kept: it could carry a provider body or the
      // credential. A fixed code is all that is recorded.
      log("error", "social_publishing.dispatch.adapter_threw", {
        tenantId,
        moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
        provider: job.provider
      });

      return { kind: "dispatcher", code: "ADAPTER_ERROR" };
    }
  })();

  try {
    return await Promise.race([call, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What an AMBIGUOUS result (a timeout, a throw, an adapter's own `unknown`) does
 * to a job. A provider that dedupes on the idempotency key makes a retry safe, so
 * it is retried with the same key; any other provider may already have published,
 * so the job waits for an operator.
 */
function ambiguous(adapter: SocialPublishAdapter, code: string): FinalOutcome {
  return adapter.supportsIdempotencyKey
    ? { kind: "retry", code }
    : { kind: "unknown", code };
}

/**
 * The SQLSTATE of a thrown database error (Bun.SQL carries it on `errno`), or
 * `null`. Only a five-character code is kept: never the message.
 */
function sqlStateOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = (error as { errno?: unknown; code?: unknown }).errno;

  return typeof candidate === "string" && /^[0-9A-Z]{5}$/.test(candidate)
    ? candidate
    : null;
}

/**
 * The L8 re-check (ADR-0157): may this claimed job's source still be published?
 * Asked in the pre-send transaction, before any credential is decrypted. The
 * article is checked first (a retracted article makes its media moot), then the
 * media object, if the publication carries one. `null` means "may be sent".
 */
async function recheckSource(
  tx: Bun.SQL,
  tenantId: string,
  job: Claimed,
  sources: PublicationSourceChecks
): Promise<SourceWithdrawnCode | null> {
  if (job.source_kind === "article") {
    // sql/330 guarantees an article publication names its article; a row that
    // somehow does not is treated as retracted, never as "nothing to check".
    if (job.source_id === null) return "SOURCE_RETRACTED";

    const article = await sources.articles.checkArticlePublished(tx, {
      tenantId,
      articleId: job.source_id
    });

    if (!article.published) return article.reason;
  }

  // The snapshot and the media reference are set together (sql/330 CHECK); a
  // snapshot without its reference cannot be re-checked, so it is not sent.
  if (job.media_snapshot !== null && job.media_object_id === null) {
    return "MEDIA_UNAVAILABLE";
  }

  if (job.media_object_id !== null) {
    const media = await sources.media.recheckMediaForPublication(tx, {
      tenantId,
      mediaObjectId: job.media_object_id
    });

    if (!media.eligible) return media.reason;
  }

  return null;
}

/**
 * The credential port of a dispatcher that may NOT read a social credential
 * (the #1145 audit, H1): every request is refused, so nothing can be published
 * through it. The default composition while no connector is switched on; the
 * real port is composed only behind `SOCIAL_PUBLISHING_FACEBOOK_ENABLED`, on the
 * separate DB role (ADR-0157 section 6, Issue #1146).
 */
export const noPublishCredentialPort: ChannelPublisherCredentialPort = {
  async resolvePublishCredential() {
    return { ok: false, reason: "CREDENTIAL_UNAVAILABLE" };
  }
};

export async function dispatchSocialPublishQueue(
  sql: Bun.SQL,
  tenantId: string,
  options: DispatchSocialPublishOptions
): Promise<DispatchSocialPublishResult> {
  const env = options.env ?? process.env;
  const result = zero();

  // The deployment switch: nothing is claimed, nothing is read.
  if (!isSocialPublishingEnabled(env)) return result;

  // A tenant that switched the module OFF stops being enqueued AND dispatched
  // (the #1145 audit, M4). A failed read throws: it is never read as "enabled".
  const enabled = await inTenantWork(sql, tenantId, (tx) =>
    resolveModuleEnabled(tx, tenantId, SOCIAL_PUBLISHING_MODULE_KEY)
  );

  if (!enabled) return result;

  const clock = options.clock ?? (() => new Date());
  const registry = options.registry ?? socialAdapterRegistry;
  const providerTimeoutMs =
    options.providerTimeoutMs ?? PROVIDER_CALL_TIMEOUT_MS;
  const buildHttp =
    options.http ??
    ((signal: AbortSignal) => buildAdapterHttp(env, signal, providerTimeoutMs));
  const leaseMinutes = options.leaseMinutes ?? DISPATCH_LEASE_MINUTES;
  const limit = options.limit ?? DISPATCH_DEFAULT_LIMIT;

  // The jobs of one pass are sent one after another, each for at most
  // `providerTimeoutMs`. If the whole pass could outlast the lease, a job still
  // waiting its turn would have an EXPIRED lease while this very pass is about to
  // send it, and the next pass would treat it as lost (M-1 of the re-audit).
  if (limit * providerTimeoutMs >= leaseMinutes * 60_000) {
    throw new Error(
      "social-publishing dispatch: limit x providerTimeoutMs must be below the lease; lower the limit or the timeout, or lengthen the lease."
    );
  }

  const claimed = await claim(sql, tenantId, {
    publishers: options.publishers,
    registry,
    now: clock(),
    correlationId: options.correlationId,
    result,
    limit,
    perAccountBatch: options.perAccountBatch ?? DISPATCH_PER_ACCOUNT_BATCH,
    accountDailyCap: options.accountDailyCap ?? DEFAULT_ACCOUNT_DAILY_CAP,
    leaseMinutes
  });

  result.claimed = claimed.length;

  const ctx = {
    correlationId: options.correlationId,
    result,
    health: options.health
  };

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

    // The pre-send transaction, which CLOSES before the provider call: first
    // the source re-check (ADR-0157 L8) and, only when it passes, the
    // credential. A refusal is a returned value; a database error inside the
    // re-check is a "could not check" (never "may send"); one in the credential
    // read throws (and that job's lease simply expires and it is claimed again).
    const preSend = await inTenantWork(
      sql,
      tenantId,
      async (tx): Promise<PreSend> => {
        let withdrawn: SourceWithdrawnCode | null;

        try {
          // A savepoint: a failed check rolls back to it and leaves the
          // transaction usable (nothing else runs in it anyway).
          withdrawn = await tx.savepoint((sp) =>
            recheckSource(sp, tenantId, job, options.sources)
          );
        } catch (error) {
          // The thrown MESSAGE is never kept (it is a database error that may
          // quote a value); only its SQLSTATE is, for the operator (#1274 L6).
          return { kind: "unchecked", sqlState: sqlStateOf(error) };
        }

        if (withdrawn !== null) return { kind: "withdrawn", code: withdrawn };

        return {
          kind: "checked",
          credential: await options.credentials.resolvePublishCredential(tx, {
            tenantId,
            accountId: job.channel_account_id
          })
        };
      }
    );

    if (preSend.kind === "unchecked") {
      log("error", "social_publishing.dispatch.source_check_failed", {
        tenantId,
        moduleKey: SOCIAL_PUBLISHING_MODULE_KEY,
        provider: job.provider,
        jobId: job.id,
        sqlState: preSend.sqlState
      });
      await finalise(
        sql,
        tenantId,
        job,
        { kind: "retry", code: "SOURCE_CHECK_UNAVAILABLE" },
        clock(),
        ctx
      );
      continue;
    }

    if (preSend.kind === "withdrawn") {
      await finalise(
        sql,
        tenantId,
        job,
        { kind: "fail", code: preSend.code, outcome: "rejected" },
        clock(),
        ctx
      );
      continue;
    }

    const credential = preSend.credential;

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
    const attempt = await callProvider(
      adapter,
      job,
      tenantId,
      credential.credential,
      buildHttp,
      options.correlationId,
      providerTimeoutMs
    );
    const durationMs = clock().getTime() - startedAt.getTime();

    if (attempt.kind === "dispatcher") {
      breaker.recordFailure(clock(), durationMs);
      await finalise(
        sql,
        tenantId,
        job,
        ambiguous(adapter, attempt.code),
        clock(),
        ctx
      );
      continue;
    }

    // A `retryable` after an ambiguous request is not believed: the provider
    // may have processed it (the adapter must say `unknown`; this is the
    // backstop, and an admission condition for every connector).
    const providerOutcome: SocialPublishOutcome =
      attempt.outcome.outcome === "retryable" && attempt.ambiguousHttp
        ? { outcome: "unknown", errorCode: attempt.outcome.errorCode }
        : attempt.outcome;

    switch (providerOutcome.outcome) {
      case "published": {
        breaker.recordSuccess(clock(), durationMs);

        // L6 of the #1145 audit: the id must be an identifier of the shape this
        // provider declares, or it is not stored at all. An id that is not one
        // means "the provider said published and we cannot name the post": the
        // post may exist and cannot be reconciled from the row, which is the
        // definition of an UNKNOWN outcome (never a second automatic post for a
        // provider that does not dedupe). Rejecting it here also keeps the
        // finalise statement from violating a CHECK (`sql/330`, `sql/359`),
        // which would leave the job `publishing` and let its lease expire.
        const postId = acceptExternalPostId(
          adapter.externalPostIdPattern,
          providerOutcome.externalPostId
        );

        if (postId === null) {
          await finalise(
            sql,
            tenantId,
            job,
            ambiguous(adapter, "INVALID_POST_ID"),
            clock(),
            ctx
          );
          break;
        }

        await finalise(
          sql,
          tenantId,
          job,
          {
            kind: "published",
            externalPostId: postId,
            // A URL on a host the adapter did not declare is DROPPED, not a
            // failure: the post exists, and the id is its identity.
            externalPostUrl: acceptExternalPostUrl(
              adapter.postUrlHosts,
              providerOutcome.externalPostUrl
            )
          },
          clock(),
          ctx
        );
        break;
      }
      case "unknown":
        breaker.recordFailure(clock(), durationMs);
        await finalise(
          sql,
          tenantId,
          job,
          ambiguous(
            adapter,
            sanitizeCode(
              providerOutcome.errorCode,
              "OUTCOME_UNKNOWN",
              adapter.errorCodes
            )
          ),
          clock(),
          ctx
        );
        break;
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
          {
            kind: "fail",
            code: "NEEDS_REAUTH",
            outcome: "needs_reauth",
            credentialRejected: true
          },
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
