/**
 * The session-timeout rule of the dedicated-role jobs (the re-audit of #1483,
 * Low-2), pure half. The database half (a real LOGIN as the role carries the
 * values, and an idle transaction holding the definer lock is ended) is in
 * `tests/integration/social-publishing-credential-path-hardening.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  DEDICATED_ROLE_SESSION_TIMEOUTS,
  evaluateDedicatedRoleTimeouts
} from "../scripts/lib/dedicated-role-timeouts";

const ROLE = "awcms_social_dispatch";
const GOOD = [
  "idle_in_transaction_session_timeout=15s",
  "transaction_timeout=30s"
];

describe("dedicated role session timeouts (re-audit Low-2)", () => {
  test("the reviewed role-wide values pass", () => {
    expect(
      evaluateDedicatedRoleTimeouts(
        ROLE,
        [{ scope: "role", config: GOOD }],
        DEDICATED_ROLE_SESSION_TIMEOUTS
      )
    ).toEqual([]);
  });

  test("a missing, relaxed or zero value is a finding", () => {
    for (const config of [
      null,
      ["transaction_timeout=30s"],
      ["idle_in_transaction_session_timeout=0", "transaction_timeout=30s"],
      ["idle_in_transaction_session_timeout=15s", "transaction_timeout=1h"]
    ]) {
      expect(
        evaluateDedicatedRoleTimeouts(
          ROLE,
          config === null ? [] : [{ scope: "role", config }],
          DEDICATED_ROLE_SESSION_TIMEOUTS
        ).length
      ).toBeGreaterThan(0);
    }
  });

  test("a per-database override of either key is a finding, an unrelated one is not", () => {
    expect(
      evaluateDedicatedRoleTimeouts(
        ROLE,
        [
          { scope: "role", config: GOOD },
          { scope: "database", config: ["transaction_timeout=0"] }
        ],
        DEDICATED_ROLE_SESSION_TIMEOUTS
      )
    ).toHaveLength(1);
    expect(
      evaluateDedicatedRoleTimeouts(
        ROLE,
        [
          { scope: "role", config: GOOD },
          { scope: "database", config: ["work_mem=8MB"] }
        ],
        DEDICATED_ROLE_SESSION_TIMEOUTS
      )
    ).toEqual([]);
  });
});
