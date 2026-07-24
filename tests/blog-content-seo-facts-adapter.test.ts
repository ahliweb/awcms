import { describe, expect, test } from "bun:test";

import {
  BLOG_POST_SEO_RESOURCE_TYPE,
  blogContentSeoFactsAdapter,
  createBlogContentSeoFactsAdapter,
  deriveVisibility
} from "../src/modules/blog-content/application/seo-facts-port-adapter";

/**
 * A minimal fake `Bun.SQL` tagged-template that ignores the query and returns a
 * fixed rows array — enough to drive the adapter's row→facts mapping without a
 * database (the SQL text is not what these tests assert on; the mapping is).
 */
function fakeTx(rows: unknown[]): Bun.SQL {
  const fn = (async () => rows) as unknown as {
    unsafe: (s: string) => string;
  };
  fn.unsafe = (s: string) => s;
  return fn as unknown as Bun.SQL;
}

type Row = Record<string, unknown>;

const baseRow = (overrides: Row = {}): Row => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Hello",
  slug: "hello",
  excerpt: "An excerpt",
  seo_title: null,
  meta_description: null,
  locale: "en",
  status: "published",
  visibility: "public",
  featured_media_id: null,
  seo_image_media_id: null,
  published_at: new Date("2026-06-01T00:00:00.000Z"),
  scheduled_at: null,
  updated_at: new Date("2026-06-02T00:00:00.000Z"),
  deleted_at: null,
  ...overrides
});

describe("blog-content seo-facts adapter: deriveVisibility mapping", () => {
  test("published + public → indexable (not noindex)", () => {
    const v = deriveVisibility(baseRow() as never);
    expect(v).toEqual({
      state: "published",
      noindex: false,
      scheduledPublishAt: null
    });
  });

  test("published + unlisted → published but noindex", () => {
    const v = deriveVisibility(baseRow({ visibility: "unlisted" }) as never);
    expect(v.state).toBe("published");
    expect(v.noindex).toBe(true);
  });

  test("published + private → private (not public)", () => {
    const v = deriveVisibility(baseRow({ visibility: "private" }) as never);
    expect(v.state).toBe("private");
    expect(v.noindex).toBe(true);
  });

  test("draft/review → draft, noindex", () => {
    expect(deriveVisibility(baseRow({ status: "draft" }) as never).state).toBe(
      "draft"
    );
    expect(deriveVisibility(baseRow({ status: "review" }) as never).state).toBe(
      "draft"
    );
  });

  test("scheduled → scheduled with scheduledPublishAt", () => {
    const v = deriveVisibility(
      baseRow({
        status: "scheduled",
        scheduled_at: new Date("2026-08-01T00:00:00.000Z")
      }) as never
    );
    expect(v.state).toBe("scheduled");
    expect(v.scheduledPublishAt).toBe("2026-08-01T00:00:00.000Z");
  });

  test("soft-deleted (deleted_at set) → deleted regardless of status", () => {
    const v = deriveVisibility(baseRow({ deleted_at: new Date() }) as never);
    expect(v.state).toBe("deleted");
  });

  test("published but future published_at → scheduled (fail-safe)", () => {
    const v = deriveVisibility(
      baseRow({ published_at: new Date("2099-01-01T00:00:00.000Z") }) as never
    );
    expect(v.state).toBe("scheduled");
  });

  test("unknown status → unpublished, noindex (fail closed)", () => {
    const v = deriveVisibility(baseRow({ status: "weird" }) as never);
    expect(v.state).toBe("unpublished");
    expect(v.noindex).toBe(true);
  });

  test("unknown visibility on a published row → private (fail closed)", () => {
    const v = deriveVisibility(baseRow({ visibility: "weird" }) as never);
    expect(v.state).toBe("private");
  });
});

