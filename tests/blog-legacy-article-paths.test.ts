/**
 * ADR-0114's id→path artefact, and ADR-0115's destination for it
 * (Issues #599 / #711).
 *
 * ## What is at risk
 *
 * This table is loaded by the EDGE and consulted for every indexed legacy URL
 * of a 25,029-article archive. Nothing downstream of it reads a report, so
 * every property worth having has to hold in the FILE:
 *
 * 1. **A row with no section gets no path.** `content_json.awcmsAstro.kategori`
 *    is what `ahliweb/awcms-astro` filters on to decide whether an article is
 *    built at all. Emitting a path for a row without one is
 *    `CUTOVER_VERDICT_REASON.target_missing` by construction — "a 301 into a
 *    404, which is worse than the 404 it replaces".
 * 2. **The locale rule is the CONSUMER's.** This repo prefixes every locale
 *    including the default; `awcms-astro` serves its default locale at the root
 *    and prefixes only the others. All 25,029 articles are in the default
 *    locale, so borrowing this repo's rule would 301 every one of them into a
 *    404 — and the same class of mistake, a target built against the wrong
 *    prefix rule, has already shipped once (`listLegacyRedirectMappings`, fixed
 *    in #640).
 * 3. **A partial artefact is refused, not truncated.** A map missing rows looks
 *    complete and 404s whatever it left out.
 *
 * Pure — no database. The query behind it is exercised in
 * `tests/integration/legacy-import.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  buildArticlePaths,
  renderArticlePathTsv
} from "../scripts/blog-legacy-article-paths";
import type { LegacyArticlePath } from "../src/modules/blog-content/application/blog-post-directory";

/**
 * The consuming site's default locale, supplied on every call because the
 * generator REQUIRES it: it belongs to `awcms-astro`'s `siteConfig`, not to
 * this repo, and a default here would bake one deployment's configuration into
 * a generator whose wrong answer is silent.
 */
const ID = { defaultLocale: "id" } as const;

function row(overrides: Partial<LegacyArticlePath> = {}): LegacyArticlePath {
  return {
    legacyId: "48213",
    slug: "banjir-melanda-kobar",
    locale: "id",
    section: "hukum",
    ...overrides
  };
}

