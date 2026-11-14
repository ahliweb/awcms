/**
 * Consumer compatibility declaration for the vendored OMES worker contract
 * (Issue #1185). PURE: no I/O, no network, no clock. The deploy preflight
 * (`scripts/omes-contract-preflight.ts`) and
 * `tests/omes-control-contract-consumer-compat.test.ts` both import this file,
 * so "what this AWCMS release accepts" has exactly one definition.
 *
 * ## What is pinned, and why by digest
 *
 * `contracts/v1/PIN.json` already hashes every vendored file. That proves the
 * copy was not hand-edited, but not that it is the copy THIS release was
 * reviewed against: re-running `contracts:omes:sync` rewrites PIN.json and
 * its hashes together, so the drift check stays green after an unreviewed
 * bump. {@link DECLARED_CONTRACT} is the second, independent anchor: a source
 * commit and one aggregate digest over the whole PIN file map, written by
 * hand in this file. A sync to a different OMES commit therefore changes the
 * aggregate, fails the preflight and the test, and forces a reviewed edit
 * here (together with the compatibility matrix in the README).
 *
 * ## The worker range is DECLARED; the schemas are compared, the runtime is not
 *
 * Issue #1185 asks for a matrix "verified from the actual tagged contract,
 * never assume binary SemVer compatibility". The vendored worker schemas were
 * recomputed against the OMES `v0.6.0` tag and are byte-identical
 * ({@link DECLARED_WORKER_EVIDENCE}, status "schema-identical,
 * runtime-unverified"). Nothing has been run against a real worker, so a range
 * is a necessary condition (a worker outside it is refused); it is never
 * sufficient evidence of compatibility, and the preflight says so out loud.
 *
 * ## Fail closed
 *
 * Anything missing, malformed, a pre-release, a different contract major, or
 * a digest that is not exactly the declared one is `incompatible`. A
 * capability this consumer does not know is `unsupported_capability`, never a
 * guessed success.
 */
import { createHash } from "node:crypto";

import { OMES_OPERATION_CODES } from "../operations";

export const DECLARED_CONTRACT = {
  sourceRepo: "ahliweb/omes",
  area: "control-center",
  version: "v1",
  sourceCommit: "a4026e6338ce917dbd6771c7e1bf02c14e31c38f",
  /** {@link aggregateContractDigest} over PIN.json's `files` map. */
  aggregateDigest:
    "43479731f1f574710e5524779cdc591489c64d500d305814a0880571ec390ae4"
} as const;

/**
 * Producer-side compatibility artifacts (the worker compatibility manifest
 * schema, its fixtures and the consumer decision table), vendored under
 * `contracts/compatibility/v1/` with their own `PIN.json`. Same two-anchor
 * idea as {@link DECLARED_CONTRACT}: the PIN proves the copy is intact, this
 * constant proves it is the copy this release was reviewed against.
 */
export const DECLARED_PRODUCER_COMPAT = {
  sourceRepo: "ahliweb/omes",
  area: "compatibility",
  version: "v1",
  sourceCommit: "c9940822523996ee184a25e063f36143389669e2",
  /** {@link aggregateContractDigest} over that PIN.json's `files` map. */
  aggregateDigest:
    "dab4b1e5a3dd6baa50fc1dcf3722838ccab747c47482a6c02ae87a776ffaff16"
} as const;

/**
 * The nine files the producer's worker compatibility manifest digests: the
 * wire contract a worker and this Control Center must agree on byte for byte.
 */
export const OMES_WORKER_CONTRACT_FILES: readonly string[] = [
  "operation-request",
  "worker-enrollment.request",
  "worker-enrollment.response",
  "worker-heartbeat.request",
  "worker-heartbeat.response",
  "worker-poll.request",
  "worker-poll.response",
  "worker-result.request",
  "worker-result.response"
];

/**
 * The producer's digest formula (`sha256:` + sha256 over the sorted
 * `contracts/control-center/v1/<name>.schema.json:<sha256>\n` lines of
 * {@link OMES_WORKER_CONTRACT_FILES}), recomputed here from this release's own
 * PIN file map rather than copied from any manifest. It is a THIRD definition
 * next to {@link aggregateContractDigest} (whole PIN map, no prefix); the two
 * answer different questions and must not be compared with each other.
 * Returns `null` when a required file is absent from the map.
 */
