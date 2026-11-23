/**
 * The payroll boundary moves from deny-list scanning to allow-lists (Issue
 * #1436, ADR-0173). No database; the same rules run against a migrated catalog
 * in `tests/integration/payroll-catalog-boundary.integration.test.ts` (the
 * `adr0173-*` probes and the "ADR-0173 allow-lists" block).
 *
 * Three rules:
 *
 *   1. a non-family SECURITY DEFINER function whose OWNER reaches payroll is a
 *      reviewed, pinned entry of PAYROLL_SECURITY_DEFINER_ALLOWLIST or a
 *      finding;
 *   2. a SQL-standard (BEGIN ATOMIC) body is analysed like any other body: its
 *      deparsed text and the functions pg_depend records for it;
 *   3. each required payroll table is pinned by a fingerprint (columns and
 *      types, required triggers with function and tgtype, foreign keys), and a
 *      non-family relation with the ledger's column types under other names is
 *      the ledger.
 *
 * Every rule here was also proven by mutating the analyser (the evidence is in
 * the PR body).
 */
import { describe, expect, test } from "bun:test";

import {
  PAYROLL_REQUIRED_TABLE_FINGERPRINTS,
  PAYROLL_SECURITY_DEFINER_ALLOWLIST,
  validatePayrollSecurityDefinerAllowlist,
  type PayrollSecurityDefinerAllowEntry
} from "../src/modules/_shared/payroll-data-boundary";
import {
  PAYROLL_ALLOWLIST_FINDING_CODES,
  analysePayrollCatalog as analyseWithoutFixture,
  functionDefinitionSha256,
  functionSignature,
  multisetDistance,
  multisetMissing,
  staleSecurityDefinerAllowlist,
  type AnalyseOptions,
  type CatalogSnapshot
} from "../scripts/lib/payroll-catalog-boundary";
import { evaluatePayrollCatalog } from "../scripts/lib/payroll-catalog-check-run";
import { findPayrollSqlLeaks } from "../scripts/payroll-sql-boundary-check";
import {
  TEST_PAYROLL_FINGERPRINTS,
  healthyPayrollTriggerFunctions,
  analysePayrollCatalog,
  HEALTHY_PAYROLL_COLUMNS,
  HEALTHY_PAYROLL_FOREIGN_KEYS,
  HEALTHY_PAYROLL_TRIGGERS
} from "./fixtures/payroll-fingerprint-snapshot";

const ACCRUALS = "public.awcms_hr_commission_accruals";
const TRANSITIONS = "public.awcms_hr_commission_transitions";
const LEDGER =
  PAYROLL_REQUIRED_TABLE_FINGERPRINTS["awcms_hr_commission_accruals"]!;
const LOG =
  PAYROLL_REQUIRED_TABLE_FINGERPRINTS["awcms_hr_commission_transitions"]!;

function snapshot(partial: Partial<CatalogSnapshot> = {}): CatalogSnapshot {
  return {
    migrationOwner: "owner",
    columns: HEALTHY_PAYROLL_COLUMNS,
    foreignKeys: HEALTHY_PAYROLL_FOREIGN_KEYS,
    roles: [],
    namedObjects: [],
    rules: [],
    functions: [],
    triggers: HEALTHY_PAYROLL_TRIGGERS,
    grants: [],
    inheritance: [],
    relations: [ACCRUALS, TRANSITIONS].map((name) => ({
      name,
      relkind: "r",
      owner: "owner",
      comment: "payroll-boundary: test"
    })),
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
    returnType: "integer",
    owner: "owner",
    source: "SELECT 1",
    rowTypeRelations: [],
    dependsOnRelations: [],
    executeGrantees: ["owner"],
    identity: "",
    ...overrides
  };
}

const codes = (s: CatalogSnapshot, options: AnalyseOptions = {}) =>
  analysePayrollCatalog(s, options).map((finding) => finding.code);

const definer = (owner: string, source = "SELECT 1") =>
  fn("awcms_probe_definer", { securityDefiner: true, owner, source });

