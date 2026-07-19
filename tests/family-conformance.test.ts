/**
 * Semantic family-conformance contract tests (Issue #183, epic #177, ADR-0032).
 *
 * These are NOT byte-equality checks against awcms-mini. Each pins a SEMANTIC
 * behaviour of a reusable control to the family contract and is
 * MUTATION-PROVABLE: a weakening of default-deny/RLS/redaction/audit/
 * idempotency/envelope/migration-immutability makes at least one assertion here
 * (or the `family:conformance:check` gate) go RED. No database and no network —
 * the DB-dependent half (tenant-context fail-closed under RLS) lives in
 * `tests/family-conformance-db.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { created, fail, ok } from "../src/modules/_shared/api-response";
import {
  FAMILY_CONTRACT_VERSION,
  MANIFEST_SCHEMA_VERSION,
  validateFamilyManifestShape,
  type FamilyCompatibilityManifest
} from "../src/modules/_shared/family-contract";
import { computeRequestHash } from "../src/modules/_shared/idempotency";
import {
  MODULE_CONTRACT_VERSION,
  type ModuleDescriptor
} from "../src/modules/_shared/module-contract";
import {
  redactSecretsInText,
  redactSensitiveAttributes
} from "../src/modules/_shared/redaction";
import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";
import { listBaseModules } from "../src/modules";
import { composeModuleRegistry } from "../src/modules/module-management/domain/module-composition";
import {
  computeMigrationChecksum,
  validateAppliedChecksums,
  type AppliedMigration,
  type MigrationFile
} from "../scripts/db-migrate";
import {
  assertEvidenceReportSecretFree,
  buildEvidenceReport,
  collectFamilyConformanceChecks,
  gatherActuals,
  loadManifest,
  type EvidenceCheck
} from "../scripts/family-conformance-check";

const NOW = new Date("2026-07-19T00:00:00.000Z");

function loadValidManifest(): FamilyCompatibilityManifest {
  const raw = loadManifest();
  expect(validateFamilyManifestShape(raw, NOW)).toEqual([]);
  return raw as FamilyCompatibilityManifest;
}

function failedChecks(checks: EvidenceCheck[]): EvidenceCheck[] {
  return checks.filter((check) => check.status === "fail");
}

describe("family conformance — committed manifest is valid and matches source", () => {
  test("the real manifest passes schema validation", () => {
    expect(validateFamilyManifestShape(loadManifest(), NOW)).toEqual([]);
  });

  test("every contract/stack check passes against the real toolchain", () => {
    const manifest = loadValidManifest();
    const checks = collectFamilyConformanceChecks(manifest, gatherActuals(NOW));
    expect(failedChecks(checks)).toEqual([]);
    expect(checks.length).toBeGreaterThan(20);
  });

  test("manifest pins the real MODULE_CONTRACT_VERSION and capability versions", () => {
    const manifest = loadValidManifest();
    expect(manifest.contracts.moduleDescriptorContractVersion).toBe(
      MODULE_CONTRACT_VERSION
    );
    expect(manifest.contracts.capabilityContractVersions).toEqual({
      ...CAPABILITY_CONTRACT_VERSIONS
    });
    expect(manifest.familyContractVersion).toBe(FAMILY_CONTRACT_VERSION);
    expect(manifest.manifestSchemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
  });
});

describe("family conformance — schema mutations turn the gate RED", () => {
  test("envelope contract-version drift fails a check", () => {
    const manifest = structuredClone(loadValidManifest());
    manifest.contracts.apiResponseEnvelopeVersion = "9.9.9";
    const checks = collectFamilyConformanceChecks(manifest, gatherActuals(NOW));
    expect(failedChecks(checks).length).toBeGreaterThan(0);
  });

  test("module descriptor version drift fails a check", () => {
    const manifest = structuredClone(loadValidManifest());
    manifest.contracts.moduleDescriptorContractVersion = "0.0.1";
    const checks = collectFamilyConformanceChecks(manifest, gatherActuals(NOW));
    expect(
      failedChecks(checks).some((c) => c.name.includes("module descriptor"))
    ).toBe(true);
  });

  test("stack version drift (Astro) fails a check", () => {
    const manifest = structuredClone(loadValidManifest());
    manifest.stack.astro.declared = "^6.0.0";
    const checks = collectFamilyConformanceChecks(manifest, gatherActuals(NOW));
    expect(failedChecks(checks).some((c) => c.name.includes("Astro"))).toBe(
      true
    );
  });

  test("removing the minimum-supported CI cell fails a check (F1 AC)", () => {
    const manifest = loadValidManifest();
    // Simulate ci.yml losing its Bun-1.3.0 minimum-supported job: only the
    // current pin remains in CI. The gate must flag that CI no longer runs the
    // declared floor.
    const actuals = {
      ...gatherActuals(NOW),
      stack: { ...gatherActuals(NOW).stack, bunCiVersions: ["1.3.14"] }
    };
    const checks = collectFamilyConformanceChecks(manifest, actuals);
    expect(
      failedChecks(checks).some((c) =>
        c.name.includes("CI runs exactly {current, minimum-supported}")
      )
    ).toBe(true);
  });

  test("a ciMinimum that isn't the engines floor fails a check", () => {
    const manifest = structuredClone(loadValidManifest());
    manifest.stack.bun.ciMinimum.declared = "1.3.7"; // not the >=1.3.0 floor
    const checks = collectFamilyConformanceChecks(manifest, gatherActuals(NOW));
    expect(
      failedChecks(checks).some((c) =>
        c.name.includes("ciMinimum equals engines floor")
      )
    ).toBe(true);
  });

  test("a capability version drift fails a check", () => {
    const manifest = structuredClone(loadValidManifest());
    manifest.contracts.capabilityContractVersions.party_directory = "2.0.0";
    const checks = collectFamilyConformanceChecks(manifest, gatherActuals(NOW));
    expect(
      failedChecks(checks).some((c) => c.name.includes("party_directory"))
    ).toBe(true);
  });

  test("a missing ADR for a divergence fails a check", () => {
    const manifest = loadValidManifest();
    const actuals = { ...gatherActuals(NOW), adrExists: () => false };
    const checks = collectFamilyConformanceChecks(manifest, actuals);
    expect(
      failedChecks(checks).some((c) => c.name.includes("ADR present"))
    ).toBe(true);
  });

  test("JSON-schema required-keys drift fails a check", () => {
    const manifest = loadValidManifest();
    const actuals = {
      ...gatherActuals(NOW),
      schemaRequiredKeys: ["family", "stack"] // missing keys
    };
    const checks = collectFamilyConformanceChecks(manifest, actuals);
    expect(
      failedChecks(checks).some((c) => c.name.includes("required-keys parity"))
    ).toBe(true);
  });

  test("a duplicate divergence id is a schema problem", () => {
    const manifest = structuredClone(loadValidManifest());
    const dup = structuredClone(manifest.intentionalDivergences[0]!);
    manifest.intentionalDivergences.push(dup);
    const problems = validateFamilyManifestShape(manifest, NOW);
    expect(problems.some((p) => p.includes("duplicated"))).toBe(true);
  });

  test("a divergence with a past review date is a schema problem (expiry)", () => {
    const manifest = structuredClone(loadValidManifest());
    manifest.intentionalDivergences[0]!.reviewDate = "2020-01-01";
    const problems = validateFamilyManifestShape(manifest, NOW);
    expect(problems.some((p) => p.includes("in the past"))).toBe(true);
  });

  test("a divergence missing reason/owner is a schema problem", () => {
    const manifest = structuredClone(loadValidManifest());
    // @ts-expect-error deliberately break the contract for the mutation test
    delete manifest.intentionalDivergences[0]!.owner;
    const problems = validateFamilyManifestShape(manifest, NOW);
    expect(problems.some((p) => p.includes("owner"))).toBe(true);
  });
});

describe("family conformance — API response envelope semantic contract", () => {
  /** Family-pinned shape of a SUCCESS envelope. */
  function successEnvelopeProblems(body: unknown): string[] {
    const problems: string[] = [];
    if (typeof body !== "object" || body === null) return ["not an object"];
    const b = body as Record<string, unknown>;
    if (b.success !== true) problems.push("success must be true");
    if (!("data" in b)) problems.push("missing data");
    if (typeof b.meta !== "object" || b.meta === null)
      problems.push("missing meta");
    return problems;
  }
  /** Family-pinned shape of an ERROR envelope. */
  function errorEnvelopeProblems(body: unknown): string[] {
    const problems: string[] = [];
    if (typeof body !== "object" || body === null) return ["not an object"];
    const b = body as Record<string, unknown>;
    if (b.success !== false) problems.push("success must be false");
    const error = b.error as Record<string, unknown> | undefined;
    if (!error || typeof error !== "object") problems.push("missing error");
    else {
      if (typeof error.code !== "string") problems.push("missing error.code");
      if (typeof error.message !== "string")
        problems.push("missing error.message");
    }
    if (typeof b.meta !== "object" || b.meta === null)
      problems.push("missing meta");
    return problems;
  }

  test("ok/created produce the pinned success envelope", async () => {
    expect(successEnvelopeProblems(await ok({ id: 1 }).json())).toEqual([]);
    const createdRes = created({ id: 2 });
    expect(createdRes.status).toBe(201);
    expect(successEnvelopeProblems(await createdRes.json())).toEqual([]);
  });

  test("fail produces the pinned error envelope", async () => {
    const res = fail(403, "FORBIDDEN", "nope");
    expect(res.status).toBe(403);
    expect(errorEnvelopeProblems(await res.json())).toEqual([]);
  });

  test("shape demo: the envelope contract flags a drifted envelope", () => {
    // Not a production-code mutation — this exercises the SAME shape checker the
    // two tests above run on real `ok()`/`created()`/`fail()` output, on a
    // hand-drifted literal, to show the checker distinguishes the two (so the
    // `toEqual([])` assertions above are non-vacuous).
    expect(
      successEnvelopeProblems({ ok: true, payload: {} }).length
    ).toBeGreaterThan(0);
    expect(
      errorEnvelopeProblems({
        success: false,
        error: { message: "x" },
        meta: {}
      })
    ).toContain("missing error.code");
  });
});

