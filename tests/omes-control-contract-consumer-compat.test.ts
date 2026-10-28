/**
 * Issue #1185 - consumer compatibility conformance for the vendored OMES
 * worker contract (`omes/contracts/control-center/v1`).
 *
 * Pins the vendored snapshot by commit and aggregate digest, declares the
 * supported worker range, and proves the consumer fails CLOSED on an unknown,
 * missing, future or mismatched version, and on an unknown capability. The
 * four signed worker routes are exercised with a synthetic Ed25519 worker.
 *
 * No network, no database. What this file does NOT prove (DB-backed FORCE RLS
 * and ABAC for the worker tables, nonce persistence, and any real tagged OMES
 * worker release) is listed in the omes-control README section "Worker
 * contract compatibility".
 */
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  DECLARED_CONTRACT,
  DECLARED_WORKER_RANGE,
  SUPPORTED_WORKER_CAPABILITIES,
  aggregateContractDigest,
  evaluateWorkerCompatibility,
  parseStableSemver
} from "../src/modules/omes-control/domain/contracts/compatibility";
import {
  SUPPORTED_OMES_CONTRACT_VERSIONS,
  UnsupportedContractVersionError,
  validateOmesContract,
  validateOmesContractText
} from "../src/modules/omes-control/domain/contracts";
import {
  buildCanonicalEnvelope,
  checkEnvelopeFreshness,
  verifyEd25519Signature
} from "../src/modules/omes-control/domain/worker-identity";
import {
  REQUIRED_WORKER_PATHS,
  runOmesContractPreflight
} from "../scripts/omes-contract-preflight";
import { VENDORED_CONTRACTS_DIR } from "../scripts/sync-omes-contracts";

const ROOT = path.join(import.meta.dir, "..");
const PIN_FILE = path.join(ROOT, VENDORED_CONTRACTS_DIR, "PIN.json");
const pin = JSON.parse(readFileSync(PIN_FILE, "utf8")) as {
  sourceCommit: string;
  version: string;
  files: Record<string, string>;
};

const GOOD_WORKER = {
  contract_version: "v1",
  omes_version: "0.6.0",
  contract_digest: DECLARED_CONTRACT.aggregateDigest,
  capabilities: ["status", "preflight"]
};

describe("pinned contract identity", () => {
  test("vendored PIN matches the release's hand-declared commit and digest", () => {
    expect(pin.version).toBe(DECLARED_CONTRACT.version);
    expect(pin.sourceCommit).toBe(DECLARED_CONTRACT.sourceCommit);
    expect(aggregateContractDigest(pin.files)).toBe(
      DECLARED_CONTRACT.aggregateDigest
    );
  });

  test("the aggregate digest is order independent and content sensitive", () => {
    const reversed = Object.fromEntries(Object.entries(pin.files).reverse());
    expect(aggregateContractDigest(reversed)).toBe(
      DECLARED_CONTRACT.aggregateDigest
    );
    const [first] = Object.keys(pin.files);
    expect(
      aggregateContractDigest({ ...pin.files, [first!]: "0".repeat(64) })
    ).not.toBe(DECLARED_CONTRACT.aggregateDigest);
    expect(aggregateContractDigest({})).not.toBe(
      DECLARED_CONTRACT.aggregateDigest
    );
  });

  test("the consumer only supports contract v1", () => {
    expect([...SUPPORTED_OMES_CONTRACT_VERSIONS]).toEqual(["v1"]);
  });

  test("future/unknown contract majors are rejected before any schema is read", async () => {
    for (const version of ["v2", "v0", "main", "", "V1"]) {
      await expect(
        validateOmesContract("worker-poll.request", {}, { version })
      ).rejects.toBeInstanceOf(UnsupportedContractVersionError);
    }
  });
});