describe("rule 1: non-family SECURITY DEFINER functions in payroll's reach are allow-listed", () => {
  test("owned by a dedicated role with no payroll privilege: no entry needed", () => {
    expect(
      codes(snapshot({ functions: [definer("awcms_probe_dedicated")] }))
    ).toEqual([]);
  });

  test("owned by the migration owner (which owns payroll): a finding, whatever the body says", () => {
    expect(codes(snapshot({ functions: [definer("owner")] }))).toEqual([
      "security-definer-not-allow-listed"
    ]);
  });

  test("the same function without SECURITY DEFINER, or in the payroll family, is not this rule's business", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_probe_invoker", { owner: "owner" }),
            fn("awcms_hr_payroll_probe_definer", {
              securityDefiner: true,
              owner: "owner"
            })
          ]
        })
      )
    ).toEqual([]);
  });

  test.each([
    [
      "an expected owner",
      { expectedOwners: ["awcms_probe_split_owner"] },
      {},
      "awcms_probe_split_owner"
    ],
    ["the request role", {}, {}, "awcms_app"],
    [
      "a superuser",
      {},
      {
        roles: [
          { name: "awcms_probe_super", superuser: true, bypassRls: false }
        ]
      },
      "awcms_probe_super"
    ],
    [
      "a BYPASSRLS role",
      {},
      {
        roles: [
          { name: "awcms_probe_bypass", superuser: false, bypassRls: true }
        ]
      },
      "awcms_probe_bypass"
    ],
    ["a member of pg_read_all_data", {}, {}, "pg_read_all_data"],
    [
      "a member of pg_execute_server_program (audit M3)",
      {},
      {
        memberships: [
          { role: "pg_execute_server_program", member: "awcms_probe_prog" }
        ]
      },
      "awcms_probe_prog"
    ],
    [
      "a member of pg_read_server_files (audit M3)",
      {},
      {
        memberships: [
          { role: "pg_read_server_files", member: "awcms_probe_files" }
        ]
      },
      "awcms_probe_files"
    ],
    [
      "a member of pg_write_server_files (audit M3)",
      {},
      {
        memberships: [
          { role: "pg_write_server_files", member: "awcms_probe_wfiles" }
        ]
      },
      "awcms_probe_wfiles"
    ],
    [
      "a REPLICATION role (audit M3)",
      {},
      {
        roles: [
          {
            name: "awcms_probe_repl",
            superuser: false,
            bypassRls: false,
            replication: true
          }
        ]
      },
      "awcms_probe_repl"
    ],
    [
      "a member of the request role (through another role)",
      {},
      {
        memberships: [
          { role: "awcms_app", member: "awcms_probe_mid" },
          { role: "awcms_probe_mid", member: "awcms_probe_leaf" }
        ]
      },
      "awcms_probe_leaf"
    ],
    [
      "a grantee on a payroll table",
      {},
      {
        grants: [
          {
            relation: ACCRUALS,
            owner: "owner",
            grantee: "awcms_probe_reader",
            privilege: "SELECT",
            column: null
          }
        ]
      },
      "awcms_probe_reader"
    ],
    [
      "an EXECUTE grantee of a family SECURITY DEFINER function",
      {},
      {
        functions: [
          fn("awcms_hr_payroll_probe_total", {
            securityDefiner: true,
            executeGrantees: ["owner", "awcms_probe_caller"]
          })
        ]
      },
      "awcms_probe_caller"
    ]
  ] as const)(
    "an owner that is %s reaches payroll",
    (_label, options, partial, owner) => {
      const base = snapshot(partial as Partial<CatalogSnapshot>);
      const found = codes(
        { ...base, functions: [...base.functions, definer(owner)] },
        options as AnalyseOptions
      );

      expect(found).toContain("security-definer-not-allow-listed");
    }
  );

  test("an extension member is held to the same rule (audit L1)", () => {
    const hidden = { ...definer("owner"), extensionMember: true };

    expect(codes(snapshot({ extensionDefiners: [hidden] }))).toEqual([
      "security-definer-not-allow-listed"
    ]);
    expect(
      codes(
        snapshot({
          extensionDefiners: [{ ...hidden, owner: "awcms_probe_dedicated" }]
        })
      )
    ).toEqual([]);
  });

  test("split-role: payroll owned by one role, migrations by another; a definer owned by the MIGRATION role still reaches (audit L3)", () => {
    const split = snapshot({
      migrationOwner: "awcms_probe_migrator",
      relations: [ACCRUALS, TRANSITIONS].map((name) => ({
        name,
        relkind: "r",
        owner: "awcms_probe_payroll_owner",
        comment: "payroll-boundary: test"
      })),
      functions: [
        ...healthyPayrollTriggerFunctions("awcms_probe_payroll_owner"),
        definer("awcms_probe_migrator")
      ]
    });

    expect(
      codes(split, { expectedOwners: ["awcms_probe_payroll_owner"] })
    ).toEqual(["security-definer-not-allow-listed"]);
  });

  test("PUBLIC executing a family SECURITY DEFINER function puts every owner in reach", () => {
    const found = codes(
      snapshot({
        functions: [
          fn("awcms_hr_payroll_probe_total", {
            securityDefiner: true,
            executeGrantees: ["owner", "PUBLIC"]
          }),
          definer("awcms_probe_dedicated")
        ]
      })
    );

    expect(found).toContain("security-definer-not-allow-listed");
  });

  describe("an allow-list entry pins the reviewed object", () => {
    const entry = (
      overrides: Partial<PayrollSecurityDefinerAllowEntry> = {}
    ): Record<string, PayrollSecurityDefinerAllowEntry> => ({
      "public.awcms_probe_definer()": {
        reason:
          "probe: reviewed SECURITY DEFINER function owned by the payroll owner",
        approvedIn: "#1436",
        owner: "owner",
        definitionSha256: functionDefinitionSha256(definer("owner")),
        executeGrantees: ["owner"],
        ...overrides
      }
    });

    test("a matching entry passes", () => {
      expect(
        codes(snapshot({ functions: [definer("owner")] }), {
          securityDefinerAllowlist: entry()
        })
      ).toEqual([]);
    });

    test("a changed body is drift", () => {
      expect(
        codes(snapshot({ functions: [definer("owner", "SELECT 2")] }), {
          securityDefinerAllowlist: entry()
        })
      ).toEqual(["security-definer-allowlist-drift"]);
    });

    test("a SET clause removed (RESET search_path) is drift (audit M4)", () => {
      const pinned = entry({
        definitionSha256: functionDefinitionSha256({
          ...definer("owner"),
          config: ["search_path=pg_catalog, public"]
        })
      });

      expect(
        codes(
          snapshot({
            functions: [
              {
                ...definer("owner"),
                config: ["search_path=pg_catalog, public"]
              }
            ]
          }),
          { securityDefinerAllowlist: pinned }
        )
      ).toEqual([]);
      expect(
        codes(snapshot({ functions: [{ ...definer("owner"), config: [] }] }), {
          securityDefinerAllowlist: pinned
        })
      ).toEqual(["security-definer-allowlist-drift"]);
    });

    test.each([
      ["volatility", { volatility: "i" }],
      ["language", { language: "plpgsql" }],
      ["kind", { kind: "p" }],
      ["leakproof", { leakproof: true }]
    ] as const)("a changed %s is drift (audit M4)", (_label, patch) => {
      expect(
        codes(snapshot({ functions: [{ ...definer("owner"), ...patch }] }), {
          securityDefinerAllowlist: entry()
        })
      ).toEqual(["security-definer-allowlist-drift"]);
    });

    test("GRANT EXECUTE to PUBLIC (or another role) is drift (audit M4)", () => {
      expect(
        codes(
          snapshot({
            functions: [
              { ...definer("owner"), executeGrantees: ["owner", "PUBLIC"] }
            ]
          }),
          { securityDefinerAllowlist: entry() }
        )
      ).toEqual(["security-definer-allowlist-drift"]);
      // Order and duplicates do not matter.
      expect(
        codes(
          snapshot({
            functions: [
              { ...definer("owner"), executeGrantees: ["owner", "owner"] }
            ]
          }),
          { securityDefinerAllowlist: entry() }
        )
      ).toEqual([]);
    });

    test("a changed owner is drift", () => {
      expect(
        codes(snapshot({ functions: [definer("awcms_probe_other")] }), {
          securityDefinerAllowlist: entry()
        })
      ).toEqual(["security-definer-allowlist-drift"]);
    });

    test("the key carries the identity arguments, so an overload is not covered", () => {
      const overload = fn("awcms_probe_definer", {
        securityDefiner: true,
        owner: "owner",
        identity: "p_tenant_id uuid"
      });

      expect(functionSignature(overload)).toBe(
        "public.awcms_probe_definer(p_tenant_id uuid)"
      );
      expect(
        codes(snapshot({ functions: [overload] }), {
          securityDefinerAllowlist: entry()
        })
      ).toEqual(["security-definer-not-allow-listed"]);
    });

    test("an entry whose function is gone (or no longer SECURITY DEFINER) is stale", () => {
      expect(staleSecurityDefinerAllowlist(snapshot(), entry())).toEqual([
        "public.awcms_probe_definer()"
      ]);
      expect(
        staleSecurityDefinerAllowlist(
          snapshot({ functions: [fn("awcms_probe_definer")] }),
          entry()
        )
      ).toEqual(["public.awcms_probe_definer()"]);
      expect(
        staleSecurityDefinerAllowlist(
          snapshot({ functions: [definer("owner")] }),
          entry()
        )
      ).toEqual([]);
    });

    test("PAYROLL_CATALOG_EXEMPTIONS does not silence an allow-list code", () => {
      expect(
        codes(snapshot({ functions: [definer("owner")] }), {
          exemptions: { "public.awcms_probe_definer()": "reviewed elsewhere" }
        })
      ).toEqual(["security-definer-not-allow-listed"]);
      expect(PAYROLL_ALLOWLIST_FINDING_CODES).toContain(
        "security-definer-not-allow-listed"
      );
    });
  });

  describe("the registry itself", () => {
    const valid: PayrollSecurityDefinerAllowEntry = {
      reason: "a reviewed SECURITY DEFINER function, with the reason why",
      approvedIn: "ADR-0173",
      owner: "awcms_probe_definer_owner",
      definitionSha256: "a".repeat(64),
      executeGrantees: ["awcms_probe_definer_owner"]
    };

    test("the registered list is valid and EMPTY", () => {
      expect(
        validatePayrollSecurityDefinerAllowlist(
          PAYROLL_SECURITY_DEFINER_ALLOWLIST
        )
      ).toEqual([]);
      expect(Object.keys(PAYROLL_SECURITY_DEFINER_ALLOWLIST)).toEqual([]);
    });

    test("a well-formed entry is valid", () => {
      expect(
        validatePayrollSecurityDefinerAllowlist({
          "public.awcms_probe_fn(p_tenant_id uuid)": valid
        })
      ).toEqual([]);
    });

    test.each([
      ["a key without arguments", "public.awcms_probe_fn", {}],
      ["a quoted key", 'public."awcms_probe_fn"()', {}],
      ["a family function", "public.awcms_hr_payroll_probe_fn()", {}],
      ["a short reason", "public.awcms_probe_fn()", { reason: "because" }],
      ["no review reference", "public.awcms_probe_fn()", { approvedIn: "me" }],
      ["a runtime owner", "public.awcms_probe_fn()", { owner: "awcms_app" }],
      ["a worker owner", "public.awcms_probe_fn()", { owner: "awcms_worker" }],
      ["a bad digest", "public.awcms_probe_fn()", { definitionSha256: "abc" }],
      ["no grantees", "public.awcms_probe_fn()", { executeGrantees: [] }]
    ] as const)("%s is refused", (_label, key, overrides) => {
      expect(
        validatePayrollSecurityDefinerAllowlist({
          [key]: { ...valid, ...overrides }
        }).length
      ).toBeGreaterThan(0);
    });
  });
});

