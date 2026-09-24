#!/usr/bin/env bun
/**
 * knowledge:obsidian:export — the ONLY writer of `knowledge/generated/graphify/`.
 *
 * ## Why this exists (Issue #805, ADR-0124)
 *
 * Graphify's Obsidian export (`graphify export obsidian`) writes one Markdown
 * note per graph node plus a generated `.obsidian/` config folder. This repo
 * never lets that export land directly in the human-curated `knowledge/`
 * vault: it is redirected first to an isolated staging path
 * (`graphify-out/obsidian-staging/`, gitignored like the rest of graphify's
 * regenerable exports), and this script is the only thing allowed to move a
 * validated, allow-listed subset of it into `knowledge/generated/graphify/`.
 *
 * `knowledge/curated/` is human-authored and is NEVER a write target here —
 * the script does not even resolve a write path under it, so there is no
 * code path by which a bug in the copy step could reach it.
 *
 * ## Fail-closed contract
 *
 * The entire staged tree is walked and validated BEFORE a single byte is
 * written to `knowledge/generated/graphify/`. Any one of the following
 * violations aborts the run with a non-zero exit and NO write at all — not a
 * partial copy of the files that happened to validate first:
 *
 *   1. **Path traversal** — an entry whose relative path contains `..`, or
 *      whose resolved real path (after following any symlink) does not sit
 *      under the staging root.
 *   2. **Unexpected file type** — anything whose extension is not in
 *      `ALLOWED_EXTENSIONS` (`.md`, `.canvas`). This is what keeps a
 *      generated `.obsidian/` config folder, a `.json` vault settings file,
 *      or any other exporter byproduct out of the synced area.
 *   3. **Filename collision with curated content** — a staged file whose
 *      basename already exists somewhere under `knowledge/curated/`.
 *   4. **Escaping entry** — a symlink, device file, or anything else whose
 *      target is not a plain file/directory under the staging root.
 *
 * Only after every entry in the staged tree passes all four checks does the
 * script wipe and rewrite `knowledge/generated/graphify/` — a clean rebuild,
 * never an incremental merge, so nothing stale from a since-removed node can
 * survive a re-sync. `knowledge/curated/` is read (to build the collision
 * set) and never written.
 *
 * Needs no network and no Graphify installation — it only copies files
 * already produced by a separate `graphify export obsidian` step, which is
 * what lets `tests/knowledge-obsidian-sync.test.ts` exercise every branch
 * against fixture trees with no `graphify` binary present.
 */
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
  type Dirent
} from "node:fs";
import path from "node:path";

export const STAGING_DIR = "graphify-out/obsidian-staging";
export const DEST_DIR = "knowledge/generated/graphify";
export const CURATED_DIR = "knowledge/curated";

/**
 * The tested Graphify baseline this repo pins (ADR-0124 §Baseline,
 * `docs/awcms/knowledge-graph.md`). Not read from an installed `graphify`
 * binary — an operator's local install may be newer or absent entirely, and
 * provenance must record what this repo VOUCHES for, not what happens to be
 * on the machine that ran the sync.
 */
export const GRAPHIFY_VERSION_BASELINE = "graphify 0.9.35 (graphifyy on PyPI)";

/** The only file types this wrapper will ever copy out of staging. */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md",
  ".canvas"
]);

export type ViolationRule = "traversal" | "file-type" | "collision" | "escape";

export type Violation = {
  rule: ViolationRule;
  relativePath: string;
  message: string;
};

export type StagedFile = {
  /** Path relative to the staging root, using forward slashes. */
  relativePath: string;
  /** Absolute path on disk. */
  absolutePath: string;
};

export type ValidationResult = {
  violations: Violation[];
  files: StagedFile[];
};

/** All basenames present anywhere under `curatedRoot`, for collision checks. */
export function collectCuratedBasenames(curatedRoot: string): Set<string> {
  const names = new Set<string>();
  if (!existsSync(curatedRoot)) return names;

  const walk = (dir: string): void => {
    const entries: Dirent<string>[] = readdirSync(dir, {
      withFileTypes: true
    });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        names.add(entry.name);
      }
    }
  };

  walk(curatedRoot);
  return names;
}

/**
 * Walk `stagingRoot` and validate every entry against the fail-closed rules.
 *
 * Returns BOTH the violations and the list of files that would be copied —
 * the caller decides whether to act on `files` (only when `violations` is
 * empty). This function never writes anything.
 */
