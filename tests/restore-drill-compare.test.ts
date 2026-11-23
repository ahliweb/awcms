/**
 * The restore drill's comparators, attacked with deliberately broken inputs
 * (Issue #968). A verification that cannot go red is not a verification: every
 * check below is shown to FAIL when the property it claims is violated, and a
 * drill that never ran a required check is shown to fail as a whole.
 */
import { describe, expect, test } from "bun:test";

import {
  assertDrillDatabaseName,
  assertLocalHost,
  compareCatalogFacts,
  compareForceOffenders,
  compareLineSets,
  compareRowChecksums,
  compareRowCounts,
  compareSequences,
  compareTableSets,
  normalizeConstraintLine,
  PAYROLL_DEFERRED_CHECKS,
  REQUIRED_CHECK_IDS,
  summarize,
  type CatalogFacts,
  type DrillCheck,
  type TableDigests
} from "./../scripts/lib/restore-drill";

const digests: TableDigests = {
  awcms_a: { count: "3", md5: "aaa" },
  awcms_b: { count: "0", md5: "bbb" }
};

const facts: CatalogFacts = {
  relations: [
    "awcms_a|owner=o|rls=true|force=true|acl=awcms_app=arwd/o",
    "awcms_b|owner=o|rls=true|force=true|acl="
  ],
  columnAcls: ["awcms_a.x|awcms_worker=w/o"],
  policies: ["awcms_a|p|cmd=*|permissive=true|roles=PUBLIC|using=t|check=t"],
  functions: ["f()|owner=o|secdef=true|config=search_path=pg_catalog|acl="],
  triggers: ["awcms_a|trg|enabled=O"],
  constraints: [
    "awcms_a|c1|CHECK (((a > 0) AND (b > 0)))",
    "awcms_a|u1|UNIQUE (id)"
  ],
  indexes: ["awcms_a|CREATE INDEX i ON public.awcms_a (id)"],
  extensions: ["btree_gist@1.8"],
  roles: ["awcms_app|login=true|super=false|bypassrls=false"],
  tenantTablesWithoutForce: []
};

function failing(checks: DrillCheck[]): string[] {
  return checks.filter((check) => !check.ok).map((check) => check.id);
}

describe("restore drill comparators go red when the restore is wrong", () => {
  test("identical inputs pass", () => {
    expect(compareTableSets(digests, digests).ok).toBe(true);
    expect(compareRowCounts(digests, digests).ok).toBe(true);
    expect(compareRowChecksums(digests, digests).ok).toBe(true);
    expect(failing(compareCatalogFacts(facts, structuredClone(facts)))).toEqual(
      []
    );
  });

  test("a missing table, a missing row, and a changed cell are three different failures", () => {
    const missingTable = { awcms_a: digests.awcms_a! };
    const missingRow = { ...digests, awcms_a: { count: "2", md5: "aaa" } };
    const changedCell = { ...digests, awcms_a: { count: "3", md5: "zzz" } };

    expect(compareTableSets(digests, missingTable).ok).toBe(false);
    expect(compareRowCounts(digests, missingTable).ok).toBe(false);
    expect(compareRowCounts(digests, missingRow).ok).toBe(false);
    // Same count, different content: only the checksum can see it.
    expect(compareRowCounts(digests, changedCell).ok).toBe(true);
    expect(compareRowChecksums(digests, changedCell).ok).toBe(false);
  });

  test("a sequence BEHIND the witness fails; one ahead passes (the dump may read a later value)", () => {
    expect(compareSequences({ s: "10" }, { s: "9" }).ok).toBe(false);
    expect(compareSequences({ s: "10" }, {}).ok).toBe(false);
    expect(compareSequences({ s: "10" }, { s: "12" }).ok).toBe(true);
    expect(compareSequences({ s: null }, { s: null }).ok).toBe(true);
  });

  test("losing FORCE ROW LEVEL SECURITY on a table fails rls_force_catalog", () => {
    const lost = structuredClone(facts);

    lost.relations[0] = lost.relations[0]!.replace("force=true", "force=false");

    expect(failing(compareCatalogFacts(facts, lost))).toEqual([
      "rls_force_catalog"
    ]);
  });

  test("a widened or revoked grant fails grants_relations, a column grant fails grants_columns", () => {
    const widened = structuredClone(facts);
    const revoked = structuredClone(facts);
    const column = structuredClone(facts);

    widened.relations[0] = widened.relations[0]!.replace("arwd", "arwdD");
    revoked.relations[0] = revoked.relations[0]!.replace(
      "awcms_app=arwd/o",
      ""
    );
    column.columnAcls = [];

    expect(failing(compareCatalogFacts(facts, widened))).toEqual([
      "grants_relations"
    ]);
    expect(failing(compareCatalogFacts(facts, revoked))).toEqual([
      "grants_relations"
    ]);
    expect(failing(compareCatalogFacts(facts, column))).toEqual([
      "grants_columns"
    ]);
  });

  test("a dropped policy, a function that lost SECURITY DEFINER, a disabled trigger, a lost role flag", () => {
    const policy = structuredClone(facts);
    const fn = structuredClone(facts);
    const trigger = structuredClone(facts);
    const role = structuredClone(facts);

    policy.policies = [];
    fn.functions = [fn.functions[0]!.replace("secdef=true", "secdef=false")];
    trigger.triggers = ["awcms_a|trg|enabled=D"];
    role.roles = ["awcms_app|login=true|super=false|bypassrls=true"];

    expect(failing(compareCatalogFacts(facts, policy))).toEqual(["policies"]);
    expect(failing(compareCatalogFacts(facts, fn))).toEqual([
      "functions_and_grants"
    ]);
    expect(failing(compareCatalogFacts(facts, trigger))).toEqual(["triggers"]);
    expect(failing(compareCatalogFacts(facts, role))).toEqual(["roles"]);
  });

  test("CHECK regrouping passes, a changed or dropped condition fails", () => {
    const regrouped = structuredClone(facts);
    const changed = structuredClone(facts);
    const dropped = structuredClone(facts);

    regrouped.constraints[0] = "awcms_a|c1|CHECK ((a > 0) AND (b > 0))";
    changed.constraints[0] = "awcms_a|c1|CHECK (((a > 0) AND (b > 1)))";
    dropped.constraints = [facts.constraints[1]!];

    expect(failing(compareCatalogFacts(facts, regrouped))).toEqual([]);
    expect(failing(compareCatalogFacts(facts, changed))).toEqual([
      "constraints"
    ]);
    expect(failing(compareCatalogFacts(facts, dropped))).toEqual([
      "constraints"
    ]);
    // Only CHECKs are loosened: a UNIQUE keeps its exact text.
    expect(normalizeConstraintLine("awcms_a|u1|UNIQUE (id)")).toBe(
      "awcms_a|u1|UNIQUE (id)"
    );
  });

  test("a tenant table that LOST force after the restore is a new offender; one that never had it is not", () => {
    expect(compareForceOffenders(["legacy"], ["legacy"]).ok).toBe(true);
    expect(compareForceOffenders(["legacy"], ["legacy", "awcms_a"]).ok).toBe(
      false
    );
    expect(compareForceOffenders([], ["awcms_a"]).ok).toBe(false);
  });

  test("compareLineSets names what is missing and what is extra", () => {
    const check = compareLineSets("x", "things", ["a", "b"], ["b", "c"]);

    expect(check.ok).toBe(false);
    expect(check.detail).toContain("1 missing");
    expect(check.detail).toContain("1 unexpected");
  });
});

