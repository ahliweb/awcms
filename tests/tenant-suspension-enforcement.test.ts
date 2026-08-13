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
