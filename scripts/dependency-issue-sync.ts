/**
 * dependency-issue-sync.ts — `bun run deps:issues:sync` (Issue #1173).
 *
 * Turns the findings of the dependency-governance gates into GitHub issues,
 * IDEMPOTENTLY: one open issue per finding, however many times the schedule
 * runs.
 *
 * ## How it stays quiet
 *
 * - **Identity, not text.** Each finding has a stable `key`
 *   (`scripts/lib/dependency-finding.ts`); its fingerprint is written into the
 *   issue body as a hidden marker. A run lists the OPEN issues that carry the
 *   label, collects their markers, and files only findings with no open marker.
 * - **A closed issue does not hide a recurrence.** If a maintainer closes an
 *   issue and the finding is still true next week, it is filed again: closing
 *   is a statement about the issue, not about the dependency.
 * - **A cap per run** (`--max-create`, default 10), so a first run against a
 *   badly behind repository files ten and says how many it deferred, instead of
 *   burying the tracker. Deferred findings are filed on later runs.
 * - **It never closes, edits or comments** on an issue, and never touches a
 *   file: reading findings and creating issues is its whole authority.
 * - **Fail closed against spam.** If the open-issue listing fails, or is as long
 *   as the limit asked for (so it may be truncated), nothing is created: filing
 *   without knowing what is already open is exactly how duplicates happen.
 *
 * Dry-run by default; `--create` is what writes.
 *
 * Usage:
 *   bun run deps:issues:sync --findings license.json --findings provider.json \
 *       --freshness dependency-freshness.json [--create] [--repo owner/name]
 *
 * Requires the `gh` CLI with `issues: write` (`GH_TOKEN` in Actions).
 */
import { readFileSync } from "node:fs";

import {
  findingFingerprint,
  findingMarker,
  markersIn,
  neutralizeUntrusted,
  type Finding,
  type FindingFile
} from "./lib/dependency-finding";

export const ISSUE_LABEL = "dependency-finding";
export const TITLE_PREFIX = "deps: ";
const LIST_LIMIT = 1000;

export type OpenIssue = { number: number; title: string; body: string };

export type IssuePlan = {
  toCreate: { finding: Finding; source: string }[];
  alreadyOpen: { key: string; number: number }[];
  /** Over the per-run cap: filed on a later run. */
  deferred: Finding[];
};

/**
 * `strictFailures` lines from `deps:freshness`, as findings. The key is the line
 * up to the first `: ` ("held-back bun", "image oven/bun:1.4.4 (Dockerfile...)",
 * "bun outdated"), which names the subject and not the volatile reason. An
 * advisory line keeps its whole text: the violation IS its identity.
 */
export function freshnessFindings(manifest: unknown): FindingFile {
  const failures = (manifest as { strictFailures?: unknown }).strictFailures;

  if (!Array.isArray(failures)) {
    throw new Error("freshness manifest has no strictFailures array");
  }

  const findings: Finding[] = failures
    .filter((line): line is string => typeof line === "string")
    .map((line) => {
      const subject = line.startsWith("advisory: ")
        ? line
        : line.slice(
            0,
            line.indexOf(": ") === -1 ? undefined : line.indexOf(": ")
          );

      return {
        key: `freshness:${subject}`,
        title: line.length > 120 ? `${line.slice(0, 117)}...` : line,
        detail:
          `\`bun run deps:freshness --strict\` reported:\n\n> ${line}\n\n` +
          "Follow `docs/awcms/dependency-governance.md`: an upgrade is its own atomic PR; a deliberate hold goes in the held-back register."
      };
    });

  return { source: "deps:freshness", findings };
}

export function planIssues(input: {
  files: readonly FindingFile[];
  openIssues: readonly OpenIssue[];
  maxCreate: number;
}): IssuePlan {
  const open = new Map<string, number>();

  for (const issue of input.openIssues) {
    for (const fingerprint of markersIn(issue.body)) {
      if (!open.has(fingerprint)) {
        open.set(fingerprint, issue.number);
      }
    }
  }

  const seen = new Set<string>();
  const plan: IssuePlan = { toCreate: [], alreadyOpen: [], deferred: [] };

  for (const file of input.files) {
    for (const finding of file.findings) {
      const fingerprint = findingFingerprint(finding.key);

      if (seen.has(fingerprint)) {
        continue;
      }

      seen.add(fingerprint);

      const existing = open.get(fingerprint);

      if (existing !== undefined) {
        plan.alreadyOpen.push({ key: finding.key, number: existing });
      } else if (plan.toCreate.length < input.maxCreate) {
        plan.toCreate.push({ finding, source: file.source });
      } else {
        plan.deferred.push(finding);
      }
    }
  }

  return plan;
}

