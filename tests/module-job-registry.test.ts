/**
 * `modules:jobs:check` — the cross-check between the two job registries.
 *
 * Every case feeds `findJobRegistryViolations` input it must reject, and the
 * central one reinstates the REAL defect: `tenant-domain:dns:sync` sat in
 * `JOB_WORK_CLASS_REGISTRY` (so it was fully inside the capacity model) while
 * its module declared no `jobs` at all — so it never appeared in
 * `GET /api/v1/modules/{key}/jobs`, the surface an operator reads to learn a
 * job needs scheduling.
 *
 * The last block runs the gate against the real registries, so this file is
 * also the drift detector: a new worker script whose module forgets its
 * descriptor fails here on the PR that adds it.
 */
import { describe, expect, test } from "bun:test";

import {
  DOCUMENTED_EXCEPTIONS,
  findJobRegistryViolations,
  targetForScript
} from "../scripts/module-job-registry-check";
import { JOB_WORK_CLASS_REGISTRY } from "../src/lib/database/work-class-registry";
import { listModules } from "../src/modules";

const PACKAGE_SCRIPTS = {
  "tenant-domain:dns:sync": "bun scripts/tenant-domain-dns-sync.ts",
  "edge-cache:purge": "bun scripts/edge-cache-purge.ts",
  "site-search:reconcile": "bun scripts/site-search-reconcile.ts"
};

describe("findJobRegistryViolations", () => {
  test("flags the defect this gate exists for: a work-class job with no descriptor", () => {
    const violations = findJobRegistryViolations(
      ["scripts/tenant-domain-dns-sync.ts"],
      [],
      PACKAGE_SCRIPTS
    );

    expect(violations).toEqual([
      {
        target: "tenant-domain:dns:sync",
        script: "scripts/tenant-domain-dns-sync.ts",
        kind: "missing_descriptor"
      }
    ]);
  });

  test("a descriptor without a schedule is still a finding", () => {
    // "What is this job" is not the question that gets it running.
    const violations = findJobRegistryViolations(
      ["scripts/site-search-reconcile.ts"],
      [{ command: "bun run site-search:reconcile" }],
      PACKAGE_SCRIPTS
    );

    expect(violations[0]!.kind).toBe("missing_schedule");
  });

  test("a whitespace-only schedule does not count as one", () => {
    const violations = findJobRegistryViolations(
      ["scripts/site-search-reconcile.ts"],
      [{ command: "bun run site-search:reconcile", recommendedSchedule: "  " }],
      PACKAGE_SCRIPTS
    );

    expect(violations[0]!.kind).toBe("missing_schedule");
  });

  test("a complete descriptor passes", () => {
    expect(
      findJobRegistryViolations(
        ["scripts/site-search-reconcile.ts"],
        [
          {
            command: "bun run site-search:reconcile",
            recommendedSchedule: "every 15 minutes"
          }
        ],
        PACKAGE_SCRIPTS
      )
    ).toEqual([]);
  });

  test("the documented exception excuses only its own target", () => {
    // `edge-cache:purge` is excused; a second module-less job would not be.
    expect(
      findJobRegistryViolations(
        ["scripts/edge-cache-purge.ts"],
        [],
        PACKAGE_SCRIPTS
      )
    ).toEqual([]);

    expect(
      findJobRegistryViolations(
        ["scripts/tenant-domain-dns-sync.ts"],
        [],
        PACKAGE_SCRIPTS
      )
    ).toHaveLength(1);
  });

  test("every exception carries a structural reason a reviewer can disagree with", () => {
    for (const entry of DOCUMENTED_EXCEPTIONS) {
      expect(entry.target.length).toBeGreaterThan(0);
      expect(entry.reason.length).toBeGreaterThan(120);
      // The bar is "no module CAN own this", not "no module HAS owned it".
      expect(entry.reason).toContain("ADR-0043");
    }
  });
});

describe("targetForScript", () => {
  test("resolves a script path back to its bun run target", () => {
    expect(
      targetForScript("scripts/tenant-domain-dns-sync.ts", PACKAGE_SCRIPTS)
    ).toBe("tenant-domain:dns:sync");
  });

  test("returns null for a script no target runs", () => {
    expect(targetForScript("scripts/nope.ts", PACKAGE_SCRIPTS)).toBeNull();
  });
});

describe("the real registries", () => {
  test("every work-class job script has a scheduled descriptor", async () => {
    const packageScripts = (
      (await Bun.file("package.json").json()) as {
        scripts: Record<string, string>;
      }
    ).scripts;

    const violations = findJobRegistryViolations(
      Object.keys(JOB_WORK_CLASS_REGISTRY),
      listModules().flatMap((module) => module.jobs ?? []),
      packageScripts
    );

    expect(violations.map((v) => `${v.target} (${v.kind})`)).toEqual([]);
  });

  test("is wired into `bun run check`", async () => {
    const manifest = (await Bun.file("package.json").json()) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts["modules:jobs:check"]).toBeDefined();
    expect(manifest.scripts.check).toContain("modules:jobs:check");
  });
});
