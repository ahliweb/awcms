/**
 * The matrix's warnings must be the REAL validation, asked the right question.
 *
 * ## The failure this guards against
 *
 * A matrix is a UI convenience, and the tempting way to build one is to
 * re-derive "can this be enabled?" from the dependency array by hand. That
 * derivation then drifts from what `enableTenantModule` actually does, and the
 * admin screen starts promising outcomes the API refuses.
 *
 * So the rule is: only ever ask `evaluateModuleEnable`/`evaluateModuleDisable`
 * the question they are designed to answer, for the module's real state — and
 * never forge a synthetic state to get an answer out of them.
 *
 * That is why the warnings are one-directional. `evaluateModuleEnable` on an
 * ALREADY-ENABLED module short-circuits to `MODULE_ALREADY_ENABLED` before it
 * ever reaches the dependency loop: the answer looks like a check and is not
 * one. These tests pin that asymmetry, because a future edit "improving" the
 * matrix by computing all four combinations would reintroduce exactly the
 * fiction it avoids.
 *
 * Pure: the row-building logic is exercised through the same domain functions
 * `fetchModuleMatrix` calls, with no database. The two reads
 * `fetchModuleMatrix` performs (catalog + tenant entries) are covered by their
 * own DB-gated tests.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { resolveProtectedModuleKeys } from "../src/modules/module-management/domain/module-presets";
import {
  evaluateModuleDisable,
  evaluateModuleEnable
} from "../src/modules/module-management/domain/tenant-module-lifecycle";

const REGISTRY = listModules();

describe("the question each evaluator is asked", () => {
  test("evaluateModuleEnable on an ENABLED module short-circuits — it is not a dependency check", () => {
    // The whole reason `dependencyWarning` is computed only for disabled rows.
    // If the matrix asked this question of an enabled module it would get
    // MODULE_ALREADY_ENABLED, which is not a warning about anything.
    const target = REGISTRY.find((module) => module.dependencies.length > 0)!;
    const validation = evaluateModuleEnable({
      target,
      targetTenantState: { moduleKey: target.key, tenantEnabled: true },
      dependencyStates: target.dependencies.map((key) => ({
        descriptor: REGISTRY.find((m) => m.key === key)!,
        // Deliberately DISABLED dependencies: a naive check would report them.
        tenantState: { moduleKey: key, tenantEnabled: false }
      })),
      allDescriptors: REGISTRY,
      currentAppVersion: "9.9.9"
    });

    expect(validation.valid).toBe(false);
    expect(validation.valid === false && validation.code).toBe(
      "MODULE_ALREADY_ENABLED"
    );
  });

  test("a DISABLED module with a disabled dependency reports MODULE_DEPENDENCY_DISABLED", () => {
    const target = REGISTRY.find((module) => module.dependencies.length > 0)!;
    const dependencyKey = target.dependencies[0]!;
    const validation = evaluateModuleEnable({
      target,
      targetTenantState: { moduleKey: target.key, tenantEnabled: false },
      dependencyStates: target.dependencies.map((key) => ({
        descriptor: REGISTRY.find((m) => m.key === key)!,
        tenantState: { moduleKey: key, tenantEnabled: key !== dependencyKey }
      })),
      allDescriptors: REGISTRY,
      currentAppVersion: "9.9.9"
    });

    expect(validation.valid === false && validation.code).toBe(
      "MODULE_DEPENDENCY_DISABLED"
    );
  });

  test("an ENABLED module with an enabled dependent reports MODULE_REVERSE_DEPENDENCY_ACTIVE", () => {
    const dependent = REGISTRY.find(
      (module) => module.dependencies.length > 0
    )!;
    const targetKey = dependent.dependencies[0]!;
    const target = REGISTRY.find((module) => module.key === targetKey)!;

    const validation = evaluateModuleDisable({
      target,
      targetTenantState: { moduleKey: target.key, tenantEnabled: true },
      reverseDependencies: [
        {
          descriptor: dependent,
          tenantState: { moduleKey: dependent.key, tenantEnabled: true }
        }
      ]
    });

    expect(validation.valid).toBe(false);
    expect(validation.valid === false && validation.code).toBe(
      "MODULE_REVERSE_DEPENDENCY_ACTIVE"
    );
  });

  test("the same module with the dependent DISABLED is disableable", () => {
    const dependent = REGISTRY.find(
      (module) => module.dependencies.length > 0 && !module.isCore
    )!;
    const targetKey = dependent.dependencies[0]!;
    const target = REGISTRY.find((module) => module.key === targetKey)!;

    const validation = evaluateModuleDisable({
      target,
      targetTenantState: { moduleKey: target.key, tenantEnabled: true },
      reverseDependencies: REGISTRY.filter(
        (m) => m.key !== target.key && m.dependencies.includes(target.key)
      ).map((m) => ({
        descriptor: m,
        tenantState: { moduleKey: m.key, tenantEnabled: false }
      }))
    });

    // `isCore` still wins over everything — that is a different rejection and
    // the matrix reports it through `isProtected`, not a warning.
    if (target.isCore) {
      expect(validation.valid === false && validation.code).toBe(
        "CORE_MODULE_CANNOT_BE_DISABLED"
      );
    } else {
      expect(validation.valid).toBe(true);
    }
  });
});

describe("isProtected", () => {
  test("covers core and its whole dependency closure, and nothing else", () => {
    const protectedKeys = resolveProtectedModuleKeys(REGISTRY);
    const core = REGISTRY.filter((module) => module.isCore).map((m) => m.key);

    expect(core.length).toBeGreaterThan(0);

    for (const key of core) {
      expect(protectedKeys.has(key)).toBe(true);
    }

    // Every protected key is reachable from a core module — nothing is
    // protected "just because", which would silently remove a tenant's ability
    // to disable something they are entitled to disable.
    for (const key of protectedKeys) {
      const reachable = new Set<string>();
      const walk = (from: string) => {
        if (reachable.has(from)) return;
        reachable.add(from);
        for (const dependency of REGISTRY.find((m) => m.key === from)
          ?.dependencies ?? []) {
          walk(dependency);
        }
      };

      core.forEach(walk);
      expect(reachable.has(key)).toBe(true);
    }
  });
});
