/**
 * Issue #952, security audit M-2 and M-1: the own-only commission readers are on
 * the payroll read-import registry (a NEW importer is flagged), and a page or
 * route that reads workforce data outside the employee's own basis must record
 * the sensitive read.
 */
import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import { evaluateSensitiveReadCoverage } from "../src/modules/_shared/sensitive-read-coverage";
import { PAYROLL_READ_FUNCTION_IMPORTS } from "../src/modules/_shared/sensitive-reads";
import { listFilesRecursive, REPO_ROOT } from "../scripts/lib/repo-files";
import { stripComments } from "../scripts/lib/source-text";

function commissionModule(): ModuleDescriptor {
  return {
    key: "hr_commission",
    name: "HR commission",
    version: "1.0.0",
    status: "active",
    description: "fixture",
    dependencies: [],
    permissions: [
      { activityCode: "accruals", action: "read", description: "fixture" },
      { activityCode: "my_accruals", action: "read", description: "fixture" }
    ]
  };
}

const importer = (clause: string) =>
  `import ${clause} from "../../../../modules/hr-commission/application/hr-commission-accrual-ledger";\n`;

const evaluate = (sources: Record<string, string>) =>
  evaluateSensitiveReadCoverage(
    [commissionModule()],
    Object.values(sources),
    Object.keys(sources)
  );

const OWN_ROUTES = [
  "src/pages/api/v1/hr-commission/my-accruals/index.ts",
  "src/pages/api/v1/hr-commission/my-accruals/[id].ts",
  "src/pages/admin/hr/my-commission.astro"
];

describe("M-2: the own-only commission readers are registered", () => {
  const entry = PAYROLL_READ_FUNCTION_IMPORTS.find((candidate) =>
    candidate.functions.includes("listOwnAccruals")
  );

  test("the registry names both own-only readers and exactly the three allowed importers", () => {
    expect(entry).toBeDefined();
    expect([...entry!.functions].sort()).toEqual([
      "getOwnAccrual",
      "listOwnAccruals"
    ]);
    expect([...entry!.allowedImporters].sort()).toEqual([...OWN_ROUTES].sort());

    for (const path of OWN_ROUTES) {
      expect(entry!.auditExemptImporters?.[path]).toMatch(/own-only/);
    }
  });

  test("a NEW importer of an own-only reader is flagged", () => {
    const result = evaluate({
      "src/pages/api/v1/other/route.ts": importer("{ listOwnAccruals }")
    });

    expect(result.forbiddenReadImports[0]?.problem).toContain(
      "not in PAYROLL_READ_FUNCTION_IMPORTS allowedImporters"
    );
  });

  test("an allowed own-only importer needs no audit call; the all-accruals readers still do", () => {
    const own = evaluate({
      [OWN_ROUTES[0]!]: importer("{ listOwnAccruals }")
    });
    const everyone = evaluate({
      "src/pages/api/v1/hr-commission/accruals/index.ts":
        importer("{ listAccruals }")
    });

    expect(own.forbiddenReadImports).toEqual([]);
    expect(everyone.forbiddenReadImports[0]?.problem).toContain(
      "never calls recordSensitiveRead"
    );
  });

  test("an own-only importer cannot be used to import the all-accruals readers", () => {
    const result = evaluate({
      [OWN_ROUTES[0]!]: importer("{ listOwnAccruals, listAccruals }")
    });

    // The all-accruals entry has its own allow-list: this file is not on it.
    expect(
      result.forbiddenReadImports.some((violation) =>
        violation.functions.includes("listAccruals")
      )
    ).toBe(true);
  });
});

