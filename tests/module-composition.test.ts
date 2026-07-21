/**
 * Module-registry composition validation tests. After ADR-0034 §3 removed the
 * derived-application pathway, `validateComposedModuleRegistry`/
 * `composeModuleRegistry`/`buildComposedModuleInventory` validate a single
 * reviewed registry (the base). Every check exercised here is a
 * base-load-bearing invariant that also holds when a new domain module is
 * added directly to `src/modules/`.
 */
import { describe, expect, test } from "bun:test";

import {
  buildComposedModuleInventory,
  composeModuleRegistry,
  formatModuleCompositionIssue,
  validateComposedModuleRegistry,
  type ModuleCompositionIssue
} from "../src/modules/module-management/domain/module-composition";
import { listBaseModules, listModules } from "../src/modules";
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

function registry(...modules: ModuleDescriptor[]): ModuleDescriptor[] {
  return modules;
}

function issueTypes(issues: readonly ModuleCompositionIssue[]): string[] {
  return issues.map((i) => i.type);
}

describe("validateComposedModuleRegistry — happy path", () => {
  test("a valid registry with a domain module depending on base modules passes", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({ key: "tenant_admin" }),
        descriptor({ key: "identity_access" }),
        descriptor({
          key: "example_crm",
          type: "domain",
          dependencies: ["tenant_admin", "identity_access"]
        })
      )
    );
    expect(issues).toHaveLength(0);
  });
});

describe("duplicate module key", () => {
  test("two modules with the same key are rejected", () => {
    const issues = validateComposedModuleRegistry(
      registry(descriptor({ key: "dup" }), descriptor({ key: "dup" }))
    );
    const dup = issues.find((i) => i.type === "duplicate_module_key");
    expect(dup).toBeDefined();
    expect(dup).toMatchObject({ moduleKey: "dup", occurrences: 2 });
  });
});

describe("dependency graph reuse (missing dep / cycle)", () => {
  test("a module depending on an unregistered key -> missing_dependency", () => {
    const issues = validateComposedModuleRegistry(
      registry(descriptor({ key: "x", dependencies: ["ghost"] }))
    );
    expect(issueTypes(issues)).toContain("missing_dependency");
  });

  test("a dependency cycle -> cycle", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({ key: "x", dependencies: ["y"] }),
        descriptor({ key: "y", dependencies: ["x"] })
      )
    );
    expect(issueTypes(issues)).toContain("cycle");
  });
});

describe("capability provider conflict / missing", () => {
  test("two providers of the same capability -> conflict", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({ key: "a", capabilities: { provides: ["cap_x"] } }),
        descriptor({ key: "x", capabilities: { provides: ["cap_x"] } })
      )
    );
    const conflict = issues.find(
      (i) => i.type === "capability_provider_conflict"
    );
    expect(conflict).toBeDefined();
    expect(conflict).toMatchObject({ capability: "cap_x" });
  });

  test("required consume of an unregistered provider -> provider_not_registered", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({
          key: "x",
          capabilities: {
            consumes: [{ capability: "cap_x", providedBy: "ghost" }]
          }
        })
      )
    );
    const missing = issues.find(
      (i) => i.type === "capability_provider_missing"
    );
    expect(missing).toMatchObject({ reason: "provider_not_registered" });
  });

  test("required consume of a provider that does not declare the capability -> provider_does_not_declare_capability", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({ key: "a", capabilities: { provides: [] } }),
        descriptor({
          key: "x",
          dependencies: ["a"],
          capabilities: {
            consumes: [{ capability: "cap_x", providedBy: "a" }]
          }
        })
      )
    );
    const missing = issues.find(
      (i) => i.type === "capability_provider_missing"
    );
    expect(missing).toMatchObject({
      reason: "provider_does_not_declare_capability"
    });
  });

  test("OPTIONAL consume is never checked (degrades safely)", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({
          key: "x",
          capabilities: {
            consumes: [
              { capability: "cap_x", providedBy: "ghost", optional: true }
            ]
          }
        })
      )
    );
    expect(issueTypes(issues)).not.toContain("capability_provider_missing");
  });

  test("well-formed provider + consumer pair passes", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({ key: "a", capabilities: { provides: ["cap_x"] } }),
        descriptor({
          key: "x",
          dependencies: ["a"],
          capabilities: {
            consumes: [{ capability: "cap_x", providedBy: "a" }]
          }
        })
      )
    );
    expect(issueTypes(issues)).not.toContain("capability_provider_missing");
    expect(issueTypes(issues)).not.toContain("capability_provider_conflict");
  });
});

describe("deployment profile incompatibility", () => {
  test("module claims a profile a dependency does not support -> incompatible", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({
          key: "dep",
          compatibility: { deploymentProfiles: ["production"] }
        }),
        descriptor({
          key: "x",
          dependencies: ["dep"],
          compatibility: { deploymentProfiles: ["offline-lan"] }
        })
      )
    );
    const issue = issues.find(
      (i) => i.type === "deployment_profile_incompatible"
    );
    expect(issue).toMatchObject({
      moduleKey: "x",
      dependencyKey: "dep",
      unsupportedProfile: "offline-lan"
    });
  });

  test("dependency without declared profiles imposes no constraint", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({ key: "dep" }),
        descriptor({
          key: "x",
          dependencies: ["dep"],
          compatibility: { deploymentProfiles: ["offline-lan"] }
        })
      )
    );
    expect(issueTypes(issues)).not.toContain("deployment_profile_incompatible");
  });
});

