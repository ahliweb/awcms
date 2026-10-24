/**
 * dependency-freshness.ts — `bun run deps:freshness` (Issue #1173).
 *
 * A READ-ONLY report of how far the things this repo pins have drifted from what
 * their registries publish today:
 *
 * 1. **Direct dependencies** — `bun outdated`: installed vs in-range update vs
 *    registry latest, classified patch / minor / major.
 * 2. **Advisories** — `bun audit --json`, evaluated with the same
 *    `evaluateAudit` (and the same exception list) that gates `deps:audit:check`,
 *    so the report and the gate cannot disagree about what is blocking.
 * 3. **The Bun pin** — `package.json` `packageManager` vs `npm view bun`.
 * 4. **Pinned base images** — every image `Dockerfile.production` builds from
 *    and every image `deploy/cron/awcms.crontab` runs, vs the newest tag of the
 *    same shape on Docker Hub, plus whether the index digest recorded in the
 *    Dockerfile still matches what the tag points at today.
 * 5. **The held-back register** — `dependency-held-back.ts`: expired reviews and
 *    holds that are no longer behind.
 *
 * ## It changes nothing
 *
 * No file is written (unless `--out-json` / `--out-md` ask for one), no lockfile
 * is touched, nothing is installed. The upgrade itself is a separate, atomic,
 * reviewed PR (`docs/awcms/dependency-governance.md`) — a report that also
 * upgraded would be the silent mass update the issue forbids.
 *
 * ## UNKNOWN is not a pass
 *
 * Every section is fetched independently and any of them can fail (registry
 * unreachable, rate-limited, output not the shape we parse). A failed section is
 * reported as `UNKNOWN` with the reason, never as "no drift". A report that
 * prints "0 outdated" because it could not reach the registry says the same thing
 * as a repo that is fully current, and only one of those is true — the failure
 * mode `dependency-audit-check.ts` already documents for its own gate.
 *
 * ## Exit code
 *
 * Drift alone never fails the command: some drift exists nearly every week, and
 * a report that is always red is a report nobody opens. With `--strict` (what the
 * scheduled workflow passes) the exit code is 1 when the report is not a
 * trustworthy all-clear: any UNKNOWN section, a blocking advisory, an expired or
 * stale held-back entry, or a recorded image digest that no longer matches its tag.
 *
 * Usage:
 *   bun run deps:freshness                     # markdown report on stdout
 *   bun run deps:freshness -- --json           # machine-readable manifest on stdout
 *   bun run deps:freshness -- --out-json m.json --out-md r.md
 *   bun run deps:freshness -- --strict         # exit 1 unless the report is a clean all-clear
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { evaluateAudit, parseAuditOutput } from "./dependency-audit-check";
import { EXCEPTIONS } from "./dependency-audit-exceptions";
import { HELD_BACK, type HeldBackEntry } from "./dependency-held-back";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Section<T> =
  { status: "ok"; data: T } | { status: "unknown"; reason: string };

export type DriftLevel = "current" | "patch" | "minor" | "major" | "unknown";

export type OutdatedRow = {
  name: string;
  /** `bun outdated` marks dev/peer/optional dependencies in the name column. */
  kind: "prod" | "dev" | "peer" | "optional";
  current: string;
  /** Newest version that still satisfies the range in package.json. */
  update: string;
  /** Newest version on the registry, whatever the range says. */
  latest: string;
  /** current -> latest. */
  drift: DriftLevel;
  /** True when `update` differs from `current`: a plain `bun update` would move it. */
  inRange: boolean;
};

export type OutdatedData = {
  directDependencyCount: number;
  rows: OutdatedRow[];
};

export type AdvisoryData = {
  blocking: string[];
  informationalCount: number;
  exceptionCount: number;
  bySeverity: Record<string, number>;
};

export type BunPinData = {
  pinned: string;
  latest: string;
  drift: DriftLevel;
};

export type ImageRef = {
  /** Repo-relative file the reference was read from. */
  file: string;
  /** e.g. `oven/bun:1.4.4-alpine`. */
  ref: string;
  image: string;
  tag: string;
};

