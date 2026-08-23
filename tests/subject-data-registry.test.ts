/**
 * `subject-data:registry:check` — ADR-0094 wave 2, Issue #557.
 *
 * The coverage gate asks whether every table ANSWERED. This one asks whether
 * the answers are TRUE, and every test below plants a defect that would have
 * been invisible in review and silent at runtime.
 *
 * That is the bar these assertions are written to. It is not enough that the
 * gate goes green on the real registry — a gate that only ever passes proves
 * nothing — so each rule is exercised by feeding it the exact mistake it
 * exists to catch and checking that it goes RED.
 */
import { describe, expect, test } from "bun:test";

import {
  findSubjectRegistryProblems,
  parseAppRolePrivileges,
  parseForeignKeyTargets,
  parseTableColumns,
  readMigrations
} from "../scripts/subject-data-registry-check";
import { listModules } from "../src/modules";
import type { SubjectDataDescriptor } from "../src/modules/_shared/module-contract";

const COLUMNS = new Map<string, Set<string>>([
  [
    "awcms_things",
    new Set(["id", "tenant_id", "tenant_user_id", "identity_id", "token_hash"])
  ],
  ["awcms_global_things", new Set(["id", "principal_id"])],
  ["awcms_identities", new Set(["id", "tenant_id", "password_hash"])]
]);

const ALL_PRIVILEGES = new Set(["SELECT", "INSERT", "UPDATE", "DELETE"]);

/** Every planted table fully writable, so the tests below isolate the rule they name. */
const PRIVILEGES = new Map<string, Set<string>>([
  ["awcms_things", ALL_PRIVILEGES],
  ["awcms_global_things", ALL_PRIVILEGES],
  ["awcms_identities", ALL_PRIVILEGES]
]);

const FOREIGN_KEYS = new Map<string, string>([
  ["awcms_things.tenant_user_id", "awcms_tenant_users"],
  ["awcms_things.identity_id", "awcms_identities"],
  ["awcms_global_things.principal_id", "awcms_principals"]
]);

/** The descriptor `severed_with_subject_row` depends on. Present unless a test removes it. */
const SEVERANCE_ANCHOR: SubjectDataDescriptor = {
  key: "m.identities",
  tableName: "awcms_identities",
  ownerModuleKey: "m",
  subjectColumns: [{ column: "id", references: "identity" }],
  exportable: true,
  erasure: "anonymize",
  rationale:
    "the login identity behind the membership, anonymised so every stamp elsewhere stops resolving",
  // ADR-0108: an anchor that names no column writes nothing, so the severance
  // every other descriptor leans on would not have happened. The gate refuses
  // that now, and so this fixture has to be a REAL anchor.
  anonymizedColumns: ["password_hash"]
};

function run(
  descriptors: readonly SubjectDataDescriptor[],
  moduleKey = "m"
): string[] {
  return findSubjectRegistryProblems({
    modules: [
      { key: moduleKey, subjectData: [SEVERANCE_ANCHOR, ...descriptors] }
    ],
    columns: COLUMNS,
    foreignKeys: FOREIGN_KEYS,
    appRolePrivileges: PRIVILEGES
  }).map((problem) => problem.message);
}

const VALID: SubjectDataDescriptor = {
  key: "m.things",
  tableName: "awcms_things",
  ownerModuleKey: "m",
  subjectColumns: [{ column: "tenant_user_id", references: "tenant_user" }],
  exportable: true,
  erasure: "severed_with_subject_row",
  rationale:
    "a long enough sentence to count as a real stated reason for this table"
};

describe("a correct descriptor passes, so the failures below mean something", () => {
  test("the baseline is clean", () => {
    expect(run([VALID])).toEqual([]);
  });
});

