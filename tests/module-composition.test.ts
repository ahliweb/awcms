import { describe, expect, test } from "bun:test";

import {
  BASE_MODULE_MIGRATION_NAMESPACE,
  buildComposedModuleInventory,
  composeModuleRegistry,
  formatModuleCompositionIssue,
  mergeModuleRegistries,
  validateComposedModuleRegistry,
  type ModuleCompositionIssue
} from "../src/modules/module-management/domain/module-composition";
import { listBaseModules, listModules } from "../src/modules";
import { applicationModuleRegistry } from "../src/modules/application-registry";
import type {
  ApplicationModuleRegistry,
  ModuleDescriptor
} from "../src/modules/_shared/module-contract";

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

function base(...modules: ModuleDescriptor[]): ModuleDescriptor[] {
  return modules;
}

function app(
  modules: ModuleDescriptor[],
  extra: Partial<ApplicationModuleRegistry> = {}
): ApplicationModuleRegistry {
  return { id: "test-app", modules, ...extra };
}

function issueTypes(issues: readonly ModuleCompositionIssue[]): string[] {
  return issues.map((i) => i.type);
}

describe("mergeModuleRegistries", () => {
  test("no application registry is a pure pass-through (order + identity)", () => {
    const baseModules = base(
      descriptor({ key: "a" }),
      descriptor({ key: "b" })
    );
    const merged = mergeModuleRegistries(baseModules, undefined);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(baseModules[0]);
    expect(merged[1]).toBe(baseModules[1]);
  });

  test("application modules are appended after base, in declared order", () => {
    const baseModules = base(descriptor({ key: "a" }));
    const appModules = [descriptor({ key: "x" }), descriptor({ key: "y" })];
    const merged = mergeModuleRegistries(baseModules, app(appModules));

    expect(merged.map((m) => m.key)).toEqual(["a", "x", "y"]);
  });

  test("never mutates the input base array", () => {
    const baseModules = base(descriptor({ key: "a" }));
    mergeModuleRegistries(baseModules, app([descriptor({ key: "x" })]));
    expect(baseModules).toHaveLength(1);
  });
});

describe("validateComposedModuleRegistry — happy path", () => {
  test("valid base + one application module passes with zero issues", () => {
    const baseModules = base(
      descriptor({ key: "tenant_admin" }),
      descriptor({ key: "identity_access" })
    );
    const issues = validateComposedModuleRegistry({
      base: baseModules,
      application: app([
        descriptor({
          key: "example_crm",
          type: "domain",
          dependencies: ["tenant_admin", "identity_access"]
        })
      ])
    });
    expect(issues).toHaveLength(0);
  });
});

describe("duplicate module key", () => {
  test("two application modules with same key are rejected", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([descriptor({ key: "dup" }), descriptor({ key: "dup" })])
    });
    const dup = issues.find((i) => i.type === "duplicate_module_key");
    expect(dup).toBeDefined();
    expect(dup).toMatchObject({ moduleKey: "dup", occurrences: 2 });
  });
});

describe("prohibited base override", () => {
  test("application module reusing a base key is rejected (not duplicate_module_key)", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "tenant_admin", type: "base" })),
      application: app([descriptor({ key: "tenant_admin" })])
    });
    expect(issueTypes(issues)).toContain("prohibited_base_override");
    expect(issueTypes(issues)).not.toContain("duplicate_module_key");
    const issue = issues.find((i) => i.type === "prohibited_base_override");
    expect(issue).toMatchObject({
      moduleKey: "tenant_admin",
      baseModuleType: "base"
    });
  });
});

describe("invalid module type", () => {
  test('application module declaring type "base" is rejected', () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([descriptor({ key: "x", type: "base" })])
    });
    expect(issueTypes(issues)).toContain("invalid_module_type");
  });

  test('application module declaring type "system" is rejected', () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([descriptor({ key: "x", type: "system" })])
    });
    expect(issueTypes(issues)).toContain("invalid_module_type");
  });

  test('type "domain" and "integration" are allowed', () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([
        descriptor({ key: "x", type: "domain" }),
        descriptor({ key: "y", type: "integration" })
      ])
    });
    expect(issueTypes(issues)).not.toContain("invalid_module_type");
  });
});

describe("dependency graph reuse (missing dep / cycle)", () => {
  test("application module depending on an unregistered key -> missing_dependency", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([descriptor({ key: "x", dependencies: ["ghost"] })])
    });
    expect(issueTypes(issues)).toContain("missing_dependency");
  });

  test("cycle across application modules -> cycle", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([
        descriptor({ key: "x", dependencies: ["y"] }),
        descriptor({ key: "y", dependencies: ["x"] })
      ])
    });
    expect(issueTypes(issues)).toContain("cycle");
  });
});