export type DigestState = "match" | "mismatch" | "not-recorded";

export type ImageData = {
  /** Digest of the pinned tag as Docker Hub reports it today. */
  digest: string;
  lastUpdated: string | null;
  digestRecorded: DigestState;
  /** Newest tag of the same shape (same suffix), or null when none was found. */
  newestTag: string | null;
  drift: DriftLevel;
};

export type ImageReport = ImageRef & { result: Section<ImageData> };

export type HeldBackStatus = "active" | "expired" | "stale" | "unverified";

export type HeldBackEvaluation = {
  entry: HeldBackEntry;
  status: HeldBackStatus;
  latest: string | null;
  note: string;
};

export type FreshnessManifest = {
  generatedAt: string;
  /** Fixed text: this manifest is the output of a read-only command. */
  mode: "read-only";
  bunVersionUsed: string;
  outdated: Section<OutdatedData>;
  advisories: Section<AdvisoryData>;
  bun: Section<BunPinData>;
  images: ImageReport[];
  heldBack: HeldBackEvaluation[];
  unknownSections: string[];
  strictFailures: string[];
};

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

const SEMVER =
  /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

export function parseSemver(version: string): Semver | null {
  const match = SEMVER.exec(version.trim());

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null
  };
}

/** -1 / 0 / 1, or null when either side is not a semver. Prereleases sort below their release. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseSemver(a);
  const right = parseSemver(b);

  if (!left || !right) {
    return null;
  }

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }

  if (left.prerelease === right.prerelease) {
    return 0;
  }

  if (left.prerelease === null) {
    return 1;
  }

  if (right.prerelease === null) {
    return -1;
  }

  return left.prerelease < right.prerelease ? -1 : 1;
}

/** How far `current` is behind `latest`. Ahead-of-latest is `current` (a pinned canary is not drift). */
export function classifyDrift(current: string, latest: string): DriftLevel {
  const left = parseSemver(current);
  const right = parseSemver(latest);

  if (!left || !right) {
    return "unknown";
  }

  if (compareVersions(current, latest) !== -1) {
    return "current";
  }

  if (left.major !== right.major) {
    return "major";
  }

  if (left.minor !== right.minor) {
    return "minor";
  }

  return "patch";
}

// ---------------------------------------------------------------------------
// bun outdated
// ---------------------------------------------------------------------------

const TABLE_RULE = /^\|[-|]+\|$/;
const KIND_SUFFIX = /\s+\((dev|peer|optional)\)\s*$/;

/**
 * Parses the box-drawn table `bun outdated` prints. Bun 1.4.4 has no `--json`
 * for this command, so the table is the contract — which is exactly why this
 * throws on anything that is not a table or the bare banner: a format change
 * must surface as UNKNOWN, not as an empty (all-current) report.
 *
 * Output with no table at all and nothing but the `bun outdated vX` banner means
 * nothing is outdated (verified: `bun outdated typescript` on a current package).
 */
