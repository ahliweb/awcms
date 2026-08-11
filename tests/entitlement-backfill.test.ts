/**
 * Grandfathering — ADR-0084, Gelombang 5 PR 5.3 of Issue #423.
 *
 * The claim under test is not "the backfill grants things". It is the ASYMMETRY
 * that makes a blanket grandfather legitimate here while
 * `owner-permission-backfill.ts` refuses one: an entitlement has never existed
 * to be revoked, so an absent row cannot mean a decision — until the first
 * revocation, which is exactly what the `tenant_newer_than_entitlement` rule
 * draws the line at.
 *
 * Pure. No database.
 */
import { describe, expect, test } from "bun:test";

import {
  GRANDFATHER_GRANT_REASON,
  planEntitlementBackfill,
  summarizeBlastRadius,
  type EntitlementBackfillInput
} from "../src/modules/identity-access/domain/entitlement-backfill";
import { collectRequiredEntitlementKeys } from "../src/modules/identity-access/application/entitlement-backfill-job";
import { listModules } from "../src/modules";

const JAN = new Date("2026-01-01T00:00:00.000Z");
const JUN = new Date("2026-06-01T00:00:00.000Z");
const DEC = new Date("2026-12-01T00:00:00.000Z");

function input(
  overrides: Partial<EntitlementBackfillInput> = {}
): EntitlementBackfillInput {
  return {
    requiredEntitlementKeys: ["site_search"],
    catalogueCreatedAt: new Map([["site_search", JUN]]),
    tenants: [{ tenantId: "t-old", tenantCode: "old", createdAt: JAN }],
    heldByTenant: new Map(),
    ...overrides
  };
}

describe("what the registry actually requires", () => {
  test("the collector reads the SAME resolver the chokepoint uses", () => {
    // Not a list of expected strings: the point is that the backfill and the
    // guard can never disagree about which keys matter. A key the guard enforces
    // but the backfill misses leaves tenants denied; a key the backfill
    // grandfathers but the guard ignores writes rows nobody reads.
    const fromCollector = collectRequiredEntitlementKeys();
    const fromRegistry = [
      ...new Set(
        listModules()
          .filter((module) => module.isCore !== true)
          .map((module) => module.requiresEntitlement)
          .filter((key): key is string => key !== undefined)
      )
    ].sort();

    expect(fromCollector).toEqual(fromRegistry);
    // Anti-vacuous: this assertion said nothing while the list was empty, which
    // is exactly what it was before PR 5.4 attached the first one.
    expect(fromCollector.length).toBeGreaterThan(0);
  });
});

describe("who gets grandfathered", () => {
  test("a tenant older than the entitlement is granted it", () => {
    const plan = planEntitlementBackfill(input());

    expect(plan.grants).toEqual([
      { tenantId: "t-old", tenantCode: "old", entitlementKey: "site_search" }
    ]);
  });

  test("a tenant NEWER than the entitlement is reported, never re-granted", () => {
    // The line where the asymmetry expires. After the entitlement existed, an
    // absent row is a fact about THIS tenant — possibly a revocation — and
    // re-granting it would silently undo a decision.
    const plan = planEntitlementBackfill(
      input({
        tenants: [{ tenantId: "t-new", tenantCode: "new", createdAt: DEC }]
      })
    );

    expect(plan.grants).toEqual([]);
    expect(plan.skipped).toEqual([
      {
        tenantId: "t-new",
        tenantCode: "new",
        entitlementKey: "site_search",
        reason: "tenant_newer_than_entitlement"
      }
    ]);
  });

  test("a tenant created at the exact catalogue instant counts as NEWER", () => {
    // Ties go to the conservative side: not granting is recoverable by a human,
    // granting silently is not.
    const plan = planEntitlementBackfill(
      input({
        tenants: [{ tenantId: "t-tie", tenantCode: "tie", createdAt: JUN }]
      })
    );

    expect(plan.grants).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe("tenant_newer_than_entitlement");
  });

  test("a tenant that already holds it is skipped, not double-granted", () => {
    const plan = planEntitlementBackfill(
      input({ heldByTenant: new Map([["t-old", new Set(["site_search"])]]) })
    );

    expect(plan.grants).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe("already_held");
  });

  test("a key with no catalogue row is skipped rather than invented", () => {
    // `awcms_entitlements` is migration-only (ADR-0084). A job that created a
    // row here would put a request path's worth of authority in a cron script.
    const plan = planEntitlementBackfill(
      input({ catalogueCreatedAt: new Map() })
    );

    expect(plan.grants).toEqual([]);
    expect(plan.skipped[0]!.reason).toBe("no_catalogue_row");
  });

  test("the grant reason is one fixed sentence, so a hand-granted row is distinguishable", () => {
    expect(GRANDFATHER_GRANT_REASON).toContain("Grandfathered");
    expect(GRANDFATHER_GRANT_REASON).toContain("ADR-0084");
  });
});

describe("the blast-radius report", () => {
  const threeTenants = input({
    requiredEntitlementKeys: ["site_search", "custom_domain"],
    catalogueCreatedAt: new Map([
      ["site_search", JUN],
      ["custom_domain", JUN]
    ]),
    tenants: [
      { tenantId: "t1", tenantCode: "alpha", createdAt: JAN },
      { tenantId: "t2", tenantCode: "beta", createdAt: DEC },
      { tenantId: "t3", tenantCode: "gamma", createdAt: JAN }
    ],
    heldByTenant: new Map([["t3", new Set(["site_search"])]])
  });

  test("counts every tenant that does NOT hold the key, whatever the reason", () => {
    const radius = summarizeBlastRadius(planEntitlementBackfill(threeTenants));

    // `custom_domain`: nobody holds it -> all three.
    // `site_search`: gamma holds it -> alpha (grantable) + beta (too new).
    expect(radius).toEqual([
      {
        entitlementKey: "custom_domain",
        deniedTenantCount: 3,
        deniedTenantCodes: ["alpha", "beta", "gamma"]
      },
      {
        entitlementKey: "site_search",
        deniedTenantCount: 2,
        deniedTenantCodes: ["alpha", "beta"]
      }
    ]);
  });

  test("it is derived from the SAME plan, so it cannot disagree with the backfill", () => {
    // Two derivations of "who is missing this" is two chances to answer
    // differently, and the value of this report is being trustworthy on the day
    // it says zero. Asserted structurally: every grant and every non-held skip
    // is accounted for exactly once.
    const plan = planEntitlementBackfill(threeTenants);
    const radius = summarizeBlastRadius(plan);

    const fromPlan =
      plan.grants.length +
      plan.skipped.filter((skip) => skip.reason !== "already_held").length;
    const fromRadius = radius.reduce(
      (total, entry) => total + entry.deniedTenantCount,
      0
    );

    expect(fromRadius).toBe(fromPlan);
  });

  test("a tenant holding everything contributes nothing", () => {
    const radius = summarizeBlastRadius(
      planEntitlementBackfill(
        input({ heldByTenant: new Map([["t-old", new Set(["site_search"])]]) })
      )
    );

    expect(radius).toEqual([]);
  });
});
