/**
 * Scheduled GitHub repository-progress poller (Issue ahliweb/omes#249,
 * ADR-0030 in the `ahliweb/omes` repository). Entry point:
 * `bun run omes:repository-progress:poll`
 * (`scripts/omes-repository-progress-poll.ts`), scheduled every 15 minutes
 * by default (`module.ts`'s `jobs` descriptor).
 *
 * ADR-0030 requirements this file implements:
 *   - Read-only GitHub REST calls only (milestones `state=all`, issues
 *     `state=all` excluding pull requests), no write scopes ever requested.
 *   - Conditional requests (`If-None-Match`/`ETag`) on the FIRST page of each
 *     resource, so an unchanged repository's poll does not consume
 *     additional GitHub rate-limit quota. Multi-page pagination beyond page 1
 *     is always fetched fresh (no per-page ETag cache) — a deliberate
 *     simplification: the common case (a small/medium repository, one page)
 *     gets the full quota benefit, and a large multi-page repository still
 *     polls correctly, just without the marginal quota saving on pages 2+.
 *   - A bounded total timeout and response-size cap per HTTP call (via
 *     `ssrfSafeFetch`), the `User-Agent` header GitHub requires, and explicit
 *     rate-limit handling (`x-ratelimit-remaining`/`retry-after`) that
 *     records an error state rather than retrying in a tight loop.
 *   - Validates the assembled projection against the vendored
 *     `repository-progress-view` v1 contract (`assertOmesContract`) BEFORE
 *     it is ever stored — fail closed: a payload that does not validate is
 *     treated as a poll error, never partially stored.
 *   - No issue body, no comments, no assignee/author PII — enforced upstream
 *     by `domain/repository-progress.ts`'s mapping functions, which only
 *     ever read the specific fields the contract allows.
 *
 * `defaultGithubFetch` is the ONLY function here that performs real network
 * I/O; every other function takes a `githubFetch` dependency, so
 * `tests/repository-progress-poller.test.ts` can exercise the full
 * pagination/ETag/error-classification/schema-validation logic against a
 * fake in-memory GitHub without a live network call — see that file.
 */
import {
  buildRepositoryProgressView,
  isPullRequest,
  mapGithubIssue,
  mapGithubMilestone,
  REPOSITORY_PROGRESS_MAX_ISSUES,
  REPOSITORY_PROGRESS_MAX_MILESTONES,
  REPOSITORY_PROGRESS_MAX_PAGES,
  GITHUB_PER_PAGE,
  type RawGithubIssue,
  type RawGithubMilestone,
  type RepositoryProgressErrorClass,
  type RepositoryProgressIssue,
  type RepositoryProgressMilestone,
  type RepositoryProgressView
} from "../domain/repository-progress";
import {
  assertOmesContract,
  ContractValidationError
} from "../domain/contracts";
import { ssrfSafeFetch } from "../../../lib/auth/ssrf-guard";

const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_USER_AGENT =
  "AWCMS-OMES-RepositoryProgress/1.0 (+https://github.com/ahliweb/awcms; issue ahliweb/omes#249)";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type GithubFetchResult = {
  status: number;
  headers: Record<string, string>;
  bodyText: string;
};

/** Injectable GitHub HTTP transport — see file header. `path` includes the leading `/repos/{owner}/{name}/...` segment and query string; `etag`, if given, is sent as `If-None-Match`. */
export type GithubFetch = (params: {
  path: string;
  token: string | null;
  etag: string | null;
}) => Promise<GithubFetchResult>;

/** Production implementation: SSRF-safe, timeout- and size-bounded, GitHub-required headers. The host is always the literal `api.github.com` (never derived from tenant input), so this is defense in depth rather than the primary control against a hostile URL — `owner`/`name` are validated to a strict charset before ever reaching here (see `application/repository-progress-config.ts`). */
export const defaultGithubFetch: GithubFetch = async ({
  path,
  token,
  etag
}) => {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": GITHUB_USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (etag) headers["If-None-Match"] = etag;

  const result = await ssrfSafeFetch(`${GITHUB_API_BASE}${path}`, {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    method: "GET",
    headers
  });

  if (!result.ok) {
    // Surfaced to the caller as a synthetic non-2xx/304 status so the same
    // classification logic in `pollOneRepository` handles it — an SSRF
    // denial (should never happen given the fixed host, but fail closed
    // anyway) or network failure is a `blocked_request`/`network_error`,
    // never silently treated as "no data changed".
    return {
      status: result.reason === "response_too_large" ? 502 : 599,
      headers: {},
      bodyText: ""
    };
  }

  const responseHeaders: Record<string, string> = {};
  result.response.headers.forEach((value, key) => {
    responseHeaders[key.toLowerCase()] = value;
  });

  return {
    status: result.response.status,
    headers: responseHeaders,
    bodyText: await result.response.text()
  };
};

