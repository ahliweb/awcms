import { describe, expect, test } from "bun:test";

import {
  collectRenderableGalleryMediaObjectIds,
  collectRenderableVideoNewsThumbnailMediaObjectIds,
  renderContentJsonToHtml
} from "../src/modules/blog-content/domain/content-block-rendering";
import {
  deriveArticleSectionAndTags,
  resolveCanonicalUrl,
  resolveMetaDescription,
  resolveOgImageUrl,
  resolveOgLocale,
  resolveRobotsMetaContent,
  resolveSeoTitle
} from "../src/modules/blog-content/domain/seo-rendering";
import {
  renderPaginationNavHtml,
  renderPostSummaryListHtml,
  renderPublicPageShell
} from "../src/modules/blog-content/domain/public-page-rendering";
import { escapeHtml } from "../src/lib/html/escape";

describe("escapeHtml", () => {
  test("escapes all five special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("renderContentJsonToHtml", () => {
  test("renders a paragraph block, escaped", () => {
    const html = renderContentJsonToHtml({
      blocks: [{ type: "paragraph", text: "<script>alert(1)</script>" }]
    });
    expect(html).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });

  test("renders a heading with a valid level", () => {
    const html = renderContentJsonToHtml({
      blocks: [{ type: "heading", level: 2, text: "Hello" }]
    });
    expect(html).toBe("<h2>Hello</h2>");
  });

  test("skips a heading with an out-of-range level", () => {
    const html = renderContentJsonToHtml({
      blocks: [{ type: "heading", level: 9, text: "Hello" }]
    });
    expect(html).toBe("");
  });

  test("renders an unordered and ordered list", () => {
    const unordered = renderContentJsonToHtml({
      blocks: [{ type: "list", items: ["a", "b"] }]
    });
    expect(unordered).toBe("<ul><li>a</li><li>b</li></ul>");

    const ordered = renderContentJsonToHtml({
      blocks: [{ type: "list", ordered: true, items: ["a"] }]
    });
    expect(ordered).toBe("<ol><li>a</li></ol>");
  });

  test("renders a quote block, escaped", () => {
    const html = renderContentJsonToHtml({
      blocks: [{ type: "quote", text: "To be & not to be" }]
    });
    expect(html).toBe("<blockquote>To be &amp; not to be</blockquote>");
  });

  test("silently skips an unknown block type", () => {
    const html = renderContentJsonToHtml({
      blocks: [{ type: "raw_html", html: "<script>evil()</script>" }]
    });
    expect(html).toBe("");
  });

  test("never emits a script/iframe/embed/object tag regardless of input", () => {
    const html = renderContentJsonToHtml({
      blocks: [
        { type: "paragraph", text: "<iframe src=evil></iframe>" },
        { type: "list", items: ["<embed src=evil>", "<object data=evil>"] },
        { type: "quote", text: "<img src=x onerror=alert(1)>" }
      ]
    });
    // Safety property: every "<" that came from user content is escaped to
    // "&lt;" — so no *unescaped* opening tag can ever reach the browser's
    // HTML parser, regardless of what tag/attribute name appears inside
    // the now-inert escaped text (e.g. "&lt;img ... onerror=...&gt;" is
    // literal text, not a parsed <img> element).
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<embed");
    expect(html).not.toContain("<object");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;iframe");
    expect(html).toContain("&lt;img");
  });

  test("returns empty string when blocks is missing or not an array", () => {
    expect(renderContentJsonToHtml({})).toBe("");
    expect(renderContentJsonToHtml({ blocks: "not-an-array" })).toBe("");
  });

  test("renders a gallery block with image and video items (Issue #542)", () => {
    const html = renderContentJsonToHtml({
      blocks: [
        {
          type: "gallery",
          items: [
            {
              mediaType: "image",
              url: "https://cdn.example.com/a.jpg",
              caption: "A & B"
            },
            { mediaType: "video", url: "https://cdn.example.com/a.mp4" }
          ]
        }
      ]
    });
    expect(html).toContain('<img src="https://cdn.example.com/a.jpg"');
    expect(html).toContain("A &amp; B");
    expect(html).toContain(
      '<video src="https://cdn.example.com/a.mp4" controls>'
    );
  });

  test("skips a gallery item with an unsafe/relative URL", () => {
    const html = renderContentJsonToHtml({
      blocks: [
        {
          type: "gallery",
          items: [
            { mediaType: "image", url: "javascript:alert(1)" },
            { mediaType: "image", url: "/relative/path.jpg" }
          ]
        }
      ]
    });
    expect(html).toBe("");
  });

  test("skips a gallery item with an invalid mediaType", () => {
    const html = renderContentJsonToHtml({
      blocks: [
        {
          type: "gallery",
          items: [{ mediaType: "audio", url: "https://cdn.example.com/a.mp3" }]
        }
      ]
    });
    expect(html).toBe("");
  });

  test("returns null for an empty gallery items array", () => {
    expect(
      renderContentJsonToHtml({ blocks: [{ type: "gallery", items: [] }] })
    ).toBe("");
  });

  test("Issue #636: renders an image gallery item using mediaObjectId, resolved via the resolvedMediaUrls map", () => {
    const contentJson = {
      blocks: [
        {
          type: "gallery",
          items: [
            {
              mediaType: "image",
              mediaObjectId: "11111111-1111-1111-1111-111111111111",
              caption: "R2 image"
            }
          ]
        }
      ]
    };
    const resolvedMediaUrls = new Map([
      [
        "11111111-1111-1111-1111-111111111111",
        "https://media.example.test/news-media/tenant/2026/07/a.jpg"
      ]
    ]);

    const html = renderContentJsonToHtml(contentJson, resolvedMediaUrls);
    expect(html).toContain(
      '<img src="https://media.example.test/news-media/tenant/2026/07/a.jpg"'
    );
    expect(html).toContain("R2 image");
  });

  test("Issue #636: skips an image gallery item whose mediaObjectId is not in resolvedMediaUrls (unresolved/unsafe/absent — never a broken <img>)", () => {
    const contentJson = {
      blocks: [
        {
          type: "gallery",
          items: [
            {
              mediaType: "image",
              mediaObjectId: "22222222-2222-2222-2222-222222222222"
            }
          ]
        }
      ]
    };

    expect(renderContentJsonToHtml(contentJson, new Map())).toBe("");
    expect(renderContentJsonToHtml(contentJson)).toBe("");
  });

  test("Issue #636: mediaObjectId takes precedence over url when both happen to be present", () => {
    const contentJson = {
      blocks: [
        {
          type: "gallery",
          items: [
            {
              mediaType: "image",
              mediaObjectId: "33333333-3333-3333-3333-333333333333",
              url: "https://untrusted.example.com/a.jpg"
            }
          ]
        }
      ]
    };
    const resolvedMediaUrls = new Map([
      [
        "33333333-3333-3333-3333-333333333333",
        "https://media.example.test/trusted.jpg"
      ]
    ]);

    const html = renderContentJsonToHtml(contentJson, resolvedMediaUrls);
    expect(html).toContain('src="https://media.example.test/trusted.jpg"');
    expect(html).not.toContain("untrusted.example.com");
  });

  test("Issue #639: renders a video_news block as a safe youtube-nocookie.com iframe embed, never the raw stored fields", () => {
    const html = renderContentJsonToHtml({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          title: "Breaking <news>",
          caption: "A & caption",
          sourceLabel: "Reuters"
        }
      ]
    });
    expect(html).toContain(
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"'
    );
    expect(html).toContain("Breaking &lt;news&gt;");
    expect(html).toContain("A &amp; caption");
    expect(html).toContain("Reuters");
    expect(html).not.toContain("<news>");
  });

  test("Issue #639: renders the resolved custom thumbnail <img> when thumbnailMediaObjectId resolves", () => {
    const contentJson = {
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          thumbnailMediaObjectId: "11111111-1111-1111-1111-111111111111"
        }
      ]
    };
    const resolvedMediaUrls = new Map([
      [
        "11111111-1111-1111-1111-111111111111",
        "https://media.example.test/news-media/tenant/2026/07/thumb.jpg"
      ]
    ]);

    const html = renderContentJsonToHtml(contentJson, resolvedMediaUrls);
    expect(html).toContain(
      '<img class="video-news-thumbnail" src="https://media.example.test/news-media/tenant/2026/07/thumb.jpg"'
    );
    expect(html).toContain(
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"'
    );
  });

  test("Issue #639: omits the thumbnail <img> entirely when thumbnailMediaObjectId does not resolve", () => {
    const html = renderContentJsonToHtml({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          thumbnailMediaObjectId: "22222222-2222-2222-2222-222222222222"
        }
      ]
    });
    expect(html).not.toContain("video-news-thumbnail");
    expect(html).toContain(
      '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"'
    );
  });

  test("Issue #639: skips a video_news block with an unsupported provider or malformed videoId (defense-in-depth — write-time validation should already reject these)", () => {
    expect(
      renderContentJsonToHtml({
        blocks: [
          { type: "video_news", provider: "vimeo", videoId: "dQw4w9WgXcQ" }
        ]
      })
    ).toBe("");
    expect(
      renderContentJsonToHtml({
        blocks: [{ type: "video_news", provider: "youtube", videoId: "bad-id" }]
      })
    ).toBe("");
  });

  test("Issue #639: never renders a raw iframe/script from stored content — only its own fixed embed markup", () => {
    const html = renderContentJsonToHtml({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          title: '"><script>alert(1)</script>'
        }
      ]
    });
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("collectRenderableVideoNewsThumbnailMediaObjectIds (Issue #639)", () => {
  test("empty for content with no video_news blocks", () => {
    expect(
      collectRenderableVideoNewsThumbnailMediaObjectIds({
        blocks: [{ type: "paragraph", text: "hi" }]
      })
    ).toEqual([]);
  });

  test("collects thumbnailMediaObjectId, ignoring blocks without one", () => {
    const ids = collectRenderableVideoNewsThumbnailMediaObjectIds({
      blocks: [
        {
          type: "video_news",
          provider: "youtube",
          videoId: "dQw4w9WgXcQ",
          thumbnailMediaObjectId: "11111111-1111-1111-1111-111111111111"
        },
        { type: "video_news", provider: "youtube", videoId: "dQw4w9WgXcR" }
      ]
    });
    expect(ids).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });
});

