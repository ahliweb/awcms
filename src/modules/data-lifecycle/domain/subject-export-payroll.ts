/**
 * Pure helpers for how the subject-access export treats payroll-boundary tables
 * (Issue #1018, `_shared/payroll-data-boundary.ts`).
 *
 * ## Why this is its own file
 *
 * The route decides three things about such a table: whether it IS one, what is
 * allowed to be STORED for an Idempotency-Key replay, and how a replay gets the
 * rows back. All three are pure functions of the report's shape, so they can be
 * proved without a database.
 *
 * ## What is stored for a replay (audit M2)
 *
 * `awcms_idempotency_keys.response_body` lives for 30 days, outside the payroll
 * boundary, and is not behind `hr_commission.accruals.read`. So the stored body
 * of an export never carries payroll rows: `rows` is emptied and only the
 * record ids are kept (`payrollRowIds`) with a marker. A replay re-checks the
 * caller's permission, RE-READS the rows by those ids (an idempotent read) and
 * records the sensitive read again; without the permission the table is
 * withheld.
 */
import {
  isPayrollOwnerModule,
  isPayrollTable
} from "../../_shared/payroll-data-boundary";

/**
 * A table is payroll-boundary by its NAME or by its OWNER MODULE (L1). The name
 * rule misses a renamed table and every table of a payroll module that is not
 * pay itself (`hr_commission.rules`); the owner rule is the net under it.
 */
export function isPayrollBoundaryTable(table: {
  tableName?: string | null;
  ownerModuleKey?: string | null;
}): boolean {
  return (
    isPayrollTable(table.tableName ?? "") ||
    isPayrollOwnerModule(table.ownerModuleKey)
  );
}

/** The slice of a report table the helpers read and write. Extra members ride through. */
export type ExportedTable = {
  key?: string;
  tableName?: string;
  ownerModuleKey?: string;
  rows?: Record<string, unknown>[];
  payrollRowIds?: string[];
  payrollRowsStripped?: true;
  [member: string]: unknown;
};

/**
 * The tables as they may be STORED: payroll tables keep their metadata and the
 * ids of their rows, never the rows. Everything else is untouched.
 */
export function stripPayrollRows<T extends ExportedTable>(
  tables: readonly T[]
): T[] {
  return tables.map((table) => {
    if (!isPayrollBoundaryTable(table)) return table;

    return {
      ...table,
      rows: [],
      payrollRowIds: (table.rows ?? []).map((row) => String(row.id)),
      payrollRowsStripped: true
    };
  });
}

/** The record ids a stripped table stands for (also accepts an un-stripped legacy body). */
export function storedRowIds(table: ExportedTable): string[] {
  if (Array.isArray(table.payrollRowIds)) return table.payrollRowIds;

  return (table.rows ?? []).map((row) => String(row.id));
}
