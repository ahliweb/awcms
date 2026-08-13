/**
 * PLATFORM-scoped permissions (ADR-0053): the code declaration, the migration
 * that seeds it, and the two places that must never hand one to a tenant.
 *
 * ## What this is defending
 *
 * `idn_admin_regions.dataset.configure`/`.restore` swap the region dataset
 * served to EVERY tenant. They first shipped as ordinary tenant permissions in
 * the global catalogue, which `bootstrapPlatformTenant` grants wholesale to a
 * new tenant's `owner` role — so an ordinary tenant owner held cross-tenant
 * authority, and nothing anywhere disagreed. ADR-0052 deleted them; ADR-0053
 * brings them back behind a scope.
 *
 * The regression that would undo it is small and reads like tidying up:
 * dropping `WHERE scope = 'tenant'` from the blanket grant, or removing
 * `scope: "platform"` from a descriptor because "the migration already says
 * so". Each is one line, and each restores the original defect in full.
 *
 * Pure — no database, no network. Runs in `quality` on every PR.
 */
import { readdir, readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  isPlatformScopedPermissionKey,
  platformScopedPermissionKeys,
  resetPlatformScopeCacheForTests
} from "../src/modules/identity-access/domain/platform-scope";

const SCOPE_COLUMN_MIGRATION = "sql/085_awcms_platform_scoped_permissions.sql";
const BOOTSTRAP = "src/modules/tenant-admin/application/platform-bootstrap.ts";
const BACKFILL_JOB =
  "src/modules/identity-access/application/owner-permission-backfill-job.ts";
const GUARD = "src/modules/identity-access/application/access-guard.ts";

/**
 * Every platform-scoped key this base ships. A new one arriving should be a
 * DECISION, not a surprise — this list is what makes adding one a deliberate
 * edit rather than a side effect, and it already earned that: provisioning
 * (ADR-0054) turned this test red on the commit that introduced it.
 */
const EXPECTED_PLATFORM_KEYS = [
  "idn_admin_regions.dataset.configure",
  "idn_admin_regions.dataset.restore",
  "tenant_admin.tenant_provisioning.read",
  "tenant_admin.tenant_provisioning.create",
  // ADR-0073 — suspending or restoring a tenant changes ANOTHER party's state,
  // the same reasoning ADR-0054 §2 used for provisioning. Adding them here is
  // the deliberate edit this list exists to force.
  "tenant_admin.tenant_lifecycle.disable",
  "tenant_admin.tenant_lifecycle.restore",
  // ADR-0082 — `skip_email_confirmation` mints an account with no proof its
  // holder controls the address. Held at tenant scope, any tenant admin could
  // manufacture one for another company's address; after Gelombang 7 that
  // object is a GLOBAL principal, which is the one place it matters. The
  // deliberate edit, again.
  "identity_access.invitations.configure",
  // ADR-0089 — the partner REGISTRY, and both halves are deliberate. `create`
  // names who may be a partner at all, which is the platform's half of a split
  // that ADR kept apart from the customer's `partner_access.configure`. `read`
  // lists EVERY partner, and a tenant-scoped version of it is the cross-tenant
  // directory the same ADR refused as a table — rebuilt as a permission. The
  // deliberate edit, again.
  "identity_access.partner_registry.read",
  "identity_access.partner_registry.create"
];

describe("platform-scoped permission declaration", () => {
  test("the registry declares exactly the keys this base intends", () => {
    resetPlatformScopeCacheForTests();

    expect([...platformScopedPermissionKeys()].sort()).toEqual(
      [...EXPECTED_PLATFORM_KEYS].sort()
    );
  });

  test("an ordinary tenant permission is not caught by the check", () => {
    // Guards against the opposite failure: a predicate that returns true for
    // everything would make every gate below pass while denying the whole
    // product to every tenant.
    expect(
      isPlatformScopedPermissionKey("tenant_admin.office_management.read")
    ).toBe(false);
    expect(
      isPlatformScopedPermissionKey("idn_admin_regions.dataset.read")
    ).toBe(false);
  });

  test("every platform key is declared by a real module descriptor", () => {
    const declared = new Set<string>();

    for (const module of listModules()) {
      for (const permission of module.permissions ?? []) {
        declared.add(
          `${module.key}.${permission.activityCode}.${permission.action}`
        );
      }
    }

    for (const key of EXPECTED_PLATFORM_KEYS) {
      expect(declared.has(key)).toBe(true);
    }
  });
});

