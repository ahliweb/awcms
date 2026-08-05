/**
 * client-asset-budget.ts — `bun run build:asset-budget:check`.
 *
 * Closes gap C6 of `docs/awcms/standar-performa-dan-keamanan.md` §9: the repo
 * had no budget on what the browser must download. Runs AFTER `astro build`
 * (the `build` target chains it) and fails when `dist/client` outgrows the
 * budgets below. Pure filesystem arithmetic — no database, no network.
 *
 * ## Why gate this today
 *
 * Measured on 2026-08-05, `dist/client` is 139,048 bytes across 45 files —
 * 35 JS files (77,449 B) and 10 CSS files (61,599 B); the largest single file
 * is `css/public-content.css` at 16,800 B. That is the cheapest moment a
 * budget will ever have: every later moment starts from a bigger baseline and
 * a budget written then would ratify whatever had already accreted. Client
 * weight grows one island at a time and no test notices; the symptom arrives
 * as "the public pages feel slow" long after the import that caused it.
 *
 * ## The budgets, derived from that measurement
 *
 * - `TOTAL_BUDGET_BYTES` = 180,000 — baseline 139,048 B + ~29% headroom,
 *   rounded to a number a human can remember. Catches slow accretion.
 * - `PER_FILE_BUDGET_BYTES` = 21,000 — largest file 16,800 B + 25%. Catches
 *   the other failure mode: one island importing a charting/date/editor
 *   dependency and shipping it as a single 200 KB chunk, which a generous
 *   total budget alone would absorb for a while and then blame on the NEXT
 *   change.
 *
 * Raising a budget is allowed — deliberately. The constant lives here so the
 * raise is a reviewed diff, and the reviewer's question is written down: what
 * feature bought this weight, and was it re-measured (`du -sb dist/client`)
 * rather than bumped until green?
 *
 * ## Why nothing is excluded
 *
 * Every byte in `dist/client` today is app shell (JS + CSS). Content images
 * never pass through the build — they live in R2 via `media_library` — and no
 * fonts are shipped. A pre-emptive exclusion class (e.g. "images don't count")
 * would be a blind spot with no current benefit: if image files ever appear in
 * `dist/client`, that is exactly the growth this gate exists to surface, and
 * the right response is a deliberate exclusion recorded here, not a silent one.
 *
 * ## Why a missing or empty `dist/client` FAILS
 *
 * A gate that passes when its input is absent is the "green while wrong"
 * failure mode this repo has recorded more than once. No `dist/client` means
 * the build has not run — the fix is `bun run build`, and the message says so.
 * An EMPTY `dist/client` fails for the same reason: the build always emits
 * CSS for the admin screens, so zero files means this script is measuring the
 * wrong directory or the build broke, never that the client got lighter.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const CLIENT_DIST = "dist/client";

/** Baseline 139,048 B (2026-08-05) + ~29% headroom, rounded. */
export const TOTAL_BUDGET_BYTES = 180_000;

/** Largest file at baseline 16,800 B (2026-08-05) + 25%. */
export const PER_FILE_BUDGET_BYTES = 21_000;

export type ClientAsset = { path: string; bytes: number };

export type Measurement = { totalBytes: number; files: ClientAsset[] };

export type Budget = { totalBudgetBytes: number; perFileBudgetBytes: number };

export type BudgetReport = {
  ok: boolean;
  totalBytes: number;
  overTotal: boolean;
  oversizedFiles: ClientAsset[];
  empty: boolean;
};

/**
 * Walk `root` recursively and size every regular file.
 *
 * Rejects when `root` does not exist — the caller decides how loudly. Files
 * come back sorted largest-first so failure output and "top 5" reporting need
 * no second sort.
 */
export async function measureClientAssets(root: string): Promise<Measurement> {
  const files: ClientAsset[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        const info = await stat(absolute);
        files.push({ path: path.relative(root, absolute), bytes: info.size });
      }
    }
  }

  await walk(root);

  files.sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path));

  return {
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files
  };
}

export function evaluateBudget(
  measurement: Measurement,
  budget: Budget = {
    totalBudgetBytes: TOTAL_BUDGET_BYTES,
    perFileBudgetBytes: PER_FILE_BUDGET_BYTES
  }
): BudgetReport {
  const empty = measurement.files.length === 0;
  const overTotal = measurement.totalBytes > budget.totalBudgetBytes;
  const oversizedFiles = measurement.files.filter(
    (file) => file.bytes > budget.perFileBudgetBytes
  );

  return {
    ok: !empty && !overTotal && oversizedFiles.length === 0,
    totalBytes: measurement.totalBytes,
    overTotal,
    oversizedFiles,
    empty
  };
}

export function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString("en-US")} B (${(bytes / 1000).toFixed(1)} kB)`;
}

/**
 * Actionable failure text: which budget broke, by how much, and the five
 * largest files — because the fix is almost always in one of them.
 */
export function formatFailure(
  report: BudgetReport,
  measurement: Measurement,
  budget: Budget
): string[] {
  const lines: string[] = ["build:asset-budget:check FAILED"];

  if (report.empty) {
    lines.push(
      `  - ${CLIENT_DIST} exists but holds no files. The build always emits ` +
        "admin CSS, so this means the build broke or the wrong directory is " +
        "being measured — never that the client got lighter."
    );
    return lines;
  }

  if (report.overTotal) {
    lines.push(
      `  - total ${formatBytes(report.totalBytes)} exceeds the budget of ` +
        `${formatBytes(budget.totalBudgetBytes)}. Trim what the browser ` +
        "downloads, or — if a feature genuinely bought this weight — " +
        "re-measure and raise TOTAL_BUDGET_BYTES in " +
        "scripts/client-asset-budget.ts as a reviewed diff."
    );
  }

  for (const file of report.oversizedFiles) {
    lines.push(
      `  - ${file.path} is ${formatBytes(file.bytes)}, over the per-file ` +
        `budget of ${formatBytes(budget.perFileBudgetBytes)}. A single file ` +
        "this size usually means an island bundled a dependency; split or " +
        "drop it, or raise PER_FILE_BUDGET_BYTES with the reasoning updated."
    );
  }

  lines.push("  Largest files:");
  for (const file of measurement.files.slice(0, 5)) {
    lines.push(`    ${formatBytes(file.bytes).padStart(22)}  ${file.path}`);
  }

  return lines;
}

function isMissingDirectory(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function main(): Promise<void> {
  const budget: Budget = {
    totalBudgetBytes: TOTAL_BUDGET_BYTES,
    perFileBudgetBytes: PER_FILE_BUDGET_BYTES
  };

  let measurement: Measurement;
  try {
    measurement = await measureClientAssets(CLIENT_DIST);
  } catch (error) {
    if (isMissingDirectory(error)) {
      console.error(
        `build:asset-budget:check FAILED — ${CLIENT_DIST} tidak ada. ` +
          "Jalankan build dulu: `bun run build` (target `build` sudah " +
          "merantainya setelah `astro build`)."
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const report = evaluateBudget(measurement, budget);

  if (!report.ok) {
    for (const line of formatFailure(report, measurement, budget)) {
      console.error(line);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `build:asset-budget:check OK — ${measurement.files.length} files, total ` +
      `${formatBytes(report.totalBytes)} within ` +
      `${formatBytes(budget.totalBudgetBytes)}; largest file within ` +
      `${formatBytes(budget.perFileBudgetBytes)}.`
  );
}

if (import.meta.main) {
  await main();
}
