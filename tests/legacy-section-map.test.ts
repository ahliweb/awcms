/**
 * The legacy SECTION handoff, and the `content_json` envelope it lands in
 * (Issues #599 / #711, ADR-0115).
 *
 * ## What is at risk, measured rather than argued
 *
 * `importLegacyBlogPost` wrote a hard-coded `{ blocks: [] }`. Two consequences,
 * both in `ahliweb/awcms-astro`, the repo that renders this archive, and both
 * invisible from here because `/blog/{code}/{slug}` renders these rows from
 * `body_portable_text` and looks perfect:
 *
 *  1. `renderContentBlocks(post.contentJson)` reads `contentJson.blocks` and
 *     returns `""` for a non-array or an empty one — every imported article a
 *     blank page.
 *  2. `getArticles(tab, locale)` keeps a post only when
 *     `readBlock(post).kategori === tab`, reading `contentJson.awcmsAstro`.
 *     With no such key that is `undefined === tab` for every configured tab, so
 *     the post is not built AT ALL — no article page, and no category archive
 *     either, because those are assembled from the same tab-filtered set.
 *
 * Run against that repo's real adapter before this was written: a post carrying
 * the sidecar built 1 article; a post written exactly as this importer wrote it
 * built **0**, in every configured tab. So all 63 rubrik rules of ADR-0113 and
 * the id-keyed article map of ADR-0114 would have redirected onto pages that
 * were never generated.
 *
 * ## What is pinned here, and what deliberately is not
 *
 * These are DB-free: the map parser, the ambiguity rule, and the envelope
 * builder. What they cannot prove is that the INSERT actually calls the
 * builder — a pure test passes just as happily over a function nothing invokes,
 * which is exactly how the empty envelope survived. That half is
 * `tests/integration/legacy-import.integration.test.ts`, which reads
 * `content_json` back out of Postgres.
 */
import { describe, expect, test } from "bun:test";

import {
  parseLegacySectionMap,
  resolveLegacySection,
  sectionsIn
} from "../src/modules/blog-content/domain/legacy-section-map";
import { legacyContentJson } from "../src/modules/blog-content/application/legacy-import-directory";
import type { PortableTextDocument } from "../src/modules/blog-content/domain/portable-text";

const BODY: PortableTextDocument = [
  {
    _type: "block",
    _key: "b1",
    style: "normal",
    children: [{ _type: "span", _key: "s1", text: "Air naik.", marks: [] }],
    markDefs: []
  }
];