describe("rule 2: a BEGIN ATOMIC body is analysed like any other body", () => {
  test("its deparsed text naming payroll is a read", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_probe_atomic", {
              atomicBody: true,
              source:
                "BEGIN ATOMIC SELECT count(*) FROM awcms_hr_payroll_runs; END"
            })
          ]
        })
      )
    ).toEqual(["function-reads-payroll"]);
  });

  test("a call recorded only in pg_depend reaches a payroll-family function", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_hr_payroll_probe_total", { source: "SELECT 1" }),
            fn("awcms_probe_atomic", {
              atomicBody: true,
              source: "BEGIN ATOMIC SELECT 1; END",
              dependsOnFunctions: ["public.awcms_hr_payroll_probe_total"]
            })
          ]
        })
      )
    ).toEqual(["function-calls-payroll-function"]);
  });

  test("a call recorded only in pg_depend follows the chain", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_probe_leaf", {
              source: "SELECT 1 FROM awcms_hr_payroll_runs"
            }),
            fn("awcms_probe_atomic", {
              atomicBody: true,
              source: "BEGIN ATOMIC SELECT 1; END",
              dependsOnFunctions: ["public.awcms_probe_leaf"]
            })
          ]
        })
      )
    ).toEqual(["function-reads-payroll", "function-chain"]);
  });

  test("an atomic body that came back empty fails closed", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_probe_atomic", { atomicBody: true, source: "" })
          ]
        })
      )
    ).toEqual(["function-body-unreadable"]);
    // An ordinary function with an empty prosrc is not that.
    expect(
      codes(snapshot({ functions: [fn("awcms_probe_plain", { source: "" })] }))
    ).toEqual([]);
  });

  test("an atomic body that touches nothing payroll passes", () => {
    expect(
      codes(
        snapshot({
          functions: [
            fn("awcms_probe_atomic", {
              atomicBody: true,
              source: "BEGIN ATOMIC SELECT count(*) FROM awcms_probe_ok; END",
              dependsOnFunctions: []
            })
          ]
        })
      )
    ).toEqual([]);
  });
});

