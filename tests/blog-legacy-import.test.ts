/**
 * Issue #599 — the bulk import of 23,906 legacy articles, and the redirect map
 * derived from it.
 *
 * ## What is actually at risk
 *
 * Not the arithmetic. Three things, each of which fails silently and is
 * expensive to undo once the archive is in:
 *
 * 1. **`published_at`.** The whole issue is SEO equity. An import that re-dates
 *    every article to the cutover afternoon has moved the archive and thrown
 *    away the thing that made it worth moving — and the row looks completely
 *    normal afterwards.
 * 2. **Silent repair.** The converter rejects `<script>`, `<iframe>` and
 *    unmanaged images. An importer that stored the sanitized remainder would
 *    produce articles that look imported and are missing their pictures.
 * 3. **The second hop.** ADR-0098 made `/blog/{code}/{slug}` locale-prefixed,
 *    so a redirect target built against the pre-ADR shape sends a crawler to a
 *    path that immediately redirects again — the two-hop chain this issue's own
 *    acceptance criterion forbids (PRD §9.2).
 *
 * Pure — no database. The SQL half is exercised in
 * `tests/integration/legacy-import.integration.test.ts`.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";
import { parseLegacyImportRecord } from "../src/modules/blog-content/domain/legacy-import-record";

const DIRECTORY =
  "src/modules/blog-content/application/legacy-import-directory.ts";
const POST_DIRECTORY =
  "src/modules/blog-content/application/blog-post-directory.ts";
const IMPORT_SCRIPT = "scripts/blog-legacy-import.ts";
const REDIRECT_SCRIPT = "scripts/blog-legacy-redirects-import.ts";

const DEFAULTS = { locale: "id" } as const;

function record(overrides: Record<string, unknown> = {}) {
  return {
    legacyId: "48213",
    title: "Banjir melanda Kobar",
    slug: "banjir-melanda-kobar",
    bodyHtml: "<p>Air naik.</p>",
    publishedAt: "2019-03-04T02:11:00Z",
    ...overrides
  };
}

describe("parsing one legacy line", () => {
  test("a well-formed line parses, keeping its original date", () => {
    const result = parseLegacyImportRecord(record(), DEFAULTS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.legacyId).toBe("48213");
    expect(result.value.publishedAt?.toISOString()).toBe(
      "2019-03-04T02:11:00.000Z"
    );
    // Not supplied, so it takes the run's default rather than the repo default:
    // a SeputarBorneo archive is Indonesian.
    expect(result.value.locale).toBe("id");
  });

  test("a line with no legacyId is refused", () => {
    // Without it the redirect map cannot be derived after the fact, which is
    // the permanent loss this issue exists to prevent. Importing it under a
    // generated id would look fine until somebody tried to build the 301s.
    const result = parseLegacyImportRecord(
      record({ legacyId: "  " }),
      DEFAULTS
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("legacyId is required");
  });

  test("a published line with no date is refused, not silently re-dated", () => {
    const result = parseLegacyImportRecord(
      record({ publishedAt: undefined }),
      DEFAULTS
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain(
      "publishedAt is required when status is 'published'"
    );
  });

  test("a draft line needs no date", () => {
    const result = parseLegacyImportRecord(
      record({ status: "draft", publishedAt: undefined }),
      DEFAULTS
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.publishedAt).toBeNull();
  });

  test("an unparseable date is an error rather than an Invalid Date", () => {
    const result = parseLegacyImportRecord(
      record({ publishedAt: "0000-00-00 00:00:00" }),
      DEFAULTS
    );

    // MySQL's zero date is the classic legacy export value, and `new Date()`
    // turns it into `Invalid Date` — which Postgres would then refuse in the
    // middle of a batch rather than in a report.
    expect(result.ok).toBe(false);
  });

  test("a slug that is not already URL-safe is refused", () => {
    // The slug is half of the legacy URL and half of the new one. Normalizing
    // it here would silently change what the redirect points at.
    for (const slug of ["Banjir Kobar", "banjir_kobar", "banjir/kobar", ""]) {
      expect(parseLegacyImportRecord(record({ slug }), DEFAULTS).ok).toBe(
        false
      );
    }
  });

  test("an unknown status or visibility is refused", () => {
    expect(
      parseLegacyImportRecord(record({ status: "scheduled" }), DEFAULTS).ok
    ).toBe(false);
    expect(
      parseLegacyImportRecord(record({ visibility: "secret" }), DEFAULTS).ok
    ).toBe(false);
  });

  test("all the problems with one line are reported together", () => {
    const result = parseLegacyImportRecord(
      { legacyId: "", title: "", slug: "Nope" },
      DEFAULTS
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // An operator fixing an export script wants the whole list, not one
    // problem per run.
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  test("a non-object line is refused rather than throwing", () => {
    for (const value of [null, 42, "text", ["a"]]) {
      expect(parseLegacyImportRecord(value, DEFAULTS).ok).toBe(false);
    }
  });
});

describe("the importer preserves what makes the archive worth moving", () => {
  test("published_at is written from the record, never now()", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    expect(source).toContain("${input.publishedAt}");
    // `transitionBlogPostStatus` sets it to `now()`, which is right for an
    // editor pressing Publish and destroys the thing being migrated.
    expect(source).not.toContain("published_at = now()");
  });

  test("the insert is idempotent on the sql/138 partial unique index", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    // The expected workflow is preview -> commit -> fix rejects -> commit
    // again. Without a conflict target the second run duplicates the archive.
    expect(source).toContain(
      "ON CONFLICT (tenant_id, legacy_source_system, legacy_source_id)"
    );
    expect(source).toContain("WHERE legacy_source_id IS NOT NULL");
    expect(source).toContain("DO NOTHING");
  });

  test("provenance is written by the same statement as the post", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    // Two statements would leave a window where a post exists with no
    // provenance — and a post with no provenance is invisible to the redirect
    // map, which is the failure the column was added to prevent.
    expect(source).toContain("legacy_source_system, legacy_source_id");
  });
});

describe("the import script refuses rather than repairs", () => {
  test("a body with rejections is skipped, not stored sanitized", async () => {
    const source = stripComments(await readFile(IMPORT_SCRIPT, "utf8"));
    // No closing paren in the anchor: the call now carries a second argument
    // (`resolveImage`, Issue #599). The `not.toBe(-1)` is the lesson from that
    // — a missing anchor makes `slice` return something a `toContain` can still
    // be run against, so the assertion has to prove it found the code first.
    const start = source.indexOf(
      "convertLegacyHtmlToPortableText(record.value.bodyHtml"
    );
    const end = source.indexOf("accepted.push(");

    expect(start).not.toBe(-1);
    expect(end).toBeGreaterThan(start);

    const block = source.slice(start, end);

    // The `continue` is the whole assertion: a rejected body never reaches
    // `accepted`, so it is never written with its images dropped.
    expect(block).toContain("if (!body.ok)");
    expect(block).toContain("refusals.push");
    expect(block).toContain("continue;");
  });

  test("preview is the default and writing needs --commit", async () => {
    const source = stripComments(await readFile(IMPORT_SCRIPT, "utf8"));

    expect(source).toContain('process.argv.includes("--commit")');
    expect(source).toContain("if (commit) {");
  });

  test("a duplicate legacyId inside one file is reported, not absorbed", async () => {
    const source = stripComments(await readFile(IMPORT_SCRIPT, "utf8"));

    // The database would answer it with a silent `DO NOTHING`, which reads in
    // the report as "already imported" and hides the export script's bug.
    expect(source).toContain("seenLegacyIds");
    expect(source).toContain("appears more than once in this file");
  });

  test("slug collisions are found in ONE query before anything is written", async () => {
    const source = stripComments(await readFile(IMPORT_SCRIPT, "utf8"));

    // One at a time means a partially-completed import and a constraint error
    // 12,000 rows into a run.
    expect(source).toContain("findTakenSlugs");
    expect(source.indexOf("findTakenSlugs")).toBeLessThan(
      source.indexOf("if (commit) {")
    );
  });
});

describe("the redirect map lands in ONE hop", () => {
  test("the target carries the post's own locale prefix", async () => {
    const source = stripComments(await readFile(POST_DIRECTORY, "utf8"));
    const block = source.slice(
      source.indexOf("export async function listLegacyRedirectMappings")
    );

    // ADR-0098 made `/blog/{code}/{slug}` locale-prefixed. A bare target is
    // answered by a second redirect onto the canonical — two hops, which PRD
    // §9.2 forbids and which this issue lists as its own acceptance criterion.
    expect(block).toContain("withPublicLocalePrefix(barePath, row.locale)");
    expect(block).toContain("isSupportedLocale(row.locale)");
    // The locale has to be SELECTed for any of that to be possible.
    expect(block).toContain("SELECT legacy_source_id, slug, locale");
  });

  test("only published, non-deleted posts produce a rule", async () => {
    const source = stripComments(await readFile(POST_DIRECTORY, "utf8"));
    const block = source.slice(
      source.indexOf("export async function listLegacyRedirectMappings")
    );

    // A 301 to a draft is a 301 to a 404, which is worse than the 404 the URL
    // already had.
    expect(block).toContain("status = 'published'");
    expect(block).toContain("deleted_at IS NULL");
  });

  test("the importer checks the target is not itself a redirect source", async () => {
    const source = stripComments(await readFile(REDIRECT_SCRIPT, "utf8"));

    expect(source).toContain("targetIsSource");
    expect(source).toContain("a crawler would follow two hops");
  });

  test("the missing-prefix check needs BOTH halves", async () => {
    const source = stripComments(await readFile(REDIRECT_SCRIPT, "utf8"));

    // `requiresPublicLocalePrefix` strips the prefix before testing, so it is
    // `true` for a correctly prefixed path too. Using it alone would flag every
    // correct target as a problem and import nothing.
    expect(source).toContain(
      "requiresPublicLocalePrefix(mapping.targetPath) &&"
    );
    expect(source).toContain(
      "splitPublicLocalePath(mapping.targetPath).locale === null"
    );
  });

  test("an existing rule is reported, never overwritten", async () => {
    const source = stripComments(await readFile(REDIRECT_SCRIPT, "utf8"));

    // A hand-authored exception for one URL must survive a bulk run.
    expect(source).toContain("existing += 1;");
    expect(source).not.toContain("updateRedirect");
  });

  test("one `now` for the whole run", async () => {
    const source = stripComments(await readFile(REDIRECT_SCRIPT, "utf8"));

    // `findActiveRedirectByPath` filters by an effective window. Taking `now`
    // per call would let a rule that expires mid-run be seen by one check and
    // not the next — a chain the report then says is absent.
    expect(source).toContain("const now = new Date();");
    expect([...source.matchAll(/new Date\(\)/g)]).toHaveLength(1);
  });

  test("both scripts write 301, not 302", async () => {
    const source = stripComments(await readFile(REDIRECT_SCRIPT, "utf8"));

    // A 302 tells a search engine the move is temporary and transfers nothing,
    // which would make the whole exercise a no-op.
    expect(source).toContain("statusCode: 301");
  });
});

describe("categories: the archive is filed, or it is refused", () => {
  test("absent categories parse as none — an archive may file nothing", () => {
    const result = parseLegacyImportRecord(record(), DEFAULTS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.categories).toEqual([]);
  });

  test("a category listed twice on one row is one filing", () => {
    const result = parseLegacyImportRecord(
      record({ categories: ["Daerah", "Daerah"] }),
      DEFAULTS
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `syncPostTermAssignments` would otherwise insert the same pair twice.
    expect(result.value.categories).toEqual(["Daerah"]);
  });

  test("a bare string is REFUSED, not read as one name", () => {
    const result = parseLegacyImportRecord(
      record({ categories: "Politik,Daerah" }),
      DEFAULTS
    );

    // Coercing this would file every article of that day under a category
    // literally called `Politik,Daerah`.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("array of category names");
  });

  test("a non-name entry is named in the error", () => {
    const result = parseLegacyImportRecord(
      record({ categories: ["Daerah", 7] }),
      DEFAULTS
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toContain("7");
  });
});

describe("the term map is verified as ONE artefact, before anything is written", () => {
  test("a name is never turned into a term", async () => {
    const source = stripComments(await readFile(IMPORT_SCRIPT, "utf8"));

    // An importer that creates a term because a row mentioned one turns a typo
    // in a 23,906-row export into a published category nobody chose.
    expect(source).not.toContain("createBlogTerm");
  });

  test("every id is checked against the tenant's LIVE taxonomy, and a bad one stops the run", async () => {
    const source = stripComments(await readFile(IMPORT_SCRIPT, "utf8"));

    expect(source).toContain("findUnknownTermIds");
    // Not a per-row refusal: a map is one artefact, and a wrong id in it is a
    // wrong artefact.
    const gate = source.slice(source.indexOf("findUnknownTermIds"));
    expect(gate).toContain("process.exitCode = 1");
  });

  test("an unmapped category refuses the row rather than importing it unfiled", async () => {
    const source = stripComments(await readFile(IMPORT_SCRIPT, "utf8"));

    // An article that imported cleanly and lost its filing looks like a
    // success, and the category archive it belongs in answers a crawler with a
    // page that loads and lists nothing — a soft 404.
    expect(source).toContain("(name) => !termMap.has(name)");
  });

  test("filing happens in the SAME transaction as the insert", async () => {
    const source = stripComments(await readFile(IMPORT_SCRIPT, "utf8"));

    const commitBlock = source.slice(source.indexOf("if (commit)"));
    expect(commitBlock).toContain("syncPostTermAssignments");
    // Only for a row this run inserted: `ON CONFLICT DO NOTHING` leaves
    // `postId` null for an article already present, and re-filing it would
    // DELETE whatever an editor has since corrected by hand.
    expect(commitBlock).toContain("if (outcome.postId)");
  });
});
