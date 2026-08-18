import { describe, expect, test } from "bun:test";

import {
  isInstitutionBranch,
  isRegionCode,
  validateCreateInstitutionInput,
  validateSoftDeleteInstitutionInput,
  validateUpdateInstitutionInput,
  INSTITUTION_BRANCHES,
  INSTITUTION_BRANCH_LIST
} from "../src/modules/blog-content/domain/institution-validation";

/**
 * The institution registry (PRD LenteraKalteng §12.2, sql/131).
 *
 * These are pure-validator tests: no database, matching the rest of
 * `blog-content-domain.test.ts`. What they are really guarding is the SHAPE
 * contract between the validator and the two CHECK constraints in sql/131 —
 * if the two drift, a caller gets a raw constraint violation as a 500 instead
 * of a field-level 400.
 */

describe("institution branch vocabulary", () => {
  test("recognizes the two branches and nothing else", () => {
    expect(isInstitutionBranch("legislative")).toBe(true);
    expect(isInstitutionBranch("executive")).toBe(true);
    expect(isInstitutionBranch("judicial")).toBe(false);
    expect(isInstitutionBranch("")).toBe(false);
    expect(isInstitutionBranch(undefined)).toBe(false);
  });

  test("the message list is derived from the vocabulary, not retyped", () => {
    expect(INSTITUTION_BRANCH_LIST).toBe(INSTITUTION_BRANCHES.join(", "));
  });
});

describe("region code shape", () => {
  test("accepts every level the national master emits", () => {
    expect(isRegionCode("62")).toBe(true); // province
    expect(isRegionCode("62.71")).toBe(true); // regency/city
    expect(isRegionCode("62.71.01")).toBe(true); // district
    expect(isRegionCode("62.71.01.2001")).toBe(true); // village
  });

  test("rejects shapes the CHECK constraint would refuse", () => {
    expect(isRegionCode("6")).toBe(false); // single digit
    expect(isRegionCode("62.")).toBe(false); // trailing separator
    expect(isRegionCode("62-71")).toBe(false); // wrong separator
    expect(isRegionCode("ab.cd")).toBe(false); // not numeric
    expect(isRegionCode("62.71.01.2001.99")).toBe(false); // five levels
    expect(isRegionCode(62 as unknown)).toBe(false); // not a string
  });
});

describe("validateCreateInstitutionInput", () => {
  const valid = {
    branch: "legislative",
    name: "DPRD Kotawaringin Barat",
    slug: "dprd-kotawaringin-barat"
  };

  test("accepts the minimum body and defaults every optional to null", () => {
    const result = validateCreateInstitutionInput(valid);
    expect(result.valid).toBe(true);
    if (!result.valid) return;

    expect(result.value.branch).toBe("legislative");
    expect(result.value.name).toBe("DPRD Kotawaringin Barat");
    expect(result.value.slug).toBe("dprd-kotawaringin-barat");
    // `null`, never `undefined`: the INSERT binds these positionally, and an
    // `undefined` would be written as the string "undefined" by some drivers.
    expect(result.value.regionCode).toBeNull();
    expect(result.value.description).toBeNull();
    expect(result.value.seoTitle).toBeNull();
    expect(result.value.seoDescription).toBeNull();
  });

  test("carries the optional fields through when supplied", () => {
    const result = validateCreateInstitutionInput({
      ...valid,
      regionCode: "62.61",
      description: "  Regional legislature  ",
      seoTitle: "Berita DPRD Kotawaringin Barat",
      seoDescription: "Liputan terbaru DPRD Kotawaringin Barat."
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.regionCode).toBe("62.61");
    expect(result.value.description).toBe("Regional legislature");
    expect(result.value.seoTitle).toBe("Berita DPRD Kotawaringin Barat");
  });

  test("a whitespace-only optional collapses to null, not to an empty string", () => {
    // An empty string in `seo_title` renders an EMPTY <title> on the landing
    // page, which is worse than the absent-value fallback the renderer has.
    const result = validateCreateInstitutionInput({
      ...valid,
      seoTitle: "   "
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.seoTitle).toBeNull();
  });

  test("rejects a bad branch, naming the allowed set", () => {
    const result = validateCreateInstitutionInput({
      ...valid,
      branch: "judicial"
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    const error = result.errors.find((e) => e.field === "branch");
    expect(error?.message).toContain("legislative");
    expect(error?.message).toContain("executive");
  });

  test("rejects a slug that is not slug-shaped", () => {
    const result = validateCreateInstitutionInput({
      ...valid,
      slug: "DPRD Kobar"
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.field === "slug")).toBe(true);
  });

  test("rejects a malformed region code rather than storing it", () => {
    const result = validateCreateInstitutionInput({
      ...valid,
      regionCode: "62-61"
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.field === "regionCode")).toBe(true);
  });

  test("an explicitly null region code is allowed — a body need not sit in one region", () => {
    const result = validateCreateInstitutionInput({
      ...valid,
      regionCode: null
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.regionCode).toBeNull();
  });

  test("reports every problem at once, not just the first", () => {
    const result = validateCreateInstitutionInput({
      branch: "judicial",
      name: "",
      slug: "Not A Slug"
    });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateUpdateInstitutionInput", () => {
  test("copies only the fields present in the body", () => {
    const result = validateUpdateInstitutionInput({ name: "DPRD Kalteng" });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.name).toBe("DPRD Kalteng");
    expect("slug" in result.value).toBe(false);
    expect("regionCode" in result.value).toBe(false);
  });

  test("an explicit null clears an optional field", () => {
    const result = validateUpdateInstitutionInput({ seoDescription: null });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // Present AND null — the directory distinguishes "omitted, keep" from
    // "sent as null, clear", so the key must survive.
    expect("seoDescription" in result.value).toBe(true);
    expect(result.value.seoDescription).toBeNull();
  });

  test("rejects an empty body instead of recording a no-op edit", () => {
    // Accepting it would stamp `updated_at` and emit an audit event for a
    // change that did not happen.
    const result = validateUpdateInstitutionInput({});
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors[0]?.field).toBe("body");
  });

  test("rejects a malformed region code on update too", () => {
    const result = validateUpdateInstitutionInput({ regionCode: "banjarbaru" });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.field === "regionCode")).toBe(true);
  });

  test("clearing the region code is allowed", () => {
    const result = validateUpdateInstitutionInput({ regionCode: null });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.regionCode).toBeNull();
  });

  test("length limits match the create path exactly", () => {
    // The drift this guards: a field accepted on create and refused on the
    // next edit of the same row, which reads to an editor as data corruption.
    const tooLong = "x".repeat(201);
    const created = validateCreateInstitutionInput({
      branch: "executive",
      name: "Pemkab Kapuas",
      slug: "pemkab-kapuas",
      seoTitle: tooLong
    });
    const updated = validateUpdateInstitutionInput({ seoTitle: tooLong });
    expect(created.valid).toBe(false);
    expect(updated.valid).toBe(false);
  });
});

describe("validateSoftDeleteInstitutionInput", () => {
  test("requires a reason", () => {
    expect(validateSoftDeleteInstitutionInput({}).valid).toBe(false);
    expect(validateSoftDeleteInstitutionInput({ reason: "   " }).valid).toBe(
      false
    );
  });

  test("trims the reason it stores", () => {
    const result = validateSoftDeleteInstitutionInput({
      reason: "  Merged into the provincial body.  "
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value.reason).toBe("Merged into the provincial body.");
  });
});
