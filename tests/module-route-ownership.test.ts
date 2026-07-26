/**
 * Route ownership resolves to exactly one module, and the resolution rule is
 * the one that made it possible.
 *
 * ## What was broken
 *
 * `basePath` was the only ownership claim, and `tenant_admin` declared
 * `basePath: "/api/v1"` — a prefix of every route in the application. Longest-
 * prefix resolution therefore handed it 36 routes it does not own, including
 * all of `/api/v1/{access,roles,users,abac,identity}` (`identity_access`) and
 * `/api/v1/tenant/modules` (`module_management`), while 30 public routes — the
 * blog, the discovery endpoints, `/search`, the theming CSS — matched nothing.
 *
 * Ownership was not merely wrong, it was *underivable*: any gate built on
 * `basePath` would have accused the wrong module, which is worse than no gate.
 *
 * ## What these pin
 *
 * The two properties the fix depends on: longest-prefix wins (so a SPLIT tree
 * like `/api/v1/tenant` resolves without a special case), and the map stays
 * total and unambiguous against the real registry.
 *
 * Pure — no database, no network.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import {
  collectClaims,
  resolveOwner,
  routeOf
} from "../scripts/validate-module-routes";

describe("prefix resolution", () => {
  test("longest prefix wins, so a split tree resolves without a special case", () => {
    // `/api/v1/tenant` is genuinely split in this repo: `/domains` belongs to
    // `tenant_domain`, `/modules` to `module_management`.
    const { claims } = collectClaims([
      {
        key: "tenant_domain",
        api: { basePath: "/api/v1/tenant/domains", openApiPath: "x" }
      },
      {
        key: "module_management",
        api: {
          basePath: "/api/v1/modules",
          openApiPath: "x",
          routes: ["/api/v1/modules", "/api/v1/tenant/modules"]
        }
      }
    ]);

    expect(resolveOwner("/api/v1/tenant/domains/abc", claims)).toBe(
      "tenant_domain"
    );
    expect(resolveOwner("/api/v1/tenant/modules/abc/enable", claims)).toBe(
      "module_management"
    );
  });

  test("a module with no `routes` falls back to its basePath", () => {
    const { claims } = collectClaims([
      { key: "email", api: { basePath: "/api/v1/email", openApiPath: "x" } }
    ]);

    expect(resolveOwner("/api/v1/email/templates", claims)).toBe("email");
  });

  test("two modules claiming one prefix is reported, not silently resolved", () => {
    const { conflicts } = collectClaims([
      { key: "a", api: { basePath: "/api/v1/thing", openApiPath: "x" } },
      { key: "b", api: { basePath: "/api/v1/thing", openApiPath: "x" } }
    ]);

    expect(conflicts).toEqual(['"/api/v1/thing" is claimed by a, b.']);
  });

  test("an unclaimed route resolves to nobody rather than to the nearest module", () => {
    const { claims } = collectClaims([
      { key: "email", api: { basePath: "/api/v1/email", openApiPath: "x" } }
    ]);

    expect(resolveOwner("/api/v1/unknown", claims)).toBeNull();
  });
});

describe("file path to route", () => {
  test.each([
    ["src/pages/api/v1/offices/index.ts", "/api/v1/offices"],
    ["src/pages/api/v1/offices/[id].ts", "/api/v1/offices/[id]"],
    ["src/pages/blog/[tenantCode]/[slug].ts", "/blog/[tenantCode]/[slug]"],
    ["src/pages/robots.txt.ts", "/robots.txt"],
    ["src/pages/login.astro", "/login"],
    ["src/pages/[...path].ts", "/[...path]"]
  ])("%s -> %s", (file, expected) => {
    expect(routeOf(file)).toBe(expected);
  });
});

describe("the real registry", () => {
  const modules = listModules();
  const { claims, conflicts } = collectClaims(modules);

  test("no two modules claim the same prefix", () => {
    expect(conflicts).toEqual([]);
  });

  test("no module claims a bare `/api/v1` again", () => {
    // The specific regression. A prefix this short cannot be an ownership claim
    // — it matches everything, so it silently annexes every route no other
    // module happens to claim more specifically.
    const overbroad = claims.filter(
      (claim) => claim.prefix === "/api/v1" || claim.prefix === "/"
    );

    expect(overbroad).toEqual([]);
  });

  test("the modules that were wrongly annexed now own their own routes", () => {
    for (const [route, owner] of [
      ["/api/v1/access/policies", "identity_access"],
      ["/api/v1/roles/index", "identity_access"],
      ["/api/v1/users/[id]", "identity_access"],
      ["/api/v1/abac/policies", "identity_access"],
      ["/api/v1/identity/business-scope", "identity_access"],
      ["/api/v1/tenant/modules/x/enable", "module_management"],
      ["/api/v1/tenant/domains/x", "tenant_domain"],
      ["/api/v1/media/enforcement", "media_library"],
      // ...and the three that genuinely are tenant_admin's.
      ["/api/v1/offices/[id]", "tenant_admin"],
      ["/api/v1/settings", "tenant_admin"],
      ["/api/v1/setup/status", "tenant_admin"]
    ] as const) {
      expect(resolveOwner(route, claims)).toBe(owner);
    }
  });

  test("the public surfaces that belonged to nobody now have owners", () => {
    for (const [route, owner] of [
      ["/blog/[tenantCode]/[slug]", "blog_content"],
      ["/robots.txt", "seo_distribution"],
      ["/sitemap.xml", "seo_distribution"],
      ["/feed.json", "seo_distribution"],
      ["/atom.xml", "seo_distribution"],
      ["/search", "site_search"],
      ["/theming/[tenantCode]/tokens.css", "theming"],
      ["/login", "identity_access"]
    ] as const) {
      expect(resolveOwner(route, claims)).toBe(owner);
    }
  });

  test("every module that declares `routes` also keeps a basePath inside them", () => {
    // A `basePath` outside the module's own owned set would mean the displayed
    // prefix and the claimed prefixes describe different modules.
    const stray = modules
      .filter((module) => module.api?.routes)
      .filter(
        (module) =>
          !module.api!.routes!.some((prefix) =>
            module.api!.basePath.startsWith(prefix)
          )
      )
      .map((module) => module.key);

    expect(stray).toEqual([]);
  });
});