export function omesWorkerContractDigest(
  pinFiles: Readonly<Record<string, string>>
): string | null {
  const lines: string[] = [];
  for (const name of OMES_WORKER_CONTRACT_FILES) {
    const sha = pinFiles[`${name}.schema.json`];
    if (typeof sha !== "string") return null;
    lines.push(`contracts/control-center/v1/${name}.schema.json:${sha}\n`);
  }
  lines.sort();
  return `sha256:${createHash("sha256").update(lines.join("")).digest("hex")}`;
}

/**
 * What was actually compared against a tagged OMES release, and what was not.
 * Every field is a fact that was recomputed from a git checkout of the public
 * `ahliweb/omes` repository, not typed from a claim:
 *
 * - tag `v0.6.0` (annotated tag object `82f0a15`) peels to commit
 *   `c7c3cf9d89090071a1690d209b7b86ad8ce03d49`;
 * - the producer digest formula over the nine worker contract files at that
 *   tag, at the vendored source commit
 *   {@link DECLARED_CONTRACT.sourceCommit} and over this repository's
 *   vendored copy are all the same value (`workerContractDigest`);
 * - therefore the vendored wire SCHEMAS equal the v0.6.0 schemas byte for
 *   byte. That is `schema-identical`. It is NOT `runtime-verified`: the
 *   v0.6.0 worker does not sign its requests with this repository's
 *   canonical envelope (see the omes-control README "Open decisions"), no
 *   release publishes a compatibility manifest, and nothing has been run
 *   against a real worker. `verifiedBuilds` stays empty on purpose.
 *
 * The preflight recomputes `workerContractDigest` from the vendored PIN, so a
 * contract re-sync that changes any of the nine files turns it red until this
 * block is re-derived and reviewed.
 */
export const DECLARED_WORKER_EVIDENCE = {
  sourceRepo: "ahliweb/omes",
  releaseTag: "v0.6.0",
  releaseCommit: "c7c3cf9d89090071a1690d209b7b86ad8ce03d49",
  workerContractDigest:
    "sha256:8188160e69074d87eb658dc64a69004b0e23a8a80e97033996e5c1668ce3d3f9",
  status: "schema-identical, runtime-unverified",
  verifiedBuilds: [] as readonly string[],
  /** Worker v0.6.0 signs nothing this consumer can verify; do not read the schema match as enrollability. */
  requestSigning: "unsigned-by-worker"
} as const;

/** Half-open semver range `[minInclusive, maxExclusive)` over stable releases. */
export const DECLARED_WORKER_RANGE = {
  minInclusive: "0.6.0",
  maxExclusive: "0.7.0",
  /**
   * Human-readable evidence line for the lower bound. It is NOT a claim of
   * runtime compatibility: see {@link DECLARED_WORKER_EVIDENCE}.status. Set to
   * `null` again if the evidence block is ever withdrawn.
   */
  evidence:
    (`${DECLARED_WORKER_EVIDENCE.sourceRepo} ${DECLARED_WORKER_EVIDENCE.releaseTag} ` +
      `(${DECLARED_WORKER_EVIDENCE.releaseCommit.slice(0, 8)}): worker contract digest ` +
      `${DECLARED_WORKER_EVIDENCE.workerContractDigest} equals the vendored copy; ` +
      `${DECLARED_WORKER_EVIDENCE.status}`) as string | null
};

/** Capabilities this consumer will act on: the safe-operation allowlist. */
export const SUPPORTED_WORKER_CAPABILITIES: ReadonlySet<string> = new Set(
  OMES_OPERATION_CODES
);

/** Order-independent digest of PIN.json's `files` map. */
export function aggregateContractDigest(
  files: Readonly<Record<string, string>>
): string {
  const h = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    h.update(`${name}\0${files[name]}\n`);
  }
  return h.digest("hex");
}

export type ParsedSemver = { major: number; minor: number; patch: number };

