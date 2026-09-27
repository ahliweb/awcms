/**
 * Persistence for the scheduled GitHub repository-progress poller (Issue
 * ahliweb/omes#249, ADR-0030). Separated from
 * `application/repository-progress-poller.ts` (pure GitHub fetch/mapping, no
 * database) the same way `hermes-orchestration-ingestion.ts` is separated
 * from `domain/hermes-orchestration.ts` — the network/mapping logic is unit
 * tested without a database, and the upsert logic here is exercised by the
 * integration test against real Postgres (RLS, idempotent upsert).
 *
 * `awcms_omes_repository_progress` holds ONE CURRENT row per tenant. A poll
 * failure NEVER clears a prior successful observation — only
 * `recordRepositoryProgressSuccess` ever writes `milestones`/`issues`/
 * `observed_at`; `recordRepositoryProgressError` touches only the
 * status/error columns, per ADR-0030's "the last successful `observed_at`
 * retained rather than discarded" requirement.
 */
import type {
  RepositoryProgressErrorClass,
  RepositoryProgressIssue,
  RepositoryProgressMilestone,
  RepositoryProgressView
} from "../domain/repository-progress";

export type PreviousRepositoryProgressState = {
  milestonesEtag: string | null;
  issuesEtag: string | null;
  milestones: RepositoryProgressMilestone[];
  issues: RepositoryProgressIssue[];
};

type RawProgressRow = {
  milestones_etag: string | null;
  issues_etag: string | null;
  milestones: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
};

function fromRawMilestone(
  raw: Record<string, unknown>
): RepositoryProgressMilestone {
  return {
    number: typeof raw.number === "number" ? raw.number : 0,
    title: typeof raw.title === "string" ? raw.title : "",
    state: raw.state === "closed" ? "closed" : "open",
    openIssues: typeof raw.open_issues === "number" ? raw.open_issues : 0,
    closedIssues: typeof raw.closed_issues === "number" ? raw.closed_issues : 0,
    dueOn: typeof raw.due_on === "string" ? raw.due_on : null,
    htmlUrl: typeof raw.html_url === "string" ? raw.html_url : ""
  };
}

function fromRawIssue(raw: Record<string, unknown>): RepositoryProgressIssue {
  const kind = raw.kind;
  return {
    number: typeof raw.number === "number" ? raw.number : 0,
    title: typeof raw.title === "string" ? raw.title : "",
    state: raw.state === "closed" ? "closed" : "open",
    labels: Array.isArray(raw.labels)
      ? raw.labels.filter((l): l is string => typeof l === "string")
      : [],
    milestoneNumber:
      typeof raw.milestone_number === "number" ? raw.milestone_number : null,
    kind:
      kind === "epic" || kind === "feature" || kind === "bug" || kind === "docs"
        ? kind
        : "other",
    htmlUrl: typeof raw.html_url === "string" ? raw.html_url : "",
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : ""
  };
}

/** The tenant's previously-stored projection state, for conditional-request/ETag reuse — `null` if no row exists yet (first-ever poll for this tenant/repository). */
export async function getPreviousRepositoryProgressState(
  tx: Bun.SQL,
  tenantId: string
): Promise<PreviousRepositoryProgressState | null> {
  const rows = (await tx`
    SELECT milestones_etag, issues_etag, milestones, issues
    FROM awcms_omes_repository_progress
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `) as RawProgressRow[];

  if (rows.length === 0) return null;
  const row = rows[0]!;
  return {
    milestonesEtag: row.milestones_etag,
    issuesEtag: row.issues_etag,
    milestones: (row.milestones ?? []).map(fromRawMilestone),
    issues: (row.issues ?? []).map(fromRawIssue)
  };
}

/** Upserts a fresh, successfully-observed projection. Idempotent — re-running with the same `view` produces the same stored row (safe for a job retried after a crash before its DB write). */
export async function recordRepositoryProgressSuccess(
  tx: Bun.SQL,
  tenantId: string,
  view: RepositoryProgressView,
  milestonesEtag: string | null,
  issuesEtag: string | null
): Promise<void> {
  await tx`
    INSERT INTO awcms_omes_repository_progress (
      tenant_id, owner, name, html_url, observed_at, source,
      milestones, issues, status, last_error_class, last_error_at,
      milestones_etag, issues_etag
    ) VALUES (
      ${tenantId}, ${view.repository.owner}, ${view.repository.name},
      ${view.repository.html_url}, ${view.observed_at}, ${view.source},
      ${view.milestones}::jsonb, ${view.issues}::jsonb,
      'ok', NULL, NULL, ${milestonesEtag}, ${issuesEtag}
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      owner = EXCLUDED.owner,
      name = EXCLUDED.name,
      html_url = EXCLUDED.html_url,
      observed_at = EXCLUDED.observed_at,
      source = EXCLUDED.source,
      milestones = EXCLUDED.milestones,
      issues = EXCLUDED.issues,
      status = 'ok',
      last_error_class = NULL,
      last_error_at = NULL,
      milestones_etag = EXCLUDED.milestones_etag,
      issues_etag = EXCLUDED.issues_etag,
      updated_at = now()
  `;
}

/** Records a successful poll that found no changes (both resources returned `304 Not Modified`) — bumps `observed_at` to `now` (freshness is real: a poll DID just run) without touching the stored milestones/issues/etags. No-op if no row exists yet (a `not_modified` outcome cannot happen without a prior ETag to send, which itself cannot exist without a prior row). */
export async function recordRepositoryProgressUnchanged(
  tx: Bun.SQL,
  tenantId: string,
  observedAt: string
): Promise<void> {
  await tx`
    UPDATE awcms_omes_repository_progress
    SET observed_at = ${observedAt}, status = 'ok', last_error_class = NULL,
        last_error_at = NULL, updated_at = now()
    WHERE tenant_id = ${tenantId}
  `;
}

/** Records a failed poll. NEVER writes `observed_at`/`milestones`/`issues` — a prior successful observation (if any) is retained exactly as-is, per ADR-0030. Inserts a placeholder row (status only, no data yet) if this is the tenant's first-ever poll attempt and it failed. */
export async function recordRepositoryProgressError(
  tx: Bun.SQL,
  tenantId: string,
  owner: string,
  name: string,
  errorClass: RepositoryProgressErrorClass,
  now: Date
): Promise<void> {
  const htmlUrl = `https://github.com/${owner}/${name}`;
  const nowIso = now.toISOString().replace(/\.\d{3}Z$/, "Z");

  await tx`
    INSERT INTO awcms_omes_repository_progress (
      tenant_id, owner, name, html_url, observed_at, status,
      last_error_class, last_error_at
    ) VALUES (
      ${tenantId}, ${owner}, ${name}, ${htmlUrl}, NULL, 'error',
      ${errorClass}, ${nowIso}
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      status = 'error',
      last_error_class = EXCLUDED.last_error_class,
      last_error_at = EXCLUDED.last_error_at,
      updated_at = now()
  `;
}