describe("collectRenderableGalleryMediaObjectIds (Issue #636)", () => {
  test("empty for content with no gallery blocks", () => {
    expect(
      collectRenderableGalleryMediaObjectIds({
        blocks: [{ type: "paragraph", text: "hi" }]
      })
    ).toEqual([]);
  });

  test("collects mediaObjectId from image items only, ignoring video items and url-based items", () => {
    const ids = collectRenderableGalleryMediaObjectIds({
      blocks: [
        {
          type: "gallery",
          items: [
            {
              mediaType: "image",
              mediaObjectId: "11111111-1111-1111-1111-111111111111"
            },
            { mediaType: "video", mediaObjectId: "should-be-ignored" },
            { mediaType: "image", url: "https://cdn.example.com/a.jpg" }
          ]
        }
      ]
    });
    expect(ids).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });

  test("deduplicates repeated mediaObjectId references across blocks", () => {
    const ids = collectRenderableGalleryMediaObjectIds({
      blocks: [
        {
          type: "gallery",
          items: [
            {
              mediaType: "image",
              mediaObjectId: "11111111-1111-1111-1111-111111111111"
            }
          ]
        },
        {
          type: "gallery",
          items: [
            {
              mediaType: "image",
              mediaObjectId: "11111111-1111-1111-1111-111111111111"
            }
          ]
        }
      ]
    });
    expect(ids).toEqual(["11111111-1111-1111-1111-111111111111"]);
  });
});

