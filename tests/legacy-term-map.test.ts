/**
 * The legacy category handoff (Issue #599).
 *
 * ## What is at risk
 *
 * An article that imports with no category is not a broken-looking article. It
 * renders, it reads correctly, and the only visible symptom is somewhere else
 * entirely: `/{locale}/kategori/{slug}`, the page the legacy rubrik URL is
 * redirected to, loads and lists nothing. A crawler reads that as a SOFT 404 —
 * worse than the hard 404 this issue exists to prevent, because nothing reports
 * it and no test that looks at an article would ever see it.
 *
 * So the properties pinned here are about REFUSING and about NOT INVENTING:
 *
 * 1. A map that is not a flat `{ name: uuid }` object is refused as a whole.
 * 2. Every problem in it is reported, not just the first.
 * 3. Names are matched LITERALLY — no case folding, no trimming of interior
 *    space — because a wrong match files articles under a category the newsroom
 *    did not choose, and that reads as correct.
 *
 * The taxonomy check itself is not here: "is this a live term of this tenant"
 * is `findUnknownTermIds`, which needs a database.
 *
 * Pure — no database.
 */
import { describe, expect, test } from "bun:test";

import {
  parseLegacyTermMap,
  summariseLegacyCategoryUsage,
  termIdsIn
} from "../src/modules/blog-content/domain/legacy-term-map";

const TERM_A = "11111111-1111-4111-8111-111111111111";
const TERM_B = "22222222-2222-4222-8222-222222222222";

describe("parsing a term map", () => {
  test("a flat name -> uuid object parses", () => {
    const result = parseLegacyTermMap({ Daerah: TERM_A, Politik: TERM_B });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.get("Daerah")).toBe(TERM_A);
    expect(result.value.size).toBe(2);
  });

  test("an array is refused as a whole", () => {
    const result = parseLegacyTermMap([{ Daerah: TERM_A }]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("must be a JSON object");
  });

  test("every bad entry is reported, not just the first", () => {
    const result = parseLegacyTermMap({
      Daerah: "not-a-uuid",
      Politik: 7,
      Olahraga: TERM_A
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // An operator fixing a file one error per run is an operator who gives up.
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join(" ")).toContain("Daerah");
    expect(result.errors.join(" ")).toContain("Politik");
  });

  test("an empty name key is refused", () => {
    const result = parseLegacyTermMap({ "   ": TERM_A });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("empty category-name key");
  });

  test("names are matched LITERALLY — case and spacing are not normalised", () => {
    const result = parseLegacyTermMap({ "Daerah ": TERM_A, daerah: TERM_B });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Three distinct legacy spellings are three distinct decisions for the
    // operator to make. Folding them here would silently decide that two
    // rubrics are the same one.
    expect(result.value.get("Daerah ")).toBe(TERM_A);
    expect(result.value.get("daerah")).toBe(TERM_B);
    expect(result.value.get("Daerah")).toBeUndefined();
  });

  test("distinct ids are collapsed for one round trip", () => {
    const result = parseLegacyTermMap({
      Daerah: TERM_A,
      Politik: TERM_A,
      Olahraga: TERM_B
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect([...termIdsIn(result.value)].sort()).toEqual([TERM_A, TERM_B]);
  });
});

describe("the category work list", () => {
  test("counts ARTICLES, most-used first", () => {
    const usage = summariseLegacyCategoryUsage([
      ["Daerah", "Politik"],
      ["Daerah"],
      ["Daerah"],
      ["Politik"]
    ]);

    expect(usage).toEqual([
      { name: "Daerah", articles: 3 },
      { name: "Politik", articles: 2 }
    ]);
  });

  test("one article filed under the same category twice counts once", () => {
    const usage = summariseLegacyCategoryUsage([["Daerah", "Daerah"]]);

    // The count exists to ORDER the list, not to total the mentions.
    expect(usage).toEqual([{ name: "Daerah", articles: 1 }]);
  });

  test("ties break by name, so the list is stable to diff", () => {
    const usage = summariseLegacyCategoryUsage([["Zeta"], ["Alpha"]]);

    expect(usage.map((entry) => entry.name)).toEqual(["Alpha", "Zeta"]);
  });

  test("blank names never reach the work list", () => {
    const usage = summariseLegacyCategoryUsage([["   ", "Daerah"]]);

    expect(usage).toEqual([{ name: "Daerah", articles: 1 }]);
  });
});
