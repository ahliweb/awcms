/**
 * The payroll boundary gaps of Issue #1077 (the #1015 security review's
 * remaining Mediums M1, M2, M4, M5, M6, M7 and the info items), no database.
 *
 * Every test is a PROBE: a catalog snapshot or a migration text that the gate
 * of #1015 let through, and that is now refused. The same shapes run against a
 * real migrated catalog in `tests/integration/payroll-catalog-boundary.
 * integration.test.ts`. Each "clean" companion proves the new rule is not just
 * red about everything.
 */
import { describe, expect, test } from "bun:test";

import {
  PAYROLL_INDIRECT_READ_PATTERN,
  PAYROLL_OWNED_NON_PAYROLL_TABLES,
  PAYROLL_REQUIRED_FOREIGN_KEYS,
  PAYROLL_REQUIRED_TRIGGERS,
  PAYROLL_REQUIRED_TABLES
} from "../src/modules/_shared/payroll-data-boundary";
import {
  PAYROLL_READ_FUNCTION_IMPORTS,
  type PayrollReadFunctionImport
} from "../src/modules/_shared/sensitive-reads";
import {
  analysePayrollCatalog,
  staleCatalogExemptions,
  type CatalogSnapshot
} from "../scripts/lib/payroll-catalog-boundary";
import {
  findPayrollOwnershipGaps,
  findPayrollSqlLeaks
} from "../scripts/payroll-sql-boundary-check";
import { findForbiddenReadImports } from "../src/modules/_shared/sensitive-read-coverage";

const ACCRUALS = "public.awcms_hr_commission_accruals";
const TRANSITIONS = "public.awcms_hr_commission_transitions";

const REQUIRED: CatalogSnapshot["relations"] = [ACCRUALS, TRANSITIONS].map(
  (name) => ({
    name,
    relkind: "r",
    owner: "owner",
    comment: "payroll-boundary: test"
  })
);

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

function snapshot(partial: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
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
    relations: REQUIRED,
    memberships: [],
    publications: [],
    foreignTables: [],
    dependencies: [],
    ...partial
  };
}

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
    executeGrantees: ["owner"],
    ...overrides
  };
}

const codes = (s: CatalogSnapshot) =>
  analysePayrollCatalog(s).map((finding) => finding.code);

const sqlFailures = (sql: string) =>
  findPayrollSqlLeaks([{ name: "999_probe.sql", sql }]);

describe("M1 - a payroll table renamed out of the family", () => {
  test("a healthy catalog (required tables present and marked) is clean", () => {
    expect(codes(snapshot())).toEqual([]);
  });

  test("catalog: the table renamed away is missing, and its marker now sits outside the family", () => {
    const found = codes(
      snapshot({
        relations: [{ ...REQUIRED[0]!, name: "public.x" }, REQUIRED[1]!]
      })
    );

    expect(found).toContain("payroll-table-missing");
    expect(found).toContain("payroll-marker-outside-family");
  });

  test("catalog: a rename that also drops the comment is still caught by the required-table manifest", () => {
    expect(
      codes(
        snapshot({
          relations: [
            { name: "public.x", relkind: "r", owner: "owner", comment: null },
            REQUIRED[1]!
          ]
        })
      )
    ).toEqual(["payroll-table-missing"]);
  });

  test("catalog: a payroll-family table without the marker is refused", () => {
    expect(
      codes(
        snapshot({
          relations: [
            ...REQUIRED,
            {
              name: "public.awcms_hr_payroll_runs",
              relkind: "r",
              owner: "owner",
              comment: null
            }
          ]
        })
      )
    ).toEqual(["payroll-marker-missing"]);
  });

  test("catalog: a family VIEW needs no marker; a marker moved to another schema is outside the family", () => {
    expect(
      codes(
        snapshot({
          relations: [
            ...REQUIRED,
            {
              name: "public.awcms_hr_payroll_summary",
              relkind: "v",
              owner: "owner",
              comment: null
            }
          ]
        })
      )
    ).toEqual([]);
    expect(
      codes(
        snapshot({
          relations: [
            ...REQUIRED,
            {
              name: "elsewhere.awcms_hr_commission_accruals",
              relkind: "r",
              owner: "owner",
              comment: "payroll-boundary"
            }
          ]
        })
      )
    ).toEqual(["payroll-marker-outside-family"]);
  });

  test("the required-table manifest lists the two tables that exist today", () => {
    expect([...PAYROLL_REQUIRED_TABLES]).toEqual([
      "awcms_hr_commission_accruals",
      "awcms_hr_commission_transitions"
    ]);
  });

  test.each([
    ["TABLE", "ALTER TABLE awcms_hr_commission_accruals RENAME TO x;"],
    [
      "quoted",
      'ALTER TABLE public."awcms_hr_commission_accruals" RENAME TO "x";'
    ],
    [
      "IF EXISTS ONLY",
      "ALTER TABLE IF EXISTS ONLY awcms_hr_commission_accruals RENAME TO x;"
    ],
    ["VIEW", "ALTER VIEW awcms_hr_payroll_summary RENAME TO x;"],
    ["FOREIGN TABLE", "ALTER FOREIGN TABLE awcms_hr_payroll_feed RENAME TO x;"],
    ["FUNCTION", "ALTER FUNCTION awcms_hr_payroll_total(uuid) RENAME TO x;"],
    [
      "SET SCHEMA",
      "ALTER TABLE awcms_hr_commission_accruals SET SCHEMA archive;"
    ],
    [
      "inside a DO block",
      "DO $$ BEGIN ALTER TABLE awcms_hr_commission_accruals RENAME TO x; END $$;"
    ]
  ])("static: %s leaving the family is refused", (_name, sql) => {
    expect(sqlFailures(sql).length).toBeGreaterThan(0);
  });

  test.each([
    [
      "a column rename",
      "ALTER TABLE awcms_hr_commission_accruals RENAME COLUMN a TO b;"
    ],
    [
      "a constraint rename",
      "ALTER TABLE awcms_hr_commission_accruals RENAME CONSTRAINT a TO b;"
    ],
    [
      "a rename inside the family",
      "ALTER TABLE awcms_hr_commission_accruals RENAME TO awcms_hr_commission_accruals_v2;"
    ],
    [
      "a rename of an ordinary table",
      "ALTER TABLE awcms_staff RENAME TO awcms_people;"
    ],
    [
      "a move to public",
      "ALTER TABLE awcms_hr_commission_accruals SET SCHEMA public;"
    ]
  ])("static: %s passes", (_name, sql) => {
    expect(sqlFailures(sql)).toEqual([]);
  });

  test("static: a new table with a payroll module's prefix but no family name is refused", () => {
    expect(
      sqlFailures("CREATE TABLE awcms_hr_commission_periods (id uuid);").join()
    ).toContain("awcms_hr_commission_periods");
    expect(
      sqlFailures("CREATE TABLE awcms_hr_payroll_runs (id uuid);")
    ).toEqual([]);
    // The reasoned non-payroll table passes; so does an unrelated module's.
    expect(
      sqlFailures("CREATE TABLE awcms_hr_commission_rules (id uuid);")
    ).toEqual([]);
    expect(sqlFailures("CREATE TABLE awcms_hr_employments (id uuid);")).toEqual(
      []
    );
  });

  test("ownership gate: every table a payroll module owns must be a payroll table or a reasoned exception", () => {
    const files = [
      {
        name: "1.sql",
        sql: "CREATE TABLE awcms_hr_commission_rules (id uuid); CREATE TABLE awcms_hr_commission_accruals (id uuid);"
      }
    ];

    expect(
      findPayrollOwnershipGaps(
        [
          { table: "awcms_hr_commission_accruals", source: "a" },
          { table: "awcms_hr_commission_rules", source: "b" }
        ],
        files
      )
    ).toEqual([]);

    const gap = findPayrollOwnershipGaps(
      [{ table: "awcms_hr_commission_run_lines", source: "src/x.ts" }],
      files
    );

    expect(gap.join()).toContain("awcms_hr_commission_run_lines");
    expect(gap.join()).toContain("src/x.ts");
  });

  test("ownership gate: a stale exception is reported", () => {
    expect(
      findPayrollOwnershipGaps([], [], { awcms_gone: "reason" }).join()
    ).toContain("stale");
    expect(Object.keys(PAYROLL_OWNED_NON_PAYROLL_TABLES)).toEqual([
      "awcms_hr_commission_rules"
    ]);
  });
});

