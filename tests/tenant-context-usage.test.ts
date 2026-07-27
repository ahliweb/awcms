/**
 * `db:tenant-context:check` — the two ways a pool refusal escapes the type
 * system.
 *
 * Every case feeds `findUsageViolations` source it must reject, and the two
 * central ones reinstate the REAL defects this gate was written for, in the
 * exact form they shipped:
 *
 * - `src/pages/api/v1/auth/sso/[providerKey]/callback.ts` discarded the result
 *   of an audit-event write, so under a saturated pool an `sso_account_linked`
 *   record was skipped and the endpoint still answered as though it had been
 *   made.
 * - the 15 admin `.astro` screens assign the result to a variable they then
 *   read fields off, in files `tsc --noEmit` never opens.
 *
 * The last block runs the gate against the real repository, so this file is
 * also the drift detector.
 */
import { describe, expect, test } from "bun:test";

import {
  collectUsageViolations,
  findUsageViolations
} from "../scripts/tenant-context-usage-check";

describe("a discarded withTenant() result", () => {
  test("flags the defect this gate exists for: an audit write whose 503 goes nowhere", () => {
    const violations = findUsageViolations(
      "src/pages/api/v1/auth/sso/[providerKey]/callback.ts",
      [
        'if (result.outcome === "linked") {',
        "  await withTenant(sql, result.tenantId, (tx) =>",
        "    recordAuditEvent(tx, { action: 'sso_account_linked' })",
        "  );",
        "}"
      ].join("\n")
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe("discarded_result");
    expect(violations[0]!.line).toBe(2);
  });

  test("the generic form is caught too", () => {
    expect(
      findUsageViolations("src/x.ts", "await withTenant<void>(sql, id, fn);")
    ).toHaveLength(1);
  });

  test("a returned result is not discarded — the compiler owns it from there", () => {
    expect(
      findUsageViolations(
        "src/pages/api/v1/offices/index.ts",
        "return withTenant(sql, tenantId, async (tx) => ok(tx));"
      )
    ).toEqual([]);
  });

  test("an assigned result is not discarded", () => {
    // `const x = await withTenant(...)` keeps the value reachable, so whichever
    // branch reads it is a compile error rather than this gate's business.
    expect(
      findUsageViolations(
        "src/x.ts",
        "const precheck = await withTenant<PrecheckResult>(sql, id, fn);"
      )
    ).toEqual([]);
  });

  test("withTenantOrThrow — the fix — is never flagged", () => {
    expect(
      findUsageViolations(
        "src/modules/logging/application/audit-purge.ts",
        "await withTenantOrThrow(sql, tenantId, async (tx) => {"
      )
    ).toEqual([]);
  });
});

describe("a .astro call", () => {
  test("is flagged even when the result IS used, because tsc never reads the file", () => {
    // The distinction that matters: this same line in a `.ts` file is fine,
    // because `Response | Row[]` fails to compile at `rows.map`. In `.astro`
    // nothing checks it, so the rule is the extension, not the shape.
    const source = "const rows = await withTenant(sql, ssr.tenantId, load);";

    expect(findUsageViolations("src/pages/admin/users.astro", source)).toEqual([
      {
        file: "src/pages/admin/users.astro",
        line: 1,
        kind: "astro_frontmatter",
        text: source
      }
    ]);
    expect(findUsageViolations("src/pages/admin/users.ts", source)).toEqual([]);
  });
});

describe("comment handling", () => {
  test("a file that DOCUMENTS the rule is not counted as breaking it", () => {
    // Not hypothetical: this gate's own header, and `withTenant`'s docblock,
    // both spell out the discarded-`await` shape. Without this the gate
    // reports itself — the third time that has happened in this repository.
    const source = [
      "/**",
      " * Historically this did `await withTenant(sql, id, fn);` and dropped it.",
      " */",
      "// see also: await withTenant(sql, id, fn)",
      "await withTenantOrThrow(sql, id, fn);"
    ].join("\n");

    expect(findUsageViolations("src/x.ts", source)).toEqual([]);
  });
});

describe("the real repository", () => {
  test("has no discarded refusal and no .astro caller", async () => {
    const violations = await collectUsageViolations();

    expect(violations.map((v) => `${v.file}:${v.line} (${v.kind})`)).toEqual(
      []
    );
  }, 60000);

  test("is wired into `bun run check`", async () => {
    const manifest = (await Bun.file("package.json").json()) as {
      scripts: Record<string, string>;
    };

    expect(manifest.scripts["db:tenant-context:check"]).toBeDefined();
    expect(manifest.scripts.check).toContain("db:tenant-context:check");
  });
});
