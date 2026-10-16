/**
 * The payroll SQL boundary, no database (Issue #1015, M-B).
 *
 * Two halves:
 *
 * - the STATIC layer (`findPayrollSqlLeaks`) against the evasion probes of
 *   `tests/fixtures/payroll-boundary-probes.ts`: the ones the text-only gate
 *   missed must now be refused, and the ones no text scan can see must still be
 *   missed (that is the documented limit the catalog layer exists for);
 * - the CATALOG analyser (`analysePayrollCatalog`) on hand-built snapshots, so
 *   every rule has a unit test that needs no PostgreSQL. The same probes run
 *   against a real catalog in `tests/integration/payroll-catalog-boundary.
 *   integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  PAYROLL_REQUIRED_FOREIGN_KEYS,
  PAYROLL_REQUIRED_TRIGGERS,
  PAYROLL_WORKER_EXECUTE_ALLOWLIST
} from "../src/modules/_shared/payroll-data-boundary";
import { findPayrollSqlLeaks } from "../scripts/payroll-sql-boundary-check";
import {
  analysePayrollCatalog,
  isPayrollFamily,
  staleCatalogExemptions,
  type CatalogSnapshot
} from "../scripts/lib/payroll-catalog-boundary";
import {
  dollarQuotedBodies,
  foldStringConcatenation,
  singleQuotedLiterals,
  splitSqlStatements
} from "../scripts/lib/sql-statements";
import {
  PAYROLL_BOUNDARY_CLEAN_TWINS,
  PAYROLL_BOUNDARY_PROBES
} from "./fixtures/payroll-boundary-probes";

describe("static layer against the #1015 evasion probes", () => {
  test.each(PAYROLL_BOUNDARY_PROBES.map((probe) => [probe.id, probe] as const))(
    "%s",
    (_id, probe) => {
      const failures = findPayrollSqlLeaks([
        { name: "999_probe.sql", sql: probe.sql }
      ]);

      if (probe.staticCaught) {
        expect(failures.length).toBeGreaterThan(0);
      } else {
        expect(failures).toEqual([]);
      }
    }
  );

  test.each(
    PAYROLL_BOUNDARY_CLEAN_TWINS.map((twin) => [twin.id, twin] as const)
  )("clean twin %s passes", (_id, twin) => {
    expect(
      findPayrollSqlLeaks([{ name: "999_twin.sql", sql: twin.sql }])
    ).toEqual([]);
  });

  test("a probe split across two migration files is still found (function in one, view in the other)", () => {
    const failures = findPayrollSqlLeaks([
      {
        name: "1.sql",
        sql: `CREATE FUNCTION awcms_x_rows() RETURNS SETOF awcms_hr_commission_accruals LANGUAGE sql AS 'SELECT * FROM awcms_hr_commission_accruals';`
      },
      {
        name: "2.sql",
        sql: `CREATE VIEW awcms_x_v AS SELECT * FROM awcms_x_rows();`
      }
    ]);

    expect(failures.join("\n")).toContain("view awcms_x_v");
  });

  test("a view dropped in a later migration is no longer a leak", () => {
    expect(
      findPayrollSqlLeaks([
        {
          name: "1.sql",
          sql: `CREATE VIEW awcms_x_v AS SELECT * FROM awcms_hr_commission_accruals;`
        },
        { name: "2.sql", sql: `DROP VIEW awcms_x_v;` }
      ])
    ).toEqual([]);
  });

  test.each([
    [
      "WITH ... INSERT ... SELECT",
      "WITH c AS (SELECT * FROM awcms_hr_commission_accruals) INSERT INTO awcms_x SELECT * FROM c;"
    ],
    [
      "WITH ... SELECT ... INTO",
      "WITH c AS (SELECT * FROM awcms_hr_commission_accruals) SELECT * INTO awcms_x FROM c;"
    ],
    [
      "CREATE TABLE AS WITH",
      "CREATE TABLE awcms_x AS WITH c AS (SELECT * FROM awcms_hr_commission_accruals) SELECT * FROM c;"
    ]
  ])("%s over payroll is refused (M5)", (_name, sql) => {
    expect(
      findPayrollSqlLeaks([{ name: "999.sql", sql }]).length
    ).toBeGreaterThan(0);
  });

  test("WITH ... INSERT that does not read payroll passes", () => {
    expect(
      findPayrollSqlLeaks([
        {
          name: "999.sql",
          sql: "WITH c AS (SELECT * FROM awcms_tenants) INSERT INTO awcms_x SELECT * FROM c;"
        }
      ])
    ).toEqual([]);
  });

  test("a DO block with EXECUTE is flagged unless the migration is allow-listed (M5)", () => {
    const sql = "DO $$ BEGIN EXECUTE 'SELECT 1'; END $$;";

    expect(findPayrollSqlLeaks([{ name: "999.sql", sql }]).join()).toContain(
      "dynamic SQL"
    );
    expect(
      findPayrollSqlLeaks([{ name: "099_awcms_sync_outbox_retire.sql", sql }])
    ).toEqual([]);
    expect(
      findPayrollSqlLeaks([
        { name: "999.sql", sql: "DO $$ BEGIN PERFORM 1; END $$;" }
      ])
    ).toEqual([]);
  });

  test("a quoted call to a leaking function is followed (M3)", () => {
    const failures = findPayrollSqlLeaks([
      {
        name: "1.sql",
        sql: "CREATE FUNCTION awcms_leaf() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM awcms_hr_commission_accruals';"
      },
      {
        name: "2.sql",
        sql: "CREATE FUNCTION awcms_top() RETURNS bigint LANGUAGE sql AS 'SELECT public.\"awcms_leaf\"()';"
      }
    ]);

    expect(failures.join("\n")).toContain("function awcms_top");
  });

  test("a payroll name inside a VALUES literal is data, not a read", () => {
    expect(
      findPayrollSqlLeaks([
        {
          name: "1.sql",
          sql: `INSERT INTO awcms_data_lifecycle_registry (table_name) SELECT 'awcms_hr_commission_accruals' FROM awcms_tenants;`
        }
      ])
    ).toEqual([]);
  });
});

describe("sql-statements", () => {
  test("a ; in a literal, a quoted identifier or a dollar body does not split", () => {
    expect(
      splitSqlStatements(
        `SELECT ';'; SELECT ";" FROM t; DO $a$ BEGIN PERFORM 1; END $a$; SELECT 1`
      )
    ).toEqual([
      "SELECT ';'",
      `SELECT ";" FROM t`,
      "DO $a$ BEGIN PERFORM 1; END $a$",
      "SELECT 1"
    ]);
  });

  test("comments are dropped outside literals and kept inside them", () => {
    expect(
      splitSqlStatements(
        `SELECT '-- not a comment' /* gone */; -- gone\nSELECT 2`
      )
    ).toEqual(["SELECT '-- not a comment'", "SELECT 2"]);
  });

  test("E'' strings honour backslash escapes, '' is a doubled quote", () => {
    expect(splitSqlStatements(`SELECT E'a\\';b'; SELECT 'it''s;'`)).toEqual([
      `SELECT E'a\\';b'`,
      `SELECT 'it''s;'`
    ]);
  });

  test("adjacent literals joined by || fold into one", () => {
    expect(foldStringConcatenation(`'awcms_hr_pay' || 'roll' || '_runs'`)).toBe(
      `'awcms_hr_payroll_runs'`
    );
  });

  test("dollar bodies and literals are extracted", () => {
    expect(dollarQuotedBodies(`DO $x$ a $x$`)).toEqual([" a "]);
    expect(singleQuotedLiterals(`EXECUTE 'it''s' || 'x'`)).toEqual([
      "it's",
      "x"
    ]);
  });
});