describe("worker version range (fail closed)", () => {
  test("the declared range has no tagged-release evidence recorded", () => {
    // Flip this only together with a link to the real tagged OMES release.
    expect(DECLARED_WORKER_RANGE.evidence).toBeNull();
  });

  test("a worker inside the range with the declared digest is compatible", () => {
    expect(evaluateWorkerCompatibility(GOOD_WORKER).status).toBe("compatible");
    expect(
      evaluateWorkerCompatibility(
        { ...GOOD_WORKER, omes_version: "v0.6.9" },
        { requireDigest: true }
      ).status
    ).toBe("compatible");
  });

  test.each([
    ["below the range", { omes_version: "0.5.9" }],
    ["at the exclusive upper bound", { omes_version: "0.7.0" }],
    ["future major", { omes_version: "1.0.0" }],
    ["pre-release", { omes_version: "0.6.0-rc.1" }],
    ["build metadata", { omes_version: "0.6.0+abc" }],
    ["not a version", { omes_version: "latest" }],
    ["missing version", { omes_version: undefined }],
    ["numeric version", { omes_version: 0.6 }],
    ["unknown contract major", { contract_version: "v2" }],
    ["missing contract version", { contract_version: undefined }],
    ["wrong digest", { contract_digest: "f".repeat(64) }]
  ])("%s is incompatible", (_name, override) => {
    const verdict = evaluateWorkerCompatibility({
      ...GOOD_WORKER,
      ...override
    });
    expect(verdict.status).toBe("incompatible");
  });

  test("a missing digest is refused only when it is required", () => {
    const { contract_digest: _omit, ...noDigest } = GOOD_WORKER;
    expect(evaluateWorkerCompatibility(noDigest).status).toBe("compatible");
    expect(
      evaluateWorkerCompatibility(noDigest, { requireDigest: true }).status
    ).toBe("incompatible");
  });

  test.each([[null], [undefined], ["v1"], [1], [[]], [[GOOD_WORKER]]])(
    "a non-object descriptor (%p) is incompatible",
    (d) => {
      expect(evaluateWorkerCompatibility(d).status).toBe("incompatible");
    }
  );

  test("an unknown capability is unsupported_capability, never a guessed success", () => {
    const verdict = evaluateWorkerCompatibility({
      ...GOOD_WORKER,
      capabilities: ["status", "format-disk"]
    });
    expect(verdict.status).toBe("unsupported_capability");
    expect(
      evaluateWorkerCompatibility({ ...GOOD_WORKER, capabilities: "status" })
        .status
    ).toBe("incompatible");
    expect(
      evaluateWorkerCompatibility({ ...GOOD_WORKER, capabilities: [1] }).status
    ).toBe("incompatible");
    expect(SUPPORTED_WORKER_CAPABILITIES.has("format-disk")).toBe(false);
  });

  test("semver parsing is strict", () => {
    expect(parseStableSemver("0.6.0")).toEqual({
      major: 0,
      minor: 6,
      patch: 0
    });
    for (const bad of ["0.6", "01.6.0", "0.6.0.1", " ", "0.6.x", null]) {
      expect(parseStableSemver(bad)).toBeNull();
    }
  });
});

