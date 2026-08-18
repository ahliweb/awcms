import { isValidSlug } from "./slug-policy";
import {
  validateDeleteReasonInput,
  type DeleteReasonInput
} from "./content-validation";

/**
 * The institution registry (PRD LenteraKalteng §12.2, migration sql/131).
 *
 * An institution is the legislative or executive body an article is filed
 * against — "DPRD Kotawaringin Barat", "Pemerintah Provinsi Kalimantan
 * Tengah". It is the third of the four classification dimensions PRD §8.5
 * keeps apart (channel, institution, region, topic), and the only one that is
 * neither a term nor a code:
 *
 * - `channel`/`topic` are plain labels, so sql/131 put them in
 *   `awcms_blog_terms` (see `taxonomy-policy.ts`);
 * - `region` references the national master by code (`region_code`), because
 *   PRD §12.3 forbids retyping the Kepmendagri list per tenant;
 * - an institution carries a `branch`, a region of its own, and the SEO
 *   metadata of a public landing page — none of which a term can hold without
 *   four columns that are NULL for every category and tag.
 *
 * Pure module: no database, no config, no `Bun.SQL`. Same contract as every
 * other validator in this folder, so tests can import it directly.
 */

export type ValidationError = {
  field: string;
  message: string;
};

/**
 * The two mega menus of PRD §8.3/§8.4 are built by filtering on this, which is
 * why it is a first-class field rather than a convention inside the slug —
 * `dprd-kapuas` and `pemkab-kapuas` are not something a query should have to
 * pattern-match to tell apart.
 */
export type InstitutionBranch = "legislative" | "executive";

export const INSTITUTION_BRANCHES: readonly InstitutionBranch[] = [
  "legislative",
  "executive"
];

export const INSTITUTION_BRANCH_LIST = INSTITUTION_BRANCHES.join(", ");

export function isInstitutionBranch(
  value: unknown
): value is InstitutionBranch {
  return (
    typeof value === "string" &&
    (INSTITUTION_BRANCHES as string[]).includes(value)
  );
}

/**
 * Dotted `idn_admin_regions` code: `62` (province), `62.71` (regency/city),
 * `62.71.01` (district), `62.71.01.2001` (village).
 *
 * Kept character-for-character in step with the
 * `awcms_blog_institutions_region_code_check` and
 * `awcms_blog_posts_region_code_check` constraints in sql/131. It validates
 * SHAPE only — whether a well-formed code resolves to a region in the ACTIVE
 * dataset is a question only `awcms_idn_admin_regions` can answer, and it is
 * answered at render time by degrading to "no region label" rather than by
 * refusing the write. Refusing here would make an institution un-editable the
 * day a Kepmendagri update retires its region code.
 */
export const REGION_CODE_PATTERN = /^[0-9]{2}(\.[0-9]{2}){0,2}(\.[0-9]{4})?$/;

export function isRegionCode(value: unknown): value is string {
  return typeof value === "string" && REGION_CODE_PATTERN.test(value);
}

const MAX_NAME_LENGTH = 150;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_SEO_TITLE_LENGTH = 200;
const MAX_SEO_DESCRIPTION_LENGTH = 320;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Shared by create and update for the four optional text fields, so the two
 * paths can never drift on length limits — the drift that produces a field
 * accepted on create and rejected on the next edit of the same row.
 */
function validateOptionalText(
  record: Record<string, unknown>,
  field: string,
  maxLength: number,
  errors: ValidationError[]
): string | null | undefined {
  const raw = record[field];

  if (raw === undefined) {
    return undefined;
  }

  if (raw === null) {
    return null;
  }

  if (typeof raw !== "string" || raw.length > maxLength) {
    errors.push({
      field,
      message: `${field} must be a string of at most ${maxLength} characters, or null.`
    });
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function validateRegionCodeField(
  record: Record<string, unknown>,
  errors: ValidationError[]
): string | null | undefined {
  const raw = record.regionCode;

  if (raw === undefined) {
    return undefined;
  }

  if (raw === null || raw === "") {
    return null;
  }

  if (!isRegionCode(raw)) {
    errors.push({
      field: "regionCode",
      message:
        "regionCode must be a dotted idn_admin_regions code such as 62, 62.71, 62.71.01 or 62.71.01.2001."
    });
    return undefined;
  }

  return raw;
}

export type CreateInstitutionInput = {
  branch: InstitutionBranch;
  name: string;
  slug: string;
  regionCode: string | null;
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

export type CreateInstitutionValidationResult =
  | { valid: true; value: CreateInstitutionInput }
  | { valid: false; errors: ValidationError[] };

/** `POST /api/v1/blog/institutions` — gated by `blog_content.institutions.create`. */
export function validateCreateInstitutionInput(
  body: unknown
): CreateInstitutionValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;

  if (!isInstitutionBranch(record.branch)) {
    errors.push({
      field: "branch",
      message: `branch must be one of ${INSTITUTION_BRANCH_LIST}.`
    });
  }

  if (!isNonEmptyString(record.name) || record.name.length > MAX_NAME_LENGTH) {
    errors.push({
      field: "name",
      message: `name is required and must be at most ${MAX_NAME_LENGTH} characters.`
    });
  }

  if (!isNonEmptyString(record.slug)) {
    errors.push({ field: "slug", message: "slug is required." });
  } else if (!isValidSlug(record.slug)) {
    errors.push({
      field: "slug",
      message:
        "slug must be lowercase alphanumeric segments separated by single hyphens."
    });
  }

  const regionCode = validateRegionCodeField(record, errors);
  const description = validateOptionalText(
    record,
    "description",
    MAX_DESCRIPTION_LENGTH,
    errors
  );
  const seoTitle = validateOptionalText(
    record,
    "seoTitle",
    MAX_SEO_TITLE_LENGTH,
    errors
  );
  const seoDescription = validateOptionalText(
    record,
    "seoDescription",
    MAX_SEO_DESCRIPTION_LENGTH,
    errors
  );

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      branch: record.branch as InstitutionBranch,
      name: (record.name as string).trim(),
      slug: (record.slug as string).trim(),
      regionCode: regionCode ?? null,
      description: description ?? null,
      seoTitle: seoTitle ?? null,
      seoDescription: seoDescription ?? null
    }
  };
}

