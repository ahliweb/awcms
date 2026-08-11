/**
 * ADR-0084, Gelombang 5 PR 5.1 of Issue #423 — the entitlement gate.
 *
 * Two obligations, and the first is the unusual one.
 *
 * 1. **It landed inert, and that is PROVEN rather than asserted.** No module in
 *    this base declares `requiresEntitlement`, so the branch is unreachable and
 *    the SQL the chokepoint issues is the SAME STATEMENT it issued before this
 *    wave — not an equivalent one. A migration that adds five tables and a guard
 *    branch is exactly the change where "nothing else moved" deserves evidence.
 *
 * 2. **When it is NOT inert, it can only ever refuse**, at the right position in
 *    the chain, with the three hard exemptions honoured.
 *
 * No database. The guard's SQL is answered by a recording stub, which is also
 * what makes obligation 1 checkable at all.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import { composeModuleRegistry } from "../src/modules/module-management/domain/module-composition";
import type { ModuleDescriptor } from "../src/modules/_shared/module-contract";
import {
  ENTITLEMENT_REQUIRED_POLICY,
  ENTITLING_SUBSCRIPTION_STATUSES,
  evaluateEntitlementRequirement,
  requiredEntitlementForModule
} from "../src/modules/identity-access/domain/entitlement";
import {
  resolveModuleAvailability,
  resolveModuleEnabled
} from "../src/modules/identity-access/application/auth-context";

const NOW = new Date("2026-08-12T00:00:00.000Z");
const TENANT = "11111111-1111-4111-8111-111111111111";

/** Records every statement issued, and answers them all with `rows`. */
function recordingTx(rows: unknown[] = []): {
  tx: Bun.SQL;
  statements: string[];
} {
  const statements: string[] = [];
  const tx = ((strings: TemplateStringsArray) => {
    statements.push(strings.raw.join("?"));
    return Promise.resolve(rows);
  }) as unknown as Bun.SQL;

  (tx as unknown as { array: unknown }).array = (values: readonly string[]) =>
    values;

  return { tx, statements };
}

function descriptor(overrides: Partial<ModuleDescriptor>): ModuleDescriptor {
  return {
    key: "example_module",
    name: "Example",
    version: "1.0.0",
    status: "active",
    description: "Fixture descriptor for entitlement evaluation.",
    dependencies: [],
    ...overrides
  };
}

describe("Gelombang 5 landed INERT", () => {
  test("no module in the registry declares requiresEntitlement", () => {
    const declaring = listModules()
      .filter((module) => module.requiresEntitlement !== undefined)
      .map((module) => module.key);

    expect(declaring).toEqual([]);
  });

  test("requiredEntitlementForModule returns null for every registered module", () => {
    const modules = listModules();
    // Guards the guard: if the registry were ever empty, the assertion below
    // would hold vacuously and prove nothing.
    expect(modules.length).toBeGreaterThan(20);

    for (const module of modules) {
      expect(requiredEntitlementForModule(module.key, modules)).toBeNull();
    }
  });

  test("with no entitlement required, the availability query is the SAME statement as before the wave", async () => {
    const before = recordingTx([{ enabled: true }]);
    await resolveModuleEnabled(before.tx, TENANT, "blog_content");

    const after = recordingTx([{ enabled: true }]);
    await resolveModuleAvailability(
      after.tx,
      TENANT,
      "blog_content",
      null,
      NOW
    );

    expect(after.statements).toEqual(before.statements);
    expect(after.statements).toHaveLength(1);
    // Not merely "one statement" — the entitlement tables must not appear in it.
    expect(after.statements[0]).not.toContain("awcms_tenant_entitlements");
    expect(after.statements[0]).not.toContain("awcms_tenant_subscriptions");
  });

  test("the null path issues ONE round trip, not two", async () => {
    const { tx, statements } = recordingTx([{ enabled: false }]);

    const availability = await resolveModuleAvailability(
      tx,
      TENANT,
      "blog_content",
      null,
      NOW
    );

    expect(statements).toHaveLength(1);
    expect(availability).toEqual({ enabled: false, entitlementHeld: true });
  });
});

describe("requiredEntitlementForModule — the two module-level exemptions", () => {
  test("a descriptor declaring one requires it", () => {
    const modules = [
      descriptor({ key: "site_search", requiresEntitlement: "site_search" })
    ];

    expect(requiredEntitlementForModule("site_search", modules)).toBe(
      "site_search"
    );
  });

  test("isCore can never require one, even when it declares one", () => {
    const modules = [
      descriptor({
        key: "module_management",
        isCore: true,
        requiresEntitlement: "module_management"
      })
    ];

    expect(
      requiredEntitlementForModule("module_management", modules)
    ).toBeNull();
  });

  test("an unknown module key requires nothing rather than refusing", () => {
    expect(requiredEntitlementForModule("no_such_module", [])).toBeNull();
  });
});