describe("the section map is refused as a whole, or accepted as a whole", () => {
  test("a usable map parses", () => {
    const result = parseLegacySectionMap({
      HUKUM: "hukum",
      "MITRA BORNEO": "mitra-borneo"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.get("HUKUM")).toBe("hukum");
    expect(result.value.get("MITRA BORNEO")).toBe("mitra-borneo");
  });

  test("a non-object is refused rather than coerced", () => {
    for (const raw of [null, [], "hukum", 7]) {
      const result = parseLegacySectionMap(raw);
      expect(result.ok).toBe(false);
    }
  });

  test("every problem is reported, not just the first", () => {
    const result = parseLegacySectionMap({
      HUKUM: "Hukum",
      DAERAH: 7,
      "": "umum"
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(3);
  });

  test("a value that is not a valid slug is refused, because it becomes a URL segment", () => {
    // `Hukum` (capital), `mitra borneo` (space) and `hukum/` (separator) are
    // each a path a reader cannot be sent to. `isValidSlug` is the repo's ONE
    // slug rule and is imported rather than restated — a second copy here would
    // be the divergence this whole module exists to avoid.
    for (const bad of ["Hukum", "mitra borneo", "hukum/", "-hukum", ""]) {
      const result = parseLegacySectionMap({ HUKUM: bad });
      expect(result.ok).toBe(false);
    }
  });

  test("names are matched literally — two spellings are two entries", () => {
    // `MITRA BORNEO` (11,767 articles) and `MITRA-BORNEO` (133) are both real
    // values in the SeputarBorneo archive. Normalising would silently decide
    // they are one rubrik.
    const result = parseLegacySectionMap({
      "MITRA BORNEO": "mitra-borneo",
      "MITRA-BORNEO": "mitra-borneo"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.size).toBe(2);
    expect(sectionsIn(result.value)).toEqual(["mitra-borneo"]);
  });
});

describe("one article belongs to one section", () => {
  const MAP = new Map([
    ["HUKUM", "hukum"],
    ["PIDANA", "hukum"],
    ["DAERAH", "daerah"]
  ]);

  test("categories agreeing on one section resolve to it", () => {
    expect(resolveLegacySection(["HUKUM", "PIDANA"], MAP)).toEqual({
      ok: true,
      section: "hukum"
    });
  });

  test("a category the map does not cover is ignored when another one decides", () => {
    expect(resolveLegacySection(["HUKUM", "UNMAPPED"], MAP)).toEqual({
      ok: true,
      section: "hukum"
    });
  });

  test("two sections is REFUSED, never settled by position", () => {
    // The order of `categories` is whatever the export emitted. Taking the
    // first would put an article in a different section depending on how a
    // SELECT came back — reproducible only by accident.
    const forward = resolveLegacySection(["HUKUM", "DAERAH"], MAP);
    const reverse = resolveLegacySection(["DAERAH", "HUKUM"], MAP);

    expect(forward).toEqual({
      ok: false,
      reason: "ambiguous",
      sections: ["daerah", "hukum"]
    });
    // Identical, INCLUDING the order of `sections`, so the refusal text does
    // not depend on the input order either.
    expect(reverse).toEqual(forward);
  });

  test("no mapped category at all is `unmapped`, and so is no category at all", () => {
    expect(resolveLegacySection(["NOTHING"], MAP)).toEqual({
      ok: false,
      reason: "unmapped",
      sections: []
    });
    expect(resolveLegacySection([], MAP)).toEqual({
      ok: false,
      reason: "unmapped",
      sections: []
    });
  });
});

describe("the content_json envelope an imported row lands with", () => {
  test("blocks are DERIVED from the body, never an empty array", () => {
    // The defect in one assertion. `{ blocks: [] }` is what shipped, and it
    // made `renderContentBlocks` return "" for all 25,029 articles.
    const envelope = legacyContentJson(BODY, "hukum");

    expect(Array.isArray(envelope.blocks)).toBe(true);
    expect((envelope.blocks as unknown[]).length).toBeGreaterThan(0);
  });

  test("a body with words never projects to an empty blocks array", () => {
    // Stated separately from the assertion above because it is the property
    // the CONSUMER depends on: `renderContentBlocks` treats an empty array
    // exactly like a missing one, so "blocks exists" is not the claim that
    // matters — "blocks carries the words" is.
    const rendered = JSON.stringify(legacyContentJson(BODY, null).blocks);
    expect(rendered).toContain("Air naik.");
  });

  test("the section lands at awcmsAstro.kategori — the exact key the consumer filters on", () => {
    // The key name is load-bearing and belongs to another repository:
    // `readBlock` looks up `contentJson.awcmsAstro` and `getArticles` compares
    // `.kategori`. A rename on either side is a silent zero-page build, so the
    // literal strings are pinned here rather than referenced through a
    // constant that would rename with the code.
    const envelope = legacyContentJson(BODY, "hukum");

    expect(envelope.awcmsAstro).toEqual({
      schemaVersion: 1,
      kategori: "hukum"
    });
  });

  test("no section OMITS the key rather than writing a null one", () => {
    const envelope = legacyContentJson(BODY, null);

    expect("awcmsAstro" in envelope).toBe(false);
    // Still a real projection: an article with no section is invisible to the
    // sibling site but must still render here and in any later backfill.
    expect((envelope.blocks as unknown[]).length).toBeGreaterThan(0);
  });
});