describe("navigation path conflict", () => {
  test("two modules declaring the same path -> conflict", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({
          key: "a",
          navigation: [{ labelKey: "a", path: "/admin/dup" }]
        }),
        descriptor({
          key: "x",
          navigation: [{ labelKey: "x", path: "/admin/dup" }]
        })
      )
    );
    const issue = issues.find((i) => i.type === "navigation_path_conflict");
    expect(issue).toMatchObject({ path: "/admin/dup" });
  });
});

describe("invalid job descriptor", () => {
  test("a job with a non bun-run command is rejected", () => {
    const issues = validateComposedModuleRegistry(
      registry(
        descriptor({
          key: "x",
          jobs: [{ command: "rm -rf /", purpose: "malicious" }]
        })
      )
    );
    expect(issueTypes(issues)).toContain("invalid_job_descriptor");
  });
});

describe("composeModuleRegistry wrapper", () => {
  test("valid input -> { valid: true, registry }", () => {
    const result = composeModuleRegistry(
      registry(
        descriptor({ key: "a" }),
        descriptor({ key: "x", dependencies: ["a"] })
      )
    );
    expect(result.valid).toBe(true);
    expect(result.registry.map((m) => m.key)).toEqual(["a", "x"]);
  });

  test("invalid input -> { valid: false, registry, issues } (registry still present)", () => {
    const result = composeModuleRegistry(
      registry(descriptor({ key: "a" }), descriptor({ key: "a" }))
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.registry).toHaveLength(2);
    }
  });

  test("every issue has a non-empty, human-readable formatted message", () => {
    const result = composeModuleRegistry(
      registry(
        descriptor({ key: "a" }),
        descriptor({ key: "a" }),
        descriptor({ key: "y", dependencies: ["ghost"] })
      )
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      for (const issue of result.issues) {
        expect(formatModuleCompositionIssue(issue).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildComposedModuleInventory — deterministic", () => {
  test("modules sorted by key", () => {
    const inventory = buildComposedModuleInventory(
      registry(
        descriptor({ key: "zeta" }),
        descriptor({ key: "alpha" }),
        descriptor({ key: "mid", type: "domain" })
      )
    );

    expect(inventory.modules.map((m) => m.key)).toEqual([
      "alpha",
      "mid",
      "zeta"
    ]);
    expect(inventory.moduleCount).toBe(3);
    expect(inventory.valid).toBe(true);
  });

  test("two runs against the same input produce byte-identical JSON (no wall-clock)", () => {
    const input = registry(descriptor({ key: "b" }), descriptor({ key: "a" }));
    const first = JSON.stringify(buildComposedModuleInventory(input));
    const second = JSON.stringify(buildComposedModuleInventory(input));
    expect(first).toBe(second);
  });
});

describe("contract: the base registry is a stable, valid pass-through", () => {
  test("listModules() equals listBaseModules() (same order + object identity)", () => {
    const effective = listModules();
    const baseOnly = listBaseModules();
    expect(effective).toHaveLength(baseOnly.length);
    effective.forEach((module, index) => {
      expect(module).toBe(baseOnly[index]!);
    });
  });

  test("listModules() returns a stable reference across calls (descriptor-sync identity check)", () => {
    expect(listModules()).toBe(listModules());
  });

  test("the real base registry composes with zero issues", () => {
    const issues = validateComposedModuleRegistry(listBaseModules());
    expect(issues).toHaveLength(0);
  });
});

describe("mutation-style: a healthy composition becomes RED when broken", () => {
  const healthyRegistry = () =>
    registry(
      descriptor({ key: "tenant_admin" }),
      descriptor({ key: "identity_access" }),
      descriptor({
        key: "example_crm",
        type: "domain",
        dependencies: ["tenant_admin", "identity_access"]
      })
    );

  test("baseline is valid", () => {
    expect(composeModuleRegistry(healthyRegistry()).valid).toBe(true);
  });

  test("removing a satisfied dependency's provider makes it RED", () => {
    // Drop identity_access -> the module's dependency is now missing.
    const result = composeModuleRegistry(
      registry(
        descriptor({ key: "tenant_admin" }),
        descriptor({
          key: "example_crm",
          type: "domain",
          dependencies: ["tenant_admin", "identity_access"]
        })
      )
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(issueTypes(result.issues)).toContain("missing_dependency");
    }
  });

  test("duplicating a key makes it RED", () => {
    const result = composeModuleRegistry([
      ...healthyRegistry(),
      descriptor({
        key: "example_crm",
        type: "domain",
        dependencies: ["tenant_admin", "identity_access"]
      })
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(issueTypes(result.issues)).toContain("duplicate_module_key");
    }
  });
});
