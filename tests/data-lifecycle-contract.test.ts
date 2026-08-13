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
import {
  SUBJECT_ERASURE_MAKER_CHECKER_RULE,
  SUBJECT_REQUEST_PERMISSIONS
} from "../src/modules/data-lifecycle/domain/subject-request-permissions";

const ROOT = join(import.meta.dir, "..");

function permKey(activityCode: string, action: string): string {
  return `${dataLifecycleModule.key}.${activityCode}.${action}`;
}

describe("descriptor <-> permission seed parity", () => {
  test("module.ts permissions exactly match the seed migrations", () => {
    // TWO seeds since ADR-0094 wave 2 (#557): sql/056 for the lifecycle engine,
    // sql/126 for the subject-rights surface. Read together rather than
    // asserting against one, because the failure this catches is a permission
    // declared in `module.ts` and seeded nowhere — which grants nothing, in
    // every tenant, silently.
    const seededKeys = new Set(
      [
        "sql/056_awcms_data_lifecycle_permissions.sql",
        "sql/126_awcms_subject_request_permissions.sql"
      ].flatMap((file) =>
        [
          ...readFileSync(join(ROOT, file), "utf8").matchAll(
            /\('data_lifecycle',\s*'([^']+)',\s*'([^']+)'/g
          )
        ].map((m) => permKey(m[1]!, m[2]!))
      )
    );
    const descriptorKeys = new Set(
      (dataLifecycleModule.permissions ?? []).map((p) =>
        permKey(p.activityCode, p.action)
      )
    );

    expect([...descriptorKeys].sort()).toEqual([...seededKeys].sort());
    expect(descriptorKeys.size).toBe(10);
  });

  test("both permission constant objects match the descriptor keys", () => {
    const constants: string[] = [
      ...Object.values(DATA_LIFECYCLE_PERMISSIONS),
      ...Object.values(SUBJECT_REQUEST_PERMISSIONS)
    ];
    const descriptorKeys = (dataLifecycleModule.permissions ?? []).map((p) =>
      permKey(p.activityCode, p.action)
    );
    expect([...constants].sort()).toEqual([...descriptorKeys].sort());
  });

  test("export and erasure are separate authorities (#557)", () => {
    // Issue #557: "Ekspor dan penghapusan bukan satu otoritas." Four distinct
    // keys, and the two erasure halves distinct from each other — a maker and
    // a checker sharing one key are one person doing both halves.
    const keys = new Set(Object.values(SUBJECT_REQUEST_PERMISSIONS));

    expect(keys.size).toBe(4);
    expect(SUBJECT_REQUEST_PERMISSIONS.export).not.toBe(
      SUBJECT_REQUEST_PERMISSIONS.erasureCreate
    );
    expect(SUBJECT_REQUEST_PERMISSIONS.erasureCreate).not.toBe(
      SUBJECT_REQUEST_PERMISSIONS.erasureApprove
    );
  });

  test("the erasure maker/checker rule names exactly those two keys", () => {
    const rule = (dataLifecycleModule.sodRules ?? []).find(
      (candidate) => candidate.ruleKey === SUBJECT_ERASURE_MAKER_CHECKER_RULE
    );

    expect(rule).toBeDefined();
    expect([...rule!.conflictingPermissionKeys].sort()).toEqual(
      [
        SUBJECT_REQUEST_PERMISSIONS.erasureCreate,
        SUBJECT_REQUEST_PERMISSIONS.erasureApprove
      ].sort()
    );
    expect(rule!.severity).toBe("critical");
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

  test("owns two generic dataLifecycle descriptors, both its own tables", () => {
    // Two since ADR-0094 wave 2 (#557) added `awcms_subject_requests`. The
    // module dogfoods the rule it enforces for everybody else, and BOTH are its
    // own tables — it still owns no other module's (ADR-0013 §6).
    const own = dataLifecycleModule.dataLifecycle ?? [];
    const byKey = new Map(own.map((entry) => [entry.key, entry]));

    expect([...byKey.keys()].sort()).toEqual([
      "data_lifecycle.data_lifecycle_runs",
      "data_lifecycle.subject_requests"
    ]);

    for (const entry of own) {
      expect(entry.ownerModuleKey).toBe("data_lifecycle");
      expect(entry.executionMode).toBe("generic");
      // Non-negotiable across every descriptor this module owns: a legal hold
      // must always beat ordinary retention.
      expect(entry.legalHold).toEqual({
        applicable: true,
        precedence: "overrides_retention"
      });
    }

    // The accountability record is held to an AUDIT retention floor, not the
    // operational one — a supervisory authority asking two years later must not
    // be told the record aged out.
    const requests = byKey.get("data_lifecycle.subject_requests")!;
    expect(requests.retentionClass).toBe("audit_security");
    expect(requests.retentionMinDays).toBeGreaterThanOrEqual(730);
  });

  test("declares the archive-purge job", () => {
    const commands = (dataLifecycleModule.jobs ?? []).map((j) => j.command);
    expect(commands).toContain("bun run data-lifecycle:archive-purge");
  });

  test("SoD maker/checker rule over legal_hold create vs release", () => {
    const rules = dataLifecycleModule.sodRules ?? [];
    // Two since #557 — the second is asserted in its own test above.
    expect(rules).toHaveLength(2);
    const rule = rules.find(
      (candidate) =>
        candidate.ruleKey === "data_lifecycle.legal_hold_maker_checker"
    )!;
    expect(rule).toBeDefined();
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
