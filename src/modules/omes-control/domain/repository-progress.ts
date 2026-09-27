/**
 * GitHub repository-progress projection domain logic (Issue
 * ahliweb/omes#249, split from #246 part 2, ADR-0030 in the `ahliweb/omes`
 * repository).
 *
 * ADR-0017/ADR-0030 boundary: GitHub owns repository/issue/milestone
 * observation state; OMES owns only the wire contract
 * (`repository-progress-view.schema.json`, vendored under
 * `../contracts/v1/`); AWCMS is the ONE system that polls the GitHub REST
 * API and projects it (`application/repository-progress-poller.ts`). This
 * module is pure, side-effect-free mapping/derivation logic — no I/O — so it
 * can be exercised directly by unit tests without a database or network
 * access, mirroring `domain/hermes-orchestration.ts` and `domain/ai-privacy.ts`'s
 * "recompute, never merely echo" discipline for freshness.
 */

export const REPOSITORY_PROGRESS_SCHEMA_VERSION = "1.0.0" as const;

export const REPOSITORY_PROGRESS_ISSUE_KINDS = [
  "epic",
  "feature",
  "bug",
  "docs",
  "other"
] as const;
export type RepositoryProgressIssueKind =
  (typeof REPOSITORY_PROGRESS_ISSUE_KINDS)[number];

export const REPOSITORY_PROGRESS_FRESHNESS = [
  "fresh",
  "stale",
  "unknown"
] as const;
export type RepositoryProgressFreshness =
  (typeof REPOSITORY_PROGRESS_FRESHNESS)[number];

/** Matches `contracts/v1/repository-progress-view.schema.json`'s `repository.owner`/`repository.name` pattern. */
export const GITHUB_OWNER_OR_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Bounds from the vendored `repository-progress-view.schema.json` (`maxItems`) — the poller must never store more than this, regardless of how many pages GitHub reports. */
export const REPOSITORY_PROGRESS_MAX_MILESTONES = 200;
export const REPOSITORY_PROGRESS_MAX_ISSUES = 500;

/** Hard cap on pages fetched per resource per poll, independent of the stored-item cap above — stops a pathological/hostile paginator from looping forever even if every page returns zero NEW items after filtering. */
export const REPOSITORY_PROGRESS_MAX_PAGES = 10;
export const GITHUB_PER_PAGE = 100;

export function isValidGithubOwnerOrName(value: string): boolean {
  return GITHUB_OWNER_OR_NAME_RE.test(value);
}

/** `contracts/v1/repository-progress-view.schema.json`'s `repository.html_url` pattern — github.com only, no other host may be smuggled in as an authoritative source link. */
export function buildRepositoryHtmlUrl(owner: string, name: string): string {
  return `https://github.com/${owner}/${name}`;
}

/**
 * Derives `kind` from an issue's label names, deterministically, per
 * ADR-0030: `type:epic` -> `epic`; `type:feature`/`enhancement` -> `feature`;
 * `bug`/`type:bug` -> `bug`; `documentation`/`type:documentation` -> `docs`;
 * anything else -> `other`. Never invented from title/body text — labels
 * only, and checked in this fixed priority order (an issue carrying both
 * `type:epic` and `bug`, for instance, is classified `epic`).
 */
export function deriveIssueKind(
  labels: readonly string[]
): RepositoryProgressIssueKind {
  const set = new Set(labels.map((label) => label.toLowerCase()));

  if (set.has("type:epic")) return "epic";
  if (set.has("type:feature") || set.has("enhancement")) return "feature";
  if (set.has("bug") || set.has("type:bug")) return "bug";
  if (set.has("documentation") || set.has("type:documentation")) return "docs";
  return "other";
}

/** Raw shape this module expects the GitHub REST API's milestone list response items to have (a narrow, defensive subset — anything else on the wire is ignored). */
export type RawGithubMilestone = {
  number: unknown;
  title: unknown;
  state: unknown;
  open_issues: unknown;
  closed_issues: unknown;
  due_on: unknown;
  html_url: unknown;
};

export type RepositoryProgressMilestone = {
  number: number;
  title: string;
  state: "open" | "closed";
  openIssues: number;
  closedIssues: number;
  dueOn: string | null;
  htmlUrl: string;
};

function toIsoSecondsOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Maps one raw GitHub milestone API object to the contract shape. Returns
 * `null` for a malformed entry (missing/invalid number or title) rather than
 * throwing — a single bad item from an otherwise-good page must not fail the
 * whole poll; the caller counts and can log how many were skipped.
 */
export function mapGithubMilestone(
  raw: RawGithubMilestone
): RepositoryProgressMilestone | null {
  const number = typeof raw.number === "number" ? raw.number : null;
  const title = typeof raw.title === "string" ? raw.title : null;
  const state = raw.state === "closed" ? "closed" : "open";
  const htmlUrl = typeof raw.html_url === "string" ? raw.html_url : null;

  if (number === null || title === null || htmlUrl === null) return null;

  return {
    number,
    title: title.slice(0, 256),
    state,
    openIssues:
      typeof raw.open_issues === "number" ? Math.max(0, raw.open_issues) : 0,
    closedIssues:
      typeof raw.closed_issues === "number"
        ? Math.max(0, raw.closed_issues)
        : 0,
    dueOn: toIsoSecondsOrNull(raw.due_on),
    htmlUrl
  };
}

/** Raw shape this module expects the GitHub REST API's issue list response items to have. GitHub's `/issues` endpoint also returns pull requests, distinguished only by the presence of a `pull_request` key — see `isPullRequest`. */
export type RawGithubIssue = {
  number: unknown;
  title: unknown;
  state: unknown;
  labels: unknown;
  milestone: unknown;
  html_url: unknown;
  updated_at: unknown;
  pull_request?: unknown;
};

export type RepositoryProgressIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  labels: string[];
  milestoneNumber: number | null;
  kind: RepositoryProgressIssueKind;
  htmlUrl: string;
  updatedAt: string;
};

/** GitHub's `GET /repos/{owner}/{repo}/issues` returns pull requests interleaved with issues; ADR-0030 requires excluding them. A PR is the only item shape carrying a `pull_request` key at all. */
export function isPullRequest(raw: { pull_request?: unknown }): boolean {
  return raw.pull_request !== undefined;
}

function extractLabelNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (
        entry !== null &&
        typeof entry === "object" &&
        "name" in entry &&
        typeof (entry as { name: unknown }).name === "string"
      ) {
        return (entry as { name: string }).name;
      }
      return null;
    })
    .filter((name): name is string => name !== null)
    .slice(0, 20);
}

/**
 * Maps one raw GitHub issue API object to the contract shape. Returns `null`
 * for a pull request (see `isPullRequest`) or a malformed entry — never
 * throws on a single bad item. Carries no issue body, no comments, and no
 * assignee/author identity, matching the vendored schema and ADR-0030's PII
 * boundary exactly (`number`/`title`/`state`/label NAMES/milestone
 * number/derived `kind`/`html_url`/`updated_at` only).
 */
export function mapGithubIssue(
  raw: RawGithubIssue
): RepositoryProgressIssue | null {
  if (isPullRequest(raw)) return null;

  const number = typeof raw.number === "number" ? raw.number : null;
  const title = typeof raw.title === "string" ? raw.title : null;
  const htmlUrl = typeof raw.html_url === "string" ? raw.html_url : null;
  const updatedAt = toIsoSecondsOrNull(raw.updated_at);

  if (number === null || title === null || htmlUrl === null || !updatedAt) {
    return null;
  }

  const labels = extractLabelNames(raw.labels);
  const milestone = raw.milestone;
  const milestoneNumber =
    milestone !== null &&
    typeof milestone === "object" &&
    "number" in milestone &&
    typeof (milestone as { number: unknown }).number === "number"
      ? (milestone as { number: number }).number
      : null;

  return {
    number,
    title: title.slice(0, 256),
    state: raw.state === "closed" ? "closed" : "open",
    labels,
    milestoneNumber,
    kind: deriveIssueKind(labels),
    htmlUrl,
    updatedAt
  };
}