describe("M2 - helpers whose body never names the table", () => {
  const SECDEF = (body: string, tail = "SECURITY DEFINER") =>
    `CREATE FUNCTION awcms_leak() RETURNS xml LANGUAGE sql ${tail} SET search_path = public, pg_temp AS $f$ ${body} $f$;`;

  test.each([
    "SELECT schema_to_xml('public', true, false, '')",
    "SELECT query_to_xml('select 1', true, false, '')",
    "SELECT table_to_xml('t'::regclass, true, false, '')",
    "SELECT 't'::regclass",
    "SELECT to_regclass('t')",
    "SELECT format('select * from %I', 't')",
    'SELECT 1 FROM U&"\\0061wcms_t"',
    "SELECT * FROM ts_stat('select 1')",
    "SELECT dblink_exec('x', 'y')"
  ])(
    "catalog: a non-family SECURITY DEFINER body with %s is refused",
    (body) => {
      expect(
        codes(
          snapshot({
            functions: [
              fn("awcms_leak", { securityDefiner: true, source: body })
            ]
          })
        )
      ).toContain("function-indirect-read");
    }
  );

  test("catalog: the same body in a non-definer, a family function or an exempted one is accepted", () => {
    const body = "SELECT format('x %s', 1)";

    expect(
      codes(snapshot({ functions: [fn("awcms_leak", { source: body })] }))
    ).toEqual([]);
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_hr_payroll_x", { securityDefiner: true, source: body })
          ]
        })
      )
    ).toEqual([]);
    expect(
      analysePayrollCatalog(
        snapshot({
          functions: [fn("awcms_leak", { securityDefiner: true, source: body })]
        }),
        { exemptions: { "public.awcms_leak": "reviewed: a constant message" } }
      )
    ).toEqual([]);
  });

  test("catalog: a view over such a function inherits the finding", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_leak", {
              securityDefiner: true,
              source: "SELECT format('%s', 1)"
            })
          ],
          rules: [
            {
              relation: "public.awcms_v",
              relkind: "v",
              rule: "_RETURN",
              eventType: "1",
              dependsOnRelations: [],
              dependsOnFunctions: ["public.awcms_leak"]
            }
          ]
        })
      )
    ).toContain("relation-over-leaking-function");
  });

  test("the pattern is a whole-token match, not a substring", () => {
    expect(PAYROLL_INDIRECT_READ_PATTERN.test("SELECT reformat(1)")).toBe(
      false
    );
    expect(PAYROLL_INDIRECT_READ_PATTERN.test("SELECT my_regclass_thing")).toBe(
      false
    );
    expect(PAYROLL_INDIRECT_READ_PATTERN.test("SELECT 1 AS format")).toBe(
      false
    );
  });

  test("static: a SECURITY DEFINER function outside the family with such a helper is refused", () => {
    expect(
      sqlFailures(
        SECDEF("SELECT query_to_xml('select 1', true, false, '')")
      ).join()
    ).toContain("awcms_leak");
    expect(sqlFailures(SECDEF("SELECT 't'::regclass")).length).toBeGreaterThan(
      0
    );
    expect(
      sqlFailures(SECDEF("SELECT format('x%s', 1)")).length
    ).toBeGreaterThan(0);
  });

  test("static: the same helper without SECURITY DEFINER, or inside the family, passes", () => {
    expect(
      sqlFailures(SECDEF("SELECT format('x%s', 1)", "SECURITY INVOKER"))
    ).toEqual([]);
    expect(
      sqlFailures(
        "CREATE FUNCTION awcms_hr_payroll_x() RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $f$ SELECT format('x%s', 1) $f$;"
      )
    ).toEqual([]);
  });

  test("static: a Unicode-escaped identifier is refused anywhere", () => {
    expect(
      sqlFailures(
        'CREATE VIEW awcms_v AS SELECT * FROM U&"\\0061wcms_hr_commission_accruals";'
      ).length
    ).toBeGreaterThan(0);
    // A Unicode string LITERAL is ordinary data.
    expect(sqlFailures("SELECT U&'\\0041';")).toEqual([]);
  });
});