describe("capability provider conflict / missing", () => {
  test("two providers of the same capability -> conflict", () => {
    const issues = validateComposedModuleRegistry({
      base: base(
        descriptor({ key: "a", capabilities: { provides: ["cap_x"] } })
      ),
      application: app([
        descriptor({ key: "x", capabilities: { provides: ["cap_x"] } })
      ])
    });
    const conflict = issues.find(
      (i) => i.type === "capability_provider_conflict"
    );
    expect(conflict).toBeDefined();
    expect(conflict).toMatchObject({ capability: "cap_x" });
  });

  test("required consume of an unregistered provider -> provider_not_registered", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([
        descriptor({
          key: "x",
          capabilities: {
            consumes: [{ capability: "cap_x", providedBy: "ghost" }]
          }
        })
      ])
    });
    const missing = issues.find(
      (i) => i.type === "capability_provider_missing"
    );
    expect(missing).toMatchObject({ reason: "provider_not_registered" });
  });

  test("required consume of a provider that does not declare the capability -> provider_does_not_declare_capability", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a", capabilities: { provides: [] } })),
      application: app([
        descriptor({
          key: "x",
          dependencies: ["a"],
          capabilities: {
            consumes: [{ capability: "cap_x", providedBy: "a" }]
          }
        })
      ])
    });
    const missing = issues.find(
      (i) => i.type === "capability_provider_missing"
    );
    expect(missing).toMatchObject({
      reason: "provider_does_not_declare_capability"
    });
  });

  test("OPTIONAL consume is never checked (degrades safely)", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([
        descriptor({
          key: "x",
          capabilities: {
            consumes: [
              { capability: "cap_x", providedBy: "ghost", optional: true }
            ]
          }
        })
      ])
    });
    expect(issueTypes(issues)).not.toContain("capability_provider_missing");
  });

  test("well-formed provider + consumer pair passes", () => {
    const issues = validateComposedModuleRegistry({
      base: base(
        descriptor({ key: "a", capabilities: { provides: ["cap_x"] } })
      ),
      application: app([
        descriptor({
          key: "x",
          dependencies: ["a"],
          capabilities: {
            consumes: [{ capability: "cap_x", providedBy: "a" }]
          }
        })
      ])
    });
    expect(issueTypes(issues)).not.toContain("capability_provider_missing");
    expect(issueTypes(issues)).not.toContain("capability_provider_conflict");
  });
});

describe("migration namespace overlap", () => {
  test("application range overlapping the base 1-899 range -> overlap", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([descriptor({ key: "x" })], {
        migrationNamespace: { label: "bad", rangeStart: 800, rangeEnd: 950 }
      })
    });
    const overlap = issues.find(
      (i) => i.type === "migration_namespace_overlap"
    );
    expect(overlap).toMatchObject({ overlapStart: 800, overlapEnd: 899 });
  });

  test("application range at 900+ does not overlap", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([descriptor({ key: "x" })], {
        migrationNamespace: { label: "ok", rangeStart: 900, rangeEnd: 999 }
      })
    });
    expect(issueTypes(issues)).not.toContain("migration_namespace_overlap");
  });

  test("omitted migrationNamespace is skipped (no overlap check)", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([descriptor({ key: "x" })])
    });
    expect(issueTypes(issues)).not.toContain("migration_namespace_overlap");
  });

  test("base reserved namespace is 1-899", () => {
    expect(BASE_MODULE_MIGRATION_NAMESPACE).toMatchObject({
      rangeStart: 1,
      rangeEnd: 899
    });
  });
});

describe("deployment profile incompatibility", () => {
  test("module claims a profile a dependency does not support -> incompatible", () => {
    const issues = validateComposedModuleRegistry({
      base: base(
        descriptor({
          key: "dep",
          compatibility: { deploymentProfiles: ["production"] }
        })
      ),
      application: app([
        descriptor({
          key: "x",
          dependencies: ["dep"],
          compatibility: { deploymentProfiles: ["offline-lan"] }
        })
      ])
    });
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
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "dep" })),
      application: app([
        descriptor({
          key: "x",
          dependencies: ["dep"],
          compatibility: { deploymentProfiles: ["offline-lan"] }
        })
      ])
    });
    expect(issueTypes(issues)).not.toContain("deployment_profile_incompatible");
  });
});

