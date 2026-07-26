/**
 * Preset planning: what a named profile would actually do to a tenant.
 *
 * The two properties that carry the risk are both about DISABLING, because a
 * preset does not merely add:
 *
 * 1. it disables every enabled, unlisted, unprotected module — without that,
 *    a preset can never bring a tenant TO a profile, only add to whatever it
 *    already had;
 * 2. it never schedules a disable that the real `disableTenantModule` would
 *    reject, and never force-disables — a blocked module is reported as
 *    skipped.
 *
 * Pure: `computeModulePresetPlan` does no I/O and calls no lifecycle
 * validation. The application layer runs the real primitives for every planned
 * change, and their rejections are surfaced rather than pre-empted here.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  computeModulePresetPlan,
  findModulePreset,
  MODULE_PRESETS,
  resolveProtectedModuleKeys,
  type ModulePresetDefinition
} from "../src/modules/module-management/domain/module-presets";
import type { ModuleTenantState } from "../src/modules/module-management/domain/tenant-module-lifecycle";

const REGISTRY = listModules();

function allEnabled(): ModuleTenantState[] {
  // A fresh tenant: a missing `awcms_tenant_modules` row means enabled, so this
  // is the state every preset first meets.
  return REGISTRY.map((module) => ({
    moduleKey: module.key,
    tenantEnabled: true
  }));
}

function stateWith(enabled: readonly string[]): ModuleTenantState[] {
  return REGISTRY.map((module) => ({
    moduleKey: module.key,
    tenantEnabled: enabled.includes(module.key)
  }));
}

function plan(preset: ModulePresetDefinition, state: ModuleTenantState[]) {
  return computeModulePresetPlan({
    preset,
    allDescriptors: REGISTRY,
    currentState: state
  });
}

describe("protected set", () => {
  test("is isCore plus its full transitive dependency closure", () => {
    const protectedKeys = resolveProtectedModuleKeys(REGISTRY);

    // `module_management` is the only isCore module in this registry; the rest
    // are protected INDIRECTLY, via the reverse-dependency check.
    expect(REGISTRY.filter((m) => m.isCore).map((m) => m.key)).toEqual([
      "module_management"
    ]);
    expect(protectedKeys.has("module_management")).toBe(true);

    for (const dependency of REGISTRY.find(
      (m) => m.key === "module_management"
    )!.dependencies) {
      expect(protectedKeys.has(dependency)).toBe(true);
    }
  });

  test("no preset can ever schedule a protected module for disable", () => {
    const protectedKeys = resolveProtectedModuleKeys(REGISTRY);

    for (const preset of MODULE_PRESETS) {
      const result = plan(preset, allEnabled());

      for (const key of result.toDisable) {
        expect(protectedKeys.has(key)).toBe(false);
      }
    }
  });
});

describe("a preset both enables and disables", () => {
  test("`minimal` on a fully-enabled tenant disables everything giveable-up", () => {
    // The property that makes presets useful. An enable-only design would
    // produce an empty plan here and leave the tenant exactly as it was.
    const result = plan(findModulePreset("minimal")!, allEnabled());
    const protectedKeys = resolveProtectedModuleKeys(REGISTRY);

    expect(result.toEnable).toEqual([]);
    expect(result.toDisable.length).toBeGreaterThan(5);

    const untouched = REGISTRY.map((m) => m.key).filter(
      (key) =>
        !result.toDisable.includes(key) &&
        !result.skippedDisable.some((s) => s.moduleKey === key)
    );

    expect(untouched.sort()).toEqual([...protectedKeys].sort());
  });

  test("switching profiles disables the outgoing profile's modules", () => {
    // `back_office` names no public surface, so applying it to a website
    // tenant must take the website down. That is what a profile means.
    const website = plan(findModulePreset("website")!, allEnabled());
    const afterWebsite = stateWith([
      ...resolveProtectedModuleKeys(REGISTRY),
      ...findModulePreset("website")!.enabledModuleKeys
    ]);
    const backOffice = plan(findModulePreset("back_office")!, afterWebsite);

    expect(website.toDisable).toContain("workflow");
    expect(backOffice.toDisable).toContain("blog_content");
    expect(backOffice.toEnable).toContain("workflow");
  });

  test("a preset already satisfied plans nothing", () => {
    const preset = findModulePreset("website")!;
    const satisfied = stateWith([
      ...resolveProtectedModuleKeys(REGISTRY),
      ...preset.enabledModuleKeys
    ]);
    const result = plan(preset, satisfied);

    expect(result.toEnable).toEqual([]);
    expect(result.toDisable).toEqual([]);
  });
});

describe("ordering is safe for the real sequential calls", () => {
  test("every preset is dependency-CLOSED", () => {
    // Not a style rule. A preset disables everything enabled and unlisted, so
    // an unlisted dependency gets disabled and then blocks the module that
    // needs it — the plan would enable `comments` and disable
    // `domain_event_runtime` in the same pass. All four presets failed this on
    // first run; the fix was to close them, not to relax the test.
    const protectedKeys = resolveProtectedModuleKeys(REGISTRY);

    for (const preset of MODULE_PRESETS) {
      const listed = new Set([...protectedKeys, ...preset.enabledModuleKeys]);
      const missing: string[] = [];

      for (const key of preset.enabledModuleKeys) {
        for (const dependency of REGISTRY.find((m) => m.key === key)
          ?.dependencies ?? []) {
          if (!listed.has(dependency)) {
            missing.push(`${key} needs ${dependency}`);
          }
        }
      }

      expect({ preset: preset.name, missing }).toEqual({
        preset: preset.name,
        missing: []
      });
    }
  });

  test("enables come dependency-first", () => {
    const preset = findModulePreset("website")!;
    const fromMinimal = stateWith([...resolveProtectedModuleKeys(REGISTRY)]);
    const result = plan(preset, fromMinimal);
    const satisfied = new Set(resolveProtectedModuleKeys(REGISTRY));

    for (const key of result.toEnable) {
      const dependencies =
        REGISTRY.find((m) => m.key === key)?.dependencies ?? [];

      for (const dependency of dependencies) {
        // Either already satisfied, or scheduled earlier in this same list.
        expect(satisfied.has(dependency)).toBe(true);
      }

      satisfied.add(key);
    }
  });

  test("disables come leaves-first — nothing still enabled depends on them", () => {
    const result = plan(findModulePreset("minimal")!, allEnabled());
    const stillEnabled = new Set(REGISTRY.map((m) => m.key));

    for (const key of result.toDisable) {
      const dependents = REGISTRY.filter(
        (m) => m.key !== key && m.dependencies.includes(key)
      ).map((m) => m.key);

      for (const dependent of dependents) {
        expect(stillEnabled.has(dependent)).toBe(false);
      }

      stillEnabled.delete(key);
    }
  });

  test("a module blocked by one the plan is about to ENABLE is skipped, not scheduled", () => {
    // The post-review fix carried over from awcms-micro. Seeding the blocking
    // check with only the pre-plan enabled set schedules such a module for
    // disable; the real call would then reject it as
    // MODULE_REVERSE_DEPENDENCY_ACTIVE — a spurious rejection where the plan
    // promised a clean skip.
    const synthetic: ModuleDescriptorLike[] = [
      { key: "core", dependencies: [], isCore: true },
      { key: "shared", dependencies: [] },
      { key: "incoming", dependencies: ["shared"] }
    ];
    const result = computeModulePresetPlan({
      preset: {
        name: "minimal",
        label: "x",
        description: "x",
        enabledModuleKeys: ["incoming"]
      },
      allDescriptors: synthetic as never,
      currentState: [
        { moduleKey: "core", tenantEnabled: true },
        { moduleKey: "shared", tenantEnabled: true },
        { moduleKey: "incoming", tenantEnabled: false }
      ]
    });

    expect(result.toEnable).toEqual(["incoming"]);
    // `shared` is enabled and unlisted, so it looks like a disable candidate —
    // but `incoming`, which this same plan enables, depends on it.
    expect(result.toDisable).not.toContain("shared");
    expect(result.skippedDisable).toEqual([
      { moduleKey: "shared", reason: "reverse_dependency_active" }
    ]);
  });
});

type ModuleDescriptorLike = {
  key: string;
  dependencies: string[];
  isCore?: boolean;
};

describe("preset definitions are real", () => {
  test("every listed module key exists in the registry", () => {
    // A preset naming a module this base does not have is a dead profile that
    // reports `unknownModuleKeys` on every single apply.
    const keys = new Set(REGISTRY.map((m) => m.key));

    for (const preset of MODULE_PRESETS) {
      const unknown = preset.enabledModuleKeys.filter((key) => !keys.has(key));

      expect({ preset: preset.name, unknown }).toEqual({
        preset: preset.name,
        unknown: []
      });
    }
  });

  test("`unknownModuleKeys` still reports a key that vanishes", () => {
    const result = computeModulePresetPlan({
      preset: {
        name: "minimal",
        label: "x",
        description: "x",
        enabledModuleKeys: ["module_that_does_not_exist"]
      },
      allDescriptors: REGISTRY,
      currentState: allEnabled()
    });

    expect(result.unknownModuleKeys).toEqual(["module_that_does_not_exist"]);
  });

  test("any preset enabling content also enables media_library", () => {
    // ADR-0036's ownership inversion. `media_library` is not protected, so a
    // content preset that omitted it would DISABLE it — reintroducing exactly
    // the "website with no media management" gap that ADR closed.
    for (const preset of MODULE_PRESETS) {
      const enablesContent = ["blog_content", "news_portal"].some((key) =>
        preset.enabledModuleKeys.includes(key)
      );

      if (enablesContent) {
        expect(preset.enabledModuleKeys).toContain("media_library");
      }
    }
  });

  test("preset names are unique", () => {
    const names = MODULE_PRESETS.map((preset) => preset.name);

    expect(new Set(names).size).toBe(names.length);
  });
});