export function issueTitle(finding: Finding): string {
  const title = `${TITLE_PREFIX}${finding.title}`;

  return title.length > 200 ? `${title.slice(0, 197)}...` : title;
}

export function issueBody(finding: Finding, source: string): string {
  return [
    findingMarker(finding.key),
    "",
    neutralizeUntrusted(finding.detail),
    "",
    "---",
    `Filed automatically by the scheduled dependency-governance workflow (${source}, Issue #1173). ` +
      "One open issue per finding: while this issue is open the workflow will not file it again, and it never closes it. " +
      "If you close this issue and the finding is still true, the next run files a new one."
  ].join("\n");
}

// ---------------------------------------------------------------------------
// gh
// ---------------------------------------------------------------------------

/** The `gh` invocation, injectable so tests can pin what is asked and how failure is handled. */
export type GhRunner = (
  args: readonly string[],
  repo: string | undefined
) => Promise<string>;

const gh: GhRunner = async (args, repo) => {
  const child = Bun.spawn(["gh", ...args, ...(repo ? ["--repo", repo] : [])], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited
  ]);

  if (code !== 0) {
    throw new Error(`gh ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  }

  return stdout;
};

export async function listOpenIssues(
  repo: string | undefined,
  run: GhRunner = gh
): Promise<OpenIssue[]> {
  const stdout = await run(
    [
      "issue",
      "list",
      "--state",
      "open",
      "--label",
      ISSUE_LABEL,
      "--limit",
      String(LIST_LIMIT),
      "--json",
      "number,title,body"
    ],
    repo
  );
  const issues = JSON.parse(stdout) as OpenIssue[];

  if (issues.length >= LIST_LIMIT) {
    throw new Error(
      `open issue listing reached ${LIST_LIMIT}: it may be truncated, refusing to file anything`
    );
  }

  return issues;
}

/**
 * Creates the planned issues. Any `gh` failure throws: the caller turns that
 * into a non-zero exit, so a run that could not file what it found is red.
 */
export async function createIssues(
  toCreate: IssuePlan["toCreate"],
  repo: string | undefined,
  run: GhRunner = gh,
  log: (line: string) => void = (line) => process.stdout.write(line)
): Promise<void> {
  // The label must exist before an issue can carry it; creating it is
  // idempotent (`--force` updates instead of failing).
  await run(
    [
      "label",
      "create",
      ISSUE_LABEL,
      "--description",
      "Filed by the scheduled dependency-governance workflow (one per finding)",
      "--color",
      "0366d6",
      "--force"
    ],
    repo
  );

  for (const { finding, source } of toCreate) {
    const url = (
      await run(
        [
          "issue",
          "create",
          "--title",
          issueTitle(finding),
          "--body",
          issueBody(finding, source),
          "--label",
          ISSUE_LABEL
        ],
        repo
      )
    ).trim();

    log(`  filed ${url}: ${finding.key}\n`);
  }
}

function argValues(args: readonly string[], flag: string): string[] {
  const values: string[] = [];

  args.forEach((arg, index) => {
    if (arg === flag && args[index + 1] !== undefined) {
      values.push(args[index + 1] as string);
    }
  });

  return values;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repo = argValues(args, "--repo")[0];
  const maxCreate = Number(argValues(args, "--max-create")[0] ?? "10");

  if (!Number.isInteger(maxCreate) || maxCreate < 0) {
    throw new Error("--max-create must be a non-negative integer");
  }

  const files: FindingFile[] = [];

  for (const file of argValues(args, "--findings")) {
    files.push(JSON.parse(readFileSync(file, "utf8")) as FindingFile);
  }

  for (const file of argValues(args, "--freshness")) {
    files.push(freshnessFindings(JSON.parse(readFileSync(file, "utf8"))));
  }

  const total = files.reduce((sum, file) => sum + file.findings.length, 0);

  if (total === 0) {
    process.stdout.write("deps:issues:sync: no findings, nothing to file.\n");
    return;
  }

  const plan = planIssues({
    files,
    openIssues: await listOpenIssues(repo),
    maxCreate
  });

  process.stdout.write(
    `deps:issues:sync: ${total} finding(s): ${plan.alreadyOpen.length} already have an open issue, ${plan.toCreate.length} to file, ${plan.deferred.length} deferred by the cap of ${maxCreate}.\n`
  );

  for (const item of plan.alreadyOpen) {
    process.stdout.write(`  open #${item.number}: ${item.key}\n`);
  }

  if (!args.includes("--create")) {
    for (const { finding } of plan.toCreate) {
      process.stdout.write(`  would file: ${issueTitle(finding)}\n`);
    }

    process.stdout.write("Dry run: pass --create to file them.\n");
    return;
  }

  await createIssues(plan.toCreate, repo);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `deps:issues:sync: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
