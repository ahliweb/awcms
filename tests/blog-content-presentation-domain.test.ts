import { describe, expect, test } from "bun:test";

import {
  validateCreateTemplateInput,
  validateTemplateLayout,
  validateUpdateTemplateInput
} from "../src/modules/blog-content/domain/template-policy";
import {
  MAX_MENU_ITEMS,
  validateMenuItemsInput,
  isMenuLinkType
} from "../src/modules/blog-content/domain/menu-policy";
import {
  isWidgetPosition,
  validateCreateWidgetInput
} from "../src/modules/blog-content/domain/widget-policy";
import {
  isAdPlacementType,
  validateAdPlacementsInput,
  validateCreateAdInput
} from "../src/modules/blog-content/domain/ad-policy";
import {
  isBlogThemeMode,
  validateUpdateThemeSettingsInput
} from "../src/modules/blog-content/domain/theme-policy";
import type { TemplateLayout } from "../src/modules/blog-content/domain/template-policy";

const VALID_LAYOUT: TemplateLayout = { columns: 2, sidebarPosition: "right" };

describe("template-policy", () => {
  test("validateTemplateLayout accepts a whitelisted shape", () => {
    expect(validateTemplateLayout(VALID_LAYOUT)).toEqual({
      valid: true,
      value: VALID_LAYOUT
    });
  });

  test("validateTemplateLayout rejects an out-of-range columns value", () => {
    expect(
      validateTemplateLayout({ columns: 5, sidebarPosition: "left" }).valid
    ).toBe(false);
  });

  test("validateTemplateLayout rejects an unknown sidebarPosition", () => {
    expect(
      validateTemplateLayout({ columns: 1, sidebarPosition: "top" }).valid
    ).toBe(false);
  });

  test("validateCreateTemplateInput accepts a valid payload", () => {
    const result = validateCreateTemplateInput({
      key: "landing-hero",
      name: "Landing Hero",
      layoutJson: VALID_LAYOUT
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.isActive).toBe(true);
    }
  });

  test("validateCreateTemplateInput rejects an invalid key format", () => {
    const result = validateCreateTemplateInput({
      key: "Not A Slug!",
      name: "X",
      layoutJson: VALID_LAYOUT
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((e) => e.field)).toContain("key");
    }
  });

  test("validateUpdateTemplateInput accepts a partial payload", () => {
    const result = validateUpdateTemplateInput({ isActive: false });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value).toEqual({ isActive: false });
    }
  });
});

describe("menu-policy", () => {
  test("isMenuLinkType recognizes post, page, url only", () => {
    expect(isMenuLinkType("post")).toBe(true);
    expect(isMenuLinkType("bogus")).toBe(false);
  });

  test("validateMenuItemsInput accepts a flat list of url items", () => {
    const result = validateMenuItemsInput([
      {
        id: "11111111-1111-1111-1111-111111111111",
        parentItemId: null,
        label: "Home",
        linkType: "url",
        url: "https://example.com",
        sortOrder: 0
      }
    ]);
    expect(result.valid).toBe(true);
  });

  test("validateMenuItemsInput rejects an unsafe/relative url for a url link", () => {
    const result = validateMenuItemsInput([
      {
        id: "11111111-1111-1111-1111-111111111111",
        parentItemId: null,
        label: "Home",
        linkType: "url",
        url: "javascript:alert(1)",
        sortOrder: 0
      }
    ]);
    expect(result.valid).toBe(false);
  });

  test("validateMenuItemsInput requires targetId for post/page links", () => {
    const result = validateMenuItemsInput([
      {
        id: "11111111-1111-1111-1111-111111111111",
        parentItemId: null,
        label: "Post",
        linkType: "post",
        sortOrder: 0
      }
    ]);
    expect(result.valid).toBe(false);
  });

  test("validateMenuItemsInput rejects a parentItemId not present in the batch", () => {
    const result = validateMenuItemsInput([
      {
        id: "11111111-1111-1111-1111-111111111111",
        parentItemId: "22222222-2222-2222-2222-222222222222",
        label: "Child",
        linkType: "url",
        url: "https://example.com",
        sortOrder: 0
      }
    ]);
    expect(result.valid).toBe(false);
  });

  test("validateMenuItemsInput rejects nesting deeper than one level", () => {
    const result = validateMenuItemsInput([
      {
        id: "11111111-1111-1111-1111-111111111111",
        parentItemId: null,
        label: "Root",
        linkType: "url",
        url: "https://example.com",
        sortOrder: 0
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        parentItemId: "11111111-1111-1111-1111-111111111111",
        label: "Child",
        linkType: "url",
        url: "https://example.com",
        sortOrder: 1
      },
      {
        id: "33333333-3333-3333-3333-333333333333",
        parentItemId: "22222222-2222-2222-2222-222222222222",
        label: "Grandchild",
        linkType: "url",
        url: "https://example.com",
        sortOrder: 2
      }
    ]);
    expect(result.valid).toBe(false);
  });

  test("validateMenuItemsInput accepts a valid one-level tree", () => {
    const result = validateMenuItemsInput([
      {
        id: "11111111-1111-1111-1111-111111111111",
        parentItemId: null,
        label: "Root",
        linkType: "url",
        url: "https://example.com",
        sortOrder: 0
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        parentItemId: "11111111-1111-1111-1111-111111111111",
        label: "Child",
        linkType: "url",
        url: "https://example.com",
        sortOrder: 1
      }
    ]);
    expect(result.valid).toBe(true);
  });

  test("validateMenuItemsInput rejects a duplicate id in the batch", () => {
    const item = {
      id: "11111111-1111-1111-1111-111111111111",
      parentItemId: null,
      label: "A",
      linkType: "url",
      url: "https://example.com",
      sortOrder: 0
    };
    const result = validateMenuItemsInput([item, { ...item, label: "B" }]);
    expect(result.valid).toBe(false);
  });

  describe("the item count is bounded (Issue #721)", () => {
    function validItem(n: number) {
      return {
        id: `11111111-1111-1111-1111-${String(n).padStart(12, "0")}`,
        parentItemId: null,
        label: `Item ${n}`,
        linkType: "url",
        url: "https://example.com",
        sortOrder: n
      };
    }

    test("exactly MAX_MENU_ITEMS is accepted", () => {
      // The boundary belongs to the accepting side: a cap that rejects its own
      // documented maximum is a different (and quieter) defect.
      const result = validateMenuItemsInput(
        Array.from({ length: MAX_MENU_ITEMS }, (_, n) => validItem(n))
      );

      expect(result.valid).toBe(true);
    });

    test("one over the cap is rejected, and the message names both numbers", () => {
      const result = validateMenuItemsInput(
        Array.from({ length: MAX_MENU_ITEMS + 1 }, (_, n) => validItem(n))
      );

      expect(result.valid).toBe(false);

      if (result.valid) return;

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.field).toBe("items");
      // An operator who sent 1,250 items needs to know the limit AND what they
      // sent; "too many items" sends them to count an array by hand.
      expect(result.errors[0]!.message).toContain(String(MAX_MENU_ITEMS));
      expect(result.errors[0]!.message).toContain(String(MAX_MENU_ITEMS + 1));
    });

    test("an oversized batch is refused WITHOUT validating every entry", () => {
      // The count is checked before the per-item pass, so an oversized array of
      // entirely invalid items yields ONE error rather than several per item.
      // This is the request-amplification half: without it, a 128 KB body of
      // garbage decides how much validation work the server does and how large
      // its refusal is. A cap applied after the per-item pass would still
      // return `valid: false` here and would not close that, so asserting the
      // error COUNT is what separates the two orderings.
      const junk = Array.from({ length: MAX_MENU_ITEMS + 500 }, () => ({}));
      const result = validateMenuItemsInput(junk);

      expect(result.valid).toBe(false);

      if (result.valid) return;

      expect(result.errors).toHaveLength(1);
    });
  });
});

