/**
 * `resolvePublicContentBasePath`, plus the file-level half of the invariant it
 * exists for: **never advertise a URL nothing serves.**
 *
 * ADR-0059 §C gave this rule three rows, because there were two public route
 * families to choose between. [ADR-0071](../docs/adr/0071-kosakata-url-publik-dibelah-blog-di-sini-news-di-awcms-astro.md)
 * §4 removed the host-resolved `/news/**` family — that vocabulary belongs to
 * `ahliweb/awcms-astro` now — so the rule is down to two rows and the invariant
 * is the whole of it. ADR-0071 §3 restates that invariant on purpose, precisely
 * so it did not lapse when ADR-0059 was superseded; these tests are what keeps
 * that restatement honest.
 *
 * The rule is pure, so it is asserted directly rather than inferred from a
 * rendered sitemap. The second half — that the base path it returns is a route
 * this build actually has — is asserted against `src/pages` itself, because
 * that is exactly the coupling a constant cannot express: returning a path for
 * a route file that does not exist typechecks, renders, and produces canonical
 * URLs that 404.
 */
import { existsSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { resolvePublicContentBasePath } from "../src/modules/blog-content/application/public-route-settings";

const TENANT_CODE = "tenant-a";

describe("resolvePublicContentBasePath", () => {
  test("legacy family live -> /blog/{tenantCode}", () => {
    expect(
      resolvePublicContentBasePath(
        { legacyTenantRouteEnabled: true },
        TENANT_CODE
      )
    ).toBe(`/blog/${TENANT_CODE}`);
  });

  test("legacy family off -> null, NOT a path", () => {
    expect(
      resolvePublicContentBasePath(
        { legacyTenantRouteEnabled: false },
        TENANT_CODE
      )
    ).toBeNull();
  });

  /**
   * The row that carries the rule. A tenant that switched its public surface
   * off has no content URL at all, so the correct sitemap is an EMPTY one — not
   * one full of links that are certain to 404. Before ADR-0071 this was the
   * "both families off" row; now it is simply "the family is off", and the
   * consequence is identical.
   */
  test("null means the sitemap is empty, and that is the point", () => {
    const basePath = resolvePublicContentBasePath(
      { legacyTenantRouteEnabled: false },
      TENANT_CODE
    );

    expect(basePath).toBeNull();
    expect(typeof basePath).not.toBe("string");
  });

  test("the tenant code is carried into the path verbatim", () => {
    expect(
      resolvePublicContentBasePath(
        { legacyTenantRouteEnabled: true },
        "other-t"
      )
    ).toBe("/blog/other-t");
  });
});

describe("the advertised base path is a route this build actually serves", () => {
  const cases = [
    { path: "/blog/{tenantCode}", file: "index.ts" },
    { path: "/blog/{tenantCode}/{slug}", file: "[slug].ts" }
  ] as const;

  for (const { path, file } of cases) {
    test(`${path} is served by src/pages/blog/[tenantCode]/${file}`, () => {
      expect(existsSync(`src/pages/blog/[tenantCode]/${file}`)).toBe(true);
    });
  }

  /**
   * The other direction, and the one that would have gone unnoticed: ADR-0071
   * §4 removed `src/pages/news/` entirely. If a later change reinstates a route
   * file there, this repo is serving a vocabulary its own ADR assigns to the
   * other repo. `tests/url-vocabulary-split.test.ts` gates the ADR marker
   * against the same directory; this asserts the plain fact next to the rule
   * that used to point at it.
   */
  test("src/pages/news no longer exists (ADR-0071 §4)", () => {
    expect(existsSync("src/pages/news")).toBe(false);
  });
});
