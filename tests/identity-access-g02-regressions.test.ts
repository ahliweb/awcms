import { describe, expect, test } from "bun:test";
import { unassignRoleFromGroup } from "../src/modules/identity-access/application/user-admin";
import {
  addUserGroupMember,
  GroupMembershipTargetNotFoundError,
  removeUserGroupMember
} from "../src/modules/identity-access/application/user-group-admin";

const ID = "11111111-1111-4111-8111-111111111111";
type Call = { q: string; v: unknown[] };

function fakeTx(respond: (q: string) => unknown[]) {
  const calls: Call[] = [];
  const tx = ((s: TemplateStringsArray, ...v: unknown[]) => {
    const q = s.join("?");
    calls.push({ q, v });
    return Promise.resolve(respond(q));
  }) as unknown as Bun.SQL;
  return { tx, calls };
}

const auditActions = (calls: Call[]) =>
  [...JSON.stringify(calls.map((c) => c.v)).matchAll(/"action":"(\w+)"/g)].map(
    (m) => m[1]
  );

describe("identity-access g02 regressions", () => {
  test("unassignRoleFromGroup audits as revoke", async () => {
    const { tx, calls } = fakeTx((q) =>
      /SELECT 1 FROM awcms_roles/.test(q) ? [] : [{ id: "x" }]
    );
    expect(await unassignRoleFromGroup(tx, ID, ID, ID, ID)).toBe(true);
    expect(auditActions(calls)).toEqual(["revoke"]);
  });

  test("removeUserGroupMember audits as revoke", async () => {
    const { tx, calls } = fakeTx((q) =>
      q.includes("DELETE")
        ? [{ id: "m1" }]
        : q.includes("SELECT 1")
          ? []
          : [{ id: "a1" }]
    );
    const r = await removeUserGroupMember(tx, ID, ID, {
      userGroupId: ID,
      tenantUserId: ID
    });
    expect(r.removed).toBe(true);
    expect(auditActions(calls)).toEqual(["revoke"]);
  });

  test("addUserGroupMember on a soft-deleted group with a stale row throws not-found", async () => {
    const { tx } = fakeTx((q) => {
      if (q.includes("INSERT")) return [];
      if (q.includes("FROM awcms_user_group_members"))
        return /deleted_at IS NULL/.test(q) ? [] : [1];
      return [];
    });
    await expect(
      addUserGroupMember(tx, ID, ID, { userGroupId: ID, tenantUserId: ID })
    ).rejects.toBeInstanceOf(GroupMembershipTargetNotFoundError);
  });
});
