/**
 * Issue #1095 (owner decision K3): the masked mutation results and the
 * scheduled catalog check. No database; the DB-backed probes are in
 * `tests/integration/payroll-catalog-audit-role-1095.integration.test.ts`.
 *
 * Every gate here is proven by its MUTATION: the control is broken in the test
 * and the verdict must go red.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  findForbiddenReadImports,
  maskLiterals
} from "../src/modules/_shared/sensitive-read-coverage";
import {
  PAYROLL_READ_FUNCTION_IMPORTS,
  type PayrollReadFunctionImport
} from "../src/modules/_shared/sensitive-reads";
import {
  maskAccrueOutcome,
  maskVoidOutcome,
  toMutationReceipt
} from "../src/modules/hr-commission/application/hr-commission-accrual-receipt";
import type { CommissionAccrual } from "../src/modules/hr-commission/application/hr-commission-accrual-ledger";
import type { CatalogSnapshot } from "../scripts/lib/payroll-catalog-boundary";
import {
  HEALTHY_PAYROLL_COLUMNS,
  HEALTHY_PAYROLL_FOREIGN_KEYS,
  HEALTHY_PAYROLL_TRIGGERS
} from "./fixtures/payroll-fingerprint-snapshot";
import {
  evaluatePayrollCatalog,
  parseExpectedOwners
} from "../scripts/lib/payroll-catalog-check-run";
import {
  dedicatedRoleTargets,
  DEDICATED_ROLE_CLIENT_FILES
} from "../scripts/jobs-env-allowlist";
import { assertNoSharedLogins } from "../src/lib/database/payroll-catalog-audit-client";

const LEDGER =
  "src/modules/hr-commission/application/hr-commission-accrual-ledger.ts";
const ADAPTER =
  "src/modules/hr-commission/application/hr-commission-accrual-port-adapter.ts";
const ROUTES = ["approve", "release", "pay", "void"].map(
  (verb) => `src/pages/api/v1/hr-commission/accruals/[id]/${verb}.ts`
);

const FULL: CommissionAccrual = {
  id: "11111111-1111-4111-8111-111111111111",
  employmentId: "22222222-2222-4222-8222-222222222222",
  ruleId: "33333333-3333-4333-8333-333333333333",
  ruleKey: "sales",
  ruleVersion: 3,
  status: "paid",
  amount: "7654321.090000",
  currencyCode: "IDR",
  sourceType: "sale_line",
  sourceRef: "SECRET-ORDER-REF",
  sourceLine: "1",
  operation: "accrue",
  calculation: "percent",
  baseAmount: "9999999.000000",
  units: 5,
  rate: "0.025",
  fixedAmount: "42.000000",
  occurredAt: "2026-11-01T00:00:00.000Z",
  occurredOn: "2026-11-01",
  createdAt: "2026-11-01T00:00:00.000Z",
  approvedAt: "2026-11-02T00:00:00.000Z",
  releasedAt: "2026-11-03T00:00:00.000Z",
  paidAt: "2026-11-04T00:00:00.000Z",
  paymentReference: "SECRET-PAYOUT-77",
  voidedAt: null,
  voidReasonCode: null
};

const SENSITIVE_VALUES = [
  FULL.amount,
  FULL.employmentId,
  FULL.ruleId,
  FULL.sourceRef,
  FULL.paymentReference!,
  FULL.baseAmount!,
  FULL.rate!,
  FULL.fixedAmount!
];

describe("the masked receipt (allow-list, never a deny-list)", () => {
  test("carries the transition facts and none of the earnings, person or references", () => {
    const receipt = toMutationReceipt(FULL);
    const text = JSON.stringify(receipt);

    for (const value of SENSITIVE_VALUES) {
      expect(text).not.toContain(value);
    }

    for (const field of [
      "amount",
      "baseAmount",
      "units",
      "rate",
      "fixedAmount",
      "employmentId",
      "ruleId",
      "sourceRef",
      "sourceLine",
      "paymentReference",
      "occurredAt",
      "operation"
    ]) {
      expect(Object.hasOwn(receipt, field)).toBe(false);
    }

    expect(receipt.masked).toBe(true);
    expect(receipt.status).toBe("paid");
    expect(receipt.id).toBe(FULL.id);
  });

  test("a column added to the ledger later does not reach the receipt by default", () => {
    const widened = {
      ...FULL,
      newSensitiveColumn: "LEAK-ME"
    } as CommissionAccrual;

    expect(JSON.stringify(toMutationReceipt(widened))).not.toContain("LEAK-ME");
  });

  test("the port outcomes drop the amount and the beneficiary and keep refusals as they are", () => {
    const accrued = maskAccrueOutcome({ outcome: "accrued", accrual: FULL });
    const voided = maskVoidOutcome({ outcome: "voided", accrual: FULL });
    const replay = maskVoidOutcome({
      outcome: "already_voided",
      accrual: FULL
    });

    for (const outcome of [accrued, voided, replay]) {
      const accrual = (outcome as { accrual: object }).accrual;

      expect(Object.keys(accrual).sort()).toEqual([
        "currencyCode",
        "id",
        "ruleKey",
        "ruleVersion",
        "status"
      ]);
      expect(JSON.stringify(outcome)).not.toContain(FULL.amount);
      expect(JSON.stringify(outcome)).not.toContain(FULL.employmentId);
    }

    expect(maskAccrueOutcome({ outcome: "no_effective_rule" })).toEqual({
      outcome: "no_effective_rule"
    });
    expect(
      maskVoidOutcome({
        outcome: "period_closed",
        accrualId: FULL.id,
        status: "paid"
      })
    ).toEqual({ outcome: "period_closed", accrualId: FULL.id, status: "paid" });
  });
});

describe("the sensitive-read gate on the write path", () => {
  const entry = PAYROLL_READ_FUNCTION_IMPORTS.find(
    (candidate) =>
      candidate.source === LEDGER &&
      candidate.functions.includes("accrueCommission")
  )!;
  const read = (file: string) => readFileSync(file, "utf8");
  const constants = () => new Map<string, string | null>();
  const gate = (name: string, source: string) =>
    findForbiddenReadImports(
      [source],
      [name],
      [entry] as readonly PayrollReadFunctionImport[],
      constants
    ).forbidden;

  test("the four routes and the adapter are no longer audit-exempt; they are mask-conditioned", () => {
    for (const file of [...ROUTES, ADAPTER]) {
      expect(Object.hasOwn(entry.auditExemptImporters ?? {}, file)).toBe(false);
      expect(Object.hasOwn(entry.maskedResultImporters ?? {}, file)).toBe(true);
    }

    // The own-only readers and the intake poster are the only exemptions left.
    expect(Object.keys(entry.auditExemptImporters ?? {})).toEqual([
      "src/modules/hr-commission/application/hr-commission-intake-poster.ts"
    ]);
  });

  test("the real files pass", () => {
    for (const file of [...ROUTES, ADAPTER]) {
      expect(gate(file, read(file))).toEqual([]);
    }
  });

  test("MUTATION: a route that returns the full accrual (mask removed) with no audit goes red", () => {
    for (const file of ROUTES) {
      const unmasked = read(file).replace(
        /toMutationReceipt\(result\.accrual\)/,
        "result.accrual"
      );

      expect(unmasked).not.toContain("toMutationReceipt(");

      const forbidden = gate(file, unmasked);

      expect(forbidden).toHaveLength(1);
      expect(forbidden[0]!.problem).toContain("toMutationReceipt");
    }
  });

  test("MUTATION: the adapter that stops calling either mask goes red", () => {
    const source = read(ADAPTER);

    for (const mask of ["maskAccrueOutcome", "maskVoidOutcome"]) {
      const broken = source.replace(
        new RegExp(`\\b${mask}\\(`, "g"),
        "String("
      );

      expect(gate(ADAPTER, broken)).toHaveLength(1);
    }
  });

  test("MUTATION: a mask that only appears in a comment or a string is not a call", () => {
    const source = `import { transitionAccrual } from "../hr-commission/application/hr-commission-accrual-ledger";
// toMutationReceipt(result.accrual)
const note = "toMutationReceipt(result.accrual)";
export const x = transitionAccrual;`;

    expect(gate(ROUTES[0]!, source)).toHaveLength(1);
    expect(maskLiterals('"toMutationReceipt("')).not.toContain(
      "toMutationReceipt"
    );
  });

  test("a file that records the read audit itself needs no mask", () => {
    const source = `import { transitionAccrual } from "../hr-commission/application/hr-commission-accrual-ledger";
await recordSensitiveRead(tx, { permission: "hr_commission.accruals.read" });
export const x = transitionAccrual;`;

    expect(gate(ROUTES[0]!, source)).toEqual([]);
  });

  test("importing a READ function puts the audit back, mask or not", () => {
    const source = `import { transitionAccrual, getAccrual } from "../hr-commission/application/hr-commission-accrual-ledger";
export const x = [transitionAccrual, getAccrual, toMutationReceipt(1)];`;

    expect(gate(ROUTES[0]!, source)).toHaveLength(1);
  });

  test("voidCommissionBySource is a guarded write-path function too", () => {
    expect(entry.functions).toContain("voidCommissionBySource");
    expect(entry.writePathFunctions).toContain("voidCommissionBySource");
  });
});

describe("the scheduled catalog check, verdict", () => {
  const TABLES = [
    "public.awcms_hr_commission_accruals",
    "public.awcms_hr_commission_transitions"
  ];
  const snapshot = (owner: string): CatalogSnapshot => ({
    migrationOwner: "migrator",
    columns: HEALTHY_PAYROLL_COLUMNS,
    foreignKeys: HEALTHY_PAYROLL_FOREIGN_KEYS,
    roles: [],
    namedObjects: [],
    rules: [],
    functions: [],
    triggers: HEALTHY_PAYROLL_TRIGGERS,
    grants: [],
    inheritance: [],
    relations: TABLES.map((name) => ({
      name,
      relkind: "r",
      owner,
      comment: "payroll-boundary: test"
    })),
    memberships: [],
    publications: [],
    foreignTables: [],
    dependencies: []
  });

  test("a clean catalog passes", () => {
    const result = evaluatePayrollCatalog(snapshot("migrator"), {}, {});

    expect(result.ok).toBe(true);
    expect(result.lines).toHaveLength(1);
  });

  test("a split-role deployment without PAYROLL_EXPECTED_OWNERS fails LOUDLY, naming the variable", () => {
    const result = evaluatePayrollCatalog(
      snapshot("payroll_owner"),
      {},
      { requireOwnersOnSplitRole: true }
    );

    expect(result.ok).toBe(false);
    expect(result.findingCodes).toContain("payroll-owner");
    expect(result.lines[0]).toContain("PAYROLL_EXPECTED_OWNERS is not set");
  });

  test("the same deployment passes once PAYROLL_EXPECTED_OWNERS names the owner", () => {
    const result = evaluatePayrollCatalog(
      snapshot("payroll_owner"),
      { PAYROLL_EXPECTED_OWNERS: " payroll_owner , other " },
      { requireOwnersOnSplitRole: true }
    );

    expect(result.ok).toBe(true);
    expect(parseExpectedOwners(" a, ,b ")).toEqual(["a", "b"]);
  });

  test("a runtime role as owner still fails even with PAYROLL_EXPECTED_OWNERS set to something else", () => {
    const result = evaluatePayrollCatalog(
      snapshot("awcms_app"),
      { PAYROLL_EXPECTED_OWNERS: "payroll_owner" },
      { requireOwnersOnSplitRole: true }
    );

    expect(result.ok).toBe(false);
    // The hint is for the unset variable only.
    expect(result.lines[0]).toBe("payroll:catalog-boundary FAILED -");
  });

  test("an empty catalog with no ledger and no owners is a finding, never a pass", () => {
    const empty = { ...snapshot("migrator"), migrationOwner: null };
    const result = evaluatePayrollCatalog(
      empty,
      {},
      {
        requireOwnersOnSplitRole: true
      }
    );

    expect(result.ok).toBe(false);
    expect(result.findingCodes).toContain("payroll-ledger-missing");
  });
});

describe("the job is a dedicated-role job with the right plumbing", () => {
  test("its client file is a dedicated-role seam and the job is derived as such", () => {
    expect(
      DEDICATED_ROLE_CLIENT_FILES[
        "src/lib/database/payroll-catalog-audit-client.ts"
      ]
    ).toBe("PAYROLL_CATALOG_AUDIT_DATABASE_URL");

    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    const { targets, problems } = dedicatedRoleTargets(scripts);

    expect(problems).toEqual([]);
    expect(targets).toContain("payroll:catalog-boundary:job");
  });

  test("the runner withholds every shared login from it, and the env-scoped file grants only its own URL", () => {
    const runner = readFileSync("ops/run-job.sh", "utf8");
    const scoped = readFileSync("ops/awcms-jobs.env-scoped", "utf8");

    expect(runner).toMatch(
      /payroll:catalog-boundary:job[^)]*\)\s+WITHHOLD_ALL_DATABASE_URLS=1/
    );
    expect(scoped).toContain(
      "payroll:catalog-boundary:job PAYROLL_CATALOG_AUDIT_DATABASE_URL"
    );
    expect(scoped).not.toMatch(/payroll:catalog-boundary:job (?!PAYROLL_)/);
  });

  test("it is scheduled daily in the generated crontab", () => {
    const crontab = readFileSync("ops/awcms-jobs.crontab", "utf8");

    expect(crontab).toMatch(
      /^17 3 \* \* \* \S*flock -n \$AWCMS_LOCK\/payroll-catalog-boundary-job\.lock \$AWCMS_RUN_JOB payroll:catalog-boundary:job /m
    );
  });

  test("it refuses to start with a shared login in the environment (and not on a blank one)", () => {
    expect(() =>
      assertNoSharedLogins({ DATABASE_URL: "postgres://x" })
    ).toThrow(/shared database login/);
    expect(() =>
      assertNoSharedLogins({ WORKER_DATABASE_URL: "postgres://x" })
    ).toThrow(/shared database login/);
    expect(() =>
      assertNoSharedLogins({ SETUP_DATABASE_URL: "postgres://x" })
    ).toThrow(/shared database login/);
    expect(() =>
      assertNoSharedLogins({ DATABASE_URL: "  ", WORKER_DATABASE_URL: "" })
    ).not.toThrow();
  });

  test("the migration ships the role NOLOGIN, passwordless, with no table grant", () => {
    const sql = readFileSync(
      "sql/420_awcms_catalog_boundary_audit_role.sql",
      "utf8"
    ).replace(/--[^\n]*/g, "");

    expect(sql).toMatch(
      /CREATE ROLE awcms_catalog_boundary_audit\s+NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT/
    );
    expect(sql).not.toMatch(/PASSWORD/i);
    expect(sql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)/i);
  });
});
