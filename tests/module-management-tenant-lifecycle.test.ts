import { describe, expect, test } from "bun:test";

import {
  evaluateModuleDisable,
  evaluateModuleEnable,
  hasDependencyCycle
} from "../src/modules/module-management/domain/tenant-module-lifecycle";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";

function descriptor(
  overrides: Partial<ModuleDescriptor> = {}
): ModuleDescriptor {
  return {
    key: "a",
    name: "A",
    version: "1.0.0",
    status: "active",
    description: "Module A.",
    dependencies: [],
    ...overrides
  };
}

describe("hasDependencyCycle", () => {
  test("no cycle for a simple linear chain", () => {
    const a = descriptor({ key: "a", dependencies: ["b"] });
    const b = descriptor({ key: "b", dependencies: [] });

    expect(hasDependencyCycle("a", [a, b])).toBe(false);
  });

  test("detects a direct cycle (a depends on b, b depends on a)", () => {
    const a = descriptor({ key: "a", dependencies: ["b"] });
    const b = descriptor({ key: "b", dependencies: ["a"] });

    expect(hasDependencyCycle("a", [a, b])).toBe(true);
    expect(hasDependencyCycle("b", [a, b])).toBe(true);
  });

  test("detects an indirect cycle (a -> b -> c -> a)", () => {
    const a = descriptor({ key: "a", dependencies: ["b"] });
    const b = descriptor({ key: "b", dependencies: ["c"] });
    const c = descriptor({ key: "c", dependencies: ["a"] });

    expect(hasDependencyCycle("a", [a, b, c])).toBe(true);
  });

  test("no false positive when two modules share a common dependency (diamond)", () => {
    const a = descriptor({ key: "a", dependencies: ["b", "c"] });
    const b = descriptor({ key: "b", dependencies: ["d"] });
    const c = descriptor({ key: "c", dependencies: ["d"] });
    const d = descriptor({ key: "d", dependencies: [] });

    expect(hasDependencyCycle("a", [a, b, c, d])).toBe(false);
  });
});

describe("evaluateModuleEnable", () => {
  const baseInput = {
    target: descriptor({ key: "a", dependencies: [] }),
    targetTenantState: { moduleKey: "a", tenantEnabled: false },
    dependencyStates: [],
    allDescriptors: [descriptor({ key: "a", dependencies: [] })],
    currentAppVersion: "1.0.0"
  };

  test("rejects an unregistered module", () => {
    const result = evaluateModuleEnable({ ...baseInput, target: null });

    expect(result).toMatchObject({ valid: false, code: "MODULE_NOT_FOUND" });
  });

  test("rejects a globally-disabled module the same as not found", () => {
    const result = evaluateModuleEnable({
      ...baseInput,
      target: descriptor({ key: "a", status: "disabled" })
    });

    expect(result).toMatchObject({ valid: false, code: "MODULE_NOT_FOUND" });
  });

  test("rejects a module already enabled for the tenant", () => {
    const result = evaluateModuleEnable({
      ...baseInput,
      targetTenantState: { moduleKey: "a", tenantEnabled: true }
    });

    expect(result).toMatchObject({
      valid: false,
      code: "MODULE_ALREADY_ENABLED"
    });
  });

  test("rejects when a dependency descriptor cannot be found at all", () => {
    const result = evaluateModuleEnable({
      ...baseInput,
      dependencyStates: [{ descriptor: null, moduleKey: "missing" }]
    });

    expect(result).toMatchObject({
      valid: false,
      code: "MODULE_DEPENDENCY_MISSING"
    });
  });

  test("rejects when a dependency is globally disabled", () => {
    const result = evaluateModuleEnable({
      ...baseInput,
      dependencyStates: [
        {
          descriptor: descriptor({ key: "b", status: "disabled" }),
          tenantState: { moduleKey: "b", tenantEnabled: true }
        }
      ]
    });

    expect(result).toMatchObject({
      valid: false,
      code: "MODULE_DEPENDENCY_DISABLED"
    });
  });

  test("rejects when a dependency is disabled for this tenant", () => {
    const result = evaluateModuleEnable({
      ...baseInput,
      dependencyStates: [
        {
          descriptor: descriptor({ key: "b" }),
          tenantState: { moduleKey: "b", tenantEnabled: false }
        }
      ]
    });

    expect(result).toMatchObject({
      valid: false,
      code: "MODULE_DEPENDENCY_DISABLED"
    });
  });

  test("rejects a module that is part of a dependency cycle", () => {
    const a = descriptor({ key: "a", dependencies: ["b"] });
    const b = descriptor({ key: "b", dependencies: ["a"] });

    const result = evaluateModuleEnable({
      ...baseInput,
      target: a,
      dependencyStates: [
        {
          descriptor: b,
          tenantState: { moduleKey: "b", tenantEnabled: true }
        }
      ],
      allDescriptors: [a, b]
    });

    expect(result).toMatchObject({
      valid: false,
      code: "MODULE_DEPENDENCY_CYCLE"
    });
  });

  test("rejects when the module requires a newer app version", () => {
    const result = evaluateModuleEnable({
      ...baseInput,
      target: descriptor({
        key: "a",
        compatibility: { minAppVersion: "9.9.9" }
      }),
      currentAppVersion: "1.0.0"
    });

    expect(result).toMatchObject({
      valid: false,
      code: "MODULE_VERSION_INCOMPATIBLE"
    });
  });

  test("passes when all dependencies are enabled and no cycle/version issue exists", () => {
    const result = evaluateModuleEnable({
      ...baseInput,
      dependencyStates: [
        {
          descriptor: descriptor({ key: "b" }),
          tenantState: { moduleKey: "b", tenantEnabled: true }
        }
      ]
    });

    expect(result).toEqual({ valid: true });
  });
});

