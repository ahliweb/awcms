import { describe, expect, test } from "bun:test";
import { updatePolicy } from "../src/modules/identity-access/application/abac-admin";

// A fake tx that emulates a single DSL-managed row: any query that does not
// filter `is_dsl_managed = false` "sees" (and mutates) it.
function dslRowTx() {
  const row = {
    id: "p1",
    policy_code: "dsl",
    effect: "allow",
    description: null,
    is_active: true
  };
  const sql: string[] = [];
  const tx = (async (strs: TemplateStringsArray, ...v: unknown[]) => {
    const q = strs.join("?");
    sql.push(q);
    const excludesDsl = /is_dsl_managed\s*=\s*false/.test(q);
    if (q.includes("UPDATE awcms_abac_policies")) {
      if (excludesDsl) return [];
      row.effect = v[0] as string;
      row.is_active = v[2] as boolean;
      return [row];
    }
    if (q.includes("FROM awcms_abac_policies")) return excludesDsl ? [] : [row];
    return [];
  }) as unknown as Bun.SQL;
  return { tx, row, sql };
}

describe("flat ABAC updatePolicy never touches DSL-managed policies", () => {
  test("returns null and leaves effect unchanged", async () => {
    const { tx, row, sql } = dslRowTx();
    expect(
      await updatePolicy(tx, "t1", "u1", "p1", { effect: "deny" })
    ).toBeNull();
    expect(row.effect).toBe("allow");
    expect(sql.some((q) => q.includes("UPDATE"))).toBe(false);
  });

  test("cannot deactivate a DSL policy", async () => {
    const { tx, row } = dslRowTx();
    expect(
      await updatePolicy(tx, "t1", "u1", "p1", { isActive: false })
    ).toBeNull();
    expect(row.is_active).toBe(true);
  });
});
