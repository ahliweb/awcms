/**
 * `defineTenantRoute`'s `ownershipGrant` is a READ basis only (Issue #945,
 * ADR-0063). The refusal is at DEFINITION time, so a write route that tries to
 * use it fails at module load — the build and every test importing it — not on a
 * request in production. The machine-credential half (a credential never carries
 * an ownership grant) is in `tests/integration/machine-credentials.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  assertOwnershipGrantIsReadOnly,
  defineTenantRoute
} from "../src/modules/_shared/tenant-route";

const READ = {
  moduleKey: "hr_workforce",
  activityCode: "employments",
  action: "read" as const
};
const grant = async () => ({ granted: true, reason: "own" });

describe("ownershipGrant is read-only, checked at definition time", () => {
  test("a read guard (or several) is accepted", () => {
    expect(() => assertOwnershipGrantIsReadOnly(READ)).not.toThrow();
    expect(() => assertOwnershipGrantIsReadOnly([READ, READ])).not.toThrow();
    expect(() =>
      defineTenantRoute({
        workClass: "interactive",
        authorize: READ,
        ownershipGrant: grant,
        handler: () => new Response("ok")
      })
    ).not.toThrow();
  });

  test("defining a write route with an ownership grant throws", () => {
    for (const action of ["update", "create", "delete", "assign"] as const) {
      expect(() =>
        defineTenantRoute({
          workClass: "interactive",
          authorize: { ...READ, action },
          ownershipGrant: grant,
          handler: () => new Response("ok")
        })
      ).toThrow(/read/);
    }
  });

  test("one write guard among reads is enough to refuse; so are an empty list and the function form", () => {
    expect(() =>
      assertOwnershipGrantIsReadOnly([READ, { ...READ, action: "update" }])
    ).toThrow();
    expect(() => assertOwnershipGrantIsReadOnly([])).toThrow();
    expect(() => assertOwnershipGrantIsReadOnly(() => READ)).toThrow(/static/);
  });

  test("a route without an ownership grant is unaffected", () => {
    expect(() =>
      defineTenantRoute({
        workClass: "interactive",
        authorize: { ...READ, action: "update" },
        handler: () => new Response("ok")
      })
    ).not.toThrow();
  });
});
