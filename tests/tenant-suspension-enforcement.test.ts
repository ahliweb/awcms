/**
 * ADR-0073 — suspension is enforced at the chokepoint, not only at login.
 *
 * The behavioural half (issue a session, suspend, watch the SAME session get
 * refused) needs PostgreSQL and lives in the DB-gated suite. What is asserted
 * here is everything that can rot WITHOUT a database, and every one of these
 * would have been true before the fix — which is exactly why they are written
 * down rather than assumed:
 *
 * - the allow-list stays small and is a code declaration;
 * - the platform tenant is exempt in BOTH places, not one;
 * - the guard's refusal comes before permissions are looked up;
 * - `inactive` is treated like `suspended`.
 */
import { describe, expect, test } from "bun:test";

import {
  SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS,
  isAllowedWhileSuspended,
  isSuspensionExemptTenant,
  isTenantServiceStopped
} from "../src/modules/identity-access/domain/suspended-tenant-allowlist";

const GUARD_SOURCE = "src/modules/identity-access/application/access-guard.ts";
const SSR_SOURCE = "src/lib/auth/ssr-session.ts";
const LIFECYCLE_SOURCE =
  "src/modules/tenant-admin/application/tenant-lifecycle.ts";
const FACTORY_SOURCE = "src/modules/_shared/tenant-route.ts";

describe("which tenant states stop service", () => {
  test("suspended and inactive both stop it; active does not", () => {
    // ADR-0073 §B — enforcing one and serving the other would reintroduce the
    // same asymmetry this work exists to close, one status smaller.
    expect(isTenantServiceStopped("suspended")).toBe(true);
    expect(isTenantServiceStopped("inactive")).toBe(true);
    expect(isTenantServiceStopped("active")).toBe(false);
  });
});

describe("the allow-list is small, and staying small is the point", () => {
  test("it holds a handful of keys, not a class of actions", () => {
    // ADR-0073 §D: the unit is the full permission key. If this ever grows past
    // a handful, someone widened a suspension without an ADR.
    expect(SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS.size).toBeGreaterThan(0);
    expect(SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS.size).toBeLessThanOrEqual(
      5
    );
  });

  test("every entry is a full module.activity.action key", () => {
    for (const key of SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS) {
      expect(key.split(".")).toHaveLength(3);
    }
  });

  test("no WRITE survives suspension", () => {
    // Suspension exists to stop writes. A `create`/`update`/`delete`/`configure`
    // in this list would be someone quietly undoing that.
    for (const key of SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS) {
      const action = key.split(".")[2]!;

      expect([
        "create",
        "update",
        "delete",
        "configure",
        "publish",
        "approve",
        "assign"
      ]).not.toContain(action);
    }
  });

  test("an ordinary write is refused while suspended", () => {
    expect(
      isAllowedWhileSuspended({
        moduleKey: "blog_content",
        activityCode: "posts",
        action: "update"
      })
    ).toBe(false);
  });

  test("a listed key is allowed", () => {
    expect(
      isAllowedWhileSuspended({
        moduleKey: "tenant_admin",
        activityCode: "tenant_settings",
        action: "read"
      })
    ).toBe(true);
  });
});

