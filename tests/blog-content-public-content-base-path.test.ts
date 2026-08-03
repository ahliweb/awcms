/**
 * ADR-0059 §C — `resolvePublicContentBasePath`, plus the file-level half of the
 * invariant it exists for: **never advertise a URL nothing serves.**
 *
 * The rule is pure, so it is asserted directly rather than inferred from a
 * rendered sitemap. The second half — that the base path it returns is a route
 * this build actually has — is asserted against `src/pages` itself, because
 * that is exactly the coupling a constant cannot express: changing
 * `HOST_RESOLVED_PUBLIC_BASE_PATH` to `/blog` typechecks, renders, and produces
 * canonical URLs for a route file that does not exist.
 */
import { existsSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  HOST_RESOLVED_PUBLIC_BASE_PATH,
  resolvePublicContentBasePath
} from "../src/modules/blog-content/application/public-route-settings";

const TENANT_CODE = "tenant-a";

describe("resolvePublicContentBasePath (ADR-0059 §C)", () => {
  test("host-resolved family live -> the host-resolved base path, tenant code absent", () => {
    expect(
      resolvePublicContentBasePath(
        { publicRouteMode: "domain_default", legacyTenantRouteEnabled: true },
        TENANT_CODE
      )
    ).toBe(HOST_RESOLVED_PUBLIC_BASE_PATH);

    // The legacy switch does not enter the decision while the host-resolved
    // family serves: a tenant on its own domain gets clean URLs even when the
    // legacy family is also reachable.
    expect(
      resolvePublicContentBasePath(
        { publicRouteMode: "domain_default", legacyTenantRouteEnabled: false },
        TENANT_CODE
      )
    ).toBe(HOST_RESOLVED_PUBLIC_BASE_PATH);
  });

  test("host-resolved family off, legacy on -> the ADR-0009 path-scoped base", () => {
    expect(
      resolvePublicContentBasePath(
        { publicRouteMode: "disabled", legacyTenantRouteEnabled: true },
        TENANT_CODE
      )
    ).toBe("/blog/tenant-a");
  });

  test("both families off -> null, so nothing is advertised at all", () => {
    expect(
      resolvePublicContentBasePath(
        { publicRouteMode: "disabled", legacyTenantRouteEnabled: false },
        TENANT_CODE
      )
    ).toBeNull();
  });
});

describe("every advertised base path has a route file (ADR-0059 §A)", () => {
  const cases: readonly { path: string; file: string }[] = [
    { path: HOST_RESOLVED_PUBLIC_BASE_PATH, file: "index.ts" },
    { path: `${HOST_RESOLVED_PUBLIC_BASE_PATH}/{slug}`, file: "[slug].ts" },
    {
      path: `${HOST_RESOLVED_PUBLIC_BASE_PATH}/category/{slug}`,
      file: "category/[slug].ts"
    },
    {
      path: `${HOST_RESOLVED_PUBLIC_BASE_PATH}/tag/{slug}`,
      file: "tag/[slug].ts"
    }
  ];

  for (const { path, file } of cases) {
    test(`${path} is served by src/pages${HOST_RESOLVED_PUBLIC_BASE_PATH}/${file}`, () => {
      expect(
        existsSync(`src/pages${HOST_RESOLVED_PUBLIC_BASE_PATH}/${file}`)
      ).toBe(true);
    });
  }

  test("the legacy base path a disabled host family falls back to is served too", () => {
    const legacy = resolvePublicContentBasePath(
      { publicRouteMode: "disabled", legacyTenantRouteEnabled: true },
      TENANT_CODE
    );

    expect(legacy).toBe("/blog/tenant-a");
    expect(existsSync("src/pages/blog/[tenantCode]/index.ts")).toBe(true);
    expect(existsSync("src/pages/blog/[tenantCode]/[slug].ts")).toBe(true);
  });

  /**
   * The collision this ADR is built around (§3): a host-resolved detail route
   * under `/blog` would share Astro's `/blog/[param]` pattern with the ADR-0009
   * listing route, which Astro today resolves by silently letting one shadow
   * the other ("A collision will result in a hard error in following versions
   * of Astro"). The constant must therefore stay off `/blog`.
   */
  test("the host-resolved family does not live under /blog", () => {
    expect(HOST_RESOLVED_PUBLIC_BASE_PATH.startsWith("/blog")).toBe(false);
    expect(existsSync("src/pages/blog/[slug].ts")).toBe(false);
  });
});
