/**
 * changeset-policy-check.ts — `bun run changesets:policy:check`.
 *
 * Issue #692 (epic #679, platform-hardening) acceptance criterion: "Pull
 * requests verify required Changesets according to policy." Doc 09
 * §Versioning dengan Changesets already states the rule in prose ("Setiap
 * PR yang mengubah perilaku ... wajib menyertakan satu changeset ...
 * Perubahan docs-only/chore boleh tanpa changeset") — this script is the
 * first machine-enforced gate for that rule; before this issue nothing
 * checked it, and a behavior-changing PR could merge without a changeset.
 *
 * "Behavior-changing" here is decided empirically from this repo's own
 * merged-PR history (not guessed): PRs that touched ONLY `docs/**`,
 * `.claude/**` (agent/skill docs), or any `*.md` file merged WITHOUT a
 * changeset (e.g. PR #595, #585 — pure `docs/awcms/github/**`
 * snapshot refreshes, one of which also touched a `.claude/skills/**`
 * file). Every PR that touched `.github/**` workflow files, `scripts/**`,
 * `src/**`, `sql/**`, `openapi/**`, `asyncapi/**`, `package.json`, or a
 * `Dockerfile*`/`docker-compose*.yml` alongside those DID carry a
 * changeset (e.g. PR #707, #701, #609). This gate mirrors that boundary:
 * EXEMPT_PATH_PATTERNS below is deliberately narrow (docs/agent-tooling
 * only) — everything else, including CI workflow and test-only changes,
 * requires a changeset. A false positive here costs one extra
 * `bun run changeset` invocation; a false negative silently reintroduces
 * the exact gap this issue closes, which is the worse failure mode.
 *
 * Escape hatch (mirrors `CONFIG_EXEMPTIONS`/`LOGGING_LINT_EXEMPTIONS`
 * elsewhere in this repo): `CHANGESET_POLICY_PATH_EXEMPTIONS` below, for a
 * genuine one-off exemption that doesn't fit the pattern list, with a
 * reason recorded at the call site.
 */

export type ChangesetPolicyResult = {
  requiresChangeset: boolean;
  changesetFilesAdded: string[];
  changesetFilesDeleted: string[];
  nonExemptFiles: string[];
  violation: string | null;
  isReleaseConsumption: boolean;
};

export type ChangesetFrontmatterResult = {
  ok: boolean;
  reason?: string;
};

/** Any path fully matching one of these is exempt from the changeset requirement. */
const EXEMPT_PATH_PATTERNS: RegExp[] = [
  /^docs\//,
  // Security-auditor Medium finding on PR #715: `/^\.claude\//` alone
  // exempted the ENTIRE `.claude/` tree, not just the markdown skill/agent
  // docs living under it — nothing non-`.md` lives there today, but a
  // future PR adding a real hook script/settings file/MCP config under
  // `.claude/` would silently bypass the changeset requirement even
  // though it isn't docs, reintroducing the exact gap this issue closes.
  // Narrowed to only the `.md` files this exemption was actually meant for.
  /^\.claude\/.*\.md$/,
  /^\.changeset\//,
  /\.md$/
];

/**
 * One-off path exemptions (exact repo-relative path), each entry MUST be
 * accompanied by a comment recording why the pattern list above doesn't
 * already cover it. Empty as of this issue.
 */
export const CHANGESET_POLICY_PATH_EXEMPTIONS: string[] = [];

function isExempt(file: string): boolean {
  if (CHANGESET_POLICY_PATH_EXEMPTIONS.includes(file)) {
    return true;
  }
  return EXEMPT_PATH_PATTERNS.some((pattern) => pattern.test(file));
}

/**
 * The ONLY non-exempt path a genuine `bun run changeset:version`
 * release-consumption commit ever touches (`CHANGELOG.md` is already
 * exempt via `/\.md$/`, `.changeset/*.md` deletions are already exempt via
 * `/^\.changeset\//`). Deliberately a single hardcoded path, not a
 * pattern — see `evaluateChangesetPolicy`'s release-consumption carve-out
 * below for why this must stay narrow.
 */
const RELEASE_CONSUMPTION_NON_EXEMPT_FILE = "package.json";

/**
 * Pure decision function — takes the PR's changed-file list (repo-relative
 * paths, as `git diff --name-only` reports them), which of those were
 * DELETED (`git diff --diff-filter=D`), and whether `package.json`'s diff
 * (if touched) changes ONLY its `version` field — and decides whether a
 * new changeset was required and, if so, whether one was actually added.
 *
 * SECURITY (Issue #810 follow-up, security-auditor Critical on PR #811's
 * first attempt): a naive "any `.changeset/*.md` path touched" check
 * (added OR deleted) lets a PR satisfy the policy by DELETING an existing,
 * still-pending changeset instead of adding a new one — silently bypassing
 * the "changeset required" gate for a real behavior change. The only
 * legitimate reason to have zero genuinely-ADDED changesets while
 * genuinely-DELETING one or more is a release-consumption commit, which is
 * narrowly and verifiably characterized by: (a) the only non-exempt file
 * touched is `package.json`, AND (b) that file's diff changes nothing but
 * its `version` field (not `scripts`/`dependencies`/anything else that
 * would itself need its own changeset), AND (c) at least one
 * `.changeset/*.md` file was actually deleted (proving real consumption
 * happened, not just a hand-edited version bump). All three must hold —
 * dropping any one of them re-opens the exact bypass this comment
 * describes.
 */