export function parseOutdatedOutput(stdout: string): OutdatedRow[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const tableLines = lines.filter((line) => line.startsWith("|"));
  const otherLines = lines.filter(
    (line) => !line.startsWith("|") && !/^bun outdated v\S+/.test(line)
  );

  if (otherLines.length > 0) {
    throw new Error(
      `unexpected output from \`bun outdated\`: ${otherLines[0]?.slice(0, 200)}`
    );
  }

  if (tableLines.length === 0) {
    return [];
  }

  const rows: OutdatedRow[] = [];
  let sawHeader = false;

  for (const line of tableLines) {
    if (TABLE_RULE.test(line)) {
      continue;
    }

    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());

    if (cells.length !== 4) {
      throw new Error(`unexpected \`bun outdated\` row: ${line.slice(0, 200)}`);
    }

    const [rawName, current, update, latest] = cells as [
      string,
      string,
      string,
      string
    ];

    if (rawName === "Package") {
      if (current !== "Current" || update !== "Update" || latest !== "Latest") {
        throw new Error(`unexpected \`bun outdated\` header: ${line}`);
      }
      sawHeader = true;
      continue;
    }

    if (!sawHeader) {
      throw new Error("`bun outdated` table has no header row.");
    }

    const kindMatch = KIND_SUFFIX.exec(rawName);
    const kind = (kindMatch?.[1] ?? "prod") as OutdatedRow["kind"];
    const name = rawName.replace(KIND_SUFFIX, "");

    rows.push({
      name,
      kind,
      current,
      update,
      latest,
      drift: classifyDrift(current, latest),
      inRange: update !== current
    });
  }

  if (!sawHeader) {
    throw new Error("`bun outdated` table has no header row.");
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Pinned images
// ---------------------------------------------------------------------------

const IMAGE_TOKEN =
  /^(?:[a-z0-9][a-z0-9.-]*\/)*[a-z0-9][a-z0-9._-]*:[0-9][A-Za-z0-9._-]*$/;

function splitImage(ref: string): { image: string; tag: string } {
  const index = ref.lastIndexOf(":");

  return { image: ref.slice(0, index), tag: ref.slice(index + 1) };
}

/** `FROM <image>:<tag>` lines that name a registry image (not a build stage). */
export function parseDockerfileImages(
  text: string,
  file = "Dockerfile.production"
): ImageRef[] {
  const stages = new Set<string>();
  const refs: ImageRef[] = [];

  for (const line of text.split(/\r?\n/)) {
    const match = /^FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(
      line.trim()
    );

    if (!match) {
      continue;
    }

    const [, source, alias] = match as unknown as [string, string, string?];

    if (alias) {
      stages.add(alias.toLowerCase());
    }

    if (stages.has(source.toLowerCase()) && source !== alias) {
      continue;
    }

    if (IMAGE_TOKEN.test(source)) {
      refs.push({ file, ref: source, ...splitImage(source) });
    }
  }

  return refs;
}

/** Image arguments of the `docker run` lines in the cron file. Comments are skipped. */
export function parseCrontabImages(
  text: string,
  file = "deploy/cron/awcms.crontab"
): ImageRef[] {
  const refs: ImageRef[] = [];
  const seen = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("#") || !line.includes("docker run")) {
      continue;
    }

    for (const token of line.split(/\s+/)) {
      if (IMAGE_TOKEN.test(token) && !seen.has(token)) {
        seen.add(token);
        refs.push({ file, ref: token, ...splitImage(token) });
      }
    }
  }

  return refs;
}

/** Hex prefixes of every `sha256:<hex>` (>= 12 chars) mentioned in the file, e.g. in a comment. */
export function parseRecordedDigests(text: string): string[] {
  return [...text.matchAll(/sha256:([0-9a-f]{12,64})/g)].map(
    (match) => match[1] as string
  );
}

/**
 * Newest tag of the same shape as `currentTag` (same non-numeric suffix, so
 * `1.4.4-alpine` is compared only with other `-alpine` tags) from a tag list.
 * Tags with fewer segments (`18`, `1.4`) take part: `19` is a real major signal.
 */
export function pickNewestTag(
  tags: readonly string[],
  currentTag: string
): string | null {
  const shape = /^(\d+(?:\.\d+)*)(.*)$/;
  const current = shape.exec(currentTag);

  if (!current) {
    return null;
  }

  const suffix = current[2] ?? "";
  let best: { tag: string; parts: number[] } | null = null;

  for (const tag of tags) {
    const match = shape.exec(tag);

    if (!match || (match[2] ?? "") !== suffix) {
      continue;
    }

    const parts = (match[1] as string).split(".").map(Number);

    if (!best || compareParts(parts, best.parts) === 1) {
      best = { tag, parts };
    }
  }

  return best?.tag ?? null;
}

function compareParts(a: readonly number[], b: readonly number[]): -1 | 0 | 1 {
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;

    if (left !== right) {
      return left < right ? -1 : 1;
    }
  }

  return 0;
}