describe("code declaration and migration agree", () => {
  test("every code-declared platform key is seeded with scope 'platform' by SOME migration", async () => {
    // Scans every migration rather than naming one file: platform permissions
    // arrive over time (`sql/085` seeded the first pair, `sql/086` the next),
    // and a test pinned to one file would fail the day a third lands — for a
    // reason unrelated to the invariant it is defending.
    const files = (await readdir("sql")).filter((name) =>
      name.endsWith(".sql")
    );
    const bodies = await Promise.all(
      files.map((name) => readFile(`sql/${name}`, "utf8"))
    );
    const corpus = bodies.join("\n");

    for (const key of EXPECTED_PLATFORM_KEYS) {
      const [moduleKey, activityCode, action] = key.split(".");
      const tuple = `'${moduleKey}', '${activityCode}', '${action}'`;

      // Seeded at all...
      expect(corpus).toContain(tuple);

      // ...and by a migration that also says `'platform'`. A seed without it
      // defaults the column to `'tenant'`, which silently drops the row into
      // the blanket grant every tenant owner receives.
      const seedingFile = bodies.find(
        (body) => body.includes(tuple) && body.includes("'platform'")
      );
      expect(seedingFile).toBeDefined();
    }
  });

  test("the scope column itself is created with a CHECK", async () => {
    const sql = await readFile(SCOPE_COLUMN_MIGRATION, "utf8");

    expect(sql).toContain("ADD COLUMN IF NOT EXISTS scope");
    expect(sql).toContain("awcms_permissions_scope_check");
  });

  test("every platform grant is anchored to the setup tenant, never to all tenants", async () => {
    const files = (await readdir("sql")).filter((name) =>
      name.endsWith(".sql")
    );

    for (const name of files) {
      const body = await readFile(`sql/${name}`, "utf8");
      if (!body.includes("'platform'")) continue;
      if (!/INSERT\s+INTO\s+awcms_role_permissions/i.test(body)) continue;

      // A grant that walked `awcms_tenants` would hand platform authority to
      // every tenant — the defect wearing the new column as a disguise.
      expect(body).toContain("FROM awcms_setup_state");
      expect(body).not.toMatch(/FROM\s+awcms_tenants/i);
    }
  });
});

describe("no path hands a platform permission to a tenant", () => {
  test("the bootstrap blanket grant filters on scope", async () => {
    const source = await readFile(BOOTSTRAP, "utf8");

    // THE line. Without it, every tenant ever created receives every
    // platform permission that exists at that moment.
    expect(source).toContain(
      "SELECT ${tenantId}, ${roleId}, id FROM awcms_permissions"
    );
    expect(source).toContain("WHERE scope = 'tenant'");
  });

  test("the owner backfill never considers a platform permission", async () => {
    const source = await readFile(BACKFILL_JOB, "utf8");

    // This job walks EVERY tenant. An unfiltered catalog read here would grant
    // the pair to all of them at once and report it as a repair.
    expect(source).toContain("FROM awcms_permissions");
    expect(source).toContain("WHERE scope = 'tenant'");
  });
});

describe("the chokepoint enforces it", () => {
  test("the guard refuses a platform permission unless the acting tenant is the platform tenant", async () => {
    const source = await readFile(GUARD, "utf8");

    expect(source).toContain("isPlatformScopedPermissionKey");
    expect(source).toContain("resolvePlatformTenant");
    expect(source).toContain("platform_scope_required");
    // Fail-closed: an unresolvable platform tenant must deny, so the check
    // cannot be written as "deny only when a platform tenant exists and
    // differs".
    expect(source).toContain(
      "!platformTenant || platformTenant.tenantId !== tenantId"
    );
  });

  test("the check runs BEFORE permissions are fetched", async () => {
    const source = await readFile(GUARD, "utf8");

    // Ordering matters: deciding after the grant lookup would make the answer
    // depend on what the caller holds, which is exactly what a leaked grant
    // row changes. Same posture as the machine-credential read-only refusal.
    const gateAt = source.indexOf("platform_scope_required");
    const fetchAt = source.indexOf("const accountPermissionKeys =");

    expect(gateAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(fetchAt);
  });
});

/**
 * ADR-0089, Gelombang 8 PR 8.1 — the union has exactly two members, and a third
 * one is the specific proposal this block exists to refuse.
 *
 * `partner` is the value somebody will propose, because it reads as the obvious
 * way to say "this permission is a partner's". It is not: `scope` governs who
 * may HOLD a permission, partnership governs WHICH OBJECTS it touches. Merging
 * them yields a permission correctly held and executed against the WRONG
 * TENANT — and no RLS policy objects, because the actor really is authenticated
 * somewhere. Reach is modelled as DATA instead (`awcms_partners`,
 * `awcms_partner_managed_tenants`, `sql/116`).
 *
 * Source-pinned because the union is a TYPE: it does not exist at runtime, so
 * there is no value any behavioural test could inspect. Paired with an
 * existence assertion so a rename cannot make it pass vacuously — the
 * cross-wave rule the programme wrote after ADR-0063, where a mutation that
 * moved the RBAC check above the ABAC block left every test green.
 */
describe("the scope union refuses a third member (ADR-0089)", () => {
  const CONTRACT = "src/modules/_shared/module-contract.ts";

  test("`ModulePermissionScope` is exactly `tenant | platform`", async () => {
    const source = await readFile(CONTRACT, "utf8");

    const declaration = source.match(
      /export type ModulePermissionScope =([^;]*);/
    );

    // Rename-proof: if the type is renamed or removed, this fails LOUDLY rather
    // than matching nothing and asserting nothing.
    const union = declaration?.[1];
    if (union === undefined) {
      throw new Error(
        `\`export type ModulePermissionScope\` not found in ${CONTRACT} — renamed or removed, and every assertion below would have passed vacuously.`
      );
    }

    const members = union
      .split("|")
      .map((member) => member.trim().replace(/^"|"$/g, ""))
      .filter((member) => member.length > 0);

    expect(members).toEqual(["tenant", "platform"]);
  });

  test("no descriptor in any module declares a scope outside the union", () => {
    // The type protects the source; this protects against a descriptor that
    // reached the registry through a cast, a JSON import, or a module written
    // before the union narrowed.
    const declared = new Set<string>();

    for (const module of listModules()) {
      for (const permission of module.permissions ?? []) {
        if (permission.scope) declared.add(permission.scope);
      }
    }

    const unexpected = [...declared]
      .filter((scope) => scope !== "tenant" && scope !== "platform")
      .sort();

    expect(unexpected).toEqual([]);
  });
});