/** The marked, required payroll tables every healthy catalog has (Issue #1077, M1). */
export const REQUIRED_RELATIONS: CatalogSnapshot["relations"] = [
  "awcms_hr_commission_accruals",
  "awcms_hr_commission_transitions"
].map((name) => ({
  name: `public.${name}`,
  relkind: "r",
  owner: "owner",
  comment: "payroll-boundary: test"
}));

const REQUIRED_FKS: CatalogSnapshot["foreignKeys"] =
  PAYROLL_REQUIRED_FOREIGN_KEYS.map((edge) => ({
    from: `public.${edge.from}`,
    to: `public.${edge.to}`
  }));

const REQUIRED_TRIGGERS: CatalogSnapshot["triggers"] = Object.entries(
  PAYROLL_REQUIRED_TRIGGERS
).flatMap(([table, names]) =>
  names.map((name) => ({
    relation: `public.${table}`,
    name,
    function: `public.${name}_fn`
  }))
);

function snapshot(partial: Partial<CatalogSnapshot>): CatalogSnapshot {
  return {
    migrationOwner: "owner",
    columns: [],
    foreignKeys: REQUIRED_FKS,
    roles: [],
    namedObjects: [],
    rules: [],
    functions: [],
    triggers: REQUIRED_TRIGGERS,
    grants: [],
    inheritance: [],
    relations: REQUIRED_RELATIONS,
    memberships: [],
    publications: [],
    foreignTables: [],
    dependencies: [],
    ...partial
  };
}