describe("rule 3: required payroll tables are pinned by a fingerprint", () => {
  test("a healthy catalog matches every fingerprint", () => {
    expect(codes(snapshot())).toEqual([]);
  });

  const withLedgerColumns = (columns: string[]) =>
    snapshot({
      columns: [
        ...HEALTHY_PAYROLL_COLUMNS.filter(
          (entry) => entry.relation !== ACCRUALS
        ),
        { relation: ACCRUALS, columns }
      ]
    });

  test.each([
    ["a column added", [...LEDGER.columns, "probe_note:text"]],
    ["a column dropped", LEDGER.columns.slice(1)],
    [
      "a column retyped",
      LEDGER.columns.map((column) =>
        column === "amount:numeric" ? "amount:text" : column
      )
    ],
    [
      "a column renamed",
      LEDGER.columns.map((column) =>
        column === "amount:numeric" ? "amount_x:numeric" : column
      )
    ],
    ["no columns at all", []]
  ])("%s is drift", (_label, columns) => {
    expect(codes(withLedgerColumns([...columns]))).toEqual([
      "payroll-fingerprint-drift"
    ]);
  });

  test("column ORDER is not part of the fingerprint", () => {
    expect(codes(withLedgerColumns([...LEDGER.columns].reverse()))).toEqual([]);
  });

  test("a required trigger running another function, or with another tgtype, is drift", () => {
    const swap = (patch: Partial<CatalogSnapshot["triggers"][number]>) =>
      snapshot({
        triggers: HEALTHY_PAYROLL_TRIGGERS.map((trigger) =>
          trigger.name === "awcms_hr_commission_accruals_immutable"
            ? { ...trigger, ...patch }
            : trigger
        )
      });

    expect(
      codes(swap({ function: "public.awcms_hr_payroll_probe_noop" }))
    ).toEqual(["payroll-fingerprint-drift"]);
    // BEFORE UPDATE only (no DELETE): 19 instead of 27.
    expect(codes(swap({ type: 19 }))).toEqual(["payroll-fingerprint-drift"]);
    expect(codes(swap({ type: undefined }))).toEqual([
      "payroll-fingerprint-drift"
    ]);
  });

  describe("a required trigger silenced without changing its name, function or events (audit H1)", () => {
    const patchTrigger = (
      name: string,
      patch: Partial<CatalogSnapshot["triggers"][number]>
    ) =>
      snapshot({
        triggers: HEALTHY_PAYROLL_TRIGGERS.map((trigger) =>
          trigger.name === name ? { ...trigger, ...patch } : trigger
        )
      });

    test.each([
      [
        "WHEN (false) on the ledger guard",
        "awcms_hr_commission_accruals_immutable",
        { hasWhen: true }
      ],
      [
        "WHEN (false) on the log guard",
        "awcms_hr_commission_transitions_guard",
        { hasWhen: true }
      ],
      [
        "UPDATE OF one column on the change log",
        "awcms_hr_commission_accruals_log_change",
        { updateOf: ["payment_reference"] }
      ],
      [
        "arguments",
        "awcms_hr_commission_accruals_born_valid",
        { argumentCount: 1 }
      ],
      [
        "DEFERRABLE",
        "awcms_hr_commission_accruals_log_birth",
        { deferrable: true }
      ],
      [
        "a constraint trigger",
        "awcms_hr_commission_accruals_log_birth",
        { constraintTrigger: true }
      ],
      [
        "unknown shape",
        "awcms_hr_commission_accruals_immutable",
        { hasWhen: undefined }
      ]
    ] as const)("%s is drift", (_label, name, patch) => {
      expect(
        codes(
          patchTrigger(
            name,
            patch as unknown as Partial<CatalogSnapshot["triggers"][number]>
          )
        )
      ).toEqual(["payroll-fingerprint-drift"]);
    });

    test("a guard FUNCTION with a no-op body, or another SET clause, is drift", () => {
      const replace = (patch: Partial<CatalogSnapshot["functions"][number]>) =>
        snapshot({
          functions: healthyPayrollTriggerFunctions().map((fn) =>
            fn.name === "public.awcms_hr_commission_accruals_guard"
              ? { ...fn, ...patch }
              : fn
          )
        });

      expect(codes(replace({}))).toEqual([]);
      expect(
        codes(replace({ source: "BEGIN RETURN COALESCE(NEW, OLD); END" }))
      ).toEqual(["payroll-fingerprint-drift"]);
      expect(codes(replace({ config: [] }))).toEqual([
        "payroll-fingerprint-drift"
      ]);
      expect(codes(replace({ securityDefiner: true }))).toEqual([
        "payroll-fingerprint-drift"
      ]);
      // Gone from the catalog entirely (the real analyser: the fixture
      // wrapper would add the healthy function back).
      expect(
        analyseWithoutFixture(
          snapshot({
            functions: healthyPayrollTriggerFunctions().filter(
              (fn) => fn.name !== "public.awcms_hr_commission_accruals_guard"
            )
          }),
          { fingerprints: TEST_PAYROLL_FINGERPRINTS }
        ).map((finding) => finding.code)
      ).toEqual(["payroll-fingerprint-drift"]);
    });

    test("the registered digests are not the test ones (the real bodies are pinned)", () => {
      expect(
        LEDGER.triggers.every(
          (trigger) =>
            /^[0-9a-f]{64}$/.test(trigger.functionSha256) &&
            trigger.functionSha256 !==
              TEST_PAYROLL_FINGERPRINTS.awcms_hr_commission_accruals!.triggers.find(
                (entry) => entry.name === trigger.name
              )!.functionSha256
        )
      ).toBe(true);
    });
  });

  test.each([
    ["NOT ENFORCED", { enforced: false }],
    ["NOT VALID", { validated: false }],
    ["DEFERRABLE", { deferrable: true }],
    ["ON DELETE CASCADE", { onDelete: "c" }],
    ["ON UPDATE SET NULL", { onUpdate: "n" }],
    ["other referenced columns", { refColumns: ["id", "tenant_id"] }]
  ] as const)(
    "a required foreign key made %s is drift (audit M1)",
    (_label, patch) => {
      expect(
        codes(
          snapshot({
            foreignKeys: HEALTHY_PAYROLL_FOREIGN_KEYS.map((fk) =>
              fk.from === TRANSITIONS && fk.to === ACCRUALS
                ? {
                    ...fk,
                    ...(patch as unknown as Partial<
                      CatalogSnapshot["foreignKeys"][number]
                    >)
                  }
                : fk
            )
          })
        )
      ).toEqual(["payroll-fingerprint-drift"]);
    }
  );

  test("a foreign key gone, or on other columns, is drift", () => {
    const paidBy = (fk: CatalogSnapshot["foreignKeys"][number]) =>
      fk.from === ACCRUALS && fk.columns?.join(",") === "tenant_id,paid_by";

    expect(
      codes(
        snapshot({
          foreignKeys: HEALTHY_PAYROLL_FOREIGN_KEYS.filter((fk) => !paidBy(fk))
        })
      )
    ).toEqual(["payroll-fingerprint-drift"]);
    expect(
      codes(
        snapshot({
          foreignKeys: HEALTHY_PAYROLL_FOREIGN_KEYS.map((fk) =>
            paidBy(fk) ? { ...fk, columns: ["paid_by", "tenant_id"] } : fk
          )
        })
      )
    ).toEqual(["payroll-fingerprint-drift"]);
    expect(
      codes(
        snapshot({
          foreignKeys: HEALTHY_PAYROLL_FOREIGN_KEYS.map((fk) =>
            paidBy(fk) ? { from: fk.from, to: fk.to } : fk
          )
        })
      )
    ).toEqual(["payroll-fingerprint-drift"]);
  });

  describe("a non-family relation with the ledger's shape under other names", () => {
    const types = LEDGER.columns.map((column) =>
      column.slice(column.indexOf(":") + 1)
    );
    const shadow = (columns: string[], baseColumns?: string[]) =>
      codes(
        snapshot({
          columns: [
            ...HEALTHY_PAYROLL_COLUMNS,
            {
              relation: "public.awcms_probe_shadow",
              columns,
              ...(baseColumns ? { baseColumns } : {})
            }
          ]
        })
      );
    const renamed = (list: string[]) =>
      list.map((type, index) => `c${index}:${type}`);

    test("every column renamed is still the ledger (the 70% look-alike sees 0% and misses it)", () => {
      expect(shadow(renamed(types))).toEqual(["payroll-fingerprint-match"]);
    });

    test("up to the tolerance of missing types is still the ledger; one more is not", () => {
      const tolerance = LEDGER.nameFreeTolerance!;

      expect(tolerance).toBe(2);
      expect(shadow(renamed(types.slice(2)))).toEqual([
        "payroll-fingerprint-match"
      ]);
      expect(shadow(renamed(types.slice(3)))).toEqual([]);
    });

    test("padding a copy with extra columns does not hide it (one-sided, audit M2)", () => {
      expect(
        shadow(renamed([...types, "integer", "integer", "integer", "integer"]))
      ).toEqual(["payroll-fingerprint-match"]);
    });

    test("a DOMAIN over a pinned type counts as that type (audit M2)", () => {
      const wrapped = renamed(types).map((column, index) =>
        index < 5 ? column.replace(/:.*/, ":public.awcms_probe_dom") : column
      );

      // As loaded: `columns` shows the domain, `baseColumns` the base type.
      expect(shadow(wrapped, renamed(types))).toEqual([
        "payroll-fingerprint-match"
      ]);
    });

    test("the same shape INSIDE the family is not a finding", () => {
      expect(
        codes(
          snapshot({
            columns: [
              ...HEALTHY_PAYROLL_COLUMNS,
              {
                relation: "public.awcms_hr_payroll_probe_copy",
                columns: renamed(types)
              }
            ]
          })
        )
      ).toEqual([]);
    });

    test("the transition log has no name-free tolerance (its shape is not distinctive): a renamed copy is not matched", () => {
      expect(LOG.nameFreeTolerance).toBeNull();
      expect(
        shadow(
          renamed(
            LOG.columns.map((column) => column.slice(column.indexOf(":") + 1))
          )
        )
      ).toEqual([]);
    });
  });

  test("multisetMissing counts only what the candidate lacks", () => {
    expect(multisetMissing(["a", "a", "b"], ["a", "b", "b", "c"])).toBe(1);
    expect(multisetMissing(["a"], [])).toBe(1);
    expect(multisetMissing(["a", "b"], ["b", "a", "z", "z"])).toBe(0);
  });

  test("multisetDistance counts the symmetric difference", () => {
    expect(multisetDistance(["a", "a", "b"], ["a", "b", "b"])).toBe(2);
    expect(multisetDistance(["a"], [])).toBe(1);
    expect(multisetDistance(["a", "b"], ["b", "a"])).toBe(0);
  });

  test("evaluatePayrollCatalog fails on a stale allow-list entry and passes without it (audit L2)", () => {
    const base = snapshot({
      functions: healthyPayrollTriggerFunctions("owner")
    });
    const allowlist = {
      "public.awcms_probe_gone()": {
        reason: "probe: an entry whose function no longer exists anywhere",
        approvedIn: "#1436",
        owner: "awcms_probe_definer_owner",
        definitionSha256: "a".repeat(64),
        executeGrantees: ["awcms_probe_definer_owner"]
      }
    };
    const clean = evaluatePayrollCatalog(
      base,
      {},
      {
        fingerprints: TEST_PAYROLL_FINGERPRINTS
      }
    );
    const stale = evaluatePayrollCatalog(
      base,
      {},
      {
        fingerprints: TEST_PAYROLL_FINGERPRINTS,
        securityDefinerAllowlist: allowlist
      }
    );

    expect(clean.ok).toBe(true);
    expect(stale.ok).toBe(false);
    expect(stale.staleExemptions).toEqual(["public.awcms_probe_gone()"]);
    expect(stale.lines.join("\n")).toContain(
      "stale PAYROLL_SECURITY_DEFINER_ALLOWLIST entry: public.awcms_probe_gone()"
    );
  });

  test("fingerprints cover exactly the required tables", () => {
    expect(Object.keys(PAYROLL_REQUIRED_TABLE_FINGERPRINTS).sort()).toEqual(
      ["awcms_hr_commission_accruals", "awcms_hr_commission_transitions"].sort()
    );
  });
});