describe("the defects that fail SILENTLY at runtime", () => {
  test("a subject column the table does not have is refused", () => {
    // Would read zero rows forever and report success.
    const problems = run([
      {
        ...VALID,
        subjectColumns: [{ column: "nope", references: "tenant_user" }]
      }
    ]);

    expect(problems.join(" ")).toContain("`nope`");
  });

  test("a redaction naming a column that does not exist is refused", () => {
    // Redacting a misspelled column redacts NOTHING and looks exactly like
    // redaction that works — the token still leaves in the export.
    const problems = run([{ ...VALID, redactedColumns: ["toklen_hash"] }]);

    expect(problems.join(" ")).toContain("toklen_hash");
  });

  test("a `references` that disagrees with the real foreign key is refused", () => {
    // The trap ADR-0094 names: a valid uuid bound to the wrong column.
    const problems = run([
      {
        ...VALID,
        subjectColumns: [{ column: "identity_id", references: "tenant_user" }]
      }
    ]);

    expect(problems.join(" ")).toContain("awcms_identities");
  });

  test("but a column with NO foreign key is not second-guessed", () => {
    // Most stamp columns in this schema are bare uuids. Reporting them would
    // train reviewers to ignore this gate.
    const columns = new Map(COLUMNS);
    columns.set(
      "awcms_things",
      new Set([...COLUMNS.get("awcms_things")!, "created_by"])
    );

    const problems = findSubjectRegistryProblems({
      modules: [
        {
          key: "m",
          subjectData: [
            SEVERANCE_ANCHOR,
            {
              ...VALID,
              subjectColumns: [
                { column: "created_by", references: "tenant_user" }
              ]
            }
          ]
        }
      ],
      columns,
      foreignKeys: FOREIGN_KEYS,
      appRolePrivileges: PRIVILEGES
    });

    expect(problems).toEqual([]);
  });
});

describe("the three-way tenantColumn contract is proved against sql/", () => {
  test("claiming GLOBAL for a table that has tenant_id is refused", () => {
    // Reads to the operator as "out of scope" rather than "missing".
    const problems = run([
      {
        ...VALID,
        tenantColumn: null,
        exportable: false,
        erasure: "retain_under_obligation"
      }
    ]);

    expect(problems.join(" ")).toContain("GLOBAL");
  });

  test("defaulting to tenant_id on a table without it is refused", () => {
    const problems = run([
      {
        ...VALID,
        key: "m.global_things",
        tableName: "awcms_global_things",
        subjectColumns: [{ column: "principal_id", references: "principal" }]
      }
    ]);

    expect(problems.join(" ")).toContain("`tenant_id` bawaan");
  });

  test("a global table may not promise an export it cannot deliver", () => {
    const problems = run([
      {
        ...VALID,
        key: "m.global_things",
        tableName: "awcms_global_things",
        tenantColumn: null,
        subjectColumns: [{ column: "principal_id", references: "principal" }],
        exportable: true,
        erasure: "retain_under_obligation"
      }
    ]);

    expect(problems.join(" ")).toContain("exportable: true");
  });

  test("a global table may not promise an erasure either", () => {
    // One tenant destroying a row that spans the others.
    const problems = run([
      {
        ...VALID,
        key: "m.global_things",
        tableName: "awcms_global_things",
        tenantColumn: null,
        subjectColumns: [{ column: "principal_id", references: "principal" }],
        exportable: false,
        erasure: "hard_delete"
      }
    ]);

    expect(problems.join(" ")).toContain("hard_delete");
  });
});

describe("`principal` cannot become a back door to a cross-tenant read", () => {
  test("naming a principal column on a TENANT table is refused", () => {
    // ADR-0087 and ADR-0088 each planned this read once.
    const columns = new Map(COLUMNS);
    columns.set(
      "awcms_things",
      new Set([...COLUMNS.get("awcms_things")!, "principal_id"])
    );

    const problems = findSubjectRegistryProblems({
      modules: [
        {
          key: "m",
          subjectData: [
            SEVERANCE_ANCHOR,
            {
              ...VALID,
              subjectColumns: [
                { column: "principal_id", references: "principal" }
              ]
            }
          ]
        }
      ],
      columns,
      foreignKeys: FOREIGN_KEYS,
      appRolePrivileges: PRIVILEGES
    });

    expect(problems.map((problem) => problem.message).join(" ")).toContain(
      "hanya boleh pada deskriptor global"
    );
  });
});