const PAYROLL = "public.awcms_hr_payroll_runs";

function fn(
  name: string,
  overrides: Partial<CatalogSnapshot["functions"][number]> = {}
): CatalogSnapshot["functions"][number] {
  return {
    name: `public.${name}`,
    language: "sql",
    securityDefiner: false,
    returnsTrigger: false,
    returnsSet: false,
    returnType: "bigint",
    owner: "owner",
    source: "",
    rowTypeRelations: [],
    dependsOnRelations: [],
    executeGrantees: ["PUBLIC", "owner"],
    ...overrides
  };
}

const codes = (s: CatalogSnapshot) =>
  analysePayrollCatalog(s).map((finding) => finding.code);

describe("catalog analyser", () => {
  test("family membership is public + a payroll name; a payroll-looking name elsewhere is not family", () => {
    expect(isPayrollFamily(PAYROLL)).toBe(true);
    expect(isPayrollFamily("evil.awcms_hr_payroll_runs")).toBe(false);
    expect(isPayrollFamily("public.awcms_staff")).toBe(false);
  });

  test("an empty catalog is clean", () => {
    expect(codes(snapshot({}))).toEqual([]);
  });

  test("a view over payroll is refused; the same view in the family is not", () => {
    const view = (relation: string) =>
      snapshot({
        rules: [
          {
            relation,
            relkind: "v",
            rule: "_RETURN",
            eventType: "1",
            dependsOnRelations: [PAYROLL],
            dependsOnFunctions: []
          }
        ]
      });

    expect(codes(view("public.awcms_staff_view"))).toEqual([
      "relation-over-payroll"
    ]);
    expect(codes(view("public.awcms_hr_payroll_summary"))).toEqual([]);
  });

  test("a family view may join ordinary tables (its SELECT rule is its definition)", () => {
    expect(
      codes(
        snapshot({
          rules: [
            {
              relation: "public.awcms_hr_payroll_summary",
              relkind: "v",
              rule: "_RETURN",
              eventType: "1",
              dependsOnRelations: [PAYROLL, "public.awcms_employees"],
              dependsOnFunctions: []
            }
          ]
        })
      )
    ).toEqual([]);
  });

  test("a user rule on a payroll table that pushes rows into an ordinary table is refused", () => {
    expect(
      codes(
        snapshot({
          rules: [
            {
              relation: PAYROLL,
              relkind: "r",
              rule: "copy",
              eventType: "3",
              dependsOnRelations: ["public.awcms_sink"],
              dependsOnFunctions: []
            }
          ]
        })
      )
    ).toEqual(["payroll-rule-writes-outside"]);
  });

  test("a SETOF payroll row function is refused by type, by body and through a view", () => {
    const found = codes(
      snapshot({
        functions: [
          fn("awcms_rows", {
            securityDefiner: true,
            rowTypeRelations: [PAYROLL],
            source: "SELECT * FROM awcms_hr_payroll_runs"
          })
        ],
        rules: [
          {
            relation: "public.awcms_rows_view",
            relkind: "v",
            rule: "_RETURN",
            eventType: "1",
            dependsOnRelations: [],
            dependsOnFunctions: ["public.awcms_rows"]
          }
        ]
      })
    );

    expect(found).toEqual([
      "function-payroll-row-type",
      "function-reads-payroll",
      "relation-over-leaking-function"
    ]);
  });

  test("names are matched case-insensitively and across || seams in a body", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_a", { source: "SELECT * FROM AWCMS_HR_PAYROLL_RUNS" }),
            fn("awcms_b", {
              source: "SELECT * FROM 'awcms_hr_pay' || 'roll_runs'"
            })
          ]
        })
      )
    ).toEqual(["function-reads-payroll", "function-reads-payroll"]);
  });

  test("a chain is followed to its end", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_leaf", { source: "SELECT 1 FROM awcms_hr_payroll_runs" }),
            fn("awcms_mid", { source: "SELECT awcms_leaf()" }),
            fn("awcms_top", { source: "SELECT awcms_mid()" })
          ]
        })
      )
    ).toEqual(["function-reads-payroll", "function-chain", "function-chain"]);
  });

  test("calling a payroll-family function is refused; the family function itself is fine", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_hr_payroll_total", {
              source: "SELECT 1 FROM awcms_hr_payroll_runs"
            }),
            fn("awcms_report", { source: "SELECT awcms_hr_payroll_total()" })
          ]
        })
      )
    ).toEqual(["function-calls-payroll-function"]);
  });

  test("dynamic EXECUTE outside the family is refused, EXECUTE FUNCTION is not", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_dyn", {
              language: "plpgsql",
              source: "BEGIN EXECUTE 'select 1' || x; END"
            }),
            fn("awcms_not_dyn", {
              language: "plpgsql",
              source: "-- EXECUTE FUNCTION in a comment\nBEGIN RETURN; END"
            })
          ]
        })
      )
    ).toEqual(["function-dynamic-sql"]);
  });

  test("triggers crossing the boundary in either direction are refused", () => {
    expect(
      codes(
        snapshot({
          functions: [fn("awcms_hr_payroll_guard", { returnsTrigger: true })],
          triggers: [
            ...REQUIRED_TRIGGERS,
            {
              relation: PAYROLL,
              name: "ok",
              function: "public.awcms_hr_payroll_guard"
            },
            { relation: PAYROLL, name: "bad", function: "public.awcms_copy" },
            {
              relation: "public.awcms_blog_posts",
              name: "bad2",
              function: "public.awcms_hr_payroll_guard"
            }
          ]
        })
      )
    ).toEqual(["trigger-foreign-function", "trigger-foreign-function"]);
  });

  test("grants: PUBLIC, another role and a column grant are refused; only the request role and the owner are not", () => {
    const grant = (grantee: string, column: string | null = null) => ({
      relation: PAYROLL,
      owner: "owner",
      grantee,
      privilege: "SELECT",
      column
    });

    expect(
      codes(
        snapshot({
          grants: [
            grant("owner"),
            grant("awcms_app"),
            grant("awcms_worker"),
            grant("awcms_worker", "salary"),
            grant("PUBLIC"),
            grant("awcms_partner_view", "salary")
          ]
        })
      )
    ).toEqual([
      "payroll-grant",
      "payroll-grant",
      "payroll-grant",
      "payroll-grant"
    ]);
  });

  test("a SECURITY DEFINER family function executable by PUBLIC is refused; a trigger function is not", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_hr_payroll_open", { securityDefiner: true }),
            fn("awcms_hr_payroll_guard", {
              securityDefiner: true,
              returnsTrigger: true
            }),
            fn("awcms_hr_payroll_closed", {
              securityDefiner: true,
              executeGrantees: ["owner", "awcms_app"]
            })
          ]
        })
      )
    ).toEqual(["payroll-grant"]);
  });

  test("inheritance across the boundary is refused, within it is not", () => {
    expect(
      codes(
        snapshot({
          inheritance: [
            { parent: "public.awcms_parent", child: PAYROLL },
            { parent: "public.awcms_hr_payroll_a", child: PAYROLL }
          ]
        })
      )
    ).toEqual(["inheritance-crosses-boundary"]);
  });

  describe("worker EXECUTE on a payroll SECURITY DEFINER function (H1)", () => {
    const worker = (
      name: string,
      overrides: Partial<CatalogSnapshot["functions"][number]> = {}
    ) =>
      fn(name, {
        securityDefiner: true,
        executeGrantees: ["owner", "awcms_app", "awcms_worker"],
        ...overrides
      });
    const run = (
      fns: CatalogSnapshot["functions"],
      allow: readonly string[] = []
    ) =>
      analysePayrollCatalog(snapshot({ functions: fns }), {
        workerExecuteAllowlist: allow
      }).map((finding) => finding.code);

    test("a worker may not run a non-allow-listed count", () => {
      expect(run([worker("awcms_hr_payroll_count")])).toEqual([
        "payroll-grant"
      ]);
    });

    test.each([
      [
        "a set of payroll rows",
        { returnsSet: true, returnType: "record", rowTypeRelations: [PAYROLL] }
      ],
      ["a jsonb dump", { returnType: "jsonb" }],
      ["a set of integers", { returnsSet: true }],
      ["a count that takes a payroll row", { rowTypeRelations: [PAYROLL] }]
    ])(
      "an allow-listed function returning %s is still refused",
      (_n, shape) => {
        expect(
          run(
            [worker("awcms_hr_payroll_count", shape)],
            ["awcms_hr_payroll_count"]
          )
        ).toEqual(["payroll-grant"]);
      }
    );

    test.each(["smallint", "integer", "bigint", "boolean"])(
      "an allow-listed scalar %s count passes",
      (returnType) => {
        expect(
          run(
            [worker("awcms_hr_payroll_count", { returnType })],
            ["awcms_hr_payroll_count"]
          )
        ).toEqual([]);
      }
    );

    test("the allow-list is empty in the repository", () => {
      expect(PAYROLL_WORKER_EXECUTE_ALLOWLIST).toEqual([]);
    });
  });

  test("a quoted or schema-qualified call is still a call (M3)", () => {
    for (const call of [
      'SELECT "awcms_hr_payroll_total"()',
      'SELECT public."awcms_hr_payroll_total"()',
      'SELECT "public"."awcms_hr_payroll_total" ()',
      "SELECT public.awcms_hr_payroll_total ()"
    ]) {
      expect(
        codes(
          snapshot({
            functions: [
              fn("awcms_hr_payroll_total", {
                source: "SELECT 1 FROM awcms_hr_payroll_runs"
              }),
              fn("awcms_report", { source: call })
            ]
          })
        )
      ).toEqual(["function-calls-payroll-function"]);
    }
  });

  test("an exemption silences exactly its object, and a stale one is reported", () => {
    const leaky = snapshot({
      functions: [
        fn("awcms_a", { source: "SELECT 1 FROM awcms_hr_payroll_runs" })
      ]
    });

    expect(
      analysePayrollCatalog(leaky, { exemptions: { "public.awcms_a": "why" } })
    ).toEqual([]);
    expect(
      staleCatalogExemptions(leaky, {
        "public.awcms_a": "why",
        "public.gone": "old"
      })
    ).toEqual(["public.gone"]);
  });
});