describe("resolveSeoTitle", () => {
  test("prefers seoTitle when present", () => {
    expect(
      resolveSeoTitle({ seoTitle: "SEO Title", title: "Post Title" })
    ).toBe("SEO Title");
  });

  test("falls back to title when seoTitle is null/empty", () => {
    expect(resolveSeoTitle({ seoTitle: null, title: "Post Title" })).toBe(
      "Post Title"
    );
    expect(resolveSeoTitle({ seoTitle: "  ", title: "Post Title" })).toBe(
      "Post Title"
    );
  });
});

describe("resolveMetaDescription", () => {
  test("prefers metaDescription, then excerpt, then a generated summary", () => {
    expect(
      resolveMetaDescription({
        metaDescription: "Meta desc",
        excerpt: "Excerpt",
        contentText: "Body text"
      })
    ).toBe("Meta desc");

    expect(
      resolveMetaDescription({
        metaDescription: null,
        excerpt: "Excerpt",
        contentText: "Body text"
      })
    ).toBe("Excerpt");

    expect(
      resolveMetaDescription({
        metaDescription: null,
        excerpt: null,
        contentText: "Body text here."
      })
    ).toBe("Body text here.");
  });

  test("truncates a long generated summary at a word boundary with an ellipsis", () => {
    const longText = "word ".repeat(50).trim();
    const description = resolveMetaDescription({
      metaDescription: null,
      excerpt: null,
      contentText: longText
    });
    expect(description.length).toBeLessThanOrEqual(164);
    expect(description.endsWith("...")).toBe(true);
  });
});