describe("blog-content seo-facts adapter: row → SeoResourceFacts", () => {
  test("published+public row → sitemap + feed present, /blog canonical, Article JSON-LD", async () => {
    const facts = await blogContentSeoFactsAdapter.resolveResourceFacts(
      fakeTx([baseRow()]),
      "t1",
      BLOG_POST_SEO_RESOURCE_TYPE,
      "r1"
    );
    expect(facts).not.toBeNull();
    expect(facts!.resourceType).toBe("blog_post");
    expect(facts!.canonicalPath).toBe("/blog/hello");
    expect(facts!.sitemap).not.toBeNull();
    expect(facts!.feed).not.toBeNull();
    expect(facts!.jsonLd[0]!["@type"]).toBe("Article");
    expect(facts!.openGraph.type).toBe("article");
  });

  test("factory scopes the canonical to the tenant-code base path (→ resolvable /blog/{tenantCode}/{slug})", async () => {
    // The discovery composition root builds the adapter with `/blog/{tenantCode}`
    // so every <loc>/feed link resolves against the shipped `/blog/[tenantCode]/[slug]`
    // route (there is no host-based `/blog/{slug}` route in this base yet).
    const adapter = createBlogContentSeoFactsAdapter("/blog/tenant-a");
    const facts = await adapter.resolveResourceFacts(
      fakeTx([baseRow()]),
      "t1",
      BLOG_POST_SEO_RESOURCE_TYPE,
      "r1"
    );
    expect(facts!.canonicalPath).toBe("/blog/tenant-a/hello");
    // Route-shape guard: a resolvable canonical has exactly 3 path segments
    // (`blog`, tenantCode, slug) — matching `/blog/[tenantCode]/[slug]`.
    expect(facts!.canonicalPath.split("/").filter(Boolean)).toHaveLength(3);
  });

  test("noindex (unlisted) row → sitemap:null and feed:null (no discovery leakage)", async () => {
    const facts = await blogContentSeoFactsAdapter.resolveResourceFacts(
      fakeTx([baseRow({ visibility: "unlisted" })]),
      "t1",
      BLOG_POST_SEO_RESOURCE_TYPE,
      "r1"
    );
    expect(facts).not.toBeNull();
    expect(facts!.sitemap).toBeNull();
    expect(facts!.feed).toBeNull();
    expect(facts!.metadata.robots.startsWith("noindex")).toBe(true);
  });

  test("draft row → sitemap:null and feed:null", async () => {
    const facts = await blogContentSeoFactsAdapter.resolveResourceFacts(
      fakeTx([baseRow({ status: "draft" })]),
      "t1",
      BLOG_POST_SEO_RESOURCE_TYPE,
      "r1"
    );
    expect(facts!.sitemap).toBeNull();
    expect(facts!.feed).toBeNull();
  });

  test("seo_title / seo_image override win over title / featured image", async () => {
    const facts = await blogContentSeoFactsAdapter.resolveResourceFacts(
      fakeTx([
        baseRow({
          seo_title: "SEO Title",
          featured_media_id: "22222222-2222-4222-8222-222222222222",
          seo_image_media_id: "33333333-3333-4333-8333-333333333333"
        })
      ]),
      "t1",
      BLOG_POST_SEO_RESOURCE_TYPE,
      "r1"
    );
    expect(facts!.metadata.title).toBe("SEO Title");
    expect(facts!.openGraph.imageMediaId).toBe(
      "33333333-3333-4333-8333-333333333333"
    );
  });

  test("a non-blog_post resourceType resolves to null (adapter owns only blog_post)", async () => {
    const facts = await blogContentSeoFactsAdapter.resolveResourceFacts(
      fakeTx([baseRow()]),
      "t1",
      "product",
      "r1"
    );
    expect(facts).toBeNull();
  });

  test("summarize returns count + latest timestamps", async () => {
    const summary =
      await blogContentSeoFactsAdapter.summarizePublicResourceFacts!(
        fakeTx([
          {
            count: 3,
            latest_lastmod: new Date("2026-06-02T00:00:00.000Z"),
            latest_published_at: new Date("2026-06-01T00:00:00.000Z")
          }
        ]),
        "t1"
      );
    expect(summary.count).toBe(3);
    expect(summary.latestLastmod).toBe("2026-06-02T00:00:00.000Z");
    expect(summary.latestPublishedAt).toBe("2026-06-01T00:00:00.000Z");
  });
});
