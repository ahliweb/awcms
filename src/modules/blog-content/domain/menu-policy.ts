import { isAbsoluteHttpUrl } from "./seo-validation";

/**
 * Menus (Issue #542 §Menus: "Support hierarchical navigation. Menu items
 * can reference internal blog content or safe external URLs. Unsafe URLs
 * must be rejected."). `linkType` gates which of `targetId`/`url` is
 * meaningful — mirrors the schema's own `CHECK` constraint
 * (`awcms_blog_menu_items_link_type_check`), this is the pre-insert
 * application-layer check that returns a field-level error instead of a
 * raw constraint violation, same convention `taxonomy-policy.ts` uses for
 * tag/parent rules.
 */
export type MenuLinkType = "post" | "page" | "url";

export const MENU_LINK_TYPES: readonly MenuLinkType[] = ["post", "page", "url"];

export function isMenuLinkType(value: unknown): value is MenuLinkType {
  return (
    typeof value === "string" && (MENU_LINK_TYPES as string[]).includes(value)
  );
}

export type ValidationError = {
  field: string;
  message: string;
};

export type MenuItemInput = {
  id: string;
  parentItemId: string | null;
  label: string;
  linkType: MenuLinkType;
  targetId: string | null;
  url: string | null;
  sortOrder: number;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates one menu item. `id` is **client-supplied** (not DB-generated)
 * and **required**: menu items are always fully replaced on every write
 * (`menu-directory.ts`'s `syncMenuItems` deletes-then-reinserts the whole
 * set), so a `parentItemId` referencing a row from a *previous* write would
 * already be gone by insert time — self-supplied ids let `parentItemId`
 * reference a sibling item in the *same* payload instead, resolved via a
 * two-pass insert (parents before children, one level of nesting only,
 * same depth limit `taxonomy-policy.ts` enforces for category/tag
 * parents). `parentItemId`, when present, must reference a *different*
 * item's `id` in the same batch (self-parent rejected, same rule
 * `validateTermParent` enforces for taxonomy terms).
 */
export function validateMenuItemInput(
  body: unknown,
  index: number
):
  | { valid: true; value: MenuItemInput }
  | { valid: false; errors: ValidationError[] } {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const prefix = `items[${index}]`;

  if (typeof record.id !== "string" || !UUID_PATTERN.test(record.id)) {
    errors.push({
      field: `${prefix}.id`,
      message: "id is required and must be a UUID."
    });
  }

  if (!isNonEmptyString(record.label)) {
    errors.push({ field: `${prefix}.label`, message: "label is required." });
  }

  if (!isMenuLinkType(record.linkType)) {
    errors.push({
      field: `${prefix}.linkType`,
      message: "linkType must be one of post, page, url."
    });
  }

  let targetId: string | null = null;
  let url: string | null = null;

  if (record.linkType === "post" || record.linkType === "page") {
    if (
      typeof record.targetId !== "string" ||
      !UUID_PATTERN.test(record.targetId)
    ) {
      errors.push({
        field: `${prefix}.targetId`,
        message: "targetId is required and must be a UUID for post/page links."
      });
    } else {
      targetId = record.targetId;
    }
  } else if (record.linkType === "url") {
    if (typeof record.url !== "string" || !isAbsoluteHttpUrl(record.url)) {
      errors.push({
        field: `${prefix}.url`,
        message:
          "url is required and must be an absolute http(s) URL for url links."
      });
    } else {
      url = record.url;
    }
  }

  const parentItemId =
    record.parentItemId === undefined || record.parentItemId === null
      ? null
      : record.parentItemId;

  if (parentItemId !== null) {
    if (typeof parentItemId !== "string" || !UUID_PATTERN.test(parentItemId)) {
      errors.push({
        field: `${prefix}.parentItemId`,
        message: "parentItemId must be a UUID when provided."
      });
    } else if (typeof record.id === "string" && parentItemId === record.id) {
      errors.push({
        field: `${prefix}.parentItemId`,
        message: "A menu item cannot be its own parent."
      });
    }
  }

  const sortOrder =
    typeof record.sortOrder === "number" && Number.isInteger(record.sortOrder)
      ? record.sortOrder
      : index;

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      id: record.id as string,
      parentItemId: parentItemId as string | null,
      label: (record.label as string).trim(),
      linkType: record.linkType as MenuLinkType,
      targetId,
      url,
      sortOrder
    }
  };
}

export function validateMenuItemsInput(
  body: unknown
):
  | { valid: true; value: MenuItemInput[] }
  | { valid: false; errors: ValidationError[] } {
  if (!Array.isArray(body)) {
    return {
      valid: false,
      errors: [{ field: "items", message: "items must be an array." }]
    };
  }

  const errors: ValidationError[] = [];
  const items: MenuItemInput[] = [];

  body.forEach((item, index) => {
    const result = validateMenuItemInput(item, index);

    if (!result.valid) {
      errors.push(...result.errors);
    } else {
      items.push(result.value);
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const idsSeen = new Set<string>();

  for (const item of items) {
    if (idsSeen.has(item.id)) {
      errors.push({
        field: "items",
        message: `Duplicate item id "${item.id}".`
      });
    }

    idsSeen.add(item.id);
  }

  const byId = new Map(items.map((item) => [item.id, item]));

  for (const item of items) {
    if (item.parentItemId === null) {
      continue;
    }

    const parent = byId.get(item.parentItemId);

    if (!parent) {
      errors.push({
        field: "items",
        message: `Item "${item.id}" references parentItemId "${item.parentItemId}", which is not in this batch.`
      });
    } else if (parent.parentItemId !== null) {
      errors.push({
        field: "items",
        message: `Item "${item.id}" is nested under a non-root item — only one level of menu nesting is supported.`
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: items };
}
