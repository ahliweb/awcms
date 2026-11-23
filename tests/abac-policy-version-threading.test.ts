/**
 * Issue #1482 (security review L1): every follow-up ABAC question asked in the
 * SAME transaction as an authorization hands the policy version that
 * authorization observed to the policy cache, so a cache hit costs no query.
 * The cost is pinned behaviourally in
 * `tests/integration/abac-policy-cache-cross-process.integration.test.ts`; this
 * pins that the call sites keep passing it.
 *
 * `src/pages/admin/analytics.astro` is deliberately absent: its subject comes
 * from the SSR session, resolved in a DIFFERENT transaction, and a version
 * from another transaction must never be handed on (it pays one primary-key
 * read instead). `src/pages/api/v1/access/evaluate.ts` resolves a bare context
 * with no version and likewise pays the read.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CALL_SITES: readonly { file: string; expected: string }[] = [
  {
    file: "src/pages/api/v1/analytics/events.ts",
    expected: "auth.abacPolicyVersion"
  },
  {
    file: "src/pages/api/v1/analytics/sessions.ts",
    expected: "auth.abacPolicyVersion"
  },
  {
    file: "src/modules/omnichannel-inbox/application/inbox-status-progress.ts",
    expected: "context.auth.abacPolicyVersion"
  },
  {
    file: "src/pages/api/v1/access/policies/simulate.ts",
    expected: "auth.abacPolicyVersion"
  }
];

describe("ABAC policy version is threaded to same-transaction follow-ups", () => {
  for (const site of CALL_SITES) {
    test(site.file, () => {
      const source = readFileSync(site.file, "utf8");
      const call = source.match(
        /(evaluateFieldAccessInTransaction|loadActivePolicies)\(([\s\S]*?)\);/
      );

      expect(call).not.toBeNull();
      expect(call![2]).toContain(site.expected);
    });
  }

  test("the chokepoint returns the version it read on an allow", () => {
    const source = readFileSync(
      "src/modules/identity-access/application/access-guard.ts",
      "utf8"
    );

    expect(source).toContain("abacPolicyVersion: principal?.abacPolicyVersion");
  });
});
