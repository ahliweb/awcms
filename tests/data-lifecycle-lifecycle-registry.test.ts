/**
 * Unit tests for the high-volume table registry validator
 * (`domain/lifecycle-registry.ts`). Pure code, no DB. Also validates the REAL
 * base registry (`listModules()`) so registry drift makes this — and CI — red,
 * duplicating the `bun run data-lifecycle:registry:check` gate at the test tier.
 */
import { describe, expect, test } from "bun:test";

import type {
  HighVolumeTableDescriptor,
  ModuleDescriptor
} from "../src/modules/_shared/module-contract";
import {
  MAX_LIFECYCLE_BATCH_LIMIT,
  collectHighVolumeTableDescriptors,
  validateLifecycleRegistry
} from "../src/modules/data-lifecycle/domain/lifecycle-registry";
import { listModules } from "../src/modules";

function baseDescriptor(): HighVolumeTableDescriptor {
  return {
    key: "sample.rows",
    tableName: "awcms_sample_rows",
    ownerModuleKey: "sample",
    scope: "tenant",
    cursorColumn: "created_at",
    retentionClass: "operational_queue",
    retentionMinDays: 30,
    retentionMaxDays: 365,
    defaultRetentionDays: 90,
    partition: { eligible: false, rationale: "low volume" },
    archive: { archivable: false, rationale: "nothing to archive" },
    deletion: { mode: "hard_delete", rationale: "no PII" },
    legalHold: { applicable: true, precedence: "overrides_retention" },
    requiredIndexes: [
      { columns: ["tenant_id", "created_at"], purpose: "purge scan" }
    ],
    batchLimit: 5000,
    backupRestoreNotes: "ordinary backup",
    executionMode: "delegated",
    existingAdopter: {
      purgeFunctionRef: "src/modules/sample/x.ts#purge",
      description: "adopts existing purge"
    }
  };
}

function moduleWith(
  descriptors: HighVolumeTableDescriptor[],
  key = "sample"
): ModuleDescriptor {
  return {
    key,
    name: key,
    version: "0.0.0",
    status: "active",
    description: key,
    dependencies: [],
    dataLifecycle: descriptors
  };
}

describe("validateLifecycleRegistry — the real base registry", () => {
  test("every registered descriptor is valid (mirrors the CI gate)", () => {
    const result = validateLifecycleRegistry(listModules());
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("collectHighVolumeTableDescriptors returns the three known adopters", () => {
    const keys = collectHighVolumeTableDescriptors(listModules()).map(
      (d) => d.key
    );
    expect(keys).toContain("data_lifecycle.data_lifecycle_runs");
    expect(keys).toContain("logging.audit_events");
    expect(keys).toContain("visitor_analytics.visit_events");
  });
});

describe("validateLifecycleRegistry — rejects bad descriptors", () => {
  test("accepts a well-formed synthetic descriptor", () => {
    expect(
      validateLifecycleRegistry([moduleWith([baseDescriptor()])]).valid
    ).toBe(true);
  });

  test("rejects ownerModuleKey that does not match the declaring module", () => {
    const d = { ...baseDescriptor(), ownerModuleKey: "someone_else" };
    const result = validateLifecycleRegistry([moduleWith([d])]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /ownerModuleKey/.test(i.message))).toBe(
      true
    );
  });

  test("rejects legalHold.applicable:true without precedence overrides_retention (cannot be declared away)", () => {
    const d: HighVolumeTableDescriptor = {
      ...baseDescriptor(),
      legalHold: { applicable: true, precedence: "not_applicable" }
    };
    const result = validateLifecycleRegistry([moduleWith([d])]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /precedence/.test(i.message))).toBe(true);
  });

  test("rejects an unbounded batchLimit", () => {
    const d = {
      ...baseDescriptor(),
      batchLimit: MAX_LIFECYCLE_BATCH_LIMIT + 1
    };
    const result = validateLifecycleRegistry([moduleWith([d])]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /batchLimit/.test(i.message))).toBe(true);
  });

  test("rejects retention bounds out of order", () => {
    const d = {
      ...baseDescriptor(),
      retentionMinDays: 100,
      defaultRetentionDays: 50,
      retentionMaxDays: 365
    };
    const result = validateLifecycleRegistry([moduleWith([d])]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /retention bounds/.test(i.message))).toBe(
      true
    );
  });

  test("a generic tenant descriptor must declare a tenant+cursor composite index", () => {
    const d: HighVolumeTableDescriptor = {
      ...baseDescriptor(),
      executionMode: "generic",
      existingAdopter: undefined,
      requiredIndexes: [{ columns: ["some_other_col"], purpose: "unrelated" }]
    };
    const result = validateLifecycleRegistry([moduleWith([d])]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => /requiredIndexes must include/.test(i.message))
    ).toBe(true);
  });

  test("generic must NOT also declare existingAdopter", () => {
    const d: HighVolumeTableDescriptor = {
      ...baseDescriptor(),
      executionMode: "generic"
      // still carries existingAdopter from baseDescriptor()
    };
    const result = validateLifecycleRegistry([moduleWith([d])]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) =>
        /must not also declare existingAdopter/.test(i.message)
      )
    ).toBe(true);
  });

  test("delegated must declare existingAdopter.purgeFunctionRef", () => {
    const d: HighVolumeTableDescriptor = {
      ...baseDescriptor(),
      existingAdopter: undefined
    };
    const result = validateLifecycleRegistry([moduleWith([d])]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => /delegated/.test(i.message))).toBe(true);
  });

  test("rejects a duplicate key / tableName across modules", () => {
    const a = moduleWith([baseDescriptor()], "sample");
    const bDesc = { ...baseDescriptor(), ownerModuleKey: "sample_two" };
    const b = moduleWith([bDesc], "sample_two");
    const result = validateLifecycleRegistry([a, b]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) =>
        /registered .* times|declared by exactly one/.test(i.message)
      )
    ).toBe(true);
  });

  test("rejects a non-awcms_ tableName", () => {
    const d = { ...baseDescriptor(), tableName: "public_rows" };
    const result = validateLifecycleRegistry([moduleWith([d])]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => /tableName must start with/.test(i.message))
    ).toBe(true);
  });
});
