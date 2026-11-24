/**
 * The membership rule of the dedicated-role jobs (the #1145 credential-path
 * review, MEDIUM-2), pure half. The database half (a real NOINHERIT + SET
 * membership refused at start and by readiness) is in
 * `tests/integration/social-publishing-credential-path-hardening.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  allowedDedicatedRoleMembersFromEnv,
  evaluateDedicatedRoleMemberships
} from "../scripts/lib/dedicated-role-membership";

const ROLE = "awcms_social_dispatch";

describe("dedicated role membership (MEDIUM-2)", () => {
  test("a role that is a member of nothing and has no members passes", () => {
    expect(evaluateDedicatedRoleMemberships(ROLE, [], [])).toEqual([]);
  });

  test("ANY membership of the role is a finding: NOINHERIT + SET, INHERIT, or neither", () => {
    for (const [inherit, set] of [
      [false, true],
      [true, false],
      [false, false]
    ] as const) {
      const findings = evaluateDedicatedRoleMemberships(
        ROLE,
        [{ direction: "member_of", name: "awcms_app", inherit, set }],
        ["awcms_app"]
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain(`${ROLE} is a member of awcms_app`);
    }
  });

  test("an ADMIN-only member (no INHERIT, no SET) is allowed: the PG16+ CREATEROLE creator grant", () => {
    expect(
      evaluateDedicatedRoleMemberships(
        ROLE,
        [
          {
            direction: "member",
            name: "awcms_migrator",
            inherit: false,
            set: false
          }
        ],
        []
      )
    ).toEqual([]);
  });

  test("a SET or INHERIT member must be allow-listed", () => {
    const row = {
      direction: "member" as const,
      name: "awcms_readiness",
      inherit: false,
      set: true
    };

    expect(evaluateDedicatedRoleMemberships(ROLE, [row], [])).toHaveLength(1);
    expect(
      evaluateDedicatedRoleMemberships(ROLE, [row], ["awcms_readiness"])
    ).toEqual([]);
  });

  test("the runtime, worker, setup and dedicated roles are refused even when listed", () => {
    for (const name of [
      "awcms_app",
      "awcms_worker",
      "awcms_setup",
      "awcms_telegram_engagement_dispatch"
    ]) {
      const findings = evaluateDedicatedRoleMemberships(
        ROLE,
        [{ direction: "member", name, inherit: true, set: true }],
        [name]
      );

      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain("never allowed");
    }
  });

  test("the allow list is read from SECURITY_READINESS_DEDICATED_ROLE_MEMBERS", () => {
    expect(
      allowedDedicatedRoleMembersFromEnv({
        SECURITY_READINESS_DEDICATED_ROLE_MEMBERS: " a , ,b "
      } as unknown as NodeJS.ProcessEnv)
    ).toEqual(["a", "b"]);
    expect(
      allowedDedicatedRoleMembersFromEnv({} as unknown as NodeJS.ProcessEnv)
    ).toEqual([]);
  });
});
