/**
 * The migration ledger only shrinks — proven in BOTH directions.
 *
 * `api:tenant-route:check` is only useful if it fails. Two failure directions
 * matter and they fail for opposite reasons:
 *
 * - a NEW route hand-rolls the opening and is not on the list (the regression
 *   the gate exists to stop);
 * - a listed route was migrated but the line stayed (the list rotting into an
 *   off-switch that excuses routes which no longer need excusing).
 *
 * `evaluateTenantRouteMigration` is exported pure precisely so both can be
 * asserted over synthetic contents, without a file tree and without a database.
 * The zero-files guard is exercised through the real filesystem walk in
 * `scripts/`, which the script's own `main()` covers.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  SCAN_ROOTS,
  evaluateTenantRouteMigration,
  remediationFor
} from "../scripts/tenant-route-factory-check";

const DIRECT = `
import { withTenant } from "../../../../lib/database/tenant-context";
export const GET = async () => withTenant(sql, tenantId, async (tx) => ok(tx));
`;

const MIGRATED = `
import { defineTenantRoute } from "../../../../modules/_shared/tenant-route";
export const GET = defineTenantRoute({ workClass: "interactive", authorize: g, handler: h });
`;

describe("tenant-route migration ledger", () => {
  test("a new hand-rolled route that is not listed FAILS", () => {
    const result = evaluateTenantRouteMigration(
      [{ path: "src/pages/api/v1/thing/index.ts", content: DIRECT }],
      []
    );

    expect(result.unlisted).toEqual(["src/pages/api/v1/thing/index.ts"]);
    expect(result.stale).toEqual([]);
  });

  test("a listed route that still hand-rolls PASSES — that is the debt, not a defect", () => {
    const result = evaluateTenantRouteMigration(
      [{ path: "src/pages/api/v1/thing/index.ts", content: DIRECT }],
      ["src/pages/api/v1/thing/index.ts"]
    );

    expect(result.unlisted).toEqual([]);
    expect(result.stale).toEqual([]);
  });

  test("a listed route that was MIGRATED fails until its line is deleted", () => {
    const result = evaluateTenantRouteMigration(
      [{ path: "src/pages/api/v1/thing/index.ts", content: MIGRATED }],
      ["src/pages/api/v1/thing/index.ts"]
    );

    expect(result.unlisted).toEqual([]);
    expect(result.stale).toEqual(["src/pages/api/v1/thing/index.ts"]);
  });

  test("a listed route that was DELETED fails the same way", () => {
    const result = evaluateTenantRouteMigration(
      [],
      ["src/pages/api/v1/gone.ts"]
    );

    expect(result.stale).toEqual(["src/pages/api/v1/gone.ts"]);
  });

  test("a migrated, unlisted route is simply fine", () => {
    const result = evaluateTenantRouteMigration(
      [{ path: "src/pages/api/v1/thing/index.ts", content: MIGRATED }],
      []
    );

    expect(result).toEqual({ unlisted: [], stale: [] });
  });
});

describe("detection is not fooled by prose or by generics", () => {
  test("a docblock mentioning withTenant() is not a call", () => {
    const content = `
/**
 * Historically this called withTenant(sql, tenantId, fn) directly.
 * // withTenant(...) — also not a call
 */
${MIGRATED}
`;

    expect(
      evaluateTenantRouteMigration(
        [{ path: "src/pages/api/v1/thing.ts", content }],
        []
      ).unlisted
    ).toEqual([]);
  });

  test("`withTenant<Response>(` IS detected", () => {
    // Not hypothetical: `_shared/tenant-route.ts` itself writes the generic
    // form, so a pattern that missed it would wave through a copy of the
    // factory's own body pasted into a route.
    const content = `
export const GET = async () => withTenant<Response>(sql, tenantId, async (tx) => ok(tx));
`;

    expect(
      evaluateTenantRouteMigration(
        [{ path: "src/pages/api/v1/thing.ts", content }],
        []
      ).unlisted
    ).toEqual(["src/pages/api/v1/thing.ts"]);
  });
});

/**
 * Issue #424 — the second root.
 *
 * The 32 admin screens were invisible to BOTH `access:chokepoint:check` (root
 * `src/pages/api/v1`) and this gate (root `src/pages/api`), which is what made
 * PROJECT_STATE §4 R3 able to grow unobserved. These assert the extension, not
 * just the ledger contents, because a ledger of 32 correct paths is worthless
 * if the walker never produces a `.astro` file to match them against.
 */
describe("admin screens are a scanned root, not just ledger lines", () => {
  const ADMIN_SCREEN = `---
import { withTenantOrThrow } from "../../lib/database/tenant-context";
const rows = await withTenantOrThrow(sql, ssr.tenantId, async (tx) => load(tx));
---
<h1>Users</h1>
`;

  test("a `.astro` screen opening its own transaction is detected", () => {
    expect(
      evaluateTenantRouteMigration(
        [{ path: "src/pages/admin/thing.astro", content: ADMIN_SCREEN }],
        []
      ).unlisted
    ).toEqual(["src/pages/admin/thing.astro"]);
  });

  test("a listed screen is the debt, and delisting it is what fails", () => {
    const listed = evaluateTenantRouteMigration(
      [{ path: "src/pages/admin/thing.astro", content: ADMIN_SCREEN }],
      ["src/pages/admin/thing.astro"]
    );

    expect(listed).toEqual({ unlisted: [], stale: [] });
  });

  test("`src/pages/admin` is actually walked, with `.astro` among its extensions", () => {
    // Guards the two mutations a ledger test cannot see: pointing the root at a
    // directory that does not exist, or keeping the root while dropping the
    // extension. Either leaves 32 ledger entries intact and scans nothing.
    const admin = SCAN_ROOTS.find((scan) => scan.root === "src/pages/admin");

    expect(admin).toBeDefined();
    expect(admin?.extensions).toContain(".astro");
  });
});

describe("remediation is chosen by root, because the answer differs", () => {
  test("an API route is told to use defineTenantRoute", () => {
    expect(remediationFor("src/pages/api/v1/thing/index.ts")).toContain(
      "defineTenantRoute"
    );
  });

  test("an admin screen is told to use loadAdminScreen, not defineTenantRoute", () => {
    // Named, not merely "not the route factory": until #450 batch 2 this
    // asserted `defineAdminScreen` — the name the program PLAN used for a
    // helper that shipped as `loadAdminScreen`. So the gate's advice named
    // something that does not exist while the test agreed with it, and the
    // prose beside it still said "no factory yet" months after one existed.
    // A remediation string is read by whoever just turned the gate red; one
    // that names a missing helper tells them to stop and wait.
    const advice = remediationFor("src/pages/admin/thing.astro");

    expect(advice).toContain("loadAdminScreen");
    expect(advice).not.toContain("defineTenantRoute(");
  });

  test("the advice names a helper that actually exists", () => {
    // The assertion above can only prove the string is stable, not that it is
    // TRUE — which is exactly how it went stale. This one fails if the helper
    // is ever renamed or removed without the advice following it.
    const helper = readFileSync("src/lib/auth/admin-screen.ts", "utf8");

    expect(helper).toMatch(/export async function loadAdminScreen\b/);
  });

  test("the nested admin directory resolves to the admin root, not the API one", () => {
    // `src/pages/admin/tenant/domains.astro` is the one screen not matched by a
    // top-level `src/pages/admin/*.astro` glob — the same blind spot that made
    // Issue #424 say 31 when the real count is 32.
    expect(remediationFor("src/pages/admin/tenant/domains.astro")).toContain(
      "loadAdminScreen"
    );
  });
});
