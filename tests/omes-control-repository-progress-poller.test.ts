/**
 * Poller tests against a FAKE GitHub transport (Issue ahliweb/omes#249,
 * ADR-0030) — no live GitHub call is ever made in CI. Exercises pagination,
 * pull-request exclusion, ETag/conditional-request short-circuiting, rate-
 * limit/error classification, and the fail-closed contract-validation path.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  pollOneRepository,
  resolveGithubToken,
  type GithubFetch,
  type GithubFetchResult
} from "../src/modules/omes-control/application/repository-progress-poller";
import { ssrfSafeFetch } from "../src/lib/auth/ssrf-guard";

function milestoneJson(number: number): Record<string, unknown> {
  return {
    number,
    title: `Milestone ${number}`,
    state: "open",
    open_issues: 1,
    closed_issues: 2,
    due_on: null,
    html_url: `https://github.com/acme/widgets/milestone/${number}`
  };
}

function issueJson(
  number: number,
  opts: { pr?: boolean; labels?: string[] } = {}
) {
  const base: Record<string, unknown> = {
    number,
    title: `Issue ${number}`,
    state: "open",
    labels: (opts.labels ?? []).map((name) => ({ name })),
    milestone: null,
    html_url: `https://github.com/acme/widgets/issues/${number}`,
    updated_at: "2026-09-27T10:00:00Z"
  };
  if (opts.pr) base.pull_request = { url: "https://api.github.com/x" };
  return base;
}

function jsonResult(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): GithubFetchResult {
  return { status, headers, bodyText: JSON.stringify(body) };
}

const BASE_INPUT = {
  tenantId: "tenant-acme",
  owner: "acme",
  name: "widgets",
  token: null,
  previousMilestonesEtag: null,
  previousIssuesEtag: null,
  previousMilestones: [],
  previousIssues: [],
  now: new Date("2026-09-28T00:00:00Z")
};

describe("resolveGithubToken", () => {
  test("null secret_ref means unauthenticated", () => {
    expect(resolveGithubToken(null, {})).toBeNull();
  });
  test("resolves the ONE supported env-store shape", () => {
    expect(
      resolveGithubToken(
        { store: "env", key: "OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN" },
        { OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN: "ghp_faketokenvalue" }
      )
    ).toBe("ghp_faketokenvalue");
  });
  test("an unset env var, or an unrecognized store, resolves to null rather than throwing", () => {
    expect(
      resolveGithubToken(
        { store: "env", key: "OMES_REPOSITORY_PROGRESS_GITHUB_TOKEN" },
        {}
      )
    ).toBeNull();
    expect(
      resolveGithubToken({ store: "vault", key: "x" } as never, {
        x: "value"
      })
    ).toBeNull();
  });
});

describe("pollOneRepository — happy path", () => {
  test("maps milestones/issues, excludes pull requests, and derives kind", async () => {
    const fetchCalls: string[] = [];
    const fakeFetch: GithubFetch = async ({ path }) => {
      fetchCalls.push(path);
      if (path.includes("/milestones")) {
        return jsonResult(200, [milestoneJson(1)], { etag: '"m-etag-1"' });
      }
      if (path.includes("/issues")) {
        return jsonResult(
          200,
          [
            issueJson(10, { labels: ["bug"] }),
            issueJson(11, { pr: true }) // excluded
          ],
          { etag: '"i-etag-1"' }
        );
      }
      throw new Error(`unexpected path: ${path}`);
    };

    const outcome = await pollOneRepository(BASE_INPUT, fakeFetch);
    expect(outcome.outcome).toBe("updated");
    if (outcome.outcome !== "updated") return;

    expect(outcome.view.milestones).toHaveLength(1);
    expect(outcome.view.issues).toHaveLength(1); // the PR was excluded
    expect(outcome.view.issues[0]?.kind).toBe("bug");
    expect(outcome.milestonesEtag).toBe('"m-etag-1"');
    expect(outcome.issuesEtag).toBe('"i-etag-1"');
    expect(fetchCalls.some((p) => p.includes("state=all"))).toBe(true);
  });

  test("paginates until a short page is returned", async () => {
    let milestonePage = 0;
    const fakeFetch: GithubFetch = async ({ path }) => {
      if (path.includes("/milestones")) {
        milestonePage += 1;
        const page = Number(
          new URL(`https://x${path}`).searchParams.get("page")
        );
        if (page === 1) {
          // A full page (100) forces a second page fetch.
          return jsonResult(
            200,
            Array.from({ length: 100 }, (_, i) => milestoneJson(i + 1))
          );
        }
        return jsonResult(200, [milestoneJson(101)]);
      }
      return jsonResult(200, []); // no issues
    };

    const outcome = await pollOneRepository(BASE_INPUT, fakeFetch);
    expect(outcome.outcome).toBe("updated");
    if (outcome.outcome !== "updated") return;
    expect(outcome.view.milestones).toHaveLength(101);
    expect(milestonePage).toBe(2);
  });

  test("a 304 on page 1 of BOTH resources short-circuits to not_modified, reusing prior data", async () => {
    const fakeFetch: GithubFetch = async ({ etag }) => {
      expect(etag).toBe('"cached"');
      return { status: 304, headers: {}, bodyText: "" };
    };

    const outcome = await pollOneRepository(
      {
        ...BASE_INPUT,
        previousMilestonesEtag: '"cached"',
        previousIssuesEtag: '"cached"',
        previousMilestones: [
          {
            number: 1,
            title: "Cached",
            state: "open",
            openIssues: 0,
            closedIssues: 0,
            dueOn: null,
            htmlUrl: "https://github.com/acme/widgets/milestone/1"
          }
        ]
      },
      fakeFetch
    );

    expect(outcome.outcome).toBe("not_modified");
  });
});

describe("pollOneRepository — real ssrfSafeFetch transport, 304 Not Modified", () => {
  // Regression for the bug fixed alongside this test: `ssrfSafeFetch`'s
  // manual redirect loop used to treat EVERY 3xx status as a redirect that
  // required a `Location` header, so a real conditional-GET 304 response
  // (which legitimately carries no `Location`) failed as `request_failed`
  // instead of completing — the poller then saw a synthetic 599 and reported
  // `error`/`network_error` on every unchanged-repository poll forever, even
  // though nothing was actually wrong. This exercises the REAL `ssrfSafeFetch`
  // transport (not the fake `GithubFetch` used elsewhere in this file)
  // against a local server standing in for `api.github.com`, so the fix in
  // `src/lib/auth/ssrf-guard.ts` is actually on the call path.
  let server: ReturnType<typeof Bun.serve>;
  let base: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        const ifNoneMatch = request.headers.get("if-none-match");
        if (ifNoneMatch === '"cached-etag"') {
          // A real GitHub 304: no body, no Location header.
          return new Response(null, { status: 304 });
        }
        if (url.pathname.includes("/milestones")) {
          return new Response("[]", {
            status: 200,
            headers: { etag: '"cached-etag"' }
          });
        }
        return new Response("[]", {
          status: 200,
          headers: { etag: '"cached-etag"' }
        });
      }
    });
    base = `127.0.0.1:${server.port}`;
    env = {
      ...process.env,
      AUTH_SSO_ALLOW_INSECURE_HOSTS: base
    } as NodeJS.ProcessEnv;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("a real 304 with no Location keeps last-good data, reports not_modified (ok/fresh), not error", async () => {
    // Stands in for `defaultGithubFetch`, but pointed at the local test
    // server instead of the hardcoded `https://api.github.com` — same
    // `ssrfSafeFetch` call, same header shape.
    const realTransportGithubFetch: GithubFetch = async ({ path, etag }) => {
      const headers: Record<string, string> = {};
      if (etag) headers["If-None-Match"] = etag;

      const result = await ssrfSafeFetch(`http://${base}${path}`, {
        timeoutMs: 5000,
        maxResponseBytes: 65_536,
        method: "GET",
        headers,
        env
      });

      if (!result.ok) {
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

    const cachedMilestone = {
      number: 1,
      title: "Cached",
      state: "open" as const,
      openIssues: 0,
      closedIssues: 0,
      dueOn: null,
      htmlUrl: "https://github.com/acme/widgets/milestone/1"
    };

    const outcome = await pollOneRepository(
      {
        ...BASE_INPUT,
        previousMilestonesEtag: '"cached-etag"',
        previousIssuesEtag: '"cached-etag"',
        previousMilestones: [cachedMilestone],
        previousIssues: []
      },
      realTransportGithubFetch
    );

    // Not "error" (the pre-fix regression) — the poll is treated as
    // successful-and-unchanged, which is what lets the caller (the job
    // script / `recordRepositoryProgressUnchanged`) mark status `ok`, bump
    // `observed_at` to the current poll time (freshness), and keep the
    // cached milestones/issues and last-error columns untouched.
    expect(outcome.outcome).toBe("not_modified");
  });
});

describe("pollOneRepository — error classification", () => {
  test("404 classifies as not_found", async () => {
    const fakeFetch: GithubFetch = async () =>
      jsonResult(404, { message: "Not Found" });
    const outcome = await pollOneRepository(BASE_INPUT, fakeFetch);
    expect(outcome).toEqual({ outcome: "error", errorClass: "not_found" });
  });

  test("403 with x-ratelimit-remaining: 0 classifies as rate_limited with a computed retry-after", async () => {
    const nowSeconds = Math.floor(BASE_INPUT.now.getTime() / 1000);
    const fakeFetch: GithubFetch = async () =>
      jsonResult(
        403,
        { message: "API rate limit exceeded" },
        {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(nowSeconds + 120)
        }
      );
    const outcome = await pollOneRepository(BASE_INPUT, fakeFetch);
    expect(outcome.outcome).toBe("error");
    if (outcome.outcome !== "error") return;
    expect(outcome.errorClass).toBe("rate_limited");
    expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("403 with no rate-limit headers classifies as unauthorized", async () => {
    const fakeFetch: GithubFetch = async () =>
      jsonResult(403, { message: "Forbidden" });
    const outcome = await pollOneRepository(BASE_INPUT, fakeFetch);
    expect(outcome).toEqual({ outcome: "error", errorClass: "unauthorized" });
  });

  test("a non-array response body classifies as invalid_response", async () => {
    const fakeFetch: GithubFetch = async () =>
      jsonResult(200, { not: "an array" });
    const outcome = await pollOneRepository(BASE_INPUT, fakeFetch);
    expect(outcome).toEqual({
      outcome: "error",
      errorClass: "invalid_response"
    });
  });

  test("a view that fails contract validation is treated as invalid_response, fail-closed, never partially stored", async () => {
    const fakeFetch: GithubFetch = async ({ path }) =>
      path.includes("/milestones") ? jsonResult(200, []) : jsonResult(200, []);

    // An invalid tenantId (contains a space, outside the schema's pattern)
    // reaches `assertOmesContract` regardless of otherwise-perfect
    // milestone/issue data — this is the fail-closed backstop, not the
    // primary validation (which is `owner`/`name` charset checking upstream
    // in application/repository-progress-config.ts).
    const outcome = await pollOneRepository(
      { ...BASE_INPUT, tenantId: "tenant with a space" },
      fakeFetch
    );
    expect(outcome).toEqual({
      outcome: "error",
      errorClass: "invalid_response"
    });
  });
});
