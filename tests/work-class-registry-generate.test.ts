/**
 * Classification rules for the work-class snapshot.
 *
 * The one that matters most is `defineTenantRoute` recognition. Without it,
 * every route migrated to the factory would silently DISAPPEAR from the
 * snapshot — awcms-micro hit exactly that when it migrated its first module,
 * and a snapshot that quietly loses rows is worse than one that is merely
 * stale, because the diff looks like a deletion someone intended.
 *
 * Pure over file contents; no filesystem, no database.
 */
import { describe, expect, test } from "bun:test";

import {
  classifyRoute,
  compareJobRegistry,
  serialize
} from "../scripts/work-class-registry-generate";

const P = "src/pages/api/v1/thing.ts";

describe("route classification", () => {
  test("a defineTenantRoute route is recorded with its declared class", () => {
    const entry = classifyRoute(
      P,
      `import { defineTenantRoute } from "../../../modules/_shared/tenant-route";
       export const GET = defineTenantRoute({ workClass: "reporting", authorize: g, handler: h });`
    );

    expect(entry).toEqual({
      path: P,
      workClass: "reporting",
      source: "factory"
    });
  });

  test("a factory route is NOT dropped from the snapshot", () => {
    // The regression this test exists for: a generator that only knew
    // `withTenant` would return null here, and the route would vanish.
    expect(
      classifyRoute(
        P,
        `export const GET = defineTenantRoute({ workClass: "maintenance", handler: h });`
      )
    ).not.toBeNull();
  });

  test("withTenant with an explicit literal is `explicit`", () => {
    const entry = classifyRoute(
      P,
      `export const GET = async () => withTenant(sql, t, fn, { workClass: "background_sync" });`
    );

    expect(entry).toEqual({
      path: P,
      workClass: "background_sync",
      source: "explicit"
    });
  });

  test("withTenant with no literal records the DEFAULT, not nothing", () => {
    // The 176 routes this snapshot exists to make visible. Recording them as
    // absent would hide the very thing a capacity reviewer is looking for.
    const entry = classifyRoute(
      P,
      `export const GET = async () => withTenant(sql, t, fn);`
    );

    expect(entry).toEqual({
      path: P,
      workClass: "interactive",
      source: "default"
    });
  });

  test("`withTenant<Response>(` counts as a call", () => {
    expect(
      classifyRoute(
        P,
        `export const GET = async () => withTenant<Response>(a, b, c);`
      )
    ).not.toBeNull();
  });

  test("a file with several handlers reports every distinct class, sorted", () => {
    const entry = classifyRoute(
      P,
      `export const GET = defineTenantRoute({ workClass: "reporting", handler: h });
       export const POST = defineTenantRoute({ workClass: "interactive", handler: h });`
    );

    expect(entry?.workClass).toEqual(["interactive", "reporting"]);
  });

  test("a file that opens no transaction is not a route entry at all", () => {
    expect(
      classifyRoute(P, `export const GET = async () => ok({});`)
    ).toBeNull();
  });

  test("a docblock mentioning withTenant() does not make a file a route", () => {
    expect(
      classifyRoute(
        P,
        `/**
          * Historically this called withTenant(sql, tenantId, fn).
          */
         export const GET = async () => ok({});`
      )
    ).toBeNull();
  });
});

describe("job registry vs ground truth", () => {
  test("a worker script with no registry entry is reported", () => {
    expect(
      compareJobRegistry(["scripts/a.ts", "scripts/b.ts"], ["scripts/a.ts"])
    ).toEqual({ unregistered: ["scripts/b.ts"], stale: [] });
  });

  test("a registry entry for a script that no longer qualifies is reported", () => {
    expect(
      compareJobRegistry(["scripts/a.ts"], ["scripts/a.ts", "scripts/ghost.ts"])
    ).toEqual({ unregistered: [], stale: ["scripts/ghost.ts"] });
  });

  test("agreement reports nothing", () => {
    expect(compareJobRegistry(["scripts/a.ts"], ["scripts/a.ts"])).toEqual({
      unregistered: [],
      stale: []
    });
  });

  test("both directions were REAL on the first run of this generator", () => {
    // Not a hypothetical. The first run found four worker scripts outside the
    // capacity model entirely (comments-retention, edge-cache-purge,
    // site-search-reconcile, tenant-domain-dns-sync — all from the awcms-micro
    // absorption wave) and four entries for scripts that do not exist here.
    const result = compareJobRegistry(
      ["scripts/comments-retention.ts", "scripts/edge-cache-purge.ts"],
      ["scripts/data-exchange-worker.ts"]
    );

    expect(result.unregistered).toHaveLength(2);
    expect(result.stale).toHaveLength(1);
  });
});

describe("serialization is diffable", () => {
  test("stable key order, two-space indent, trailing newline", () => {
    const text = serialize({
      _note: "n",
      routes: [{ path: P, workClass: "interactive", source: "default" }],
      jobs: []
    });

    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "routes": [');
    // No timestamp anywhere: a snapshot that changes on every run cannot be a
    // freshness gate.
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