describe("navigation path conflict", () => {
  test("two modules declaring the same path -> conflict", () => {
    const issues = validateComposedModuleRegistry({
      base: base(
        descriptor({
          key: "a",
          navigation: [{ labelKey: "a", path: "/admin/dup" }]
        })
      ),
      application: app([
        descriptor({
          key: "x",
          navigation: [{ labelKey: "x", path: "/admin/dup" }]
        })
      ])
    });
    const issue = issues.find((i) => i.type === "navigation_path_conflict");
    expect(issue).toMatchObject({ path: "/admin/dup" });
  });
});

describe("invalid job descriptor", () => {
  test("a job with a non bun-run command is rejected", () => {
    const issues = validateComposedModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([
        descriptor({
          key: "x",
          jobs: [{ command: "rm -rf /", purpose: "malicious" }]
        })
      ])
    });
    expect(issueTypes(issues)).toContain("invalid_job_descriptor");
  });
});

describe("composeModuleRegistry wrapper", () => {
  test("valid input -> { valid: true, registry }", () => {
    const result = composeModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([descriptor({ key: "x", dependencies: ["a"] })])
    });
    expect(result.valid).toBe(true);
    expect(result.registry.map((m) => m.key)).toEqual(["a", "x"]);
  });

  test("invalid input -> { valid: false, registry, issues } (registry still present)", () => {
    const result = composeModuleRegistry({
      base: base(descriptor({ key: "a" })),
      application: app([descriptor({ key: "a" })])
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.registry).toHaveLength(2);
    }
  });

  test("every issue has a non-empty, human-readable formatted message", () => {
    const result = composeModuleRegistry({
      base: base(descriptor({ key: "a", type: "base" })),
      application: app([descriptor({ key: "a" }), descriptor({ key: "a" })])
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      for (const issue of result.issues) {
        expect(formatModuleCompositionIssue(issue).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildComposedModuleInventory — deterministic", () => {
  test("modules sorted by key, source attributed by position", () => {
    const inventory = buildComposedModuleInventory({
      base: base(descriptor({ key: "zeta" }), descriptor({ key: "alpha" })),
      application: app([descriptor({ key: "mid", type: "domain" })], {
        migrationNamespace: { label: "app", rangeStart: 900, rangeEnd: 999 }
      })
    });

    expect(inventory.modules.map((m) => m.key)).toEqual([
      "alpha",
      "mid",
      "zeta"
    ]);
    expect(inventory.modules.find((m) => m.key === "mid")?.source).toBe(
      "application"
    );
    expect(inventory.modules.find((m) => m.key === "zeta")?.source).toBe(
      "base"
    );
    expect(inventory.baseModuleCount).toBe(2);
    expect(inventory.applicationModuleCount).toBe(1);
    expect(inventory.applicationRegistryId).toBe("test-app");
  });

  test("two runs against the same input produce byte-identical JSON (no wall-clock)", () => {
    const input = {
      base: base(descriptor({ key: "b" }), descriptor({ key: "a" }))
    };
    const first = JSON.stringify(buildComposedModuleInventory(input));
    const second = JSON.stringify(buildComposedModuleInventory(input));
    expect(first).toBe(second);
  });
});

describe("contract: base effective registry is unchanged by the composition seam", () => {
  test("base repo ships applicationModuleRegistry === undefined", () => {
    expect(applicationModuleRegistry).toBeUndefined();
  });

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
    const issues = validateComposedModuleRegistry({
      base: listBaseModules(),
      application: undefined
    });
    expect(issues).toHaveLength(0);
  });
});

describe("mutation-style: a healthy composition becomes RED when broken", () => {
  const healthyBase = () =>
    base(
      descriptor({ key: "tenant_admin" }),
      descriptor({ key: "identity_access" })
    );
  const healthyModule = () =>
    descriptor({
      key: "example_crm",
      type: "domain",
      dependencies: ["tenant_admin", "identity_access"]
    });

  test("baseline is valid", () => {
    expect(
      composeModuleRegistry({
        base: healthyBase(),
        application: app([healthyModule()])
      }).valid
    ).toBe(true);
  });

  test("removing a satisfied dependency's provider makes it RED", () => {
    // Drop identity_access from the base -> the module's dependency is now missing.
    const result = composeModuleRegistry({
      base: base(descriptor({ key: "tenant_admin" })),
      application: app([healthyModule()])
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(issueTypes(result.issues)).toContain("missing_dependency");
    }
  });

  test("duplicating a key makes it RED", () => {
    const result = composeModuleRegistry({
      base: healthyBase(),
      application: app([healthyModule(), healthyModule()])
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(issueTypes(result.issues)).toContain("duplicate_module_key");
    }
  });
});
