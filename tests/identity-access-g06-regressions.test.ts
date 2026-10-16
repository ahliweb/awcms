import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveSoDAssignmentFacts } from "../src/modules/identity-access/application/business-scope-facts";

const NOW = new Date("2025-01-01T00:00:00Z");
const TOMORROW = new Date("2025-01-02T00:00:00Z");

function fakeTx(assignmentRows: unknown[]): Bun.SQL {
  const tx = (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes("FROM awcms_business_scope_assignments bsa")) {
      return Promise.resolve(assignmentRows);
    }
    return Promise.resolve([]);
  };
  return tx as unknown as Bun.SQL;
}

const futureRow = {
  scope_type: "office",
  scope_id: "o1",
  effective_from: TOMORROW,
  effective_to: null,
  status: "active",
  module_key: "finance",
  activity_code: "payment",
  action: "approve"
};

describe("g06: SoD assignment-create sees future-dated assignments", () => {
  test("default (current-only) behaviour unchanged", async () => {
    const facts = await resolveSoDAssignmentFacts(
      fakeTx([futureRow]),
      "t",
      "u",
      NOW
    );
    expect(facts).toEqual([]);
  });

  test("overlapWindow includes an overlapping not-yet-effective assignment", async () => {
    const facts = await resolveSoDAssignmentFacts(
      fakeTx([futureRow]),
      "t",
      "u",
      NOW,
      null,
      {
        overlapWindow: { effectiveFrom: NOW, effectiveTo: null }
      }
    );
    expect(facts).toEqual([
      {
        permissionKey: "finance.payment.approve",
        scopeType: "office",
        scopeId: "o1"
      }
    ]);
  });

  test("overlapWindow excludes non-overlapping, expired and revoked rows", async () => {
    const rows = [
      { ...futureRow, effective_from: new Date("2025-02-01T00:00:00Z") },
      {
        ...futureRow,
        effective_from: new Date("2024-01-01T00:00:00Z"),
        effective_to: NOW
      },
      { ...futureRow, status: "revoked" }
    ];
    const facts = await resolveSoDAssignmentFacts(
      fakeTx(rows),
      "t",
      "u",
      NOW,
      null,
      {
        overlapWindow: {
          effectiveFrom: NOW,
          effectiveTo: new Date("2025-01-15T00:00:00Z")
        }
      }
    );
    expect(facts).toEqual([]);
  });

  test("createBusinessScopeAssignment passes the new assignment's period", () => {
    const src = readFileSync(
      "src/modules/identity-access/application/business-scope-assignment-service.ts",
      "utf8"
    );
    expect(src).toMatch(
      /overlapWindow:\s*\{\s*effectiveFrom: input\.effectiveFrom,\s*effectiveTo: input\.effectiveTo/
    );
  });
});
