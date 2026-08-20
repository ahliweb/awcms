import { describe, expect, test } from "bun:test";

import {
  validateCreateBlogPostInput,
  validateScheduleBlogPostInput,
  validateSoftDeleteBlogPostInput,
  validateUpdateBlogPostInput
} from "../src/modules/blog-content/domain/blog-post-validation";
import { evaluatePostUpdateAccess } from "../src/modules/blog-content/domain/post-access-policy";
import type { TenantContext } from "../src/modules/identity-access/domain/access-control";

const BASE_CONTEXT: TenantContext = {
  tenantId: "tenant-1",
  tenantUserId: "user-1",
  identityId: "identity-1",
  roles: []
};

describe("validateCreateBlogPostInput", () => {
  test("accepts a minimal valid payload and applies defaults", () => {
    const result = validateCreateBlogPostInput({
      title: "Hello",
      slug: "hello",
      contentJson: {},
      bodyPortableText: [
        {
          _type: "block",
          _key: "b0",
          style: "normal",
          children: [{ _type: "span", _key: "s0", text: "body", marks: [] }],
          markDefs: []
        }
      ]
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.visibility).toBe("public");
      expect(result.value.featuredMediaId).toBeNull();
      expect(result.value.seoTitle).toBeNull();
    }
  });

  test("rejects an invalid visibility value", () => {
    const result = validateCreateBlogPostInput({
      title: "Hello",
      slug: "hello",
      contentJson: {},
      bodyPortableText: [
        {
          _type: "block",
          _key: "b0",
          style: "normal",
          children: [{ _type: "span", _key: "s0", text: "body", marks: [] }],
          markDefs: []
        }
      ],
      visibility: "bogus"
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain("visibility");
    }
  });

  test("rejects a non-UUID featuredMediaId", () => {
    const result = validateCreateBlogPostInput({
      title: "Hello",
      slug: "hello",
      contentJson: {},
      bodyPortableText: [
        {
          _type: "block",
          _key: "b0",
          style: "normal",
          children: [{ _type: "span", _key: "s0", text: "body", marks: [] }],
          markDefs: []
        }
      ],
      featuredMediaId: "not-a-uuid"
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain(
        "featuredMediaId"
      );
    }
  });

  test("propagates core validation errors (e.g. missing title)", () => {
    const result = validateCreateBlogPostInput({
      slug: "hello",
      contentJson: {},
      bodyPortableText: [
        {
          _type: "block",
          _key: "b0",
          style: "normal",
          children: [{ _type: "span", _key: "s0", text: "body", marks: [] }],
          markDefs: []
        }
      ]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain("title");
    }
  });
});

describe("validateUpdateBlogPostInput", () => {
  test("accepts an empty payload (nothing to update)", () => {
    const result = validateUpdateBlogPostInput({});
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({});
    }
  });

  test("validates only the fields present in the body", () => {
    const result = validateUpdateBlogPostInput({ slug: "new-slug" });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ slug: "new-slug" });
    }
  });

  test("rejects an invalid slug without requiring title", () => {
    const result = validateUpdateBlogPostInput({ slug: "Not Valid!" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toEqual(["slug"]);
    }
  });

  test("allows clearing a nullable field (featuredMediaId: null)", () => {
    const result = validateUpdateBlogPostInput({ featuredMediaId: null });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ featuredMediaId: null });
    }
  });
});

describe("validateScheduleBlogPostInput", () => {
  test("accepts a future ISO datetime", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const result = validateScheduleBlogPostInput({ scheduledAt: future });
    expect(result.valid).toBe(true);
  });

  test("rejects a past datetime", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const result = validateScheduleBlogPostInput({ scheduledAt: past });
    expect(result.valid).toBe(false);
  });

  test("rejects a missing scheduledAt", () => {
    const result = validateScheduleBlogPostInput({});
    expect(result.valid).toBe(false);
  });

  test("rejects an unparseable datetime string", () => {
    const result = validateScheduleBlogPostInput({ scheduledAt: "not-a-date" });
    expect(result.valid).toBe(false);
  });
});