/** Strict stable `MAJOR.MINOR.PATCH` (optional leading `v`); pre-release/build tags return `null`. */
export function parseStableSemver(value: unknown): ParsedSemver | null {
  if (typeof value !== "string") return null;
  const m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function compare(a: ParsedSemver, b: ParsedSemver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export type CompatibilityReason =
  | "unsupported_contract_version"
  | "contract_digest_mismatch"
  | "worker_version_unparseable"
  | "worker_version_out_of_range"
  | "descriptor_malformed"
  | "unsupported_capability";

export type CompatibilityVerdict =
  | { status: "compatible"; evidence: string | null }
  | {
      status: "incompatible" | "unsupported_capability";
      reasons: CompatibilityReason[];
      detail: string[];
    };

/**
 * What a worker announces about itself. `contract_version` and `omes_version`
 * are the `worker-heartbeat.request` field names; `contract_digest` is the
 * aggregate digest of the worker's own vendored contract snapshot (the
 * producer side, OMES #352, has to publish it - until then a worker that
 * omits it is refused when `requireDigest` is set).
 */
export type WorkerDescriptor = {
  contract_version?: unknown;
  omes_version?: unknown;
  contract_digest?: unknown;
  capabilities?: unknown;
};

export function evaluateWorkerCompatibility(
  descriptor: unknown,
  options: { requireDigest?: boolean } = {}
): CompatibilityVerdict {
  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor)
  ) {
    return {
      status: "incompatible",
      reasons: ["descriptor_malformed"],
      detail: ["worker descriptor must be a JSON object"]
    };
  }
  const d = descriptor as WorkerDescriptor;
  const reasons: CompatibilityReason[] = [];
  const detail: string[] = [];

  if (d.contract_version !== DECLARED_CONTRACT.version) {
    reasons.push("unsupported_contract_version");
    detail.push(
      `contract_version ${JSON.stringify(d.contract_version)} is not '${DECLARED_CONTRACT.version}' (unknown, missing or future major)`
    );
  }

  if (d.contract_digest === undefined) {
    if (options.requireDigest) {
      reasons.push("contract_digest_mismatch");
      detail.push("contract_digest is missing");
    }
  } else if (d.contract_digest !== DECLARED_CONTRACT.aggregateDigest) {
    reasons.push("contract_digest_mismatch");
    detail.push(
      `contract_digest ${JSON.stringify(d.contract_digest)} does not equal the declared ${DECLARED_CONTRACT.aggregateDigest}`
    );
  }

  const worker = parseStableSemver(d.omes_version);
  const min = parseStableSemver(DECLARED_WORKER_RANGE.minInclusive)!;
  const max = parseStableSemver(DECLARED_WORKER_RANGE.maxExclusive)!;
  if (worker === null) {
    reasons.push("worker_version_unparseable");
    detail.push(
      `omes_version ${JSON.stringify(d.omes_version)} is not a stable MAJOR.MINOR.PATCH`
    );
  } else if (compare(worker, min) < 0 || compare(worker, max) >= 0) {
    reasons.push("worker_version_out_of_range");
    detail.push(
      `omes_version ${String(d.omes_version)} is outside [${DECLARED_WORKER_RANGE.minInclusive}, ${DECLARED_WORKER_RANGE.maxExclusive})`
    );
  }

  if (reasons.length > 0) return { status: "incompatible", reasons, detail };

  if (d.capabilities !== undefined) {
    if (
      !Array.isArray(d.capabilities) ||
      d.capabilities.some((c) => typeof c !== "string")
    ) {
      return {
        status: "incompatible",
        reasons: ["descriptor_malformed"],
        detail: ["capabilities must be an array of strings"]
      };
    }
    const unknown = (d.capabilities as string[]).filter(
      (c) => !SUPPORTED_WORKER_CAPABILITIES.has(c)
    );
    if (unknown.length > 0) {
      return {
        status: "unsupported_capability",
        reasons: ["unsupported_capability"],
        detail: unknown.map((c) => `capability ${JSON.stringify(c)} is unknown`)
      };
    }
  }

  return { status: "compatible", evidence: DECLARED_WORKER_RANGE.evidence };
}
