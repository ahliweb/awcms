/**
 * Every reporting projection's SOURCE table must be readable by `awcms_worker`
 * (Issue #887, ADR-0126).
 *
 * `scripts/reporting-projections-refresh.ts` runs the incremental worker as
 * `awcms_worker` whenever `WORKER_DATABASE_URL` is set. A projection descriptor
 * that is perfectly well formed, registered, and covered by a request-path test
 * (those run as `awcms_app`) still fails there with `permission denied for table
 * <name>` if no migration granted the worker SELECT — and nothing else in
 * `bun run check` notices, because the registry gate validates SHAPE, not
 * privileges. `inventory.low_stock` shipped exactly that way until this existed;
 * `site-search:sources:check` and `data-lifecycle:worker-grants:check` are the
 * siblings that already ask this question of their own registries.
 *
 * It reads what the migrations WRITE, not what a database has applied. The
 * behavioural half (`has_table_privilege` against a real migrated database) is
 * in `tests/integration/inventory-ledger.integration.test.ts`.
 *
 * SELECT is the only privilege asked for: the engine reads sources and writes
 * exclusively to its own `awcms_reporting_projection_*` tables.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { collectProjectionDescriptors } from "../src/modules/reporting/domain/projection-registry";
import { loadMigrations } from "../scripts/lib/migrations";
import { grantsPrivilegeToRole } from "../scripts/sql-grants";

const WORKER_ROLE = "awcms_worker";

function sourceTables(): { descriptorKey: string; tableName: string }[] {
  return collectProjectionDescriptors(listModules()).flatMap((descriptor) => {
    const streams = [
      ...(descriptor.source.strategy === "cursor_table"
        ? descriptor.source.streams
        : []),
      ...descriptor.rebuildSource.streams
    ];

    return [...new Set(streams.map((stream) => stream.tableName))].map(
      (tableName) => ({ descriptorKey: descriptor.key, tableName })
    );
  });
}

function migrationText(): string {
  return loadMigrations()
    .map((migration) => migration.sql)
    .join("\n");
}

describe("reporting projection sources are readable by awcms_worker", () => {
  test("there is at least one projection source to check (the test is not vacuous)", () => {
    const tables = sourceTables().map((entry) => entry.tableName);

    expect(tables).toContain("awcms_inventory_low_stock_signals");
    expect(tables).toContain("awcms_abac_decision_logs");
  });

  test("every source table of every registered projection has a GRANT SELECT to awcms_worker in sql/", () => {
    const sql = migrationText();
    const missing = sourceTables().filter(
      ({ tableName }) =>
        !grantsPrivilegeToRole(sql, tableName, "SELECT", WORKER_ROLE)
    );

    expect(missing).toEqual([]);
  });

  test("the check bites: with the inventory grant removed it names the table", () => {
    const withoutGrant = migrationText().replace(
      "GRANT SELECT ON awcms_inventory_low_stock_signals TO awcms_worker;",
      "-- grant removed for this probe"
    );
    const missing = sourceTables().filter(
      ({ tableName }) =>
        !grantsPrivilegeToRole(withoutGrant, tableName, "SELECT", WORKER_ROLE)
    );

    expect(missing).toEqual([
      {
        descriptorKey: "inventory.low_stock",
        tableName: "awcms_inventory_low_stock_signals"
      }
    ]);
  });
});