describe("the platform tenant cannot be locked out of its own remedy", () => {
  const PLATFORM = "11111111-1111-4111-8111-111111111111";
  const CUSTOMER = "22222222-2222-4222-8222-222222222222";

  test("the platform tenant is exempt", () => {
    expect(isSuspensionExemptTenant(PLATFORM, PLATFORM)).toBe(true);
  });

  test("an ordinary tenant is not", () => {
    expect(isSuspensionExemptTenant(CUSTOMER, PLATFORM)).toBe(false);
  });

  test("no platform tenant resolved means no exemption — fail closed", () => {
    expect(isSuspensionExemptTenant(CUSTOMER, null)).toBe(false);
  });

  test("the guard uses the status-IGNORING resolver, not the active-only one", async () => {
    // The trap ADR-0073 §E exists for: `resolvePlatformTenant` requires
    // `status = 'active'`, so a platform tenant that somehow became suspended
    // would resolve to null, the exemption would be false, and the operator
    // would be refused EVERY action including the one that lifts it.
    const source = await Bun.file(GUARD_SOURCE).text();
    const exemptionCall = source.indexOf("isSuspensionExemptTenant(");

    expect(exemptionCall).toBeGreaterThan(-1);
    expect(source.slice(exemptionCall, exemptionCall + 200)).toContain(
      "resolvePlatformTenantIdIgnoringStatus"
    );
  });

  test("the suspend service refuses the platform tenant as a second belt", async () => {
    const source = await Bun.file(LIFECYCLE_SOURCE).text();

    expect(source).toContain("platform_blocked");
    // `restoreTenant` must NOT carry it: restoring the platform tenant is
    // exactly the repair you want to remain possible, and the TYPE says so.
    const restoreAt = source.indexOf("export async function restoreTenant");
    expect(restoreAt).toBeGreaterThan(-1);
    expect(source.slice(restoreAt)).not.toContain("platform_blocked");
  });
});

describe("placement inside the guard", () => {
  test("the refusal is decided BEFORE permissions are fetched", async () => {
    // ADR-0073 §A. If this moved below the fetch, a structural gate would
    // become a permission-shaped one and the failure would be invisible: a
    // grant row that should not exist becomes sufficient.
    const source = await Bun.file(GUARD_SOURCE).text();

    const suspended = source.indexOf('matchedPolicy: "tenant_suspended"');
    const fetched = source.indexOf("fetchGrantedPermissionKeys(");

    expect(suspended).toBeGreaterThan(-1);
    expect(fetched).toBeGreaterThan(-1);
    expect(suspended).toBeLessThan(fetched);
  });

  test("the refusal writes a decision log before returning", async () => {
    const source = await Bun.file(GUARD_SOURCE).text();
    const suspended = source.indexOf('matchedPolicy: "tenant_suspended"');
    const window = source.slice(suspended, suspended + 500);

    expect(window).toContain("recordDecisionLog(");
    expect(window.indexOf("recordDecisionLog(")).toBeLessThan(
      window.indexOf("TENANT_SUSPENDED")
    );
  });

  test("machine credentials are covered, not just sessions", async () => {
    // The half that was most exposed: a machine credential can live 365 days
    // and its resolution path never touched `awcms_tenants` at all.
    const source = await Bun.file(GUARD_SOURCE).text();
    const suspended = source.indexOf("isTenantServiceStopped(");
    // ADR-0092 renamed this gate when the WRITE class arrived
    // (`isMachineCredentialAllowedAction` → `isMachineCredentialWriteRefused`).
    // The gate did not move; only its name changed.
    const machineGate = source.indexOf("isMachineCredentialWriteRefused(");

    expect(suspended).toBeGreaterThan(-1);
    // Asserted too, and it is the assertion this test was missing: without it,
    // a rename turns `machineGate` into -1 and `suspended < -1` fails for the
    // WRONG reason — which is what happened, and which read as a real
    // regression for as long as it took to open the file.
    expect(machineGate).toBeGreaterThan(-1);
    // Decided on the principal, which both paths produce, and placed before the
    // machine-specific gate so neither kind can slip past it.
    expect(suspended).toBeLessThan(machineGate);
  });
});

describe("the admin shell", () => {
  test("SSR refuses a stopped tenant, covering all 32 screens in one place", async () => {
    const source = await Bun.file(SSR_SOURCE).text();

    expect(source).toContain("isTenantServiceStopped(");
    expect(source).toContain("resolveTenantPrincipal(");
  });
});

