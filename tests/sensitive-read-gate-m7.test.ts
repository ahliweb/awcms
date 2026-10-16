/**
 * Issue #1015 follow-up (audit M7): the cheap holes in how the sensitive-reads
 * gate finds files, descriptors and calls.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import {
  evaluateSensitiveReadCoverage,
  importedNamesFrom,
  isModuleDescriptorFile,
  maskLiterals
} from "../src/modules/_shared/sensitive-read-coverage";

const MODULE: ModuleDescriptor = {
  key: "hr_payroll",
  name: "HR payroll",
  version: "1.0.0",
  status: "active",
  description: "fixture",
  dependencies: [],
  permissions: [
    { activityCode: "payslips", action: "read", description: "fixture" }
  ]
};

const READER = `export const q = (tx) => tx\`SELECT * FROM awcms_hr_payslips\`;`;
const CALL = `await recordSensitiveRead(tx, { permission: "hr_payroll.payslips.read" });`;

const run = (source: string, name: string) =>
  evaluateSensitiveReadCoverage([MODULE], [source], [name]);

describe("the gate scans every source extension", () => {
  test("sensitive-reads-check lists .ts, .tsx, .js, .mjs and .astro", () => {
    const script = readFileSync(
      new URL("../scripts/sensitive-reads-check.ts", import.meta.url),
      "utf8"
    );
    const list = /extensions:\s*\[([^\]]*)\]/.exec(script)?.[1] ?? "";

    for (const extension of [".ts", ".tsx", ".js", ".mjs", ".astro"]) {
      expect(list).toContain(`"${extension}"`);
    }
  });

  test.each(["x.tsx", "x.js", "x.mjs"])(
    "an unaudited payroll reader in %s is refused once it is scanned",
    (file) => {
      expect(
        run(READER, `src/modules/anything/${file}`).unauditedTableReaders
      ).toHaveLength(1);
    }
  );
});

describe("the module.ts exemption is for descriptors only", () => {
  test("a real descriptor is exempt", () => {
    expect(
      run(READER, "src/modules/anything/module.ts").unauditedTableReaders
    ).toEqual([]);
  });

  test("a module.ts that exports a route handler is not", () => {
    for (const handler of [
      `export const GET = async () => 1;\n${READER}`,
      `export async function POST() {}\n${READER}`,
      `${READER}\nexport { handler as GET };`
    ]) {
      expect(
        run(handler, "src/modules/anything/module.ts").unauditedTableReaders
      ).toHaveLength(1);
    }
  });

  test("a module.ts outside src/modules/<key>/ (a page, a nested file) is not", () => {
    for (const name of [
      "src/pages/api/v1/module.ts",
      "src/pages/admin/module.ts",
      "src/modules/a/b/module.ts"
    ]) {
      expect(isModuleDescriptorFile(name, READER)).toBe(false);
      expect(run(READER, name).unauditedTableReaders).toHaveLength(1);
    }
  });
});

describe("a call inside a string or template literal is not an audit", () => {
  test("maskLiterals blanks literal content and keeps offsets", () => {
    const source = `a("x y", 'z', \`t\${1}\`); b();`;
    const masked = maskLiterals(source);

    expect(masked).toHaveLength(source.length);
    expect(masked).toContain("b();");
    expect(masked).not.toContain("x y");
  });

  test.each([
    [
      "a double-quoted string",
      `const doc = "await ${CALL.replace(/"/g, "'")}";`
    ],
    ["a template literal", `const doc = \`${CALL}\`;`],
    ["a single-quoted string", `const doc = 'recordSensitiveRead(tx, {})';`]
  ])("%s does not clear a payroll reader", (_name, literal) => {
    const result = run(`${READER}\n${literal}`, "src/modules/anything/x.ts");

    expect(result.unauditedTableReaders).toHaveLength(1);
  });

  test("the real call still clears it", () => {
    const result = run(`${READER}\n${CALL}`, "src/modules/anything/x.ts");

    expect(result.unauditedTableReaders).toEqual([]);
    expect(result.uncoveredTableReaders).toEqual([]);
  });
});

describe("a dynamic import whose specifier is not a plain string", () => {
  const STEM = "hr-commission-accrual-ledger";

  test.each([
    ["a plain string of the ledger", `import("../x/${STEM}")`, true],
    ["a template that names the ledger", `import(\`./${STEM}\${v}\`)`, true],
    [
      "a template with only a prefix of the name",
      "import(`../application/hr-commission-${name}`)",
      true
    ],
    [
      "a concatenation of fragments",
      `import("../hr-commission-" + "accrual-" + "ledger")`,
      true
    ],
    ["a plain string of something else", `import("../x/other")`, false],
    ["an unrelated computed identifier", `import(ENTRY)`, false]
  ])("%s", (_name, code, takesAll) => {
    expect(importedNamesFrom(code, STEM).includes("*")).toBe(takesAll);
  });

  test("the evaluator refuses it from a file that is not allow-listed", () => {
    const result = evaluateSensitiveReadCoverage(
      [MODULE],
      ["const m = await import(`../hr-commission-${x}`);"],
      ["src/pages/api/v1/other/route.ts"]
    );

    expect(result.forbiddenReadImports).toHaveLength(2); // the ledger and the port adapter both share the "hr-commission" fragment;
  });
});