describe("family conformance — redaction semantic contract (default-deny of secrets)", () => {
  const INPUT = {
    password: "hunter2",
    email: "user@example.com",
    apiKey: "sk-live-abc",
    note: "not sensitive"
  };

  function hasSensitiveLeak(
    output: Record<string, unknown>,
    sensitiveKeys: string[]
  ): boolean {
    return sensitiveKeys.some((key) => output[key] !== "[REDACTED]");
  }

  test("known-sensitive keys are redacted, benign keys preserved", () => {
    const output = redactSensitiveAttributes(INPUT)!;
    expect(hasSensitiveLeak(output, ["password", "email", "apiKey"])).toBe(
      false
    );
    expect(output.note).toBe("not sensitive");
  });

  test("free-text secrets (Bearer token, DSN) are redacted", () => {
    expect(
      redactSecretsInText("Authorization: Bearer abc.def.ghi")
    ).not.toContain("abc.def.ghi");
    expect(
      redactSecretsInText("postgres://user:s3cr3t@db:5432/awcms")
    ).not.toContain("s3cr3t");
  });

  test("the leak-checker distinguishes the REAL redactor from a weakened one", () => {
    // The load-bearing assertion binds PRODUCTION code: the real
    // `redactSensitiveAttributes` leaves NO sensitive key un-redacted. The
    // identity `weakened` is only an illustration of what the same leak-checker
    // reports when redaction is bypassed — it proves the checker isn't vacuous,
    // not anything about production code on its own.
    expect(
      hasSensitiveLeak(redactSensitiveAttributes(INPUT)!, [
        "password",
        "email",
        "apiKey"
      ])
    ).toBe(false); // real code: no leak
    const weakened = (input: Record<string, unknown>) => input; // illustration only
    expect(
      hasSensitiveLeak(weakened(INPUT), ["password", "email", "apiKey"])
    ).toBe(true); // the checker DOES catch a bypass
  });
});

