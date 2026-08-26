/**
 * The committed SeputarBorneo rubrik redirect map, held to the guards that will
 * actually judge it (Issue #711, ADR-0113).
 *
 * ## Why a test over a data file is worth writing here
 *
 * `tests/legacy-redirect-map.test.ts` is this file's cautionary sibling: it
 * asserted that a MIGRATION'S SOURCE TEXT contained `ALTER TABLE
 * awcms_blog_pages`, which proved the column existed and could not notice that
 * nothing ever read it. The columns were dead for months and were dropped in
 * `sql/147`.
 *
 * So this file does not assert that the map has 68 rows and move on. It pushes
 * every entry through `normalizeRedirectPath`, `validateRedirectTarget` and
 * `isValidSlug` — the same three the write path uses — because the failure this
 * map can actually produce is a rule that is silently unreachable, filed under a
 * key no request will ever generate.
 *
 * ## The map cannot be re-derived, which changes what a test is for
 *
 * Building it needed the legacy PHP working copy and the populated MariaDB
 * volume, both of which exist on one workstation. Once they are gone, a
 * corrupted map cannot be regenerated — only guessed at, which is the
 * mass-wrong-301 outcome #711 exists to prevent. These assertions are the only
 * thing standing between a careless edit and that.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  buildImportItems,
  chunk,
  findMapProblems,
  IMPORT_CHUNK_SIZE,
  type LegacyRubrikMap
} from "../scripts/blog-legacy-rubrik-redirects";
import { stripComments } from "../scripts/lib/source-text";
import { MAX_REDIRECT_IMPORT_ITEMS } from "../src/modules/seo-distribution/domain/redirect-rule";

const MAP_PATH = "data/seputarborneo-legacy/rubrik-redirects.json";
const BUILDER_PATH = "scripts/blog-legacy-rubrik-redirects.ts";

const map = JSON.parse(readFileSync(MAP_PATH, "utf8")) as LegacyRubrikMap;

/** The five with no resolvable destination, named so a silent change is visible. */
const ORPHANS = [
  "/rubrik/Olah%20Raga.html",
  "/rubrik/Viral.html",
  "/rubrik/kuliner.html",
  "/rubrik/pariwisata.html",
  "/rubrik/travel.html"
];

