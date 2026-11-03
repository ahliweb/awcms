/**
 * Reads and operator actions on publications and their per-account jobs (Issue
 * #1145, ADR-0157 sections 4 and 5). Plain SQL in the caller's tenant
 * transaction.
 *
 * ## No credential, no secret reference, no account label
 *
 * A job view names the account by id and provider; it never carries a token, a
 * reference to one, a page id or an account display name. The derived aggregate
 * status is computed here from the jobs, never stored.
 *
 * ## Actions are row-locked, one-way and idempotent where they can be
 *
 * Every action takes a row lock on the publication (`FOR NO KEY UPDATE`: it
 * must not conflict with the key-share lock a job insert's foreign key takes) or
 * on the job, so two
 * operators cannot interleave an approve and a cancel. `published` is terminal
 * (the database refuses any change to it); cancel stops only jobs that have not
 * been sent and reports how many were already out, so a partial failure is
 * visible and nothing is replayed.
 */
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  keysetCursorCreatedAtSql
} from "../../_shared/keyset-pagination";
import { deriveAggregateStatus } from "../domain/social-publish-retry";
import type { MediaSnapshot } from "../domain/social-publish-content";
import type {
  AggregateStatus,
  JobStatus,
  PublicationSourceKind,
  PublicationState,
  PublishVariant,
  SocialPublishTrigger
} from "../domain/social-publishing-constants";

export type JobView = {
  id: string;
  accountId: string;
  provider: string;
  variant: PublishVariant;
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  holdCount: number;
  nextAttemptAt: Date;
  failureCode: string | null;
  lastError: string | null;
  externalPostId: string | null;
  externalPostUrl: string | null;
  publishedAt: Date | null;
};

export type PublicationView = {
  id: string;
  sourceKind: PublicationSourceKind;
  sourceId: string | null;
  trigger: SocialPublishTrigger;
  state: PublicationState;
  /** Derived from the jobs; never stored. */
  status: AggregateStatus;
  refusalCode: string | null;
  title: string;
  caption: string;
  linkUrl: string | null;
  media: Pick<
    MediaSnapshot,
    "publicUrl" | "mimeType" | "sizeBytes" | "altText" | "creditLine"
  > | null;
  contentHash: string;
  notBefore: Date | null;
  approvalRequired: boolean;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  jobCounts: Record<JobStatus, number>;
  createdAt: Date;
};

type PublicationRow = {
  id: string;
  source_kind: PublicationSourceKind;
  source_id: string | null;
  trigger_event: SocialPublishTrigger;
  state: PublicationState;
  refusal_code: string | null;
  title: string;
  caption: string;
  link_url: string | null;
  media_snapshot: MediaSnapshot | null;
  content_hash: string;
  not_before: Date | null;
  approval_required: boolean;
  created_by: string | null;
  approved_by: string | null;
  approved_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
  created_at_cursor?: string;
};

type JobRow = {
  id: string;
  publication_id: string;
  channel_account_id: string;
  provider: string;
  variant: PublishVariant;
  status: JobStatus;
  attempt_count: number;
  max_attempts: number;
  hold_count: number;
  next_attempt_at: Date;
  failure_code: string | null;
  last_error: string | null;
  external_post_id: string | null;
  external_post_url: string | null;
  published_at: Date | null;
};

const PUBLICATION_COLUMNS = `
  id, source_kind, source_id, trigger_event, state, refusal_code, title,
  caption, link_url, media_snapshot, content_hash, not_before,
  approval_required, created_by, approved_by, approved_at, cancelled_at,
  cancel_reason, created_at`;

const EMPTY_COUNTS = (): Record<JobStatus, number> => ({
  queued: 0,
  publishing: 0,
  retry_wait: 0,
  published: 0,
  failed: 0,
  cancelled: 0,
  needs_reconciliation: 0
});

function toJobView(row: JobRow): JobView {
  return {
    id: row.id,
    accountId: row.channel_account_id,
    provider: row.provider,
    variant: row.variant,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    holdCount: row.hold_count,
    nextAttemptAt: row.next_attempt_at,
    failureCode: row.failure_code,
    lastError: row.last_error,
    externalPostId: row.external_post_id,
    externalPostUrl: row.external_post_url,
    publishedAt: row.published_at
  };
}