describe("M4 - owners, role membership, publications, foreign tables and COPY", () => {
  test("catalog: a runtime role that owns a payroll relation or function is refused", () => {
    expect(
      codes(
        snapshot({
          relations: [{ ...REQUIRED[0]!, owner: "awcms_app" }, REQUIRED[1]!]
        })
      )
    ).toEqual(["payroll-owner"]);
    expect(
      codes(
        snapshot({
          functions: [fn("awcms_hr_payroll_total", { owner: "awcms_worker" })]
        })
      )
    ).toEqual(["payroll-owner"]);
  });

  test("catalog: a member of the request role, direct or through another role, inherits payroll", () => {
    expect(
      codes(
        snapshot({
          memberships: [{ role: "awcms_app", member: "awcms_worker" }]
        })
      )
    ).toEqual(["payroll-role-membership"]);

    const chain = analysePayrollCatalog(
      snapshot({
        memberships: [
          { role: "awcms_app", member: "middle" },
          { role: "middle", member: "leaf" }
        ]
      })
    );

    expect(chain.map((finding) => finding.object).sort()).toEqual([
      "role:leaf",
      "role:middle"
    ]);
    expect(chain.find((f) => f.object === "role:leaf")!.message).toContain(
      "(through awcms_app)"
    );
  });

  test("catalog: a member of the OWNER role is refused; unrelated memberships and an allowed member are not", () => {
    expect(
      codes(snapshot({ memberships: [{ role: "owner", member: "ci" }] }))
    ).toEqual(["payroll-role-membership"]);
    expect(
      codes(
        snapshot({
          memberships: [{ role: "pg_monitor", member: "awcms_worker" }]
        })
      )
    ).toEqual([]);
    expect(
      analysePayrollCatalog(
        snapshot({ memberships: [{ role: "owner", member: "ci" }] }),
        { allowedRoleMembers: ["ci"] }
      )
    ).toEqual([]);
  });

  test("catalog: a publication that carries payroll, every table, or the whole schema is refused", () => {
    const pub = (overrides: Partial<CatalogSnapshot["publications"][number]>) =>
      codes(
        snapshot({
          publications: [
            {
              name: "p",
              allTables: false,
              relations: [],
              schemas: [],
              ...overrides
            }
          ]
        })
      );

    expect(pub({ allTables: true })).toEqual(["payroll-publication"]);
    expect(pub({ relations: [ACCRUALS] })).toEqual(["payroll-publication"]);
    expect(pub({ schemas: ["public"] })).toEqual(["payroll-publication"]);
    expect(pub({ relations: ["public.awcms_staff"] })).toEqual([]);
    expect(pub({ schemas: ["other"] })).toEqual([]);
    expect(
      analysePayrollCatalog(
        snapshot({
          publications: [
            { name: "p", allTables: true, relations: [], schemas: [] }
          ]
        }),
        { publicationExemptions: { p: "the analytics replica, reviewed" } }
      )
    ).toEqual([]);
  });

  test("catalog: a foreign table that points at payroll, or wears a payroll name, is refused", () => {
    const foreign = (name: string, options: string) =>
      codes(snapshot({ foreignTables: [{ name, owner: "owner", options }] }));

    expect(
      foreign(
        "public.awcms_loop",
        "schema_name=public table_name=awcms_hr_commission_accruals dbname=x"
      )
    ).toEqual(["payroll-foreign-table"]);
    expect(foreign("remote.awcms_hr_commission_accruals", "")).toEqual([
      "payroll-foreign-table"
    ]);
    expect(foreign("public.awcms_loop", "table_name=awcms_staff")).toEqual([]);
  });

  test.each([
    ["COPY <payroll> TO", "COPY awcms_hr_commission_accruals TO '/tmp/x';"],
    [
      "with a column list",
      "COPY public.awcms_hr_commission_accruals (id, amount) TO STDOUT;"
    ],
    [
      "COPY (SELECT ...) TO",
      "COPY (SELECT * FROM awcms_hr_commission_accruals) TO '/tmp/x';"
    ],
    [
      "COPY (WITH ...) TO",
      "COPY (WITH c AS (SELECT * FROM awcms_hr_commission_accruals) SELECT * FROM c) TO PROGRAM 'cat';"
    ]
  ])("static: %s is refused", (_name, sql) => {
    expect(sqlFailures(sql).length).toBeGreaterThan(0);
  });

  test("static: COPY FROM payroll, and COPY of an ordinary table, pass", () => {
    expect(
      sqlFailures("COPY awcms_hr_commission_accruals FROM STDIN;")
    ).toEqual([]);
    expect(sqlFailures("COPY awcms_staff TO STDOUT;")).toEqual([]);
    expect(sqlFailures("COPY (SELECT 1) TO STDOUT;")).toEqual([]);
  });

  test("static: COPY (SELECT) TO through a function that reads payroll is refused", () => {
    const failures = findPayrollSqlLeaks([
      {
        name: "1.sql",
        sql: "CREATE FUNCTION awcms_leaf() RETURNS bigint LANGUAGE sql AS 'SELECT count(*) FROM awcms_hr_commission_accruals';"
      },
      { name: "2.sql", sql: "COPY (SELECT awcms_leaf()) TO STDOUT;" }
    ]);

    expect(failures.join("\n")).toContain("COPY");
  });
});

