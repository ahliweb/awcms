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

import { evaluateTenantRouteMigration } from "../scripts/tenant-route-factory-check";

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
