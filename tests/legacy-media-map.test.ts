/**
 * The legacy image handoff (Issue #599).
 *
 * ## What is at risk
 *
 * `renderGalleryBlockHtml` DROPS a gallery item whose media object does not
 * resolve — silently, by design, because a public page must degrade rather than
 * 500. That makes a wrong media object id the worst possible input to a bulk
 * import: the run reports success, the article looks imported, and its
 * photographs are gone. Nobody re-reads 23,906 articles.
 *
 * So the properties pinned here are about REFUSING, not about mapping:
 *
 * 1. A map that is not a flat `{ src: uuid }` object is refused as a whole.
 * 2. Every problem in it is reported, not just the first.
 * 3. `src` keys are matched LITERALLY — no trimming, no normalising — because
 *    a wrong match and a missing one have the same consequence, and only one of
 *    them is visible in a report.
 *
 * The registry check itself is not here: "is this a verified media object of
 * this tenant" is `isMediaReferenceSafe`, which needs a database, and
 * `tests/integration/legacy-import.integration.test.ts` is where that lives.
 *
 * Pure — no database.
 */
import { describe, expect, test } from "bun:test";

import {
  mediaObjectIdsIn,
  parseLegacyMediaMap,
  summariseLegacyImageUsage
} from "../src/modules/blog-content/domain/legacy-media-map";

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

describe("the map is refused as a whole, or accepted as a whole", () => {
  test("a usable map parses", () => {
    const result = parseLegacyMediaMap({
      "http://legacy.example/a.jpg": ID_A,
      "/uploads/b.png": ID_B
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.get("http://legacy.example/a.jpg")).toBe(ID_A);
    expect(result.value.get("/uploads/b.png")).toBe(ID_B);
  });

  test("anything that is not a flat object is refused", () => {
    for (const raw of [null, [], "x", 5, undefined]) {
      expect(parseLegacyMediaMap(raw).ok).toBe(false);
    }
  });

  test("a value that is not a media object uuid is refused, by name", () => {
    const result = parseLegacyMediaMap({
      "a.jpg": ID_A,
      "b.jpg": "https://cdn.example/b.jpg",
      "c.jpg": 42
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // BOTH, not just the first — an operator fixing a 24,000-entry file one
    // error per run is an operator who gives up.
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join("\n")).toContain("b.jpg");
    expect(result.errors.join("\n")).toContain("c.jpg");
  });

  test("one bad entry refuses the map even though the others are fine", () => {
    // Partial acceptance would import the good rows and leave the rest as a
    // second, forgotten run — with a live site half-migrated in between.
    const result = parseLegacyMediaMap({ "a.jpg": ID_A, "b.jpg": "nope" });

    expect(result.ok).toBe(false);
  });

  test("keys are matched literally", () => {
    // Normalising a `src` — trimming a slash, lower-casing a host — would
    // silently change which file an article points at. A miss is reported; a
    // wrong match is not.
    const result = parseLegacyMediaMap({ " a.jpg ": ID_A });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.has(" a.jpg ")).toBe(true);
    expect(result.value.has("a.jpg")).toBe(false);
  });

  test("distinct ids are collected once, for one registry round trip", () => {
    const result = parseLegacyMediaMap({
      "a.jpg": ID_A,
      "a-copy.jpg": ID_A,
      "b.jpg": ID_B
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(mediaObjectIdsIn(result.value)).toEqual([ID_A, ID_B]);
  });
});

describe("the upload set", () => {
  test("counts ARTICLES, not tags, and orders by demand", () => {
    const usage = summariseLegacyImageUsage([
      ["a.jpg", "a.jpg", "b.jpg"],
      ["a.jpg"],
      ["c.jpg"]
    ]);

    // `a.jpg` twice in one article is one article: this is an upload list, and
    // the count exists only to order it.
    expect(usage).toEqual([
      { src: "a.jpg", articles: 2 },
      { src: "b.jpg", articles: 1 },
      { src: "c.jpg", articles: 1 }
    ]);
  });

  test("an `<img>` with no `src` contributes nothing", () => {
    expect(summariseLegacyImageUsage([["", "  ", "a.jpg"]])).toEqual([
      { src: "a.jpg", articles: 1 }
    ]);
  });

  test("an archive with no images produces an empty set, not an error", () => {
    expect(summariseLegacyImageUsage([])).toEqual([]);
    expect(summariseLegacyImageUsage([[], []])).toEqual([]);
  });
});