describe("M5 - one-shot copies whose table name exists only at run time", () => {
  test("a DO block that runs EXECUTE is refused, however the name is built (the remainder is closed for migrations)", () => {
    for (const sql of [
      "DO $$ DECLARE t text := 'awcms_hr_commission_' || 'accruals'; BEGIN EXECUTE 'CREATE TABLE awcms_copy AS SELECT * FROM ' || t; END $$;",
      "DO $$ BEGIN EXECUTE format('INSERT INTO awcms_copy SELECT * FROM %I', 'awcms_hr_commission_acc' || 'ruals'); END $$;",
      "DO $$ DECLARE s text; BEGIN SELECT string_agg(relname, '') INTO s FROM pg_class WHERE relname ~ 'accruals'; EXECUTE 'SELECT * FROM ' || s; END $$;"
    ]) {
      expect(sqlFailures(sql).join()).toContain("dynamic SQL");
    }
  });

  test("a plpgsql function with EXECUTE is refused where it is CREATED, even if the migration calls and drops it", () => {
    const failures = findPayrollSqlLeaks([
      {
        name: "999.sql",
        sql: `CREATE FUNCTION awcms_oneshot(t text) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN EXECUTE 'INSERT INTO awcms_copy SELECT * FROM ' || t; END $f$;
SELECT awcms_oneshot('awcms_hr_' || 'commission_accruals');
DROP FUNCTION awcms_oneshot(text);`
      }
    ]);

    expect(failures.join()).toContain("awcms_oneshot");
    expect(failures.join()).toContain("dynamic SQL");
  });

  test("the same function in an allow-listed migration, a trigger declaration, and a payroll-family function are accepted", () => {
    const create = `CREATE FUNCTION awcms_oneshot() RETURNS void LANGUAGE plpgsql AS $f$ BEGIN EXECUTE 'SELECT 1'; END $f$;`;

    expect(
      findPayrollSqlLeaks([
        { name: "099_awcms_sync_outbox_retire.sql", sql: create }
      ])
    ).toEqual([]);
    expect(
      sqlFailures(create.replace("awcms_oneshot", "awcms_hr_payroll_oneshot"))
    ).toEqual([]);
    expect(
      sqlFailures(
        `CREATE FUNCTION awcms_t() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN RETURN NEW; END $f$;
CREATE TRIGGER awcms_t BEFORE INSERT ON awcms_x FOR EACH ROW EXECUTE FUNCTION awcms_t();`
      )
    ).toEqual([]);
  });

  test.each([
    "SELECT query_to_xml('select 1', true, false, '');",
    "SELECT * FROM ts_stat('select 1');",
    "SELECT dblink_exec('dbname=x', 'insert into y select 1');"
  ])("a top-level helper that runs a query text is refused: %s", (sql) => {
    expect(sqlFailures(sql).length).toBeGreaterThan(0);
  });
});

describe("M6 - policies, constraints, defaults, indexes and columns that depend on payroll", () => {
  const dependency = (
    kind: string,
    relation: string,
    referenced: string
  ): CatalogSnapshot["dependencies"][number] => ({
    kind,
    object: "o",
    relation,
    referenced
  });

  test.each([
    ["policy", "policy"],
    ["constraint", "constraint"],
    ["column-default", "column-default"],
    ["index", "index"],
    ["column-type", "column-type"],
    ["statistics", "statistics"]
  ])(
    "catalog: a %s on an ordinary table that depends on a payroll relation is refused",
    (kind) => {
      expect(
        codes(
          snapshot({
            dependencies: [dependency(kind, "public.awcms_staff", ACCRUALS)]
          })
        )
      ).toEqual(["dependent-on-payroll"]);
    }
  );

  test("catalog: the same dependency on a payroll function is refused", () => {
    expect(
      codes(
        snapshot({
          dependencies: [
            dependency(
              "column-default",
              "public.awcms_staff",
              "public.awcms_hr_payroll_next"
            )
          ]
        })
      )
    ).toEqual(["dependent-on-payroll"]);
  });

  test("catalog: a payroll table's own policy, a payroll-to-ordinary dependency and an ordinary-to-ordinary one are clean", () => {
    expect(
      codes(
        snapshot({
          dependencies: [
            dependency("policy", ACCRUALS, ACCRUALS),
            dependency("constraint", ACCRUALS, "public.awcms_employments"),
            dependency(
              "constraint",
              "public.awcms_staff",
              "public.awcms_tenants"
            )
          ]
        })
      )
    ).toEqual([]);
  });

  test("a dependency exemption goes stale when the object is gone", () => {
    expect(
      staleCatalogExemptions(
        snapshot({
          dependencies: [dependency("policy", "public.awcms_staff", ACCRUALS)]
        }),
        {
          "public.awcms_staff.o": "r",
          "public.awcms_staff.gone": "r"
        }
      )
    ).toEqual(["public.awcms_staff.gone"]);
  });
});