export function evaluateChangesetPolicy(
  changedFiles: string[],
  deletedFiles: Iterable<string> = [],
  packageJsonVersionOnlyChange = false
): ChangesetPolicyResult {
  const deletedSet = new Set(deletedFiles);
  const changesetFilesTouched = changedFiles.filter(
    (file) =>
      file.startsWith(".changeset/") &&
      file.endsWith(".md") &&
      file !== ".changeset/README.md"
  );
  const changesetFilesAdded = changesetFilesTouched.filter(
    (file) => !deletedSet.has(file)
  );
  const changesetFilesDeleted = changesetFilesTouched.filter((file) =>
    deletedSet.has(file)
  );

  const nonExemptFiles = changedFiles.filter((file) => !isExempt(file));
  const requiresChangeset = nonExemptFiles.length > 0;

  if (!requiresChangeset || changesetFilesAdded.length > 0) {
    return {
      requiresChangeset,
      changesetFilesAdded,
      changesetFilesDeleted,
      nonExemptFiles,
      violation: null,
      isReleaseConsumption: false
    };
  }

  const isReleaseConsumption =
    changesetFilesDeleted.length > 0 &&
    nonExemptFiles.length === 1 &&
    nonExemptFiles[0] === RELEASE_CONSUMPTION_NON_EXEMPT_FILE &&
    packageJsonVersionOnlyChange;

  if (isReleaseConsumption) {
    return {
      requiresChangeset,
      changesetFilesAdded,
      changesetFilesDeleted,
      nonExemptFiles,
      violation: null,
      isReleaseConsumption: true
    };
  }

  const sample = nonExemptFiles.slice(0, 5).join(", ");
  const more = nonExemptFiles.length > 5 ? ", ..." : "";

  return {
    requiresChangeset,
    changesetFilesAdded,
    changesetFilesDeleted,
    nonExemptFiles,
    violation:
      `PR ini mengubah ${nonExemptFiles.length} file yang bukan docs/agent-tooling ` +
      `(mis. ${sample}${more}) tapi tidak menambah changeset baru. Tambahkan satu ` +
      `changeset (bun run changeset) yang menjelaskan tingkat bump SemVer + ringkasan ` +
      `perubahan — lihat docs/awcms/09_roadmap_repository_commit.md §Versioning ` +
      "dengan Changesets, atau jika perubahan ini murni docs/chore, konfirmasi tidak " +
      "ada file lain yang keliru ikut ter-stage.",
    isReleaseConsumption: false
  };
}

const CHANGESET_PACKAGE_NAME = "awcms";
const VALID_BUMPS = new Set(["major", "minor", "patch"]);

/**
 * Validates a single new changeset file's frontmatter — this is a
 * single-package repo (`.changeset/config.json` has empty `fixed`/`linked`),
 * so every changeset must bump exactly this one package by a valid SemVer
 * level. Deliberately does not re-implement full changeset frontmatter
 * parsing (that's `@changesets/cli`'s job at `changeset:version` time) —
 * this is a narrow "did the author fill this in correctly" sanity check.
 */
export function validateChangesetFrontmatter(
  content: string
): ChangesetFrontmatterResult {
  const match = content.match(/^---\n([\s\S]*?)\n---/);

  if (!match) {
    return {
      ok: false,
      reason:
        "Changeset tidak memiliki frontmatter YAML (--- ... ---) yang valid."
    };
  }

  const frontmatter = match[1]!;
  const lineMatch = frontmatter.match(
    /^["']?([\w.-]+)["']?\s*:\s*(major|minor|patch)\s*$/m
  );

  if (!lineMatch) {
    return {
      ok: false,
      reason: `Frontmatter changeset harus memuat baris "${CHANGESET_PACKAGE_NAME}": <major|minor|patch>.`
    };
  }

  const [, packageName, bump] = lineMatch;

  if (packageName !== CHANGESET_PACKAGE_NAME) {
    return {
      ok: false,
      reason: `Nama package di changeset ("${packageName}") harus "${CHANGESET_PACKAGE_NAME}" (repo single-package).`
    };
  }

  if (!VALID_BUMPS.has(bump!)) {
    return {
      ok: false,
      reason: `Tingkat bump "${bump}" tidak valid — harus salah satu dari: major, minor, patch.`
    };
  }

  return { ok: true };
}

async function getChangedFiles(baseRef: string): Promise<string[]> {
  const proc = Bun.spawn(["git", "diff", "--name-only", `${baseRef}...HEAD`], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `git diff --name-only ${baseRef}...HEAD gagal (exit ${exitCode}): ${stderr.trim()}`
    );
  }

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * `git diff --name-only` doesn't distinguish added/modified/deleted paths
 * — a release-consumption PR that DELETES every consumed `.changeset/*.md`
 * file (and adds none) needs to be told apart from a PR that deletes a
 * still-pending changeset to dodge the policy. Feeds
 * `evaluateChangesetPolicy`'s release-consumption carve-out and lets the
 * frontmatter-validation loop below skip paths that no longer exist
 * instead of crashing on ENOENT.
 */
async function getDeletedFiles(baseRef: string): Promise<Set<string>> {
  const proc = Bun.spawn(
    ["git", "diff", "--name-only", "--diff-filter=D", `${baseRef}...HEAD`],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `git diff --name-only --diff-filter=D ${baseRef}...HEAD gagal (exit ${exitCode}): ${stderr.trim()}`
    );
  }

  return new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  );
}

