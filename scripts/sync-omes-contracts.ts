#!/usr/bin/env bun
/**
 * Vendors the pinned OMES `contracts/control-center/v1/**` snapshot into
 * `src/modules/omes-control/contracts/v1/**` (Issue ahliweb/omes#197, parent
 * #195, ADR-0122).
 *
 * Why vendored, not fetched at runtime or test time: the consumer must not
 * depend on network access to validate a payload (issue #197 requirement),
 * and a pinned commit gives an explicit, auditable compatibility boundary
 * instead of silently tracking OMES `main`.
 *
 * Two modes:
 *
 *   bun run contracts:omes:sync -- --source <path-to-omes-checkout> --commit <sha>
 *     Copies every file under `<source>/contracts/control-center/v1/` into
 *     `src/modules/omes-control/contracts/v1/` and (re)writes the PIN
 *     manifest (`src/modules/omes-control/contracts/v1/PIN.json`) recording
 *     the source repository, contract version, source commit, sync
 *     timestamp, and a SHA-256 hash of every vendored file.
 *
 *   bun run contracts:omes:sync:check
 *     Read-only. Recomputes the SHA-256 of every file the PIN manifest
 *     lists, plus a directory walk of what is actually vendored, and fails
 *     with an actionable message if:
 *       - the PIN manifest is missing,
 *       - a manifest-listed file is missing or its hash no longer matches
 *         (drift — the vendored copy was hand-edited or corrupted), or
 *       - a vendored file exists that the manifest does not list (an
 *         un-pinned addition).
 *     This is what `bun run check` runs; it requires no OMES checkout and
 *     no network access.
 *
 * This script deliberately does not interpret contract *semantics* — it only
 * copies files and hashes bytes. Semantic validation (the fail-closed JSON
 * Schema keyword subset and the raw-secret scanner) lives in
 * `src/modules/omes-control/domain/contracts/schema.ts`, mirroring
 * `lib/omes/py/jobs/schema.py` from the OMES repository (issue #172).
 */
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

export const OMES_CONTRACT_AREA = "control-center";
export const OMES_CONTRACT_VERSION = "v1";
export const OMES_SOURCE_REPO = "ahliweb/omes";

export const VENDORED_CONTRACTS_DIR = path.join(
  "src",
  "modules",
  "omes-control",
  "contracts",
  OMES_CONTRACT_VERSION
);

export const PIN_MANIFEST_FILENAME = "PIN.json";

export type PinManifest = {
  /** The upstream repository that owns the contracts (`owner/repo`). */
  sourceRepo: string;
  /** Bounded contract domain, matching OMES's `contracts/<area>/v<major>` layout. */
  area: string;
  /** Contract major version directory, e.g. `v1`. */
  version: string;
  /** The exact OMES commit SHA the vendored snapshot was copied from. */
  sourceCommit: string;
  /** ISO-8601 timestamp of when `contracts:omes:sync` last wrote this manifest. */
  syncedAt: string;
  /** relative path (posix, from this manifest's directory) -> lowercase hex sha256 */
  files: Record<string, string>;
};

function sha256OfFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/** Recursively lists every regular file under `dir`, as POSIX paths relative to `dir`. */
function listFilesRelative(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name !== PIN_MANIFEST_FILENAME) {
        out.push(path.relative(dir, abs).split(path.sep).join("/"));
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return out.sort();
}

export function hashVendoredFiles(
  vendoredDir: string
): Record<string, string> {
  const files = listFilesRelative(vendoredDir);
  const hashes: Record<string, string> = {};
  for (const rel of files) {
    hashes[rel] = sha256OfFile(path.join(vendoredDir, rel));
  }
  return hashes;
}

/** `sync` mode: copy the source contracts directory and (re)write the PIN manifest. */
export function syncContracts(options: {
  rootDir: string;
  sourcePath: string;
  sourceCommit: string;
}): PinManifest {
  const { rootDir, sourcePath, sourceCommit } = options;
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    throw new Error(
      `--commit must be a full 40-character git SHA, got: ${JSON.stringify(sourceCommit)}`
    );
  }
  const sourceContractsDir = path.join(
    sourcePath,
    "contracts",
    OMES_CONTRACT_AREA,
    OMES_CONTRACT_VERSION
  );
  if (!existsSync(sourceContractsDir)) {
    throw new Error(
      `no contracts directory found at ${sourceContractsDir} — check --source points at an OMES checkout`
    );
  }

  const targetDir = path.join(rootDir, VENDORED_CONTRACTS_DIR);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  cpSync(sourceContractsDir, targetDir, { recursive: true });

  const manifest: PinManifest = {
    sourceRepo: OMES_SOURCE_REPO,
    area: OMES_CONTRACT_AREA,
    version: OMES_CONTRACT_VERSION,
    sourceCommit: sourceCommit.toLowerCase(),
    syncedAt: new Date().toISOString(),
    files: hashVendoredFiles(targetDir)
  };
  writeFileSync(
    path.join(targetDir, PIN_MANIFEST_FILENAME),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
}