describe("info - functions the catalog layer cannot read", () => {
  test.each(["c", "plperl", "plpython3u", "internal"])(
    "a function in %s is refused, family or not",
    (language) => {
      expect(
        codes(snapshot({ functions: [fn("awcms_x", { language })] }))
      ).toEqual(["function-opaque-language"]);
      expect(
        codes(snapshot({ functions: [fn("awcms_hr_payroll_x", { language })] }))
      ).toEqual(["function-opaque-language"]);
    }
  );

  test("sql and plpgsql are readable", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("a", { language: "sql" }),
            fn("b", { language: "plpgsql" })
          ]
        })
      )
    ).toEqual([]);
  });
});

describe("M7 - write-path functions and the sensitive-read import gate", () => {
  const LEDGER =
    "src/modules/hr-commission/application/hr-commission-accrual-ledger.ts";

  test("accrueCommission and transitionAccrual are guarded imports of the ledger", () => {
    const guarded = PAYROLL_READ_FUNCTION_IMPORTS.filter(
      (entry) => entry.source === LEDGER
    ).flatMap((entry) => [...entry.functions]);

    expect(guarded).toContain("accrueCommission");
    expect(guarded).toContain("transitionAccrual");
  });

  test("a NEW caller of transitionAccrual is refused; an audit exemption must carry a reason", () => {
    const registry: PayrollReadFunctionImport[] = [
      {
        source: LEDGER,
        functions: ["transitionAccrual"],
        permission: "hr_commission.accruals.read",
        allowedImporters: ["src/pages/known.ts"],
        writePathFunctions: ["transitionAccrual"],
        auditExemptImporters: {
          "src/pages/known.ts":
            "returns the row to a caller who holds the transition power"
        }
      }
    ];
    const call = () =>
      `import { transitionAccrual } from "../hr-commission/application/hr-commission-accrual-ledger";\nexport const x = transitionAccrual;`;
    const constants = () => new Map<string, string | null>();
    const result = findForbiddenReadImports(
      [call(), call()],
      ["src/pages/known.ts", "src/pages/new.ts"],
      registry,
      constants
    );

    // The exempt, allow-listed importer needs no read audit; the new one is refused.
    expect(result.forbidden.map((entry) => entry.source)).toEqual([
      "src/pages/new.ts"
    ]);
  });
});

describe("M7 - scripts are inside the sensitive-read gate", () => {
  test("the scan roots include scripts/, and the repository as scanned is valid", async () => {
    const { SENSITIVE_READ_SCAN_ROOTS, collectSensitiveReadSources } =
      await import("../scripts/sensitive-reads-check");
    const { listModules } = await import("../src/modules");
    const { evaluateSensitiveReadCoverage } =
      await import("../src/modules/_shared/sensitive-read-coverage");
    const { files, sources } = collectSensitiveReadSources();

    expect(SENSITIVE_READ_SCAN_ROOTS).toContain("scripts");
    expect(files.some((file) => file.startsWith("scripts/"))).toBe(true);
    expect(
      evaluateSensitiveReadCoverage(listModules(), sources, files).valid
    ).toBe(true);
  });

  test("a script that names a payroll table without an audit or an exemption is refused", async () => {
    const { listModules } = await import("../src/modules");
    const { evaluateSensitiveReadCoverage } =
      await import("../src/modules/_shared/sensitive-read-coverage");
    const result = evaluateSensitiveReadCoverage(
      listModules(),
      ["await sql`SELECT * FROM awcms_hr_commission_accruals`"],
      ["scripts/new-report.ts"]
    );

    expect(result.valid).toBe(false);
    expect(result.unauditedTableReaders.map((reader) => reader.source)).toEqual(
      ["scripts/new-report.ts"]
    );
  });
});