describe("resolveCanonicalUrl", () => {
  test("uses the post's canonicalUrl when it is a safe absolute URL", () => {
    const url = resolveCanonicalUrl(
      { canonicalUrl: "https://example.com/custom" },
      "https://example.com/blog/acme/self"
    );
    expect(url).toBe("https://example.com/custom");
  });

  test("falls back to selfUrl when canonicalUrl is null", () => {
    const url = resolveCanonicalUrl(
      { canonicalUrl: null },
      "https://example.com/blog/acme/self"
    );
    expect(url).toBe("https://example.com/blog/acme/self");
  });

  test("ignores an unsafe canonicalUrl (javascript:) and falls back to selfUrl", () => {
    const url = resolveCanonicalUrl(
      { canonicalUrl: "javascript:alert(1)" },
      "https://example.com/blog/acme/self"
    );
    expect(url).toBe("https://example.com/blog/acme/self");
  });

  test("returns null when neither canonicalUrl nor selfUrl is safe", () => {
    const url = resolveCanonicalUrl({ canonicalUrl: null }, "not-a-url");
    expect(url).toBeNull();
  });
});

describe("renderPublicPageShell", () => {
  test("escapes title/description and includes a canonical link when present", () => {
    const html = renderPublicPageShell({
      title: "<script>alert(1)</script>",
      description: "desc",
      canonicalUrl: "https://example.com/post",
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain(
      '<link rel="canonical" href="https://example.com/post" />'
    );
    expect(html).toContain('<html lang="en">');
  });

  test("omits the canonical link entirely when canonicalUrl is null", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(html).not.toContain('rel="canonical"');
  });

  test("Issue #636: omits og:image/twitter:image entirely when ogImageUrl is null/absent", () => {
    const withoutOption = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(withoutOption).not.toContain("og:image");
    expect(withoutOption).not.toContain("twitter:image");

    const withNull = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en",
      ogImageUrl: null
    });
    expect(withNull).not.toContain("og:image");
  });

  test("Issue #636: emits escaped og:image/twitter:image tags when ogImageUrl is present", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en",
      ogImageUrl: "https://media.example.test/a.jpg?x=1&y=2",
      ogImageAlt: "A <b>photo</b>"
    });
    expect(html).toContain(
      '<meta property="og:image" content="https://media.example.test/a.jpg?x=1&amp;y=2" />'
    );
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image" />'
    );
    expect(html).toContain(
      '<meta name="twitter:image" content="https://media.example.test/a.jpg?x=1&amp;y=2" />'
    );
    expect(html).toContain(
      '<meta property="og:image:alt" content="A &lt;b&gt;photo&lt;/b&gt;" />'
    );
  });

  test("Issue #636: omits og:image:alt when ogImageAlt is not provided", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en",
      ogImageUrl: "https://media.example.test/a.jpg"
    });
    expect(html).toContain('<meta property="og:image"');
    expect(html).not.toContain("og:image:alt");
  });

  test("Issue #642: emits escaped og:title/og:description/twitter:title/twitter:description derived from title/description", () => {
    const html = renderPublicPageShell({
      title: "<b>Title</b>",
      description: "<i>desc</i>",
      canonicalUrl: "https://example.com/post",
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(html).toContain(
      '<meta property="og:title" content="&lt;b&gt;Title&lt;/b&gt;" />'
    );
    expect(html).toContain(
      '<meta property="og:description" content="&lt;i&gt;desc&lt;/i&gt;" />'
    );
    expect(html).toContain(
      '<meta name="twitter:title" content="&lt;b&gt;Title&lt;/b&gt;" />'
    );
    expect(html).toContain(
      '<meta name="twitter:description" content="&lt;i&gt;desc&lt;/i&gt;" />'
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://example.com/post" />'
    );
  });

  test("Issue #642: omits og:url when canonicalUrl is null", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(html).not.toContain("og:url");
  });

  test("Issue #642: emits twitter:card=summary (not summary_large_image) when there is no og:image", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(html).toContain('<meta name="twitter:card" content="summary" />');
  });

  test("Issue #642: emits og:site_name only when siteName is provided", () => {
    const withSiteName = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en",
      siteName: "Acme <News>"
    });
    expect(withSiteName).toContain(
      '<meta property="og:site_name" content="Acme &lt;News&gt;" />'
    );

    const withoutSiteName = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(withoutSiteName).not.toContain("og:site_name");
  });
});

