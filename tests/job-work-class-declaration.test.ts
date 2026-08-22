/**
 * A job's declared work class must be the one it PASSES — finding D11 of the
 * 17 August 2026 audit round.
 *
 * ## What was wrong, in both directions
 *
 * `src/lib/database/work-class-registry.ts` names a class for every worker
 * script, and that map feeds the capacity model and the drift gate. Seven
 * scripts never passed it: their `withTenantOrThrow` calls took the documented
 * `"interactive"` default, so nightly purges queued in the bucket sized for
 * live users while the registry recorded them as `maintenance`. And
 * `site-search-reconcile.ts` passed `maintenance` where the registry says
 * `background_sync` — the same drift running the other way.
 *
 * Neither could be seen by anything: the registry gate compared the map against
 * which scripts EXIST, never against what they do.
 *
 * ## Why counting, and not "is there a literal"
 *
 * A presence check passes on a script with three transactions and one declared
 * class, and two of them still run as `interactive`. `comments-retention.ts`
 * and `edge-cache-purge.ts` are both three-call scripts, so this is the actual
 * shape here rather than a hypothetical one.
 *
 * ## What this cannot see, stated rather than implied
 *
 * The inspection reads ONE file: the script. Several registry rationales say
 * "every call inside <module> already passes it explicitly" — those calls live
 * under `src/`, the script has no `withTenant*(` of its own, and nothing here
 * verifies them. A gate that implied otherwise would be worse than one that
 * says what it covers.
 */
import { describe, expect, test } from "bun:test";

import {
  describeJobRuntimeProblem,
  inspectJobRuntimeDeclaration
} from "../scripts/work-class-registry-generate";
import { JOB_WORK_CLASS_REGISTRY } from "../src/lib/database/work-class-registry";

describe("inspectJobRuntimeDeclaration", () => {
  test("a call with no workClass is counted as undeclared", () => {
    const declaration = inspectJobRuntimeDeclaration(
      "scripts/example.ts",
      "await withTenantOrThrow(sql, id, (tx) => work(tx));",
      "maintenance"
    );

    expect(declaration.calls).toBe(1);
    expect(declaration.undeclaredCalls).toBe(1);
    expect(describeJobRuntimeProblem(declaration, "maintenance")).toContain(
      'run as the default "interactive"'
    );
  });

  test("three calls with one literal leave two undeclared", () => {
    const declaration = inspectJobRuntimeDeclaration(
      "scripts/example.ts",
      `
        await withTenantOrThrow(sql, id, a, { workClass: "maintenance" });
        await withTenantOrThrow(sql, id, b);
        await withTenantOrThrow(sql, id, c);
      `,
      "maintenance"
    );

    expect(declaration.calls).toBe(3);
    expect(declaration.undeclaredCalls).toBe(2);
    expect(describeJobRuntimeProblem(declaration, "maintenance")).toContain(
      "2 of 3"
    );
  });

  test("a literal that contradicts the registry is reported, not accepted", () => {
    const declaration = inspectJobRuntimeDeclaration(
      "scripts/example.ts",
      'await withTenantOrThrow(sql, id, a, { workClass: "maintenance" });',
      "background_sync"
    );

    expect(declaration.undeclaredCalls).toBe(0);
    expect(declaration.conflicting).toEqual(["maintenance"]);
    expect(describeJobRuntimeProblem(declaration, "background_sync")).toContain(
      'declares "maintenance" where the registry says "background_sync"'
    );
  });

  test("a consistent script reports no problem", () => {
    const declaration = inspectJobRuntimeDeclaration(
      "scripts/example.ts",
      'await withTenantOrThrow(sql, id, a, { workClass: "maintenance" });',
      "maintenance"
    );

    expect(describeJobRuntimeProblem(declaration, "maintenance")).toBeNull();
  });

  test("a script whose transactions live in a module is not judged", () => {
    // No call of its own — the class is passed inside the job module it
    // imports, which this cannot see. Silence here is "not covered", not "ok".
    const declaration = inspectJobRuntimeDeclaration(
      "scripts/example.ts",
      "await runArchivePurgeJob(sql);",
      "maintenance"
    );

    expect(declaration.calls).toBe(0);
    expect(describeJobRuntimeProblem(declaration, "maintenance")).toBeNull();
  });

  test("a docblock naming a call is not a call", () => {
    const declaration = inspectJobRuntimeDeclaration(
      "scripts/example.ts",
      `
        /** Every pass is wrapped in withTenantOrThrow(...). */
        await runJobModule(sql);
      `,
      "maintenance"
    );

    expect(declaration.calls).toBe(0);
  });
});

describe("every registered job script agrees with the registry", () => {
  test("no script opens a transaction as a class other than its declared one", async () => {
    const problems: string[] = [];

    for (const [scriptPath, entry] of Object.entries(JOB_WORK_CLASS_REGISTRY)) {
      const source = await Bun.file(scriptPath).text();
      const problem = describeJobRuntimeProblem(
        inspectJobRuntimeDeclaration(scriptPath, source, entry.workClass),
        entry.workClass
      );

      if (problem) problems.push(problem.trim());
    }

    expect(problems).toEqual([]);
  });

  test("the scripts the finding named do declare a class, and it is the registry's", async () => {
    // Named rather than derived: a loop over "every script with a call" would
    // pass vacuously if the discovery ever stopped finding them. These eight
    // are the exact set D11 was about — seven undeclared plus the one that
    // contradicted the map.
    const named = [
      "scripts/visitor-analytics-purge.ts",
      "scripts/visitor-analytics-rollup.ts",
      "scripts/blog-ads-drop-readiness.ts",
      "scripts/blog-ads-ingest.ts",
      "scripts/comments-retention.ts",
      "scripts/edge-cache-purge.ts",
      "scripts/tenant-domain-dns-sync.ts",
      "scripts/site-search-reconcile.ts"
    ];

    for (const scriptPath of named) {
      const entry = JOB_WORK_CLASS_REGISTRY[scriptPath];
      expect(entry, `${scriptPath} is missing from the registry`).toBeDefined();

      const declaration = inspectJobRuntimeDeclaration(
        scriptPath,
        await Bun.file(scriptPath).text(),
        entry!.workClass
      );

      expect(
        declaration.calls,
        `${scriptPath} opens no transaction`
      ).toBeGreaterThan(0);
      expect(declaration.undeclaredCalls, scriptPath).toBe(0);
      expect(declaration.declared, scriptPath).toEqual([entry!.workClass]);
    }
  });
});
