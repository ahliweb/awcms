/**
 * The grant scanner behind `data-lifecycle:worker-grants:check`.
 *
 * The gate itself is proven against the real thing: remove `sql/129` and it
 * names `awcms_delegated_access_grants` and `awcms_subject_requests` — the two
 * tables `data-lifecycle:archive-purge --dry-run` actually failed on in
 * production. What that does not cover is the scanner, and the scanner's first
 * version was wrong in a way that matters: it reported FOUR grants as missing
 * that were sitting in plain sight in `sql/060`, `sql/074` and `sql/091`.
 *
 * The cause was a `--` comment line containing the word GRANT. It has no
 * semicolon, so `GRANT[\s\S]*?;` began there and consumed the real statement
 * that followed. That is `js/bad-tag-filter` in a different costume: a pattern
 * lazy about where a construct ENDS eats the thing after it. The shape is
 * pinned here so the next edit cannot quietly reintroduce it.
 */
import { describe, expect, test } from "bun:test";
import {
  deriveRequiredGrants,
  grantsPrivilege
} from "../scripts/data-lifecycle-worker-grants-check";
// The scanner moved to `sql-grants.ts` when `data-lifecycle:table-coverage:check`
// began asking the same text a different question. The lesson pinned below moved
// with it — one parser, one place for this bug to be fixed.
import { stripSqlComments } from "../scripts/sql-grants";
import { listModules } from "../src/modules";

const GRANT =
  "GRANT SELECT, DELETE ON awcms_registration_requests TO awcms_worker;";

describe("grantsPrivilege", () => {
  test("finds a privilege in a plain statement", () => {
    expect(
      grantsPrivilege(GRANT, "awcms_registration_requests", "SELECT")
    ).toBe(true);
    expect(
      grantsPrivilege(GRANT, "awcms_registration_requests", "DELETE")
    ).toBe(true);
  });

  test("does not invent a privilege the statement omits", () => {
    expect(
      grantsPrivilege(GRANT, "awcms_registration_requests", "UPDATE")
    ).toBe(false);
  });

  test("does not match a different table", () => {
    expect(grantsPrivilege(GRANT, "awcms_other_table", "SELECT")).toBe(false);
  });

  test("does not match a different role", () => {
    expect(
      grantsPrivilege(
        "GRANT SELECT ON awcms_x TO awcms_app;",
        "awcms_x",
        "SELECT"
      )
    ).toBe(false);
  });

  describe("comment forms that used to swallow the next statement", () => {
    test.each([
      ["a line comment naming GRANT", `-- we GRANT nothing here yet\n${GRANT}`],
      [
        "a line comment quoting a whole statement without a semicolon",
        `-- GRANT SELECT ON awcms_other TO awcms_worker\n${GRANT}`
      ],
      [
        "a block comment naming GRANT",
        `/* GRANT is discussed here */\n${GRANT}`
      ],
      [
        "a multi-line header quoting statements",
        `-- ## Why\n-- GRANT SELECT ON a TO awcms_worker\n-- GRANT DELETE ON b TO awcms_worker\n--\n${GRANT}`
      ]
    ])("survives %s", (_name, sql) => {
      expect(
        grantsPrivilege(sql, "awcms_registration_requests", "SELECT")
      ).toBe(true);
    });

    test("a COMMENTED-OUT grant does not count as granted", () => {
      // The mirror of the bug: stripping comments must not make a commented
      // statement look live.
      expect(
        grantsPrivilege(
          "-- GRANT SELECT ON awcms_registration_requests TO awcms_worker;",
          "awcms_registration_requests",
          "SELECT"
        )
      ).toBe(false);
    });
  });

  test("multi-table and multi-role forms are honoured", () => {
    const sql = "GRANT SELECT ON awcms_a, awcms_b TO awcms_worker, awcms_app;";
    expect(grantsPrivilege(sql, "awcms_a", "SELECT")).toBe(true);
    expect(grantsPrivilege(sql, "awcms_b", "SELECT")).toBe(true);
  });

  test("the ON TABLE spelling is honoured", () => {
    expect(
      grantsPrivilege(
        "GRANT DELETE ON TABLE awcms_a TO awcms_worker;",
        "awcms_a",
        "DELETE"
      )
    ).toBe(true);
  });

  test("ALL PRIVILEGES covers everything", () => {
    expect(
      grantsPrivilege(
        "GRANT ALL PRIVILEGES ON awcms_a TO awcms_worker;",
        "awcms_a",
        "DELETE"
      )
    ).toBe(true);
  });
});

describe("stripSqlComments", () => {
  test("removes line and block comments", () => {
    expect(
      stripSqlComments("SELECT 1; -- trailing\n/* block */ SELECT 2;")
    ).not.toMatch(/trailing|block/);
  });
});

describe("deriveRequiredGrants", () => {
  const required = deriveRequiredGrants(listModules());

  test("covers only the generic executor's tables", () => {
    // The `delegated` descriptors are purged by their owning module's own job,
    // with its own statements and its own grants. Requiring generic-engine
    // privileges for them made the first draft report 14 findings of which 9
    // were noise — a gate nobody would keep believing.
    const tables = new Set(required.map((r) => r.tableName));
    expect(tables.has("awcms_delegated_access_grants")).toBe(true);
    expect(tables.has("awcms_visit_events")).toBe(false);
    expect(tables.has("awcms_email_messages")).toBe(false);
  });

  test("hard_delete asks for DELETE, never UPDATE", () => {
    const entry = required.find(
      (r) => r.tableName === "awcms_delegated_access_grants"
    );
    expect(entry?.privileges).toEqual(["SELECT", "DELETE"]);
  });

  test("every entry asks for SELECT", () => {
    expect(required.every((r) => r.privileges.includes("SELECT"))).toBe(true);
  });
});