describe("security audit of #1077 - hardening", () => {
  test("catalog: required triggers, family-named leftovers and the migration owner", () => {
    // A look-alike under the family name has no triggers.
    expect(codes(snapshot({ triggers: [] })).sort()).toEqual(
      ["payroll-trigger-missing"].flatMap((code) =>
        Array(Object.values(PAYROLL_REQUIRED_TRIGGERS).flat().length).fill(code)
      )
    );

    // The renamed original keeps its family-named index, constraint and trigger.
    const left = analysePayrollCatalog(
      snapshot({
        namedObjects: [
          {
            kind: "index",
            name: "awcms_hr_commission_accruals_pkey",
            relation: "public.awcms_probe_x"
          },
          {
            kind: "index",
            name: "awcms_hr_commission_accruals_pkey",
            relation: ACCRUALS
          }
        ],
        triggers: [
          ...REQUIRED,
          {
            relation: "public.awcms_probe_x",
            name: "awcms_hr_commission_accruals_log_birth",
            function: "public.awcms_hr_commission_accruals_log_birth"
          }
        ].filter((entry) => "function" in entry) as CatalogSnapshot["triggers"]
      })
    ).filter((finding) => finding.code === "payroll-named-object-outside");

    expect(left.map((finding) => finding.object)).toEqual([
      "public.awcms_probe_x.awcms_hr_commission_accruals_pkey"
    ]);

    // The expected owner is the owner of the migration ledger.
    const owned = (migrationOwner: string | null, owner: string) =>
      analysePayrollCatalog(
        snapshot({
          migrationOwner,
          relations: REQUIRED.map((relation) => ({ ...relation, owner }))
        })
      ).map((finding) => finding.code);

    expect(owned("migrator", "migrator")).toEqual([]);
    expect(owned("migrator", "someone_else")).toEqual([
      "payroll-owner",
      "payroll-owner"
    ]);
    // No ledger and no configured owner: nothing to compare with is a finding.
    expect(owned(null, "someone_else")).toEqual(["payroll-ledger-missing"]);
    expect(
      analysePayrollCatalog(
        snapshot({
          migrationOwner: "migrator",
          relations: REQUIRED.map((relation) => ({
            ...relation,
            owner: "ops"
          }))
        }),
        { expectedOwners: ["ops"] }
      )
    ).toEqual([]);
  });

  test("catalog: members of pg_read_all_data and of superuser or BYPASSRLS roles hold payroll too; a bypassing runtime role is refused", () => {
    expect(
      codes(
        snapshot({
          memberships: [{ role: "pg_read_all_data", member: "awcms_worker" }]
        })
      )
    ).toEqual(["payroll-role-membership"]);
    expect(
      codes(
        snapshot({
          memberships: [{ role: "pg_write_all_data", member: "ci" }]
        })
      )
    ).toEqual(["payroll-role-membership"]);
    expect(
      codes(
        snapshot({
          roles: [{ name: "boss", superuser: true, bypassRls: true }],
          memberships: [{ role: "boss", member: "intern" }]
        })
      )
    ).toEqual(["payroll-role-membership"]);
    expect(
      codes(
        snapshot({
          roles: [{ name: "awcms_worker", superuser: false, bypassRls: true }]
        })
      )
    ).toEqual(["payroll-role-bypass"]);
    expect(
      codes(
        snapshot({
          roles: [{ name: "analyst", superuser: false, bypassRls: false }]
        })
      )
    ).toEqual([]);
  });

  test("catalog: a domain CHECK that depends on a payroll function is a dependent object", () => {
    expect(
      codes(
        snapshot({
          dependencies: [
            {
              kind: "domain-constraint",
              object: "c",
              relation: "public.awcms_probe_dom",
              referenced: "public.awcms_hr_payroll_probe_ok"
            }
          ]
        })
      )
    ).toEqual(["dependent-on-payroll"]);
  });

  test.each([
    "SELECT pg_catalog.\"format\"('%I', 1)",
    "SELECT \"query_to_xml\"('x', true, false, '')",
    "SELECT ts_rewrite('a'::tsquery, 'select 1')",
    "SELECT * FROM crosstab('select 1')",
    "SELECT connectby('t', 'a', 'b', 'x', 1)",
    "SELECT lo_from_bytea(0, 'x')",
    "SELECT lo_import('/etc/passwd')",
    "SELECT pg_read_file('/x')",
    "SELECT pg_read_binary_file('/x')"
  ])("the indirect-read pattern matches %s", (body) => {
    expect(PAYROLL_INDIRECT_READ_PATTERN.test(body)).toBe(true);
  });

  test.each([
    "SELECT reformat(1)",
    "SELECT format_something(1)",
    "SELECT 1 AS my_crosstab_total",
    "SELECT count(*) FROM awcms_staff"
  ])("the indirect-read pattern ignores %s", (body) => {
    expect(PAYROLL_INDIRECT_READ_PATTERN.test(body)).toBe(false);
  });

  test("static: the final COMMENT ON TABLE of a family table must carry the marker; a later one may repair an earlier one", () => {
    const comment = (text: string) =>
      `COMMENT ON TABLE awcms_hr_commission_accruals IS ${text};`;

    expect(sqlFailures(comment("NULL")).join()).toContain("payroll-boundary");
    expect(sqlFailures(comment("'just a description'")).length).toBe(1);
    expect(sqlFailures(comment("'payroll-boundary: ok'"))).toEqual([]);
    expect(
      findPayrollSqlLeaks([
        { name: "1.sql", sql: comment("'old description'") },
        { name: "2.sql", sql: comment("'payroll-boundary: repaired'") }
      ])
    ).toEqual([]);
    expect(sqlFailures("COMMENT ON TABLE awcms_staff IS NULL;")).toEqual([]);
  });

  test("static: DROP TRIGGER on a payroll table is refused; DISABLE needs an ENABLE in the same migration", () => {
    expect(
      sqlFailures(
        "DROP TRIGGER awcms_hr_commission_accruals_immutable ON awcms_hr_commission_accruals;"
      ).length
    ).toBeGreaterThan(0);
    expect(
      sqlFailures(
        "ALTER TABLE awcms_hr_commission_accruals DISABLE TRIGGER t;"
      ).join()
    ).toContain("never followed by ENABLE");
    expect(
      sqlFailures(
        "ALTER TABLE awcms_hr_commission_accruals DISABLE TRIGGER t; UPDATE awcms_x SET a = 1; ALTER TABLE awcms_hr_commission_accruals ENABLE TRIGGER t;"
      )
    ).toEqual([]);
    expect(
      sqlFailures(
        "ALTER TABLE awcms_hr_commission_accruals ENABLE ALWAYS TRIGGER t;"
      ).length
    ).toBeGreaterThan(0);
    expect(sqlFailures("DROP TRIGGER t ON awcms_staff;")).toEqual([]);
  });

  test.each([
    ["ALTER INDEX", "ALTER INDEX awcms_hr_commission_accruals RENAME TO x;"],
    [
      "ALTER SEQUENCE",
      "ALTER SEQUENCE awcms_hr_commission_accruals RENAME TO x;"
    ],
    [
      "ALTER MATERIALIZED VIEW SET SCHEMA",
      "ALTER MATERIALIZED VIEW awcms_hr_payroll_summary SET SCHEMA archive;"
    ],
    [
      "OWNER TO on the table",
      "ALTER TABLE awcms_hr_commission_accruals OWNER TO someone;"
    ],
    [
      "OWNER TO on a family function",
      "ALTER FUNCTION awcms_hr_commission_accruals_immutable() OWNER TO someone;"
    ],
    ["REASSIGN OWNED", "REASSIGN OWNED BY a TO b;"],
    [
      "ALTER EXTENSION ADD",
      "ALTER EXTENSION pg_trgm ADD TABLE awcms_hr_commission_accruals;"
    ],
    [
      "a rename inside a LANGUAGE sql function",
      "CREATE FUNCTION awcms_mv() RETURNS void LANGUAGE sql AS $$ ALTER TABLE awcms_hr_commission_accruals RENAME TO x $$;"
    ],
    [
      "UPDATE ... FROM payroll",
      "UPDATE awcms_t SET a = p.amount FROM awcms_hr_commission_accruals p WHERE true;"
    ],
    [
      "a quoted ts_rewrite without a paren",
      "SELECT \"ts_rewrite\" ('a'::tsquery, 'x');"
    ],
    ["lo_import", "SELECT lo_import('/tmp/x');"],
    ["pg_read_file", "SELECT pg_read_file('/tmp/x');"]
  ])("static: %s is refused", (_name, sql) => {
    expect(sqlFailures(sql).length).toBeGreaterThan(0);
  });

  test("static: unrelated ALTERs, an ordinary UPDATE and an ordinary owner change pass", () => {
    for (const sql of [
      "ALTER INDEX awcms_staff_idx RENAME TO awcms_staff_idx2;",
      "ALTER TABLE awcms_staff OWNER TO someone;",
      "UPDATE awcms_staff SET a = 1 FROM awcms_tenants t WHERE true;",
      "ALTER EXTENSION pg_trgm UPDATE;"
    ]) {
      expect(sqlFailures(sql)).toEqual([]);
    }
  });

  test("static: a create-call-drop SQL function that reads payroll is refused", () => {
    expect(
      sqlFailures(`CREATE TABLE awcms_sink (a numeric);
CREATE FUNCTION awcms_cp() RETURNS void LANGUAGE sql AS $$ INSERT INTO awcms_sink SELECT amount FROM awcms_hr_commission_accruals $$;
SELECT awcms_cp();
DROP FUNCTION awcms_cp();`).join()
    ).toContain("awcms_cp");
  });

  test("the pathological statements of the audit run in linear-ish time", () => {
    const started = performance.now();

    findPayrollSqlLeaks([
      {
        name: "x.sql",
        sql: "DO $$ BEGIN " + "ALTER TABLE a ".repeat(8000) + " END $$;"
      }
    ]);
    findPayrollSqlLeaks([
      { name: "y.sql", sql: "COPY (" + "(".repeat(8000) + " TO" }
    ]);
    PAYROLL_INDIRECT_READ_PATTERN.test("a".repeat(400000) + "_to_xml");

    expect(performance.now() - started).toBeLessThan(2000);
  });

  test("the port adapter is a guarded import with no allowed importer", () => {
    const entry = PAYROLL_READ_FUNCTION_IMPORTS.find((candidate) =>
      candidate.functions.includes("createCommissionAccrualPort")
    );

    expect(entry?.allowedImporters).toEqual([]);

    const source =
      'import { createCommissionAccrualPort } from "../../../../modules/hr-commission/application/hr-commission-accrual-port-adapter";\nexport const x = createCommissionAccrualPort;';
    const result = findForbiddenReadImports(
      [source],
      ["src/pages/api/v1/evil/port.ts"],
      PAYROLL_READ_FUNCTION_IMPORTS,
      () => new Map<string, string | null>()
    );

    expect(result.forbidden.map((item) => item.source)).toEqual([
      "src/pages/api/v1/evil/port.ts"
    ]);
  });

  test("the sensitive-read scan reads .mts .cts .jsx .cjs too", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(
      new URL("../scripts/sensitive-reads-check.ts", import.meta.url),
      "utf8"
    );

    for (const extension of [".mts", ".cts", ".jsx", ".cjs"]) {
      expect(text).toContain(`"${extension}"`);
    }
  });
});