describe("`unreachableBySubject` is enforced in BOTH directions", () => {
  test("an empty subjectColumns list without the flag is refused", () => {
    const problems = run([{ ...VALID, subjectColumns: [] }]);

    expect(problems.join(" ")).toContain("unreachableBySubject");
  });

  test("the flag together with named columns is refused", () => {
    // Both cannot be true; the named column proves reachability.
    const problems = run([
      {
        ...VALID,
        unreachableBySubject: true,
        exportable: false,
        erasure: "retain_under_obligation"
      }
    ]);

    expect(problems.join(" ")).toContain("kolom subjek");
  });

  test("the flag may not be used to opt a table out of exporting", () => {
    const problems = run([
      {
        ...VALID,
        subjectColumns: [],
        unreachableBySubject: true,
        exportable: true,
        erasure: "retain_under_obligation"
      }
    ]);

    expect(problems.join(" ")).toContain("tak terjangkau subjek");
  });
});

describe("`status_transition_then_purge` names a column the executor writes", () => {
  test("refused when the table has no `revoked_at`", () => {
    // The coupling is invisible from both sides: the descriptor says "flip a
    // status" without saying which, and the executor writes one hard-coded
    // column. Without this the mismatch surfaces mid-erasure, after the
    // request has already been claimed.
    const problems = run([
      { ...VALID, erasure: "status_transition_then_purge" }
    ]);

    expect(problems.join(" ")).toContain("revoked_at");
  });

  test("accepted when it does", () => {
    const columns = new Map(COLUMNS);
    columns.set(
      "awcms_things",
      new Set([...COLUMNS.get("awcms_things")!, "revoked_at"])
    );

    const problems = findSubjectRegistryProblems({
      modules: [
        {
          key: "m",
          subjectData: [
            SEVERANCE_ANCHOR,
            { ...VALID, erasure: "status_transition_then_purge" }
          ]
        }
      ],
      columns,
      foreignKeys: FOREIGN_KEYS,
      appRolePrivileges: PRIVILEGES
    });

    expect(problems).toEqual([]);
  });
});