describe("evaluateModuleDisable", () => {
  const baseInput = {
    target: descriptor({ key: "a", isCore: false }),
    targetTenantState: { moduleKey: "a", tenantEnabled: true },
    reverseDependencies: []
  };

  test("rejects an unregistered module", () => {
    const result = evaluateModuleDisable({ ...baseInput, target: null });

    expect(result).toMatchObject({ valid: false, code: "MODULE_NOT_FOUND" });
  });

  test("rejects disabling a core module", () => {
    const result = evaluateModuleDisable({
      ...baseInput,
      target: descriptor({ key: "a", isCore: true })
    });

    expect(result).toMatchObject({
      valid: false,
      code: "CORE_MODULE_CANNOT_BE_DISABLED"
    });
  });

  test("rejects a module already disabled for the tenant", () => {
    const result = evaluateModuleDisable({
      ...baseInput,
      targetTenantState: { moduleKey: "a", tenantEnabled: false }
    });

    expect(result).toMatchObject({
      valid: false,
      code: "MODULE_ALREADY_DISABLED"
    });
  });

  test("rejects when an enabled module still depends on it", () => {
    const result = evaluateModuleDisable({
      ...baseInput,
      reverseDependencies: [
        {
          descriptor: descriptor({ key: "b", dependencies: ["a"] }),
          tenantState: { moduleKey: "b", tenantEnabled: true }
        }
      ]
    });

    expect(result).toMatchObject({
      valid: false,
      code: "MODULE_REVERSE_DEPENDENCY_ACTIVE"
    });
  });

  test("passes when the only reverse dependency is itself tenant-disabled", () => {
    const result = evaluateModuleDisable({
      ...baseInput,
      reverseDependencies: [
        {
          descriptor: descriptor({ key: "b", dependencies: ["a"] }),
          tenantState: { moduleKey: "b", tenantEnabled: false }
        }
      ]
    });

    expect(result).toEqual({ valid: true });
  });

  test("passes when there are no reverse dependencies", () => {
    const result = evaluateModuleDisable(baseInput);

    expect(result).toEqual({ valid: true });
  });
});