export type UpdateInstitutionInput = {
  branch?: InstitutionBranch;
  name?: string;
  slug?: string;
  regionCode?: string | null;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

export type UpdateInstitutionValidationResult =
  | { valid: true; value: UpdateInstitutionInput }
  | { valid: false; errors: ValidationError[] };

/**
 * `PATCH /api/v1/blog/institutions/{id}` — gated by
 * `blog_content.institutions.update`. Only fields present in the body are
 * validated and copied, so an omitted field is "leave as is" while an explicit
 * `null` clears it.
 *
 * `slug` is mutable, unlike `homepage-section-policy.ts`'s `sectionType`: every
 * institution row has the same shape, so re-slugging one cannot leave it
 * holding configuration meant for a different shape. It does change a public
 * URL, which is why the action is separately grantable (sql/132) and why the
 * caller is expected to record a redirect — see `seo_distribution`.
 */
export function validateUpdateInstitutionInput(
  body: unknown
): UpdateInstitutionValidationResult {
  const errors: ValidationError[] = [];
  const record = (body ?? {}) as Record<string, unknown>;
  const value: UpdateInstitutionInput = {};

  if (record.branch !== undefined) {
    if (!isInstitutionBranch(record.branch)) {
      errors.push({
        field: "branch",
        message: `branch must be one of ${INSTITUTION_BRANCH_LIST}.`
      });
    } else {
      value.branch = record.branch;
    }
  }

  if (record.name !== undefined) {
    if (
      !isNonEmptyString(record.name) ||
      record.name.length > MAX_NAME_LENGTH
    ) {
      errors.push({
        field: "name",
        message: `name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters.`
      });
    } else {
      value.name = record.name.trim();
    }
  }

  if (record.slug !== undefined) {
    if (!isNonEmptyString(record.slug)) {
      errors.push({ field: "slug", message: "slug is required." });
    } else if (!isValidSlug(record.slug)) {
      errors.push({
        field: "slug",
        message:
          "slug must be lowercase alphanumeric segments separated by single hyphens."
      });
    } else {
      value.slug = record.slug.trim();
    }
  }

  if (record.regionCode !== undefined) {
    const regionCode = validateRegionCodeField(record, errors);
    if (regionCode !== undefined) {
      value.regionCode = regionCode;
    }
  }

  for (const [field, maxLength] of [
    ["description", MAX_DESCRIPTION_LENGTH],
    ["seoTitle", MAX_SEO_TITLE_LENGTH],
    ["seoDescription", MAX_SEO_DESCRIPTION_LENGTH]
  ] as const) {
    if (record[field] === undefined) {
      continue;
    }

    const parsed = validateOptionalText(record, field, maxLength, errors);
    if (parsed !== undefined) {
      value[field] = parsed;
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // An empty PATCH is a caller error, not a no-op write: accepting it would
  // stamp `updated_at` and emit an audit event recording a change that did not
  // happen. Same position `validateUpdateBlogTermInput`'s callers take.
  if (Object.keys(value).length === 0) {
    return {
      valid: false,
      errors: [
        {
          field: "body",
          message: "At least one field must be supplied."
        }
      ]
    };
  }

  return { valid: true, value };
}

export type SoftDeleteInstitutionInput = DeleteReasonInput;

export type SoftDeleteInstitutionValidationResult =
  | { valid: true; value: SoftDeleteInstitutionInput }
  | { valid: false; errors: ValidationError[] };

/** `DELETE /api/v1/blog/institutions/{id}` — reuses the module-wide delete-reason contract. */
export function validateSoftDeleteInstitutionInput(
  body: unknown
): SoftDeleteInstitutionValidationResult {
  return validateDeleteReasonInput(body);
}
