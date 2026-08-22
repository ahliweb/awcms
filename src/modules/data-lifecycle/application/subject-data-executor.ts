/**
 * The executor ADR-0094 deferred — Issue #557.
 *
 * `subject-data-plan.ts` decides WHICH tables a request touches and how each
 * binds to the person. This file is the part that actually talks to the
 * database, and it is deliberately the boring half: every interesting decision
 * was already made by a descriptor its owning module declared.
 *
 * ## Identifiers are interpolated, and that is not a SQL-injection hole
 *
 * Table and column names cannot be bound as parameters, so they are
 * interpolated into the statement. What makes that safe here is not escaping
 * but PROVENANCE: every identifier comes from a `SubjectDataDescriptor`
 * declared in a `module.ts` — TypeScript source, not user input — and
 * `subject-data:registry:check` has already resolved each one against `sql/`.
 * `assertSafeIdentifier` is the belt to that braces: it refuses anything that
 * is not `[a-z_][a-z0-9_]*`, so a descriptor that ever did carry punctuation
 * fails loudly here instead of quietly composing a statement.
 *
 * The values — the subject's ids, the tenant id — are bound, always.
 *
 * ## The tenant predicate is written explicitly, under RLS
 *
 * Every statement carries `WHERE <tenantColumn> = ${tenantId}` even though
 * FORCE RLS would enforce it anyway. That is the rule this repo already learned
 * the hard way (ADR-0087 follow-up): a script that leans on RLS alone is one
 * `SET ROLE` away from touching every tenant, and the predicate costs nothing.
 */
import type {
  SubjectPlan,
  SubjectPlanEntry
} from "../domain/subject-data-plan";
import { erasureTargets } from "../domain/subject-data-plan";

/** `[a-z_][a-z0-9_]*` and nothing else. See this file's header. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function assertSafeIdentifier(identifier: string): string {
  if (!SAFE_IDENTIFIER.test(identifier)) {
    throw new Error(
      `Unsafe SQL identifier from a subject-data descriptor: ${JSON.stringify(identifier)}. ` +
        "Descriptors are code-declared and `subject-data:registry:check` resolves them against sql/, so this means the registry itself is wrong."
    );
  }

  return identifier;
}

/**
 * Validate, then DOUBLE-QUOTE.
 *
 * No exportable table has a reserved-word column today — checked, not assumed.
 * But `order`, `user`, `end` and `default` are all plausible column names, and
 * an unquoted one would make this engine throw for that table only, at runtime,
 * in a privacy request. Quoting costs nothing here because every identifier is
 * already lowercase `[a-z_][a-z0-9_]*`, which is exactly what an unquoted
 * identifier folds to — so the quoted form names the same column, always.
 */
function quoted(identifier: string): string {
  return `"${assertSafeIdentifier(identifier)}"`;
}

export type ColumnType = { column: string; dataType: string };

/**
 * Column names and types for the planned tables, read from `information_schema`
 * inside the same transaction.
 *
 * Not from `sql/` — a server must not parse migrations at runtime, and the
 * catalogue is the only source that cannot disagree with the database it is
 * about to write to. One query for every table in the plan, not one per table.
 *
 * `= ANY(sql.array(...))` rather than `IN ${sql(...)}`: this repo binds list
 * parameters exactly one way, and a bare interpolated array arrives as a
 * comma-joined STRING (a 22P02 at runtime, invisible in review).
 */
export async function loadColumnTypes(
  tx: Bun.SQL,
  tableNames: readonly string[]
): Promise<Map<string, ColumnType[]>> {
  const byTable = new Map<string, ColumnType[]>();

  if (tableNames.length === 0) {
    return byTable;
  }

  const rows = (await tx`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = ANY(${tx.array(tableNames.map(assertSafeIdentifier), "text")})
    ORDER BY table_name, ordinal_position
  `) as { table_name: string; column_name: string; data_type: string }[];

  for (const row of rows) {
    const list = byTable.get(row.table_name) ?? [];
    list.push({ column: row.column_name, dataType: row.data_type });
    byTable.set(row.table_name, list);
  }

  return byTable;
}

/**
 * Types an anonymising UPDATE may overwrite with a sentinel string.
 *
 * Deliberately a short allow-list. Writing `'[erased]'` into a `uuid`,
 * `integer` or `inet` column aborts the transaction, so an erasure would fail
 * whole rather than partially — and a descriptor that names a non-text column
 * as redactable is a mistake this skips over and REPORTS rather than one that
 * takes the request down.
 */
const ANONYMISABLE_TYPES = new Set([
  "text",
  "character varying",
  "character",
  "citext"
]);

/** What an anonymised text column holds. Not empty string: an operator reading the row must be able to tell "erased" from "never set". */
export const ANONYMIZED_TEXT = "[erased]";

