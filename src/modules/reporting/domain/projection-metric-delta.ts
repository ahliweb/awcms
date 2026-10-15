/**
 * The delta one metric rule contributes for one fetched batch (Issue #753; the
 * `sumColumn` form, Issue #944).
 *
 * This is the ONE place that turns "a batch of source rows" into "a number to
 * add to a metric". The incremental worker and the rebuild pass both use it
 * (the reconciliation computes the same quantity in SQL) -- a rebuild that
 * counted differently from the steady state would make every reconciliation a
 * mismatch.
 *
 * A rule counts the matching ROWS by default. With `sumColumn` it adds up that
 * column over the matching rows instead: the way a projection carries a
 * QUANTITY (booked unit-nights, booked seconds) rather than an event count,
 * without the engine growing a second path. The column must be a non-negative
 * integer the source row already carries; a value that is not a safe
 * non-negative integer is a defect in the source, not something to round, so it
 * throws and the pass rolls back rather than writing a wrong number.
 */
import type { ProjectionCursorMetricRule } from "../../_shared/module-contract";

function matches(
  row: Record<string, unknown>,
  rule: ProjectionCursorMetricRule
): boolean {
  return (
    rule.matchColumn === undefined ||
    String(row[rule.matchColumn]) === rule.matchValue
  );
}

function quantityOf(value: unknown, column: string): number {
  // Postgres bigint arrives as a string; an integer column as a number.
  const quantity = typeof value === "string" ? Number(value) : value;

  if (
    typeof quantity !== "number" ||
    !Number.isSafeInteger(quantity) ||
    quantity < 0
  ) {
    throw new Error(
      `reporting projection engine: sumColumn "${column}" must hold a non-negative integer (got ${JSON.stringify(value)}).`
    );
  }

  return quantity;
}

/** The signed amount `rule` adds to its metric for `rows`. */
export function computeRuleDelta(
  rows: readonly Record<string, unknown>[],
  rule: ProjectionCursorMetricRule
): number {
  let amount = 0;

  for (const row of rows) {
    if (!matches(row, rule)) {
      continue;
    }

    amount +=
      rule.sumColumn === undefined
        ? 1
        : quantityOf(row[rule.sumColumn], rule.sumColumn);
  }

  return rule.effect === "increment" ? amount : -amount;
}

/** Every column a stream's rules read, besides the cursor column. */
export function ruleColumns(
  rules: readonly ProjectionCursorMetricRule[]
): string[] {
  const columns = new Set<string>();

  for (const rule of rules) {
    if (rule.matchColumn !== undefined) {
      columns.add(rule.matchColumn);
    }
    if (rule.sumColumn !== undefined) {
      columns.add(rule.sumColumn);
    }
  }

  return [...columns];
}
