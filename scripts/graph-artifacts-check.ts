#!/usr/bin/env bun
/**
 * graph:artifacts:check — the committed knowledge graph must describe itself
 * honestly.
 *
 * ## Why a gate
 *
 * This repo tracks four graphify outputs (`graph.json`, `GRAPH_REPORT.md`,
 * `manifest.json`, `cost.json`) and deliberately tracks nothing else under
 * `graphify-out/`. The four `.gitignore` rules that arrange this each carry a
 * paragraph of reasoning and, until now, NO checker. The sibling repo
 * `awcms-astro` learned what that costs: 60 of its 101 community labels were
 * attached to the wrong communities — community 6 named `content-blocks.ts`
 * while its members came entirely from a performance document, and three
 * separate communities all named `BaseLayout.astro`.
 *
 * Nothing could catch it. The JSON was valid, the report was tidy, and every
 * other gate was green, because not one of them reads `graphify-out/`. Community
 * names are not decoration: they are what `graphify query`, any GraphRAG
 * consumer, and any human navigating the graph actually read. A graph that
 * names its own communities wrongly is worse than no graph, because it answers
 * confidently.
 *
 * The same silence applied to the prose. `docs/awcms/knowledge-graph.md` stated
 * "8159 nodes, 21470 edges, 485 communities" while the tracked `graph.json` held
 * 9574/26456/570, and its table listed `.graphify_labels.json` as tracked when
 * `.gitignore` line 63 (`graphify-out/.*`) excludes it. Both claims were written
 * true and went false when the artifact moved underneath them — the failure mode
 * the whole `.generated` discipline in this repo exists to prevent.
 *
 * ## What is checked
 *
 *   1. **Only the four shared artifacts are tracked.** This is what enforces the
 *      four `.gitignore` rules: cache, dot-files, dated copies, and `graph.html`
 *      each have a written reason to stay out of history, and now a checker.
 *   2. **The report and the graph come from the same run.** The Summary line of
 *      `GRAPH_REPORT.md` claims node/edge/community counts; `graph.json` holds
 *      all three. Disagreement means one of them is stale and a reader has no
 *      way to tell which.
 *   3. **Every community has a name somebody chose.** Four rules, each because
 *      breaking it yields a graph that reads right and navigates wrong: not a
 *      filename (that is `label_communities_by_hub` output, which is free and
 *      never reads the community); not the `Community N` placeholder; no two
 *      communities sharing a name; and the name in `graph.json` matching the
 *      name in `GRAPH_REPORT.md` for the same community.
 *   4. **What is excluded stays excluded.** No node's `source_file` may sit
 *      under a `.graphifyignore` entry. A rebuild run without that file — or
 *      from another directory — re-admits what was deliberately dropped and
 *      silently inflates the graph.
 *   5. **The documentation matches the artifact.** `docs/awcms/knowledge-graph.md`
 *      states the counts and lists which files are tracked; both are checked
 *      against reality.
 *
 * ## What is deliberately NOT checked
 *
 *   - **Staleness as a violation.** The distance between `built_at_commit` and
 *     `HEAD` is REPORTED as a note and never turns the gate red. Turning it red
 *     would force every PR touching an indexed file to carry a multi-megabyte
 *     rebuild, and a gate that expensive gets relaxed within a month. What is
 *     guarded here is the artifact's INTERNAL honesty; when to rebuild stays a
 *     deliberate decision, and the note keeps that decision visible.
 *   - **Name quality beyond its shape.** This gate can prove a label is not a
 *     filename; it cannot judge whether "Tenant Transaction & Authorization
 *     Core" is a good name for its community. Naming remains the reader's job —
 *     what is guarded is only that the job was done.
 *   - **Glob patterns in `.graphifyignore`.** Only directory- or path-shaped
 *     entries are enforced. Patterns containing `*`, `?`, or `[` are REPORTED as
 *     unenforced rather than skipped in silence: an exclusion that appears
 *     guarded while it is not is more dangerous than one plainly manual.
 *
 * Needs no build, no network, and no graphify installation — it only reads
 * artifacts already in the repo, so it runs in the CI `check` job.
 *
 * A repo with no `graphify-out/` PASSES with a note. That is a legitimate state:
 * the graph is an aid, not a requirement.
 *
 * The optional first argument is the root to inspect (default `.`), which is how
 * `tests/graph-artifacts-check.test.ts` runs each rule over a fixture tree and
 * proves it goes RED when the original defect is put back.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const OUTPUT_DIR = "graphify-out";
const DOC_PATH = "docs/awcms/knowledge-graph.md";

/**
 * The graphify artifacts this repo tracks, and only these.
 *
 * The list comes from `.gitignore`, which writes the reason for each exclusion:
 * shared output is named without a leading dot, while cache, dot-files, dated
 * copies, and `graph.html` each have their own reason to stay out of history.
 */