export type SubjectTableExport = {
  key: string;
  tableName: string;
  ownerModuleKey: string;
  /** Columns held back — carried so the report can SAY what it withheld. */
  redactedColumns: readonly string[];
  rows: readonly Record<string, unknown>[];
  /**
   * Finding C5 — this table filled the row cap, so the export is INCOMPLETE for
   * it.
   *
   * Reported, never swallowed, and that is the whole reason a cap is acceptable
   * here at all. A subject-access export that quietly returned the first N rows
   * would answer a legal obligation with a number dressed as an answer —
   * strictly worse than the unbounded read it replaced, which was at least
   * honest. `redactedColumns` already establishes the shape: the report says
   * what it held back.
   */
  truncated: boolean;
};

/**
 * Finding C5 — the export ran 49 reads with no LIMIT, buffering every row of
 * every registered table into one interactive HTTP response, inside one
 * transaction.
 *
 * The cap is a SAFETY VALVE, not a page size. It sits far above any real
 * subject's footprint; the point is that a pathological case — an automation
 * account named as actor on a million audit rows — degrades into a flagged,
 * incomplete report rather than a transaction that buffers a million rows and
 * then times out with nothing to show for it.
 *
 * There is deliberately no cursor. Paging a subject-access export would mean
 * the "complete answer" is assembled by a client across requests, and every
 * page boundary is a place where a partial answer can be mistaken for the whole
 * one. A flagged truncation says the true thing in one response.
 */
export const SUBJECT_EXPORT_ROW_LIMIT = 10_000;

export type SubjectExportOptions = {
  rowLimit?: number;
};

/**
 * The `WHERE` fragment matching a row to the subject, as SQL text plus its
 * bound values.
 *
 * Several subject columns are OR-ed, not AND-ed. A row naming the person as
 * both actor and target is one row that appears once; requiring every column to
 * match would return nothing at all for the ordinary case where only one does.
 */
function subjectPredicate(
  entry: SubjectPlanEntry,
  firstParameterIndex: number
): { sql: string; values: string[] } {
  const values: string[] = [];
  const clauses = entry.matches.map((match) => {
    const column = quoted(match.column);
    const placeholder = `$${firstParameterIndex + values.length}`;
    values.push(match.value);

    return match.match === "jsonb_array_contains"
      ? // The one table that keeps a LIST of ids
        // (`awcms_tenant_auth_policies.break_glass_identity_ids`). `to_jsonb`
        // on a bound text value, so the id is still a parameter.
        `${column} @> to_jsonb(${placeholder}::text)`
      : `${column} = ${placeholder}::uuid`;
  });

  return { sql: `(${clauses.join(" OR ")})`, values };
}

/**
 * Read every exportable table for this subject.
 *
 * Redacted columns are excluded by SELECTing the complement rather than by
 * deleting keys afterwards. Filtering after the read means the values were in
 * the process, in whatever the driver logged, and one forgotten `delete` away
 * from the response — and a token hash that reaches the report is not a bug you
 * find by reading the diff.
 */
export async function readSubjectExport(
  tx: Bun.SQL,
  tenantId: string,
  plan: SubjectPlan,
  columnTypes: ReadonlyMap<string, ColumnType[]>,
  options: SubjectExportOptions = {}
): Promise<SubjectTableExport[]> {
  const rowLimit = options.rowLimit ?? SUBJECT_EXPORT_ROW_LIMIT;
  const results: SubjectTableExport[] = [];

  for (const entry of plan.exportEntries) {
    const table = quoted(entry.tableName);
    const tenantColumn = quoted(entry.tenantColumn);
    const redacted = new Set(entry.redactedColumns);
    const selected = (columnTypes.get(entry.tableName) ?? [])
      .map((column) => column.column)
      .filter((column) => !redacted.has(column))
      .map(quoted);

    // Every column redacted means the row has nothing left to disclose. Reading
    // it would return a count dressed as content.
    if (selected.length === 0) {
      results.push({
        key: entry.key,
        tableName: entry.tableName,
        ownerModuleKey: entry.ownerModuleKey,
        redactedColumns: entry.redactedColumns,
        rows: [],
        // Nothing was read, so nothing was cut short. `false` here is a fact,
        // not a default.
        truncated: false
      });
      continue;
    }

    const predicate = subjectPredicate(entry, 2);
    // `rowLimit + 1` is what makes `truncated` truthful rather than a guess:
    // reading exactly the limit cannot distinguish "there were exactly N" from
    // "there were more". One extra row answers it, and is discarded.
    const limitPlaceholder = `$${2 + predicate.values.length}`;
    const rows = (await tx.unsafe(
      `SELECT ${selected.join(", ")} FROM ${table} ` +
        `WHERE ${tenantColumn} = $1::uuid AND ${predicate.sql} ` +
        `LIMIT ${limitPlaceholder}`,
      [tenantId, ...predicate.values, rowLimit + 1]
    )) as Record<string, unknown>[];

    const truncated = rows.length > rowLimit;

    results.push({
      key: entry.key,
      tableName: entry.tableName,
      ownerModuleKey: entry.ownerModuleKey,
      redactedColumns: entry.redactedColumns,
      rows: truncated ? rows.slice(0, rowLimit) : rows,
      truncated
    });
  }

  return results;
}

