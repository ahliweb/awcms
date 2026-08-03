/**
 * ADR-0064 — the FK-index rule, driven with planted SQL.
 *
 * The live schema passing proves little: migration `sql/090` was written to make
 * it pass. What has to hold is that each rule fails on the shape it exists for,
 * and — more importantly — that the TENANT-AWARE relaxation accepts only what it
 * claims to accept. A relaxation that quietly accepted everything would turn a
 * 14-finding gate into a 0-finding one and read exactly the same in CI.
 */
import { describe, expect, test } from "bun:test";

import {
  findStaleExemptions,
  findUnindexedForeignKeys,
  parseConstraintIndexes,
  parseForeignKeys,
  parseIndexes,
  reachableColumns
} from "../scripts/db-fk-index-check";

describe("parsing foreign keys", () => {
  test("inline column references", () => {
    expect(
      parseForeignKeys(`
CREATE TABLE IF NOT EXISTS awcms_things (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  author_id uuid REFERENCES awcms_tenant_users (id)
);`)
    ).toEqual([
      { table: "awcms_things", column: "tenant_id" },
      { table: "awcms_things", column: "author_id" }
    ]);
  });

  test("explicit composite constraints use the FK's own first column", () => {
    expect(
      parseForeignKeys(`
ALTER TABLE awcms_offices
  ADD CONSTRAINT fk_parent
  FOREIGN KEY (tenant_id, parent_office_id)
  REFERENCES awcms_offices (tenant_id, id);`)
    ).toEqual([{ table: "awcms_offices", column: "tenant_id" }]);
  });

  test("a column named in a comment is not a declaration", () => {
    expect(
      parseForeignKeys(`
CREATE TABLE IF NOT EXISTS awcms_things (
  -- tenant_id uuid NOT NULL REFERENCES awcms_tenants (id),
  id uuid PRIMARY KEY
);`)
    ).toEqual([]);
  });
});

describe("parsing indexes", () => {
  test("multi-line index declarations are read whole", () => {
    // The repo writes these across two lines; a line-oriented parser would miss
    // the column list entirely and report every column of the table unindexed.
    expect(
      parseIndexes(`
CREATE UNIQUE INDEX IF NOT EXISTS awcms_access_assignments_key
  ON awcms_access_assignments (tenant_id, tenant_user_id, role_id);`)
    ).toEqual([
      {
        table: "awcms_access_assignments",
        columns: ["tenant_id", "tenant_user_id", "role_id"]
      }
    ]);
  });

  test("an expression index does not claim its inner column", () => {
    // `(lower(slug))` cannot serve an equality lookup on `slug`.
    expect(
      parseIndexes("CREATE INDEX i ON t (lower(slug));")[0]!.columns
    ).toEqual(["lower"]);
  });

  test("PRIMARY KEY and UNIQUE constraints count as indexes", () => {
    const indexes = parseConstraintIndexes(`
CREATE TABLE t (
  id uuid PRIMARY KEY,
  UNIQUE (tenant_id, code)
);`);

    expect(indexes).toContainEqual({ table: "t", columns: ["id"] });
    expect(indexes).toContainEqual({
      table: "t",
      columns: ["tenant_id", "code"]
    });
  });
});

describe("the tenant-aware reachability rule", () => {
  test("a leading column is reachable", () => {
    expect(reachableColumns([{ table: "t", columns: ["a", "b"] }])).toContain(
      "t.a"
    );
  });

  test("the second column after tenant_id IS reachable", () => {
    // The relaxation, stated as a test: every tenant-scoped query carries
    // `tenant_id`, so `(tenant_id, X)` is the index a lookup on X actually uses.
    expect(
      reachableColumns([{ table: "t", columns: ["tenant_id", "author_id"] }])
    ).toContain("t.author_id");
  });

  test("the second column after anything ELSE is NOT reachable", () => {
    // The bound on the relaxation. Without this the rule would accept any
    // composite and find nothing — the failure mode that makes a gate read as
    // coverage while providing none.
    expect(
      reachableColumns([{ table: "t", columns: ["created_at", "author_id"] }])
    ).not.toContain("t.author_id");
  });

  test("the THIRD column after tenant_id is NOT reachable", () => {
    // `(tenant_id, a, b)` serves lookups on `a` within a tenant, not on `b`.
    const reachable = reachableColumns([
      { table: "t", columns: ["tenant_id", "a", "b"] }
    ]);

    expect(reachable).toContain("t.a");
    expect(reachable).not.toContain("t.b");
  });
});

describe("the rule end to end", () => {
  const FKS = [
    { table: "t", column: "tenant_id" },
    { table: "t", column: "author_id" },
    { table: "t", column: "role_id" }
  ];

  test("reports only what no index reaches", () => {
    expect(
      findUnindexedForeignKeys(
        FKS,
        [{ table: "t", columns: ["tenant_id", "author_id"] }],
        {}
      )
    ).toEqual(["t.role_id"]);
  });

  test("an exemption silences exactly one column", () => {
    expect(
      findUnindexedForeignKeys(
        FKS,
        [{ table: "t", columns: ["tenant_id", "author_id"] }],
        { "t.role_id": "reason" }
      )
    ).toEqual([]);
  });

  test("an exemption that is now indexed is reported as stale", () => {
    expect(
      findStaleExemptions(FKS, [{ table: "t", columns: ["role_id"] }], {
        "t.role_id": "reason"
      })
    ).toEqual(["t.role_id"]);
  });

  test("an exemption for a column that is no longer an FK is reported", () => {
    expect(findStaleExemptions([], [], { "t.gone": "reason" })).toEqual([
      "t.gone"
    ]);
  });
});

describe("the live schema", () => {
  test("db:fk-index:check passes as committed", () => {
    const result = Bun.spawnSync(["bun", "scripts/db-fk-index-check.ts"]);

    expect(result.exitCode).toBe(0);
  });
});
