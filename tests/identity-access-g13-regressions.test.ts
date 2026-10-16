/**
 * G13 regression: a high-risk SoD block must be folded into the logged access
 * decision. Previously `recordDecisionLog` wrote `allowed=true` before
 * `checkHighRiskSoDConflicts` ran, so a 403 SOD_CONFLICT left an "allowed" audit
 * row. Source-order test (ADR-0063 rule: "X before Y" is not behaviourally
 * observable here), each index paired with an existence assertion.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL(
    "../src/modules/identity-access/application/access-guard.ts",
    import.meta.url
  ),
  "utf8"
);
const start = source.indexOf("export async function authorizeInTransaction");
const end = source.indexOf("\nexport ", start + 10);
const body = source.slice(start, end === -1 ? undefined : end);

describe("authorizeInTransaction SoD decision logging (g13)", () => {
  test("SoD check runs before the final decision-log write", () => {
    expect(start).toBeGreaterThan(-1);
    const sod = body.indexOf("await checkHighRiskSoDConflicts(");
    const log = body.lastIndexOf("await recordDecisionLog(");
    expect(sod).toBeGreaterThan(-1);
    expect(log).toBeGreaterThan(-1);
    expect(sod).toBeLessThan(log);
  });

  test("a SoD block is folded into the logged decision as a deny", () => {
    const log = body.lastIndexOf("await recordDecisionLog(");
    const before = body.slice(0, log);
    expect(before).toMatch(
      /sodBlock\s*\?\s*\{\s*allowed:\s*false,\s*reason:\s*sodBlock\.reason/
    );
    expect(body).toContain('fail(403, "SOD_CONFLICT", sodBlock.reason)');
  });
});
