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
      // **11 since ADR-0085**, and this raise answers the bar the previous one
      // set — "a genuinely different argument, not another table repeating the
      // last one" — rather than sliding past it.
      //
      // Every prior entry argues from AUTHORSHIP: rows put there by a human or a
      // migration, never accumulated by traffic. `awcms_principals` argues from
      // DERIVATION instead: its population is a projection of `awcms_identities`
      // (`SELECT DISTINCT lower(btrim(login_identifier))`, sql/112), so it cannot
      // grow faster than a table that is already on the predating ledger, and is
      // strictly smaller than it. That is a bound this list has not used before,
      // and it is checkable by reading one migration.
      //
      // It is also the entry with the least room for doubt about the
      // alternative: a descriptor here would delete the credential a person logs
      // in with across every tenant at once.
      //
      // **13 since ADR-0087**, and the bar again: is this a third argument, or
      // the first two with new table names?
      //
      // It is a third, and the difference is WHERE the bound is enforced.
      // Authorship (entries 1-10) and derivation (entry 11) are both arguments
      // about who writes the rows. `awcms_principal_mfa_factors` is bounded by
      // the SCHEMA: a partial unique index on `(principal_id, factor_type) WHERE
      // status <> 'disabled'` means the database REFUSES a second live row for a
      // human, whoever writes it and however often. `awcms_user_group_members`
      // cites a unique index too, but as a product of two human-authored sets —
      // here the index alone caps the live population at one per person.
      //
      // The honest half: DISABLED rows are not capped by that index, and they
      // accumulate on re-enrolment and administrative reset. That part is the
      // authorship argument, and it is why this is a hybrid rather than a clean
      // third class — support events, not traffic.
      //
      // `awcms_principal_mfa_recovery_codes` is bounded by an application
      // CONSTANT (`RECOVERY_CODE_COUNT = 10`) with delete-then-insert on every
      // path that issues a set, so its ceiling is ten times a table that is
      // itself capped one line up. Spending a code UPDATEs it; nothing appends.
      //
      // And the alternative is the same shape as ADR-0085's: `executionMode:
      // 'generic'` is age-only with no status predicate — the only two modes are
      // `generic` and `delegated`, and there is no owner mechanism to delegate to
      // — so a descriptor here would delete LIVE factors, switching off a
      // person's second factor in every tenant at once, and delete precisely the
      // disabled rows whose `disabled_by_tenant_id` is the only answer ADR-0087
      // leaves to "why did my MFA disappear".
      //
      // The bar for the next raise is unchanged: a fourth argument, not a
      // fourteenth table repeating one of these three.
      //
      // **15 since ADR-0089, and this raise does NOT clear that bar.** Said
      // plainly, because the alternative is worse than the raise: both partner
      // tables argue from AUTHORSHIP (entries 1-10) and from a unique index over
      // human-authored sets (`awcms_user_group_members`), and dressing that up
      // as a fourth class would put a lie in a list whose entire purpose is that
      // its entries are disputable.
      //
      // The raise is taken anyway because the bar was written to keep a
      // TRAFFIC-GROWN table from being parked here, and neither of these is one:
      // `awcms_partners` is written by the platform operator, and
      // `awcms_partner_managed_tenants` by a customer's administrator engaging
      // one. Read literally, "a fourth argument or nothing" would force one of
      // two worse outcomes — a manufactured novelty, or a `dataLifecycle`
      // descriptor whose only mode (`generic`, age-only, no status predicate)
      // would deregister live partners and sever live engagements.
      //
      // What replaces the phrasing of the bar is a sharper one, because two
      // raises in three PRs is itself the signal this list was meant to make
      // visible: **the next raise must either bring a fourth argument or shrink
      // the list somewhere else.** An honest repeat is admissible once; a list
      // that only ever grows by honest repeats is the parking lot by another
      // route.
      expect(BOUNDED_BY_DESIGN.length).toBeLessThanOrEqual(15);
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