/** Drift between two numeric tags (`18.4` -> `18.5` is minor). */
export function classifyTagDrift(
  currentTag: string,
  newestTag: string
): DriftLevel {
  const shape = /^(\d+(?:\.\d+)*)/;
  const current = shape.exec(currentTag);
  const newest = shape.exec(newestTag);

  if (!current || !newest) {
    return "unknown";
  }

  const a = (current[1] as string).split(".").map(Number);
  const b = (newest[1] as string).split(".").map(Number);

  if (compareParts(a, b) !== -1) {
    return "current";
  }

  if ((a[0] ?? 0) !== (b[0] ?? 0)) {
    return "major";
  }

  if ((a[1] ?? 0) !== (b[1] ?? 0)) {
    return "minor";
  }

  return "patch";
}

// ---------------------------------------------------------------------------
// Held-back register
// ---------------------------------------------------------------------------

/**
 * `resolveLatest` answers "what is the newest version of this?" — a version
 * string, `"current"` when the dependency is known to be fully up to date, or
 * `undefined` when that could not be established (the registry section was
 * UNKNOWN). Pure, so the tests feed it a table.
 */
export function evaluateHeldBack(
  entries: readonly HeldBackEntry[],
  today: string,
  resolveLatest: (packageName: string) => string | "current" | undefined
): HeldBackEvaluation[] {
  return entries.map((entry) => {
    const latest = resolveLatest(entry.packageName);

    if (entry.reviewDate < today) {
      return {
        entry,
        status: "expired",
        latest: latest && latest !== "current" ? latest : null,
        note: `review date ${entry.reviewDate} has passed — re-justify with a new date or remove the entry`
      };
    }

    if (latest === undefined) {
      return {
        entry,
        status: "unverified",
        latest: null,
        note: "the registry could not be reached, so whether the hold is still behind is unknown"
      };
    }

    if (latest === "current") {
      return {
        entry,
        status: "stale",
        latest: null,
        note: "the dependency is no longer behind the registry — remove the entry"
      };
    }

    const order = compareVersions(entry.heldVersion, latest);

    if (order !== null && order >= 0) {
      return {
        entry,
        status: "stale",
        latest,
        note: `held ${entry.heldVersion} is not behind latest ${latest} — remove the entry`
      };
    }

    return {
      entry,
      status: "active",
      latest,
      note: `held at ${entry.heldVersion}, latest ${latest}`
    };
  });
}

// ---------------------------------------------------------------------------
// Network and process plumbing (not unit-tested; everything it feeds is)
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 20_000;

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`${url} answered HTTP ${response.status}`);
  }

  return response.json();
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(
  command: string[],
  root: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(command, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" }
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ]);

  return { stdout, stderr, exitCode: await proc.exited };
}

function readPackageJson(root: string): {
  packageManager?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
} {
  return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
}

async function collectOutdated(root: string): Promise<Section<OutdatedData>> {
  try {
    // `--no-cache` so a cached manifest from last week cannot make the report
    // say "current". A failed fetch makes bun print `error:` and exit 1.
    const result = await run(["bun", "outdated", "--no-cache"], root);
    const combined = `${result.stdout}\n${result.stderr}`;

    if (result.exitCode !== 0 || /^error:/m.test(combined)) {
      const firstError =
        combined.split(/\r?\n/).find((line) => line.startsWith("error:")) ??
        `exit ${result.exitCode}`;

      return {
        status: "unknown",
        reason: `\`bun outdated\` failed (${firstError.slice(0, 200)})`
      };
    }

    const pkg = readPackageJson(root);
    const directDependencyCount =
      Object.keys(pkg.dependencies ?? {}).length +
      Object.keys(pkg.devDependencies ?? {}).length +
      Object.keys(pkg.optionalDependencies ?? {}).length;

    return {
      status: "ok",
      data: { directDependencyCount, rows: parseOutdatedOutput(result.stdout) }
    };
  } catch (error) {
    return { status: "unknown", reason: errorText(error) };
  }
}