/** Each reader of a person's rows and the permission whose audit must stand for a non-own call of it. */
const READER_PERMISSION: Record<string, string> = {
  listEvents: "hr_workforce.attendance.read",
  listCorrections: "hr_workforce.corrections.read",
  listEmployeeFacts: "hr_workforce.workforce_metrics.read"
};
const AUDIT_CALL =
  /\b(?:audit|recordRead|auditPanelRead|recordSensitiveRead)\(/g;
const PERMISSION_LITERAL = /"(hr_workforce\.[a-z_]+\.[a-z_]+)"/;

/** Call sites of `name` (not its import) whose arguments are not the employee's own basis. */
function nonMineCalls(code: string, name: string): number {
  let count = 0;

  for (const match of code.matchAll(new RegExp(`\\b${name}\\(`, "g"))) {
    const before = code.slice(Math.max(0, match.index! - 40), match.index!);

    // A declaration, not a call.
    if (/function\s+$|import\s.*$/.test(before)) continue;

    const call = code.slice(match.index!, match.index! + 220).split(";")[0]!;

    if (!/mineBasis|mode:\s*"mine"/.test(call)) count += 1;
  }

  return count;
}

/** Audit sites per permission: a call of an audit function followed by the permission literal. */
function auditSites(code: string): Map<string, number> {
  const sites = new Map<string, number>();

  for (const match of code.matchAll(AUDIT_CALL)) {
    const literal = PERMISSION_LITERAL.exec(
      code.slice(match.index!, match.index! + 260)
    );

    if (literal) sites.set(literal[1]!, (sites.get(literal[1]!) ?? 0) + 1);
  }

  return sites;
}

/**
 * M-1, call by call: every non-own call of a reader needs an audit SITE naming
 * that reader's permission, counted per file (a file with two non-own
 * `listEvents` calls needs two). Removing one audit of three leaves the count
 * short even though the file still audits something. Pure text; the policy gate
 * (`sensitive-reads:check`) covers routes by their guards, and this covers the
 * readers directly so a screen cannot be the unaudited door.
 */
export function unpairedNonMineReads(files: Record<string, string>): string[] {
  const problems: string[] = [];

  for (const [name, text] of Object.entries(files)) {
    if (!/^src\/(pages|lib)\//.test(name)) continue;

    const code = stripComments(text);
    const sites = auditSites(code);

    for (const [reader, permission] of Object.entries(READER_PERMISSION)) {
      if (!new RegExp(`import[^;]*\\b${reader}\\b`).test(code)) continue;

      const needed = nonMineCalls(code, reader);
      const have = sites.get(permission) ?? 0;

      if (have < needed) {
        problems.push(
          `${name}: ${needed} non-own ${reader} call(s) but ${have} audit site(s) for ${permission}`
        );
      }
    }
  }

  return problems.sort();
}

describe("M-1: a non-own read of workforce rows records a sensitive read", () => {
  const files: Record<string, string> = {};

  for (const dir of ["src/pages", "src/lib"]) {
    for (const name of listFilesRecursive(dir, {
      extensions: [".ts", ".astro"],
      relativeTo: REPO_ROOT
    })) {
      files[name] = readFileSync(`${REPO_ROOT}/${name}`, "utf8");
    }
  }

  const loaders = "src/lib/hr-self-service-loaders.ts";
  const workforce = "src/pages/admin/hr/workforce.astro";

  test("every shipped page, route and loader pairs each non-own read with an audit", () => {
    expect(Object.keys(files).length).toBeGreaterThan(50);
    expect(unpairedNonMineReads(files)).toEqual([]);

    // The counter found its subjects: a vacuous pass is the usual failure.
    const code = stripComments(files[loaders]!);

    expect(nonMineCalls(code, "listEvents")).toBe(2);
    expect(nonMineCalls(code, "listCorrections")).toBe(2);
    expect(nonMineCalls(code, "listEmployeeFacts")).toBe(1);
    expect(auditSites(code).get("hr_workforce.attendance.read")).toBe(2);
    expect(auditSites(code).get("hr_workforce.corrections.read")).toBe(2);
    expect(auditSites(code).get("hr_workforce.workforce_metrics.read")).toBe(1);
  });

  // Strip ONE audit site at a time and the gate must go red.
  const mutations: [string, string, RegExp][] = [
    [
      "the team corrections audit",
      loaders,
      /await audit\(\s*"hr_workforce\.corrections\.read"/
    ],
    [
      "the team attendance audit",
      loaders,
      /await audit\(\s*"hr_workforce\.attendance\.read"/
    ],
    [
      "the team metrics audit",
      loaders,
      /await audit\(\s*"hr_workforce\.workforce_metrics\.read"/
    ],
    [
      "the HR corrections recordRead",
      loaders,
      /await input\.recordRead\(\{\s*permission: "hr_workforce\.corrections\.read"/
    ],
    [
      "the HR attendance recordRead",
      loaders,
      /await input\.recordRead\(\{\s*permission: "hr_workforce\.attendance\.read"/
    ]
  ];

  for (const [label, file, pattern] of mutations) {
    test(`stripping only ${label} turns the gate red`, () => {
      expect(files[file]).toMatch(pattern);

      const mutated = files[file]!.replace(pattern, (m) =>
        m.replace(/audit\(|recordRead\(/, "skip(")
      );

      expect(mutated).not.toBe(files[file]);
      expect(unpairedNonMineReads({ ...files, [file]: mutated })).not.toEqual(
        []
      );
    });
  }

  test("HR's recorder lives in the page, with literal permissions and mode all", () => {
    const page = files[workforce]!;

    expect(page).toContain('mode: "all"');
    expect(page).toContain('permission: "hr_workforce.corrections.read"');
    expect(page).toContain('permission: "hr_workforce.attendance.read"');
  });

  test("a new screen that reads in basis all without an audit is flagged; the own basis is not", () => {
    expect(
      unpairedNonMineReads({
        "src/pages/admin/hr/new.astro": `import { listEvents } from "x";\nawait listEvents(tx, t, { mode: "all" }, {});`
      })
    ).toHaveLength(1);
    expect(
      unpairedNonMineReads({
        "src/pages/admin/hr/mine.astro": `import { listEvents } from "x";\nawait listEvents(tx, t, { mode: "mine", tenantUserId }, {});`
      })
    ).toEqual([]);
  });
});
