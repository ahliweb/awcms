/**
 * `data-lifecycle:table-coverage:check` — issue #437.
 *
 * The gate is only worth having if it FAILS, and it has five ways to fail. Four
 * of them are about the ledger rather than about tables, which is the point: a
 * one-way list that is allowed to rot is just a list.
 *
 * `findCoverageProblems` is exported pure so every direction can be planted
 * over synthetic inputs — no `sql/` tree, no module registry, no database.
 */
import { describe, expect, test } from "bun:test";

import {
  BOUNDED_BY_DESIGN,
  TABLES_PREDATING_THE_RULE,
  collectDescribedTables,
  collectTables,
  findCoverageProblems
} from "../scripts/data-lifecycle-table-coverage-check";

const BASE = {
  tables: ["awcms_a", "awcms_b"],
  described: ["awcms_a"],
  boundedByDesign: [] as { table: string; reason: string }[],
  ledger: ["awcms_b"]
};

describe("the failure the gate exists for", () => {
  test("a new table with no answer at all is a finding", () => {
    const problems = findCoverageProblems({
      ...BASE,
      tables: [...BASE.tables, "awcms_usage_records"]
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.table).toBe("awcms_usage_records");
    expect(problems[0]!.message).toContain("TERTUTUP untuk tabel baru");
  });

  test("a descriptor answers it", () => {
    expect(
      findCoverageProblems({
        ...BASE,
        tables: [...BASE.tables, "awcms_usage_records"],
        described: [...BASE.described, "awcms_usage_records"]
      })
    ).toEqual([]);
  });

  test("a reasoned exemption answers it too", () => {
    expect(
      findCoverageProblems({
        ...BASE,
        tables: [...BASE.tables, "awcms_usage_records"],
        boundedByDesign: [
          { table: "awcms_usage_records", reason: "satu baris per tenant" }
        ]
      })
    ).toEqual([]);
  });
});

describe("the ledger is not allowed to rot", () => {
  test("an entry that has since gained a descriptor must be removed", () => {
    // Debt that has been paid but is still recorded makes the count lie, and
    // the count is the only thing that says whether this is getting better.
    const problems = findCoverageProblems({
      ...BASE,
      described: ["awcms_a", "awcms_b"]
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("hanya boleh MENYUSUT");
  });

  test("an entry naming a table that no longer exists is a finding", () => {
    const problems = findCoverageProblems({
      ...BASE,
      ledger: ["awcms_b", "awcms_dropped"]
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.table).toBe("awcms_dropped");
    expect(problems[0]!.message).toContain("tidak ada lagi di");
  });
});

describe("an exemption must be an argument, not a parking space", () => {
  test("a blank reason is refused", () => {
    const problems = findCoverageProblems({
      ...BASE,
      tables: [...BASE.tables, "awcms_c"],
      boundedByDesign: [{ table: "awcms_c", reason: "   " }]
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("tanpa alasan");
  });

  test("a table cannot be both exempt and outstanding debt", () => {
    const problems = findCoverageProblems({
      ...BASE,
      boundedByDesign: [{ table: "awcms_b", reason: "bounded" }]
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("Dua jawaban untuk satu pertanyaan");
  });

  test("an exemption for a table that does not exist is a finding", () => {
    const problems = findCoverageProblems({
      ...BASE,
      boundedByDesign: [{ table: "awcms_ghost", reason: "bounded" }]
    });

    expect(problems.some((p) => p.table === "awcms_ghost")).toBe(true);
  });
});

describe("the real repository", () => {
  test("is clean today", () => {
    expect(
      findCoverageProblems({
        tables: collectTables(),
        described: collectDescribedTables(),
        boundedByDesign: BOUNDED_BY_DESIGN,
        ledger: TABLES_PREDATING_THE_RULE
      })
    ).toEqual([]);
  });

  test("the debt ledger may only shrink — 114 at the moment it landed", () => {
    // A ratchet, not trivia. Without a pinned ceiling, a 114-entry list is a
    // comfortable place to hide a 115th, and the stale-entry rule above cannot
    // see that: a NEW table added to the ledger is indistinguishable from an
    // old one. Lowering this number is the only edit this line should ever get.
    expect(TABLES_PREDATING_THE_RULE.length).toBeLessThanOrEqual(114);
  });

  test("the ledger has no duplicates", () => {
    expect(new Set(TABLES_PREDATING_THE_RULE).size).toBe(
      TABLES_PREDATING_THE_RULE.length
    );
  });

  describe("`BOUNDED_BY_DESIGN` — short, and every entry argued", () => {
    // This list started EMPTY, and that was the interesting part: the first
    // exemption could not arrive unnoticed, for the reason ADR-0058 drove
    // `access:permissions:enforcement:check` to 0 exceptions rather than a
    // short list. It did its job — `awcms_sync_outbox` (issue #477) is the
    // first entry and it arrived through a red test.
    //
    // What replaces the emptiness assertion is not a weaker version of it. An
    // exemption is cheap to add and expensive to notice later, so each of the
    // three below is a property an entry cannot satisfy by accident, and the
    // count is capped so the list cannot become a second ledger.

    test("it stays short — an exemption list that grows is the debt ledger wearing a costume", () => {
      // 5 since ADR-0081. **10 since ADR-0084**, and this is the second raise —
      // written out because the previous comment asked the next one to be harder
      // rather than easier, and a raise that does not answer that is the list
      // becoming a ledger.
      //
      // The five that forced it are the entitlement schema (`sql/109`), and they
      // are the SAME argument as the first five rather than a new one: rows that
      // are AUTHORED — by a migration or by an administrator — never accumulated
      // by traffic, where an age-based purge deletes LIVE state. `executionMode:
      // 'generic'` deletes purely by age with no status predicate, so a
      // descriptor on any of them is not retention but an outage: a deleted plan
      // row breaks the FK its subscriptions reference, and a deleted entitlement
      // silently stops serving a customer who is paying.
      //
      // ## The DERIVATION that would have avoided this raise, and why it is false
      //
      // Three of the five are GLOBAL catalogue tables on which
      // `GLOBAL_TABLE_FORBIDDEN_PRIVILEGES` denies `awcms_app` every write verb.
      // That suggests a derived exemption needing no hand-written entry at all:
      // "the request path cannot write it, therefore it cannot grow with
      // traffic" — exactly the shape #437 wanted and could not find.
      //
      // It is unsound, and this repo already contains the counter-example.
      // `awcms_idn_admin_regions` forbids `awcms_app` all three write verbs and
      // holds ~91,000 rows, because the forbidden list constrains `awcms_app`
      // and the import job runs as `awcms_worker`. Deriving from it would have
      // exempted the largest table in the schema on the grounds that requests
      // cannot write it. Tightening the rule to "no worker grant either" means
      // parsing GRANT statements across 109 cumulative migrations to answer a
      // question five sentences answer better.
      //
      // Recorded rather than dropped: the idea is attractive enough that
      // somebody will propose it again.
      //
      // The bar for the NEXT raise is unchanged and now overdue: a genuinely
      // different argument, not a sixth table repeating this one.
      expect(BOUNDED_BY_DESIGN.length).toBeLessThanOrEqual(10);
    });

    test("every entry names a table that really exists in sql/", () => {
      // A dead entry is a claim about nothing, and it reads as coverage.
      const tables = new Set(collectTables());

      for (const entry of BOUNDED_BY_DESIGN) {
        expect(tables.has(entry.table)).toBe(true);
      }
    });

    test("every entry carries a reason a reviewer could dispute", () => {
      // The gate itself rejects an EMPTY reason. This asks for more than
      // non-empty: a sentence short enough to be a label is not an argument,
      // and "bounded" without a mechanism is the exact shape of the lie this
      // list is most likely to attract.
      for (const entry of BOUNDED_BY_DESIGN) {
        expect(entry.reason.trim().length).toBeGreaterThan(120);
      }
    });
  });

  test("it counts tables the same way `repo:inventory` does", () => {
    // One answer to "what tables exist", not two that can drift. If this ever
    // needs its own scanner, that is the moment the two numbers start
    // disagreeing in a document nobody re-derives.
    expect(collectTables().length).toBeGreaterThan(100);
    expect(collectTables()).toContain("awcms_abac_decision_logs");
  });
});
