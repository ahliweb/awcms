/**
 * `deps:issues:sync` (Issue #1173): the planner is the whole of its judgement,
 * so the "one open issue per finding" rule is proved on the planner — no
 * GitHub, no network.
 */
import { describe, expect, test } from "bun:test";

import {
  findingFingerprint,
  findingMarker,
  markersIn,
  type Finding,
  type FindingFile
} from "../scripts/lib/dependency-finding";
import {
  freshnessFindings,
  issueBody,
  issueTitle,
  planIssues,
  type OpenIssue
} from "../scripts/dependency-issue-sync";

const f = (key: string): Finding => ({
  key,
  title: `title ${key}`,
  detail: `detail ${key}`
});

const file = (...keys: string[]): FindingFile => ({
  source: "test",
  findings: keys.map(f)
});

function openIssueFor(finding: Finding, number: number): OpenIssue {
  return {
    number,
    title: issueTitle(finding),
    body: issueBody(finding, "test")
  };
}

describe("markers", () => {
  test("a fingerprint is stable, case-insensitive and 16 hex chars", () => {
    expect(findingFingerprint("license:violation:x")).toMatch(/^[0-9a-f]{16}$/);
    expect(findingFingerprint("A")).toBe(findingFingerprint(" a "));
    expect(findingFingerprint("a")).not.toBe(findingFingerprint("b"));
  });

  test("the marker written into a body is the marker read back", () => {
    const body = issueBody(f("k1"), "src");

    expect([...markersIn(body)]).toEqual([findingFingerprint("k1")]);
    expect(body).toContain(findingMarker("k1"));
  });

  test("a body with no marker, or a malformed one, yields nothing", () => {
    expect(markersIn("hello").size).toBe(0);
    expect(markersIn("<!-- deps-finding:zzzz -->").size).toBe(0);
  });
});

describe("planIssues", () => {
  test("a new finding is filed", () => {
    const plan = planIssues({
      files: [file("a")],
      openIssues: [],
      maxCreate: 10
    });

    expect(plan.toCreate.map((c) => c.finding.key)).toEqual(["a"]);
  });

  test("the same finding on the next run is NOT filed again while its issue is open", () => {
    const first = planIssues({
      files: [file("a")],
      openIssues: [],
      maxCreate: 10
    });
    const opened = [
      openIssueFor((first.toCreate[0] as { finding: Finding }).finding, 7)
    ];

    const second = planIssues({
      files: [file("a")],
      openIssues: opened,
      maxCreate: 10
    });

    expect(second.toCreate).toEqual([]);
    expect(second.alreadyOpen).toEqual([{ key: "a", number: 7 }]);
  });

  test("once the issue is closed (no longer open) and the finding persists, it is filed again", () => {
    const plan = planIssues({
      files: [file("a")],
      openIssues: [],
      maxCreate: 10
    });

    expect(plan.toCreate).toHaveLength(1);
  });

  test("only the findings without an open issue are filed", () => {
    const plan = planIssues({
      files: [file("a", "b", "c")],
      openIssues: [openIssueFor(f("b"), 2)],
      maxCreate: 10
    });

    expect(plan.toCreate.map((c) => c.finding.key)).toEqual(["a", "c"]);
  });

  test("the same finding reported by two gates is filed once", () => {
    const plan = planIssues({
      files: [file("a"), file("a", "b")],
      openIssues: [],
      maxCreate: 10
    });

    expect(plan.toCreate.map((c) => c.finding.key)).toEqual(["a", "b"]);
  });

  test("the per-run cap defers the rest instead of dropping or flooding", () => {
    const plan = planIssues({
      files: [file("a", "b", "c", "d")],
      openIssues: [],
      maxCreate: 2
    });

    expect(plan.toCreate).toHaveLength(2);
    expect(plan.deferred.map((d) => d.key)).toEqual(["c", "d"]);
  });

  test("a finding whose text changed but whose key did not is still the same issue", () => {
    const original = f("k");
    const reworded: Finding = { ...original, title: "other", detail: "other" };
    const plan = planIssues({
      files: [{ source: "t", findings: [reworded] }],
      openIssues: [openIssueFor(original, 3)],
      maxCreate: 10
    });

    expect(plan.toCreate).toEqual([]);
  });

  test("an issue that merely mentions a key in prose is not mistaken for its marker", () => {
    const plan = planIssues({
      files: [file("a")],
      openIssues: [{ number: 1, title: "t", body: "this is about a" }],
      maxCreate: 10
    });

    expect(plan.toCreate).toHaveLength(1);
  });
});

describe("freshness manifest adapter", () => {
  const manifest = {
    strictFailures: [
      "bun outdated: UNKNOWN — registry unreachable",
      "held-back bun: expired — review date passed",
      "image oven/bun:1.4.4 (Dockerfile.production): the digest recorded in Dockerfile.production no longer matches",
      "advisory: lodash@4.0.0 GHSA-xxxx (high)"
    ]
  };

  test("the key names the subject, not the volatile reason", () => {
    const keys = freshnessFindings(manifest).findings.map((x) => x.key);

    expect(keys[0]).toBe("freshness:bun outdated");
    expect(keys[1]).toBe("freshness:held-back bun");
    expect(keys[3]).toBe("freshness:advisory: lodash@4.0.0 GHSA-xxxx (high)");

    const reworded = freshnessFindings({
      strictFailures: ["bun outdated: UNKNOWN — rate limited today"]
    }).findings[0]?.key;

    expect(reworded).toBe(keys[0]);
  });

  test("a manifest without strictFailures is rejected, not read as clean", () => {
    expect(() => freshnessFindings({})).toThrow();
  });

  test("an empty failure list is no findings", () => {
    expect(freshnessFindings({ strictFailures: [] }).findings).toEqual([]);
  });
});

describe("issue text", () => {
  test("long titles are truncated and prefixed", () => {
    const title = issueTitle({ key: "k", title: "x".repeat(400), detail: "" });

    expect(title.startsWith("deps: ")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(200);
  });
});
