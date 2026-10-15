/**
 * The delegated-snapshot baseline of `data-lifecycle:worker-grants:check`
 * (Issue #1040).
 *
 * `archive-purge` records a dry-run snapshot for every delegated descriptor as
 * `awcms_worker`. Some of those tables the worker must not read, so they are a
 * KNOWN list; this proves the gate fails when the list and the code disagree in
 * either direction, using fixtures rather than the live registry.
 */
import { describe, expect, test } from "bun:test";

import {
  compareDelegatedBaseline,
  findUnreadableDelegatedTables,
  KNOWN_UNREADABLE_DELEGATED_TABLES
} from "../scripts/data-lifecycle-worker-grants-check";
import { loadMigrations } from "../scripts/lib/migrations";
import { listModules } from "../src/modules";

const migrationSql = loadMigrations()
  .map((migration) => migration.sql)
  .join("\n");

function fixtureModules(
  tableName: string,
  executionMode = "delegated"
): ReturnType<typeof listModules> {
  return [
    {
      key: "fixture",
      dataLifecycle: [{ tableName, executionMode, scope: "tenant" }]
    }
  ] as unknown as ReturnType<typeof listModules>;
}

describe("the delegated-snapshot baseline", () => {
  test("equals the live set: no new and no stale entry", () => {
    const live = findUnreadableDelegatedTables(listModules(), migrationSql);

    expect(
      compareDelegatedBaseline(live, KNOWN_UNREADABLE_DELEGATED_TABLES)
    ).toEqual({ added: [], stale: [] });
  });

  test("a NEW unreadable delegated descriptor is reported as added", () => {
    const live = findUnreadableDelegatedTables(
      fixtureModules("awcms_fixture_new_delegated"),
      migrationSql
    );

    expect(live).toEqual(["awcms_fixture_new_delegated"]);
    expect(
      compareDelegatedBaseline(live, KNOWN_UNREADABLE_DELEGATED_TABLES).added
    ).toEqual(["awcms_fixture_new_delegated"]);
  });

  test("a delegated descriptor the worker CAN read is not unreadable", () => {
    expect(
      findUnreadableDelegatedTables(
        fixtureModules("awcms_fixture_readable"),
        "GRANT SELECT ON awcms_fixture_readable TO awcms_worker;"
      )
    ).toEqual([]);
  });

  test("a generic descriptor is not this gate's business", () => {
    expect(
      findUnreadableDelegatedTables(
        fixtureModules("awcms_fixture_generic", "generic"),
        migrationSql
      )
    ).toEqual([]);
  });

  test("a baseline entry that became readable is reported as stale", () => {
    expect(
      compareDelegatedBaseline([], ["awcms_inventory_movements"]).stale
    ).toEqual(["awcms_inventory_movements"]);
  });
});