export const TRACKED_ARTIFACTS: ReadonlySet<string> = new Set([
  "GRAPH_REPORT.md",
  "cost.json",
  "graph.json",
  "manifest.json"
]);

/**
 * Suffixes that give a community label away as a filename.
 *
 * Deliberately a suffix list rather than something cleverer: a human-language
 * name that happens to end in `.md` essentially does not occur, while a looser
 * heuristic would redden legitimate names and teach people to ignore this gate.
 */
const FILE_SUFFIX =
  /\.(ts|tsx|js|mjs|cjs|jsx|astro|json|jsonc|md|mdx|ya?ml|toml|css|scss|html|py|sh|sql|lock)$/i;

export type Violation = {
  rule:
    | "tracked"
    | "artifact"
    | "report-agrees"
    | "label"
    | "exclusion"
    | "documentation";
  file: string;
  message: string;
};

export type GraphNode = {
  id?: string;
  community?: number | null;
  community_name?: string | null;
  source_file?: string;
};

export type Graph = {
  nodes: GraphNode[];
  links?: unknown[];
  built_at_commit?: string;
};

export type GraphCounts = {
  nodes: number;
  edges: number;
  communities: number;
};

/** The counts actually present in `graph.json`. */
export function graphCounts(graph: Graph): GraphCounts {
  return {
    nodes: graph.nodes.length,
    edges: (graph.links ?? []).length,
    communities: new Set(
      graph.nodes
        .map((node) => node.community)
        .filter((community) => community !== undefined && community !== null)
    ).size
  };
}

// ---------------------------------------------------------------------------
// 1. Only the four shared artifacts are tracked
// ---------------------------------------------------------------------------

/**
 * `trackedPaths` is the output of `git ls-files -- graphify-out`, already split.
 * Passing it in (rather than shelling out here) is what lets the test drive
 * every branch without constructing a git repository.
 */
