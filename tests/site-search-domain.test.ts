/**
 * `site_search` pure domain layer (ADR-0040 §5/§6, ported from awcms-micro Issue
 * #270): query normalization + bounds, the snippet XSS defense, the tenant-first
 * cache key, tenant settings validation, and the public page renderer.
 *
 * The snippet tests are the load-bearing ones. `renderSafeSnippet` is the ONLY
 * thing standing between `ts_headline` output (which contains raw source content)
 * and HTML served to an anonymous visitor, so the escape-then-mark ordering is
 * asserted directly rather than inferred from the implementation shape.
 */
import { describe, expect, test } from "bun:test";

import {
  buildSearchCacheKey,
  type SearchCacheKeyParts
} from "../src/modules/site-search/domain/search-cache-key";
import {
  DEFAULT_SEARCH_PAGE_LABELS,
  renderSearchPageBody,
  renderSearchPageDocument
} from "../src/modules/site-search/domain/search-page-rendering";
import {
  clampMinQueryLength,
  hashSearchQuery,
  MAX_QUERY_LENGTH,
  normalizeSearchLocale,
  normalizeSearchQuery,
  stripControlCharacters
} from "../src/modules/site-search/domain/search-query";
import {
  DEFAULT_SITE_SEARCH_SETTINGS,
  validateSiteSearchSettings
} from "../src/modules/site-search/domain/search-settings";
import {
  renderSafeSnippet,
  SNIPPET_HEADLINE_OPTIONS,
  SNIPPET_START_SENTINEL,
  SNIPPET_STOP_SENTINEL
} from "../src/modules/site-search/domain/search-snippet";

describe("normalizeSearchQuery — abuse bounds and determinism", () => {
  test("trims, collapses whitespace, strips control characters", () => {
    const result = normalizeSearchQuery(
      `  hello${String.fromCharCode(9)}${String.fromCharCode(0)}  world  `
    );
    expect(result).toEqual({ ok: true, value: "hello world" });
  });

  test("a non-string, an empty string, and pure whitespace are all `empty`", () => {
    for (const raw of [undefined, null, 42, {}, "", "   "]) {
      expect(normalizeSearchQuery(raw)).toEqual({
        ok: false,
        reason: "empty"
      });
    }
  });

  test("an over-long query is REJECTED, not silently truncated", () => {
    const result = normalizeSearchQuery("a".repeat(MAX_QUERY_LENGTH + 1));
    expect(result).toEqual({ ok: false, reason: "too_long" });
  });

  test("a query under the tenant's minimum is `too_short`", () => {
    expect(normalizeSearchQuery("ab", 3)).toEqual({
      ok: false,
      reason: "too_short"
    });
    expect(normalizeSearchQuery("abc", 3)).toEqual({ ok: true, value: "abc" });
  });

  test("a nonsense configured minimum is clamped, never trusted raw", () => {
    expect(clampMinQueryLength(Number.NaN)).toBe(2);
    expect(clampMinQueryLength(-5)).toBe(1);
    expect(clampMinQueryLength(9999)).toBe(20);
    // A clamped ceiling of 20 must still reject, not accept, a 3-char query.
    expect(normalizeSearchQuery("abc", 9999)).toEqual({
      ok: false,
      reason: "too_short"
    });
  });

  test("stripControlCharacters replaces C0 and DEL with spaces", () => {
    const raw = `a${String.fromCharCode(1)}b${String.fromCharCode(127)}c`;
    expect(stripControlCharacters(raw)).toBe("a b c");
  });
});

describe("normalizeSearchLocale — cross-locale isolation", () => {
  test("a well-formed tag is lowercased and kept", () => {
    expect(normalizeSearchLocale("EN-us", "id")).toBe("en-us");
  });

  test("anything malformed falls back to the tenant default", () => {
    for (const raw of ["", "x", "not a locale", "../en", 7, null]) {
      expect(normalizeSearchLocale(raw, "id")).toBe("id");
    }
  });
});

describe("hashSearchQuery — the only form the query log ever stores", () => {
  test("is a stable sha256 hex digest, never the raw query", () => {
    const hash = hashSearchQuery("secret term");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashSearchQuery("secret term"));
    expect(hash).not.toContain("secret");
  });
});

describe("renderSafeSnippet — the XSS defense (ADR-0040 §5)", () => {
  test("content markup is escaped; only our own <mark> survives", () => {
    const headline = `pre <script>alert(1)</script> ${SNIPPET_START_SENTINEL}hit${SNIPPET_STOP_SENTINEL} post`;
    const rendered = renderSafeSnippet(headline);
    expect(rendered).not.toContain("<script");
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).toContain("<mark>hit</mark>");
    const tags = rendered.match(/<[^>]+>/g) ?? [];
    expect(tags.every((t) => t === "<mark>" || t === "</mark>")).toBe(true);
  });

  test("a document that literally contains a sentinel yields a spurious highlight, never markup", () => {
    // The escape happens FIRST, so a content-embedded sentinel can only ever
    // become one of our own two tags — the documented worst case.
    const rendered = renderSafeSnippet(
      `body ${SNIPPET_START_SENTINEL} "quoted" & <b>bold</b>`
    );
    expect(rendered).toContain("<mark>");
    expect(rendered).not.toContain("<b>");
    expect(rendered).toContain("&lt;b&gt;");
    expect(rendered).toContain("&quot;");
    expect(rendered).toContain("&amp;");
  });

  test("the ts_headline options string carries the non-HTML sentinels", () => {
    expect(SNIPPET_HEADLINE_OPTIONS).toContain(
      `StartSel=${SNIPPET_START_SENTINEL}`
    );
    expect(SNIPPET_HEADLINE_OPTIONS).toContain(
      `StopSel=${SNIPPET_STOP_SENTINEL}`
    );
    // Passing raw HTML delimiters to ts_headline would defeat the whole scheme.
    expect(SNIPPET_HEADLINE_OPTIONS).not.toContain("<");
  });
});