describe("evaluateEntitlementRequirement — deny-only, and the request-level exemption", () => {
  test("nothing required means no objection", () => {
    expect(
      evaluateEntitlementRequirement({
        requiredEntitlementKey: null,
        held: false,
        actingTenantIsPlatform: false
      })
    ).toBeNull();
  });

  test("held means no objection", () => {
    expect(
      evaluateEntitlementRequirement({
        requiredEntitlementKey: "site_search",
        held: true,
        actingTenantIsPlatform: false
      })
    ).toBeNull();
  });

  test("the platform tenant is exempt even when it holds nothing", () => {
    expect(
      evaluateEntitlementRequirement({
        requiredEntitlementKey: "site_search",
        held: false,
        actingTenantIsPlatform: true
      })
    ).toBeNull();
  });

  test("required and unheld is the ONLY case that refuses, and it names the key", () => {
    const denial = evaluateEntitlementRequirement({
      requiredEntitlementKey: "site_search",
      held: false,
      actingTenantIsPlatform: false
    });

    expect(denial).not.toBeNull();
    expect(denial!.matchedPolicy).toBe(ENTITLEMENT_REQUIRED_POLICY);
    expect(denial!.entitlementKey).toBe("site_search");
    // The 403 body reaches a caller who may be unauthenticated-adjacent or a
    // machine credential. It must not quote billing state or a plan price.
    expect(denial!.reason).toBe(
      "This feature is not included in the current plan."
    );
  });

  test("no reachable input produces an allow-shaped value", () => {
    for (const requiredEntitlementKey of [null, "site_search"]) {
      for (const held of [true, false]) {
        for (const actingTenantIsPlatform of [true, false]) {
          const result = evaluateEntitlementRequirement({
            requiredEntitlementKey,
            held,
            actingTenantIsPlatform
          });

          if (result !== null) {
            expect(Object.keys(result).sort()).toEqual([
              "entitlementKey",
              "matchedPolicy",
              "reason"
            ]);
          }
        }
      }
    }
  });
});

describe("the decision-log sentinel", () => {
  test("is pinned to its exact value", () => {
    // The guard FORWARDS this rather than restating it, which is what makes the
    // two unable to drift — see `tests/guard-structural-gate-order.test.ts`.
    // What that arrangement does not protect is the value itself, and a
    // decision-log consumer greps for the string. This is that protection.
    expect(ENTITLEMENT_REQUIRED_POLICY).toBe("entitlement_required");
  });
});

describe("the entitling status set", () => {
  test("past_due and grace still serve; suspended and cancelled do not", () => {
    expect([...ENTITLING_SUBSCRIPTION_STATUSES]).toEqual([
      "trialing",
      "active",
      "past_due",
      "grace"
    ]);
    expect([...ENTITLING_SUBSCRIPTION_STATUSES]).not.toContain("suspended");
    expect([...ENTITLING_SUBSCRIPTION_STATUSES]).not.toContain("cancelled");
  });
});

describe("resolveModuleAvailability — the entitled path", () => {
  test("a required key folds BOTH questions into one round trip", async () => {
    const { tx, statements } = recordingTx([
      { enabled: true, entitlement_held: true }
    ]);

    const availability = await resolveModuleAvailability(
      tx,
      TENANT,
      "site_search",
      "site_search",
      NOW
    );

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("awcms_tenant_modules");
    expect(statements[0]).toContain("awcms_tenant_entitlements");
    expect(statements[0]).toContain("awcms_tenant_subscriptions");
    expect(statements[0]).toContain("awcms_plan_entitlements");
    expect(availability).toEqual({ enabled: true, entitlementHeld: true });
  });

  test("a query returning no row reads as UNENTITLED, never as entitled", async () => {
    const { tx } = recordingTx([]);

    const availability = await resolveModuleAvailability(
      tx,
      TENANT,
      "site_search",
      "site_search",
      NOW
    );

    expect(availability.entitlementHeld).toBe(false);
  });
});

describe("modules:compose:check refuses a declaration the runtime would ignore", () => {
  test("a core module declaring an entitlement is a composition issue", () => {
    const result = composeModuleRegistry([
      descriptor({
        key: "module_management",
        isCore: true,
        requiresEntitlement: "control_plane"
      })
    ]);

    expect(result.valid).toBe(false);
    expect(
      (result as { issues: readonly { type: string }[] }).issues.map(
        (issue) => issue.type
      )
    ).toContain("core_module_declares_entitlement");
  });

  test("a key the catalogue's CHECK would reject is a composition issue", () => {
    // `awcms_entitlements_key_format_check` (sql/109) enforces the same shape.
    // Without this, the descriptor compiles, the migration has no matching row,
    // and every request to that module is refused forever with a message about
    // billing.
    const result = composeModuleRegistry([
      descriptor({ key: "site_search", requiresEntitlement: "Site-Search" })
    ]);

    expect(result.valid).toBe(false);
    expect(
      (result as { issues: readonly { type: string }[] }).issues.map(
        (issue) => issue.type
      )
    ).toContain("invalid_entitlement_key");
  });

  test("a well-formed declaration on a non-core module composes cleanly", () => {
    expect(
      composeModuleRegistry([
        descriptor({ key: "site_search", requiresEntitlement: "site_search" })
      ]).valid
    ).toBe(true);
  });
});