describe("static layer: CREATE OR REPLACE TRIGGER (audit H1)", () => {
  const leaks = (sql: string) =>
    findPayrollSqlLeaks([{ name: "999_probe.sql", sql }]);

  test("on a payroll table, or reusing a required trigger's name, it is refused", () => {
    expect(
      leaks(
        `CREATE OR REPLACE TRIGGER awcms_hr_commission_accruals_immutable BEFORE UPDATE ON awcms_hr_commission_accruals FOR EACH ROW WHEN (false) EXECUTE FUNCTION awcms_hr_commission_accruals_guard();`
      ).join("\n")
    ).toContain("CREATE OR REPLACE TRIGGER");
    expect(
      leaks(
        `CREATE OR REPLACE CONSTRAINT TRIGGER awcms_probe_t AFTER INSERT ON public."awcms_hr_payroll_runs" FOR EACH ROW EXECUTE FUNCTION awcms_probe_fn();`
      ).length
    ).toBeGreaterThan(0);
  });

  test("on an ordinary table it is not this rule's business", () => {
    expect(
      leaks(
        `CREATE OR REPLACE TRIGGER awcms_probe_t BEFORE UPDATE ON awcms_probe_ok FOR EACH ROW EXECUTE FUNCTION awcms_probe_fn();`
      )
    ).toEqual([]);
  });
});
