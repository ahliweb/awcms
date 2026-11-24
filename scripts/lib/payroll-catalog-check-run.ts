/**
 * The shared body of the payroll catalog check (Issue #1015, #1095): load the
 * catalog snapshot through a connection, analyse it, and turn the outcome into
 * lines and an exit code. Two commands run it:
 *
 *   - `payroll:catalog-boundary:check`  (operator form, `DATABASE_URL`);
 *   - `payroll:catalog-boundary:job`    (scheduled form, role
 *                                         `awcms_catalog_boundary_audit`, sql/420).
 *
 * Pure apart from the snapshot read, so the verdict logic is unit-testable with
 * a hand-built snapshot.
 */
import { PAYROLL_EXPECTED_OWNERS } from "../../src/modules/_shared/payroll-data-boundary";
import {
  analysePayrollCatalog,
  loadPayrollCatalogSnapshot,
  staleCatalogExemptions,
  type CatalogSnapshot
} from "./payroll-catalog-boundary";

export type PayrollCatalogRunOptions = {
  /** Fail loudly (with its own message) when owners cannot be accounted for and `PAYROLL_EXPECTED_OWNERS` is empty. */
  requireOwnersOnSplitRole?: boolean;
};

export type PayrollCatalogRunResult = {
  ok: boolean;
  /** Lines for stdout (ok) or stderr (not ok). */
  lines: string[];
  /** The findings, for a test. */
  findingCodes: string[];
  /** Each finding, for a structured log line (code, object, message). */
  findings: { code: string; object: string; message: string }[];
  /** Stale `PAYROLL_CATALOG_EXEMPTIONS` entries. */
  staleExemptions: string[];
  /** True when owners cannot be accounted for and `PAYROLL_EXPECTED_OWNERS` is empty (a split-role hint). */
  expectedOwnersMissing: boolean;
};

export function parseExpectedOwners(
  value: string | undefined
): readonly string[] {
  return (value ?? "")
    .split(",")
    .map((owner) => owner.trim())
    .filter(Boolean);
}

export function evaluatePayrollCatalog(
  snapshot: CatalogSnapshot,
  env: Record<string, string | undefined>,
  options: PayrollCatalogRunOptions = {}
): PayrollCatalogRunResult {
  // Split-role deployments (migrations run by one role, payroll objects owned
  // by another) name the owner role(s) here; the default is the owner of the
  // migration ledger (docs/awcms/hr-payroll.md section 13.3).
  const configuredOwners = parseExpectedOwners(env.PAYROLL_EXPECTED_OWNERS);
  const findings = analysePayrollCatalog(snapshot, {
    expectedOwners: [...PAYROLL_EXPECTED_OWNERS, ...configuredOwners]
  });
  const stale = staleCatalogExemptions(snapshot);

  if (findings.length === 0 && stale.length === 0) {
    return {
      ok: true,
      findingCodes: [],
      findings: [],
      staleExemptions: [],
      expectedOwnersMissing: false,
      lines: [
        `payroll:catalog-boundary OK - ${snapshot.rules.length} rule(s), ${snapshot.functions.length} function(s), ${snapshot.triggers.length} trigger(s), ${snapshot.grants.length} grant(s), ${snapshot.relations.length} relation(s), ${snapshot.memberships.length} role membership(s), ${snapshot.publications.length} publication(s), ${snapshot.foreignTables.length} foreign table(s) and ${snapshot.dependencies.length} dependency row(s) read from the catalog; nothing outside the payroll family reaches a payroll table.`
      ]
    };
  }

  const lines: string[] = [];
  const ownerFindings = findings.filter(
    (finding) =>
      finding.code === "payroll-owner" ||
      finding.code === "payroll-ledger-missing"
  );

  // A split-role deployment with no PAYROLL_EXPECTED_OWNERS cannot be told from
  // a payroll table that really changed hands; both fail, and this line says
  // which variable to look at first (Issue #1095).
  const expectedOwnersMissing =
    options.requireOwnersOnSplitRole === true &&
    ownerFindings.length > 0 &&
    configuredOwners.length === 0;

  if (expectedOwnersMissing) {
    lines.push(
      "payroll:catalog-boundary FAILED - PAYROLL_EXPECTED_OWNERS is not set, and payroll objects have an owner other than the migration-ledger owner (or the ledger is missing). On a split-role deployment (migrations run by one role, payroll objects owned by another) name the owner role(s) in PAYROLL_EXPECTED_OWNERS=role1,role2; on any other deployment this is a payroll object that changed hands, which is the finding below."
    );
  } else {
    lines.push("payroll:catalog-boundary FAILED -");
  }

  for (const finding of findings) {
    lines.push(`  - [${finding.code}] ${finding.message}`);
  }

  for (const object of stale) {
    lines.push(
      `  - stale PAYROLL_CATALOG_EXEMPTIONS entry: ${object} no longer exists.`
    );
  }

  return {
    ok: false,
    lines,
    findingCodes: findings.map((finding) => finding.code),
    findings: findings.map((finding) => ({
      code: finding.code,
      object: finding.object,
      message: finding.message
    })),
    staleExemptions: stale,
    expectedOwnersMissing
  };
}

export async function runPayrollCatalogCheck(
  sql: Bun.SQL,
  env: Record<string, string | undefined>,
  options: PayrollCatalogRunOptions = {}
): Promise<PayrollCatalogRunResult> {
  const snapshot = await loadPayrollCatalogSnapshot(
    sql as unknown as Parameters<typeof loadPayrollCatalogSnapshot>[0]
  );

  return evaluatePayrollCatalog(snapshot, env, options);
}