describe("buildSearchCacheKey — cross-tenant / cross-locale cache defense", () => {
  const parts: SearchCacheKeyParts = {
    tenantId: "tenant-a",
    locale: "en",
    queryHash: "abc123",
    resourceType: "blog_post",
    cursor: "0",
    limit: 20
  };

  test("tenant id is always the first component after the namespace", () => {
    expect(buildSearchCacheKey(parts)).toBe(
      "sitesearch:tenant-a:en:abc123:blog_post:0:20"
    );
  });

  test("a missing or blank isolation component THROWS rather than building a shared key", () => {
    for (const field of ["tenantId", "locale", "queryHash"] as const) {
      expect(() => buildSearchCacheKey({ ...parts, [field]: "" })).toThrow(
        new RegExp(field)
      );
      expect(() => buildSearchCacheKey({ ...parts, [field]: "   " })).toThrow();
    }
  });

  test("two tenants can never collide on the same key", () => {
    expect(buildSearchCacheKey(parts)).not.toBe(
      buildSearchCacheKey({ ...parts, tenantId: "tenant-b" })
    );
    expect(buildSearchCacheKey(parts)).not.toBe(
      buildSearchCacheKey({ ...parts, locale: "id" })
    );
  });

  test("components are encoded so a crafted value cannot forge a key boundary", () => {
    const key = buildSearchCacheKey({ ...parts, tenantId: "a:b" });
    expect(key).toContain("a%3Ab");
  });
});

describe("validateSiteSearchSettings — bounded, merge semantics", () => {
  test("an omitted field keeps its current value", () => {
    const base = { ...DEFAULT_SITE_SEARCH_SETTINGS, resultLimit: 55 };
    const result = validateSiteSearchSettings({ enabled: false }, base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.enabled).toBe(false);
    expect(result.value.resultLimit).toBe(55);
  });

  test("out-of-range integers are rejected with a named error", () => {
    const result = validateSiteSearchSettings({ resultLimit: 101 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("resultLimit");
  });

  test("a non-integer bound is rejected", () => {
    const result = validateSiteSearchSettings({ minQueryLength: 2.5 });
    expect(result.ok).toBe(false);
  });

  test("enabledResourceTypes accepts null (all types), bounds length, and dedupes", () => {
    const allTypes = validateSiteSearchSettings({
      enabledResourceTypes: null
    });
    expect(allTypes.ok && allTypes.value.enabledResourceTypes).toBeNull();

    const deduped = validateSiteSearchSettings({
      enabledResourceTypes: ["blog_post", "blog_post"]
    });
    expect(deduped.ok && deduped.value.enabledResourceTypes).toEqual([
      "blog_post"
    ]);

    const tooMany = validateSiteSearchSettings({
      enabledResourceTypes: Array.from({ length: 51 }, (_, i) => `t${i}`)
    });
    expect(tooMany.ok).toBe(false);
  });

  test("a non-identifier resource type is rejected", () => {
    const result = validateSiteSearchSettings({
      enabledResourceTypes: ["blog post; DROP TABLE x"]
    });
    expect(result.ok).toBe(false);
  });

  test("a non-object body is rejected", () => {
    expect(validateSiteSearchSettings("nope").ok).toBe(false);
    expect(validateSiteSearchSettings([]).ok).toBe(false);
    expect(validateSiteSearchSettings(null).ok).toBe(false);
  });
});

describe("renderSearchPageBody — accessible, escaped, no-JS", () => {
  const view = {
    locale: "en",
    siteName: "Acme",
    query: "fox",
    minQueryLength: 2,
    items: [
      {
        resourceType: "blog_post",
        resourceId: "1",
        url: "/blog/acme/alpha",
        title: 'Alpha & <b>"bright"</b>',
        // Already-safe HTML from renderSafeSnippet — embedded as-is by design.
        snippet: "the quick <mark>fox</mark>",
        locale: "en",
        rank: 0.5
      }
    ],
    nextCursor: null,
    labels: DEFAULT_SEARCH_PAGE_LABELS
  };

  test("escapes titles and urls but embeds the pre-escaped snippet verbatim", () => {
    const html = renderSearchPageBody(view);
    expect(html).toContain("Alpha &amp; &lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).toContain("the quick <mark>fox</mark>");
  });

  test("renders a native GET form and no executable script (CSP: no inline scripts here)", () => {
    const html = renderSearchPageBody(view);
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/search"');
    expect(html).toContain('role="search"');
    expect(html).not.toContain("<script");
  });

  test("an empty query shows the prompt, a short one the too-short hint, no results the empty hint", () => {
    expect(renderSearchPageBody({ ...view, query: "", items: [] })).toContain(
      DEFAULT_SEARCH_PAGE_LABELS.enterTerm
    );
    expect(
      renderSearchPageBody({
        ...view,
        query: "",
        items: [],
        reason: "too_short"
      })
    ).toContain(DEFAULT_SEARCH_PAGE_LABELS.tooShort);
    expect(renderSearchPageBody({ ...view, items: [] })).toContain(
      DEFAULT_SEARCH_PAGE_LABELS.noResults
    );
  });

  test("the next-page link encodes the query and cursor", () => {
    const html = renderSearchPageBody({
      ...view,
      query: "a b&c",
      nextCursor: "cur/sor"
    });
    expect(html).toContain("q=a%20b%26c");
    expect(html).toContain("cursor=cur%2Fsor");
  });

  test("the full document is noindex — a results page must never be indexed", () => {
    const html = renderSearchPageDocument(view);
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Acme");
  });
});