async function collectAdvisories(root: string): Promise<Section<AdvisoryData>> {
  try {
    const result = await run(["bun", "audit", "--json"], root);
    // Exit code is not the signal (see dependency-audit-check.ts): the body is.
    const report = parseAuditOutput(result.stdout);
    const evaluation = evaluateAudit(report);
    const bySeverity: Record<string, number> = {};

    for (const advisories of Object.values(report)) {
      for (const advisory of advisories) {
        const severity = advisory.severity?.toLowerCase() ?? "unknown";
        bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
      }
    }

    return {
      status: "ok",
      data: {
        blocking: evaluation.violations,
        informationalCount: evaluation.informational.length,
        exceptionCount: EXCEPTIONS.length,
        bySeverity
      }
    };
  } catch (error) {
    return {
      status: "unknown",
      reason: `\`bun audit --json\` produced no report (${errorText(error)})`
    };
  }
}

function pinnedBunVersion(root: string): string | null {
  const packageManager = readPackageJson(root).packageManager ?? "";
  const match = /^bun@(\S+)$/.exec(packageManager);

  return match?.[1] ?? null;
}

async function collectBun(root: string): Promise<Section<BunPinData>> {
  const pinned = pinnedBunVersion(root);

  if (!pinned) {
    return {
      status: "unknown",
      reason: "package.json `packageManager` is not `bun@<version>`"
    };
  }

  try {
    const body = (await fetchJson("https://registry.npmjs.org/bun/latest")) as {
      version?: unknown;
    };

    if (typeof body.version !== "string") {
      throw new Error("npm registry answer has no `version`");
    }

    return {
      status: "ok",
      data: {
        pinned,
        latest: body.version,
        drift: classifyDrift(pinned, body.version)
      }
    };
  } catch (error) {
    return {
      status: "unknown",
      reason: `could not read the latest Bun from npm (pinned ${pinned}): ${errorText(error)}`
    };
  }
}

function hubRepository(image: string): string | null {
  const parts = image.split("/");

  if (parts.length > 1 && parts[0]?.includes(".")) {
    return null; // not Docker Hub (e.g. ghcr.io)
  }

  return parts.length === 1 ? `library/${image}` : image;
}

async function collectImage(
  ref: ImageRef,
  recordedDigests: readonly string[]
): Promise<ImageReport> {
  const repository = hubRepository(ref.image);

  if (!repository) {
    return {
      ...ref,
      result: {
        status: "unknown",
        reason: "not a Docker Hub image; this report only queries Docker Hub"
      }
    };
  }

  try {
    const base = `https://hub.docker.com/v2/repositories/${repository}`;
    const tag = (await fetchJson(
      `${base}/tags/${encodeURIComponent(ref.tag)}`
    )) as {
      digest?: unknown;
      last_updated?: unknown;
    };

    if (typeof tag.digest !== "string") {
      throw new Error("Docker Hub answer has no `digest`");
    }

    const digest = tag.digest;
    const list = (await fetchJson(
      `${base}/tags?page_size=100&ordering=last_updated`
    )) as { results?: { name?: unknown }[] };
    const names = (list.results ?? [])
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string");
    const newestTag = pickNewestTag(names, ref.tag);
    const hex = digest.replace(/^sha256:/, "");
    const relevant = recordedDigests.filter((prefix) => prefix.length >= 12);
    const digestRecorded: DigestState =
      relevant.length === 0
        ? "not-recorded"
        : relevant.some((prefix) => hex.startsWith(prefix))
          ? "match"
          : "mismatch";

    return {
      ...ref,
      result: {
        status: "ok",
        data: {
          digest,
          lastUpdated:
            typeof tag.last_updated === "string" ? tag.last_updated : null,
          digestRecorded,
          newestTag,
          drift: newestTag ? classifyTagDrift(ref.tag, newestTag) : "unknown"
        }
      }
    };
  } catch (error) {
    return { ...ref, result: { status: "unknown", reason: errorText(error) } };
  }
}