function toView(
  row: PublicationRow,
  counts: Record<JobStatus, number>
): PublicationView {
  const statuses: string[] = [];

  for (const [status, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) statuses.push(status);
  }

  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    trigger: row.trigger_event,
    state: row.state,
    status: deriveAggregateStatus(row.state, statuses),
    refusalCode: row.refusal_code,
    title: row.title,
    caption: row.caption,
    linkUrl: row.link_url,
    media: row.media_snapshot
      ? {
          publicUrl: row.media_snapshot.publicUrl,
          mimeType: row.media_snapshot.mimeType,
          sizeBytes: row.media_snapshot.sizeBytes,
          altText: row.media_snapshot.altText,
          creditLine: row.media_snapshot.creditLine
        }
      : null,
    contentHash: row.content_hash,
    notBefore: row.not_before,
    approvalRequired: row.approval_required,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    jobCounts: counts,
    createdAt: row.created_at
  };
}

async function countsFor(
  tx: Bun.SQL,
  tenantId: string,
  publicationIds: readonly string[]
): Promise<Map<string, Record<JobStatus, number>>> {
  const result = new Map<string, Record<JobStatus, number>>();

  for (const id of publicationIds) result.set(id, EMPTY_COUNTS());

  if (publicationIds.length === 0) return result;

  const rows = (await tx`
    SELECT publication_id, status, count(*)::int AS total
    FROM awcms_social_publish_jobs
    WHERE tenant_id = ${tenantId}
      AND publication_id IN ${tx(publicationIds as string[])}
    GROUP BY publication_id, status
  `) as { publication_id: string; status: JobStatus; total: number }[];

  for (const row of rows) {
    const counts = result.get(row.publication_id);

    if (counts) counts[row.status] = row.total;
  }

  return result;
}

export type ListPublicationsQuery = {
  limit: number;
  cursor: string | null;
  state: PublicationState | null;
};

export type ListPublicationsResult =
  | { ok: true; items: PublicationView[]; nextCursor: string | null }
  | { ok: false; code: "INVALID_CURSOR" };

export async function listPublications(
  tx: Bun.SQL,
  tenantId: string,
  query: ListPublicationsQuery
): Promise<ListPublicationsResult> {
  const cursor = query.cursor ? decodeKeysetCursor(query.cursor) : null;

  if (query.cursor && !cursor) return { ok: false, code: "INVALID_CURSOR" };

  const rows = (await tx`
    SELECT ${tx.unsafe(PUBLICATION_COLUMNS)},
           ${tx.unsafe(keysetCursorCreatedAtSql())} AS created_at_cursor
    FROM awcms_social_publications
    WHERE tenant_id = ${tenantId}
      AND (${query.state}::text IS NULL OR state = ${query.state})
      AND (${cursor?.createdAt ?? null}::timestamptz IS NULL
           OR (created_at, id) <
              (${cursor?.createdAt ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
    ORDER BY created_at DESC, id DESC
    LIMIT ${query.limit + 1}
  `) as PublicationRow[];

  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const counts = await countsFor(
    tx,
    tenantId,
    page.map((row) => row.id)
  );

  return {
    ok: true,
    items: page.map((row) => toView(row, counts.get(row.id) ?? EMPTY_COUNTS())),
    nextCursor:
      rows.length > query.limit && last
        ? encodeKeysetCursor(last.created_at_cursor!, last.id)
        : null
  };
}

export async function fetchPublication(
  tx: Bun.SQL,
  tenantId: string,
  publicationId: string
): Promise<{ publication: PublicationView; jobs: JobView[] } | null> {
  const rows = (await tx`
    SELECT ${tx.unsafe(PUBLICATION_COLUMNS)}
    FROM awcms_social_publications
    WHERE tenant_id = ${tenantId} AND id = ${publicationId}
  `) as PublicationRow[];

  if (!rows[0]) return null;

  const jobRows = (await tx`
    SELECT id, publication_id, channel_account_id, provider, variant, status,
           attempt_count, max_attempts, hold_count, next_attempt_at,
           failure_code, last_error, external_post_id, external_post_url,
           published_at
    FROM awcms_social_publish_jobs
    WHERE tenant_id = ${tenantId} AND publication_id = ${publicationId}
    ORDER BY created_at, id
  `) as JobRow[];
  const counts = EMPTY_COUNTS();

  for (const job of jobRows) counts[job.status] += 1;

  return {
    publication: toView(rows[0], counts),
    jobs: jobRows.map(toJobView)
  };
}

/** The accounts a publication's jobs target (any status), for the per-account access check an action needs. */
export async function listJobAccountIds(
  tx: Bun.SQL,
  tenantId: string,
  publicationId: string
): Promise<string[]> {
  const rows = (await tx`
    SELECT channel_account_id FROM awcms_social_publish_jobs
    WHERE tenant_id = ${tenantId} AND publication_id = ${publicationId}
    ORDER BY created_at, id
  `) as { channel_account_id: string }[];

  return rows.map((row) => row.channel_account_id);
}

type LockedPublication = {
  id: string;
  state: PublicationState;
  source_kind: PublicationSourceKind;
  created_by: string | null;
};

