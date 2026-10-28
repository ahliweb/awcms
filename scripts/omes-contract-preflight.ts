#!/usr/bin/env bun
/**
 * `bun run omes:contract:preflight` - Issue #1185.
 *
 * READ-ONLY, offline, Bun-only. No network, no SSH, no shell-out, no DB: it
 * reads files in the checkout and (optionally) one JSON file describing a
 * worker. It refuses (exit 1) when this release's vendored OMES worker
 * contract is not the one the release declares, or when a worker is outside
 * the declared compatibility range.
 *
 *   bun run omes:contract:preflight
 *     Release-side checks: PIN.json drift (same as contracts:omes:sync:check),
 *     the PIN matches the hand-declared source commit + aggregate digest in
 *     `domain/contracts/compatibility.ts`, and the OpenAPI document still
 *     carries the four worker routes (enroll/poll/result/heartbeat).
 *
 *   bun run omes:contract:preflight -- --worker <descriptor.json>
 *     Additionally evaluates a worker descriptor (`contract_version`,
 *     `omes_version`, optional `contract_digest`, `capabilities`) with the
 *     fail-closed rules of `evaluateWorkerCompatibility`. An unknown
 *     capability is reported as `unsupported_capability`, never as success.
 *     `--require-digest` additionally refuses a worker that omits the digest.
 *
 * It never fetches `omes/main` (or anything else): the only contract it
 * knows is the vendored, pinned snapshot.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DECLARED_CONTRACT,
  DECLARED_WORKER_RANGE,
  aggregateContractDigest,
  evaluateWorkerCompatibility
} from "../src/modules/omes-control/domain/contracts/compatibility";
import {
  PIN_MANIFEST_FILENAME,
  VENDORED_CONTRACTS_DIR,
  checkContractsDrift,
  type PinManifest
} from "./sync-omes-contracts";

export const REQUIRED_WORKER_PATHS = [
  "/api/v1/omes/worker/enroll",
  "/api/v1/omes/worker/poll",
  "/api/v1/omes/worker/result",
  "/api/v1/omes/worker/heartbeat"
] as const;

export type PreflightResult = { failures: string[]; notes: string[] };

export function runOmesContractPreflight(
  rootDir: string,
  options: {
    workerDescriptor?: unknown;
    requireDigest?: boolean;
    openApiText?: string;
  } = {}
): PreflightResult {
  const failures: string[] = [...checkContractsDrift(rootDir)];
  const notes: string[] = [];

  const pinPath = path.join(
    rootDir,
    VENDORED_CONTRACTS_DIR,
    PIN_MANIFEST_FILENAME
  );
  if (existsSync(pinPath)) {
    try {
      const pin = JSON.parse(readFileSync(pinPath, "utf8")) as PinManifest;
      const expected: Array<[string, unknown, unknown]> = [
        ["sourceRepo", pin.sourceRepo, DECLARED_CONTRACT.sourceRepo],
        ["area", pin.area, DECLARED_CONTRACT.area],
        ["version", pin.version, DECLARED_CONTRACT.version],
        ["sourceCommit", pin.sourceCommit, DECLARED_CONTRACT.sourceCommit]
      ];
      for (const [field, got, want] of expected) {
        if (got !== want) {
          failures.push(
            `PIN.json ${field} is ${JSON.stringify(got)} but compatibility.ts declares ${JSON.stringify(want)} - a contract bump needs a reviewed edit of compatibility.ts and the README matrix`
          );
        }
      }
      const digest = aggregateContractDigest(pin.files ?? {});
      if (digest !== DECLARED_CONTRACT.aggregateDigest) {
        failures.push(
          `aggregate contract digest is ${digest} but compatibility.ts declares ${DECLARED_CONTRACT.aggregateDigest}`
        );
      }
    } catch {
      // checkContractsDrift already reported the unreadable manifest.
    }
  }

  const openApiPath = path.join(
    rootDir,
    "openapi",
    "awcms-public-api.openapi.yaml"
  );
  const openApi =
    options.openApiText ??
    (existsSync(openApiPath) ? readFileSync(openApiPath, "utf8") : "");
  for (const p of REQUIRED_WORKER_PATHS) {
    if (!new RegExp(`^  ${p}:\\s*$`, "m").test(openApi)) {
      failures.push(`OpenAPI does not declare ${p}`);
    }
  }

  if (options.workerDescriptor !== undefined) {
    const verdict = evaluateWorkerCompatibility(options.workerDescriptor, {
      requireDigest: options.requireDigest
    });
    if (verdict.status === "compatible") {
      notes.push(
        verdict.evidence === null
          ? `worker accepted by the DECLARED range [${DECLARED_WORKER_RANGE.minInclusive}, ${DECLARED_WORKER_RANGE.maxExclusive}); no tagged-release evidence is recorded (compatibility.ts DECLARED_WORKER_RANGE.evidence is null)`
          : `worker accepted; evidence: ${verdict.evidence}`
      );
    } else {
      for (const d of verdict.detail) {
        failures.push(
          `worker ${verdict.status} (${verdict.reasons.join(", ")}): ${d}`
        );
      }
    }
  }
  return { failures, notes };
}

function main() {
  const argv = process.argv.slice(2);
  const wi = argv.indexOf("--worker");
  let workerDescriptor: unknown;
  if (wi !== -1) {
    const file = argv[wi + 1];
    if (!file || file.startsWith("--")) {
      console.error("omes:contract:preflight: --worker needs a file path");
      process.exit(1);
    }
    try {
      workerDescriptor = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      console.error(
        `omes:contract:preflight: cannot read worker descriptor ${file}: ${(err as Error).message}`
      );
      process.exit(1);
    }
  }
  const { failures, notes } = runOmesContractPreflight(process.cwd(), {
    workerDescriptor,
    requireDigest: argv.includes("--require-digest")
  });
  for (const n of notes) console.log(`omes:contract:preflight: note: ${n}`);
  if (failures.length > 0) {
    console.error(
      `omes:contract:preflight: REFUSED, ${failures.length} problem(s):`
    );
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `omes:contract:preflight: OK - vendored contract ${DECLARED_CONTRACT.version} @ ${DECLARED_CONTRACT.sourceCommit.slice(0, 12)} matches the release declaration.`
  );
}

if (import.meta.main) main();
