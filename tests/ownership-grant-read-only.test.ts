/**
 * Issue #952 re-audit, N-1: an ownership grant (ADR-0063) is a READ basis. The
 * routes refuse a write guard with a grant at definition time
 * (`assertOwnershipGrantIsReadOnly`), and an admin screen's `can(guard,
 * { ownershipGrant })` refuses it too, so a screen cannot widen a write or
 * high-risk action.
 *
 * The chokepoint itself (`authorizeInTransaction`) does NOT refuse it: hand-
 * written routes pass a write-scoped grant after their own ownership check (a
 * blog author updating / submitting their own unpublished post or page), and
 * that is covered by the blog integration suites. That `can` throws, that a
 * read guard with a grant is still honoured, and that an ABAC deny still wins
 * over it, is proven against a real database in
 * `tests/integration/hr-self-service-pages.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import { assertOwnershipGrantAppliesToRead } from "../src/modules/identity-access/application/access-guard";
import type { AccessRequest } from "../src/modules/identity-access/domain/access-control";

const GRANT = { granted: true, reason: "owner of the record" };

const WRITE_AND_HIGH_RISK: AccessRequest[] = [
  { moduleKey: "identity_access", activityCode: "roles", action: "assign" },
  { moduleKey: "hr_workforce", activityCode: "employments", action: "update" },
  { moduleKey: "hr_workforce", activityCode: "corrections", action: "approve" },
  { moduleKey: "hr_workforce", activityCode: "employments", action: "delete" }
];

describe("an ownership grant widens read only", () => {
  for (const guard of WRITE_AND_HIGH_RISK) {
    const key = `${guard.moduleKey}.${guard.activityCode}.${guard.action}`;

    test(`${key} with a grant throws, granted or not`, () => {
      expect(() => assertOwnershipGrantAppliesToRead(guard, GRANT)).toThrow(
        /may only widen a `read` guard/
      );
      expect(() =>
        assertOwnershipGrantAppliesToRead(guard, { ...GRANT, granted: false })
      ).toThrow();
    });
  }

  test("an admin screen's can() calls the assertion before the chokepoint", async () => {
    const source = await Bun.file(
      new URL("../src/lib/auth/admin-screen.ts", import.meta.url)
    ).text();
    const can = source.slice(source.indexOf("const can = async ("));
    const assertAt = can.indexOf("assertOwnershipGrantAppliesToRead(request");
    const authorizeAt = can.indexOf("authorizeInTransaction(");

    expect(assertAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(authorizeAt);
  });

  test("a read guard with a grant, and any guard without one, pass the assertion", () => {
    const read: AccessRequest = {
      moduleKey: "hr_workforce",
      activityCode: "attendance",
      action: "read"
    };

    expect(() => assertOwnershipGrantAppliesToRead(read, GRANT)).not.toThrow();

    for (const guard of WRITE_AND_HIGH_RISK) {
      expect(() =>
        assertOwnershipGrantAppliesToRead(guard, undefined)
      ).not.toThrow();
    }
  });
});
