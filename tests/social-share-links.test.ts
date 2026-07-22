import { describe, expect, test } from "bun:test";

import {
  buildSocialShareLinks,
  renderSocialShareButtonsHtml,
  type SocialShareRenderConfig
} from "../src/modules/blog-content/domain/social-share-links";

const ARTICLE = {
  canonicalUrl: "https://news.example.test/articles/hello-world",
  title: "Hello & World",
  excerpt: "An excerpt with <b>markup</b>."
};

const ALL_ENABLED: SocialShareRenderConfig = {
  buttonsEnabled: true,
  native: true,
  whatsapp: true,
  telegram: true,
  facebook: true,
  linkedin: true,
  x: true,
  email: true,
  instagramNativeOnly: true
};

describe("buildSocialShareLinks (Issue #642)", () => {
  test("builds every enabled platform's URL-encoded share link", () => {
    const links = buildSocialShareLinks(ARTICLE, ALL_ENABLED);
    const byPlatform = new Map(links.map((link) => [link.platform, link.href]));

    expect(byPlatform.get("whatsapp")).toBe(
      `https://wa.me/?text=${encodeURIComponent("Hello & World https://news.example.test/articles/hello-world")}`
    );
    expect(byPlatform.get("telegram")).toBe(
      `https://t.me/share/url?url=${encodeURIComponent(ARTICLE.canonicalUrl)}&text=${encodeURIComponent(ARTICLE.title)}`
    );
    expect(byPlatform.get("facebook")).toBe(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(ARTICLE.canonicalUrl)}`
    );
    expect(byPlatform.get("linkedin")).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(ARTICLE.canonicalUrl)}`
    );
    expect(byPlatform.get("x_twitter")).toBe(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(ARTICLE.canonicalUrl)}&text=${encodeURIComponent(ARTICLE.title)}`
    );
    expect(byPlatform.get("email")).toContain("mailto:?subject=");
  });

  test("never emits raw/unencoded title or URL characters (e.g. '&', ' ') in any href", () => {
    const links = buildSocialShareLinks(ARTICLE, ALL_ENABLED);

    for (const link of links) {
      // The canonical URL's own scheme separator is fine; what we must
      // never see is the raw article title/excerpt text unescaped inside
      // the query string (e.g. a literal space or literal "&" that isn't
      // part of the query-string delimiter grammar).
      expect(link.href).not.toContain("Hello & World");
      expect(link.href).not.toContain("<b>markup</b>");
    }
  });

  test("disabled platforms are excluded from the result", () => {
    const links = buildSocialShareLinks(ARTICLE, {
      ...ALL_ENABLED,
      whatsapp: false,
      x: false
    });
    const platforms = links.map((link) => link.platform);

    expect(platforms).not.toContain("whatsapp");
    expect(platforms).not.toContain("x_twitter");
    expect(platforms).toContain("telegram");
    expect(platforms).toContain("facebook");
    expect(platforms).toContain("linkedin");
    expect(platforms).toContain("email");
  });

  test("no platform is ever included outside the fixed six-platform allowlist", () => {
    const links = buildSocialShareLinks(ARTICLE, ALL_ENABLED);
    const allowlist = new Set([
      "whatsapp",
      "telegram",
      "facebook",
      "linkedin",
      "x_twitter",
      "email"
    ]);

    expect(links.length).toBe(6);
    for (const link of links) {
      expect(allowlist.has(link.platform)).toBe(true);
    }
  });

  test("returns an empty array when the canonical URL is not a safe absolute http(s) URL", () => {
    const links = buildSocialShareLinks(
      { ...ARTICLE, canonicalUrl: "javascript:alert(1)" },
      ALL_ENABLED
    );
    expect(links).toEqual([]);
  });
});

describe("renderSocialShareButtonsHtml (Issue #642)", () => {
  test("renders nothing when buttonsEnabled is false", () => {
    const html = renderSocialShareButtonsHtml(
      ARTICLE,
      { ...ALL_ENABLED, buttonsEnabled: false },
      "/js/news-share.js"
    );
    expect(html).toBe("");
  });

  test("renders nothing when the canonical URL is unsafe", () => {
    const html = renderSocialShareButtonsHtml(
      { ...ARTICLE, canonicalUrl: "javascript:alert(1)" },
      ALL_ENABLED,
      "/js/news-share.js"
    );
    expect(html).toBe("");
  });

  test("escapes title/excerpt and includes rel=noopener noreferrer + accessible labels on every external link", () => {
    const html = renderSocialShareButtonsHtml(
      ARTICLE,
      ALL_ENABLED,
      "/js/news-share.js"
    );

    expect(html).toContain("Hello &amp; World");
    expect(html).not.toContain("<b>markup</b>");
    // Every static platform link must carry rel="noopener noreferrer" and
    // target="_blank" (issue: "Add rel=noopener noreferrer for external
    // share links").
    const anchorMatches = [...html.matchAll(/<a\b[^>]*>/g)];
    expect(anchorMatches.length).toBeGreaterThan(0);
    for (const [anchorTag] of anchorMatches) {
      expect(anchorTag).toContain('rel="noopener noreferrer"');
      expect(anchorTag).toContain('target="_blank"');
      expect(anchorTag).toContain("aria-label=");
    }
  });

  test("native share button is present but `hidden` server-side (revealed only client-side when supported)", () => {
    const html = renderSocialShareButtonsHtml(
      ARTICLE,
      ALL_ENABLED,
      "/js/news-share.js"
    );
    expect(html).toContain(
      'class="news-share__native js-news-share-native" hidden'
    );
  });

  test("native share button is entirely absent when NEWS_SHARE_NATIVE_ENABLED=false", () => {
    const html = renderSocialShareButtonsHtml(
      ARTICLE,
      { ...ALL_ENABLED, native: false },
      "/js/news-share.js"
    );
    expect(html).not.toContain("js-news-share-native");
  });

  test("copy-link button is always present when buttonsEnabled is true, regardless of other platform flags", () => {
    const html = renderSocialShareButtonsHtml(
      ARTICLE,
      {
        buttonsEnabled: true,
        native: false,
        whatsapp: false,
        telegram: false,
        facebook: false,
        linkedin: false,
        x: false,
        email: false,
        instagramNativeOnly: false
      },
      "/js/news-share.js"
    );

    expect(html).toContain("js-news-share-copy");
  });

  test("disabled platforms produce no <a> link for that platform", () => {
    const html = renderSocialShareButtonsHtml(
      ARTICLE,
      { ...ALL_ENABLED, whatsapp: false },
      "/js/news-share.js"
    );
    expect(html).not.toContain("news-share__link--whatsapp");
    expect(html).toContain("news-share__link--telegram");
  });

  test("never emits a fake Instagram share link/button", () => {
    const html = renderSocialShareButtonsHtml(
      ARTICLE,
      ALL_ENABLED,
      "/js/news-share.js"
    );
    expect(html).not.toContain("instagram.com");
    expect(html).not.toContain("news-share__link--instagram");
  });

  test("Instagram note text changes based on whether native share is enabled", () => {
    const withNative = renderSocialShareButtonsHtml(
      ARTICLE,
      ALL_ENABLED,
      "/js/news-share.js"
    );
    expect(withNative).toContain("Instagram: use the Share button above");

    const withoutNative = renderSocialShareButtonsHtml(
      ARTICLE,
      { ...ALL_ENABLED, native: false },
      "/js/news-share.js"
    );
    expect(withoutNative).toContain("Instagram: use Copy link");
  });

  test("Instagram note is omitted entirely when NEWS_SHARE_INSTAGRAM_NATIVE_ONLY=false", () => {
    const html = renderSocialShareButtonsHtml(
      ARTICLE,
      { ...ALL_ENABLED, instagramNativeOnly: false },
      "/js/news-share.js"
    );
    expect(html).not.toContain("Instagram");
  });

  test("only one <script> tag is emitted, pointing at the given same-origin scriptSrc — no third-party script", () => {
    const html = renderSocialShareButtonsHtml(
      ARTICLE,
      ALL_ENABLED,
      "/js/news-share.js"
    );
    const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)];

    expect(scriptTags.length).toBe(1);
    expect(scriptTags[0]![0]).toContain('src="/js/news-share.js"');
    expect(html).not.toMatch(/<script[^>]*src="https?:\/\//i);
  });

  test("uses the canonical URL, never a raw querystring-bearing URL, in data-share-url/href", () => {
    const trackedArticle = {
      ...ARTICLE,
      canonicalUrl: "https://news.example.test/articles/hello-world"
    };
    const html = renderSocialShareButtonsHtml(
      trackedArticle,
      ALL_ENABLED,
      "/js/news-share.js"
    );
    expect(html).toContain(`data-share-url="${trackedArticle.canonicalUrl}"`);
    expect(html).not.toContain("?utm_");
    expect(html).not.toContain("?admin_preview");
    expect(html).not.toContain("session_id");
  });
});