describe("a row becomes a path, or it becomes a problem", () => {
  test("a complete row yields the path the consuming site serves", () => {
    const { entries, problems } = buildArticlePaths([row()], ID);

    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
    // `/{section}/{slug}/` — the shape `[tab]/[...slug].astro` serves and the
    // form that site links its own articles by, NOT `/blog/{tenantCode}/{slug}`,
    // which is this repo's surface and the other origin (ADR-0115).
    expect(entries[0]!.targetPath).toBe("/hukum/banjir-melanda-kobar/");
  });

  test("a row with no section is REFUSED rather than given a guessed path", () => {
    // The defect this whole change exists to close, at the last place it could
    // still leak out. `null` is what the column reads for every article the
    // importer wrote before `--section-map`.
    const { entries, problems } = buildArticlePaths(
      [row({ section: null })],
      ID
    );

    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.problem).toContain("awcmsAstro.kategori");
    // The fix is a flag on another job, and the message says which.
    expect(problems[0]!.problem).toContain("--section-map");
  });

  test("an empty-string section is refused the same way as a missing one", () => {
    // `''` is what a sidecar written with a blank value reads as, and treating
    // it as present would emit `//{slug}` — a path no route matches.
    const { entries, problems } = buildArticlePaths([row({ section: "" })], ID);

    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
  });

  test("a section or slug that is not a valid slug is refused", () => {
    // Both become path segments. A capital, a space or a separator produces a
    // URL that cannot be linked, and the first place anyone finds out is a
    // crawler.
    expect(buildArticlePaths([row({ section: "Hukum" })], ID).entries).toEqual(
      []
    );
    expect(
      buildArticlePaths([row({ slug: "banjir kobar" })], ID).entries
    ).toEqual([]);
  });

  test("a NON-default locale gets a prefix, so the hop is the last one", () => {
    // Without this the reader is redirected once, then redirected again onto
    // the canonical — the >1-hop chain PRD §9.2 forbids and this cutover's own
    // acceptance criterion names.
    const { entries } = buildArticlePaths([row({ locale: "en" })], ID);

    expect(entries[0]!.targetPath).toBe("/en/hukum/banjir-melanda-kobar/");
  });

  test("the DEFAULT locale is served unprefixed — the consumer's rule, not this repo's", () => {
    // The single most consequential line in this file. `withPublicLocalePrefix`
    // prefixes every locale including the default (`/id/hukum/x`); the
    // consuming site's `localePath` returns the path unchanged for its default
    // and only prefixes the others. All 25,029 SeputarBorneo articles are in
    // the default locale, so using this repo's rule would 301 every one of them
    // into a 404. Its committed rubrik map says the same thing out loud —
    // `/kategori/daerah`, not `/id/kategori/daerah`.
    const { entries } = buildArticlePaths([row({ locale: "id" })], ID);

    expect(entries[0]!.targetPath).toBe("/hukum/banjir-melanda-kobar/");
    expect(entries[0]!.targetPath.startsWith("/id/")).toBe(false);
  });

  test("`defaultLocale` decides which locale is bare, and it is a PARAMETER", () => {
    // Same rows, a different consuming site: the prefixes swap. Pinned because
    // a constant here would be one deployment's configuration frozen into a
    // generator, which is the ADR-0114 mistake with a different subject.
    const { entries } = buildArticlePaths(
      [row({ locale: "id" }), row({ legacyId: "2", locale: "en" })],
      { defaultLocale: "en" }
    );

    expect(entries[0]!.targetPath).toBe("/id/hukum/banjir-melanda-kobar/");
    expect(entries[1]!.targetPath).toBe("/hukum/banjir-melanda-kobar/");
  });

  test("the LOCALE is a path segment too, and is checked like the other two", () => {
    // It used to be interpolated raw under a comment claiming "both halves …
    // are checked", while `consumerArticlePath` builds three segments.
    // `awcms_blog_posts.locale` is a plain text column with no CHECK
    // constraint, so this line is the only thing between it and a URL.
    for (const locale of ["../evil", "a/b", "%2e%2e", "EN", "en_US", ""]) {
      const { entries, problems } = buildArticlePaths([row({ locale })], ID);

      expect(entries).toEqual([]);
      expect(problems).toHaveLength(1);
      expect(problems[0]!.problem).toContain("is not a valid slug");
    }
  });

  test("no emitted path can contain a `..` segment", () => {
    // The property the per-field checks exist to produce, asserted over the
    // OUTPUT rather than over the inputs — a fourth segment added later would
    // have to break this test to escape.
    const { entries } = buildArticlePaths(
      [
        row({ legacyId: "1" }),
        row({ legacyId: "2", locale: "en" }),
        row({ legacyId: "3", section: "mitra-borneo", slug: "a-b-c" })
      ],
      ID
    );

    for (const entry of entries) {
      expect(entry.targetPath.split("/")).not.toContain("..");
      expect(entry.targetPath).not.toContain("//");
    }
  });

  test("a repeated legacy id is a problem, because the page walk produced it", () => {
    const { entries, problems } = buildArticlePaths([row(), row()], ID);

    expect(entries).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.problem).toContain("twice");
  });

  test("two ids landing on one page are a NOTE, and the artefact is still written", () => {
    // A legacy archive republishing an article under a second id is ordinary,
    // and both ids should reach the page. It used to be pushed onto `problems`
    // under a comment saying it was "reported without refusing" — while `main`
    // refuses the whole run on a single problem and prints "N row(s) cannot be
    // given a path" about a row that HAD been given one. `notes` is the list
    // that does not fail the run, so the comment and the exit code agree.
    const { entries, problems, notes } = buildArticlePaths(
      [row({ legacyId: "1" }), row({ legacyId: "2" })],
      ID
    );

    expect(entries).toHaveLength(2);
    expect(problems).toEqual([]);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.legacyId).toBe("2");
    expect(notes[0]!.note).toContain("already claimed by legacy id 1");
  });

  test("one bad row does not stop the good ones being counted", () => {
    // The report has to name every row an operator must fix, not the first —
    // `--section-map` is regenerated once and re-run, and a list of one is a
    // list that takes 25,029 runs to work through.
    const { entries, problems } = buildArticlePaths(
      [
        row({ legacyId: "1" }),
        row({ legacyId: "2", section: null }),
        row({ legacyId: "3", slug: "banjir-sampit" }),
        row({ legacyId: "4", section: null })
      ],
      ID
    );

    expect(entries.map((entry) => entry.legacyId)).toEqual(["1", "3"]);
    expect(problems).toHaveLength(2);
  });
});

describe("the artefact a tier can load", () => {
  test("the target carries the consumer's CANONICAL trailing slash", () => {
    // Not a hop argument — measured against `awcms-astro`'s real built server,
    // both spellings answer 200 with no `Location`. It is a canonical argument:
    // the built output is `{tab}/{slug}/index.html`, the sitemap lists the
    // slashed form and the page's own `<link rel="canonical">` names it, so
    // 25,029 permanent redirects onto the slashless spelling would each point
    // at a page whose canonical tag names a different URL.
    const { entries } = buildArticlePaths([row()], ID);

    expect(entries[0]!.targetPath.endsWith("/")).toBe(true);
  });

  test("the TSV is two columns and nothing else", () => {
    const { entries } = buildArticlePaths(
      [row({ legacyId: "1" }), row({ legacyId: "2", slug: "banjir-sampit" })],
      ID
    );

    expect(renderArticlePathTsv(entries)).toBe(
      "1\t/hukum/banjir-melanda-kobar/\n2\t/hukum/banjir-sampit/\n"
    );
  });

  test("an empty entry set still ends in a newline rather than producing `undefined`", () => {
    // A file whose last line has no terminator is the classic way a generated
    // map loses its final rule to a strict parser.
    expect(renderArticlePathTsv([])).toBe("\n");
  });
});