describe("widget-policy", () => {
  test("isWidgetPosition recognizes the five valid positions", () => {
    expect(isWidgetPosition("sidebar")).toBe(true);
    expect(isWidgetPosition("bogus")).toBe(false);
  });

  test("validateCreateWidgetInput accepts a valid payload", () => {
    const result = validateCreateWidgetInput({
      position: "sidebar",
      title: "About",
      bodyText: "Plain text body."
    });
    expect(result.valid).toBe(true);
  });

  test("validateCreateWidgetInput rejects unsafe bodyText", () => {
    const result = validateCreateWidgetInput({
      position: "footer",
      title: "X",
      bodyText: "<script>alert(1)</script>"
    });
    expect(result.valid).toBe(false);
  });

  test("validateCreateWidgetInput rejects an invalid position", () => {
    const result = validateCreateWidgetInput({
      position: "top",
      title: "X"
    });
    expect(result.valid).toBe(false);
  });
});

describe("ad-policy", () => {
  test("isAdPlacementType recognizes the four valid types", () => {
    expect(isAdPlacementType("global")).toBe(true);
    expect(isAdPlacementType("bogus")).toBe(false);
  });

  test("validateCreateAdInput accepts a valid payload", () => {
    const result = validateCreateAdInput({
      name: "Sponsor",
      imageUrl: "https://cdn.example.com/ad.png",
      linkUrl: "https://sponsor.example.com"
    });
    expect(result.valid).toBe(true);
  });

  test("validateCreateAdInput rejects a relative imageUrl", () => {
    const result = validateCreateAdInput({
      name: "Sponsor",
      imageUrl: "/ad.png"
    });
    expect(result.valid).toBe(false);
  });

  test("validateCreateAdInput rejects endsAt before startsAt", () => {
    const result = validateCreateAdInput({
      name: "Sponsor",
      imageUrl: "https://cdn.example.com/ad.png",
      startsAt: "2026-06-01T00:00:00Z",
      endsAt: "2026-05-01T00:00:00Z"
    });
    expect(result.valid).toBe(false);
  });

  test("validateAdPlacementsInput requires targetId for non-global placements", () => {
    const result = validateAdPlacementsInput([{ placementType: "post" }]);
    expect(result.valid).toBe(false);
  });

  test("validateAdPlacementsInput rejects a targetId on a global placement", () => {
    const result = validateAdPlacementsInput([
      {
        placementType: "global",
        targetId: "11111111-1111-1111-1111-111111111111"
      }
    ]);
    expect(result.valid).toBe(false);
  });

  test("validateAdPlacementsInput accepts a mix of global and targeted placements", () => {
    const result = validateAdPlacementsInput([
      { placementType: "global" },
      {
        placementType: "widget",
        targetId: "11111111-1111-1111-1111-111111111111"
      }
    ]);
    expect(result.valid).toBe(true);
  });
});

describe("theme-policy", () => {
  test("isBlogThemeMode recognizes light, dark, system", () => {
    expect(isBlogThemeMode("dark")).toBe(true);
    expect(isBlogThemeMode("bogus")).toBe(false);
  });

  test("validateUpdateThemeSettingsInput accepts a valid mode", () => {
    const result = validateUpdateThemeSettingsInput({ mode: "dark" });
    expect(result.valid).toBe(true);
  });

  test("validateUpdateThemeSettingsInput rejects a missing/invalid mode", () => {
    expect(validateUpdateThemeSettingsInput({}).valid).toBe(false);
    expect(validateUpdateThemeSettingsInput({ mode: "blue" }).valid).toBe(
      false
    );
  });
});