export function checkTrackedArtifacts(
  trackedPaths: readonly string[]
): Violation[] {
  if (trackedPaths.length === 0) return [];

  const violations: Violation[] = [];
  const prefix = `${OUTPUT_DIR}/`;

  for (const trackedPath of trackedPaths) {
    const name = trackedPath.startsWith(prefix)
      ? trackedPath.slice(prefix.length)
      : trackedPath;

    if (TRACKED_ARTIFACTS.has(name)) continue;

    // The message names the rule that was broken rather than merely saying
    // "not allowed": what a reader sees when the gate is red is this line, not
    // `.gitignore`.
    const reason = name.startsWith("cache/")
      ? "cache is machine-specific and never enters history"
      : name.startsWith(".")
        ? "a dot-file is a build intermediate or a path marker, never shared output"
        : /^\d{4}-\d{2}-\d{2}\//.test(name)
          ? "a dated copy is a full duplicate of the live artifact beside it"
          : name === "graph.html"
            ? "graph.html stops being emitted above the viz node limit and then rots silently"
            : "not one of the four shared artifacts";

    violations.push({
      rule: "tracked",
      file: trackedPath,
      message: `tracked even though ${reason}`
    });
  }

  for (const name of TRACKED_ARTIFACTS) {
    if (!trackedPaths.includes(`${prefix}${name}`)) {
      violations.push({
        rule: "tracked",
        file: `${prefix}${name}`,
        message: "shared artifact is not tracked"
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// 2. The report and the graph come from the same run
// ---------------------------------------------------------------------------

/** Counts claimed by the Summary line of `GRAPH_REPORT.md`, or `null`. */
export function reportedCounts(report: string): GraphCounts | null {
  const match = report.match(
    /^- (\d+) nodes · (\d+) edges · (\d+) communities/m
  );
  if (!match) return null;

  return {
    nodes: Number(match[1]),
    edges: Number(match[2]),
    communities: Number(match[3])
  };
}

export function checkReportAgreesWithGraph(
  graph: Graph,
  report: string
): Violation[] {
  const claimed = reportedCounts(report);

  if (!claimed) {
    return [
      {
        rule: "report-agrees",
        file: `${OUTPUT_DIR}/GRAPH_REPORT.md`,
        message:
          "has no Summary line `- N nodes · N edges · N communities`, so it cannot be compared with graph.json"
      }
    ];
  }

  const actual = graphCounts(graph);

  return (["nodes", "edges", "communities"] as const)
    .filter((field) => claimed[field] !== actual[field])
    .map((field) => ({
      rule: "report-agrees" as const,
      file: `${OUTPUT_DIR}/GRAPH_REPORT.md`,
      message: `claims ${claimed[field]} ${field}, graph.json holds ${actual[field]}`
    }));
}

// ---------------------------------------------------------------------------
// 3. Every community has a name somebody chose
// ---------------------------------------------------------------------------

/** `{ id → label }` from `### Community N - "label"` headings in the report. */
export function reportedCommunityNames(report: string): Map<number, string> {
  const names = new Map<number, string>();

  for (const line of report.split("\n")) {
    const match = line.match(/^### Community (\d+) - "(.*)"\s*$/);
    if (match) names.set(Number(match[1]), match[2]!);
  }

  return names;
}

export function checkCommunityLabels(
  graph: Graph,
  report: string
): Violation[] {
  const graphNames = new Map<number, string | null | undefined>();

  for (const node of graph.nodes) {
    const community = node.community;
    if (community === undefined || community === null) continue;
    if (!graphNames.has(community))
      graphNames.set(community, node.community_name);
  }

  if (graphNames.size === 0) return [];

  const violations: Violation[] = [];
  const reportNames = reportedCommunityNames(report);
  const usedBy = new Map<string, number[]>();
  const graphFile = `${OUTPUT_DIR}/graph.json`;

  for (const [community, name] of [...graphNames].sort((a, b) => a[0] - b[0])) {
    if (name === undefined || name === null || name === "") {
      violations.push({
        rule: "label",
        file: graphFile,
        message: `community ${community} has no community_name`
      });
      continue;
    }

    if (name === `Community ${community}`) {
      violations.push({
        rule: "label",
        file: graphFile,
        message: `community ${community} is still the placeholder "${name}"`
      });
    } else if (FILE_SUFFIX.test(name)) {
      violations.push({
        rule: "label",
        file: graphFile,
        message: `community ${community} is named "${name}" — that is a filename (hub-naming output), not a chosen name`
      });
    }

    usedBy.set(name, [...(usedBy.get(name) ?? []), community]);

    // The report only carries communities thick enough to render; thin ones are
    // omitted on purpose. So ABSENCE is not a violation — disagreement is.
    const inReport = reportNames.get(community);
    if (inReport !== undefined && inReport !== name) {
      violations.push({
        rule: "label",
        file: `${OUTPUT_DIR}/GRAPH_REPORT.md`,
        message: `community ${community} is "${inReport}" in the report but "${name}" in graph.json`
      });
    }
  }

  for (const [name, communities] of usedBy) {
    if (communities.length > 1) {
      violations.push({
        rule: "label",
        file: graphFile,
        message: `the name "${name}" is used by ${communities.length} communities at once (${communities.join(", ")})`
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// 4. What is excluded stays excluded
// ---------------------------------------------------------------------------

export type ParsedIgnore = {
  /** Directory- or path-shaped entries, which this gate can enforce. */
  prefixes: string[];
  /** Entries whose shape this gate cannot enforce, reported as such. */
  unenforced: string[];
};

export function parseGraphifyIgnore(contents: string): ParsedIgnore {
  const prefixes: string[] = [];
  const unenforced: string[] = [];

  for (const line of contents.split("\n")) {
    const pattern = line.trim();
    if (!pattern || pattern.startsWith("#")) continue;

    // Negation re-admits files. graphify cannot honour it in this file (it can
    // only ever exclude more), so finding one means the file misunderstands
    // itself — say so rather than guess.
    if (pattern.startsWith("!") || /[*?[\]]/.test(pattern)) {
      unenforced.push(pattern);
      continue;
    }

    prefixes.push(pattern.replace(/^\/+/, "").replace(/\/+$/, ""));
  }

  return { prefixes, unenforced };
}

export function checkExclusionsHeld(
  graph: Graph,
  ignore: ParsedIgnore
): Violation[] {
  // Counted per exclusion, not per node. One rebuild that forgot
  // `.graphifyignore` breaks the rule ONCE and drags hundreds of nodes along;
  // printing hundreds of lines for a single cause buries every other rule under
  // it. What a reader needs is which entry, how many nodes, and one example.
  const offenders = new Map<
    string,
    { nodes: number; files: Set<string>; example: string }
  >();

  for (const node of graph.nodes) {
    const source = node.source_file;
    if (typeof source !== "string" || source === "") continue;

    for (const prefix of ignore.prefixes) {
      if (source === prefix || source.startsWith(`${prefix}/`)) {
        const seen = offenders.get(prefix);
        if (seen) {
          seen.nodes += 1;
          seen.files.add(source);
        } else {
          offenders.set(prefix, {
            nodes: 1,
            files: new Set([source]),
            example: source
          });
        }
        break;
      }
    }
  }

  return [...offenders].map(([prefix, { nodes, files, example }]) => ({
    rule: "exclusion" as const,
    file: `${OUTPUT_DIR}/graph.json`,
    message: `${nodes} node(s) from ${files.size} file(s) under the exclusion \`${prefix}\` (e.g. ${example}) — was the graph rebuilt without .graphifyignore?`
  }));
}

// ---------------------------------------------------------------------------
// 5. The documentation matches the artifact
// ---------------------------------------------------------------------------

/**
 * Counts stated by `docs/awcms/knowledge-graph.md`.
 *
 * The doc states them in prose rather than in a generated block on purpose: a
 * rebuild is a rare, deliberate act, so one line to update afterwards is
 * proportionate, whereas a generated block inside a hash-mirrored document
 * (ADR-0097) would have to be kept in step across both language copies.
 */
export function documentedCounts(doc: string): GraphCounts | null {
  const match = doc.match(
    /\*\*(\d+) nodes, (\d+) edges, (\d+) communities\*\*/
  );
  if (!match) return null;

  return {
    nodes: Number(match[1]),
    edges: Number(match[2]),
    communities: Number(match[3])
  };
}

/**
 * The tracked/untracked claims of the doc's table, as
 * `{ name → claimed tracked }`. Column one may name several files in one row.
 */
export function documentedTrackingClaims(doc: string): Map<string, boolean> {
  const claims = new Map<string, boolean>();

  for (const line of doc.split("\n")) {
    if (!line.startsWith("|")) continue;

    const cells = line.split("|").slice(1, -1);
    if (cells.length < 3) continue;

    const names = [...cells[0]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    if (names.length === 0) continue;

    const verdict = cells[cells.length - 1]!;
    const tracked = verdict.includes("✅");
    const untracked = verdict.includes("❌");
    if (!tracked && !untracked) continue;

    for (const name of names) claims.set(name, tracked);
  }

  return claims;
}

export function checkDocumentation(
  doc: string,
  graph: Graph,
  trackedPaths: readonly string[]
): Violation[] {
  const violations: Violation[] = [];
  const actual = graphCounts(graph);
  const claimed = documentedCounts(doc);

  if (!claimed) {
    violations.push({
      rule: "documentation",
      file: DOC_PATH,
      message:
        "states no `**N nodes, N edges, N communities**` figure, so the artifact it describes cannot be identified"
    });
  } else {
    for (const field of ["nodes", "edges", "communities"] as const) {
      if (claimed[field] !== actual[field]) {
        violations.push({
          rule: "documentation",
          file: DOC_PATH,
          message: `states ${claimed[field]} ${field}, graph.json holds ${actual[field]} — update the figure after a rebuild`
        });
      }
    }
  }

  const tracked = new Set(trackedPaths);

  for (const [name, claimedTracked] of documentedTrackingClaims(doc)) {
    // A trailing slash names a directory: tracked if anything under it is.
    const reallyTracked = name.endsWith("/")
      ? trackedPaths.some((entry) => entry.startsWith(`${OUTPUT_DIR}/${name}`))
      : tracked.has(`${OUTPUT_DIR}/${name}`);

    if (claimedTracked !== reallyTracked) {
      violations.push({
        rule: "documentation",
        file: DOC_PATH,
        message: reallyTracked
          ? `lists \`${name}\` as untracked, but git tracks it`
          : `lists \`${name}\` as tracked, but git does not track it (see the .gitignore rules for graphify-out/)`
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function git(root: string, ...args: string[]): string | null {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    stdout: "pipe",
    stderr: "pipe"
  });
  return result.exitCode === 0 ? result.stdout.toString() : null;
}

/** Distance from the graph's build commit to HEAD, reported and never fatal. */
export function freshnessNote(
  graph: Graph,
  commitsBehind: number | null
): string {
  const builtAt = graph.built_at_commit;

  if (typeof builtAt !== "string" || builtAt === "") {
    return "freshness: graph.json names no built_at_commit";
  }

  const short = builtAt.slice(0, 8);

  if (commitsBehind === null) {
    return `freshness: built from ${short}, distance to HEAD unreadable`;
  }

  return commitsBehind === 0
    ? `freshness: built from ${short}, level with HEAD`
    : `freshness: built from ${short}, ${commitsBehind} commit(s) behind HEAD — consider \`/graphify . --update\``;
}

if (import.meta.main) {
  const root = process.argv[2] ?? ".";
  const outputDir = path.join(root, OUTPUT_DIR);

  const violations: Violation[] = [];
  const notes: string[] = [];

  console.log("── graph:artifacts:check ──");

  if (!existsSync(outputDir)) {
    // A legitimate state — the graph is an aid, not a requirement. This gate
    // guards the artifact that EXISTS; it does not mandate one.
    console.log(`  ${OUTPUT_DIR}/ absent — no graph artifacts to check`);
    console.log("\ngraph:artifacts:check OK — nothing to verify.");
    process.exit(0);
  }

  const trackedOutput = git(root, "ls-files", "--", OUTPUT_DIR);

  if (trackedOutput === null) {
    // A gate that passes quietly when it could not run is a false tick.
    notes.push(
      "tracked: SKIPPED — not a git repository, `git ls-files` unavailable"
    );
  } else {
    const trackedPaths = trackedOutput.split("\n").filter(Boolean);
    violations.push(...checkTrackedArtifacts(trackedPaths));
    notes.push(
      `tracked: ${trackedPaths.length} file(s) tracked under ${OUTPUT_DIR}/`
    );
  }

  const graphPath = path.join(outputDir, "graph.json");
  const reportPath = path.join(outputDir, "GRAPH_REPORT.md");

  let graph: Graph | null = null;

  if (!existsSync(graphPath)) {
    violations.push({
      rule: "artifact",
      file: `${OUTPUT_DIR}/graph.json`,
      message: `absent even though ${OUTPUT_DIR}/ exists`
    });
  } else {
    try {
      const parsed = JSON.parse(readFileSync(graphPath, "utf8")) as Graph;
      if (!Array.isArray(parsed.nodes)) {
        violations.push({
          rule: "artifact",
          file: `${OUTPUT_DIR}/graph.json`,
          message: "has no `nodes` array"
        });
      } else {
        graph = parsed;
      }
    } catch (error) {
      violations.push({
        rule: "artifact",
        file: `${OUTPUT_DIR}/graph.json`,
        message: `is not readable as JSON: ${(error as Error).message}`
      });
    }
  }

  if (graph) {
    const counts = graphCounts(graph);
    notes.push(
      `graph: ${counts.nodes} nodes, ${counts.edges} edges, ${counts.communities} communities`
    );

    if (!existsSync(reportPath)) {
      violations.push({
        rule: "artifact",
        file: `${OUTPUT_DIR}/GRAPH_REPORT.md`,
        message: "absent even though graph.json exists"
      });
    } else {
      const report = readFileSync(reportPath, "utf8");
      violations.push(...checkReportAgreesWithGraph(graph, report));
      violations.push(...checkCommunityLabels(graph, report));
    }

    const ignorePath = path.join(root, ".graphifyignore");

    if (!existsSync(ignorePath)) {
      notes.push("exclusions: no .graphifyignore");
    } else {
      const ignore = parseGraphifyIgnore(readFileSync(ignorePath, "utf8"));
      violations.push(...checkExclusionsHeld(graph, ignore));
      notes.push(
        `exclusions: ${ignore.prefixes.length} entr(ies) enforced` +
          (ignore.unenforced.length > 0
            ? `, ${ignore.unenforced.length} NOT enforced (${ignore.unenforced.join(", ")})`
            : "")
      );
    }

    const docPath = path.join(root, DOC_PATH);

    if (!existsSync(docPath)) {
      notes.push(`documentation: ${DOC_PATH} absent`);
    } else if (trackedOutput !== null) {
      violations.push(
        ...checkDocumentation(
          readFileSync(docPath, "utf8"),
          graph,
          trackedOutput.split("\n").filter(Boolean)
        )
      );
    }

    const behind = git(
      root,
      "rev-list",
      "--count",
      `${graph.built_at_commit}..HEAD`
    );
    notes.push(
      freshnessNote(
        graph,
        behind === null ? null : Number.parseInt(behind.trim(), 10)
      )
    );
  }

  for (const note of notes) console.log(`  ${note}`);

  if (violations.length === 0) {
    console.log(
      "\ngraph:artifacts:check OK — the committed graph describes itself honestly."
    );
    process.exit(0);
  }

  console.error(
    `\ngraph:artifacts:check FAILED — ${violations.length} violation(s):\n`
  );

  const byRule = new Map<string, Violation[]>();
  for (const violation of violations) {
    byRule.set(violation.rule, [
      ...(byRule.get(violation.rule) ?? []),
      violation
    ]);
  }

  for (const [rule, list] of byRule) {
    console.error(`  [${rule}] ${list.length}`);
    for (const { file, message } of list) {
      console.error(`    ${file}: ${message}`);
    }
    console.error("");
  }

  process.exit(1);
}