describe("family conformance — idempotency semantic contract", () => {
  test("request hash is key-order stable and payload-sensitive", () => {
    expect(computeRequestHash({ a: 1, b: 2 })).toBe(
      computeRequestHash({ b: 2, a: 1 })
    );
    expect(computeRequestHash({ x: 1 })).not.toBe(computeRequestHash({ x: 2 }));
  });

  test("different payloads hash differently (why a collapsed hash misses conflicts)", () => {
    // Binds production code only: the real `computeRequestHash` MUST separate two
    // different payloads, otherwise the store's "key sama + hash beda -> 409"
    // conflict rule (doc 10) could never fire. (A constant hash would collapse
    // them — that's the failure mode this asserts against, no vacuous self-check.)
    expect(computeRequestHash({ x: 1 }) === computeRequestHash({ x: 2 })).toBe(
      false
    );
  });
});

describe("family conformance — migration immutability/checksum contract (no DB)", () => {
  test("checksum is deterministic and sha256-prefixed", () => {
    expect(computeMigrationChecksum("SELECT 1;")).toBe(
      computeMigrationChecksum("SELECT 1;")
    );
    expect(computeMigrationChecksum("SELECT 1;")).toMatch(
      /^sha256:[0-9a-f]{64}$/
    );
    expect(computeMigrationChecksum("A")).not.toBe(
      computeMigrationChecksum("B")
    );
  });

  test("an edit to an APPLIED migration is detectable (throws)", () => {
    const edited: MigrationFile = {
      name: "030_awcms_sod_permissions.sql",
      path: "sql/030_awcms_sod_permissions.sql",
      sql: "-- edited content",
      checksum: computeMigrationChecksum("-- edited content")
    };
    const applied: AppliedMigration[] = [
      {
        migration_name: "030_awcms_sod_permissions.sql",
        checksum: computeMigrationChecksum("-- original content")
      }
    ];
    expect(() => validateAppliedChecksums([edited], applied)).toThrow(
      /Checksum mismatch/
    );
  });

  test("control: matching checksums do NOT throw", () => {
    const unchanged: MigrationFile = {
      name: "030_awcms_sod_permissions.sql",
      path: "sql/030_awcms_sod_permissions.sql",
      sql: "-- original content",
      checksum: computeMigrationChecksum("-- original content")
    };
    const applied: AppliedMigration[] = [
      {
        migration_name: "030_awcms_sod_permissions.sql",
        checksum: computeMigrationChecksum("-- original content")
      }
    ];
    expect(() => validateAppliedChecksums([unchanged], applied)).not.toThrow();
  });
});

