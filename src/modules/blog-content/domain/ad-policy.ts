import { isAbsoluteHttpUrl } from "./seo-validation";

/**
 * Ads (Issue #542 §Advertisement Management + §Security Requirements:
 * "Unsafe scripts or embeds must not be rendered... Advertisement
 * rendering must not become an XSS channel."). Ads carry only
 * `imageUrl`/`linkUrl` — both validated absolute http(s) URLs, same
 * `isAbsoluteHttpUrl` check `seo-validation.ts` uses for `canonicalUrl` —
 * there is no raw-HTML/embed field on an ad by construction, so rendering
 * can only ever emit `<img>`/`<a>` tags with escaped, pre-validated URLs
 * (see `application/ads-directory.ts`'s render helper), never arbitrary
 * markup.
 */
export type AdPlacementType = "global" | "widget" | "post" | "page";

export const AD_PLACEMENT_TYPES: readonly AdPlacementType[] = [
  "global",
  "widget",
  "post",
  "page"
];

export function isAdPlacementType(value: unknown): value is AdPlacementType {
  return (
    typeof value === "string" &&
    (AD_PLACEMENT_TYPES as string[]).includes(value)
  );
}

export type ValidationError = {
  field: string;
  message: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export type AdPlacementInput = {
  placementType: AdPlacementType;
  targetId: string | null;
};

/** `targetId` is required for `widget`/`post`/`page`, forbidden (must be absent/null) for `global` — mirrors the schema's own permissive column (nullable) with the actual rule enforced here, same "type gates which reference is meaningful" convention `menu-policy.ts` uses. */
export function validateAdPlacementInput(
  body: unknown,
  index: number
):
  | { valid: true; value: AdPlacementInput }
  | { valid: false; errors: ValidationError[] } {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const prefix = `placements[${index}]`;

  if (!isAdPlacementType(record.placementType)) {
    errors.push({
      field: `${prefix}.placementType`,
      message: `placementType must be one of ${AD_PLACEMENT_TYPES.join(", ")}.`
    });
    return { valid: false, errors };
  }

  if (record.placementType === "global") {
    if (record.targetId !== undefined && record.targetId !== null) {
      errors.push({
        field: `${prefix}.targetId`,
        message: "targetId must be omitted for a global placement."
      });
    }
  } else if (
    typeof record.targetId !== "string" ||
    !UUID_PATTERN.test(record.targetId)
  ) {
    errors.push({
      field: `${prefix}.targetId`,
      message: `targetId is required and must be a UUID for a ${record.placementType} placement.`
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      placementType: record.placementType,
      targetId:
        record.placementType === "global" ? null : (record.targetId as string)
    }
  };
}

export function validateAdPlacementsInput(
  body: unknown
):
  | { valid: true; value: AdPlacementInput[] }
  | { valid: false; errors: ValidationError[] } {
  if (!Array.isArray(body)) {
    return {
      valid: false,
      errors: [{ field: "placements", message: "placements must be an array." }]
    };
  }

  const errors: ValidationError[] = [];
  const placements: AdPlacementInput[] = [];

  body.forEach((item, index) => {
    const result = validateAdPlacementInput(item, index);

    if (!result.valid) {
      errors.push(...result.errors);
    } else {
      placements.push(result.value);
    }
  });

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: placements };
}

export type CreateAdInput = {
  name: string;
  imageUrl: string;
  linkUrl: string | null;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
};

export type CreateAdValidationResult =
  | { valid: true; value: CreateAdInput }
  | { valid: false; errors: ValidationError[] };

function parseOptionalDate(
  value: unknown,
  field: string,
  errors: ValidationError[]
): Date | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string") {
    errors.push({
      field,
      message: `${field} must be an ISO 8601 datetime string.`
    });
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    errors.push({
      field,
      message: `${field} must be a valid ISO 8601 datetime.`
    });
    return null;
  }

  return parsed;
}

export function validateCreateAdInput(body: unknown): CreateAdValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (!isNonEmptyString(record.name)) {
    errors.push({ field: "name", message: "name is required." });
  }

  if (
    !isNonEmptyString(record.imageUrl) ||
    !isAbsoluteHttpUrl(record.imageUrl)
  ) {
    errors.push({
      field: "imageUrl",
      message: "imageUrl is required and must be an absolute http(s) URL."
    });
  }

  let linkUrl: string | null = null;

  if (record.linkUrl !== undefined && record.linkUrl !== null) {
    if (
      typeof record.linkUrl !== "string" ||
      !isAbsoluteHttpUrl(record.linkUrl)
    ) {
      errors.push({
        field: "linkUrl",
        message: "linkUrl must be an absolute http(s) URL when provided."
      });
    } else {
      linkUrl = record.linkUrl;
    }
  }

  const startsAt = parseOptionalDate(record.startsAt, "startsAt", errors);
  const endsAt = parseOptionalDate(record.endsAt, "endsAt", errors);

  if (startsAt && endsAt && endsAt <= startsAt) {
    errors.push({ field: "endsAt", message: "endsAt must be after startsAt." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      name: (record.name as string).trim(),
      imageUrl: record.imageUrl as string,
      linkUrl,
      isActive: record.isActive !== false,
      startsAt,
      endsAt
    }
  };
}

export type UpdateAdInput = {
  name?: string;
  imageUrl?: string;
  linkUrl?: string | null;
  isActive?: boolean;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export type UpdateAdValidationResult =
  | { valid: true; value: UpdateAdInput }
  | { valid: false; errors: ValidationError[] };

export function validateUpdateAdInput(body: unknown): UpdateAdValidationResult {
  const record = (body ?? {}) as Record<string, unknown>;
  const errors: ValidationError[] = [];
  const value: UpdateAdInput = {};

  if (record.name !== undefined) {
    if (!isNonEmptyString(record.name)) {
      errors.push({
        field: "name",
        message: "name must be a non-empty string."
      });
    } else {
      value.name = record.name.trim();
    }
  }

  if (record.imageUrl !== undefined) {
    if (
      typeof record.imageUrl !== "string" ||
      !isAbsoluteHttpUrl(record.imageUrl)
    ) {
      errors.push({
        field: "imageUrl",
        message: "imageUrl must be an absolute http(s) URL."
      });
    } else {
      value.imageUrl = record.imageUrl;
    }
  }

  if (record.linkUrl !== undefined) {
    if (record.linkUrl === null) {
      value.linkUrl = null;
    } else if (
      typeof record.linkUrl !== "string" ||
      !isAbsoluteHttpUrl(record.linkUrl)
    ) {
      errors.push({
        field: "linkUrl",
        message: "linkUrl must be an absolute http(s) URL when provided."
      });
    } else {
      value.linkUrl = record.linkUrl;
    }
  }

  if (record.isActive !== undefined) {
    if (typeof record.isActive !== "boolean") {
      errors.push({
        field: "isActive",
        message: "isActive must be a boolean."
      });
    } else {
      value.isActive = record.isActive;
    }
  }

  if (record.startsAt !== undefined) {
    value.startsAt = parseOptionalDate(record.startsAt, "startsAt", errors);
  }

  if (record.endsAt !== undefined) {
    value.endsAt = parseOptionalDate(record.endsAt, "endsAt", errors);
  }

  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    errors.push({ field: "endsAt", message: "endsAt must be after startsAt." });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value };
}
