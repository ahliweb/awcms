/**
 * Region-dataset activation/rollback must never become tenant-authorizable again.
 *
 * ## The defect this pins
 *
 * Both actions swap `awcms_idn_region_datasets` — GLOBAL reference data with no
 * `tenant_id` and no RLS, served identically to every tenant. They shipped as
 * HTTP endpoints gated on `idn_admin_regions.dataset.configure` / `.restore`,
 * and `sql/081` seeded those into the GLOBAL ABAC catalogue. Since
 * `POST /api/v1/setup/initialize` grants the whole catalogue to each new
 * tenant's `owner` role, an ordinary tenant owner held authority over data
 * served to OTHER tenants — and ABAC saw nothing wrong, because it evaluates the
 * permission, not who the action ultimately affects.
 *
 * ADR-0052 removed the endpoints and revoked the permissions (`sql/084`), making
 * both actions operator jobs.
 *
 * ## Why a test and not just the ADR
 *
 * The regression is a one-line re-add that reads as an improvement in a diff:
 * "expose activation over HTTP so the admin screen can call it". Nothing else in
 * the repo would object — `modules:compose:check` is happy with any declared
 * permission, and a new route file needs no permission to exist. So the
 * invariant is asserted directly, from three angles at once: the descriptor, the
 * filesystem, and the migration.
 *
 * Pure — no database, no network.
 */
import { readdir, readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";

const FORBIDDEN_ACTIONS = ["configure", "restore"] as const;

describe("idn_admin_regions dataset lifecycle is not tenant-authorizable", () => {
  test("the descriptor declares only read permissions", () => {
    const module = listModules().find(
      (candidate) => candidate.key === "idn_admin_regions"
    );

    expect(module).toBeDefined();

    const declared = (module!.permissions ?? []).map(
      (permission) => `${permission.activityCode}.${permission.action}`
    );

    // Anti-vacuity: the module really does still declare its read surface, so
    // an empty `permissions` array cannot make this pass.
    expect(declared).toContain("region.read");
    expect(declared).toContain("dataset.read");

    for (const action of FORBIDDEN_ACTIONS) {
      expect(declared).not.toContain(`dataset.${action}`);
    }

    // Every remaining action is a read. If a write action is ever added here it
    // must come with a platform-scoped gate, not a tenant permission.
    expect(
      (module!.permissions ?? []).map((permission) => permission.action).sort()
    ).toEqual(["read", "read"]);
  });

  test("no HTTP route exists for activate or rollback", async () => {
    const routes = await Array.fromAsync(
      new Bun.Glob("src/pages/api/v1/idn-regions/**/*.ts").scan({
        cwd: process.cwd()
      })
    );

    // Anti-vacuity: the read endpoints are still there, so a bad glob cannot
    // make the absence assertions below pass.
    expect(routes.length).toBeGreaterThan(0);
    expect(routes).toContain("src/pages/api/v1/idn-regions/datasets/index.ts");

    expect(routes.filter((route) => /activate|rollback/.test(route))).toEqual(
      []
    );
  });

  test("a migration revokes the permissions AND the grants that reference them", async () => {
    const files = (await readdir("sql")).filter((name) =>
      name.endsWith(".sql")
    );
    const revocations = await Promise.all(
      files.map(async (name) => ({
        name,
        body: await readFile(`sql/${name}`, "utf8")
      }))
    );

    const revoking = revocations.filter(
      (file) =>
        /DELETE\s+FROM\s+awcms_permissions/i.test(file.body) &&
        file.body.includes("idn_admin_regions")
    );

    expect(revoking).toHaveLength(1);

    const body = revoking[0]!.body;
    for (const action of FORBIDDEN_ACTIONS) {
      expect(body).toContain(`'${action}'`);
    }

    // The grants must go first: deleting only the catalogue row would either
    // hit the FK or, worse, leave live role grants pointing at nothing. This is
    // the half that actually removes the authority from roles that hold it.
    const grantsAt = body.search(/DELETE\s+FROM\s+awcms_role_permissions/i);
    const catalogueAt = body.search(/DELETE\s+FROM\s+awcms_permissions/i);
    expect(grantsAt).toBeGreaterThanOrEqual(0);
    expect(grantsAt).toBeLessThan(catalogueAt);
  });

  test("the replacement operator jobs are declared and registered", async () => {
    const module = listModules().find(
      (candidate) => candidate.key === "idn_admin_regions"
    );
    const commands = (module!.jobs ?? []).map((job) => job.command);

    expect(commands).toContain("bun run idn-regions:activate");
    expect(commands).toContain("bun run idn-regions:rollback");

    // A declared job whose script does not exist is a command that fails on
    // first use — the module descriptor is not the source of truth for whether
    // the entrypoint is wired.
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
