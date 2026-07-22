import { describe, expect, test } from "bun:test";

import { validateBlogContentCore } from "../src/modules/blog-content/domain/content-validation";
import {
  canPurgePost,
  canRestorePost,
  isValidStatusTransition,
  isBlogContentStatus,
  isBlogContentVisibility
} from "../src/modules/blog-content/domain/post-status";
import {
  isValidSlug,
  slugify
} from "../src/modules/blog-content/domain/slug-policy";
import { validateSeoFields } from "../src/modules/blog-content/domain/seo-validation";
import {
  isTaxonomyType,
  validateTermParent
} from "../src/modules/blog-content/domain/taxonomy-policy";
import { isSignificantContentChange } from "../src/modules/blog-content/domain/revision-policy";

describe("validateBlogContentCore", () => {
  test("accepts a valid core payload and trims/defaults fields", () => {
    const result = validateBlogContentCore({
      title: "  Hello World  ",
      slug: "hello-world",
      excerpt: null,
      contentJson: { blocks: [] },
      contentText: "Hello world body."
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({
        title: "Hello World",
        slug: "hello-world",
        excerpt: null,
        contentJson: { blocks: [] },
        contentText: "Hello world body.",
        locale: "id"
      });
    }
  });

  test("rejects a missing title and an invalid slug together", () => {
    const result = validateBlogContentCore({
      slug: "Not A Valid Slug!",
      contentJson: {},
      contentText: "body"
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.errors.map((error) => error.field);
      expect(fields).toContain("title");
      expect(fields).toContain("slug");
    }
  });

  test("rejects a non-object contentJson", () => {
    const result = validateBlogContentCore({
      title: "Title",
      slug: "title",
      contentJson: "not-an-object",
      contentText: "body"
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain(
        "contentJson"
      );
    }
  });

  test("rejects a <script> tag in contentText", () => {
    const result = validateBlogContentCore({
      title: "Title",
      slug: "title",
      contentJson: {},
      contentText: "<script>alert(1)</script>"
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain(
        "contentText"
      );
    }
  });

  test("rejects an inline event handler embedded in contentJson", () => {
    const result = validateBlogContentCore({
      title: "Title",
      slug: "title",
      contentJson: { html: '<img src=x onerror="alert(1)">' },
      contentText: "body"
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain(
        "contentJson"
      );
    }
  });

  test("accepts plain contentJson/contentText with no markup", () => {
    const result = validateBlogContentCore({
      title: "Title",
      slug: "title",
      contentJson: { blocks: [{ type: "paragraph", text: "Hello" }] },
      contentText: "Hello"
    });

    expect(result.valid).toBe(true);
  });
});

describe("post-status", () => {
  test("recognizes valid status/visibility values", () => {
    expect(isBlogContentStatus("published")).toBe(true);
    expect(isBlogContentStatus("bogus")).toBe(false);
    expect(isBlogContentVisibility("unlisted")).toBe(true);
    expect(isBlogContentVisibility("bogus")).toBe(false);
  });

  test("allows draft -> review -> published lifecycle transitions", () => {
    expect(isValidStatusTransition("draft", "review")).toBe(true);
    expect(isValidStatusTransition("review", "published")).toBe(true);
    expect(isValidStatusTransition("published", "archived")).toBe(true);
  });

  test("rejects an archived -> published transition", () => {
    expect(isValidStatusTransition("archived", "published")).toBe(false);
  });

  test("allows a no-op same-state transition", () => {
    expect(isValidStatusTransition("draft", "draft")).toBe(true);
  });

  test("canRestorePost requires a non-null deletedAt", () => {
    expect(canRestorePost(new Date())).toBe(true);
    expect(canRestorePost(null)).toBe(false);
  });

  test("canPurgePost allows archived or soft-deleted, forbids published", () => {
    expect(canPurgePost("archived", null)).toBe(true);
    expect(canPurgePost("draft", new Date())).toBe(true);
    expect(canPurgePost("published", null)).toBe(false);
    expect(canPurgePost("draft", null)).toBe(false);
  });
});

describe("slug-policy", () => {
  test("accepts a well-formed slug", () => {
    expect(isValidSlug("hello-world-2026")).toBe(true);
  });

  test("rejects uppercase, spaces, and leading/trailing hyphens", () => {
    expect(isValidSlug("Hello World")).toBe(false);
    expect(isValidSlug("-hello-")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });

  test("slugify derives a valid slug from a title with punctuation and accents", () => {
    const slug = slugify("Café: à la Mode!!");
    expect(isValidSlug(slug)).toBe(true);
    expect(slug).toBe("cafe-a-la-mode");
  });
});

describe("validateSeoFields", () => {
  test("accepts an empty payload (all fields optional)", () => {
    const result = validateSeoFields({});
    expect(result.valid).toBe(true);
  });

  test("rejects a seoTitle over the length limit", () => {
    const result = validateSeoFields({ seoTitle: "x".repeat(71) });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain("seoTitle");
    }
  });

  test("rejects a non-absolute canonicalUrl", () => {
    const result = validateSeoFields({ canonicalUrl: "/relative/path" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain(
        "canonicalUrl"
      );
    }
  });

  test("accepts an absolute https canonicalUrl", () => {
    const result = validateSeoFields({
      canonicalUrl: "https://example.com/post"
    });
    expect(result.valid).toBe(true);
  });
});

describe("taxonomy-policy", () => {
  test("isTaxonomyType recognizes category and tag only", () => {
    expect(isTaxonomyType("category")).toBe(true);
    expect(isTaxonomyType("tag")).toBe(true);
    expect(isTaxonomyType("bogus")).toBe(false);
  });

  test("rejects a tag with a parentId", () => {
    const result = validateTermParent("tag", "term-1", "term-2");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.field).toBe("parentId");
    }
  });

  test("allows a category with a distinct parentId", () => {
    const result = validateTermParent("category", "term-1", "term-2");
    expect(result.valid).toBe(true);
  });

  test("rejects a term being its own parent", () => {
    const result = validateTermParent("category", "term-1", "term-1");
    expect(result.valid).toBe(false);
  });
});

describe("revision-policy", () => {
  test("isSignificantContentChange is true when title changes", () => {
    expect(isSignificantContentChange({ title: "New title" })).toBe(true);
  });

  test("isSignificantContentChange is true when contentJson changes", () => {
    expect(isSignificantContentChange({ contentJson: { blocks: [] } })).toBe(
      true
    );
  });

  test("isSignificantContentChange is true when contentText changes", () => {
    expect(isSignificantContentChange({ contentText: "New body" })).toBe(true);
  });

  test("isSignificantContentChange is false for an empty input (e.g. a PATCH touching only cosmetic fields)", () => {
    expect(isSignificantContentChange({})).toBe(false);
  });
});