/**
 * Resolves the ONLY supported v1 `secret_ref` shape to its token value.
 * Returns `null` (unauthenticated poll) for a `null` secret_ref, an
 * unrecognized shape, or an unset/empty env var — NEVER throws, and never
 * logs the resolved value.
 *
 * Deliberately reads the LITERAL `env.OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN`
 * — never a dynamic `env[secretRef.key]` bracket lookup — because
 * `scripts/jobs-env-allowlist.ts`'s `collectEnvReads()` only discovers
 * statically-written `process.env.NAME` (or an aliased parameter default,
 * `env: NodeJS.ProcessEnv = process.env` + `env.NAME`, exactly the shape
 * this function's own signature uses) reads; a dynamic bracket lookup by a
 * runtime string would be invisible to that scan, and the job container
 * would never receive the variable at all (the exact failure mode that
 * script's own header warns about). `secretRef.key` is still checked
 * (structurally validated to be this one literal name already, by
 * `sql/166`'s CHECK constraint and `application/repository-progress-
 * config.ts`) so a future, differently-shaped `secret_ref` fails closed
 * (resolves to `null`, i.e. unauthenticated) rather than silently reading
 * the wrong variable.
 */
export function resolveGithubToken(
  secretRef: { store: string; key: string } | null,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  if (
    !secretRef ||
    secretRef.store !== "env" ||
    secretRef.key !== "OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN"
  ) {
    return null;
  }
  const value = env.OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export type PollOneRepositoryInput = {
  tenantId: string;
  owner: string;
  name: string;
  token: string | null;
  previousMilestonesEtag: string | null;
  previousIssuesEtag: string | null;
  previousMilestones: RepositoryProgressMilestone[];
  previousIssues: RepositoryProgressIssue[];
  now: Date;
};

export type PollOneRepositoryOutcome =
  | {
      outcome: "updated";
      view: RepositoryProgressView;
      milestonesEtag: string | null;
      issuesEtag: string | null;
    }
  | { outcome: "not_modified" }
  | {
      outcome: "error";
      errorClass: RepositoryProgressErrorClass;
      retryAfterSeconds?: number;
    };

function classifyHttpFailure(
  status: number,
  headers: Record<string, string>,
  now: Date
): { errorClass: RepositoryProgressErrorClass; retryAfterSeconds?: number } {
  if (status === 404) return { errorClass: "not_found" };

  if (status === 403 || status === 429) {
    const remaining = headers["x-ratelimit-remaining"];
    const retryAfterHeader = headers["retry-after"];
    const resetHeader = headers["x-ratelimit-reset"];
    if (
      remaining === "0" ||
      status === 429 ||
      retryAfterHeader ||
      resetHeader
    ) {
      const retryAfterSeconds = retryAfterHeader
        ? Number(retryAfterHeader)
        : resetHeader
          ? Math.max(0, Number(resetHeader) - Math.floor(now.getTime() / 1000))
          : undefined;
      return {
        errorClass: "rate_limited",
        retryAfterSeconds:
          typeof retryAfterSeconds === "number" &&
          Number.isFinite(retryAfterSeconds)
            ? retryAfterSeconds
            : undefined
      };
    }
    return { errorClass: "unauthorized" };
  }

  if (status === 401) return { errorClass: "unauthorized" };
  if (status === 502) return { errorClass: "blocked_request" };
  if (status === 599) return { errorClass: "network_error" };
  return { errorClass: "invalid_response" };
}

/** Fetches every page of one GitHub list resource, up to `maxItems`/`REPOSITORY_PROGRESS_MAX_PAGES`, applying `mapItem` per raw entry (nulls dropped). Only page 1 is a conditional request; a 304 there short-circuits to the caller's cached `previousItems`. Returns `null` on any classified HTTP failure (caller turns that into a poll `error` outcome). */
async function fetchAllPages<TRaw, TMapped>(params: {
  githubFetch: GithubFetch;
  owner: string;
  name: string;
  resource: "milestones" | "issues";
  token: string | null;
  previousEtag: string | null;
  previousItems: TMapped[];
  mapItem: (raw: TRaw) => TMapped | null;
  maxItems: number;
  now: Date;
}): Promise<
  | { ok: true; items: TMapped[]; etag: string | null; notModified: boolean }
  | {
      ok: false;
      errorClass: RepositoryProgressErrorClass;
      retryAfterSeconds?: number;
    }
> {
  const items: TMapped[] = [];
  let etag: string | null = params.previousEtag;

  for (let page = 1; page <= REPOSITORY_PROGRESS_MAX_PAGES; page += 1) {
    const isFirstPage = page === 1;
    const query = `state=all&per_page=${GITHUB_PER_PAGE}&page=${page}`;
    const result = await params.githubFetch({
      path: `/repos/${encodeURIComponent(params.owner)}/${encodeURIComponent(params.name)}/${params.resource}?${query}`,
      token: params.token,
      etag: isFirstPage ? params.previousEtag : null
    });

    if (isFirstPage && result.status === 304) {
      return { ok: true, items: params.previousItems, etag, notModified: true };
    }

    if (result.status !== 200) {
      return {
        ok: false,
        ...classifyHttpFailure(result.status, result.headers, params.now)
      };
    }

    if (isFirstPage) {
      etag = result.headers.etag ?? null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.bodyText);
    } catch {
      return { ok: false, errorClass: "invalid_response" };
    }
    if (!Array.isArray(parsed)) {
      return { ok: false, errorClass: "invalid_response" };
    }

    for (const raw of parsed as TRaw[]) {
      const mapped = params.mapItem(raw);
      if (mapped !== null) items.push(mapped);
    }

    if (items.length >= params.maxItems) break;
    if (parsed.length < GITHUB_PER_PAGE) break; // last page
  }

  return {
    ok: true,
    items: items.slice(0, params.maxItems),
    etag,
    notModified: false
  };
}

