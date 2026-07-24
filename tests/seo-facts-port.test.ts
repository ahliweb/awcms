import { describe, expect, test } from "bun:test";

import {
  assertControlledJsonLd,
  buildSeoCacheKey,
  escapeJsonLdText,
  isPubliclyIndexable,
  isPubliclyResolvable,
  renderControlledJsonLd,
  type JsonLdNode,
  type SeoVisibility
} from "../src/modules/_shared/ports/seo-facts-port";
import { CAPABILITY_CONTRACT_VERSIONS } from "../src/modules/_shared/capability-contract-versions";

const NOW = "2026-07-24T00:00:00.000Z";

const vis = (
  state: SeoVisibility["state"],
  noindex = false,
  scheduledPublishAt: string | null = null
): SeoVisibility => ({ state, noindex, scheduledPublishAt });

describe("seo-facts-port: capability version", () => {
  test("seo_facts is registered at 1.1.0", () => {
    expect(CAPABILITY_CONTRACT_VERSIONS.seo_facts).toBe("1.1.0");
  });
});

describe("seo-facts-port: publication-state predicates", () => {
  test("published is resolvable and indexable", () => {
    expect(isPubliclyResolvable(vis("published"), NOW)).toBe(true);
    expect(isPubliclyIndexable(vis("published"), NOW)).toBe(true);
  });

  test("published + noindex is resolvable but NOT indexable", () => {
    expect(isPubliclyResolvable(vis("published", true), NOW)).toBe(true);
    expect(isPubliclyIndexable(vis("published", true), NOW)).toBe(false);
  });

  test("draft/private/deleted/archived/unpublished are neither", () => {
    for (const state of [
      "draft",
      "private",
      "deleted",
      "archived",
      "unpublished"
    ] as const) {
      expect(isPubliclyResolvable(vis(state), NOW)).toBe(false);
      expect(isPubliclyIndexable(vis(state), NOW)).toBe(false);
    }
  });

  test("scheduled: private until its instant, public after", () => {
    const future = vis("scheduled", true, "2026-07-25T00:00:00.000Z");
    const past = vis("scheduled", false, "2026-07-23T00:00:00.000Z");
    expect(isPubliclyResolvable(future, NOW)).toBe(false);
    expect(isPubliclyResolvable(past, NOW)).toBe(true);
    // A null scheduledPublishAt never becomes public.
    expect(isPubliclyResolvable(vis("scheduled", true, null), NOW)).toBe(false);
  });

  test("a state cast past the union fails closed", () => {
    expect(
      isPubliclyResolvable(
        {
          state: "weird" as SeoVisibility["state"],
          noindex: false,
          scheduledPublishAt: null
        },
        NOW
      )
    ).toBe(false);
  });
});

describe("seo-facts-port: buildSeoCacheKey", () => {
  const base = {
    tenantId: "t1",
    host: "Example.COM",
    locale: "en",
    resourceType: "blog_post",
    resourceId: "r1",
    contractVersion: "1.1.0"
  };

  test("tenant-first, host lowercased, injective encoding", () => {
    const key = buildSeoCacheKey(base);
    expect(key).toBe("seo:1.1.0:t1:example.com:en:blog_post:r1");
  });

  test("throws when an isolation component is empty", () => {
    for (const field of ["tenantId", "host", "locale"] as const) {
      expect(() => buildSeoCacheKey({ ...base, [field]: "  " })).toThrow();
    }
  });

  test("a value containing the ':' separator cannot forge a different key", () => {
    const a = buildSeoCacheKey({ ...base, tenantId: "a:b" });
    const b = buildSeoCacheKey({ ...base, tenantId: "a", host: "b" });
    expect(a).not.toBe(b);
  });
});

describe("seo-facts-port: controlled JSON-LD", () => {
  test("renderControlledJsonLd escapes <, >, & so it cannot break out of <script>", () => {
    const node: JsonLdNode = {
      "@type": "Article",
      headline: "Hack </script><script>alert(1)</script> & <b>bold</b>"
    };
    const out = renderControlledJsonLd(node);
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&");
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
    expect(out).toContain("\\u0026");
  });

  test("escapeJsonLdText neutralizes the line/paragraph separators", () => {
    expect(escapeJsonLdText("a\u2028b\u2029c")).toBe("a\\u2028b\\u2029c");
  });

  test("assertControlledJsonLd rejects an @type outside the controlled set", () => {
    expect(() =>
      assertControlledJsonLd({
        "@type": "EvilType" as JsonLdNode["@type"],
        x: 1
      })
    ).toThrow();
  });

  test("assertControlledJsonLd rejects a key that could break out of <script>", () => {
    expect(() =>
      assertControlledJsonLd({
        "@type": "Article",
        "</script><script>": "x"
      } as unknown as JsonLdNode)
    ).toThrow();
  });

  test("assertControlledJsonLd does NOT reject legitimate </script substrings in a value (escape, not reject)", () => {
    expect(() =>
      assertControlledJsonLd({
        "@type": "Article",
        headline: "a post literally about </script"
      })
    ).not.toThrow();
  });

  test("nested controlled node passes", () => {
    const node: JsonLdNode = {
      "@type": "Article",
      author: { "@type": "Person", name: "Jane" }
    };
    expect(() => assertControlledJsonLd(node)).not.toThrow();
  });
});
