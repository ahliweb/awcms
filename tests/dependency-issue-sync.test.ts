/**
 * `deps:issues:sync` (Issue #1173): the planner is the whole of its judgement,
 * so the "one open issue per finding" rule is proved on the planner — no
 * GitHub, no network.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  findingFingerprint,
  findingMarker,
  markersIn,
  neutralizeUntrusted,
  type Finding,
  type FindingFile
} from "../scripts/lib/dependency-finding";
import {
  createIssues,
  freshnessFindings,
  ISSUE_LABEL,
  listOpenIssues,
  type GhRunner,
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

describe("third-party text cannot steer the planner or notify strangers", () => {
  const victim = f("license:violation:victim");

  test("a marker for another finding planted in the body's prose is not a marker", () => {
    const hostile: Finding = {
      key: "license:violation:attacker",
      title: "t",
      detail: `A package whose license is ${findingMarker(victim.key)} and more`
    };
    const body = issueBody(hostile, "src");

    expect([...markersIn(body)]).toEqual([findingFingerprint(hostile.key)]);
    expect(
      planIssues({
        files: [{ source: "t", findings: [victim] }],
        openIssues: [{ number: 42, title: "x", body }],
        maxCreate: 5
      }).toCreate
    ).toHaveLength(1);
  });

  test("a marker anywhere but the first line, or with trailing text, is ignored", () => {
    const marker = findingMarker("k");

    expect(markersIn(`intro\n${marker}`).size).toBe(0);
    expect(markersIn(`${marker} trailing`).size).toBe(0);
    expect(markersIn(`${marker}\nmore`).size).toBe(1);
  });

  test("comment delimiters are defanged and a bare @ no longer mentions anyone", () => {
    const out = neutralizeUntrusted(
      "x <!-- deps-finding:0123456789abcdef --> @img/sharp-libvips-* and `@keep/code`"
    );

    expect(out).not.toContain("<!--");
    expect(out).not.toContain("-->");
    expect(out.replace(/`[^`]*`/g, "")).not.toMatch(/@[a-z]/i);
    expect(out).toContain("`@keep/code`");
  });

  test("the issue body applies it to the finding text but keeps its own marker", () => {
    const body = issueBody(
      { key: "k", title: "t", detail: "bad --> @octocat <!-- x" },
      "src"
    );

    expect(body.split("\n")[0]).toBe(findingMarker("k"));
    expect(body).not.toMatch(/@octocat/);
    expect(body.match(/<!--/g)).toHaveLength(1);
  });
});

describe("the gh seam fails closed and asks for what it claims", () => {
  const ok = (stdout: string): GhRunner => {
    const calls: string[][] = [];
    const run: GhRunner = async (args) => {
      calls.push([...args]);
      return stdout;
    };

    return Object.assign(run, { calls });
  };

  test("only label-carrying open issues are listed, with the documented limit", async () => {
    const run = ok("[]") as GhRunner & { calls: string[][] };

    await listOpenIssues(undefined, run);

    const args = run.calls[0] as string[];

    expect(args.slice(0, 2)).toEqual(["issue", "list"]);
    expect(args[args.indexOf("--label") + 1]).toBe(ISSUE_LABEL);
    expect(ISSUE_LABEL).toBe("dependency-finding");
    expect(args[args.indexOf("--state") + 1]).toBe("open");
    expect(args[args.indexOf("--limit") + 1]).toBe("1000");
  });

  test("a failed listing throws instead of reading as 'nothing open'", async () => {
    const run: GhRunner = async () => {
      throw new Error("gh failed (1): boom");
    };

    await expect(listOpenIssues(undefined, run)).rejects.toThrow("boom");
  });

  test("a listing as long as the limit is possibly truncated and refuses", async () => {
    const full = JSON.stringify(
      Array.from({ length: 1000 }, (_, i) => ({
        number: i + 1,
        title: "t",
        body: ""
      }))
    );

    await expect(listOpenIssues(undefined, ok(full))).rejects.toThrow(
      "truncated"
    );
    expect(
      await listOpenIssues(
        undefined,
        ok(JSON.stringify([{ number: 1, title: "t", body: "" }]))
      )
    ).toHaveLength(1);
  });

  test("a failing label or issue create propagates, so the run is red", async () => {
    const plan = [{ finding: f("k"), source: "s" }];
    const failing: GhRunner = async (args) => {
      if (args[0] === "issue") {
        throw new Error("create failed");
      }

      return "";
    };

    await expect(
      createIssues(plan, undefined, failing, () => {})
    ).rejects.toThrow("create failed");
    await expect(
      createIssues(
        plan,
        undefined,
        async () => {
          throw new Error("label failed");
        },
        () => {}
      )
    ).rejects.toThrow("label failed");
  });

  test("created issues carry the label and the marker as the first body line", async () => {
    const calls: string[][] = [];

    await createIssues(
      [{ finding: f("k"), source: "s" }],
      "o/r",
      async (args, repo) => {
        calls.push([...args, String(repo)]);
        return "https://example.test/1\n";
      },
      () => {}
    );

    const create = calls.find((c) => c[0] === "issue") as string[];

    expect(create[create.indexOf("--label") + 1]).toBe(ISSUE_LABEL);
    expect(
      (create[create.indexOf("--body") + 1] as string).split("\n")[0]
    ).toBe(findingMarker("k"));
  });
});

describe("the workflow step that files issues", () => {
  const workflow = readFileSync(
    path.resolve(
      import.meta.dirname,
      "../.github/workflows/dependency-freshness.yml"
    ),
    "utf8"
  );
  const step = workflow.slice(workflow.indexOf("- name: File issues"));

  test("runs under pipefail, so a failed sync is not swallowed by `| tee`", () => {
    // GitHub's default shell for `run:` is `bash -e {0}` WITHOUT pipefail: the
    // pipeline's status would be tee's, and a failed filing run would be green.
    expect(step).toContain("| tee");
    expect(step).toMatch(/shell:\s*bash\b/);
  });
});
