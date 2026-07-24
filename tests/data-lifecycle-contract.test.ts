/**
 * Contract/parity tests for `data_lifecycle` — cheap no-DB guards that keep the
 * sources of truth aligned: the module descriptor's permission catalog, the
 * permission-seed migration (sql/056), the SoD rule, and the OpenAPI contract.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import { dataLifecycleModule } from "../src/modules/data-lifecycle/module";
import { DATA_LIFECYCLE_PERMISSIONS } from "../src/modules/data-lifecycle/domain/data-lifecycle-permissions";

const ROOT = join(import.meta.dir, "..");

function permKey(activityCode: string, action: string): string {
  return `${dataLifecycleModule.key}.${activityCode}.${action}`;
}

describe("descriptor <-> permission seed parity", () => {
  test("module.ts permissions exactly match sql/056 seed", () => {
    const seed = readFileSync(
      join(ROOT, "sql/056_awcms_data_lifecycle_permissions.sql"),
      "utf8"
    );
    const seededKeys = new Set(
      [...seed.matchAll(/\('data_lifecycle',\s*'([^']+)',\s*'([^']+)'/g)].map(
        (m) => permKey(m[1]!, m[2]!)
      )
    );
    const descriptorKeys = new Set(
      (dataLifecycleModule.permissions ?? []).map((p) =>
        permKey(p.activityCode, p.action)
      )
    );

    expect([...descriptorKeys].sort()).toEqual([...seededKeys].sort());
    expect(descriptorKeys.size).toBe(6);
  });

  test("DATA_LIFECYCLE_PERMISSIONS constants match the descriptor permission keys", () => {
    const constants: string[] = Object.values(DATA_LIFECYCLE_PERMISSIONS);
    const descriptorKeys = (dataLifecycleModule.permissions ?? []).map((p) =>
      permKey(p.activityCode, p.action)
    );
    expect([...constants].sort()).toEqual([...descriptorKeys].sort());
  });

  test("legal_hold.create and legal_hold.release are distinct keys (default-deny release)", () => {
    expect(DATA_LIFECYCLE_PERMISSIONS.legalHoldCreate).not.toBe(
      DATA_LIFECYCLE_PERMISSIONS.legalHoldRelease
    );
  });
});

describe("module descriptor shape", () => {
  test("System Foundation module with the expected deps + basePath", () => {
    expect(dataLifecycleModule.type).toBe("system");
    expect(dataLifecycleModule.dependencies).toEqual([
      "tenant_admin",
      "identity_access",
      "logging"
    ]);
    expect(dataLifecycleModule.api?.basePath).toBe("/api/v1/data-lifecycle");
  });

  test("owns exactly one generic dataLifecycle descriptor (its own run-history table)", () => {
    const own = dataLifecycleModule.dataLifecycle ?? [];
    expect(own).toHaveLength(1);
    expect(own[0]!.key).toBe("data_lifecycle.data_lifecycle_runs");
    expect(own[0]!.tableName).toBe("awcms_data_lifecycle_runs");
    expect(own[0]!.executionMode).toBe("generic");
    expect(own[0]!.legalHold).toEqual({
      applicable: true,
      precedence: "overrides_retention"
    });
  });

  test("declares the archive-purge job", () => {
    const commands = (dataLifecycleModule.jobs ?? []).map((j) => j.command);
    expect(commands).toContain("bun run data-lifecycle:archive-purge");
  });

  test("SoD maker/checker rule over legal_hold create vs release", () => {
    const rules = dataLifecycleModule.sodRules ?? [];
    expect(rules).toHaveLength(1);
    const rule = rules[0]!;
    expect(rule.ruleKey).toBe("data_lifecycle.legal_hold_maker_checker");
    expect(rule.ownerModuleKey).toBe("data_lifecycle");
    expect(new Set(rule.conflictingPermissionKeys)).toEqual(
      new Set([
        "data_lifecycle.legal_hold.create",
        "data_lifecycle.legal_hold.release"
      ])
    );
    expect(rule.severity).toBe("critical");
    expect(rule.exceptionPolicy.requiresApprovalPermission).toBe(
      "identity_access.business_scope_exceptions.approve"
    );
  });
});

describe("OpenAPI contract", () => {
  const bundle = readFileSync(
    join(ROOT, "openapi/awcms-public-api.openapi.yaml"),
    "utf8"
  );

  test("the bundled spec declares every data-lifecycle route path", () => {
    for (const path of [
      "/api/v1/data-lifecycle/registry",
      "/api/v1/data-lifecycle/dry-run",
      "/api/v1/data-lifecycle/runs",
      "/api/v1/data-lifecycle/legal-holds",
      "/api/v1/data-lifecycle/legal-holds/{id}/release"
    ]) {
      expect(bundle).toContain(`${path}:`);
    }
  });

  test("real archive/purge is NOT exposed over HTTP", () => {
    expect(bundle).not.toContain("/api/v1/data-lifecycle/archive-purge");
    expect(bundle).not.toContain("/api/v1/data-lifecycle/purge");
  });

  test("mutation operations declare their operationIds", () => {
    for (const opId of [
      "dataLifecycleRegistryList",
      "dataLifecycleDryRunCreate",
      "dataLifecycleRunsList",
      "dataLifecycleLegalHoldsList",
      "dataLifecycleLegalHoldsCreate",
      "dataLifecycleLegalHoldsRelease"
    ]) {
      expect(bundle).toContain(`operationId: ${opId}`);
    }
  });
});