async function readGitFile(ref: string, path: string): Promise<string | null> {
  const proc = Bun.spawn(["git", "show", `${ref}:${path}`], {
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited
  ]);
  return exitCode === 0 ? stdout : null;
}

/**
 * True only if `package.json` changed between `baseRef` and `HEAD` AND
 * that change is EXCLUSIVELY to the top-level `version` field — the narrow
 * signature of a `bun run changeset:version` release-consumption commit,
 * never a general `package.json` edit (dependency bump, script change,
 * etc.) that would still need its own changeset. Fails closed (`false`) on
 * any ambiguity (missing file, unparsable JSON, non-object) — an
 * indeterminate result must never grant the release-consumption exemption.
 */
async function isPackageJsonVersionOnlyChange(
  baseRef: string
): Promise<boolean> {
  const [oldRaw, newRaw] = await Promise.all([
    readGitFile(baseRef, "package.json"),
    readGitFile("HEAD", "package.json")
  ]);
  if (oldRaw === null || newRaw === null) return false;

  let oldJson: unknown;
  let newJson: unknown;
  try {
    oldJson = JSON.parse(oldRaw);
    newJson = JSON.parse(newRaw);
  } catch {
    return false;
  }
  if (
    typeof oldJson !== "object" ||
    oldJson === null ||
    typeof newJson !== "object" ||
    newJson === null
  ) {
    return false;
  }

  const oldRecord = oldJson as Record<string, unknown>;
  const newRecord = newJson as Record<string, unknown>;
  if (oldRecord.version === newRecord.version) {
    // package.json changed but version didn't -- not a version bump at all.
    return false;
  }

  const oldRest = { ...oldRecord };
  const newRest = { ...newRecord };
  delete oldRest.version;
  delete newRest.version;
  return JSON.stringify(oldRest) === JSON.stringify(newRest);
}

if (import.meta.main) {
  const baseRef = process.env.CHANGESET_POLICY_BASE_REF ?? "origin/main";

  const changedFiles = await getChangedFiles(baseRef);
  const deletedFiles = await getDeletedFiles(baseRef);
  const packageJsonVersionOnlyChange = changedFiles.includes("package.json")
    ? await isPackageJsonVersionOnlyChange(baseRef)
    : false;
  const result = evaluateChangesetPolicy(
    changedFiles,
    deletedFiles,
    packageJsonVersionOnlyChange
  );

  const frontmatterProblems: string[] = [];
  for (const file of result.changesetFilesAdded) {
    const content = await Bun.file(file).text();
    const check = validateChangesetFrontmatter(content);
    if (!check.ok) {
      frontmatterProblems.push(`${file}: ${check.reason}`);
    }
  }

  if (result.violation) {
    console.error(result.violation);
  }

  if (frontmatterProblems.length > 0) {
    console.error(
      "\nchangesets:policy:check GAGAL — frontmatter changeset baru tidak valid:"
    );
    for (const problem of frontmatterProblems) {
      console.error(`  - ${problem}`);
    }
  }

  if (result.violation || frontmatterProblems.length > 0) {
    process.exitCode = 1;
  } else if (result.isReleaseConsumption) {
    console.log(
      `changesets:policy:check OK — release-consumption commit terdeteksi (package.json version-only, ${result.changesetFilesDeleted.length} changeset dikonsumsi), changeset baru tidak wajib.`
    );
  } else if (result.requiresChangeset) {
    console.log(
      `changesets:policy:check OK — ${result.changesetFilesAdded.length} changeset baru valid untuk ${result.nonExemptFiles.length} file non-docs/chore yang berubah.`
    );
  } else {
    console.log(
      "changesets:policy:check OK — PR ini hanya mengubah docs/agent-tooling, changeset tidak wajib."
    );
  }
}