describe("validateSoftDeleteBlogPostInput", () => {
  test("requires a non-empty reason", () => {
    expect(validateSoftDeleteBlogPostInput({}).valid).toBe(false);
    expect(validateSoftDeleteBlogPostInput({ reason: "  " }).valid).toBe(false);
  });

  test("accepts and trims a valid reason", () => {
    const result = validateSoftDeleteBlogPostInput({ reason: "  spam  " });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.reason).toBe("spam");
    }
  });
});

describe("evaluatePostUpdateAccess", () => {
  test("allows when the role permission is granted, regardless of authorship", () => {
    const decision = evaluatePostUpdateAccess(
      BASE_CONTEXT,
      new Set(["blog_content.posts.update"]),
      { authorTenantUserId: "someone-else", status: "published" }
    );

    expect(decision.allowed).toBe(true);
    expect(decision.matchedPolicy).toBe("role_permission");
  });

  test("allows the author to edit their own unpublished draft without the role permission", () => {
    const decision = evaluatePostUpdateAccess(BASE_CONTEXT, new Set(), {
      authorTenantUserId: BASE_CONTEXT.tenantUserId,
      status: "draft"
    });

    expect(decision.allowed).toBe(true);
    expect(decision.matchedPolicy).toBe("author_own_draft_allow");
  });

  test("denies the author editing their own post once it is published", () => {
    const decision = evaluatePostUpdateAccess(BASE_CONTEXT, new Set(), {
      authorTenantUserId: BASE_CONTEXT.tenantUserId,
      status: "published"
    });

    expect(decision.allowed).toBe(false);
  });

  test("denies a non-author without the role permission", () => {
    const decision = evaluatePostUpdateAccess(BASE_CONTEXT, new Set(), {
      authorTenantUserId: "someone-else",
      status: "draft"
    });

    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicy).toBe("default_deny");
  });
});

describe("institutionIds (Issue #595)", () => {
  const MINIMAL = {
    title: "Hello",
    slug: "hello",
    contentJson: {},
    bodyPortableText: [
      {
        _type: "block",
        _key: "b0",
        style: "normal",
        children: [{ _type: "span", _key: "s0", text: "body", marks: [] }],
        markDefs: []
      }
    ]
  };

  test("is undefined when absent — absent means 'leave assignments alone'", () => {
    const result = validateCreateBlogPostInput(MINIMAL);

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.institutionIds).toBeUndefined();
  });

  test("an EMPTY array survives as [] and is not folded into undefined", () => {
    // The whole absent-vs-empty distinction depends on this: `[]` is the
    // caller saying "remove them all", and collapsing it to `undefined` would
    // make institutions impossible to unassign.
    const result = validateCreateBlogPostInput({
      ...MINIMAL,
      institutionIds: []
    });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.institutionIds).toEqual([]);
  });

  test("accepts UUIDs and de-duplicates them", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const result = validateCreateBlogPostInput({
      ...MINIMAL,
      institutionIds: [id, id]
    });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.institutionIds).toEqual([id]);
  });

  test("rejects a non-UUID, naming the field rather than termIds", () => {
    const result = validateCreateBlogPostInput({
      ...MINIMAL,
      institutionIds: ["not-a-uuid"]
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toContain("institutionIds");
      expect(result.errors.map((e) => e.field)).not.toContain("termIds");
    }
  });

  test("rejects a non-array", () => {
    const result = validateCreateBlogPostInput({
      ...MINIMAL,
      institutionIds: "11111111-1111-4111-8111-111111111111"
    });

    expect(result.valid).toBe(false);
  });

  test("update: absent leaves it out of the patch entirely", () => {
    const result = validateUpdateBlogPostInput({ title: "New" });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect("institutionIds" in result.value).toBe(false);
    }
  });

  test("update: [] is carried through, so a post can be un-assigned", () => {
    const result = validateUpdateBlogPostInput({ institutionIds: [] });

    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.institutionIds).toEqual([]);
  });
});
