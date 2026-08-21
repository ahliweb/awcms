/**
 * Static pages as a search source (Issue #625).
 *
 * ## What was actually wrong
 *
 * Not the descriptor — there was none. Pages had a public route since Issue
 * #617 and were absent from the index, and the reason had quietly changed:
 * the old one ("no public route, so a hit would 404") stopped being true, and
 * the real blocker became a GRANT. `sql/035` gave `awcms_worker` SELECT on
 * `awcms_blog_posts` and nothing else in the module, while
 * `site-search:reconcile` runs as that role and issues one SELECT per
 * descriptor.
 *
 * So a descriptor added without the grant would pass every gate here — the
 * registry check validates SHAPE and never opens a database — and fail at 03:00
 * in a job nobody watches. This pins both halves: the derivation that makes that
 * impossible, and the descriptor agreeing with the route it points at.
 *
 * Pure — reads the registry and `sql/`, no database.
 */
import { describe, expect, test } from "bun:test";

import { findMissingSourceGrants } from "../scripts/site-search-sources-check";
import { listModules } from "../src/modules";
import { validateSearchSourceRegistry } from "../src/modules/site-search/domain/search-source-registry";

const GRANTED = `
  -- A comment mentioning GRANT SELECT ON awcms_blog_pages TO awcms_worker.
  GRANT SELECT ON awcms_blog_pages TO awcms_worker;
`;

const NOT_GRANTED = `
  GRANT SELECT, UPDATE ON awcms_blog_posts TO awcms_worker;
`;

const PAGE_SOURCE = [
  { key: "blog_content.page", tableName: "awcms_blog_pages" }
];

describe("the reconcile job's read privilege is derived, not remembered", () => {
  test("a descriptor whose table the worker cannot read is reported", () => {
    expect(findMissingSourceGrants(PAGE_SOURCE, NOT_GRANTED)).toEqual([
      { descriptorKey: "blog_content.page", tableName: "awcms_blog_pages" }
    ]);
  });

  test("a granted table is not reported", () => {
    expect(findMissingSourceGrants(PAGE_SOURCE, GRANTED)).toEqual([]);
  });

  test("a grant named only inside a comment does not count", () => {
    // The scanner strips comments before matching. Without that, the prose in
    // `sql/136` explaining the grant would satisfy the check that the grant
    // exists — a gate going green on its own documentation, which has happened
    // in this repo more than once.
    const commentOnly = `
      -- GRANT SELECT ON awcms_blog_pages TO awcms_worker;
      SELECT 1;
    `;

    expect(findMissingSourceGrants(PAGE_SOURCE, commentOnly)).toEqual([
      { descriptorKey: "blog_content.page", tableName: "awcms_blog_pages" }
    ]);
  });

  test("the live registry passes against the real migrations", async () => {
    const result = validateSearchSourceRegistry(listModules());

    expect(result.valid).toBe(true);

    const migrationSql = await Bun.file(
      "sql/136_awcms_blog_pages_worker_select.sql"
    ).text();
    const posts = result.descriptors.filter(
      (descriptor) => descriptor.tableName === "awcms_blog_pages"
    );

    expect(posts).toHaveLength(1);
    expect(findMissingSourceGrants(posts, migrationSql)).toEqual([]);
  });
});

describe("the page descriptor agrees with the route it points at", () => {
  const descriptor = validateSearchSourceRegistry(
    listModules()
  ).descriptors.find((entry) => entry.key === "blog_content.page");

  test("it exists and names the page table", () => {
    expect(descriptor).toBeDefined();
    expect(descriptor?.tableName).toBe("awcms_blog_pages");
    expect(descriptor?.resourceType).toBe("blog_page");
  });

  test("its url template is the route that actually serves a page", async () => {
    expect(descriptor?.urlTemplate).toBe("/blog/:tenantCode/pages/:slug");

    // The file whose existence makes that template resolvable. A template
    // pointing at a route that does not exist produces search hits that 404 —
    // the exact objection that kept pages out of the index before #617.
    expect(
      await Bun.file("src/pages/blog/[tenantCode]/pages/[slug].ts").exists()
    ).toBe(true);
  });

  test("it uses the LISTING predicate, never the detail one", () => {
    // `fetchPublicBlogPageBySlug` also serves `unlisted`, deliberately: that
    // tier means reachable by direct link and absent from every listing. A
    // search result IS a listing, so indexing on the detail predicate would
    // publish exactly the pages an editor marked as not-to-be-listed.
    expect(descriptor?.publicationFilter?.equals).toEqual({
      status: "published",
      visibility: "public"
    });
    expect(descriptor?.publicationFilter?.nullColumns).toEqual(["deleted_at"]);
    expect(descriptor?.publicationFilter?.timeReachedColumns).toEqual([
      "published_at"
    ]);
  });

  test("pages are searchable but deliberately not commentable", () => {
    const blogContent = listModules().find(
      (module) => module.key === "blog_content"
    );

    // Asymmetric on purpose — a comment thread under the Pedoman Media Siber
    // reads as qualifying a published standard. Recorded here so a future
    // symmetry pass finds a decision rather than an oversight.
    expect(
      blogContent?.commentableResources?.some(
        (entry) => entry.resourceType === "blog_page"
      )
    ).toBeFalsy();
    expect(
      blogContent?.searchSources?.some(
        (entry) => entry.resourceType === "blog_page"
      )
    ).toBe(true);
  });
});