export function validateStagingTree(
  stagingRoot: string,
  curatedBasenames: ReadonlySet<string>
): ValidationResult {
  const violations: Violation[] = [];
  const files: StagedFile[] = [];

  // realpathSync of the root itself: if the staging root path contains a
  // symlink component, resolve it once so every entry's containment check
  // below compares against the SAME resolved base.
  let resolvedRoot: string;
  try {
    resolvedRoot = realpathSync(stagingRoot);
  } catch {
    violations.push({
      rule: "escape",
      relativePath: ".",
      message: `staging root ${stagingRoot} could not be resolved`
    });
    return { violations, files };
  }

  const walk = (dir: string, relDir: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      violations.push({
        rule: "escape",
        relativePath: relDir || ".",
        message: `could not list directory: ${(error as Error).message}`
      });
      return;
    }

    for (const entry of entries) {
      const relativePath = relDir ? `${relDir}/${entry.name}` : entry.name;
      const absolutePath = path.join(dir, entry.name);

      // Rule 1 — traversal by name. A `..` segment or an absolute-looking
      // name is rejected before we even touch the filesystem for it.
      if (
        entry.name === ".." ||
        entry.name === "." ||
        entry.name.includes("/") ||
        entry.name.includes("\\") ||
        path.isAbsolute(entry.name)
      ) {
        violations.push({
          rule: "traversal",
          relativePath,
          message: `entry name "${entry.name}" is not a plain path segment`
        });
        continue;
      }

      // Rule 4 — symlinks are never followed into the copy set. lstat (not
      // stat) so a symlink is detected as itself, not as whatever it points
      // to.
      const lst = lstatSync(absolutePath);
      if (lst.isSymbolicLink()) {
        violations.push({
          rule: "escape",
          relativePath,
          message: "symlink — exporter output must be plain files/directories"
        });
        continue;
      }

      // Rule 1 (continued) / Rule 4 — the resolved real path must still sit
      // under the resolved staging root. This is the check that catches a
      // hard link, a bind mount, or any entry that on-disk escapes the
      // staging root even though its name looked innocent.
      let real: string;
      try {
        real = realpathSync(absolutePath);
      } catch (error) {
        violations.push({
          rule: "escape",
          relativePath,
          message: `could not resolve real path: ${(error as Error).message}`
        });
        continue;
      }
      const withinRoot =
        real === resolvedRoot || real.startsWith(resolvedRoot + path.sep);
      if (!withinRoot) {
        violations.push({
          rule: "traversal",
          relativePath,
          message: `resolves to ${real}, outside staging root ${resolvedRoot}`
        });
        continue;
      }

      if (lst.isDirectory()) {
        walk(absolutePath, relativePath);
        continue;
      }

      if (!lst.isFile()) {
        violations.push({
          rule: "escape",
          relativePath,
          message: "not a regular file or directory"
        });
        continue;
      }

      // Rule 2 — extension allowlist. This is also what keeps a generated
      // `.obsidian/` config folder's contents (.json, .css, no extension)
      // out, without needing to special-case the directory name.
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        violations.push({
          rule: "file-type",
          relativePath,
          message: `extension "${ext || "(none)"}" is not in the allowlist (${[
            ...ALLOWED_EXTENSIONS
          ].join(", ")})`
        });
        continue;
      }

      // Rule 3 — collision with curated content, checked by basename since
      // `knowledge/curated/` and `knowledge/generated/graphify/` are
      // siblings sharing one flat human-facing namespace in the vault.
      if (curatedBasenames.has(entry.name)) {
        violations.push({
          rule: "collision",
          relativePath,
          message: `"${entry.name}" already exists under ${CURATED_DIR}/`
        });
        continue;
      }

      files.push({ relativePath, absolutePath });
    }
  };

  walk(resolvedRoot, "");

  return { violations, files };
}

/**
 * Wipe and rewrite `destRoot` with exactly `files`, relative to
 * `stagingRoot`. Only called after `validateStagingTree` returned zero
 * violations — this function assumes its input is already safe and does no
 * further checking, so it must never be called with unvalidated input.
 */
export function applySync(
  destRoot: string,
  files: readonly StagedFile[],
  provenance: { root: string }
): void {
  rmSync(destRoot, { recursive: true, force: true });
  mkdirSync(destRoot, { recursive: true });

  for (const file of files) {
    const destPath = path.join(destRoot, file.relativePath);
    mkdirSync(path.dirname(destPath), { recursive: true });
    cpSync(file.absolutePath, destPath);
  }

  writeFileSync(
    path.join(destRoot, "PROVENANCE.md"),
    renderProvenance(provenance.root, files.length)
  );
}