/** `--check` mode: recompute hashes of what is vendored and diff against the committed PIN manifest. */
export function checkContractsDrift(
  rootDir: string,
  targetDirOverride?: string
): string[] {
  const targetDir = targetDirOverride ?? path.join(rootDir, VENDORED_CONTRACTS_DIR);
  const displayName = targetDirOverride ?? VENDORED_CONTRACTS_DIR;
  const manifestPath = path.join(targetDir, PIN_MANIFEST_FILENAME);
  const failures: string[] = [];

  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    return [
      `${displayName} is missing — run \`bun run contracts:omes:sync -- --source <omes-checkout> --commit <sha>\`.`
    ];
  }
  if (!existsSync(manifestPath)) {
    return [
      `${displayName}/${PIN_MANIFEST_FILENAME} is missing — the vendored contracts are not pinned. Run \`bun run contracts:omes:sync\`.`
    ];
  }

  let manifest: PinManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PinManifest;
  } catch (err) {
    return [
      `${displayName}/${PIN_MANIFEST_FILENAME} is not valid JSON: ${(err as Error).message}`
    ];
  }

  if (manifest.area !== OMES_CONTRACT_AREA) {
    failures.push(
      `pin manifest area is ${JSON.stringify(manifest.area)}, expected ${JSON.stringify(OMES_CONTRACT_AREA)}`
    );
  }
  if (manifest.version !== OMES_CONTRACT_VERSION) {
    failures.push(
      `pin manifest version is ${JSON.stringify(manifest.version)}, expected ${JSON.stringify(OMES_CONTRACT_VERSION)} — this module only supports v1`
    );
  }
  if (!/^[0-9a-f]{40}$/i.test(manifest.sourceCommit ?? "")) {
    failures.push(
      `pin manifest sourceCommit is missing or not a full 40-character git SHA: ${JSON.stringify(manifest.sourceCommit)}`
    );
  }

  const actual = hashVendoredFiles(targetDir);
  const manifestFiles = manifest.files ?? {};

  const missing = Object.keys(manifestFiles).filter((f) => !(f in actual));
  const unpinned = Object.keys(actual).filter((f) => !(f in manifestFiles));
  const tampered = Object.keys(manifestFiles).filter(
    (f) => f in actual && actual[f] !== manifestFiles[f]
  );

  for (const f of missing) {
    failures.push(
      `${displayName}/${f}: listed in the PIN manifest but missing on disk (drift) — re-run \`bun run contracts:omes:sync\``
    );
  }
  for (const f of unpinned) {
    failures.push(
      `${displayName}/${f}: present on disk but not in the PIN manifest — re-run \`bun run contracts:omes:sync\` from a matching OMES commit, or remove the stray file`
    );
  }
  for (const f of tampered) {
    failures.push(
      `${displayName}/${f}: SHA-256 does not match the PIN manifest (expected ${manifestFiles[f]}, got ${actual[f]}) — the vendored contract diverged from the pinned OMES commit ${manifest.sourceCommit}. Re-run \`bun run contracts:omes:sync\` if this drift is intentional, or restore the file if it was hand-edited.`
    );
  }

  return failures;
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--check") {
      check = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`missing value for --${key}`);
      }
      args[key] = value;
      i++;
    }
  }
  return { check, args };
}

async function main() {
  const rootDir = process.cwd();
  const { check, args } = parseArgs(process.argv.slice(2));

  if (check) {
    const failures = checkContractsDrift(rootDir);
    if (failures.length > 0) {
      console.error(
        `contracts:omes:sync:check: ${failures.length} problem(s) found:`
      );
      for (const f of failures) console.error(`  - ${f}`);
      process.exit(1);
    }
    console.log(
      "contracts:omes:sync:check: OK — vendored OMES contracts match the PIN manifest."
    );
    return;
  }

  const sourcePath = args.source;
  const sourceCommit = args.commit;
  if (!sourcePath || !sourceCommit) {
    console.error(
      "usage: bun run contracts:omes:sync -- --source <path-to-omes-checkout> --commit <full-40-char-sha>"
    );
    process.exit(1);
  }

  const manifest = syncContracts({ rootDir, sourcePath, sourceCommit });
  console.log(
    `contracts:omes:sync: vendored ${Object.keys(manifest.files).length} file(s) from ${sourcePath} (commit ${manifest.sourceCommit}) into ${VENDORED_CONTRACTS_DIR}.`
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`contracts:omes:sync: ${(err as Error).message}`);
    process.exit(1);
  });
}
