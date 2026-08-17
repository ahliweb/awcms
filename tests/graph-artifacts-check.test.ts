/**
 * The graph-artifact gate, proved against the defects that actually happened.
 *
 * Every case below is a defect that SHIPPED, not one imagined to make a rule
 * look useful:
 *
 *   - The label cases are the `awcms-astro` incident: community 6 named
 *     `content-blocks.ts` while its members came from a performance document,
 *     and three separate communities all named `BaseLayout.astro`. 60 of 101
 *     labels were attached to the wrong community and every gate was green,
 *     because none of them read `graphify-out/`.
 *   - The documentation cases are this repo's own: `knowledge-graph.md` stated
 *     8159/21470/485 while the committed `graph.json` held 9574/26456/570, and
 *     its table listed `.graphify_labels.json` as tracked while `.gitignore`
 *     line 63 (`graphify-out/.*`) excludes it.
 *
 * The direction of each assertion is what matters. A coverage gate can be green
 * while every answer under it is wrong, so each rule is fed the ORIGINAL broken
 * input and required to go red — a test that only proves the gate green on
 * today's tree proves nothing about the gate.
 *
 * Pure — no database, no network, no graphify installation.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  TRACKED_ARTIFACTS,
  checkCommunityLabels,
  checkDocumentation,
  checkExclusionsHeld,
  checkReportAgreesWithGraph,
  checkTrackedArtifacts,
  documentedCounts,
  documentedTrackingClaims,
  freshnessNote,
  graphCounts,
  parseGraphifyIgnore,
  reportedCommunityNames,
  reportedCounts,
  type Graph
} from "../scripts/graph-artifacts-check";

/** A minimal graph whose communities are all correctly named. */
function graph(nodes: Graph["nodes"], links: unknown[] = []): Graph {
  return { nodes, links, built_at_commit: "b2b6ce66" };
}

function summary(nodes: number, edges: number, communities: number): string {
  return `# Report\n\n- ${nodes} nodes · ${edges} edges · ${communities} communities\n`;
}

const HEALTHY_NODES: Graph["nodes"] = [
  {
    id: "a",
    community: 0,
    community_name: "Tenant Isolation",
    source_file: "src/a.ts"
  },
  {
    id: "b",
    community: 0,
    community_name: "Tenant Isolation",
    source_file: "src/b.ts"
  },
  {
    id: "c",
    community: 1,
    community_name: "Email Dispatch",
    source_file: "src/c.ts"
  }
];

describe("tracked artifacts", () => {
  const tracked = [...TRACKED_ARTIFACTS].map((name) => `graphify-out/${name}`);

  test("the four shared artifacts alone are accepted", () => {
    expect(checkTrackedArtifacts(tracked)).toEqual([]);
  });

  test("an untracked repo is not judged", () => {
    // No tracked files at all is "graphify-out/ is not in git", which is a
    // legitimate state — not four violations for four missing artifacts.
    expect(checkTrackedArtifacts([])).toEqual([]);
  });

  test.each([
    ["graphify-out/cache/stat-index.json", "cache"],
    ["graphify-out/.graphify_labels.json", "dot-file"],
    ["graphify-out/2026-07-26/graph.json", "dated copy"],
    ["graphify-out/graph.html", "graph.html"],
    ["graphify-out/graph.svg", "other"]
  ])("%s is rejected (%s)", (path) => {
    const violations = checkTrackedArtifacts([...tracked, path]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.file).toBe(path);
    expect(violations[0]!.rule).toBe("tracked");
  });

  test("a missing shared artifact is a violation", () => {
    const withoutGraph = tracked.filter((p) => !p.endsWith("graph.json"));
    const violations = checkTrackedArtifacts(withoutGraph);
    expect(violations.map((v) => v.message)).toEqual([
      "shared artifact is not tracked"
    ]);
  });
});

