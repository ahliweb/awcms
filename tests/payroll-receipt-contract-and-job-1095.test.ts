/**
 * Issue #1095 follow-up (M2, M3, L1, L2). No database.
 *
 *   - the receipt and the projection of OLD stored bodies, validated against the
 *     schema the OpenAPI contract publishes (`additionalProperties: false`);
 *   - the scheduled job's activation states, run as a real child process:
 *     not activated is a loud exit 0, a wrong configuration is a refusal.
 */
import { beforeAll, describe, expect, test } from "bun:test";

import {
  createContractValidator,
  loadBundledContract
} from "../scripts/api-contract-lint";
import {
  MUTATION_RECEIPT_KEYS,
  pickReceipt,
  projectStoredAccrueBody,
  projectStoredMutationBody,
  toMutationReceipt
} from "../src/modules/hr-commission/application/hr-commission-accrual-receipt";
import type { CommissionAccrual } from "../src/modules/hr-commission/application/hr-commission-accrual-ledger";
import { evaluatePayrollCatalog } from "../scripts/lib/payroll-catalog-check-run";
import { isPayrollCatalogAuditActivated } from "../src/lib/database/payroll-catalog-audit-client";

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

const SECRETS = [
  FULL.amount,
  FULL.employmentId,
  FULL.ruleId,
  FULL.sourceRef,
  FULL.paymentReference!,
  FULL.baseAmount!,
  FULL.rate!,
  FULL.fixedAmount!
];

describe("the receipt against the published contract (L2)", () => {
  let receiptValid: (value: unknown) => { valid: boolean; errors: string };
  let createdValid: (value: unknown) => { valid: boolean; errors: string };

  beforeAll(async () => {
    const doc = await loadBundledContract();

    receiptValid = createContractValidator(
      doc,
      "/components/schemas/HrCommissionAccrualMutationReceipt"
    );
    createdValid = createContractValidator(
      doc,
      "/components/schemas/HrCommissionAccrualCreated"
    );
  });

  test("the receipt of a full accrual validates, and lists exactly the receipt keys", () => {
    const receipt = toMutationReceipt(FULL);

    expect(receiptValid(receipt)).toEqual({ valid: true, errors: "" });
    expect(Object.keys(receipt).sort()).toEqual(
      [...MUTATION_RECEIPT_KEYS, "masked"].sort()
    );
  });

  test("MUTATION: the schema refuses a body that carries the amount, the beneficiary or any unknown key", () => {
    const receipt = toMutationReceipt(FULL);

    for (const extra of [
      { amount: "1.000000" },
      { employmentId: FULL.employmentId },
      { paymentReference: "x" },
      { somethingNew: 1 }
    ]) {
      expect(receiptValid({ ...receipt, ...extra }).valid).toBe(false);
    }

    expect(receiptValid({ ...receipt, masked: false }).valid).toBe(false);
  });

  test("the POST /accruals envelope validates with a receipt and refuses a full accrual", () => {
    const body = {
      success: true,
      data: { replayed: false, accrual: toMutationReceipt(FULL) },
      meta: {}
    };

    expect(createdValid(body)).toEqual({ valid: true, errors: "" });
    expect(
      createdValid({ ...body, data: { replayed: false, accrual: FULL } }).valid
    ).toBe(false);
  });

  test("the OpenAPI operations point at the receipt schema, not at the full accrual", async () => {
    const doc = (await loadBundledContract()) as {
      paths: Record<string, Record<string, { responses: unknown }>>;
    };
    const refsOf = (path: string, verb: string) =>
      JSON.stringify(doc.paths[path]![verb]!.responses);

    for (const action of ["approve", "release", "pay", "void"]) {
      const refs = refsOf(
        `/api/v1/hr-commission/accruals/{id}/${action}`,
        "post"
      );

      expect(refs).toContain("HrCommissionAccrualMutationReceipt");
      expect(refs).not.toContain('schemas/HrCommissionAccrual"');
    }

    expect(refsOf("/api/v1/hr-commission/accruals", "post")).toContain(
      "HrCommissionAccrualCreated"
    );
  });
});

