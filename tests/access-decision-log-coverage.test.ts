/**
 * Issue #426 — the decision-log coverage gate, proven in both directions.
 *
 * A gate that has only ever been observed passing has not been observed at all,
 * and this one is green on the day it lands: its whole value is locking a
 * property before three new deny branches (#429 and the entitlement/principal
 * work) land on top of it. So the assertions here are about the DETECTOR, not
 * about today's tree.
 *
 * The load-bearing case is `dominance`. A `recordDecisionLog` that sits in a
 * sibling branch is textually earlier than the return and still covers nothing;
 * a regex over "is there a log before this return" passes it. That distinction
 * is the entire reason this gate is not three lines.
 */
import { describe, expect, test } from "bun:test";

import {
  DECISION_LOG_EXEMPTIONS,
  collectDecisionReturns,
  findStaleExemptions,
  findUnloggedDecisions,
  sliceFunctionBody
} from "../scripts/access-decision-log-coverage-check";

const LOGGED_BRANCH = `
  if (machine && !allowedAction(guard.action)) {
    await recordDecisionLog(tx, tenantId, userId, guard, decision, machine.id);

    return {
      allowed: false,
      denied: fail(403, "ACCESS_DENIED", decision.reason)
    };
  }
`;

const UNLOGGED_BRANCH = `
  if (!context) {
    return {
      allowed: false,
      denied: fail(401, "AUTH_REQUIRED", "Session is invalid or expired.")
    };
  }
`;

function body(...parts: string[]): string {
  return `authorizeInTransaction(): Promise<AuthorizeResult> {\n${parts.join("\n")}\n}\n`;
}

describe("coverage is decided by dominance, not by text order", () => {
  test("a log in the SAME branch covers that branch's return", () => {
    const returns = collectDecisionReturns(body(LOGGED_BRANCH));

    expect(returns).toHaveLength(1);
    expect(returns[0]!.code).toBe("ACCESS_DENIED");
    expect(returns[0]!.logged).toBe(true);
  });

  test("a log in a SIBLING branch covers nothing — the case a regex gets wrong", () => {
    // The log is textually EARLIER than the return and syntactically valid. A
    // "is there a recordDecisionLog before this return" rule passes this; the
    // branch it lives in may simply not be taken.
    const source = body(`
  if (somethingElse) {
    await recordDecisionLog(tx, tenantId, userId, guard, decision, machine?.id);
  }

  if (!decision.allowed) {
    return {
      allowed: false,
      denied: fail(403, "ACCESS_DENIED", decision.reason)
    };
  }
`);

    expect(source.indexOf("recordDecisionLog(")).toBeLessThan(
      source.indexOf("return {")
    );
    expect(collectDecisionReturns(source)[0]!.logged).toBe(false);
  });

  test("a log at function-body depth covers returns nested below it", () => {
    // This is the real SOD_CONFLICT shape: the ABAC decision is logged at the
    // top level, then a nested `if` returns a deny that the log still dominates.
    const returns = collectDecisionReturns(
      body(`
  await recordDecisionLog(tx, tenantId, userId, guard, decision, machine?.id);

  if (isHighRiskAction(guard.action)) {
    if (sodCheck.blocked) {
      return {
        allowed: false,
        denied: fail(403, "SOD_CONFLICT", sodCheck.reason)
      };
    }
  }

  return { allowed: true, context, grantedPermissionKeys };
`)
    );

    expect(returns.map((entry) => entry.code)).toEqual([
      "SOD_CONFLICT",
      "ALLOW"
    ]);
    expect(returns.every((entry) => entry.logged)).toBe(true);
  });
});

describe("the rule fails in both directions", () => {
  test("an unlogged, unexempt return is reported", () => {
    const problems = findUnloggedDecisions(
      collectDecisionReturns(body(UNLOGGED_BRANCH)),
      {}
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.code).toBe("AUTH_REQUIRED");
  });

  test("an unlogged return with a reasoned exemption passes", () => {
    expect(
      findUnloggedDecisions(collectDecisionReturns(body(UNLOGGED_BRANCH)), {
        AUTH_REQUIRED: "no tenantUserId exists to attribute the row to"
      })
    ).toEqual([]);
  });

  test("an exemption whose branch now logs is stale and fails", () => {
    // The direction that stops the list rotting into an off switch.
    const problems = findStaleExemptions(
      collectDecisionReturns(body(LOGGED_BRANCH)),
      { ACCESS_DENIED: "claims this does not log — it does" }
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]!.code).toBe("ACCESS_DENIED");
  });

  test("an exemption whose branch vanished is stale the same way", () => {
    expect(findStaleExemptions([], { GONE: "removed branch" })).toHaveLength(1);
  });
});

describe("the extractor cannot pass vacuously", () => {
  test("a missing function yields null, never an empty body", () => {
    // An extractor returning "" would make every assertion above range over
    // nothing and report success — the defect this gate exists to prevent,
    // reproduced inside the gate itself.
    expect(
      sliceFunctionBody("export const x = 1;\n", "authorizeInTransaction")
    ).toBeNull();
  });

  test("the body stops at the next top-level export", () => {
    const source = `
export async function authorizeInTransaction(): Promise<AuthorizeResult> {
  return { allowed: true, context, grantedPermissionKeys };
}

export async function evaluateFieldAccessInTransaction(): Promise<boolean> {
  return { allowed: false, denied: fail(403, "LEAKED", "x") };
}
`;

    const extracted = sliceFunctionBody(source, "authorizeInTransaction");

    expect(extracted).not.toBeNull();
    expect(extracted).not.toContain("LEAKED");
    expect(collectDecisionReturns(extracted!)).toHaveLength(1);
  });
});

describe("the live guard", () => {
  test("every exemption names a real reason, not a TODO", () => {
    for (const [code, reason] of Object.entries(DECISION_LOG_EXEMPTIONS)) {
      expect(reason.length).toBeGreaterThan(60);
      expect(reason.toLowerCase()).not.toContain("todo");
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });

  test("access:decision-log:coverage:check passes as committed", () => {
    const result = Bun.spawnSync([
      "bun",
      "scripts/access-decision-log-coverage-check.ts"
    ]);

    expect(result.exitCode).toBe(0);
  });
});
