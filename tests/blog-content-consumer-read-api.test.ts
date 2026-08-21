/**
 * The four consumer read endpoints (Issue #594) — the ones `ahliweb/awcms-astro`
 * calls to render a homepage, an ad slot and a static page.
 *
 * ## What is actually at risk here
 *
 * Not the shape of the JSON. Two things:
 *
 * 1. **That none of them is anonymous.** ADR-0102 settled that "public read"
 *    in this family means the public site's BUILDER authenticates, and
 *    `api-spec-check`'s `ALLOWED_PUBLIC_OPERATIONS` is the list that would have
 *    to name an operation for it to be otherwise. A route that acquired
 *    `security: []` would publish a curated front page before it is a front
 *    page, and an unpublished static page along with it.
 * 2. **That each of them reads the PUBLIC predicate.** The admin list functions
 *    return `private` and `unlisted` rows because an editor needs to see them.
 *    A consumer endpoint reaching for one would publish every private page the
 *    newsroom has, and nothing would report an error — the failure is silent on
 *    both sides of the wire.
 *
 * Pure — no database, no network.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";

const FRAGMENT_PATH = "openapi/modules/blog-content.openapi.yaml";
const SPEC_CHECK_PATH = "scripts/api-spec-check.ts";

const ROUTES: readonly {
  path: string;
  operationId: string;
  guard: string;
}[] = [
  {
    path: "src/pages/api/v1/news-portal/homepage-sections/composed.ts",
    operationId: "newsPortalHomepageComposed",
    guard: "homepage_sections"
  },
  {
    path: "src/pages/api/v1/news-portal/ad-placements/active.ts",
    operationId: "newsPortalAdPlacementsActive",
    guard: "ad_placements"
  },
  {
    path: "src/pages/api/v1/blog/pages/public.ts",
    operationId: "blogPagesPublicList",
    guard: "pages"
  },
  {
    path: "src/pages/api/v1/blog/pages/public/[slug].ts",
    operationId: "blogPagesPublicDetail",
    guard: "pages"
  }
];

describe("every consumer read endpoint is guarded, not anonymous", () => {
  test("each declares its own module's read permission", async () => {
    for (const route of ROUTES) {
      const source = stripComments(await readFile(route.path, "utf8"));

      expect(source).toContain("defineTenantRoute");
      expect(source).toMatch(
        new RegExp(
          `moduleKey:\\s*"blog_content",\\s*activityCode:\\s*"${route.guard}",\\s*action:\\s*"read"`
        )
      );
    }
  });

  test("none of them is on the anonymous allow-list", async () => {
    const specCheck = await readFile(SPEC_CHECK_PATH, "utf8");

    // Proves the corpus is the right file — otherwise the assertions below pass
    // against any string that happens not to contain the ids.
    expect(specCheck).toContain("ALLOWED_PUBLIC_OPERATIONS");

    for (const route of ROUTES) {
      expect(specCheck).not.toContain(route.operationId);
    }
  });

  test("and none of them declares `security: []` in the contract", async () => {
    const fragment = await readFile(FRAGMENT_PATH, "utf8");

    for (const route of ROUTES) {
      const start = fragment.indexOf(`operationId: ${route.operationId}`);

      expect(start).toBeGreaterThan(-1);

      // The operation's own block, up to the next `operationId` or the end.
      const rest = fragment.slice(start + 1);
      const nextOperation = rest.indexOf("operationId:");
      const block = nextOperation === -1 ? rest : rest.slice(0, nextOperation);

      expect(block).not.toContain("security: []");
    }
  });
});

describe("each endpoint reads the public predicate, never the editor's view", () => {
  test("the page list shares its query with the sitemap", async () => {
    const source = await readFile(
      "src/pages/api/v1/blog/pages/public.ts",
      "utf8"
    );

    expect(source).toContain("listPublicBlogPagesForSitemap");
    // The admin list returns `private`/`unlisted` rows on purpose. Reaching for
    // it here is the silent-publication bug this endpoint exists to avoid.
    expect(source).not.toContain("listBlogPages");
    expect(source).not.toContain("listBlogPagesForAdmin");
  });

  test("the page detail shares its query with the public route", async () => {
    const source = await readFile(
      "src/pages/api/v1/blog/pages/public/[slug].ts",
      "utf8"
    );
    const publicRoute = await readFile(
      "src/pages/blog/[tenantCode]/pages/[slug].ts",
      "utf8"
    );

    expect(source).toContain("fetchPublicBlogPageBySlug");
    expect(publicRoute).toContain("fetchPublicBlogPageBySlug");
    expect(source).not.toContain("fetchBlogPageById");
  });

  test("the homepage endpoint resolves through the same composer the site renders", async () => {
    const source = await readFile(
      "src/pages/api/v1/news-portal/homepage-sections/composed.ts",
      "utf8"
    );
    const publicIndex = await readFile(
      "src/pages/blog/[tenantCode]/index.ts",
      "utf8"
    );

    // Returning the CONFIGURATION instead would make the consumer re-implement
    // the publication predicate in another repository.
    expect(source).toContain("composeHomepage");
    expect(publicIndex).toContain("composeHomepage");
    expect(source).not.toContain("listHomepageSections");
  });

  test("the ad endpoint rotates and caps before answering", async () => {
    const source = stripComments(
      await readFile(
        "src/pages/api/v1/news-portal/ad-placements/active.ts",
        "utf8"
      )
    );

    // Handing over the raw pool would put four rotation modes in a second
    // repository, and the one that drifted would over-serve a slot an
    // advertiser paid a fixed number of impressions for.
    expect(source).toContain("selectAdsForRotation");
    expect(source).toContain("AD_PLACEMENT_PRESETS[placementKey].maxItems");
    // Every slot, including the three this repo's templates do not draw.
    expect(source).toContain("AD_PLACEMENT_KEYS");
  });

  test("an unscoped targetId is refused rather than widened to global", async () => {
    const source = stripComments(
      await readFile(
        "src/pages/api/v1/news-portal/ad-placements/active.ts",
        "utf8"
      )
    );

    // Silently widening the scope of an ad query is how a placement booked
    // against one article ends up on all of them.
    expect(source).toContain("targetId requires targetType.");
    expect(source).toContain(
      "targetId must be omitted when targetType is global."
    );
    expect(source).toContain("isAdTargetType");
  });
});
