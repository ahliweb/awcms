/**
 * The editor preview (Issue #592).
 *
 * ## What is at risk
 *
 * 1. **That it is not a second renderer.** The issue is explicit: a preview that
 *    re-implements the template will drift, and a preview that lies is worse
 *    than no preview, because an editor trusts it and ships the difference.
 * 2. **That a draft cannot leak.** This route renders UNPUBLISHED content
 *    through a public template, deliberately. `X-Robots-Tag: noindex` and
 *    `Cache-Control: private, no-store` are what keep that from becoming a
 *    published article by accident, and the never-cacheable probe is what keeps
 *    a shared cache from holding one.
 * 3. **That it reads, and only reads.** A preview that could publish would be a
 *    publish button wearing a different name.
 *
 * Pure — no database.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import { MUST_NEVER_MATCH } from "../scripts/edge-cache-surfaces-check";
import { matchPublicCacheSurface } from "../src/lib/edge-cache/surface-registry";

const ROUTE = "src/pages/admin/blog/[id]/preview.ts";
const PUBLIC_ROUTE = "src/pages/blog/[tenantCode]/[slug].ts";
const SCREEN = "src/pages/admin/blog.astro";

describe("it renders through the public template, not a copy", () => {
  test("it calls the same two functions the public post route calls", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));
    const publicRoute = stripComments(await readFile(PUBLIC_ROUTE, "utf8"));

    for (const shared of ["renderBlogBodyHtml(", "renderPublicPageShell("]) {
      expect(preview).toContain(shared);
      expect(publicRoute).toContain(shared);
    }
  });

  test("it does not assemble a document of its own", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));

    // A `<html>`/`<head>` here would be the second template the issue forbids.
    // The one inline document is the 403 body, which is not a preview of
    // anything — asserted below rather than excluded by hand-waving.
    expect(preview).not.toContain("<html");
    expect(preview).not.toContain("<head>");
    expect([...preview.matchAll(/<!doctype/gi)].length).toBe(1);
    expect(preview).toContain("<title>Forbidden</title>");
  });

  test("it reads the ADMIN directory, because the point is to see a draft", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));

    expect(preview).toContain("fetchBlogPostById");
    // The public predicate would find nothing — a draft is exactly what it
    // excludes — so reaching for it here would make the feature impossible.
    expect(preview).not.toContain("fetchPublicBlogPostBySlug");
  });
});

describe("a draft cannot escape through this URL", () => {
  test("both headers are present on the success path", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));

    expect(preview).toContain('"x-robots-tag": "noindex, nofollow"');
    expect(preview).toContain('"cache-control": "private, no-store"');
  });

  test("the robots value is fixed, never taken from the post", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));

    // An editor previewing a `public` article must still not have THIS URL
    // indexed — the visibility of the article and the indexability of the
    // preview are different questions.
    expect(preview).toContain('robotsContent: "noindex, nofollow"');
    expect(preview).not.toContain("resolveRobotsMetaContent");
  });

  test("the 403 body carries the same two headers", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));
    const denied = preview.slice(preview.indexOf("status: 403"));

    expect(denied).toContain("x-robots-tag");
    expect(denied).toContain("no-store");
  });

  test("the path is pinned as never cacheable", () => {
    const path = "/admin/blog/11111111-1111-4111-8111-111111111111/preview";

    expect(MUST_NEVER_MATCH).toContain(path);
    // Four segments, so it has the shape of nothing in the registry — but the
    // assertion is that it MATCHES nothing, not that it looks like it would not.
    expect(matchPublicCacheSurface(path)).toBeNull();
  });

  test("no canonical URL and no JSON-LD are emitted", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));

    // Fabricating either would tell a crawler something untrue about a URL that
    // must never be crawled in the first place.
    expect(preview).toContain("canonicalUrl: null");
    expect(preview).toContain("structuredDataJsonLd: null");
  });
});

describe("it reads and only reads", () => {
  test("no INSERT, UPDATE or DELETE anywhere in the file", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));

    for (const verb of ["INSERT INTO", "UPDATE ", "DELETE FROM"]) {
      expect(preview).not.toContain(verb);
    }
  });

  test("it goes through loadAdminScreen on posts.update", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));

    // No new authorization path — the same door the other admin screens use.
    expect(preview).toContain("loadAdminScreen");
    expect(preview).toMatch(
      /moduleKey:\s*"blog_content",\s*activityCode:\s*"posts",\s*action:\s*"update"/
    );
  });

  test("no ad slots and no share buttons", async () => {
    const preview = stripComments(await readFile(ROUTE, "utf8"));

    // Rendering an advertiser's creative into an editor's preview would count
    // an impression nobody saw.
    expect(preview).not.toContain("composeAdSlots");
    expect(preview).not.toContain("renderSocialShareButtonsHtml");
  });

  test("the screen links to it under the same guard as Edit", async () => {
    const screen = stripComments(await readFile(SCREEN, "utf8"));

    expect(screen).toContain("/admin/blog/${post.id}/preview");
    // Offered on live rows only, exactly like Edit: a binned post cannot be
    // updated, so previewing an edit of it would be a dead end.
    expect(screen).toContain("canUpdate && !showsBin");
  });
});
