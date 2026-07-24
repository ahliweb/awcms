import { describe, expect, test } from "bun:test";

import {
  buildSeoDocument,
  SEO_RENDER_CONTRACT_VERSION,
  type SeoRenderContext
} from "../src/modules/seo-distribution/domain/seo-document";
import { renderSeoHeadTags } from "../src/modules/seo-distribution/domain/seo-head-rendering";
import { EMPTY_SEO_TENANT_SETTINGS } from "../src/modules/seo-distribution/domain/seo-config";
import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";
import type { SeoResourceFacts } from "../src/modules/_shared/ports/seo-facts-port";

const NOW = "2026-07-24T00:00:00.000Z";

function facts(overrides: Partial<SeoResourceFacts> = {}): SeoResourceFacts {
  return {
    resourceType: "blog_post",
    resourceId: "r1",
    visibility: {
      state: "published",
      noindex: false,
      scheduledPublishAt: null
    },
    canonicalPath: "/blog/hello",
    localeAlternates: [{ locale: "en", path: "/blog/hello" }],
    metadata: { title: "Hello", description: "A post", robots: "index,follow" },
    openGraph: {
      title: "Hello",
      description: "A post",
      imageMediaId: null,
      type: "article"
    },
    jsonLd: [{ "@type": "Article", headline: "Hello" }],
    sitemap: { lastmod: NOW, changefreq: "weekly" },
    feed: { publishedAt: NOW, updatedAt: NOW },
    ...overrides
  };
}

function context(overrides: Partial<SeoRenderContext> = {}): SeoRenderContext {
  return {
    primaryHost: "example.com",
    tenantDisplayName: "Example",
    settings: { ...EMPTY_SEO_TENANT_SETTINGS },
    resolvedImage: null,
    nowIso: NOW,
    ...overrides
  };
}

describe("seo-document builder: contract version pin", () => {
  test("SEO_RENDER_CONTRACT_VERSION matches CAPABILITY_CONTRACT_VERSIONS.seo_facts", () => {
    expect(CAPABILITY_CONTRACT_VERSIONS.seo_facts).toBe(
      SEO_RENDER_CONTRACT_VERSION
    );
  });
});

describe("seo-document builder", () => {
  test("published resource: absolute canonical, index robots, JSON-LD present", () => {
    const result = buildSeoDocument(facts(), context());
    expect(result.renderable).toBe(true);
    if (!result.renderable) return;
    expect(result.document.canonicalUrl).toBe("https://example.com/blog/hello");
    expect(result.document.robots).toBe("index,follow");
    // site-identity WebSite node + the provider's Article node.
    expect(result.document.jsonLd.length).toBeGreaterThanOrEqual(2);
    expect(result.document.jsonLd.some((n) => n["@type"] === "WebSite")).toBe(
      true
    );
    expect(result.document.jsonLd.some((n) => n["@type"] === "Article")).toBe(
      true
    );
    // x-default alternate always appended.
    expect(
      result.document.localeAlternates.some((a) => a.hreflang === "x-default")
    ).toBe(true);
  });

  test("no primary host: canonical degrades to a relative path (never invents a host)", () => {
    const result = buildSeoDocument(facts(), context({ primaryHost: null }));
    expect(result.renderable).toBe(true);
    if (!result.renderable) return;
    expect(result.document.canonicalUrl).toBe("/blog/hello");
  });

  test("draft resource is not renderable", () => {
    const result = buildSeoDocument(
      facts({
        visibility: { state: "draft", noindex: true, scheduledPublishAt: null }
      }),
      context()
    );
    expect(result.renderable).toBe(false);
  });

  test("noindex resource renders with noindex robots and NO structured data", () => {
    const result = buildSeoDocument(
      facts({
        visibility: {
          state: "published",
          noindex: true,
          scheduledPublishAt: null
        },
        metadata: {
          title: "Hello",
          description: "A post",
          robots: "noindex,follow"
        }
      }),
      context()
    );
    expect(result.renderable).toBe(true);
    if (!result.renderable) return;
    expect(result.document.robots.startsWith("noindex")).toBe(true);
    expect(result.document.jsonLd).toHaveLength(0);
  });

  test("tenant-wide noindex forces noindex even on an otherwise-indexable resource", () => {
    const result = buildSeoDocument(
      facts(),
      context({
        settings: { ...EMPTY_SEO_TENANT_SETTINGS, defaultRobotsNoindex: true }
      })
    );
    expect(result.renderable).toBe(true);
    if (!result.renderable) return;
    expect(result.document.robots.startsWith("noindex")).toBe(true);
    expect(result.document.jsonLd).toHaveLength(0);
  });
});

describe("seo head rendering", () => {
  test("emits escaped meta/canonical and JSON-LD without raw < > &", () => {
    const result = buildSeoDocument(
      facts({
        metadata: {
          title: "Hi & <b>bold</b>",
          description: "d",
          robots: "index,follow"
        }
      }),
      context()
    );
    expect(result.renderable).toBe(true);
    if (!result.renderable) return;
    const html = renderSeoHeadTags(result.document);
    expect(html).toContain('<link rel="canonical"');
    expect(html).toContain('<script type="application/ld+json">');
    // The escaped title never re-introduces a raw tag.
    expect(html).toContain("Hi &amp; &lt;b&gt;bold&lt;/b&gt;");
  });
});
