/**
 * `fetchGrantedPermissionKeys` reads BOTH grant shapes (ADR-0078, Gelombang 3
 * PR 3.1 of #423).
 *
 * The behavioural proof lives in
 * `tests/integration/access-policy-equivalence.integration.test.ts`, against a
 * real database. What is asserted HERE is the handful of properties a database
 * cannot demonstrate by passing: that the name did not change, that the policy
 * branch filters its lifecycle at all, and that the expiry comparison is made by
 * Postgres rather than against a clock the caller supplies.
 *
 * Pure: source text only, no database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const SOURCE_PATH = "src/modules/identity-access/application/auth-context.ts";

/** Comments out — a docblock explaining a predicate must not satisfy a test about it. */
const code = readFileSync(SOURCE_PATH, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

/** The one query, sliced out so assertions cannot match the rest of the file. */
const query = code.slice(
  code.indexOf("export async function fetchGrantedPermissionKeys")
);

describe("both grant shapes reach the same answer", () => {
  test("the query reads the classic assignment AND the scoped policy", () => {
    expect(query).toContain("awcms_access_assignments");
    expect(query).toContain("awcms_access_policies");
    expect(query).toContain("UNION ALL");
    // `DISTINCT` over the union is what makes holding one role through both
    // shapes indistinguishable from holding it through either — the property
    // PR 3.3's row-by-row migration depends on.
    expect(query).toContain("SELECT DISTINCT");
  });

  test("the soft-deleted role filter applies to the union, not to one branch", () => {
    // A `deleted_at` check left inside the assignment branch would let a stale
    // policy outlive the role it names — and deleting a role is exactly how an
    // admin takes that access away.
    const deletedAt = query.indexOf("r.deleted_at IS NULL");
    const unionAt = query.indexOf("UNION ALL");

    expect(deletedAt).toBeGreaterThan(unionAt);
  });

  test("the policy branch filters status and effective dating; the assignment branch has neither to filter", () => {
    const policyBranch = query.slice(
      query.indexOf("awcms_access_policies"),
      query.indexOf(") grants")
    );

    expect(policyBranch).toContain("status = 'active'");
    expect(policyBranch).toContain("effective_from");
    expect(policyBranch).toContain("effective_to");
  });

  test("expiry is compared against the DATABASE clock, never a caller-supplied one", () => {
    // A grant that expires according to the application's idea of the time is a
    // grant an application bug can extend. `now()` in Postgres is the
    // transaction-start instant, so one authorization decision cannot see two
    // different times.
    expect(query).toContain("effective_to > now()");
    expect(query).not.toMatch(/effective_to\s*>\s*\$\{/);
  });

  test("the function name is unchanged, because a gate is keyed on the literal", () => {
    // `scripts/access-chokepoint-check.ts` keys its "this handler decides
    // permissions" signal on `fetchGrantedPermissionKeys(`. A rename leaves
    // that gate GREEN while it reports zero deciding handlers.
    expect(code).toContain("export async function fetchGrantedPermissionKeys");

    const gate = readFileSync("scripts/access-chokepoint-check.ts", "utf8");

    expect(gate).toContain("fetchGrantedPermissionKeys\\(");
  });

  test("the return type has NOT grown a scopes map yet", () => {
    // The program plan has this returning `{ keys, scopes }` for PR 3.4.
    // Shipping a field nothing reads is the unused-capability smell ADR-0077
    // removed, and it would churn eleven call sites in the PR least able to
    // afford unrelated diff. When 3.4 lands, this assertion is the one to
    // delete — deliberately, in the PR that consumes the map.
    expect(query).toContain("Promise<Set<string>>");
  });
});