describe("SeputarBorneo legacy rubrik redirect map", () => {
  test("every source path and target passes the write-path guards", () => {
    // The whole point: not "the file parses", but "the write path would accept
    // every row of it". A raw space, a duplicate source, a self-redirect or an
    // un-normalized path each fail here rather than at hop 4,000 of a cutover.
    expect(findMapProblems(map)).toEqual([]);
  });

  test("the entry count is the COMPLETE link set, not a sample", () => {
    // 68 is not a target; it is how many listing links exist in the legacy PHP
    // tree. Nothing generates a rubrik URL from a column value, so a crawler
    // could only ever reach what was hand-typed. If this number changes, the
    // derivation changed and the README must say why.
    //
    // It was 67 until the sweep that produced ADR-0114: the original
    // extraction keyed on the `.html` suffix, and one nav link — `Pemkab
    // Lamandau` — is written without it in five templates. Finding it by hand
    // fixes one URL; the count is honest only because the tree was then
    // re-swept for the CLASS (every relative link literal lacking `.html`),
    // which returned that one plus `./video/?video=5`, already out of scope.
    expect(map.entries).toHaveLength(68);
  });

  test("63 entries carry a rule and exactly 5 deliberately do not", () => {
    const withRule = map.entries.filter((entry) => entry.targetPath !== null);
    const withoutRule = map.entries.filter(
      (entry) => entry.targetPath === null
    );

    expect(withRule).toHaveLength(63);
    expect(withoutRule.map((entry) => entry.sourcePath).sort()).toEqual(
      ORPHANS
    );
  });

  test("sourcePath is the encoded legacyHref — with ONE flagged exception", () => {
    // The map's quiet invariant, never asserted until now: a rule is filed
    // under the URL a browser sends for the link that was written, which is
    // the href with its spaces percent-encoded. An entry that drifts from its
    // own href is a rule for a URL nobody links to.
    //
    // Exactly one entry breaks it, and breaks it on purpose. The nav writes
    // `Mitra-Borneo/Pemkab Lamandau` with no `.html`; the legacy `.htaccess`
    // rewrites only `…\.html$`, so the linked form 404s while the `.html` form
    // serves. `sourcePath` is the form that SERVES. `hrefLacksHtmlSuffix`
    // marks it, and is checked against the href here rather than trusted —
    // a flag nothing verifies is a comment with a colon in it.
    const flagged = map.entries.filter((entry) => entry.hrefLacksHtmlSuffix);

    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.legacyHref).toBe("Mitra-Borneo/Pemkab Lamandau");
    expect(flagged[0]!.legacyHref.endsWith(".html")).toBe(false);

    for (const entry of map.entries) {
      const encoded = `/${entry.legacyHref.replaceAll(" ", "%20")}`;

      expect(entry.sourcePath).toBe(
        entry.hrefLacksHtmlSuffix ? `${encoded}.html` : encoded
      );
      // And the flag is never a way to hide a plain `.html` href.
      expect(entry.legacyHref.endsWith(".html")).toBe(
        entry.hrefLacksHtmlSuffix !== true
      );
    }
  });

  test("the recovered gap gets its SIBLINGS' treatment, not a new one", () => {
    // `Pemkab Lamandau` was missing for a year of this map's short life. When
    // a late entry arrives, the temptation is to give it a destination of its
    // own; the check that it did not is that `/kategori/mitra-borneo` still
    // serves all 24 `Mitra-Borneo/*` pairs and the destination set stayed at
    // ten. Its zero is measured, not assumed: the same snapshot answers 0 for
    // (`Mitra-Borneo`, `Pemkab Lamandau`) and 133 for the parent, and the live
    // page returns 200 with a listing byte-identical to a known-empty sibling.
    const entry = map.entries.find(
      (candidate) =>
        candidate.sourcePath === "/Mitra-Borneo/Pemkab%20Lamandau.html"
    );

    expect(entry).toBeDefined();
    expect(entry!.articlesAtCapture).toBe(0);
    expect(entry!.parentArticlesAtCapture).toBe(133);
    expect(entry!.targetPath).toBe("/kategori/mitra-borneo");

    const siblings = map.entries.filter(
      (candidate) => candidate.legacyNews.toLowerCase() === "mitra-borneo"
    );

    expect(siblings).toHaveLength(24);
    expect(new Set(siblings.map((candidate) => candidate.targetPath))).toEqual(
      new Set(["/kategori/mitra-borneo"])
    );
  });

  test("a null target is a DECISION, and the data says why", () => {
    // ADR-0113 sends a dead URL to its parent's archive when the parent
    // resolves. A null target therefore has to mean "no parent either" — if an
    // entry had a resolvable parent AND no rule, the map would be contradicting
    // the decision rather than expressing it.
    for (const entry of map.entries) {
      if (entry.targetPath === null) {
        expect(entry.parentArticlesAtCapture).toBe(0);
        expect(entry.canonicalRubrik).toEqual([]);
      } else {
        expect(entry.parentArticlesAtCapture).toBeGreaterThan(0);
        expect(entry.canonicalRubrik.length).toBeGreaterThan(0);
      }
    }
  });

  test("both casings of a linked rubrik are present, because matching is case-SENSITIVE", () => {
    // MariaDB's collation made `Hukum` and `hukum` the same page; this repo
    // matches `normalized_source_path` by equality and preserves case, so
    // dropping either spelling silently loses every URL indexed under it.
    for (const pair of [
      ["/rubrik/Hukum.html", "/rubrik/hukum.html"],
      ["/rubrik/Nasional.html", "/rubrik/nasional.html"],
      ["/rubrik/Politik.html", "/rubrik/politik.html"],
      ["/rubrik/Wisata.html", "/rubrik/wisata.html"],
      ["/rubrik/Budaya.html", "/rubrik/budaya.html"]
    ]) {
      const found = pair.map((path) =>
        map.entries.find((entry) => entry.sourcePath === path)
      );

      expect(found[0]).toBeDefined();
      expect(found[1]).toBeDefined();
      // And both must land in the same place — they were the same page.
      expect(found[0]!.targetPath).toBe(found[1]!.targetPath);
    }
  });

  test("no source path contains a raw space", () => {
    // The legacy hrefs mix raw spaces (`Daerah/Kota Waringin.html`) with
    // pre-encoded ones (`daerah/Kikim%20Area.html`). What a browser REQUESTS is
    // always the encoded form, and `normalizeRedirectPath` refuses whitespace
    // outright, so an un-encoded entry is a rule that could never fire.
    for (const entry of map.entries) {
      expect(entry.sourcePath).not.toContain(" ");
    }

    // At least one entry really did need encoding, or this proves nothing.
    expect(map.entries.some((entry) => entry.sourcePath.includes("%20"))).toBe(
      true
    );
  });

  test("every target is a /kategori/ path — the flatten decision, not a slug per pair", () => {
    // ADR-0113 drops `kt`. If a target ever carried a second segment, someone
    // reverted to the composite-slug alternative without amending the ADR.
    const targets = new Set(
      map.entries
        .map((entry) => entry.targetPath)
        .filter((target): target is string => target !== null)
    );

    for (const target of targets) {
      expect(target.startsWith("/kategori/")).toBe(true);
      expect(target.slice("/kategori/".length)).not.toContain("/");
    }

    // Ten destinations for 63 rules is the flatten working; one per pair would
    // be dozens.
    expect(targets.size).toBe(10);
  });

  test("a shape-3 URL lands on its FIRST segment's archive", () => {
    // `Mitra-Borneo/DPRD Kalteng.html` -> `?news=Mitra-Borneo&kt=DPRD Kalteng`,
    // and the decision keeps `news` and drops `kt`.
    const entry = map.entries.find(
      (candidate) => candidate.legacyHref === "Mitra-Borneo/DPRD Kalteng.html"
    );

    expect(entry).toBeDefined();
    expect(entry!.legacyNews).toBe("Mitra-Borneo");
    expect(entry!.legacyKategori).toBe("DPRD Kalteng");
    expect(entry!.targetPath).toBe("/kategori/mitra-borneo");
  });

  test("import items chunk to the endpoint's own cap", () => {
    const items = buildImportItems(map);

    expect(items).toHaveLength(63);

    // Two assertions, because each catches what the other cannot.
    //
    // The VALUE check below catches a copy that has already drifted: someone
    // lowers the endpoint's cap to 50 and leaves a local `200` behind. It does
    // NOT catch the copy itself — restore the pre-fix shape (a hard-coded
    // `= 200` under a comment claiming it mirrors the endpoint) and it stays
    // green, because 200 does equal 200 today. That is exactly the state this
    // test was written to forbid, and the comment above it used to claim it
    // was testing "identity, not equality of two literals" while testing
    // equality of two literals.
    //
    // So the SOURCE check comes first: the builder must bind the two names
    // together, so the drift is impossible rather than merely detected on the
    // day someone edits the cap. Comments are stripped before matching — a
    // comment saying `IMPORT_CHUNK_SIZE = MAX_REDIRECT_IMPORT_ITEMS` is the
    // very defect being excluded, and `scripts/lib/source-text` is this repo's
    // stripper for exactly that reason.
    const builder = stripComments(readFileSync(BUILDER_PATH, "utf8"));

    expect(builder).toMatch(
      /export const IMPORT_CHUNK_SIZE\s*=\s*MAX_REDIRECT_IMPORT_ITEMS\s*;/
    );
    expect(builder).toMatch(
      /import \{ MAX_REDIRECT_IMPORT_ITEMS \} from "[^"]*seo-distribution\/domain\/redirect-rule";/
    );

    // And the value check stays: the binding above is only worth anything if
    // the symbol it binds to is the one the endpoint actually enforces.
    expect(IMPORT_CHUNK_SIZE).toBe(MAX_REDIRECT_IMPORT_ITEMS);

    for (const batch of chunk(items, IMPORT_CHUNK_SIZE)) {
      expect(batch.length).toBeLessThanOrEqual(MAX_REDIRECT_IMPORT_ITEMS);
    }

    // Every item is a permanent redirect carrying a reason — the import
    // endpoint requires the first and audits the second.
    for (const item of items) {
      expect(item.statusCode).toBe(301);
      expect(item.reason.length).toBeGreaterThan(0);
    }
  });

  test("findMapProblems actually reports a broken entry", () => {
    // A validator nobody has seen fail is a validator nobody has tested. Three
    // corruptions, one per class it exists to catch.
    const raw = {
      ...map,
      entries: [
        { ...map.entries[0]!, sourcePath: "/Daerah/Kota Waringin.html" }
      ]
    };
    expect(findMapProblems(raw as LegacyRubrikMap)).toHaveLength(1);

    const duplicated = {
      ...map,
      entries: [map.entries[0]!, { ...map.entries[0]! }]
    };
    expect(findMapProblems(duplicated as LegacyRubrikMap)).toHaveLength(1);

    const selfRedirect = {
      ...map,
      entries: [
        {
          ...map.entries[0]!,
          sourcePath: "/kategori/daerah",
          targetPath: "/kategori/daerah"
        }
      ]
    };
    expect(findMapProblems(selfRedirect as LegacyRubrikMap)).toHaveLength(1);
  });
});