describe("family conformance — module composition semantic contract", () => {
  test("the base registry composes cleanly", () => {
    const result = composeModuleRegistry({ base: listBaseModules() });
    expect(result.valid).toBe(true);
  });

  test("MUTATION: a duplicate module key makes composition invalid (RED)", () => {
    const base = listBaseModules();
    const dupe = (): ModuleDescriptor => ({
      key: "conformance_dupe",
      name: "Conformance Dupe",
      version: "1.0.0",
      status: "active",
      description: "duplicate-key mutation fixture",
      dependencies: [],
      type: "domain"
    });
    const result = composeModuleRegistry({
      base,
      application: {
        id: "conformance-mutation-fixture",
        modules: [dupe(), dupe()] // two contributed modules share a key
      }
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.issues.some((issue) => issue.type === "duplicate_module_key")
      ).toBe(true);
    }
  });
});

describe("family conformance — evidence report is reproducible and secret-free", () => {
  test("the generated report exposes pass/fail per contract, no secrets", () => {
    const manifest = loadValidManifest();
    const checks = collectFamilyConformanceChecks(manifest, gatherActuals(NOW));
    const report = buildEvidenceReport(manifest, checks, NOW);
    expect(report.summary.failed).toBe(0);
    expect(report.checks.length).toBe(checks.length);
    expect(() => assertEvidenceReportSecretFree(report)).not.toThrow();
  });

  test("MUTATION: a report carrying a DSN-shaped value is refused", () => {
    const manifest = loadValidManifest();
    const report = buildEvidenceReport(
      manifest,
      [
        {
          name: "poisoned",
          status: "pass",
          detail: "postgres://user:pass@host:5432/db"
        }
      ],
      NOW
    );
    expect(() => assertEvidenceReportSecretFree(report)).toThrow(
      /connection-string/
    );
  });
});
