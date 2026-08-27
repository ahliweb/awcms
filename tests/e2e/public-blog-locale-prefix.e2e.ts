/**
 * The spec whose absence let v10.0.0 ship a public blog that answered 404.
 *
 * ADR-0098 made `/{locale}/blog/{tenant}` the CANONICAL spelling of every
 * reader-facing blog surface, and the whole suite went on exercising only the
 * bare spellings — which redirect. So a fully green CI was consistent with an
 * index and every article answering 404 behind that redirect. Nothing here is
 * subtle; it simply had never been fetched.
 *
 * `tests/localised-public-routes.test.ts` guards the STRUCTURE (a prefixed
 * surface has a route). This guards the thing structure cannot prove: that
 * fetching the canonical URL over HTTP actually serves the page.
 *
 * Needs no content fixture. The blog index of a tenant with no posts renders
 * `200` with "No posts yet." — which is exactly the property under test, since
 * the defect answered 404 regardless of what the tenant held. The tenant is the
 * one `ci.yml` bootstraps through the real setup wizard (`tenantCode: "e2e"`).
 */
import { test, expect } from "./support/e2e-read-wave";

const TENANT = "e2e";

test.describe("public blog — locale-prefixed URLs", () => {
  for (const locale of ["id", "en"]) {
    test(`/${locale}/blog/${TENANT} is SERVED, not 404`, async ({ page }) => {
      const response = await page.goto(`/${locale}/blog/${TENANT}`);

      // Exactly 200. The defect this replaces produced a clean, well-formed
      // 404 page, so "did it render something" is not the question.
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toContainText("Blog");
    });
  }

  test("the bare URL redirects INTO a prefixed URL that serves", async ({
    page
  }) => {
    // The pairing is the point: v10.0.0 had a working redirect pointing at a
    // 404, and each half looked healthy when tested alone.
    const response = await page.goto(`/blog/${TENANT}`);

    expect(response?.status()).toBe(200);
    expect(page.url()).toMatch(
      new RegExp(`/(en|id)/blog/${TENANT}(?:[/?#]|$)`)
    );
  });

  test("a segment that is not a supported locale does not serve the tenant", async ({
    page
  }) => {
    // `[locale]` is a dynamic segment, so `/zz/blog/e2e` matches the route
    // pattern. Serving it would publish the tenant's content at an unbounded
    // number of addresses, each its own cache key.
    const response = await page.goto(`/zz/blog/${TENANT}`);

    expect(response?.status()).toBe(404);
  });
});