describe("re-verification audit of #1077", () => {
  const table = "awcms_hr_commission_accruals";
  const columns = Array.from({ length: 12 }, (_, i) => `c${i}:text`);

  test("catalog: a required trigger that exists but is disabled is refused (HIGH-2)", () => {
    const triggers = REQUIRED_TRIGGERS.map((trigger) =>
      trigger.name === `${table}_immutable`
        ? { ...trigger, enabled: "D" }
        : { ...trigger, enabled: "O" }
    );

    expect(codes(snapshot({ triggers }))).toEqual(["payroll-trigger-disabled"]);
  });

  test("catalog: no ledger and no configured owner is a finding, not a pass (MEDIUM-1)", () => {
    expect(codes(snapshot({ migrationOwner: null }))).toEqual([
      "payroll-ledger-missing"
    ]);
    expect(
      analysePayrollCatalog(snapshot({ migrationOwner: null }), {
        expectedOwners: ["owner"]
      })
    ).toEqual([]);
  });

  test("catalog: the transition log must still reference the ledger (HIGH-1)", () => {
    expect(codes(snapshot({ foreignKeys: [] }))).toEqual([
      "payroll-fk-missing"
    ]);
  });

  test("catalog: a non-family relation with the ledger's columns is the ledger renamed or copied (HIGH-1)", () => {
    const withColumns = (extra: CatalogSnapshot["columns"]) =>
      snapshot({
        columns: [{ relation: ACCRUALS, columns }, ...extra]
      });

    expect(
      codes(
        withColumns([
          { relation: "public.awcms_probe_x", columns: [...columns] }
        ])
      )
    ).toEqual(["payroll-lookalike"]);
    // Renaming a column or two does not hide it.
    expect(
      codes(
        withColumns([
          {
            relation: "public.awcms_probe_x",
            columns: [...columns.slice(2), "renamed:text", "other:int"]
          }
        ])
      )
    ).toEqual(["payroll-lookalike"]);
    // An ordinary table, a family table, and a table with a few shared names are fine.
    expect(
      codes(
        withColumns([
          { relation: "public.awcms_staff", columns: ["id:uuid", "c0:text"] },
          { relation: "public.awcms_hr_payroll_runs", columns: [...columns] }
        ])
      )
    ).toEqual([]);
  });

  test("static: DISABLE is paired per trigger, ALL and USER expand, and ENABLE ALL repairs", () => {
    const pre = `ALTER TABLE ${table} DISABLE TRIGGER`;
    const post = `ALTER TABLE ${table} ENABLE TRIGGER`;

    expect(
      sqlFailures(`${pre} ALL; ${post} ${table}_log_birth;`).join()
    ).toContain("HIGH-2");
    expect(
      sqlFailures(`${pre} USER; ${post} ${table}_log_birth;`).length
    ).toBeGreaterThan(0);
    expect(sqlFailures(`${pre} ALL; ${post} ALL;`)).toEqual([]);
    expect(sqlFailures(`${pre} USER; ${post} USER;`)).toEqual([]);
    expect(
      sqlFailures(
        `${pre} ${table}_immutable; ${post} awcms_hr_commission_transitions_guard;`
      ).length
    ).toBeGreaterThan(0);
    expect(
      sqlFailures(`${pre} ${table}_immutable; ${post} ${table}_immutable;`)
    ).toEqual([]);
  });

  test.each([
    ["DO E'...'", "DO E'BEGIN PERFORM 1; END';"],
    ["DO U&'...'", "DO U&'BEGIN PERFORM 1; END';"],
    [
      "function AS E'...'",
      "CREATE FUNCTION awcms_f() RETURNS void LANGUAGE sql AS E'SELECT 1';"
    ],
    [
      "an E'' literal inside a dollar-quoted body",
      "DO $$ BEGIN EXECUTE E'SELECT 1'; END $$;"
    ]
  ])("static: %s is refused (HIGH-1)", (_name, sql) => {
    expect(sqlFailures(sql).join()).toContain("escaped string literal");
  });

  test("static: plain dollar-quoted bodies and ordinary E'' data outside DO/functions pass", () => {
    expect(sqlFailures("DO $$ BEGIN PERFORM 1; END $$;")).toEqual([]);
    expect(
      sqlFailures("INSERT INTO awcms_notes (body) VALUES (E'a\\nb');")
    ).toEqual([]);
  });

  test("static: session_replication_role is refused (LOW-3)", () => {
    for (const sql of [
      "SET LOCAL session_replication_role = replica;",
      "SET session_replication_role TO 'replica';",
      "SELECT set_config('session_replication_role', 'replica', true);"
    ]) {
      expect(sqlFailures(sql).join()).toContain("session_replication_role");
    }
  });

  test("static: the marker is accepted in plain and dollar-quoted form, not in E'' form (LOW-1)", () => {
    const comment = (literal: string) =>
      `COMMENT ON TABLE ${table} IS ${literal};`;

    expect(sqlFailures(comment("'payroll-boundary: x'"))).toEqual([]);
    expect(sqlFailures(comment("$m$payroll-boundary: x$m$"))).toEqual([]);
    expect(sqlFailures(comment("$$payroll-boundary: x$$"))).toEqual([]);
    expect(sqlFailures(comment("E'payroll-boundary: x'")).length).toBe(1);
  });

  test("static: a quoted look-alike target, a trigger rename and a direct catalog write are refused", () => {
    for (const sql of [
      `ALTER TABLE ${table} RENAME TO "AWCMS_HR_COMMISSION_ACCRUALS";`,
      `ALTER TABLE ${table} RENAME TO "awcms_hr_commission_accruals ";`,
      `ALTER TRIGGER ${table}_immutable ON ${table} RENAME TO t2;`,
      "UPDATE pg_class SET relname = 'x' WHERE relname = 'y';",
      "UPDATE pg_catalog.pg_trigger SET tgenabled = 'D';"
    ]) {
      expect(sqlFailures(sql).length).toBeGreaterThan(0);
    }

    expect(
      sqlFailures(
        `ALTER TABLE ${table} RENAME TO awcms_hr_commission_accruals_v2;`
      )
    ).toEqual([]);
  });
});