/**
 * Finding A2 — the two factories that have no `AccessRequest` to consult.
 *
 * The behavioural half is
 * `tests/integration/suspended-tenant-self-service.integration.test.ts`. What is
 * asserted here is the shape that decides which way an omission fails, and every
 * one of these was FALSE before the fix.
 */
describe("the factories with no chokepoint", () => {
  test("both open their transaction and refuse BEFORE the handler runs", async () => {
    const source = await Bun.file(FACTORY_SOURCE).text();

    // Two call sites, one per factory. One would mean a route class was left
    // out, which is exactly how this finding came to exist.
    expect(
      (source.match(/await refuseIfTenantSuspended\(/g) ?? []).length
    ).toBe(2);

    // Sliced by factory rather than matched on a formatted call expression: an
    // assertion keyed to exact indentation is one `bun run format` away from
    // passing for a reason nobody chose.
    const factories: [string, string][] = [
      [
        "export function defineSelfServiceTenantRoute",
        "export type ClientCredentialTenantRouteConfig"
      ],
      ["export function defineClientCredentialTenantRoute", "\n/**\n * SSE"]
    ];

    for (const [start, end] of factories) {
      const from = source.indexOf(start);
      const to = source.indexOf(end, from);

      expect(from).toBeGreaterThan(-1);
      expect(to).toBeGreaterThan(from);

      const body = source.slice(from, to);
      const refusal = body.indexOf("refuseIfTenantSuspended(");
      const handler = body.indexOf("config.handler(");

      expect(refusal).toBeGreaterThan(-1);
      expect(handler).toBeGreaterThan(-1);
      expect(refusal).toBeLessThan(handler);
    }
  });

  test("omitting the declaration REFUSES — the default is the safe one", async () => {
    const source = await Bun.file(FACTORY_SOURCE).text();

    // A truthy reason opts out; anything else falls through to the read. The
    // inverse shape (`if (!allowed) return undefined`) would make every route
    // that never heard of this field served while suspended, which is the state
    // this finding describes.
    expect(source).toContain(
      "if (allowedWhileTenantSuspended) return undefined;"
    );
  });

  test("a missing tenant row reads as stopped", async () => {
    const source = await Bun.file(FACTORY_SOURCE).text();

    expect(source).toContain('const status = rows[0]?.status ?? "suspended";');
  });

  test("the platform exemption is consulted, and only for a tenant already refused", async () => {
    const source = await Bun.file(FACTORY_SOURCE).text();

    const stopped = source.indexOf("if (!isTenantServiceStopped(status))");
    const exempt = source.indexOf("isSuspensionExemptTenant(");

    expect(stopped).toBeGreaterThan(-1);
    expect(exempt).toBeGreaterThan(stopped);
    // The status-IGNORING resolver, for the reason the guard uses it: a
    // platform tenant that has been suspended must still be able to lift it.
    expect(source).toContain("resolvePlatformTenantIdIgnoringStatus(");
  });

  test("every opt-out states a REASON, and the set is the four that only remove access", async () => {
    const declared: Record<string, string> = {};

    for await (const entry of new Bun.Glob("src/pages/api/**/*.ts").scan(".")) {
      const source = await Bun.file(entry).text();
      const match = source.match(
        /allowedWhileTenantSuspended:\s*\n?\s*"([^"]+)"/
      );

      if (match) declared[entry.split("\\").join("/")] = match[1]!;
    }

    // Widening this set is widening what a cut-off customer may still do, and
    // it should be as visible in a diff as an entry in
    // SUSPENDED_TENANT_ALLOWED_PERMISSION_KEYS is.
    expect(Object.keys(declared).sort()).toEqual([
      "src/pages/api/v1/auth/sessions/[id].ts",
      "src/pages/api/v1/auth/sessions/index.ts",
      "src/pages/api/v1/auth/sessions/revoke-all.ts",
      "src/pages/api/v1/push/subscriptions/[id].ts"
    ]);

    for (const reason of Object.values(declared)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
