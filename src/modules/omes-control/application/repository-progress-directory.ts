/**
 * Read-side query for `/admin/omes/progres-hermes` and
 * `GET /api/v1/omes/repository-progress` (Issue ahliweb/omes#249,
 * ADR-0030). Guarded by `omes_control.hermes_orchestration.read` (see
 * sql/167's header for why this reuses that permission rather than adding a
 * new one).
 *
 * Freshness is RECOMPUTED here at read time from `observed_at`, never
 * trusted from a stored flag — the same "recompute, never merely echo"
 * discipline `hermes-orchestration-directory.ts`/`ai-privacy-directory.ts`
 * already document. A poll that is currently failing (`status = 'error'`)
 * is surfaced as its own explicit state WITHOUT discarding the last
 * successfully observed milestones/issues (ADR-0030's "AWCMS consumption
 * expectations": "a poll that is currently failing ... the last successful
 * `observed_at` retained rather than discarded").
 */
import {
  classifyRepositoryProgressFreshness,
  DEFAULT_REPOSITORY_PROGRESS_POLL_INTERVAL_SECONDS,
  type RepositoryProgressErrorClass,
  type RepositoryProgressFreshness,
  type RepositoryProgressIssueKind
} from "../domain/repository-progress";
import { getRepositoryProgressConfig } from "./repository-progress-config";

export type RepositoryProgressMilestoneView = {
  number: number;
  title: string;
  state: "open" | "closed";
  openIssues: number;
  closedIssues: number;
  /** 0-100, rounded; `0` when the milestone has no issues yet (never `NaN`/`Infinity`). */
  percentDone: number;
  dueOn: string | null;
  htmlUrl: string;
};

export type RepositoryProgressIssueView = {
  number: number;
  title: string;
  state: "open" | "closed";
  kind: RepositoryProgressIssueKind;
  milestoneNumber: number | null;
  htmlUrl: string;
  updatedAt: string;
};

export type RepositoryProgressScreenState =
  | { state: "unconfigured" }
  | {
      state: "configured";
      repository: { owner: string; name: string; htmlUrl: string };
      observedAt: string | null;
      freshness: RepositoryProgressFreshness;
      pollStatus: "ok" | "error";
      lastErrorClass: RepositoryProgressErrorClass | null;
      milestones: RepositoryProgressMilestoneView[];
      issues: RepositoryProgressIssueView[];
    };

type ProgressRow = {
  owner: string;
  name: string;
  html_url: string;
  observed_at: Date | null;
  status: "ok" | "error";
  last_error_class: RepositoryProgressErrorClass | null;
  milestones: Array<Record<string, unknown>>;
  issues: Array<Record<string, unknown>>;
};

function toMilestoneView(
  raw: Record<string, unknown>
): RepositoryProgressMilestoneView {
  const open = typeof raw.open_issues === "number" ? raw.open_issues : 0;
  const closed = typeof raw.closed_issues === "number" ? raw.closed_issues : 0;
  const total = open + closed;
  return {
    number: typeof raw.number === "number" ? raw.number : 0,
    title: typeof raw.title === "string" ? raw.title : "",
    state: raw.state === "closed" ? "closed" : "open",
    openIssues: open,
    closedIssues: closed,
    percentDone: total > 0 ? Math.round((closed / total) * 100) : 0,
    dueOn: typeof raw.due_on === "string" ? raw.due_on : null,
    htmlUrl: typeof raw.html_url === "string" ? raw.html_url : ""
  };
}

const KNOWN_KINDS: readonly string[] = [
  "epic",
  "feature",
  "bug",
  "docs",
  "other"
];

function toIssueView(
  raw: Record<string, unknown>
): RepositoryProgressIssueView {
  const kind =
    typeof raw.kind === "string" && KNOWN_KINDS.includes(raw.kind)
      ? (raw.kind as RepositoryProgressIssueKind)
      : "other";
  return {
    number: typeof raw.number === "number" ? raw.number : 0,
    title: typeof raw.title === "string" ? raw.title : "",
    state: raw.state === "closed" ? "closed" : "open",
    kind,
    milestoneNumber:
      typeof raw.milestone_number === "number" ? raw.milestone_number : null,
    htmlUrl: typeof raw.html_url === "string" ? raw.html_url : "",
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : ""
  };
}

export async function fetchRepositoryProgress(
  tx: Bun.SQL,
  tenantId: string,
  now: Date,
  intervalSeconds: number = DEFAULT_REPOSITORY_PROGRESS_POLL_INTERVAL_SECONDS
): Promise<RepositoryProgressScreenState> {
  const config = await getRepositoryProgressConfig(tx, tenantId);
  if (!config) {
    return { state: "unconfigured" };
  }

  const rows = (await tx`
    SELECT owner, name, html_url, observed_at, status, last_error_class, milestones, issues
    FROM awcms_omes_repository_progress
    WHERE tenant_id = ${tenantId}
    LIMIT 1
  `) as ProgressRow[];

  if (rows.length === 0) {
    // Configured, but no poll has completed (or even run) yet — never
    // rendered as "stale" (that implies a prior observation exists); the
    // screen shows a distinct "configured, awaiting first poll" state via
    // observedAt: null + freshness: "unknown".
    return {
      state: "configured",
      repository: {
        owner: config.owner,
        name: config.name,
        htmlUrl: config.htmlUrl
      },
      observedAt: null,
      freshness: "unknown",
      pollStatus: "ok",
      lastErrorClass: null,
      milestones: [],
      issues: []
    };
  }

  const row = rows[0]!;
  const observedAtIso = row.observed_at ? row.observed_at.toISOString() : null;

  return {
    state: "configured",
    repository: { owner: row.owner, name: row.name, htmlUrl: row.html_url },
    observedAt: observedAtIso,
    freshness: classifyRepositoryProgressFreshness(
      observedAtIso,
      now,
      intervalSeconds
    ),
    pollStatus: row.status,
    lastErrorClass: row.last_error_class,
    milestones: (row.milestones ?? []).map(toMilestoneView),
    issues: (row.issues ?? []).map(toIssueView)
  };
}
