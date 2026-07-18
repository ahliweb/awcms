/**
 * Integration test: a real, in-repo fixture derived-application registry
 * (`tests/fixtures/derived-application-example/`) composed against the LIVE
 * base registry (`listBaseModules()`) — proves a derived application can add
 * its own domain module WITHOUT editing `src/modules/index.ts` or
 * `src/modules/application-registry.ts` (Issue #178 acceptance criterion).
 */
import { describe, expect, test } from "bun:test";

import { listBaseModules } from "../src/modules";
import {
  buildComposedModuleInventory,
  composeModuleRegistry
} from "../src/modules/module-management/domain/module-composition";
import { exampleApplicationModuleRegistry } from "./fixtures/derived-application-example/application-registry";

describe("derived-application-example fixture composed against the live base", () => {
  test("composes cleanly with zero issues", () => {
    const result = composeModuleRegistry({
      base: listBaseModules(),
      application: exampleApplicationModuleRegistry
    });
    if (!result.valid) {
      // Surface the actual diagnostics if this ever regresses.
      throw new Error(
        `fixture composition unexpectedly invalid: ${JSON.stringify(
          result.issues
        )}`
      );
    }
    expect(result.valid).toBe(true);
  });

  test("effective registry = base + exactly one contributed module, appended last", () => {
    const result = composeModuleRegistry({
      base: listBaseModules(),
      application: exampleApplicationModuleRegistry
    });
    expect(result.registry).toHaveLength(listBaseModules().length + 1);
    expect(result.registry.at(-1)?.key).toBe("example_crm");
  });

  test("the contributed module depends on real base modules", () => {
    const example = exampleApplicationModuleRegistry.modules[0]!;
    const baseKeys = new Set(listBaseModules().map((m) => m.key));
    for (const dep of example.dependencies) {
      expect(baseKeys.has(dep)).toBe(true);
    }
  });

  test("inventory attributes the fixture module as an application source", () => {
    const inventory = buildComposedModuleInventory({
      base: listBaseModules(),
      application: exampleApplicationModuleRegistry
    });
    const entry = inventory.modules.find((m) => m.key === "example_crm");
    expect(entry?.source).toBe("application");
    expect(inventory.applicationModuleCount).toBe(1);
    expect(inventory.applicationRegistryId).toBe(
      "derived-application-example-fixture"
    );
    expect(inventory.migrationNamespaces).toContainEqual({
      label: "derived-application-example fixture",
      rangeStart: 900,
      rangeEnd: 999,
      source: "application"
    });
  });

  test("importing the fixture does NOT change the base's own shipped seam", async () => {
    // The base repo must keep shipping applicationModuleRegistry === undefined
    // even though this fixture registry exists in the tree.
    const { applicationModuleRegistry } =
      await import("../src/modules/application-registry");
    expect(applicationModuleRegistry).toBeUndefined();
  });
});
