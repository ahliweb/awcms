/**
 * Pure-unit tests for the GitHub repository-progress domain layer (Issue
 * ahliweb/omes#249, ADR-0030): label-derived `kind`, GitHub->contract
 * mapping (including pull-request exclusion and malformed-item handling),
 * the assembled view's size bounds, and freshness recomputation. No
 * database, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  buildRepositoryHtmlUrl,
  buildRepositoryProgressView,
  classifyRepositoryProgressFreshness,
  deriveIssueKind,
  isPullRequest,
  isValidGithubOwnerOrName,
  mapGithubIssue,
  mapGithubMilestone,
  REPOSITORY_PROGRESS_MAX_ISSUES,
  REPOSITORY_PROGRESS_MAX_MILESTONES,
  type RawGithubIssue,
  type RawGithubMilestone
} from "../src/modules/omes-control/domain/repository-progress";

const NOW = new Date("2026-09-28T00:00:00Z");

describe("deriveIssueKind", () => {
  test("type:epic wins over every other label", () => {
    expect(deriveIssueKind(["type:epic", "bug"])).toBe("epic");
  });
  test("type:feature or enhancement maps to feature", () => {
    expect(deriveIssueKind(["type:feature"])).toBe("feature");
    expect(deriveIssueKind(["enhancement"])).toBe("feature");
  });
  test("bug or type:bug maps to bug", () => {
    expect(deriveIssueKind(["bug"])).toBe("bug");
    expect(deriveIssueKind(["type:bug"])).toBe("bug");
  });
  test("documentation or type:documentation maps to docs", () => {
    expect(deriveIssueKind(["documentation"])).toBe("docs");
    expect(deriveIssueKind(["type:documentation"])).toBe("docs");
  });
  test("anything else, including no labels, maps to other", () => {
    expect(deriveIssueKind([])).toBe("other");
    expect(deriveIssueKind(["area:platform", "priority:high"])).toBe("other");
  });
  test("case-insensitive label matching", () => {
    expect(deriveIssueKind(["Bug"])).toBe("bug");
    expect(deriveIssueKind(["TYPE:EPIC"])).toBe("epic");
  });
});

describe("isValidGithubOwnerOrName / buildRepositoryHtmlUrl", () => {
  test("accepts the GitHub identifier charset", () => {
    expect(isValidGithubOwnerOrName("ahliweb")).toBe(true);
    expect(isValidGithubOwnerOrName("omes-web.v2_1")).toBe(true);
  });
  test("rejects anything outside the charset, including path/URL injection attempts", () => {
    expect(isValidGithubOwnerOrName("")).toBe(false);
    expect(isValidGithubOwnerOrName("ahliweb/omes")).toBe(false);
    expect(isValidGithubOwnerOrName("../../etc")).toBe(false);
    expect(isValidGithubOwnerOrName("evil.com?x=1")).toBe(false);
    expect(isValidGithubOwnerOrName("a".repeat(101))).toBe(false);
  });
  test("builds a github.com-only URL", () => {
    expect(buildRepositoryHtmlUrl("ahliweb", "omes")).toBe(
      "https://github.com/ahliweb/omes"
    );
  });
});

describe("isPullRequest / mapGithubIssue", () => {
  test("an item carrying a pull_request key is excluded", () => {
    const pr: RawGithubIssue = {
      number: 1,
      title: "A PR",
      state: "open",
      labels: [],
      milestone: null,
      html_url: "https://github.com/ahliweb/omes/issues/1",
      updated_at: "2026-09-27T10:00:00Z",
      pull_request: { url: "https://api.github.com/repos/ahliweb/omes/pulls/1" }
    };
    expect(isPullRequest(pr)).toBe(true);
    expect(mapGithubIssue(pr)).toBeNull();
  });

  test("maps a well-formed issue, deriving kind from labels and extracting the milestone number", () => {
    const raw: RawGithubIssue = {
      number: 129,
      title: "backup_finish loses env var",
      state: "open",
      labels: [{ name: "bug" }, { name: "area:backup" }],
      milestone: { number: 5, title: "MVP" },
      html_url: "https://github.com/ahliweb/omes/issues/129",
      updated_at: "2026-09-19T11:50:22Z"
    };
    const mapped = mapGithubIssue(raw);
    expect(mapped).not.toBeNull();
    expect(mapped?.kind).toBe("bug");
    expect(mapped?.milestoneNumber).toBe(5);
    expect(mapped?.labels).toEqual(["bug", "area:backup"]);
    expect(mapped?.state).toBe("open");
  });

  test("no issue body, comments, or assignee/author fields are ever read — only the allowed subset is mapped", () => {
    const raw = {
      number: 1,
      title: "T",
      state: "open",
      labels: [],
      milestone: null,
      html_url: "https://github.com/ahliweb/omes/issues/1",
      updated_at: "2026-09-27T10:00:00Z",
      // A hostile/rich raw GitHub payload also carries these — none may leak
      // into the mapped shape.
      body: "SECRET PROMPT / PII",
      assignee: { login: "someone" },
      user: { login: "author" }
    } as unknown as RawGithubIssue;
    const mapped = mapGithubIssue(raw);
    expect(mapped).not.toBeNull();
    expect(Object.keys(mapped as object).sort()).toEqual(
      [
        "htmlUrl",
        "kind",
        "labels",
        "milestoneNumber",
        "number",
        "state",
        "title",
        "updatedAt"
      ].sort()
    );
  });

  test("a malformed item (missing number/title/html_url/updated_at) returns null rather than throwing", () => {
    expect(
      mapGithubIssue({
        number: null,
        title: "x",
        state: "open",
        labels: [],
        milestone: null,
        html_url: "https://github.com/ahliweb/omes/issues/1",
        updated_at: "2026-09-27T10:00:00Z"
      } as unknown as RawGithubIssue)
    ).toBeNull();
  });
});

describe("mapGithubMilestone", () => {
  test("maps a well-formed milestone, clamping negative counts to zero", () => {
    const raw: RawGithubMilestone = {
      number: 5,
      title: "MVP",
      state: "open",
      open_issues: -1,
      closed_issues: 26,
      due_on: null,
      html_url: "https://github.com/ahliweb/omes/milestone/5"
    };
    const mapped = mapGithubMilestone(raw);
    expect(mapped?.openIssues).toBe(0);
    expect(mapped?.closedIssues).toBe(26);
    expect(mapped?.dueOn).toBeNull();
  });

  test("a malformed milestone returns null", () => {
    expect(
      mapGithubMilestone({
        number: "not-a-number",
        title: "x",
        state: "open",
        open_issues: 0,
        closed_issues: 0,
        due_on: null,
        html_url: "https://github.com/ahliweb/omes/milestone/1"
      } as unknown as RawGithubMilestone)
    ).toBeNull();
  });
});

describe("buildRepositoryProgressView", () => {
  test("bounds milestones/issues to the schema's maxItems even if given more", () => {
    const tooManyMilestones = Array.from(
      { length: REPOSITORY_PROGRESS_MAX_MILESTONES + 10 },
      (_, i) => ({
        number: i + 1,
        title: `M${i}`,
        state: "open" as const,
        openIssues: 0,
        closedIssues: 0,
        dueOn: null,
        htmlUrl: `https://github.com/ahliweb/omes/milestone/${i + 1}`
      })
    );
    const tooManyIssues = Array.from(
      { length: REPOSITORY_PROGRESS_MAX_ISSUES + 10 },
      (_, i) => ({
        number: i + 1,
        title: `I${i}`,
        state: "open" as const,
        labels: [],
        milestoneNumber: null,
        kind: "other" as const,
        htmlUrl: `https://github.com/ahliweb/omes/issues/${i + 1}`,
        updatedAt: "2026-09-27T10:00:00Z"
      })
    );

    const view = buildRepositoryProgressView({
      tenantId: "tenant-acme",
      owner: "ahliweb",
      name: "omes",
      observedAt: "2026-09-28T00:00:00Z",
      milestones: tooManyMilestones,
      issues: tooManyIssues
    });

    expect(view.milestones.length).toBe(REPOSITORY_PROGRESS_MAX_MILESTONES);
    expect(view.issues.length).toBe(REPOSITORY_PROGRESS_MAX_ISSUES);
    expect(view.schema_version).toBe("1.0.0");
    expect(view.source).toBe("github_rest_poll");
    expect(view.repository.html_url).toBe("https://github.com/ahliweb/omes");
  });
});

describe("classifyRepositoryProgressFreshness", () => {
  test("a recent observed_at within the interval is fresh", () => {
    expect(
      classifyRepositoryProgressFreshness("2026-09-27T23:50:00Z", NOW, 900)
    ).toBe("fresh");
  });
  test("an observed_at older than 2x the interval is stale", () => {
    expect(
      classifyRepositoryProgressFreshness("2026-09-27T23:00:00Z", NOW, 900)
    ).toBe("stale");
  });
  test("missing/unparsable/future observed_at is unknown, never fresh", () => {
    expect(classifyRepositoryProgressFreshness(null, NOW)).toBe("unknown");
    expect(classifyRepositoryProgressFreshness("garbage", NOW)).toBe("unknown");
    expect(
      classifyRepositoryProgressFreshness("2026-09-29T00:00:00Z", NOW)
    ).toBe("unknown");
  });
});
