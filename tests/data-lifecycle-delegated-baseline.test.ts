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
  hasWorkerCountFunction,
  KNOWN_UNREADABLE_DELEGATED_TABLES
} from "../scripts/data-lifecycle-worker-grants-check";
import { loadMigrations } from "../scripts/lib/migrations";
import { listModules } from "../src/modules";
import { planLifecycleDryRun } from "../src/modules/data-lifecycle/application/dry-run-planner";

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

describe("count-only worker functions (Issue #1042)", () => {
  const FN = "awcms_inventory_lifecycle_eligible_count";
  const TABLE = "awcms_inventory_movements";
  const OWNER = "awcms_inventory_lifecycle_counter";

  /** A minimal, fully compliant definition; each test breaks one piece. */
  function fixture(
    overrides: {
      header?: string;
      branch?: string;
      revoke?: string;
      grantExecute?: string;
      owner?: string;
      columnGrant?: string;
      extra?: string;
    } = {}
  ): string {
    const header =
      overrides.header ??
      "LANGUAGE plpgsql\nSECURITY DEFINER\nSTABLE\nSET search_path = public, pg_temp\n";
    const branch =
      overrides.branch ??
      `IF p_table = '${TABLE}' THEN
    SELECT count(*)::integer INTO v_count FROM ${TABLE} AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;`;

    return `
GRANT SELECT (tenant_id, created_at) ON ${TABLE} TO ${OWNER};
${overrides.columnGrant ?? ""}
CREATE OR REPLACE FUNCTION ${FN}(p_table text, p_tenant_id uuid, p_cutoff timestamptz)
RETURNS integer
${header}AS $function$
DECLARE v_count integer;
BEGIN
  ${branch}
  ELSE
    RAISE EXCEPTION 'no' USING ERRCODE = '22023';
  END IF;
  RETURN v_count;
END;
$function$;
${
  overrides.revoke ??
  `REVOKE ALL ON FUNCTION ${FN}(text, uuid, timestamptz) FROM PUBLIC;`
}
${
  overrides.grantExecute ??
  `GRANT EXECUTE ON FUNCTION ${FN}(text, uuid, timestamptz) TO awcms_worker;`
}
${
  overrides.owner ??
  `ALTER FUNCTION ${FN}(text, uuid, timestamptz) OWNER TO ${OWNER};`
}
${overrides.extra ?? ""}`;
  }

  const covered = (sql: string, cursor = "created_at") =>
    hasWorkerCountFunction(sql, TABLE, cursor);

  test("the baseline ships empty: every delegated table is covered", () => {
    expect(KNOWN_UNREADABLE_DELEGATED_TABLES).toEqual([]);
    expect(findUnreadableDelegatedTables(listModules(), migrationSql)).toEqual(
      []
    );
  });

  test("a complete definition covers the table", () => {
    expect(covered(fixture())).toBe(true);
    expect(
      findUnreadableDelegatedTables(
        [
          {
            key: "inventory",
            dataLifecycle: [
              {
                tableName: TABLE,
                executionMode: "delegated",
                scope: "tenant",
                cursorColumn: "created_at"
              }
            ]
          }
        ] as unknown as ReturnType<typeof listModules>,
        fixture()
      )
    ).toEqual([]);
  });

  test("a branch that exists only in a SQL comment does not cover it", () => {
    const sql = fixture({
      branch: `-- IF p_table = '${TABLE}' THEN
  IF p_table = 'awcms_other' THEN
    SELECT count(*)::integer INTO v_count FROM awcms_other AS x
    WHERE x.tenant_id = p_tenant_id AND x.created_at < p_cutoff;`
    });

    expect(covered(sql)).toBe(false);
    expect(covered(fixture({ extra: `/* p_table = '${TABLE}' */` }))).toBe(
      true
    );
  });

  test("a branch in a DIFFERENT function does not cover it", () => {
    const sql = fixture({
      branch: "IF p_table = 'awcms_other' THEN v_count := 0;",
      extra: `CREATE FUNCTION awcms_unrelated(p_table text) RETURNS integer LANGUAGE sql AS $function$ SELECT 1 /* p_table = '${TABLE}' */ $function$;
        -- p_table = '${TABLE}'`
    });

    expect(covered(sql)).toBe(false);
  });

  test("a function that is not SECURITY DEFINER does not cover it", () => {
    expect(
      covered(
        fixture({
          header:
            "LANGUAGE plpgsql\nSTABLE\nSET search_path = public, pg_temp\n"
        })
      )
    ).toBe(false);
  });

  test("a search_path that does not end in pg_temp does not cover it", () => {
    for (const pin of ["SET search_path = public\n", ""]) {
      expect(
        covered(
          fixture({
            header: `LANGUAGE plpgsql\nSECURITY DEFINER\nSTABLE\n${pin}`
          })
        )
      ).toBe(false);
    }
  });

  test("a missing REVOKE FROM PUBLIC does not cover it", () => {
    expect(covered(fixture({ revoke: "" }))).toBe(false);
  });

  test("a missing or wrong EXECUTE grant does not cover it", () => {
    expect(covered(fixture({ grantExecute: "" }))).toBe(false);
    expect(
      covered(
        fixture({
          grantExecute: `GRANT EXECUTE ON FUNCTION ${FN}(text, uuid, timestamptz) TO awcms_app;`
        })
      )
    ).toBe(false);
  });

  test("a missing owner does not cover it", () => {
    expect(covered(fixture({ owner: "" }))).toBe(false);
  });

  test("a missing column grant for the owner does not cover it", () => {
    const base = fixture();

    expect(
      covered(
        base.replace(
          `GRANT SELECT (tenant_id, created_at) ON ${TABLE} TO ${OWNER};`,
          ""
        )
      )
    ).toBe(false);
    expect(
      covered(
        base.replace(
          `GRANT SELECT (tenant_id, created_at) ON ${TABLE} TO ${OWNER};`,
          `GRANT SELECT (created_at) ON ${TABLE} TO ${OWNER};`
        )
      )
    ).toBe(false);
    expect(
      covered(
        base.replace(
          `GRANT SELECT (tenant_id, created_at) ON ${TABLE} TO ${OWNER};`,
          `GRANT SELECT (tenant_id, created_at) ON ${TABLE} TO someone_else;`
        )
      )
    ).toBe(false);
  });

  test("a branch reading a different cursor column than the descriptor's is red (L1)", () => {
    // The SQL filters on created_at; the descriptor says starts_at.
    expect(covered(fixture(), "starts_at")).toBe(false);
    expect(
      covered(
        fixture({
          branch: `IF p_table = '${TABLE}' THEN
    SELECT count(*)::integer INTO v_count FROM ${TABLE} AS x
    WHERE x.tenant_id = p_tenant_id AND x.updated_at < p_cutoff;`
        })
      )
    ).toBe(false);
    // And the tenant column is checked too.
    expect(
      hasWorkerCountFunction(fixture(), TABLE, "created_at", "org_id")
    ).toBe(false);
  });

  test("a table with no mapped function is not covered", () => {
    expect(hasWorkerCountFunction(fixture(), "awcms_other")).toBe(false);
  });
});

describe("the delegated planner calls the count function", () => {
  const descriptor = listModules()
    .flatMap((m) => m.dataLifecycle ?? [])
    .find((d) => d.key === "inventory.movements")!;

  test("one integer is read through the function, never the table", async () => {
    const statements: { text: string; params: unknown[] }[] = [];
    const tx = {
      unsafe: async (text: string, params: unknown[]) => {
        statements.push({ text, params });
        return [{ count: 7 }];
      }
    } as unknown as Bun.SQL;

    const result = await planLifecycleDryRun(
      tx,
      descriptor,
      "t-1",
      [],
      new Date("2026-10-01T00:00:00Z")
    );

    expect(statements.length).toBe(1);
    expect(statements[0]!.text).toBe(
      "SELECT awcms_inventory_lifecycle_eligible_count($1, $2, $3) AS count"
    );
    expect(statements[0]!.text).not.toContain("FROM");
    expect(statements[0]!.params.slice(0, 2)).toEqual([
      "awcms_inventory_movements",
      "t-1"
    ]);
    expect(result.eligibleCount).toBe(7);
    expect(result.purgeableCount).toBe(7);
    expect(result.blockedCount).toBe(0);
    expect(result.heldCount).toBe(0);
  });
});