describe("the verdict", () => {
  const allPass: DrillCheck[] = REQUIRED_CHECK_IDS.map((id) => ({
    id,
    ok: true,
    detail: "ok"
  }));

  test("every required check present and passing is the only way to pass", () => {
    expect(summarize(allPass).ok).toBe(true);
  });

  test.each(REQUIRED_CHECK_IDS)(
    "dropping %s from the pipeline fails the drill even though everything else passed",
    (id) => {
      const report = summarize(allPass.filter((check) => check.id !== id));

      expect(report.ok).toBe(false);
      expect(report.missingRequired).toEqual([id]);
    }
  );

  test("one failing check fails the drill", () => {
    const broken = allPass.map((check, index) =>
      index === 0 ? { ...check, ok: false } : check
    );

    expect(summarize(broken).ok).toBe(false);
  });

  test("the grant, RLS and reconciliation checks are REQUIRED (removing them cannot go unnoticed)", () => {
    for (const id of [
      "rls_force_catalog",
      "grants_relations",
      "grants_columns",
      "rls_isolation_as_app",
      "rls_cross_tenant_write_refused",
      "append_only_grant_as_app",
      "booking_reconciliation_clean",
      "booking_point_in_time",
      "row_checksums"
    ]) {
      expect(REQUIRED_CHECK_IDS as readonly string[]).toContain(id);
    }
  });

  test("the payroll half is listed as deferred in every report, never as passed", () => {
    const report = summarize(allPass);

    expect(report.deferred.map((entry) => entry.id)).toEqual(
      PAYROLL_DEFERRED_CHECKS.map((entry) => entry.id)
    );
    expect(report.deferred.every((entry) => entry.blockedBy === "#957")).toBe(
      true
    );
    expect(report.checks.some((check) => check.id.startsWith("payroll_"))).toBe(
      false
    );
  });
});

describe("safety interlocks", () => {
  test("only loopback hosts", () => {
    expect(() => assertLocalHost("127.0.0.1")).not.toThrow();
    expect(() => assertLocalHost("localhost")).not.toThrow();
    expect(() => assertLocalHost("db.internal.example")).toThrow();
    expect(() => assertLocalHost("10.0.0.5")).toThrow();
  });

  test("only awcms_drill_* databases are ever created or dropped", () => {
    expect(() => assertDrillDatabaseName("awcms_drill_src_1_x")).not.toThrow();
    expect(() => assertDrillDatabaseName("awcms")).toThrow();
    expect(() =>
      assertDrillDatabaseName("awcms_drill_x; DROP DATABASE awcms")
    ).toThrow();
    expect(() => assertDrillDatabaseName("postgres")).toThrow();
  });
});
