import { describe, expect, test } from "bun:test";

import { renderRobotsTxt } from "../src/modules/seo-distribution/domain/robots-serialization";
import {
  renderSitemapIndex,
  renderUrlset,
  sitemapPageCount,
  type SitemapUrlEntry
} from "../src/modules/seo-distribution/domain/sitemap-serialization";
import {
  renderAtom,
  renderJsonFeed,
  renderRss,
  type FeedChannel,
  type FeedItem
} from "../src/modules/seo-distribution/domain/feed-serialization";
import { SITEMAP_MAX_CHILD_PAGES } from "../src/modules/seo-distribution/domain/discovery-limits";

describe("robots.txt serialization", () => {
  test("normal: disallows /admin/ + /api/ and advertises the absolute sitemap", () => {
    const body = renderRobotsTxt({
      primaryHost: "example.com",
      siteNoindex: false,
      sitemapEnabled: true
    });
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /admin/");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  test("whole-site noindex: Disallow: / and NO sitemap advertised", () => {
    const body = renderRobotsTxt({
      primaryHost: "example.com",
      siteNoindex: true,
      sitemapEnabled: true
    });
    expect(body).toContain("Disallow: /");
    expect(body).not.toContain("Sitemap:");
    expect(body).not.toContain("Disallow: /admin/");
  });

  test("no primary host: omits the Sitemap line (never invents a host)", () => {
    const body = renderRobotsTxt({
      primaryHost: null,
      siteNoindex: false,
      sitemapEnabled: true
    });
    expect(body).not.toContain("Sitemap:");
  });

  test("sitemap disabled: omits the Sitemap line even with a host", () => {
    const body = renderRobotsTxt({
      primaryHost: "example.com",
      siteNoindex: false,
      sitemapEnabled: false
    });
    expect(body).not.toContain("Sitemap:");
  });
});

describe("sitemap serialization", () => {
  test("sitemapPageCount: always ≥1, ceil, capped at the amplification ceiling", () => {
    expect(sitemapPageCount(0, 100)).toBe(1);
    expect(sitemapPageCount(100, 100)).toBe(1);
    expect(sitemapPageCount(101, 100)).toBe(2);
    expect(sitemapPageCount(100_000_000, 100)).toBe(SITEMAP_MAX_CHILD_PAGES);
  });

  test("renderSitemapIndex emits <sitemapindex> with child <loc>s", () => {
    const xml = renderSitemapIndex([
      {
        loc: "https://example.com/sitemap-1.xml",
        lastmod: "2026-07-01T00:00:00.000Z"
      },
      { loc: "https://example.com/sitemap-2.xml", lastmod: null }
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain("<loc>https://example.com/sitemap-1.xml</loc>");
    expect(xml).toContain("<lastmod>2026-07-01T00:00:00.000Z</lastmod>");
    // The null-lastmod child has no <lastmod> element.
    expect(xml).toContain("<loc>https://example.com/sitemap-2.xml</loc>");
  });

  test("renderUrlset XML-escapes a malicious slug so it cannot break out", () => {
    const entry: SitemapUrlEntry = {
      loc: "https://example.com/blog/<script>&amp",
      lastmod: null,
      alternates: [],
      images: []
    };
    const xml = renderUrlset([entry]);
    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;script&gt;");
    expect(xml).toContain("&amp;amp");
  });

  test("renderUrlset emits hreflang alternates + image refs", () => {
    const entry: SitemapUrlEntry = {
      loc: "https://example.com/blog/post",
      lastmod: "2026-07-01T00:00:00.000Z",
      changefreq: "weekly",
      priority: 0.5,
      alternates: [
        { hreflang: "en", href: "https://example.com/blog/post" },
        { hreflang: "x-default", href: "https://example.com/blog/post" }
      ],
      images: ["https://example.com/img.jpg"]
    };
    const xml = renderUrlset([entry]);
    expect(xml).toContain('hreflang="en"');
    expect(xml).toContain('hreflang="x-default"');
    expect(xml).toContain("<changefreq>weekly</changefreq>");
    expect(xml).toContain("<priority>0.5</priority>");
    expect(xml).toContain("<image:loc>https://example.com/img.jpg</image:loc>");
  });
});

describe("feed serialization", () => {
  const channel: FeedChannel = {
    title: "Example Blog",
    description: "Latest posts",
    siteUrl: "https://example.com/",
    feedUrl: "https://example.com/feed.xml",
    language: "en",
    updated: "2026-07-01T00:00:00.000Z",
    logoUrl: null
  };
  const item: FeedItem = {
    id: "https://example.com/blog/hello",
    url: "https://example.com/blog/hello",
    title: "Hello & <world>",
    summary: "A summary",
    contentText: "Plain text body",
    publishedAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    imageUrl: "https://example.com/hero.jpg",
    imageMimeType: "image/jpeg",
    imageLength: 1234
  };

  test("RSS: stable permalink GUID, escaped title, enclosure", () => {
    const xml = renderRss(channel, [item]);
    expect(xml).toContain("<rss version");
    expect(xml).toContain(
      '<guid isPermaLink="true">https://example.com/blog/hello</guid>'
    );
    expect(xml).toContain("<title>Hello &amp; &lt;world&gt;</title>");
    expect(xml).toContain('<enclosure url="https://example.com/hero.jpg"');
    expect(xml).not.toContain("<world>");
  });

  test("Atom: entry id + mandatory feed-level author", () => {
    const xml = renderAtom(channel, [item]);
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
    expect(xml).toContain("<id>https://example.com/blog/hello</id>");
    expect(xml).toContain("<author><name>Example Blog</name></author>");
    expect(xml).toContain("<published>2026-06-01T00:00:00.000Z</published>");
  });

  test("JSON Feed: content_text only (never HTML), stable id, valid JSON", () => {
    const json = renderJsonFeed(channel, [item]);
    const parsed = JSON.parse(json) as {
      version: string;
      items: { id: string; content_text?: string; content_html?: string }[];
    };
    expect(parsed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(parsed.items[0]!.id).toBe("https://example.com/blog/hello");
    expect(parsed.items[0]!.content_text).toBe("Plain text body");
    expect(parsed.items[0]!.content_html).toBeUndefined();
  });

  test("empty feed renders well-formed documents", () => {
    expect(() => renderRss(channel, [])).not.toThrow();
    expect(() => renderAtom(channel, [])).not.toThrow();
    expect(() => JSON.parse(renderJsonFeed(channel, []))).not.toThrow();
  });
});