export type SubjectErasureOutcome = {
  key: string;
  tableName: string;
  erasure: SubjectPlanEntry["erasure"];
  rowsAffected: number;
};

export type SubjectErasureResult = {
  outcomes: readonly SubjectErasureOutcome[];
  /**
   * Columns a descriptor named as redactable that this engine did NOT write,
   * because their type cannot hold the sentinel.
   *
   * Returned rather than swallowed. An erasure that silently skipped a column
   * would report success while leaving the very value the descriptor's author
   * singled out as the personal one.
   */
  skippedColumns: readonly string[];
};

/**
 * Run the erasure.
 *
 * `erasureTargets` has already dropped the ~90 tables answering
 * `severed_with_subject_row` and everything held under obligation, so what
 * arrives here is only what must really be written. That filter is the whole
 * safety property: an executor looping over `plan.entries` would rewrite ninety
 * stamp columns and destroy the tenant's own record of who did what.
 */
export async function runSubjectErasure(
  tx: Bun.SQL,
  tenantId: string,
  plan: SubjectPlan,
  columnTypes: ReadonlyMap<string, ColumnType[]>
): Promise<SubjectErasureResult> {
  const outcomes: SubjectErasureOutcome[] = [];
  const skipped: string[] = [];

  for (const entry of erasureTargets(plan)) {
    const table = quoted(entry.tableName);
    const tenantColumn = quoted(entry.tenantColumn);
    const predicate = subjectPredicate(entry, 2);
    let rowsAffected = 0;

    if (entry.erasure === "hard_delete") {
      const rows = (await tx.unsafe(
        `DELETE FROM ${table} ` +
          `WHERE ${tenantColumn} = $1::uuid AND ${predicate.sql} RETURNING 1`,
        [tenantId, ...predicate.values]
      )) as unknown[];
      rowsAffected = rows.length;
    } else if (entry.erasure === "anonymize") {
      // Only the columns the descriptor itself named. Anonymising a column its
      // owner did not name would be this engine deciding what counts as
      // personal inside another module's table — the coupling ADR-0013 §6
      // exists to prevent.
      const types = new Map(
        (columnTypes.get(entry.tableName) ?? []).map((entry) => [
          entry.column,
          entry.dataType
        ])
      );
      const assignments: string[] = [];
      const values: string[] = [];
      const bind = (value: string): string => {
        values.push(value);
        return `$${1 + predicate.values.length + values.length}`;
      };

      for (const column of entry.redactedColumns) {
        const dataType = types.get(column);

        if (dataType && ANONYMISABLE_TYPES.has(dataType)) {
          assignments.push(`${quoted(column)} = ${bind(ANONYMIZED_TEXT)}`);
        } else {
          skipped.push(
            `${entry.tableName}.${column} (${dataType ?? "absent"})`
          );
        }
      }

      // A jsonb LIST holding the subject's id is not scrubbed by overwriting a
      // neighbouring column — the entry itself has to go, or an erased person
      // keeps whatever the list confers. Today that is
      // `awcms_tenant_auth_policies.break_glass_identity_ids`, where the list
      // confers a standing bypass of the tenant's SSO requirement.
      for (const match of entry.matches) {
        if (match.match === "jsonb_array_contains") {
          const column = quoted(match.column);
          assignments.push(
            `${column} = COALESCE((SELECT jsonb_agg(element) FROM jsonb_array_elements(${column}) AS element WHERE element <> to_jsonb(${bind(match.value)}::text)), '[]'::jsonb)`
          );
        }
      }

      if (assignments.length > 0) {
        const rows = (await tx.unsafe(
          `UPDATE ${table} SET ${assignments.join(", ")} ` +
            `WHERE ${tenantColumn} = $1::uuid AND ${predicate.sql} RETURNING 1`,
          [tenantId, ...predicate.values, ...values]
        )) as unknown[];
        rowsAffected = rows.length;
      }
    } else if (entry.erasure === "status_transition_then_purge") {
      // The row's own lifecycle already models its ending — `revoked_at` on a
      // machine credential. Flipping it is the erasure; ordinary retention
      // carries it the rest of the way.
      //
      // The column is HARD-CODED, which is a coupling neither side shows:
      // the descriptor says "flip a status" without saying which.
      // `subject-data:registry:check` refuses this erasure mode for a table
      // without `revoked_at`, so a mismatch is a CI failure rather than a throw
      // in the middle of an erasure whose request has already been claimed.
      const rows = (await tx.unsafe(
        `UPDATE ${table} SET "revoked_at" = now() ` +
          `WHERE ${tenantColumn} = $1::uuid AND ${predicate.sql} AND revoked_at IS NULL RETURNING 1`,
        [tenantId, ...predicate.values]
      )) as unknown[];
      rowsAffected = rows.length;
    }

    outcomes.push({
      key: entry.key,
      tableName: entry.tableName,
      erasure: entry.erasure,
      rowsAffected
    });
  }

  return { outcomes, skippedColumns: skipped };
}
