/**
 * ADR-0109 — the pure half of the opt-in public byline.
 *
 * The database-backed half (the feed carries it, the erasure destroys it, and
 * one query serves a whole page) is in
 * `tests/integration/public-byline.integration.test.ts`, because those are the
 * parts a mock would happily confirm while being wrong.
 */
import { describe, expect, test } from "bun:test";

import {
  MAX_PUBLIC_BYLINE_LENGTH,
  validatePublicBylineName
} from "../src/modules/identity-access/application/own-byline";
import { buildNewsArticleJsonLd } from "../src/modules/blog-content/domain/structured-data-rendering";

const JSON_LD_BASE = {
  headline: "Judul",
  description: "Ringkasan",
  canonicalUrl: "https://news.example/blog/acme/judul",
  image: null,
  datePublished: new Date("2026-08-01T00:00:00.000Z"),
  dateModified: new Date("2026-08-02T00:00:00.000Z"),
  authorName: "Acme News",
  publisherName: "Acme News",
  publisherLogoUrl: null,
  articleSection: null,
  tags: []
};

describe("validatePublicBylineName", () => {
  test("a name is trimmed and kept", () => {
    expect(validatePublicBylineName("  Siti Rahayu  ")).toEqual({
      valid: true,
      value: "Siti Rahayu"
    });
  });

  test("null means no byline", () => {
    expect(validatePublicBylineName(null)).toEqual({
      valid: true,
      value: null
    });
  });

  test("an empty or whitespace-only string ALSO means no byline", () => {
    // A person clearing the field in a form sends `""`. Refusing it would make
    // "I do not want a byline" the one intention the screen cannot express.
    expect(validatePublicBylineName("")).toEqual({ valid: true, value: null });
    expect(validatePublicBylineName("   ")).toEqual({
      valid: true,
      value: null
    });
  });

  test("the ceiling is enforced on the TRIMMED value", () => {
    const atLimit = "x".repeat(MAX_PUBLIC_BYLINE_LENGTH);

    expect(validatePublicBylineName(`  ${atLimit}  `)).toEqual({
      valid: true,
      value: atLimit
    });
    expect(validatePublicBylineName(`${atLimit}x`).valid).toBe(false);
  });

  test("control characters are REFUSED, not stripped", () => {
    // The value is rendered inline in a byline and carried into JSON-LD, so a
    // newline inside it is a defect in both — and silently rewriting what
    // somebody typed as their own NAME is worse than telling them.
    for (const value of ["Siti\nRahayu", "Siti\tRahayu", "Siti\u0000Rahayu"]) {
      expect(validatePublicBylineName(value).valid).toBe(false);
    }
  });

  test("a non-string, non-null value is refused", () => {
    for (const value of [42, true, {}, []]) {
      expect(validatePublicBylineName(value).valid).toBe(false);
    }
  });
});

describe("the JSON-LD author node", () => {
  test("without a byline the author stays the ORGANISATION", () => {
    // Every article published before ADR-0109 is in this state, and none of
    // them changes.
    const jsonLd = buildNewsArticleJsonLd(JSON_LD_BASE);

    expect(jsonLd.author).toEqual({
      "@type": "Organization",
      name: "Acme News"
    });
  });

  test("an explicit null byline is the same as none", () => {
    const jsonLd = buildNewsArticleJsonLd({
      ...JSON_LD_BASE,
      authorByline: null
    });

    expect(jsonLd.author).toEqual({
      "@type": "Organization",
      name: "Acme News"
    });
  });

  test("with a byline the author is a Person carrying the NAME and nothing else", () => {
    // No `url`, no `sameAs`, no identifier. A byline is a name somebody chose
    // to publish under; a linked profile is a staff directory nobody asked for
    // and which the person cannot withdraw article by article.
    const jsonLd = buildNewsArticleJsonLd({
      ...JSON_LD_BASE,
      authorByline: "Siti Rahayu"
    });

    expect(jsonLd.author).toEqual({ "@type": "Person", name: "Siti Rahayu" });
    expect(Object.keys(jsonLd.author as Record<string, unknown>)).toEqual([
      "@type",
      "name"
    ]);
    // The publisher is untouched — the newsroom still publishes it.
    expect(jsonLd.publisher).toEqual({
      "@type": "Organization",
      name: "Acme News"
    });
  });
});
