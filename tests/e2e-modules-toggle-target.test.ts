/**
 * The module `tests/e2e/admin-modules-toggle.e2e.ts` disables must stay
 * disable-able.
 *
 * That spec round-trips one module's tenant enablement through `/admin/modules`.
 * The endpoint refuses a disable while any enabled module depends on the target
 * (`MODULE_REVERSE_DEPENDENCY_ACTIVE`, `evaluateModuleDisable`), and a fresh seed
 * enables every module — so the moment some module declares the target as a
 * dependency, the e2e row never flips. That happened to `reporting` when `tax`
 * and `inventory` registered projections on it, and it surfaced only in the
 * env-gated e2e job as "element(s) not found", which says nothing about why.
 *
 * This reads the target out of the spec's TEXT (importing a Playwright spec into
 * `bun test` would execute its `test.describe`) and checks it against the live
 * registry. Pure — no database, no browser — so it fails in `quality`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const SPEC = path.resolve(import.meta.dir, "e2e/admin-modules-toggle.e2e.ts");

function targetKey(): string {
  const match = /const moduleKey = "([a-z_]+)";/.exec(
    readFileSync(SPEC, "utf8")
  );
  if (!match?.[1]) {
    throw new Error(
      `Could not find \`const moduleKey = "...";\` in ${SPEC} — update this test with the spec.`
    );
  }
  return match[1];
}

describe("e2e modules-toggle target", () => {
  test("is a registered, non-core module", () => {
    const key = targetKey();
    const target = listModules().find((module) => module.key === key);
    expect(target).toBeDefined();
    expect(target?.isCore ?? false).toBe(false);
  });

  test("has no reverse dependencies, so the disable cannot be refused", () => {
    const key = targetKey();
    const dependents = listModules()
      .filter((module) => (module.dependencies ?? []).includes(key))
      .map((module) => module.key);
    expect(dependents).toEqual([]);
  });
});
