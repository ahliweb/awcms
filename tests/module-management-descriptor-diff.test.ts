import { describe, expect, test } from "bun:test";

import { planModuleSync } from "../src/modules/module-management/domain/descriptor-diff";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";

function descriptor(
  overrides: Partial<ModuleDescriptor> = {}
): ModuleDescriptor {
  return {
    key: "example",
    name: "Example",
    version: "1.0.0",
    status: "active",
    description: "An example module.",
    dependencies: [],
    ...overrides
  };
}

describe("planModuleSync", () => {
  test("a descriptor with no existing row is a create", () => {
    const plan = planModuleSync([descriptor()], []);

    expect(plan.entries).toEqual([
      { moduleKey: "example", action: "create", changedFields: [] }
    ]);
    expect(plan.orphanedModuleKeys).toEqual([]);
  });

  test("a descriptor identical to its existing row is unchanged", () => {
    const plan = planModuleSync(
      [descriptor()],
      [
        {
          moduleKey: "example",
          moduleName: "Example",
          version: "1.0.0",
          description: "An example module.",
          lifecycleStatus: "active",
          moduleType: null,
          isCore: false
        }
      ]
    );

    expect(plan.entries).toEqual([
      { moduleKey: "example", action: "unchanged", changedFields: [] }
    ]);
  });

  test("a version bump is reported as an update with the changed field named", () => {
    const plan = planModuleSync(
      [descriptor({ version: "2.0.0" })],
      [
        {
          moduleKey: "example",
          moduleName: "Example",
          version: "1.0.0",
          description: "An example module.",
          lifecycleStatus: "active",
          moduleType: null,
          isCore: false
        }
      ]
    );

    expect(plan.entries).toEqual([
      { moduleKey: "example", action: "update", changedFields: ["version"] }
    ]);
  });

  test("multiple changed fields are all reported", () => {
    const plan = planModuleSync(
      [descriptor({ name: "Renamed", status: "maintenance", type: "system" })],
      [
        {
          moduleKey: "example",
          moduleName: "Example",
          version: "1.0.0",
          description: "An example module.",
          lifecycleStatus: "active",
          moduleType: null,
          isCore: false
        }
      ]
    );

    expect(plan.entries[0]!.action).toBe("update");
    expect(plan.entries[0]!.changedFields.sort()).toEqual(
      ["name", "status", "type"].sort()
    );
  });

  test("a DB row with no matching descriptor is reported as orphaned", () => {
    const plan = planModuleSync(
      [],
      [
        {
          moduleKey: "gone",
          moduleName: "Gone",
          version: "1.0.0",
          description: null,
          lifecycleStatus: "active",
          moduleType: null,
          isCore: false
        }
      ]
    );

    expect(plan.entries).toEqual([]);
    expect(plan.orphanedModuleKeys).toEqual(["gone"]);
  });

  test("running the plan twice with the same inputs is stable (idempotent)", () => {
    const descriptors = [descriptor()];
    const existing = [
      {
        moduleKey: "example",
        moduleName: "Example",
        version: "1.0.0",
        description: "An example module.",
        lifecycleStatus: "active",
        moduleType: null,
        isCore: false
      }
    ];

    const first = planModuleSync(descriptors, existing);
    const second = planModuleSync(descriptors, existing);

    expect(first).toEqual(second);
    expect(first.entries[0]!.action).toBe("unchanged");
  });
});