describe("an erasure mode must be within what the RUNTIME ROLE may do", () => {
  // Found by RUNNING the erasure, not by reading it: two descriptors declared
  // `hard_delete` on tables ADR-0087 (`sql/114`) had deliberately retired to
  // read-only. Every pure gate was green; the failure would have been a 42501
  // in production, mid-erasure, after the request was claimed.
  const READ_ONLY = new Map<string, Set<string>>([
    ["awcms_things", new Set(["SELECT"])],
    ["awcms_identities", ALL_PRIVILEGES]
  ]);

  function runWith(
    descriptor: SubjectDataDescriptor,
    privileges: Map<string, Set<string>>
  ): string[] {
    return findSubjectRegistryProblems({
      modules: [{ key: "m", subjectData: [SEVERANCE_ANCHOR, descriptor] }],
      columns: COLUMNS,
      foreignKeys: FOREIGN_KEYS,
      appRolePrivileges: privileges
    }).map((problem) => problem.message);
  }

  test("`hard_delete` on a table with DELETE revoked is refused", () => {
    const problems = runWith({ ...VALID, erasure: "hard_delete" }, READ_ONLY);

    expect(problems.join(" ")).toContain("DELETE");
    // …and it warns against the tempting fix, which would undo an ADR's control.
    expect(problems.join(" ")).toContain("membatalkan");
  });

  test("`anonymize` on a read-only table is refused too", () => {
    const problems = runWith({ ...VALID, erasure: "anonymize" }, READ_ONLY);

    expect(problems.join(" ")).toContain("UPDATE");
  });

  test("the two answers that write NOTHING are allowed on a read-only table", () => {
    // This is the correction those two MFA descriptors took: severance is both
    // truthful and executable where a write is not.
    expect(
      runWith({ ...VALID, erasure: "severed_with_subject_row" }, READ_ONLY)
    ).toEqual([]);
    expect(
      runWith(
        {
          ...VALID,
          erasure: "retain_under_obligation",
          exportable: true
        },
        READ_ONLY
      )
    ).toEqual([]);
  });

  test("the GRANT/REVOKE replay reads the REAL migrations correctly", () => {
    // Order matters: `sql/114` grants on the principal tables and revokes on
    // the retired tenant-scoped ones. A parser that ignored order, or that
    // matched the wrong role, would answer the opposite.
    const privileges = parseAppRolePrivileges(readMigrations());

    expect(privileges.get("awcms_identity_mfa_factors")?.has("DELETE")).toBe(
      false
    );
    expect(privileges.get("awcms_identity_mfa_factors")?.has("SELECT")).toBe(
      true
    );
    expect(privileges.get("awcms_principal_mfa_factors")?.has("DELETE")).toBe(
      true
    );
    // A table no migration ever mentions is ABSENT from the map, and absent
    // means "holds the blanket grant" — which the caller resolves to all four.
    // Modelling absence as "no privileges" would make this gate refuse every
    // ordinary erasure in the schema.
    expect(privileges.has("awcms_sessions")).toBe(false);
  });
});

describe("the severance chain is checked, not assumed", () => {
  test("`severed_with_subject_row` is refused when nothing anonymises identities", () => {
    // The dependency runs the wrong way for review to catch: change
    // `identity_access.identities` and ~90 descriptors elsewhere quietly become
    // a no-op, with no edit anywhere near the tables they broke.
    const problems = findSubjectRegistryProblems({
      modules: [
        {
          key: "m",
          subjectData: [{ ...SEVERANCE_ANCHOR, erasure: "hard_delete" }, VALID]
        }
      ],
      columns: COLUMNS,
      foreignKeys: FOREIGN_KEYS,
      appRolePrivileges: PRIVILEGES
    });

    expect(problems.map((problem) => problem.message).join(" ")).toContain(
      "Rantai yang dirujuknya putus"
    );
  });
});

describe("ownership and uniqueness", () => {
  test("a descriptor declared by the wrong module is refused", () => {
    expect(run([VALID], "other").join(" ")).toContain(
      "dideklarasikan oleh modul"
    );
  });

  test("two descriptors for one table are refused (ADR-0013 §6)", () => {
    const problems = run([VALID, { ...VALID, key: "m.things_again" }]);

    expect(problems.join(" ")).toContain("menjawab sekali");
  });

  test("a rationale too short to be a reason is refused", () => {
    expect(run([{ ...VALID, rationale: "because" }]).join(" ")).toContain(
      "beralasan sungguhan"
    );
  });
});

describe("against the real schema and the real registry", () => {
  const migrations = readMigrations();
  const columns = parseTableColumns(migrations);
  const foreignKeys = parseForeignKeyTargets(migrations);

  test("every shipped descriptor resolves against sql/", () => {
    const problems = findSubjectRegistryProblems({
      modules: listModules().map((module) => ({
        key: module.key,
        subjectData: module.subjectData ?? []
      })),
      columns,
      foreignKeys,
      appRolePrivileges: parseAppRolePrivileges(migrations)
    });

    expect(problems).toEqual([]);
  });

  test("the parser found real tables, so the check above is not vacuous", () => {
    expect(columns.get("awcms_tenant_users")?.has("identity_id")).toBe(true);
    expect(foreignKeys.get("awcms_sessions.identity_id")).toBe(
      "awcms_identities"
    );
  });
});
