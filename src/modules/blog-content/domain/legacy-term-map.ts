/**
 * The `--term-map` handoff for `blog:legacy:import` (Issue #599).
 *
 * ## Why an archive needs this at all
 *
 * `LegacyPostImportInput` carried no taxonomy, and `importLegacyBlogPost`
 * touches no join table. So a real import landed every article with ZERO
 * categories — 23,906 of them — and the category archives
 * (`/{locale}/kategori/{slug}`, rendered by `ahliweb/awcms-astro`) came back
 * empty. That is worse than the failure this issue exists to prevent: the
 * legacy rubrik URLs would have been redirected onto pages that resolve, load,
 * and list nothing, which a crawler reads as a soft 404 rather than as the
 * moved-permanently it was promised.
 *
 * NOTE ON "23,906" (both occurrences below): the measured snapshot is 25,029 —
 * see ADR-0114 §Consequences, which is the single correction the figure points
 * at. Left standing because this is an argument about scale, and it does not
 * move.
 *
 * ## Why a map rather than ids in the rows, or names created on sight
 *
 * The same shape as `legacy-media-map.ts`, deliberately, because the operator
 * is the same person doing the same kind of work twice:
 *
 * - **Not ids in each NDJSON row.** That pushes the name-to-uuid decision into
 *   whatever script produced the export, where no gate here can see it, and
 *   repeats it 23,906 times instead of stating it once.
 * - **Not names created on sight.** An importer that creates a term because a
 *   row mentioned one turns a single typo in an export into a category nobody
 *   chose, published, with no review step where anyone would notice. The
 *   taxonomy of a newsroom is an editorial decision, not a side effect of an
 *   import.
 *
 * So: the rows carry the legacy category NAME exactly as the old system spelled
 * it, and one map says what each name means here. `--terms=<path>` writes that
 * work list; `--term-map=<path>` takes it back.
 *
 * Matching is literal, for the reason `legacy-media-map.ts` gives about `src`:
 * normalising a name (case, spacing, an ampersand) would silently decide that
 * two rubrics are the same one, and a WRONG match here files articles under a
 * category the newsroom did not choose — which reads as correct.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LegacyTermMapResult =
  | { ok: true; value: ReadonlyMap<string, string> }
  | { ok: false; errors: string[] };

/** Every distinct term id the map names, for one round trip to the taxonomy. */
export function termIdsIn(map: ReadonlyMap<string, string>): readonly string[] {
  return [...new Set(map.values())];
}

/**
 * Validates a parsed `--term-map` document.
 *
 * A flat `{ "<legacy category name>": "<term uuid>" }` object, because that is
 * what an operator can produce from a spreadsheet without a schema.
 *
 * Every problem is reported, not just the first: an operator fixing a file one
 * error per run is an operator who gives up.
 */
export function parseLegacyTermMap(raw: unknown): LegacyTermMapResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        'the term map must be a JSON object of { "<legacy category name>": "<term uuid>" }'
      ]
    };
  }

  const errors: string[] = [];
  const value = new Map<string, string>();

  for (const [name, termId] of Object.entries(raw as Record<string, unknown>)) {
    if (name.trim().length === 0) {
      errors.push("an entry has an empty category-name key");
      continue;
    }

    if (typeof termId !== "string" || !UUID_PATTERN.test(termId)) {
      errors.push(
        `"${name}" maps to ${JSON.stringify(termId)}, which is not a term uuid`
      );
      continue;
    }

    value.set(name, termId);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value };
}

export type LegacyCategoryUsage = {
  name: string;
  /** How many articles in the file are filed under it. */
  articles: number;
};

/**
 * The work list: every category name the archive uses, most-used first.
 *
 * Ordering by demand is the point — it puts the categories that carry the
 * archive at the top, so an operator who maps the first twenty has covered most
 * of it and can see exactly what the long tail costs.
 */
export function summariseLegacyCategoryUsage(
  namesPerArticle: readonly (readonly string[])[]
): LegacyCategoryUsage[] {
  const counts = new Map<string, number>();

  for (const names of namesPerArticle) {
    // One article filed under the same category twice is one article; the count
    // exists to order the list, not to total the mentions.
    for (const name of new Set(names)) {
      if (name.trim().length === 0) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([name, articles]) => ({ name, articles }))
    .sort((a, b) => b.articles - a.articles || a.name.localeCompare(b.name));
}
