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
 * ## The worker range is DECLARED, not VERIFIED
 *
 * Issue #1185 asks for a matrix "verified from the actual tagged contract,
 * never assume binary SemVer compatibility". No OMES worker release tag has
 * been compared against the vendored snapshot yet, so
 * {@link DECLARED_WORKER_RANGE}`.evidence` is `null` and the preflight says so
 * out loud. A range is a necessary condition (a worker outside it is refused);
 * it is never sufficient evidence of compatibility.
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

/** Half-open semver range `[minInclusive, maxExclusive)` over stable releases. */
export const DECLARED_WORKER_RANGE = {
  minInclusive: "0.6.0",
  maxExclusive: "0.7.0",
  /**
   * `null` until a tagged OMES worker release has been compared against the
   * vendored contract. Do not fill this in without a link to that release.
   */
  evidence: null as string | null
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
