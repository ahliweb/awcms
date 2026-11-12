/**
 * `bun run loadtest:run -- <options>` — start k6 generators for one run.
 *
 * Local fleet (N processes on this machine):
 *   --generators 3
 * One generator of a multi-machine fleet (run the same command on each
 * machine with the same --run-id, --start-at and --total-generators):
 *   --generator-id g2 --total-generators 3 --start-at <epoch ms>
 *
 * Credentials come from the environment, never from arguments:
 *   LOADTEST_TENANT_ID, LOADTEST_LOGIN_IDENTIFIER, LOADTEST_LOGIN_PASSWORD
 * and LOADTEST_TARGET_APPROVED must equal the run id: a deliberate
 * acknowledgement that this target may be loaded. The k6 setup() additionally
 * refuses a target that lacks the tenant seeded for this run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";

import { startSampler } from "./lib/saturation";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function need(name: string): string {
  const v = arg(name);
  if (!v) {
    console.error(`--${name} is required`);
    process.exit(64);
  }
  return v;
}

const runId = need("run-id");
if (!/^[a-z0-9-]{4,40}$/.test(runId)) {
  console.error("--run-id must be a-z, 0-9, hyphen, 4-40 chars");
  process.exit(64);
}
if (process.env.LOADTEST_TARGET_APPROVED !== runId) {
  console.error(
    "Refusing to send load: set LOADTEST_TARGET_APPROVED to the run id to acknowledge the target may be loaded."
  );
  process.exit(64);
}

const baseUrl = need("base-url");
const scenario = arg("scenario") ?? "public-page";
const profile = arg("profile") ?? "smoke";
const targetRps = arg("target-rps") ?? "50";
const tenantCode = need("tenant-code");
const outDir = resolve(arg("out-dir") ?? "loadtest/results");
const startAt = arg("start-at") ?? String(Date.now() + 15_000);
const linkMbps = arg("link-mbps") ? Number(arg("link-mbps")) : null;
const useDocker = flag("k6-docker");

const single = arg("generator-id");
const total = single
  ? Number(need("total-generators"))
  : Number(arg("generators") ?? "3");
const ids = single
  ? [single]
  : Array.from({ length: total }, (_, i) => `g${i + 1}`);
if (!single && total < 1) process.exit(64);

mkdirSync(join(outDir, runId), { recursive: true });

function k6Command(id: string): string[] {
  const script = resolve(import.meta.dir, "k6/awcms.js");
  const envPairs: Record<string, string> = {
    BASE_URL: baseUrl,
    SCENARIO: scenario,
    PROFILE: profile,
    RUN_ID: runId,
    GENERATOR_ID: id,
    TOTAL_GENERATORS: String(total),
    TARGET_RPS: targetRps,
    START_AT_MS: startAt,
    TENANT_CODE: tenantCode,
    POST_COUNT: arg("post-count") ?? process.env.LOADTEST_POST_COUNT ?? "20",
    TENANT_ID: process.env.LOADTEST_TENANT_ID ?? "",
    LOGIN_IDENTIFIER: process.env.LOADTEST_LOGIN_IDENTIFIER ?? "",
    LOGIN_PASSWORD: process.env.LOADTEST_LOGIN_PASSWORD ?? "",
    HOLD: arg("hold") ?? "5m",
    OUT_DIR: useDocker ? "/results" : outDir
  };
  if (useDocker) {
    const e = Object.entries(envPairs).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    return [
      "docker",
      "run",
      "--rm",
      "--network",
      "host",
      "--user",
      `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
      "-v",
      `${resolve(import.meta.dir)}/k6:/scripts:ro`,
      "-v",
      `${outDir}:/results`,
      ...e,
      process.env.K6_IMAGE ?? "grafana/k6:1.1.0",
      "run",
      "--address",
      "127.0.0.1:0",
      "/scripts/awcms.js"
    ];
  }
  const e = Object.entries(envPairs).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  return [
    process.env.K6_BIN ?? "k6",
    "run",
    "--address",
    "127.0.0.1:0",
    ...e,
    script
  ];
}

const sampler = startSampler(ids.join("+"), hostname(), linkMbps);
const procs = ids.map((id) => ({
  id,
  p: Bun.spawn(k6Command(id), { stdout: "inherit", stderr: "inherit" })
}));
const codes = await Promise.all(procs.map((x) => x.p.exited));
const sat = sampler.stop();

// One saturation record per generator; a local fleet shares the machine, so
// they share the figures.
for (const id of ids) {
  writeFileSync(
    join(outDir, runId, `${id}.saturation.json`),
    JSON.stringify({ ...sat, generatorId: id }, null, 2)
  );
}
// k6 exits 99 when a threshold is crossed: that is a result, not a crash.
const crashed = codes.some((c) => c !== 0 && c !== 99);
console.log(
  `generators finished (exit codes ${codes.join(",")}); results in ${join(outDir, runId)}`
);
process.exit(crashed ? 2 : 0);