async function collectImages(root: string): Promise<ImageReport[]> {
  const dockerfile = readFileSync(
    path.join(root, "Dockerfile.production"),
    "utf8"
  );
  const crontab = readFileSync(
    path.join(root, "deploy/cron/awcms.crontab"),
    "utf8"
  );
  const recorded = parseRecordedDigests(dockerfile);
  const refs = [
    ...parseDockerfileImages(dockerfile),
    ...parseCrontabImages(crontab)
  ];

  return Promise.all(
    refs.map((ref) =>
      // Only the Dockerfile records digests; the cron file pins by tag alone.
      collectImage(ref, ref.file === "Dockerfile.production" ? recorded : [])
    )
  );
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function buildManifest(input: {
  generatedAt: string;
  bunVersionUsed: string;
  outdated: Section<OutdatedData>;
  advisories: Section<AdvisoryData>;
  bun: Section<BunPinData>;
  images: ImageReport[];
}): FreshnessManifest {
  const today = input.generatedAt.slice(0, 10);
  const outdatedRows =
    input.outdated.status === "ok" ? input.outdated.data.rows : null;

  const heldBack = evaluateHeldBack(HELD_BACK, today, (packageName) => {
    if (packageName === "bun") {
      return input.bun.status === "ok" ? input.bun.data.latest : undefined;
    }

    if (!outdatedRows) {
      return undefined;
    }

    // A direct dependency that bun does not list is fully up to date.
    return (
      outdatedRows.find((row) => row.name === packageName)?.latest ?? "current"
    );
  });

  const unknownSections: string[] = [];
  const strictFailures: string[] = [];

  const note = (label: string, section: Section<unknown>) => {
    if (section.status === "unknown") {
      unknownSections.push(label);
      strictFailures.push(`${label}: UNKNOWN — ${section.reason}`);
    }
  };

  note("bun outdated", input.outdated);
  note("bun audit", input.advisories);
  note("Bun pin vs npm", input.bun);

  for (const image of input.images) {
    note(`image ${image.ref} (${image.file})`, image.result);

    if (
      image.result.status === "ok" &&
      image.result.data.digestRecorded === "mismatch"
    ) {
      strictFailures.push(
        `image ${image.ref}: the digest recorded in ${image.file} no longer matches what the tag points at (${image.result.data.digest})`
      );
    }
  }

  if (input.advisories.status === "ok") {
    for (const violation of input.advisories.data.blocking) {
      strictFailures.push(`advisory: ${violation}`);
    }
  }

  for (const entry of heldBack) {
    if (entry.status === "expired" || entry.status === "stale") {
      strictFailures.push(
        `held-back ${entry.entry.packageName}: ${entry.status} — ${entry.note}`
      );
    }
  }

  return {
    generatedAt: input.generatedAt,
    mode: "read-only",
    bunVersionUsed: input.bunVersionUsed,
    outdated: input.outdated,
    advisories: input.advisories,
    bun: input.bun,
    images: input.images,
    heldBack,
    unknownSections,
    strictFailures
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function unknownLine(reason: string): string {
  return `**UNKNOWN** — ${reason}. This is NOT a pass: the check did not run.`;
}

export function renderMarkdown(manifest: FreshnessManifest): string {
  const out: string[] = [];

  out.push("# Dependency freshness report");
  out.push("");
  out.push(
    `Generated ${manifest.generatedAt} with Bun ${manifest.bunVersionUsed}. ` +
      "Read-only: nothing was installed, upgraded or written. " +
      "An UNKNOWN section means that check could not run — it is never a pass."
  );
  out.push("");

  // Direct dependencies
  out.push("## Direct dependencies (`bun outdated`)");
  out.push("");

  if (manifest.outdated.status === "unknown") {
    out.push(unknownLine(manifest.outdated.reason));
  } else {
    const { rows, directDependencyCount } = manifest.outdated.data;

    out.push(
      `${rows.length} of ${directDependencyCount} direct dependencies are behind the registry.`
    );

    if (rows.length > 0) {
      out.push("");
      out.push(
        "| Package | Kind | Installed | In-range update | Latest | Drift |"
      );
      out.push("| --- | --- | --- | --- | --- | --- |");

      for (const row of rows) {
        out.push(
          `| ${row.name} | ${row.kind} | ${row.current} | ${row.inRange ? row.update : "—"} | ${row.latest} | ${row.drift} |`
        );
      }
    }
  }

  out.push("");

  // Advisories
  out.push("## Advisories (`bun audit`)");
  out.push("");

  if (manifest.advisories.status === "unknown") {
    out.push(unknownLine(manifest.advisories.reason));
  } else {
    const data = manifest.advisories.data;
    const severities = Object.entries(data.bySeverity)
      .map(([severity, count]) => `${count} ${severity}`)
      .join(", ");

    out.push(
      data.blocking.length === 0
        ? `No unhandled high/critical advisory (${data.exceptionCount} registered exception(s)). ` +
            (severities
              ? `All advisories: ${severities}.`
              : "No advisories at all.")
        : `${data.blocking.length} blocking finding(s):`
    );

    for (const violation of data.blocking) {
      out.push(`- ${violation}`);
    }
  }

  out.push("");

  // Bun
  out.push("## Bun runtime pin");
  out.push("");

  if (manifest.bun.status === "unknown") {
    out.push(unknownLine(manifest.bun.reason));
  } else {
    const { pinned, latest, drift } = manifest.bun.data;

    out.push(
      `Pinned \`${pinned}\`, npm latest \`${latest}\` — drift: ${drift}.`
    );
  }

  out.push("");

  // Images
  out.push("## Pinned base images");
  out.push("");
  out.push(
    "| File | Image | Newest same-shape tag | Drift | Recorded digest | Registry digest |"
  );
  out.push("| --- | --- | --- | --- | --- | --- |");

  for (const image of manifest.images) {
    if (image.result.status === "unknown") {
      out.push(
        `| ${image.file} | \`${image.ref}\` | **UNKNOWN** | — | — | ${image.result.reason} |`
      );
      continue;
    }

    const data = image.result.data;

    out.push(
      `| ${image.file} | \`${image.ref}\` | ${data.newestTag ?? "unknown"} | ${data.drift} | ${data.digestRecorded} | \`${data.digest.slice(0, 19)}…\` |`
    );
  }

  out.push("");

  // Held back
  out.push("## Held-back register");
  out.push("");

  if (manifest.heldBack.length === 0) {
    out.push("No entries.");
  } else {
    out.push("| Package | Held | Latest | Status | Owner | Review by | Note |");
    out.push("| --- | --- | --- | --- | --- | --- | --- |");

    for (const entry of manifest.heldBack) {
      out.push(
        `| ${entry.entry.packageName} | ${entry.entry.heldVersion} | ${entry.latest ?? "unknown"} | ${entry.status} | ${entry.entry.owner} | ${entry.entry.reviewDate} | ${entry.note} |`
      );
    }
  }

  out.push("");

  // Verdict
  out.push("## Verdict");
  out.push("");

  if (manifest.strictFailures.length === 0) {
    out.push(
      "Nothing blocks and every check ran. Drift above is the backlog for atomic upgrade PRs."
    );
  } else {
    out.push("Needs attention (`--strict` fails on these):");

    for (const failure of manifest.strictFailures) {
      out.push(`- ${failure}`);
    }
  }

  out.push("");

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = path.resolve(import.meta.dirname, "..");

  const [outdated, advisories, bun, images] = await Promise.all([
    collectOutdated(root),
    collectAdvisories(root),
    collectBun(root),
    collectImages(root)
  ]);

  const manifest = buildManifest({
    generatedAt: new Date().toISOString(),
    bunVersionUsed: Bun.version,
    outdated,
    advisories,
    bun,
    images
  });

  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const markdown = renderMarkdown(manifest);

  const outJson = argValue(args, "--out-json");
  const outMd = argValue(args, "--out-md");

  if (outJson) {
    writeFileSync(outJson, json);
  }

  if (outMd) {
    writeFileSync(outMd, markdown);
  }

  process.stdout.write(args.includes("--json") ? json : markdown);

  if (args.includes("--strict") && manifest.strictFailures.length > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