describe("worker round trip against a synthetic worker", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({
    type: "spki",
    format: "pem"
  }) as string;
  const sign = (data: string) =>
    cryptoSign(null, Buffer.from(data, "utf8"), privateKey).toString("base64");

  const tenantId = "11111111-1111-4111-8111-111111111111";
  const now = new Date("2026-10-27T00:00:00Z");
  const envelope = (route: string, rawBody: string, nonce: string) => ({
    method: "POST",
    path: `/api/v1/omes/worker/${route}`,
    tenantId,
    serverId: "srv-1",
    workerId: "worker_1",
    timestamp: now.toISOString(),
    nonce,
    rawBody
  });

  const fixture = (schema: string) =>
    readFileSync(
      path.join(
        ROOT,
        VENDORED_CONTRACTS_DIR,
        "fixtures",
        schema,
        "valid-01.json"
      ),
      "utf8"
    );

  const routes: Array<[string, string]> = [
    ["enroll", "worker-enrollment.request"],
    ["poll", "worker-poll.request"],
    ["result", "worker-result.request"],
    ["heartbeat", "worker-heartbeat.request"]
  ];

  test.each(routes)(
    "%s: the pinned valid fixture validates and its signature verifies",
    async (route, schema) => {
      const body = fixture(schema);
      expect(await validateOmesContractText(schema, body)).toEqual([]);
      const canonical = buildCanonicalEnvelope(
        envelope(route, body, "nonce_0123456789abcdef")
      );
      expect(
        verifyEd25519Signature(publicKeyPem, canonical, sign(canonical))
      ).toBe(true);
    }
  );

  test.each(routes)(
    "%s: a signature is bound to path, body, nonce, tenant and worker",
    (route, schema) => {
      const body = fixture(schema);
      const nonce = "nonce_0123456789abcdef";
      const sig = sign(buildCanonicalEnvelope(envelope(route, body, nonce)));
      const base = envelope(route, body, nonce);
      const tampered = [
        { ...base, path: "/api/v1/omes/worker/other" },
        { ...base, rawBody: `${body} ` },
        { ...base, nonce: "nonce_ffffffffffffffff" },
        { ...base, tenantId: "22222222-2222-4222-8222-222222222222" },
        { ...base, workerId: "worker_2" },
        { ...base, serverId: "srv-2" }
      ];
      for (const t of tampered) {
        expect(
          verifyEd25519Signature(publicKeyPem, buildCanonicalEnvelope(t), sig)
        ).toBe(false);
      }
    }
  );

  test("a replayed envelope outside the window is stale; a future one too", () => {
    expect(checkEnvelopeFreshness(now.toISOString(), now).fresh).toBe(true);
    const later = new Date(now.getTime() + 10 * 60 * 1000);
    expect(checkEnvelopeFreshness(now.toISOString(), later)).toEqual({
      fresh: false,
      reason: "outside_window"
    });
    expect(checkEnvelopeFreshness(later.toISOString(), now).fresh).toBe(false);
  });

  test("a worker sending an extra (unsigned-field) body property is rejected by the pinned schema", async () => {
    for (const [, schema] of routes) {
      const body = JSON.parse(fixture(schema)) as Record<string, unknown>;
      body.signature = "x".repeat(32);
      const errors = await validateOmesContract(schema, body as never);
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});

describe("deploy preflight (scripts/omes-contract-preflight.ts)", () => {
  function scratchRoot(mutate?: (root: string) => void) {
    const root = mkdtempSync(path.join(tmpdir(), "omes-preflight-"));
    cpSync(
      path.join(ROOT, VENDORED_CONTRACTS_DIR),
      path.join(root, VENDORED_CONTRACTS_DIR),
      { recursive: true }
    );
    mutate?.(root);
    return root;
  }
  const openApiText = REQUIRED_WORKER_PATHS.map((p) => `  ${p}:\n`).join("");

  test("the real checkout passes", () => {
    const r = runOmesContractPreflight(ROOT, {});
    expect(r.failures).toEqual([]);
  });

  test("an untouched copy passes; a worker is evaluated with the same rules", () => {
    const root = scratchRoot();
    try {
      expect(runOmesContractPreflight(root, { openApiText }).failures).toEqual(
        []
      );
      const ok = runOmesContractPreflight(root, {
        openApiText,
        workerDescriptor: GOOD_WORKER
      });
      expect(ok.failures).toEqual([]);
      expect(ok.notes.join(" ")).toContain("no tagged-release evidence");
      const bad = runOmesContractPreflight(root, {
        openApiText,
        workerDescriptor: { ...GOOD_WORKER, contract_version: "v2" }
      });
      expect(bad.failures.join(" ")).toContain("unsupported_contract_version");
      const cap = runOmesContractPreflight(root, {
        openApiText,
        workerDescriptor: { ...GOOD_WORKER, capabilities: ["wipe"] }
      });
      expect(cap.failures.join(" ")).toContain("unsupported_capability");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a hand-edited vendored schema is refused (drift)", () => {
    const root = scratchRoot((r) =>
      writeFileSync(
        path.join(r, VENDORED_CONTRACTS_DIR, "worker-poll.request.schema.json"),
        "{}\n"
      )
    );
    try {
      const r = runOmesContractPreflight(root, { openApiText });
      expect(r.failures.join(" ")).toContain("does not match the PIN");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a re-synced PIN (new commit + rehashed files) is still refused until compatibility.ts is edited", () => {
    const root = scratchRoot((r) => {
      const pinPath = path.join(r, VENDORED_CONTRACTS_DIR, "PIN.json");
      const schemaPath = path.join(
        r,
        VENDORED_CONTRACTS_DIR,
        "worker-poll.request.schema.json"
      );
      const text = `${readFileSync(schemaPath, "utf8")}\n`;
      writeFileSync(schemaPath, text);
      const p = JSON.parse(readFileSync(pinPath, "utf8"));
      p.sourceCommit = "b".repeat(40);
      p.files["worker-poll.request.schema.json"] = new Bun.CryptoHasher(
        "sha256"
      )
        .update(text)
        .digest("hex");
      writeFileSync(pinPath, JSON.stringify(p, null, 2));
    });
    try {
      const r = runOmesContractPreflight(root, { openApiText });
      const joined = r.failures.join("\n");
      expect(joined).toContain("sourceCommit");
      expect(joined).toContain("aggregate contract digest");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a missing PIN or missing OpenAPI worker route is refused", () => {
    const root = scratchRoot((r) =>
      rmSync(path.join(r, VENDORED_CONTRACTS_DIR, "PIN.json"))
    );
    try {
      expect(
        runOmesContractPreflight(root, { openApiText }).failures.length
      ).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    const r = runOmesContractPreflight(ROOT, { openApiText: "paths:\n" });
    expect(r.failures.length).toBe(REQUIRED_WORKER_PATHS.length);
  });
});
