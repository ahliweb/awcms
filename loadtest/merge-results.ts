/**
 * `bun run loadtest:merge -- --run-id <id> [--dir loadtest/results] [--generators N]`
 *
 * Reads every `<gen>.summary.json` and `<gen>.saturation.json` of one run,
 * prints the merged report and writes `merged.json`. Exits 0 only when the
 * result is accepted (all generators present, none saturated, no 429).
 * For generators on other machines, copy their two files into the same
 * directory first.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_LIMITS,
  mergeResults,
  renderReport,
  type GeneratorResult,
  type Saturation
} from "./lib/merge";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const runId = arg("run-id");
if (!runId || !/^[a-z0-9-]{4,40}$/.test(runId)) {
  console.error("--run-id is required (a-z, 0-9, hyphen, 4-40 chars)");
  process.exit(64);
}
const dir = join(arg("dir") ?? "loadtest/results", runId);
mkdirSync(dir, { recursive: true });
const files = readdirSync(dir);

const results = files
  .filter((f) => f.endsWith(".summary.json"))
  .map(
    (f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as GeneratorResult
  );
const saturations = files
  .filter((f) => f.endsWith(".saturation.json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as Saturation);

if (results.length === 0) {
  console.error(`no <generator>.summary.json found in ${dir}`);
  process.exit(2);
}

const expected = Number(arg("generators") ?? results[0]?.totalGenerators ?? 0);
const report = mergeResults(results, saturations, expected, {
  maxCpuPct: Number(arg("max-cpu") ?? DEFAULT_LIMITS.maxCpuPct),
  maxNetPct: Number(arg("max-net") ?? DEFAULT_LIMITS.maxNetPct),
  maxDroppedRatio: DEFAULT_LIMITS.maxDroppedRatio
});
writeFileSync(join(dir, "merged.json"), JSON.stringify(report, null, 2));
console.log(renderReport(report));
process.exit(report.accepted ? 0 : 1);
