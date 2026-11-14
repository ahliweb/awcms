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
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DECLARED_CONTRACT,
  DECLARED_PRODUCER_COMPAT,
  DECLARED_WORKER_EVIDENCE,
  DECLARED_WORKER_RANGE,
  aggregateContractDigest,
  evaluateWorkerCompatibility,
  omesWorkerContractDigest
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

/** Where the producer-side compatibility artifacts are vendored (own PIN, own source commit). */
export const VENDORED_PRODUCER_COMPAT_DIR = path.join(
  "src",
  "modules",
  "omes-control",
  "contracts",
  "compatibility",
  "v1"
);

function listFilesRelative(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(path.join(dir, prefix), {
    withFileTypes: true
  })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFilesRelative(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}

/**
 * Verifies the vendored producer compatibility artifacts: every PIN-listed
 * file hashes to what the PIN says, no unpinned file sits beside them, and the
 * PIN equals the hand-declared {@link DECLARED_PRODUCER_COMPAT}. Read-only.
 */
export function checkProducerCompatPin(rootDir: string): string[] {
  const failures: string[] = [];
  const dir = path.join(rootDir, VENDORED_PRODUCER_COMPAT_DIR);
  const pinPath = path.join(dir, PIN_MANIFEST_FILENAME);
  if (!existsSync(pinPath)) {
    return [`producer compatibility PIN is missing: ${pinPath}`];
  }
  let pin: PinManifest;
  try {
    pin = JSON.parse(readFileSync(pinPath, "utf8")) as PinManifest;
  } catch (err) {
    return [
      `producer compatibility PIN is unreadable: ${(err as Error).message}`
    ];
  }
  const files = pin.files ?? {};
  for (const [name, sha] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (!existsSync(file)) {
      failures.push(`producer compatibility file ${name} is missing`);
      continue;
    }
    const actual = createHash("sha256")
      .update(readFileSync(file))
      .digest("hex");
    if (actual !== sha) {
      failures.push(
        `producer compatibility file ${name} does not match the PIN (drift)`
      );
    }
  }
  for (const rel of listFilesRelative(dir)) {
    if (rel !== PIN_MANIFEST_FILENAME && !(rel in files)) {
      failures.push(
        `producer compatibility file ${rel} is not listed in the PIN`
      );
    }
  }
  const declared: Array<[string, unknown, unknown]> = [
    ["sourceRepo", pin.sourceRepo, DECLARED_PRODUCER_COMPAT.sourceRepo],
    ["area", pin.area, DECLARED_PRODUCER_COMPAT.area],
    ["version", pin.version, DECLARED_PRODUCER_COMPAT.version],
    ["sourceCommit", pin.sourceCommit, DECLARED_PRODUCER_COMPAT.sourceCommit],
    [
      "aggregate digest",
      aggregateContractDigest(files),
      DECLARED_PRODUCER_COMPAT.aggregateDigest
    ]
  ];
  for (const [field, got, want] of declared) {
    if (got !== want) {
      failures.push(
        `producer compatibility PIN ${field} is ${JSON.stringify(got)} but compatibility.ts declares ${JSON.stringify(want)}`
      );
    }
  }
  return failures;
}

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
      const workerDigest = omesWorkerContractDigest(pin.files ?? {});
      if (workerDigest !== DECLARED_WORKER_EVIDENCE.workerContractDigest) {
        failures.push(
          `worker contract digest (OMES formula) is ${String(workerDigest)} but the recorded ${DECLARED_WORKER_EVIDENCE.releaseTag} evidence is ${DECLARED_WORKER_EVIDENCE.workerContractDigest} - re-derive DECLARED_WORKER_EVIDENCE against the new contract before bumping`
        );
      }
    } catch {
      // checkContractsDrift already reported the unreadable manifest.
    }
  }

  failures.push(...checkProducerCompatPin(rootDir));

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
          : `worker accepted by the declared range; evidence: ${verdict.evidence}; build unverified (no manifest-verified build, verifiedBuilds is empty)`
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