async function lockPublication(
  tx: Bun.SQL,
  tenantId: string,
  publicationId: string
): Promise<LockedPublication | null> {
  const rows = (await tx`
    SELECT id, state, source_kind, created_by
    FROM awcms_social_publications
    WHERE tenant_id = ${tenantId} AND id = ${publicationId}
    FOR NO KEY UPDATE
  `) as LockedPublication[];

  return rows[0] ?? null;
}

export type ActionOutcome<T> =
  | ({ outcome: "ok" } & T)
  | { outcome: "not_found" }
  | {
      outcome: "refused";
      code:
        | "PUBLICATION_STATE_INVALID"
        | "SELF_APPROVAL_FORBIDDEN"
        | "ALREADY_DISPATCHED"
        | "JOB_STATE_INVALID"
        | "JOB_ALREADY_PUBLISHED"
        | "RECONCILIATION_CONFIRMATION_REQUIRED"
        | "RETRY_BUDGET_EXHAUSTED";
    };

export async function approvePublication(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  publicationId: string
): Promise<ActionOutcome<{ alreadyApproved: boolean }>> {
  const locked = await lockPublication(tx, tenantId, publicationId);

  if (!locked) return { outcome: "not_found" };

  if (locked.state === "ready") {
    // Idempotent: approving what is already approved changes nothing.
    return { outcome: "ok", alreadyApproved: true };
  }

  if (locked.state !== "pending_approval") {
    return { outcome: "refused", code: "PUBLICATION_STATE_INVALID" };
  }

  // Maker and checker: the person who composed a manual publication cannot be
  // the one who releases it. (An article event has no human creator.)
  if (
    locked.source_kind === "manual" &&
    locked.created_by !== null &&
    locked.created_by === actorTenantUserId
  ) {
    return { outcome: "refused", code: "SELF_APPROVAL_FORBIDDEN" };
  }

  await tx`
    UPDATE awcms_social_publications
    SET state = 'ready', approved_by = ${actorTenantUserId},
        approved_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${publicationId}
  `;

  return { outcome: "ok", alreadyApproved: false };
}

export async function cancelPublication(
  tx: Bun.SQL,
  tenantId: string,
  actorTenantUserId: string,
  publicationId: string,
  reason: string | null
): Promise<
  ActionOutcome<{
    alreadyCancelled: boolean;
    jobsCancelled: number;
    jobsAlreadyPublished: number;
    jobsInFlight: number;
  }>
> {
  const locked = await lockPublication(tx, tenantId, publicationId);

  if (!locked) return { outcome: "not_found" };

  if (locked.state === "refused") {
    return { outcome: "refused", code: "PUBLICATION_STATE_INVALID" };
  }

  const alreadyCancelled = locked.state === "cancelled";

  if (!alreadyCancelled) {
    await tx`
      UPDATE awcms_social_publications
      SET state = 'cancelled', cancelled_by = ${actorTenantUserId},
          cancelled_at = now(), cancel_reason = ${reason}, updated_at = now()
      WHERE tenant_id = ${tenantId} AND id = ${publicationId}
    `;
  }

  // Only jobs that have NOT been sent. A job being sent right now is left to
  // finish (a send cannot be recalled), and a published job is terminal.
  const cancelled = (await tx`
    UPDATE awcms_social_publish_jobs
    SET status = 'cancelled', updated_at = now()
    WHERE tenant_id = ${tenantId} AND publication_id = ${publicationId}
      AND status IN ('queued', 'retry_wait', 'needs_reconciliation')
    RETURNING id
  `) as { id: string }[];
  const rest = (await tx`
    SELECT status, count(*)::int AS total
    FROM awcms_social_publish_jobs
    WHERE tenant_id = ${tenantId} AND publication_id = ${publicationId}
      AND status IN ('published', 'publishing')
    GROUP BY status
  `) as { status: string; total: number }[];

  return {
    outcome: "ok",
    alreadyCancelled,
    jobsCancelled: cancelled.length,
    jobsAlreadyPublished:
      rest.find((row) => row.status === "published")?.total ?? 0,
    jobsInFlight: rest.find((row) => row.status === "publishing")?.total ?? 0
  };
}