export type RepositoryProgressView = {
  schema_version: "1.0.0";
  tenant_id: string;
  repository: { owner: string; name: string; html_url: string };
  observed_at: string;
  source: "github_rest_poll" | "github_webhook";
  milestones: Array<{
    number: number;
    title: string;
    state: "open" | "closed";
    open_issues: number;
    closed_issues: number;
    due_on: string | null;
    html_url: string;
  }>;
  issues: Array<{
    number: number;
    title: string;
    state: "open" | "closed";
    labels: string[];
    milestone_number: number | null;
    kind: RepositoryProgressIssueKind;
    html_url: string;
    updated_at: string;
  }>;
};

/**
 * Assembles the OMES `repository-progress-view` v1 contract shape from
 * already-mapped milestones/issues. Bounds both arrays to the schema's
 * `maxItems` here too (defense in depth alongside the poller's own
 * pagination cap) so a caller can never accidentally build an
 * instance that fails `assertOmesContract` on size alone.
 */
export function buildRepositoryProgressView(input: {
  tenantId: string;
  owner: string;
  name: string;
  observedAt: string;
  milestones: RepositoryProgressMilestone[];
  issues: RepositoryProgressIssue[];
}): RepositoryProgressView {
  return {
    schema_version: REPOSITORY_PROGRESS_SCHEMA_VERSION,
    tenant_id: input.tenantId,
    repository: {
      owner: input.owner,
      name: input.name,
      html_url: buildRepositoryHtmlUrl(input.owner, input.name)
    },
    observed_at: input.observedAt,
    source: "github_rest_poll",
    milestones: input.milestones
      .slice(0, REPOSITORY_PROGRESS_MAX_MILESTONES)
      .map((m) => ({
        number: m.number,
        title: m.title,
        state: m.state,
        open_issues: m.openIssues,
        closed_issues: m.closedIssues,
        due_on: m.dueOn,
        html_url: m.htmlUrl
      })),
    issues: input.issues.slice(0, REPOSITORY_PROGRESS_MAX_ISSUES).map((i) => ({
      number: i.number,
      title: i.title,
      state: i.state,
      labels: i.labels,
      milestone_number: i.milestoneNumber,
      kind: i.kind,
      html_url: i.htmlUrl,
      updated_at: i.updatedAt
    }))
  };
}

/** Default poll interval, per ADR-0030 ("AWCMS consumption expectations"). */
export const DEFAULT_REPOSITORY_PROGRESS_POLL_INTERVAL_SECONDS = 15 * 60;

/**
 * Stale-vs-fresh grace window multiplier: a projection is rendered `stale`
 * once `observed_at` is older than `intervalSeconds * STALE_GRACE_MULTIPLIER`
 * — never merely `> intervalSeconds`, since a run that is simply a few
 * seconds late (scheduler jitter, an overlapping lock skip) must not flip the
 * whole screen to "stale" every cycle. Mirrors
 * `docs/control-center-contracts.md` §2.9's `projection-state` freshness
 * pattern (ADR-0030's own framing).
 */
export const REPOSITORY_PROGRESS_STALE_GRACE_MULTIPLIER = 2;

function parseTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Bounded fresh/stale/unknown classification, RECOMPUTED here at read time —
 * never trusted from a stored flag. A missing/unparsable `observedAt`, or one
 * in the future (clock/producer problem), is always `"unknown"` — NEVER
 * `"fresh"`.
 */
export function classifyRepositoryProgressFreshness(
  observedAt: string | null | undefined,
  now: Date,
  intervalSeconds: number = DEFAULT_REPOSITORY_PROGRESS_POLL_INTERVAL_SECONDS
): RepositoryProgressFreshness {
  const ts = parseTimestamp(observedAt);
  if (!ts) return "unknown";
  const ageSeconds = (now.getTime() - ts.getTime()) / 1000;
  if (ageSeconds < 0) return "unknown";
  return ageSeconds >
    intervalSeconds * REPOSITORY_PROGRESS_STALE_GRACE_MULTIPLIER
    ? "stale"
    : "fresh";
}

export const REPOSITORY_PROGRESS_ERROR_CLASSES = [
  "not_found",
  "unauthorized",
  "rate_limited",
  "network_error",
  "invalid_response",
  "blocked_request"
] as const;
export type RepositoryProgressErrorClass =
  (typeof REPOSITORY_PROGRESS_ERROR_CLASSES)[number];
