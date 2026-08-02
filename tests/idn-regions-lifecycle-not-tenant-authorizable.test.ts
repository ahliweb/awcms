/**
 * Region-dataset activation/rollback must never become tenant-authorizable.
 *
 * ## The defect this pins
 *
 * Both actions swap `awcms_idn_region_datasets` — GLOBAL reference data with no
 * `tenant_id` and no RLS, served identically to every tenant. They shipped as
 * HTTP endpoints gated on `idn_admin_regions.dataset.configure` / `.restore`,
 * and `sql/081` seeded those into the GLOBAL ABAC catalogue. Since
 * `bootstrapPlatformTenant` grants the whole catalogue to a new tenant's
 * `owner` role, an ordinary tenant owner held authority over data served to
 * OTHER tenants — and ABAC saw nothing wrong, because it evaluates the
 * permission, not who the action ultimately affects.
 *
 * ## What changed, and what did NOT
 *
 * ADR-0052 removed the endpoints and revoked the permissions (`sql/084`),
 * because the only honest options at the time were "delete it" or "build a
 * platform-scoped gate", and the gate did not exist.
 *
 * ADR-0053 built the gate, so the endpoints are back (`sql/085`). The invariant
 * this file defends is UNCHANGED and is the one that always mattered: **an
 * ordinary tenant must never be able to perform these two actions.** Only the
 * mechanism moved — from "there is no surface" to "the surface exists and is
 * platform-scoped". Asserting the old mechanism instead of the invariant would
 * now block the fix rather than the defect.
 *
 * ## Why a test and not just the ADR
 *
 * The regression is a one-line edit that reads as tidying in a diff: dropping
 * `scope: "platform"` from a descriptor, because the migration "already says
 * so". Nothing else objects — `modules:compose:check` is happy with any
 * declared permission — and the result is the original cross-tenant defect,
 * restored in full, with every gate green. So the invariant is asserted from
 * three angles at once: the descriptor, the routes, and the migration.
 *
 * Pure — no database, no network.
 */
import { readdir, readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const LIFECYCLE_ACTIONS = ["configure", "restore"] as const;

function idnModule() {
  const module = listModules().find(
    (candidate) => candidate.key === "idn_admin_regions"
  );

  expect(module).toBeDefined();
  return module!;
}

describe("idn_admin_regions dataset lifecycle is not tenant-authorizable", () => {
  test("both lifecycle permissions are declared PLATFORM-scoped", () => {
    const permissions = idnModule().permissions ?? [];

    // Anti-vacuity: the module really does still declare its read surface, so
    // an empty `permissions` array cannot make the assertions below pass.
    const byKey = new Map(
      permissions.map((permission) => [
        `${permission.activityCode}.${permission.action}`,
        permission
      ])
    );
    expect(byKey.has("region.read")).toBe(true);
    expect(byKey.has("dataset.read")).toBe(true);

    for (const action of LIFECYCLE_ACTIONS) {
      const permission = byKey.get(`dataset.${action}`);
      expect(permission).toBeDefined();
      expect(permission!.scope).toBe("platform");
    }
  });

  test("and the READ permissions are not — or the whole module would be operator-only", () => {
    // The opposite failure: scoping everything to the platform would lock every
    // tenant out of looking up its own addresses, and the test above alone
    // would not notice.
    const permissions = idnModule().permissions ?? [];

    for (const permission of permissions) {
      if (permission.action === "read") {
        expect(permission.scope ?? "tenant").toBe("tenant");
      }
    }
  });

  test("the HTTP routes enforce those platform-scoped permissions", async () => {
    const routes = await Array.fromAsync(
      new Bun.Glob("src/pages/api/v1/idn-regions/**/*.ts").scan({
        cwd: process.cwd()
      })
    );

    // Anti-vacuity: a bad glob would make every route-content assertion below
    // pass by iterating nothing.
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toContain("src/pages/api/v1/idn-regions/datasets/index.ts");

    const lifecycleRoutes = routes.filter((route) =>
      /activate|rollback/.test(route)
    );
    expect(lifecycleRoutes).toHaveLength(2);

    for (const route of lifecycleRoutes) {
      const source = await readFile(route, "utf8");

      // Each must authorize on the dataset activity with a lifecycle action —
      // a route that quietly authorized on `dataset.read` instead would be
      // reachable by every tenant while still looking guarded.
      expect(source).toContain("IDN_DATASET_ACTIVITY_CODE");
      expect(source).toMatch(/action:\s*"(configure|restore)"/);
      expect(source).not.toMatch(/action:\s*"read"/);
      // High-risk, and idempotency-keyed: a retried activation must not double-apply.
      expect(source.toLowerCase()).toContain("idempotency-key");
    }
  });

  test("the migration seeds them as platform scope and grants no tenant", async () => {
    const files = (await readdir("sql")).filter((name) =>
      name.endsWith(".sql")
    );
    const bodies = await Promise.all(
      files.map(async (name) => ({
        name,
        body: await readFile(`sql/${name}`, "utf8")
      }))
    );

    const seeding = bodies.filter(
      (file) =>
        file.body.includes("idn_admin_regions") &&
        /INSERT\s+INTO\s+awcms_permissions/i.test(file.body) &&
        file.body.includes("'platform'")
    );

    expect(seeding).toHaveLength(1);

    const body = seeding[0]!.body;
    for (const action of LIFECYCLE_ACTIONS) {
      expect(body).toContain(`'${action}'`);
    }

    // The grant is anchored to the setup tenant. A grant that walked
    // `awcms_tenants` — or omitted the anchor entirely — would hand the pair to
    // every tenant, which is the defect wearing the new column as a disguise.
    expect(body).toContain("FROM awcms_setup_state");
    expect(body).not.toMatch(/FROM\s+awcms_tenants/i);
  });

  test("the operator jobs remain — a browser is not the only way in", async () => {
    // Kept from ADR-0052 deliberately: CI, a recovery shell, and a deployment
    // whose platform tenant cannot log in all need a non-HTTP path.
    const commands = (idnModule().jobs ?? []).map((job) => job.command);

    expect(commands).toContain("bun run idn-regions:activate");
    expect(commands).toContain("bun run idn-regions:rollback");

    const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["idn-regions:activate"]).toBe(
      "bun scripts/idn-regions-activate.ts"
    );
    expect(pkg.scripts["idn-regions:rollback"]).toBe(
      "bun scripts/idn-regions-rollback.ts"
    );
  });

  test("both jobs are dry-run by default — --commit is what writes", async () => {
    for (const script of [
      "scripts/idn-regions-activate.ts",
      "scripts/idn-regions-rollback.ts"
    ]) {
      const source = await readFile(script, "utf8");
      expect(source).toContain('includes("--commit")');
      // The write path is guarded by that flag rather than being the default.
      expect(source).toMatch(/if\s*\(\s*!commit\s*\)/);
    }
  });
});
