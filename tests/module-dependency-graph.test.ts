import { describe, expect, test } from "bun:test";

import {
  formatModuleDependencyGraphIssue,
  validateModuleDependencyGraph
} from "../src/modules/_shared/module-dependency-graph";
import { listModules } from "../src/modules";
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

describe("validateModuleDependencyGraph", () => {
  test("valid graph: linear chain + diamond both pass", () => {
    const a = descriptor({ key: "a", dependencies: ["b", "c"] });
    const b = descriptor({ key: "b", dependencies: ["d"] });
    const c = descriptor({ key: "c", dependencies: ["d"] });
    const d = descriptor({ key: "d", dependencies: [] });

    expect(validateModuleDependencyGraph([a, b, c, d])).toEqual({
      valid: true
    });
  });

  test("valid graph: empty registry and single node with no dependencies both pass", () => {
    expect(validateModuleDependencyGraph([])).toEqual({ valid: true });
    expect(validateModuleDependencyGraph([descriptor()])).toEqual({
      valid: true
    });
  });

  test("detects a direct cycle (a -> b -> a)", () => {
    const a = descriptor({ key: "a", dependencies: ["b"] });
    const b = descriptor({ key: "b", dependencies: ["a"] });

    const result = validateModuleDependencyGraph([a, b]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const cycleIssue = result.issues.find((i) => i.type === "cycle");
      expect(cycleIssue).toBeDefined();
      if (cycleIssue?.type === "cycle") {
        expect(cycleIssue.path[0]).toBe(cycleIssue.path.at(-1));
        expect(new Set(cycleIssue.path)).toEqual(new Set(["a", "b"]));
      }
    }
  });

  test("detects an indirect cycle (a -> b -> c -> a)", () => {
    const a = descriptor({ key: "a", dependencies: ["b"] });
    const b = descriptor({ key: "b", dependencies: ["c"] });
    const c = descriptor({ key: "c", dependencies: ["a"] });

    const result = validateModuleDependencyGraph([a, b, c]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const cycleIssue = result.issues.find((i) => i.type === "cycle");
      expect(cycleIssue).toBeDefined();
      if (cycleIssue?.type === "cycle") {
        expect(new Set(cycleIssue.path)).toEqual(new Set(["a", "b", "c"]));
      }
    }
  });

  test("detects a 3-cycle across three foundation-shaped modules", () => {
    const tenantAdmin = descriptor({
      key: "tenant_admin",
      dependencies: ["profile_identity", "identity_access"]
    });
    const profileIdentity = descriptor({
      key: "profile_identity",
      dependencies: ["tenant_admin"]
    });
    const identityAccess = descriptor({
      key: "identity_access",
      dependencies: ["tenant_admin", "profile_identity"]
    });

    const result = validateModuleDependencyGraph([
      tenantAdmin,
      profileIdentity,
      identityAccess
    ]);
    expect(result.valid).toBe(false);
  });

  test("detects a self-dependency", () => {
    const a = descriptor({ key: "a", dependencies: ["a"] });

    const result = validateModuleDependencyGraph([a]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toEqual([
        { type: "self_dependency", moduleKey: "a" }
      ]);
    }
  });

  test("detects a duplicate dependency", () => {
    const a = descriptor({ key: "a", dependencies: ["b", "b"] });
    const b = descriptor({ key: "b", dependencies: [] });

    const result = validateModuleDependencyGraph([a, b]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toEqual([
        { type: "duplicate_dependency", moduleKey: "a", dependencyKey: "b" }
      ]);
    }
  });

  test("detects a missing dependency (key not registered anywhere)", () => {
    const a = descriptor({ key: "a", dependencies: ["ghost"] });

    const result = validateModuleDependencyGraph([a]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues).toEqual([
        { type: "missing_dependency", moduleKey: "a", dependencyKey: "ghost" }
      ]);
    }
  });

  test("a missing dependency does not also spuriously report a cycle", () => {
    const a = descriptor({ key: "a", dependencies: ["ghost"] });
    const b = descriptor({ key: "b", dependencies: ["a"] });

    const result = validateModuleDependencyGraph([a, b]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.some((i) => i.type === "cycle")).toBe(false);
    }
  });

  test("reports every distinct issue type in one run, not just the first", () => {
    const a = descriptor({ key: "a", dependencies: ["a", "ghost"] });

    const result = validateModuleDependencyGraph([a]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const types = result.issues.map((i) => i.type).sort();
      expect(types).toEqual(["missing_dependency", "self_dependency"]);
    }
  });

  test("formatModuleDependencyGraphIssue produces a readable, secret-free message for every issue type", () => {
    expect(
      formatModuleDependencyGraphIssue({
        type: "self_dependency",
        moduleKey: "a"
      })
    ).toContain("a");
    expect(
      formatModuleDependencyGraphIssue({
        type: "duplicate_dependency",
        moduleKey: "a",
        dependencyKey: "b"
      })
    ).toContain("b");
    expect(
      formatModuleDependencyGraphIssue({
        type: "missing_dependency",
        moduleKey: "a",
        dependencyKey: "ghost"
      })
    ).toContain("ghost");
    expect(
      formatModuleDependencyGraphIssue({
        type: "cycle",
        path: ["a", "b", "a"]
      })
    ).toBe("Circular dependency: a -> b -> a.");
  });

  test("the REAL registered module registry (listModules()) is a valid DAG", () => {
    expect(validateModuleDependencyGraph(listModules())).toEqual({
      valid: true
    });
  });
});
