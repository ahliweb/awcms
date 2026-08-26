/**
 * The `--section-map` handoff for `blog:legacy:import` (Issue #599 / #711).
 *
 * ## The defect this exists to close, stated as it was measured
 *
 * `importLegacyBlogPost` wrote `content_json` as a hard-coded `{ blocks: [] }`.
 * Its own docblock said that was "the same lossy projection every other write
 * path produces", and it was not: `blog-post-directory.ts` and
 * `blog-page-directory.ts` both call `withProjectedBlocks`, and the importer
 * called nothing. A comment is not a call.
 *
 * That envelope decides two separate things in `ahliweb/awcms-astro`, the repo
 * that renders this archive (ADR-0071/ADR-0113/ADR-0114):
 *
 *  1. `renderContentBlocks(post.contentJson)` reads `contentJson.blocks`. An
 *     empty array renders an empty `bodyHtml` — every article a blank page.
 *  2. `getArticles(tab, locale)` keeps a post only when
 *     `readBlock(post).kategori === tab`, reading `contentJson.awcmsAstro`.
 *     With no such key the comparison is `undefined === tab`, false for every
 *     configured tab, so the post is not built AT ALL — no article page, and
 *     none of the category archives either, because `artikelSemuaSeksi` builds
 *     them from the same tab-filtered set.
 *
 * Run rather than reasoned about: a post carrying the sidecar builds 1 article;
 * a post written exactly as the importer wrote it builds **0**, in every
 * configured tab. So the 63 rubrik rules of ADR-0113 and the id-keyed article
 * map of ADR-0114 would each have redirected onto a page that does not exist —
 * `CUTOVER_VERDICT_REASON.target_missing` in its own words, "a 301 into a 404,
 * which is worse than the 404 it replaces", and the one outcome both issues'
 * Definition of Done forbids.
 *
 * **Why no gate here could see it.** This repo renders `/blog/{code}/{slug}`
 * from `body_portable_text` and falls back to the projection only for
 * un-backfilled rows (`blog-body-rendering.ts`), so an imported post looks
 * perfect HERE. The consumer that reads the projection is in another
 * repository. That is ADR-0114's lesson one level down: the check is not only
 * "is this symbol called" but "does the repo that SERVES this read the field
 * this writer skipped".
 *
 * ## Why a map, and not a column in the rows or a guess from the taxonomy
 *
 * The same shape as `legacy-term-map.ts` and `legacy-media-map.ts`,
 * deliberately, because it is the same operator doing the same kind of work a
 * third time — and for one reason those two do not have:
 *
 * - **A section is not a term.** `--term-map` resolves a legacy category name
 *   to a term UUID in THIS database, and that is what fills the category
 *   archives. A section is a **tab slug in the consuming repo's
 *   `siteConfig.tabs`** — a different vocabulary, in a different repository,
 *   which nothing here can verify against anything. Deriving one from the other
 *   would be this repo asserting a fact about a file it cannot read.
 * - **Not a column in each NDJSON row.** Same argument `legacy-term-map.ts`
 *   makes: it pushes the decision into whatever produced the export, where no
 *   gate here can see it, and repeats it 25,029 times instead of stating it
 *   once.
 *
 * So the rows keep carrying the legacy category NAME exactly as the old system
 * spelled it, and one map says which section each name belongs to.
 * `--terms=<path>` already writes that work list; this reads the same list back
 * with a different right-hand column.
 *
 * ## Ambiguity is refused, never resolved by position
 *
 * A row's section is the ONE section its categories agree on. Two mapped
 * categories naming two different sections is refused rather than settled by
 * taking the first: the order of `categories` is whatever the export happened
 * to emit, and letting it decide would put an article in a different section
 * depending on how a `SELECT` came back — reproducible only by accident.
 */

import { isValidSlug } from "./slug-policy";

export type LegacySectionMapResult =
  | { ok: true; value: ReadonlyMap<string, string> }
  | { ok: false; errors: string[] };

/**
 * Validates a parsed `--section-map` document.
 *
 * A flat `{ "<legacy category name>": "<section slug>" }` object, for the same
 * reason `parseLegacyTermMap` takes one: it is what an operator can produce
 * from a spreadsheet without a schema.
 *
 * The value is checked with `isValidSlug` — the repo's ONE slug rule, imported
 * rather than copied — because it becomes a URL segment on the consuming site
 * (`/{section}/{slug}`). A section that is not a valid slug produces a URL that
 * cannot be linked, and the first place anyone would find out is a crawler.
 *
 * Every problem is reported, not just the first: an operator fixing a file one
 * error per run is an operator who gives up.
 */
export function parseLegacySectionMap(raw: unknown): LegacySectionMapResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        'the section map must be a JSON object of { "<legacy category name>": "<section slug>" }'
      ]
    };
  }

  const errors: string[] = [];
  const value = new Map<string, string>();

  for (const [name, section] of Object.entries(
    raw as Record<string, unknown>
  )) {
    if (name.trim().length === 0) {
      errors.push("an entry has an empty category-name key");
      continue;
    }

    if (typeof section !== "string" || !isValidSlug(section)) {
      errors.push(
        `"${name}" maps to ${JSON.stringify(section)}, which is not a valid section slug`
      );
      continue;
    }

    value.set(name, section);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value };
}

/** Every distinct section slug the map names — the vocabulary the operator declared. */
export function sectionsIn(
  map: ReadonlyMap<string, string>
): readonly string[] {
  return [...new Set(map.values())].sort();
}

export type LegacySectionResolution =
  | { ok: true; section: string }
  | {
      ok: false;
      reason: "unmapped" | "ambiguous";
      sections: readonly string[];
    };

/**
 * The one section a row's categories agree on.
 *
 * `unmapped` — no category of this row is in the map. `sections` is empty.
 * `ambiguous` — the row's categories name more than one section, and
 * `sections` lists them SORTED so the refusal reads the same on every run
 * regardless of the order the export emitted the categories in.
 *
 * A row with no categories at all is `unmapped`, not an error of its own: it
 * is the same operator problem (nothing says where this article goes) reported
 * with the same wording, and splitting it would only add a message.
 */
export function resolveLegacySection(
  categories: readonly string[],
  map: ReadonlyMap<string, string>
): LegacySectionResolution {
  const matched = new Set<string>();

  for (const name of categories) {
    const section = map.get(name);
    if (section !== undefined) matched.add(section);
  }

  if (matched.size === 1) {
    // `size === 1`, so the iterator's first value exists.
    return { ok: true, section: [...matched][0] as string };
  }

  return {
    ok: false,
    reason: matched.size === 0 ? "unmapped" : "ambiguous",
    sections: [...matched].sort()
  };
}
