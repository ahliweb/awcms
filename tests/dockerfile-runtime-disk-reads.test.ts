/**
 * The `runtime` stage of Dockerfile.production is built to be minimal: it
 * copies `node_modules`, `dist`, and `package.json` — never `src/`. Several
 * request paths read files off disk at runtime with paths resolved against
 * `process.cwd()`, not bundled into `dist/`, so any of those directories
 * missing from the `runtime` stage means the corresponding read silently
 * (or loudly) fails in every production container built from this file.
 *
 * The concrete incident this guards against: `omes-cms.ahlikoding.com`
 * shipped with the runtime image missing
 * `src/modules/omes-control/contracts/v1` (the vendored OMES contract
 * snapshot). `/admin/omes/arsitektur` rendered but its data never loaded
 * (ENOENT on PIN.json), and every worker route that validates a request
 * against a vendored schema (enroll/poll/result/heartbeat/
 * ai-privacy-posture/hermes-orchestration-*) would reject every real
 * request — unnoticed only because no worker was enrolled yet.
 *
 * Rather than hardcoding the vendored contracts path a second time here (the
 * exact way the Dockerfile drifted from the loader in the first place), the
 * primary assertion imports the loader's own `VENDORED_CONTRACTS_DIR`
 * constant — a path change in the loader can't silently desync this test
 * from what the Dockerfile needs to copy.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { VENDORED_CONTRACTS_DIR } from "../src/modules/omes-control/domain/contracts/loader";

const read = (file: string) => readFileSync(file, "utf8");

/**
 * Every top-level directory (relative to the repo root / `process.cwd()`)
 * that production request-handling code reads from disk at runtime, and
 * why. Adding a new `process.cwd()`-relative `readFile`/`readdir` in `src/`
 * means adding its directory here too — that is the point of the assertion
 * below failing loudly instead of ENOENT failing silently in production.
 */
const RUNTIME_DISK_READ_DIRS: ReadonlyArray<{
  dir: string;
  readBy: string;
}> = [
  {
    dir: VENDORED_CONTRACTS_DIR,
    readBy:
      "src/modules/omes-control/domain/contracts/loader.ts (PIN.json, schemas, state tables, fixtures)"
  },
  {
    dir: "sql",
    readBy:
      "src/modules/module-management/application/health-registry.ts (migrations_applied signal)"
  },
  {
    dir: "openapi",
    readBy:
      "src/modules/module-management/application/health-registry.ts (openapi_documented signal, per module.ts openApiPath)"
  },
  {
    dir: "asyncapi",
    readBy:
      "src/modules/module-management/application/health-registry.ts (asyncapi_documented signal, per module.ts asyncApiPath)"
  }
];

/** Pulls every `COPY ... <src> <dest>` source path out of one build stage. */
function copiedSourcesInStage(dockerfile: string, stageName: string): string[] {
  const stageStart = dockerfile.indexOf(`AS ${stageName}\n`);
  expect(stageStart).toBeGreaterThan(-1);

  // A stage ends at the next `FROM ` line, or end of file for the last stage.
  const nextFrom = dockerfile.indexOf("\nFROM ", stageStart);
  const stageBody =
    nextFrom === -1
      ? dockerfile.slice(stageStart)
      : dockerfile.slice(stageStart, nextFrom);

  const sources: string[] = [];
  for (const line of stageBody.split("\n")) {
    // Matches both `COPY --chown=bun:bun <src> ./<dest>` (build-context
    // copies) and `COPY --from=<stage> ... <src> ./<dest>` (cross-stage
    // copies). Only build-context copies (no `--from`) can bring in a
    // repo-relative directory like `sql` or `src/...`.
    const match = /^COPY\s+(?:--chown=\S+\s+)?(?!--from)(\S+)\s+(\S+)/.exec(
      line.trim()
    );
    if (match) sources.push(match[1]!);
  }
  return sources;
}

describe("Dockerfile.production `runtime` stage carries every directory it reads at request time", () => {
  const dockerfile = read("Dockerfile.production");
  const runtimeSources = copiedSourcesInStage(dockerfile, "runtime");

  for (const { dir, readBy } of RUNTIME_DISK_READ_DIRS) {
    test(`copies \`${dir}\` (read by ${readBy})`, () => {
      // The Dockerfile is allowed to copy the directory itself, or any
      // ancestor of it (e.g. copying `.../contracts` also brings in
      // `.../contracts/v1`).
      const isCopied = runtimeSources.some((src) => {
        const normalized = src.replace(/^\.\//, "").replace(/\/$/, "");
        return dir === normalized || dir.startsWith(`${normalized}/`);
      });
      expect(isCopied).toBe(true);
    });
  }

  test("does not accidentally copy the whole `src/` tree (defeats the minimal-image intent)", () => {
    expect(runtimeSources).not.toContain("src");
    expect(runtimeSources).not.toContain("./src");
    expect(runtimeSources).not.toContain(".");
  });
});