/** `built_at_commit` from `graphify-out/graph.json` at `root`, or `null`. */
function readBuiltAtCommit(root: string): string | null {
  const graphPath = path.join(root, "graphify-out", "graph.json");
  if (!existsSync(graphPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(graphPath, "utf8")) as {
      built_at_commit?: string;
    };
    return typeof parsed.built_at_commit === "string"
      ? parsed.built_at_commit
      : null;
  } catch {
    return null;
  }
}

/**
 * Issue #805 §4: "generated notes must clearly identify themselves as
 * generated and include provenance such as graph hash/build
 * timestamp/tool version where practical." One manifest at the root of the
 * synced tree — rather than stamping every individual note — is what
 * "practical" means here: Graphify's own per-node notes are free-form
 * prose, and rewriting each one risks corrupting content this script does
 * not otherwise interpret.
 */
export function renderProvenance(root: string, fileCount: number): string {
  const builtAtCommit = readBuiltAtCommit(root);
  const stamp = new Date().toISOString();

  return [
    "<!-- GENERATED by scripts/knowledge-obsidian-sync.ts — do not edit by hand. -->",
    "",
    "# Provenance",
    "",
    "Every file in this directory (other than this one) is Graphify's own",
    "hypothesis about the codebase, synced verbatim from",
    "`graphify-out/obsidian-staging/`. It is rebuilt from `graphify-out/` by",
    "`bun run knowledge:obsidian:export` and is never hand-edited — see",
    "`docs/awcms/knowledge-graph.md` and ADR-0124. Treat its claims the same",
    "way `docs/awcms/knowledge-graph.md` treats `graph.json`: a map, not the",
    "territory — verify against code/tests/contracts before acting on one.",
    "",
    `- Tool version: ${GRAPHIFY_VERSION_BASELINE}`,
    `- Source graph built at commit: ${builtAtCommit ?? "(unknown — graphify-out/graph.json has no built_at_commit)"}`,
    `- Synced at: ${stamp}`,
    `- Files synced: ${fileCount}`,
    ""
  ].join("\n");
}

export type SyncOutcome =
  { ok: true; copied: number } | { ok: false; violations: Violation[] };

/**
 * The full validate-then-apply flow, as a pure-ish function over explicit
 * roots so tests can point it at fixture directories instead of the real
 * repository tree.
 */
export function syncKnowledgeObsidian(
  root: string,
  options: { dryRun?: boolean } = {}
): SyncOutcome {
  const stagingRoot = path.join(root, STAGING_DIR);
  const destRoot = path.join(root, DEST_DIR);
  const curatedRoot = path.join(root, CURATED_DIR);

  const curatedBasenames = collectCuratedBasenames(curatedRoot);
  const { violations, files } = validateStagingTree(
    stagingRoot,
    curatedBasenames
  );

  if (violations.length > 0) {
    return { ok: false, violations };
  }

  if (!options.dryRun) {
    applySync(destRoot, files, { root });
  }

  return { ok: true, copied: files.length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--")) ?? ".";
  const dryRun = args.includes("--dry-run") || args.includes("--check");

  console.log("── knowledge:obsidian:export ──");

  const stagingRoot = path.join(root, STAGING_DIR);

  if (!existsSync(stagingRoot)) {
    // Same posture as graph:artifacts:check when graphify-out/ is absent:
    // this is a legitimate state (Obsidian is optional, never a CI
    // requirement), not a failure.
    console.log(
      `  ${STAGING_DIR}/ absent — nothing staged, run \`graphify export obsidian --dir ${STAGING_DIR}\` first`
    );
    console.log("\nknowledge:obsidian:export OK — nothing to sync.");
    process.exit(0);
  }

  const outcome = syncKnowledgeObsidian(root, { dryRun });

  if (outcome.ok) {
    console.log(
      `  ${outcome.copied} file(s) validated under ${STAGING_DIR}/` +
        (dryRun ? " (dry run — nothing written)" : ` → ${DEST_DIR}/`)
    );
    console.log(
      "\nknowledge:obsidian:export OK — " +
        (dryRun
          ? "staged export is safe to sync."
          : `${DEST_DIR}/ rebuilt from staging.`)
    );
    process.exit(0);
  }

  console.error(
    `\nknowledge:obsidian:export FAILED — ${outcome.violations.length} violation(s), nothing written:\n`
  );

  const byRule = new Map<string, Violation[]>();
  for (const violation of outcome.violations) {
    byRule.set(violation.rule, [
      ...(byRule.get(violation.rule) ?? []),
      violation
    ]);
  }

  for (const [rule, list] of byRule) {
    console.error(`  [${rule}] ${list.length}`);
    for (const { relativePath, message } of list) {
      console.error(`    ${relativePath}: ${message}`);
    }
    console.error("");
  }

  process.exit(1);
}
