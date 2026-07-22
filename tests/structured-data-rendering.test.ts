import { describe, expect, test } from "bun:test";

import {
  buildNewsArticleJsonLd,
  renderJsonLdScriptTag
} from "../src/modules/blog-content/domain/structured-data-rendering";

const BASE_INPUT = {
  headline: "Headline",
  description: "Description",
  canonicalUrl: "https://example.com/news/my-post",
  image: null,
  datePublished: new Date("2026-01-01T00:00:00.000Z"),
  dateModified: new Date("2026-01-02T00:00:00.000Z"),
  authorName: "Acme",
  publisherName: "Acme",
  publisherLogoUrl: null,
  articleSection: null,
  tags: []
} as const;

describe("buildNewsArticleJsonLd (Issue #649)", () => {
  test("builds a NewsArticle object with @context/@type/headline/description/dates/mainEntityOfPage", () => {
    const result = buildNewsArticleJsonLd(BASE_INPUT);
    expect(result["@context"]).toBe("https://schema.org");
    expect(result["@type"]).toBe("NewsArticle");
    expect(result.headline).toBe("Headline");
    expect(result.description).toBe("Description");
    expect(result.datePublished).toBe("2026-01-01T00:00:00.000Z");
    expect(result.dateModified).toBe("2026-01-02T00:00:00.000Z");
    expect(result.mainEntityOfPage).toEqual({
      "@type": "WebPage",
      "@id": "https://example.com/news/my-post"
    });
  });

  test("author and publisher are Organization (not Person) — no individual editor identity exposed", () => {
    const result = buildNewsArticleJsonLd(BASE_INPUT);
    expect(result.author).toEqual({ "@type": "Organization", name: "Acme" });
    expect((result.publisher as Record<string, unknown>)["@type"]).toBe(
      "Organization"
    );
    expect((result.publisher as Record<string, unknown>).name).toBe("Acme");
  });

  test("omits image entirely when null", () => {
    const result = buildNewsArticleJsonLd(BASE_INPUT);
    expect(result.image).toBeUndefined();
  });

  test("includes image with width/height when provided", () => {
    const result = buildNewsArticleJsonLd({
      ...BASE_INPUT,
      image: {
        url: "https://media.example.test/a.jpg",
        width: 1200,
        height: 630
      }
    });
    expect(result.image).toEqual({
      "@type": "ImageObject",
      url: "https://media.example.test/a.jpg",
      width: 1200,
      height: 630
    });
  });

  test("omits publisher.logo entirely when publisherLogoUrl is null (no fabricated logo)", () => {
    const result = buildNewsArticleJsonLd(BASE_INPUT);
    expect((result.publisher as Record<string, unknown>).logo).toBeUndefined();
  });

  test("includes publisher.logo when publisherLogoUrl is provided", () => {
    const result = buildNewsArticleJsonLd({
      ...BASE_INPUT,
      publisherLogoUrl: "https://media.example.test/logo.png"
    });
    expect((result.publisher as Record<string, unknown>).logo).toEqual({
      "@type": "ImageObject",
      url: "https://media.example.test/logo.png"
    });
  });

  test("omits articleSection/keywords when absent", () => {
    const result = buildNewsArticleJsonLd(BASE_INPUT);
    expect(result.articleSection).toBeUndefined();
    expect(result.keywords).toBeUndefined();
  });

  test("includes articleSection and joins tags into keywords", () => {
    const result = buildNewsArticleJsonLd({
      ...BASE_INPUT,
      articleSection: "Politics",
      tags: ["breaking", "election"]
    });
    expect(result.articleSection).toBe("Politics");
    expect(result.keywords).toBe("breaking, election");
  });
});

describe("renderJsonLdScriptTag (Issue #649)", () => {
  test("wraps the serialized object in a <script type=application/ld+json> tag", () => {
    const tag = renderJsonLdScriptTag({ "@type": "NewsArticle" });
    expect(tag.startsWith('<script type="application/ld+json">')).toBe(true);
    expect(tag.endsWith("</script>")).toBe(true);
    expect(tag).toContain('"@type":"NewsArticle"');
  });

  test("neutralizes a literal </script> sequence inside a string value (HTML break-out, not a JSON-escaping gap)", () => {
    const tag = renderJsonLdScriptTag({
      headline: "</script><script>alert(document.cookie)</script>"
    });
    expect(tag).not.toContain(
      "</script><script>alert(document.cookie)</script>"
    );
    // Only `<` is escaped (sufficient to defeat the HTML tokenizer's
    // `</script` lookup) — the trailing `>` stays literal.
    expect(tag).toContain("\\u003c/script>");
    expect(tag).toContain("\\u003cscript>alert(document.cookie)");
  });

  test("still produces valid JSON once \\u003c is reversed back to <", () => {
    const data = { headline: "A <b>bold</b> headline" };
    const tag = renderJsonLdScriptTag(data);
    const innerJson = tag
      .slice('<script type="application/ld+json">'.length, -"</script>".length)
      .replace(/\\u003c/g, "<");
    expect(JSON.parse(innerJson)).toEqual(data);
  });

  test("standard JSON escaping (quotes/backslashes) still applies", () => {
    const tag = renderJsonLdScriptTag({ headline: 'He said "hi"\\bye' });
    expect(tag).toContain('\\"hi\\"');
    expect(tag).toContain("\\\\bye");
  });
});