describe("report agrees with graph", () => {
  test("matching counts pass", () => {
    expect(
      checkReportAgreesWithGraph(graph(HEALTHY_NODES, [1, 2]), summary(3, 2, 2))
    ).toEqual([]);
  });

  test("a stale report is caught on every field", () => {
    // The shape that makes this necessary: report and graph both look valid on
    // their own, and a reader has no way to tell which one is behind.
    const violations = checkReportAgreesWithGraph(
      graph(HEALTHY_NODES, [1, 2]),
      summary(8159, 21470, 485)
    );
    expect(violations).toHaveLength(3);
    expect(violations.map((v) => v.message)).toEqual([
      "claims 8159 nodes, graph.json holds 3",
      "claims 21470 edges, graph.json holds 2",
      "claims 485 communities, graph.json holds 2"
    ]);
  });

  test("a report with no Summary line cannot be compared, and says so", () => {
    const violations = checkReportAgreesWithGraph(
      graph(HEALTHY_NODES),
      "# Report\n"
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("no Summary line");
  });

  test("reportedCounts reads the real Summary format", () => {
    expect(
      reportedCounts("- 9574 nodes · 26456 edges · 570 communities")
    ).toEqual({
      nodes: 9574,
      edges: 26456,
      communities: 570
    });
  });

  test("graphCounts ignores nodes with no community", () => {
    const counts = graphCounts(
      graph([
        ...HEALTHY_NODES,
        { id: "d", community: null, source_file: "src/d.ts" }
      ])
    );
    expect(counts).toEqual({ nodes: 4, edges: 0, communities: 2 });
  });
});

describe("community labels", () => {
  const report = summary(3, 0, 2);

  test("chosen names pass", () => {
    expect(checkCommunityLabels(graph(HEALTHY_NODES), report)).toEqual([]);
  });

  test("THE ASTRO INCIDENT: a filename as a label is rejected", () => {
    const violations = checkCommunityLabels(
      graph([
        {
          id: "a",
          community: 6,
          community_name: "content-blocks.ts",
          source_file: "src/a.ts"
        }
      ]),
      report
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("that is a filename");
  });

  test.each([
    "BaseLayout.astro",
    "client.ts",
    "package.json",
    "schema.sql",
    "standar-performa.md"
  ])("filename-shaped label %s is rejected", (name) => {
    const violations = checkCommunityLabels(
      graph([
        { id: "a", community: 3, community_name: name, source_file: "src/a.ts" }
      ]),
      report
    );
    expect(violations.map((v) => v.rule)).toEqual(["label"]);
  });

  test("a human name that merely contains a dot is NOT rejected", () => {
    // The gate must not train people to route around it. Only a real file
    // suffix counts, so a name like this stays legal.
    expect(
      checkCommunityLabels(
        graph([
          {
            id: "a",
            community: 3,
            community_name: "v1 API Surface",
            source_file: "src/a.ts"
          }
        ]),
        report
      )
    ).toEqual([]);
  });

  test("THE ASTRO INCIDENT: three communities sharing one name is rejected", () => {
    const violations = checkCommunityLabels(
      graph([
        {
          id: "a",
          community: 1,
          community_name: "Portal Layout",
          source_file: "src/a.ts"
        },
        {
          id: "b",
          community: 2,
          community_name: "Portal Layout",
          source_file: "src/b.ts"
        },
        {
          id: "c",
          community: 3,
          community_name: "Portal Layout",
          source_file: "src/c.ts"
        }
      ]),
      report
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain(
      "used by 3 communities at once (1, 2, 3)"
    );
  });

  test("the Community N placeholder is rejected", () => {
    const violations = checkCommunityLabels(
      graph([
        {
          id: "a",
          community: 7,
          community_name: "Community 7",
          source_file: "src/a.ts"
        }
      ]),
      report
    );
    expect(violations[0]!.message).toContain("still the placeholder");
  });

  test("a missing community_name is rejected", () => {
    const violations = checkCommunityLabels(
      graph([{ id: "a", community: 7, source_file: "src/a.ts" }]),
      report
    );
    expect(violations[0]!.message).toContain("has no community_name");
  });

  test("report and graph disagreeing on one community is rejected", () => {
    const violations = checkCommunityLabels(
      graph([
        {
          id: "a",
          community: 4,
          community_name: "Email Dispatch",
          source_file: "src/a.ts"
        }
      ]),
      `${report}\n### Community 4 - "Push Delivery"\n`
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain(
      'community 4 is "Push Delivery" in the report but "Email Dispatch" in graph.json'
    );
  });

  test("a community absent from the report is NOT a violation", () => {
    // The report only renders communities thick enough to show; absence is by
    // design, and flagging it would make the gate fire on correct artifacts.
    expect(
      checkCommunityLabels(
        graph([
          {
            id: "a",
            community: 99,
            community_name: "Thin Community",
            source_file: "src/a.ts"
          }
        ]),
        `${report}\n### Community 4 - "Email Dispatch"\n`
      )
    ).toEqual([]);
  });

  test("reportedCommunityNames parses the real heading format", () => {
    expect(
      reportedCommunityNames(
        '### Community 12 - "Tenant Isolation"\nprose\n### Community 13 - "Email"'
      )
    ).toEqual(
      new Map([
        [12, "Tenant Isolation"],
        [13, "Email"]
      ])
    );
  });
});

describe("exclusions hold", () => {
  const ignore = parseGraphifyIgnore(
    "# comment\n.changeset/\ndocs/vendor\n*.id.md\n!keep.md\n"
  );

  test("path-shaped entries are enforced, glob and negation are declared unenforced", () => {
    expect(ignore.prefixes).toEqual([".changeset", "docs/vendor"]);
    expect(ignore.unenforced).toEqual(["*.id.md", "!keep.md"]);
  });

  test("a graph respecting the exclusions passes", () => {
    expect(checkExclusionsHeld(graph(HEALTHY_NODES), ignore)).toEqual([]);
  });

  test("a rebuild that forgot .graphifyignore is caught, once per entry", () => {
    // Counted per exclusion, not per node: one forgotten file drags hundreds of
    // nodes in, and hundreds of lines for one cause would bury every other rule.
    const violations = checkExclusionsHeld(
      graph([
        {
          id: "a",
          community: 0,
          community_name: "X",
          source_file: ".changeset/aaa.md"
        },
        {
          id: "b",
          community: 0,
          community_name: "X",
          source_file: ".changeset/bbb.md"
        },
        {
          id: "c",
          community: 0,
          community_name: "X",
          source_file: "docs/vendor/spec.md"
        }
      ]),
      ignore
    );
    expect(violations).toHaveLength(2);
    expect(violations[0]!.message).toContain(
      "2 node(s) from 2 file(s) under the exclusion `.changeset`"
    );
    expect(violations[1]!.message).toContain(
      "1 node(s) from 1 file(s) under the exclusion `docs/vendor`"
    );
  });

  test("a prefix does not match a merely similarly-named sibling", () => {
    expect(
      checkExclusionsHeld(
        graph([
          {
            id: "a",
            community: 0,
            community_name: "X",
            source_file: "docs/vendored-notes.md"
          }
        ]),
        ignore
      )
    ).toEqual([]);
  });
});

describe("documentation matches the artifact", () => {
  const DOC = [
    "| File | Contents | Tracked? |",
    "| ---- | -------- | -------- |",
    "| `graph.json` | raw graph | ✅ |",
    "| `manifest.json`, `cost.json` | incremental state | ✅ |",
    "| `.graphify_labels.json` | community names | ❌ |",
    "| `cache/` | cache | ❌ |",
    "",
    "Numbers: **3 nodes, 2 edges, 2 communities**."
  ].join("\n");

  const TRACKED = [
    "graphify-out/GRAPH_REPORT.md",
    "graphify-out/cost.json",
    "graphify-out/graph.json",
    "graphify-out/manifest.json"
  ];

  const G = graph(HEALTHY_NODES, [1, 2]);

  test("an accurate document passes", () => {
    expect(checkDocumentation(DOC, G, TRACKED)).toEqual([]);
  });

  test("THIS REPO'S DEFECT: stale figures are caught", () => {
    const stale = DOC.replace(
      "**3 nodes, 2 edges, 2 communities**",
      "**8159 nodes, 21470 edges, 485 communities**"
    );
    const violations = checkDocumentation(stale, G, TRACKED);
    expect(violations).toHaveLength(3);
    for (const violation of violations) {
      expect(violation.rule).toBe("documentation");
      expect(violation.message).toContain("update the figure after a rebuild");
    }
  });

  test("THIS REPO'S DEFECT: claiming an untracked file is tracked is caught", () => {
    const wrong = DOC.replace(
      "| `.graphify_labels.json` | community names | ❌ |",
      "| `.graphify_labels.json` | community names | ✅ |"
    );
    const violations = checkDocumentation(wrong, G, TRACKED);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toBe(
      "lists `.graphify_labels.json` as tracked, but git does not track it (see the .gitignore rules for graphify-out/)"
    );
  });

  test("the reverse direction is caught too", () => {
    const wrong = DOC.replace(
      "| `graph.json` | raw graph | ✅ |",
      "| `graph.json` | raw graph | ❌ |"
    );
    const violations = checkDocumentation(wrong, G, TRACKED);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toBe(
      "lists `graph.json` as untracked, but git tracks it"
    );
  });

  test("a document stating no figures at all is caught", () => {
    const violations = checkDocumentation("no numbers here", G, []);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain("states no");
  });

  test("documentedTrackingClaims reads several files from one row", () => {
    expect(documentedTrackingClaims(DOC).get("manifest.json")).toBe(true);
    expect(documentedTrackingClaims(DOC).get("cost.json")).toBe(true);
    expect(documentedTrackingClaims(DOC).get("cache/")).toBe(false);
  });

  test("documentedCounts reads the bolded figure", () => {
    expect(
      documentedCounts("x **9574 nodes, 26456 edges, 570 communities** y")
    ).toEqual({
      nodes: 9574,
      edges: 26456,
      communities: 570
    });
  });
});

describe("freshness is a note, never a violation", () => {
  test.each([
    [0, "level with HEAD"],
    [145, "145 commit(s) behind HEAD"]
  ])("%i commits behind reads as a note", (behind, expected) => {
    expect(freshnessNote(graph(HEALTHY_NODES), behind as number)).toContain(
      expected
    );
  });

  test("an unreadable distance still produces a note", () => {
    expect(freshnessNote(graph(HEALTHY_NODES), null)).toContain("unreadable");
  });

  test("a graph with no built_at_commit says so", () => {
    expect(freshnessNote({ nodes: [], links: [] }, 3)).toContain(
      "names no built_at_commit"
    );
  });
});

describe("the committed artifact itself", () => {
  // Guards against a vacuous suite: the rules above run on fixtures, and this
  // one proves they also hold for the artifact actually in the repo. Without it
  // the whole file could pass while `graphify-out/` was broken.
  test("passes every rule", () => {
    const committed = JSON.parse(
      readFileSync("graphify-out/graph.json", "utf8")
    ) as Graph;
    const report = readFileSync("graphify-out/GRAPH_REPORT.md", "utf8");
    const doc = readFileSync("docs/awcms/knowledge-graph.md", "utf8");
    const ignore = parseGraphifyIgnore(readFileSync(".graphifyignore", "utf8"));
    const tracked = [...TRACKED_ARTIFACTS].map(
      (name) => `graphify-out/${name}`
    );

    expect(committed.nodes.length).toBeGreaterThan(0);
    expect(checkReportAgreesWithGraph(committed, report)).toEqual([]);
    expect(checkCommunityLabels(committed, report)).toEqual([]);
    expect(checkExclusionsHeld(committed, ignore)).toEqual([]);
    expect(checkDocumentation(doc, committed, tracked)).toEqual([]);
  });
});
