import { describe, expect, test } from "bun:test";

import {
  isPageType,
  PAGE_TYPES
} from "../src/modules/blog-content/domain/page-type";
import {
  validateCreateBlogPageInput,
  validateUpdateBlogPageInput
} from "../src/modules/blog-content/domain/blog-page-validation";
import {
  validateCreateBlogTermInput,
  validateUpdateBlogTermInput
} from "../src/modules/blog-content/domain/blog-term-validation";
import { validateDeleteReasonInput } from "../src/modules/blog-content/domain/content-validation";
import { evaluatePageUpdateAccess } from "../src/modules/blog-content/domain/page-access-policy";
import { evaluatePostUpdateAccess } from "../src/modules/blog-content/domain/post-access-policy";
import type { TenantContext } from "../src/modules/identity-access/domain/access-control";

describe("page-type", () => {
  test("recognizes all four page types", () => {
    for (const type of PAGE_TYPES) {
      expect(isPageType(type)).toBe(true);
    }
    expect(isPageType("bogus")).toBe(false);
  });
});

describe("validateCreateBlogPageInput", () => {
  const BASE = {
    title: "About",
    slug: "about",
    contentJson: {},
    contentText: "body"
  };

  test("accepts a minimal valid payload with defaults", () => {
    const result = validateCreateBlogPageInput(BASE);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.pageType).toBe("standard");
      expect(result.value.parentPageId).toBeNull();
      expect(result.value.menuOrder).toBe(0);
    }
  });

  test("accepts an explicit pageType/parentPageId/menuOrder", () => {
    const parentId = "11111111-1111-1111-1111-111111111111";
    const result = validateCreateBlogPageInput({
      ...BASE,
      pageType: "landing",
      parentPageId: parentId,
      menuOrder: 5
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.pageType).toBe("landing");
      expect(result.value.parentPageId).toBe(parentId);
      expect(result.value.menuOrder).toBe(5);
    }
  });

  test("rejects an invalid pageType", () => {
    const result = validateCreateBlogPageInput({ ...BASE, pageType: "bogus" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain("pageType");
    }
  });

  test("rejects a negative or non-integer menuOrder", () => {
    const negative = validateCreateBlogPageInput({ ...BASE, menuOrder: -1 });
    expect(negative.valid).toBe(false);

    const fractional = validateCreateBlogPageInput({ ...BASE, menuOrder: 1.5 });
    expect(fractional.valid).toBe(false);
  });

  test("rejects a non-UUID parentPageId", () => {
    const result = validateCreateBlogPageInput({
      ...BASE,
      parentPageId: "not-a-uuid"
    });
    expect(result.valid).toBe(false);
  });
});

describe("validateUpdateBlogPageInput", () => {
  const PAGE_ID = "22222222-2222-2222-2222-222222222222";

  test("accepts an empty payload", () => {
    const result = validateUpdateBlogPageInput({}, PAGE_ID);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({});
    }
  });

  test("rejects a page being its own parent", () => {
    const result = validateUpdateBlogPageInput(
      { parentPageId: PAGE_ID },
      PAGE_ID
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0]?.field).toBe("parentPageId");
    }
  });

  test("allows clearing parentPageId to null", () => {
    const result = validateUpdateBlogPageInput({ parentPageId: null }, PAGE_ID);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.parentPageId).toBeNull();
    }
  });
});

describe("validateCreateBlogTermInput", () => {
  test("accepts a valid category with a parentId", () => {
    const parentId = "33333333-3333-3333-3333-333333333333";
    const result = validateCreateBlogTermInput({
      taxonomyType: "category",
      name: "News",
      slug: "news",
      parentId
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.parentId).toBe(parentId);
    }
  });

  test("rejects a tag with a parentId", () => {
    const result = validateCreateBlogTermInput({
      taxonomyType: "tag",
      name: "Featured",
      slug: "featured",
      parentId: "33333333-3333-3333-3333-333333333333"
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain("parentId");
    }
  });

  test("rejects a missing taxonomyType", () => {
    const result = validateCreateBlogTermInput({
      name: "News",
      slug: "news"
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.field)).toContain(
        "taxonomyType"
      );
    }
  });

  test("rejects an invalid slug", () => {
    const result = validateCreateBlogTermInput({
      taxonomyType: "tag",
      name: "Featured",
      slug: "Not Valid!"
    });
    expect(result.valid).toBe(false);
  });
});

describe("validateUpdateBlogTermInput", () => {
  test("accepts an empty payload", () => {
    const result = validateUpdateBlogTermInput({});
    expect(result.valid).toBe(true);
  });

  test("rejects taxonomyType: tag combined with a non-null parentId in the same request", () => {
    const result = validateUpdateBlogTermInput({
      taxonomyType: "tag",
      parentId: "33333333-3333-3333-3333-333333333333"
    });
    expect(result.valid).toBe(false);
  });

  test("allows taxonomyType: category combined with a parentId", () => {
    const result = validateUpdateBlogTermInput({
      taxonomyType: "category",
      parentId: "33333333-3333-3333-3333-333333333333"
    });
    expect(result.valid).toBe(true);
  });
});

describe("validateDeleteReasonInput", () => {
  test("requires a non-empty reason", () => {
    expect(validateDeleteReasonInput({}).valid).toBe(false);
    expect(validateDeleteReasonInput({ reason: "   " }).valid).toBe(false);
  });

  test("trims a valid reason", () => {
    const result = validateDeleteReasonInput({ reason: "  spam  " });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.reason).toBe("spam");
    }
  });
});

const BASE_CONTEXT: TenantContext = {
  tenantId: "tenant-1",
  tenantUserId: "user-1",
  identityId: "identity-1",
  roles: []
};

describe("evaluatePageUpdateAccess", () => {
  test("allows when granted blog_content.pages.update, regardless of authorship", () => {
    const decision = evaluatePageUpdateAccess(
      BASE_CONTEXT,
      new Set(["blog_content.pages.update"]),
      { authorTenantUserId: "someone-else", status: "published" }
    );
    expect(decision.allowed).toBe(true);
  });

  test("allows the author to edit their own unpublished page without the permission", () => {
    const decision = evaluatePageUpdateAccess(BASE_CONTEXT, new Set(), {
      authorTenantUserId: BASE_CONTEXT.tenantUserId,
      status: "draft"
    });
    expect(decision.allowed).toBe(true);
    expect(decision.matchedPolicy).toBe("author_own_draft_allow");
  });

  test("does not leak into the posts guard (pages permission alone does not grant posts update)", () => {
    const decision = evaluatePostUpdateAccess(
      BASE_CONTEXT,
      new Set(["blog_content.pages.update"]),
      { authorTenantUserId: "someone-else", status: "draft" }
    );
    expect(decision.allowed).toBe(false);
  });
});