describe("resolveOgImageUrl (Issue #636)", () => {
  test("null when there is no resolved featured media URL", () => {
    expect(resolveOgImageUrl(null)).toBeNull();
  });

  test("passes through a safe absolute http(s) URL", () => {
    expect(resolveOgImageUrl("https://media.example.test/a.jpg")).toBe(
      "https://media.example.test/a.jpg"
    );
  });

  test("null for an unsafe URL (defense-in-depth even though the registry's publicUrl is already trusted)", () => {
    expect(resolveOgImageUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("resolveRobotsMetaContent (Issue #649)", () => {
  test("public visibility gets index,follow,max-image-preview:large", () => {
    expect(resolveRobotsMetaContent("public")).toBe(
      "index,follow,max-image-preview:large"
    );
  });

  test("unlisted visibility gets noindex,nofollow", () => {
    expect(resolveRobotsMetaContent("unlisted")).toBe("noindex,nofollow");
  });

  test("private visibility gets noindex,nofollow (never actually reached by a real route, defense-in-depth)", () => {
    expect(resolveRobotsMetaContent("private")).toBe("noindex,nofollow");
  });
});

describe("resolveOgLocale (Issue #649)", () => {
  test("maps id -> id_ID and en -> en_US", () => {
    expect(resolveOgLocale("id")).toBe("id_ID");
    expect(resolveOgLocale("en")).toBe("en_US");
  });

  test("passes through an already-formatted xx_XX value unchanged", () => {
    expect(resolveOgLocale("fr_FR")).toBe("fr_FR");
  });

  test("falls back to the raw locale for an unknown short code", () => {
    expect(resolveOgLocale("zz")).toBe("zz");
  });
});

describe("deriveArticleSectionAndTags (Issue #649)", () => {
  test("first category term becomes section, tag terms become tags", () => {
    const result = deriveArticleSectionAndTags([
      { taxonomyType: "tag", name: "breaking" },
      { taxonomyType: "category", name: "Politics" },
      { taxonomyType: "category", name: "World" },
      { taxonomyType: "tag", name: "election" }
    ]);
    expect(result.section).toBe("Politics");
    expect(result.tags).toEqual(["breaking", "election"]);
  });

  test("no category term: section is null", () => {
    const result = deriveArticleSectionAndTags([
      { taxonomyType: "tag", name: "breaking" }
    ]);
    expect(result.section).toBeNull();
    expect(result.tags).toEqual(["breaking"]);
  });

  test("empty terms: section null, tags empty", () => {
    expect(deriveArticleSectionAndTags([])).toEqual({
      section: null,
      tags: []
    });
  });
});

describe("renderPublicPageShell — Issue #649 extensions", () => {
  test("og:locale is always rendered, derived from the shell's own locale field", () => {
    const idHtml = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "id"
    });
    expect(idHtml).toContain('<meta property="og:locale" content="id_ID" />');

    const enHtml = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(enHtml).toContain('<meta property="og:locale" content="en_US" />');
  });

  test("og:type, article:published_time/modified_time/section/tag rendered only when ogType is article", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: "https://example.com/post",
      bodyHtml: "<p>body</p>",
      locale: "en",
      ogType: "article",
      articlePublishedTime: "2026-01-01T00:00:00.000Z",
      articleModifiedTime: "2026-01-02T00:00:00.000Z",
      articleSection: "Politics",
      articleTags: ["breaking", "<script>"]
    });

    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain(
      '<meta property="article:published_time" content="2026-01-01T00:00:00.000Z" />'
    );
    expect(html).toContain(
      '<meta property="article:modified_time" content="2026-01-02T00:00:00.000Z" />'
    );
    expect(html).toContain(
      '<meta property="article:section" content="Politics" />'
    );
    expect(html).toContain(
      '<meta property="article:tag" content="breaking" />'
    );
    expect(html).toContain(
      '<meta property="article:tag" content="&lt;script&gt;" />'
    );
    expect(html).not.toContain("<script>");
  });

  test("article:* tags omitted entirely when ogType is not article (list/category/tag/search pages, byte-identical to before this issue)", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en",
      articleSection: "Politics",
      articleTags: ["breaking"]
    });

    expect(html).not.toContain("og:type");
    expect(html).not.toContain("article:section");
    expect(html).not.toContain("article:tag");
  });

  test("og:image:type/width/height/secure_url and twitter:image:alt rendered alongside og:image", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en",
      ogImageUrl: "https://media.example.test/a.jpg",
      ogImageAlt: "A photo",
      ogImageMimeType: "image/jpeg",
      ogImageWidth: 1200,
      ogImageHeight: 630
    });

    expect(html).toContain(
      '<meta property="og:image:secure_url" content="https://media.example.test/a.jpg" />'
    );
    expect(html).toContain(
      '<meta property="og:image:type" content="image/jpeg" />'
    );
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
    expect(html).toContain(
      '<meta name="twitter:image:alt" content="A photo" />'
    );
  });

  test("no og:image:type/width/height/secure_url/twitter:image:alt when there is no og:image", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en"
    });

    expect(html).not.toContain("og:image:secure_url");
    expect(html).not.toContain("og:image:type");
    expect(html).not.toContain("og:image:width");
    expect(html).not.toContain("twitter:image:alt");
  });

  test("robots meta rendered only when robotsContent is provided", () => {
    const withRobots = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en",
      robotsContent: "index,follow,max-image-preview:large"
    });
    expect(withRobots).toContain(
      '<meta name="robots" content="index,follow,max-image-preview:large" />'
    );

    const withoutRobots = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(withoutRobots).not.toContain("robots");
  });

  test("structuredDataJsonLd is serialized into a safe <script> tag, escaping </script> break-out attempts", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en",
      structuredDataJsonLd: {
        "@type": "NewsArticle",
        headline: "</script><script>alert(1)</script>"
      }
    });

    expect(html).toContain('<script type="application/ld+json">');
    expect(html).not.toContain("</script><script>alert(1)</script>");
    expect(html).toContain("\\u003c/script>");
  });

  test("no structured data script when structuredDataJsonLd is omitted/null", () => {
    const html = renderPublicPageShell({
      title: "Title",
      description: "desc",
      canonicalUrl: null,
      bodyHtml: "<p>body</p>",
      locale: "en"
    });
    expect(html).not.toContain("application/ld+json");
  });
});

describe("renderPostSummaryListHtml", () => {
  test("renders an empty-state message when there are no posts", () => {
    const html = renderPostSummaryListHtml("acme", [], "Nothing here.");
    expect(html).toBe("<p>Nothing here.</p>");
  });

  test("renders a link per post, escaped", () => {
    const html = renderPostSummaryListHtml(
      "acme",
      [{ title: "<b>Hi</b>", slug: "hi", excerpt: null }],
      "empty"
    );
    expect(html).toContain('href="/blog/acme/hi"');
    expect(html).toContain("&lt;b&gt;Hi&lt;/b&gt;");
  });
});

describe("renderPaginationNavHtml", () => {
  test("shows only Next on page 1 with more pages", () => {
    const html = renderPaginationNavHtml(1, true, "/blog/acme");
    expect(html).toContain("Next");
    expect(html).not.toContain("Previous");
  });

  test("shows only Previous on the last page", () => {
    const html = renderPaginationNavHtml(2, false, "/blog/acme");
    expect(html).toContain("Previous");
    expect(html).not.toContain("Next");
  });
});