/**
 * Polls one tenant's configured repository, maps the result to the OMES
 * `repository-progress-view` v1 contract shape, and validates it — the
 * caller (the job script) is responsible for persisting the outcome. Never
 * throws for an ordinary GitHub/network failure (returns `{outcome:
 * "error", ...}`); only a programming error (e.g. a malformed vendored
 * schema) would throw, exactly like every other `assertOmesContract` call
 * site in this codebase.
 */
export async function pollOneRepository(
  input: PollOneRepositoryInput,
  githubFetch: GithubFetch = defaultGithubFetch
): Promise<PollOneRepositoryOutcome> {
  const milestonesResult = await fetchAllPages<
    RawGithubMilestone,
    RepositoryProgressMilestone
  >({
    githubFetch,
    owner: input.owner,
    name: input.name,
    resource: "milestones",
    token: input.token,
    previousEtag: input.previousMilestonesEtag,
    previousItems: input.previousMilestones,
    mapItem: mapGithubMilestone,
    maxItems: REPOSITORY_PROGRESS_MAX_MILESTONES,
    now: input.now
  });

  if (!milestonesResult.ok) {
    return {
      outcome: "error",
      errorClass: milestonesResult.errorClass,
      retryAfterSeconds: milestonesResult.retryAfterSeconds
    };
  }

  const issuesResult = await fetchAllPages<
    RawGithubIssue,
    RepositoryProgressIssue
  >({
    githubFetch,
    owner: input.owner,
    name: input.name,
    resource: "issues",
    token: input.token,
    previousEtag: input.previousIssuesEtag,
    previousItems: input.previousIssues,
    mapItem: (raw) => (isPullRequest(raw) ? null : mapGithubIssue(raw)),
    maxItems: REPOSITORY_PROGRESS_MAX_ISSUES,
    now: input.now
  });

  if (!issuesResult.ok) {
    return {
      outcome: "error",
      errorClass: issuesResult.errorClass,
      retryAfterSeconds: issuesResult.retryAfterSeconds
    };
  }

  if (milestonesResult.notModified && issuesResult.notModified) {
    return { outcome: "not_modified" };
  }

  const view = buildRepositoryProgressView({
    tenantId: input.tenantId,
    owner: input.owner,
    name: input.name,
    observedAt: input.now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    milestones: milestonesResult.items,
    issues: issuesResult.items
  });

  try {
    await assertOmesContract("repository-progress-view", view);
  } catch (error) {
    if (error instanceof ContractValidationError) {
      return { outcome: "error", errorClass: "invalid_response" };
    }
    throw error;
  }

  return {
    outcome: "updated",
    view,
    milestonesEtag: milestonesResult.etag,
    issuesEtag: issuesResult.etag
  };
}
