/**
 * Composition test: the LIVE base registry (`listBaseModules()`) combined with
 * an in-repo example DOMAIN module (`tests/fixtures/example-domain-modules/`)
 * validates cleanly — proves the composition rule engine accepts a domain
 * module added to the registry (the same shape as adding one directly to
 * `src/modules/`), with its dependencies satisfied by real base modules.
 */
import { describe, expect, test } from "bun:test";

import { listBaseModules } from "../src/modules";
import {
  buildComposedModuleInventory,
  composeModuleRegistry
} from "../src/modules/module-management/domain/module-composition";
import { exampleDomainModules } from "./fixtures/example-domain-modules";

const composed = () => [...listBaseModules(), ...exampleDomainModules];

describe("base registry + example domain module", () => {
  test("composes cleanly with zero issues", () => {
    const result = composeModuleRegistry(composed());
    if (!result.valid) {
      // Surface the actual diagnostics if this ever regresses.
      throw new Error(
        `composition unexpectedly invalid: ${JSON.stringify(result.issues)}`
      );
    }
    expect(result.valid).toBe(true);
  });

  test("effective registry = base + exactly one example module, appended last", () => {
    const result = composeModuleRegistry(composed());
    expect(result.registry).toHaveLength(listBaseModules().length + 1);
    expect(result.registry.at(-1)?.key).toBe("example_crm");
  });

  test("the example module depends only on real base modules", () => {
    const example = exampleDomainModules[0]!;
    const baseKeys = new Set(listBaseModules().map((m) => m.key));
    for (const dep of example.dependencies) {
      expect(baseKeys.has(dep)).toBe(true);
    }
  });

  test("inventory includes the example module entry", () => {
    const inventory = buildComposedModuleInventory(composed());
    const entry = inventory.modules.find((m) => m.key === "example_crm");
    expect(entry).toBeDefined();
    expect(entry?.type).toBe("domain");
    expect(inventory.moduleCount).toBe(listBaseModules().length + 1);
    expect(inventory.valid).toBe(true);
  });

  test("the base registry alone never registers the example module", () => {
    // The example domain module lives only in the test fixture — it must never
    // leak into the reviewed base registry.
    expect(listBaseModules().some((m) => m.key === "example_crm")).toBe(false);
  });
});
