/**
 * Every table answers the subject question, and the plan binds the right id —
 * ADR-0094, Issue #542.
 *
 * `privacy-analysis.md` §4 puts per-subject export and per-subject erasure in
 * the **gap** column, not the reduced-scope one. The gap is not that nobody has
 * written an endpoint; it is that nothing knows WHICH TABLES an answer would
 * have to cover, and a hand-written list drifts silently on the next module to
 * land — the defect class that produced `data-lifecycle:table-coverage:check`.
 *
 * So the foundation is gated before anything is built on it. An export endpoint
 * that shipped first would cover the tables its author remembered and stay
 * silent about the rest, and a subject-access report that is incomplete is
 * worse than none because it is signed.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { describe, expect, test } from "bun:test";

import {
  collectSubjectDescribedTables,
  collectTables,
  findSubjectCoverageProblems,
  NO_SUBJECT_DATA,
  TABLES_PREDATING_THE_SUBJECT_RULE
} from "../scripts/subject-data-coverage-check";
import { listModules } from "../src/modules";
import { MODULE_CONTRACT_VERSION } from "../src/modules/_shared/module-contract";
import { buildSubjectPlan } from "../src/modules/data-lifecycle/domain/subject-data-plan";
import { collectSubjectDataDescriptors } from "../src/modules/data-lifecycle/domain/subject-data-registry";

const SUBJECT = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  tenantUserId: "22222222-2222-4222-8222-222222222222",
  identityId: "33333333-3333-4333-8333-333333333333",
  profileId: "44444444-4444-4444-8444-444444444444"
};

describe("the gate is satisfied, and not vacuously", () => {
  test("every table in sql/ has answered one of the three ways", () => {
    const tables = collectTables();

    // Paired with the problem check so an empty derivation cannot pass.
    expect(tables.length).toBeGreaterThan(100);
    expect(
      findSubjectCoverageProblems({
        tables,
        described: collectSubjectDescribedTables(),
        noSubjectData: NO_SUBJECT_DATA,
        ledger: TABLES_PREDATING_THE_SUBJECT_RULE
      })
    ).toEqual([]);
  });

  test("a new table that answers nothing FAILS", () => {
    const problems = findSubjectCoverageProblems({
      tables: ["awcms_a_brand_new_table"],
      described: [],
      noSubjectData: [],
      ledger: []
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.table).toBe("awcms_a_brand_new_table");
  });

  test("a described table left on the ledger FAILS — the debt count must not lie", () => {
    const problems = findSubjectCoverageProblems({
      tables: ["awcms_x"],
      described: ["awcms_x"],
      noSubjectData: [],
      ledger: ["awcms_x"]
    });

    expect(problems).toHaveLength(1);
  });

  test("a ghost on the ledger FAILS", () => {
    const problems = findSubjectCoverageProblems({
      tables: [],
      described: [],
      noSubjectData: [],
      ledger: ["awcms_gone"]
    });

    expect(problems).toHaveLength(1);
  });

  test("a refusal with no reason FAILS — an exception without one is worse than no gate", () => {
    const problems = findSubjectCoverageProblems({
      tables: ["awcms_x"],
      described: [],
      noSubjectData: [{ table: "awcms_x", reason: "   " }],
      ledger: []
    });

    expect(problems).toHaveLength(1);
  });

  test("two answers for one table FAILS", () => {
    const problems = findSubjectCoverageProblems({
      tables: ["awcms_x"],
      described: [],
      noSubjectData: [{ table: "awcms_x", reason: "no personal data" }],
      ledger: ["awcms_x"]
    });

    expect(problems).toHaveLength(1);
  });
});

describe("the registered descriptors say something real", () => {
  test("each names a subject column, or says outright that nothing can", () => {
    const descriptors = listModules().flatMap(
      (module) => module.subjectData ?? []
    );

    expect(descriptors.length).toBeGreaterThan(0);

    for (const descriptor of descriptors) {
      // Wave 2 allows a SECOND shape: no subject column, declared on purpose,
      // for a table whose personal data is pseudonymous by design. What stays
      // forbidden is an empty array with nothing saying why — the planner drops
      // it and the table goes quiet with no record that it was considered.
      if (descriptor.unreachableBySubject) {
        expect(descriptor.subjectColumns).toHaveLength(0);
        expect(descriptor.exportable).toBe(false);
        expect(descriptor.erasure).toBe("retain_under_obligation");
      } else {
        expect(descriptor.subjectColumns.length).toBeGreaterThan(0);
      }
      expect(descriptor.ownerModuleKey.length).toBeGreaterThan(0);
      expect(descriptor.tableName.startsWith("awcms_")).toBe(true);
      // Required in EVERY direction — a table that exports nothing needs as
      // much of a stated reason as one that exports everything.
      expect(descriptor.rationale.trim().length).toBeGreaterThan(20);
    }
  });

  test("the key names the owning module, so a stray descriptor is visible", () => {
    for (const module of listModules()) {
      for (const descriptor of module.subjectData ?? []) {
        expect(descriptor.ownerModuleKey).toBe(module.key);
        expect(descriptor.key.startsWith(`${module.key}.`)).toBe(true);
      }
    }
  });

  test("the credential columns are redacted, and the session token with them", () => {
    const descriptors = listModules().flatMap(
      (module) => module.subjectData ?? []
    );

    const identities = descriptors.find(
      (descriptor) => descriptor.tableName === "awcms_identities"
    );
    const sessions = descriptors.find(
      (descriptor) => descriptor.tableName === "awcms_sessions"
    );

    // A subject-access export that handed back a password hash would turn a
    // privacy right into a credential-disclosure channel.
    expect(identities?.redactedColumns).toContain("password_hash");
    expect(sessions?.redactedColumns).toContain("token_hash");
  });

  test("the membership row is never hard-deleted", () => {
    const tenantUsers = listModules()
      .flatMap((module) => module.subjectData ?? [])
      .find((descriptor) => descriptor.tableName === "awcms_tenant_users");

    // It is the FK target of audit events, decision logs, assignments and
    // workflow history. Deleting it would either cascade the evidence away or
    // abort on the first constraint — and the evidence includes the record
    // that the erasure itself happened.
    //
    // ADR-0108 moved it from `anonymize` to `severed_with_subject_row` (it
    // carried no personal detail beyond the link, so `anonymize` named no
    // column and wrote nothing). ADR-0109 gave it one — the public byline —
    // so it is `anonymize` again, and this time it names the column.
    // What the test actually protects is unchanged across all three: the row
    // is not deleted.
    expect(tenantUsers?.erasure).toBe("anonymize");
    expect(tenantUsers?.anonymizedColumns).toEqual(["public_byline_name"]);
    expect(tenantUsers?.erasure).not.toBe("hard_delete");
  });

  test("every `anonymize` descriptor names at least one column to overwrite", () => {
    // The property ADR-0108 exists for, asserted over the REAL registry rather
    // than only in the gate: three descriptors answered `anonymize` while
    // naming nothing, so an erasure reported success and left the person's
    // name, legal name and login address exactly where they were.
    const emptyAnonymize = listModules()
      .flatMap((module) => module.subjectData ?? [])
      .filter(
        (descriptor) =>
          descriptor.erasure === "anonymize" &&
          (descriptor.anonymizedColumns ?? []).length === 0 &&
          !descriptor.subjectColumns.some(
            (column) => column.match === "jsonb_array_contains"
          )
      )
      .map((descriptor) => descriptor.key);

    expect(emptyAnonymize).toEqual([]);
  });

  test("the severance anchor really anonymises something", () => {
    // ~90 descriptors answer `severed_with_subject_row` on the premise that
    // anonymising `awcms_identities` makes their stamps resolve to nobody. If
    // the anchor writes nothing, every one of those is a claim about a
    // severance that did not happen.
    const identities = listModules()
      .flatMap((module) => module.subjectData ?? [])
      .find((descriptor) => descriptor.tableName === "awcms_identities");

    expect(identities?.erasure).toBe("anonymize");
    expect(identities?.anonymizedColumns).toContain("login_identifier");
  });
});

describe("the plan binds the RIGHT id, which is the whole point of two kinds", () => {
  test("an identity-referenced column binds the identity, not the tenant user", () => {
    const plan = buildSubjectPlan(
      [
        {
          key: "m.sessions",
          tableName: "awcms_sessions",
          ownerModuleKey: "m",
          subjectColumns: [{ column: "identity_id", references: "identity" }],
          exportable: true,
          erasure: "hard_delete",
          rationale: "where and when the person signed in"
        }
      ],
      SUBJECT
    );

    expect(plan.entries[0]!.matches).toEqual([
      { column: "identity_id", value: SUBJECT.identityId, match: "equals" }
    ]);
  });

  test("and a tenant-user-referenced column binds the tenant user", () => {
    const plan = buildSubjectPlan(
      [
        {
          key: "m.audit",
          tableName: "awcms_audit_events",
          ownerModuleKey: "m",
          subjectColumns: [
            { column: "actor_tenant_user_id", references: "tenant_user" }
          ],
          exportable: false,
          erasure: "anonymize",
          rationale: "who did what, kept as evidence"
        }
      ],
      SUBJECT
    );

    expect(plan.entries[0]!.matches).toEqual([
      {
        column: "actor_tenant_user_id",
        value: SUBJECT.tenantUserId,
        match: "equals"
      }
    ]);
  });

  test("several subject columns ALL count — the second is not dropped", () => {
    const plan = buildSubjectPlan(
      [
        {
          key: "m.both",
          tableName: "awcms_x",
          ownerModuleKey: "m",
          subjectColumns: [
            { column: "actor_tenant_user_id", references: "tenant_user" },
            { column: "target_tenant_user_id", references: "tenant_user" }
          ],
          exportable: true,
          erasure: "anonymize",
          rationale: "a row can be about one person in two roles"
        }
      ],
      SUBJECT
    );

    // A descriptor naming only the first would silently omit every row where
    // the subject is the second.
    expect(plan.entries[0]!.matches).toHaveLength(2);
  });

  test("a descriptor with no subject column joins to nobody and is DROPPED", () => {
    // Otherwise it would put a table in the report with every row of the
    // tenant in it. The registry gate should catch it first; this is the
    // second line.
    const plan = buildSubjectPlan(
      [
        {
          key: "m.broken",
          tableName: "awcms_x",
          ownerModuleKey: "m",
          subjectColumns: [],
          exportable: true,
          erasure: "anonymize",
          rationale: "a mistake"
        }
      ],
      SUBJECT
    );

    expect(plan.entries).toEqual([]);
  });

  test("the plan separates what exports from what an erasure must LEAVE", () => {
    const plan = buildSubjectPlan(
      [
        {
          key: "m.a",
          tableName: "awcms_a",
          ownerModuleKey: "m",
          subjectColumns: [{ column: "tu", references: "tenant_user" }],
          exportable: true,
          erasure: "hard_delete",
          rationale: "theirs"
        },
        {
          key: "m.b",
          tableName: "awcms_b",
          ownerModuleKey: "m",
          subjectColumns: [{ column: "tu", references: "tenant_user" }],
          exportable: false,
          erasure: "retain_under_obligation",
          rationale: "a statutory retention period covers it"
        }
      ],
      SUBJECT
    );

    expect(plan.exportEntries.map((entry) => entry.key)).toEqual(["m.a"]);
    // "Erase everything" is not what the law says, and a plan that pretended
    // otherwise would mislead the operator who signs the response.
    expect(plan.retainedEntries.map((entry) => entry.key)).toEqual(["m.b"]);
  });

  test("the global principal appears in no plan, because RLS forbids the read", () => {
    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      SUBJECT
    );

    // ADR-0087 and ADR-0088 each planned a cross-tenant read once. A plan
    // naming `awcms_principals` among the tables it READS would be the third.
    expect(plan.entries.map((entry) => entry.tableName)).not.toContain(
      "awcms_principals"
    );
  });

  test("but it is NAMED as unanswered, rather than silently missing", () => {
    // Wave 2 changed this from absence to a stated exclusion, and the
    // difference is the whole point: a report that simply omits the table is
    // indistinguishable from one written before the table existed.
    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      SUBJECT
    );
    const principals = plan.unansweredEntries.find(
      (entry) => entry.tableName === "awcms_principals"
    );

    expect(principals?.reason).toBe("global");
    expect(principals?.rationale).toContain("ADR-0087");
  });

  test("a table nothing can match on is named too, for the same reason", () => {
    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      SUBJECT
    );
    const reports = plan.unansweredEntries.find(
      (entry) => entry.tableName === "awcms_comments_reports"
    );

    // Pseudonymous by design (hashed reporter address, no account link), so
    // `NO_SUBJECT_DATA` would be a lie and a subject column would be a fiction.
    expect(reports?.reason).toBe("no_subject_column");
  });

  test("every unanswered table is absent from the read plan — both reasons", () => {
    const plan = buildSubjectPlan(
      collectSubjectDataDescriptors(listModules()),
      SUBJECT
    );
    const read = new Set(plan.entries.map((entry) => entry.tableName));

    for (const entry of plan.unansweredEntries) {
      expect(read.has(entry.tableName)).toBe(false);
    }

    // Guards the assertion above against passing vacuously on an empty list.
    expect(plan.unansweredEntries.length).toBeGreaterThan(0);
  });
});

describe("the contract version records the addition", () => {
  test("MINOR bump: `anonymizedColumns` was added (ADR-0108)", () => {
    // 4.0.0 was wave 2 — a widened erasure union plus a retyped `tenantColumn`,
    // both MAJOR because the consumers that matter are exhaustive switches.
    // 4.1.0 adds an OPTIONAL field, so MINOR by this contract's own rule; the
    // behaviour change it carries is in the erasure executor, and every
    // `anonymize` descriptor was updated in the same change.
    expect(MODULE_CONTRACT_VERSION).toBe("4.1.0");
  });
});