export async function schedulePublication(
  tx: Bun.SQL,
  tenantId: string,
  publicationId: string,
  notBefore: Date | null
): Promise<ActionOutcome<{ notBefore: Date | null }>> {
  const locked = await lockPublication(tx, tenantId, publicationId);

  if (!locked) return { outcome: "not_found" };

  if (locked.state !== "pending_approval" && locked.state !== "ready") {
    return { outcome: "refused", code: "PUBLICATION_STATE_INVALID" };
  }

  // Once any job has left the queue the publication has started: moving its
  // schedule would be a lie about something already done.
  const started = (await tx`
    SELECT 1 FROM awcms_social_publish_jobs
    WHERE tenant_id = ${tenantId} AND publication_id = ${publicationId}
      AND status NOT IN ('queued', 'cancelled')
    LIMIT 1
  `) as unknown[];

  if (started.length > 0) {
    return { outcome: "refused", code: "ALREADY_DISPATCHED" };
  }

  await tx`
    UPDATE awcms_social_publications
    SET not_before = ${notBefore}, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${publicationId}
  `;

  return { outcome: "ok", notBefore };
}

/** A manual retry grants a fresh, BOUNDED budget on top of what the job already spent. */
export const MANUAL_RETRY_EXTRA_ATTEMPTS = 3;
/** The database ceiling on `max_attempts` (`awcms_social_publish_jobs_attempts_check`). */
export const MAX_ATTEMPTS_CEILING = 50;

export type RetriedJob = {
  jobId: string;
  publicationId: string;
  accountId: string;
  /** What the job was before the retry cleared it (L-4 of the re-audit): the audit row records it. */
  previousStatus: JobStatus;
  previousFailureCode: string | null;
};

export async function lookupJobAccount(
  tx: Bun.SQL,
  tenantId: string,
  jobId: string
): Promise<{ accountId: string; publicationId: string } | null> {
  const rows = (await tx`
    SELECT channel_account_id, publication_id FROM awcms_social_publish_jobs
    WHERE tenant_id = ${tenantId} AND id = ${jobId}
  `) as { channel_account_id: string; publication_id: string }[];

  return rows[0]
    ? {
        accountId: rows[0].channel_account_id,
        publicationId: rows[0].publication_id
      }
    : null;
}

/**
 * Retries ONE job: a `failed` one, or one whose outcome is UNKNOWN
 * (`needs_reconciliation`), which may already be published. The latter needs
 * `confirmPossiblyPublished`: the operator states that they checked the account
 * and the post is not there (or that a duplicate is acceptable), because the
 * dispatcher itself will never send it again.
 */
export async function retryJob(
  tx: Bun.SQL,
  tenantId: string,
  jobId: string,
  options: { confirmPossiblyPublished: boolean } = {
    confirmPossiblyPublished: false
  }
): Promise<ActionOutcome<RetriedJob>> {
  const rows = (await tx`
    SELECT id, publication_id, channel_account_id, status, attempt_count,
           failure_code
    FROM awcms_social_publish_jobs
    WHERE tenant_id = ${tenantId} AND id = ${jobId}
    FOR UPDATE
  `) as {
    id: string;
    publication_id: string;
    channel_account_id: string;
    status: JobStatus;
    attempt_count: number;
    failure_code: string | null;
  }[];
  const job = rows[0];

  if (!job) return { outcome: "not_found" };

  if (job.status === "published") {
    return { outcome: "refused", code: "JOB_ALREADY_PUBLISHED" };
  }

  if (job.status !== "failed" && job.status !== "needs_reconciliation") {
    return { outcome: "refused", code: "JOB_STATE_INVALID" };
  }

  if (
    job.status === "needs_reconciliation" &&
    !options.confirmPossiblyPublished
  ) {
    return { outcome: "refused", code: "RECONCILIATION_CONFIRMATION_REQUIRED" };
  }

  // The new budget must fit the database ceiling; a job that has used all of it
  // is refused here with a 409 rather than failing the UPDATE with a 500.
  const nextMaxAttempts = Math.min(
    MAX_ATTEMPTS_CEILING,
    job.attempt_count + MANUAL_RETRY_EXTRA_ATTEMPTS
  );

  if (nextMaxAttempts <= job.attempt_count) {
    return { outcome: "refused", code: "RETRY_BUDGET_EXHAUSTED" };
  }

  const publication = await lockPublication(tx, tenantId, job.publication_id);

  if (!publication || publication.state !== "ready") {
    return { outcome: "refused", code: "PUBLICATION_STATE_INVALID" };
  }

  await tx`
    UPDATE awcms_social_publish_jobs
    SET status = 'queued', next_attempt_at = now(), hold_count = 0,
        max_attempts = ${nextMaxAttempts},
        failure_code = NULL, last_error = NULL, updated_at = now()
    WHERE tenant_id = ${tenantId} AND id = ${jobId}
      AND status IN ('failed', 'needs_reconciliation')
  `;

  return {
    outcome: "ok",
    jobId,
    publicationId: job.publication_id,
    accountId: job.channel_account_id,
    previousStatus: job.status,
    previousFailureCode: job.failure_code
  };
}