describe("replaying a body stored BEFORE the masking (L1)", () => {
  test("a stored full mutation body is projected onto the receipt keys", () => {
    const projected = projectStoredMutationBody({
      success: true,
      data: FULL,
      meta: { keep: 1 }
    }) as { success: boolean; data: Record<string, unknown>; meta: unknown };

    expect(projected.success).toBe(true);
    expect(projected.meta).toEqual({ keep: 1 });
    expect(projected.data.masked).toBe(true);
    expect(projected.data.id).toBe(FULL.id);

    for (const secret of SECRETS) {
      expect(JSON.stringify(projected)).not.toContain(secret);
    }
  });

  test("a stored full POST /accruals body is projected, and `replayed` survives", () => {
    const projected = projectStoredAccrueBody({
      success: true,
      data: { replayed: true, accrual: FULL },
      meta: {}
    }) as { data: { replayed: boolean; accrual: Record<string, unknown> } };

    expect(projected.data.replayed).toBe(true);
    expect(projected.data.accrual.masked).toBe(true);

    for (const secret of SECRETS) {
      expect(JSON.stringify(projected)).not.toContain(secret);
    }
  });

  test("an already-masked body is unchanged by the projection (idempotent)", () => {
    const receipt = toMutationReceipt(FULL);

    expect(pickReceipt(receipt)).toEqual(receipt);
  });

  test("a body of an unexpected shape projects to the bare marker, never to the raw value", () => {
    expect(pickReceipt("a string")).toEqual({ masked: true });
    expect(pickReceipt(null)).toEqual({ masked: true });
    expect(projectStoredMutationBody({ success: true, data: "oops" })).toEqual({
      success: true,
      data: { masked: true }
    });
  });
});

describe("the job's activation states (M3), as a real child process", () => {
  const SHARED = [
    "DATABASE_URL",
    "WORKER_DATABASE_URL",
    "SETUP_DATABASE_URL",
    "PAYROLL_CATALOG_AUDIT_DATABASE_URL",
    "PAYROLL_EXPECTED_OWNERS"
  ];

  async function runJob(env: Record<string, string>) {
    const clean = { ...process.env } as Record<string, string | undefined>;

    for (const name of SHARED) delete clean[name];

    const child = Bun.spawn(
      ["bun", "scripts/payroll-catalog-boundary-job.ts"],
      {
        cwd: process.cwd(),
        env: { ...clean, ...env, LOG_LEVEL: "debug" },
        stdout: "pipe",
        stderr: "pipe"
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited
    ]);

    return { stdout, stderr, exitCode };
  }

  const entries = (stdout: string) =>
    stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line) as Record<string, unknown>);

  test("activation is the URL being present and not blank", () => {
    expect(isPayrollCatalogAuditActivated({})).toBe(false);
    expect(
      isPayrollCatalogAuditActivated({
        PAYROLL_CATALOG_AUDIT_DATABASE_URL: "  "
      })
    ).toBe(false);
    expect(
      isPayrollCatalogAuditActivated({
        PAYROLL_CATALOG_AUDIT_DATABASE_URL: "postgres://x"
      })
    ).toBe(true);
  });

  test("not activated: exit 0 with the explicit SKIPPED line and a structured warning", async () => {
    const result = await runJob({});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "payroll:catalog-boundary:job SKIPPED (not activated)"
    );

    const skipped = entries(result.stdout).find(
      (entry) =>
        entry.message === "payroll.catalog_boundary.skipped_not_activated"
    );

    expect(skipped?.level).toBe("warning");
  });

  test("a URL that is set next to a shared login is REFUSED: exit 1 and a structured error line", async () => {
    const result = await runJob({
      PAYROLL_CATALOG_AUDIT_DATABASE_URL:
        "postgres://awcms_catalog_boundary_audit:x@127.0.0.1:1/awcms",
      DATABASE_URL: "postgres://app:x@127.0.0.1:1/awcms"
    });
    const refused = entries(result.stdout).find(
      (entry) => entry.message === "payroll.catalog_boundary.job_refused"
    );

    expect(result.exitCode).toBe(1);
    expect(refused?.level).toBe("error");
    expect(String(refused?.reason)).toContain("shared database login");
    // never a connection string
    expect(result.stdout + result.stderr).not.toContain(":x@");
  });

  test("a URL that is set but unreachable is REFUSED (exit 1), not skipped", async () => {
    const result = await runJob({
      PAYROLL_CATALOG_AUDIT_DATABASE_URL:
        "postgres://awcms_catalog_boundary_audit:x@127.0.0.1:1/awcms"
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain("SKIPPED");
  }, 30_000);

  test("findings reach the logger at error level: the runner result carries them structured", () => {
    const result = evaluatePayrollCatalog(
      {
        migrationOwner: null,
        columns: [],
        foreignKeys: [],
        roles: [],
        namedObjects: [],
        rules: [],
        functions: [],
        triggers: [],
        grants: [],
        inheritance: [],
        relations: [],
        memberships: [],
        publications: [],
        foreignTables: [],
        dependencies: []
      },
      {},
      { requireOwnersOnSplitRole: true }
    );

    expect(result.ok).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]).toHaveProperty("code");
    expect(result.findings[0]).toHaveProperty("object");
    expect(result.findings[0]).toHaveProperty("message");
    expect(result.expectedOwnersMissing).toBe(true);
  });
});
