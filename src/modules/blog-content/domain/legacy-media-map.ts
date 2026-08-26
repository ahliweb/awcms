/**
 * The legacy image map: `<img src>` -> managed media object id (Issue #599).
 *
 * ## Why an operator has to supply this, rather than the import deriving it
 *
 * `legacy-html-conversion.ts` refuses a raw `<img>` because a managed-media
 * deployment stores images as registry references, and an import that kept the
 * `src` would smuggle unmanaged media past the enforcement `media_library`
 * exists to apply. That refusal names the `src` — and until now that was where
 * the trail ended.
 *
 * This paragraph used to say that for a real CKEditor archive that meant
 * essentially every row was residue. Measured against the SeputarBorneo
 * snapshot it is 4 rows in 25,029 (0.02%), of which 2 contain an `<img>` at
 * all. The residue was never the volume here. The volume is the LEAD
 * photograph, which is a column of the legacy row and not part of the body:
 * 25,029 of 25,029 articles have one, and no body scan can see it — hence
 * `LegacyArticleImageRefs` below, and `featuredImageSrc` on the record.
 *
 * The missing half is NOT "fetch the image and register it". That would mean
 * the server pulling third-party bytes from an address somebody else chose — a
 * server-side request forgery primitive — and then minting a `verified`
 * registry row for bytes no upload pipeline ever inspected.
 * `legacy-ad-ingest.ts` faced exactly this question for
 * `awcms_blog_ads.image_url` and answered it at length: bytes are vouched for
 * by the upload pipeline or not at all.
 *
 * So the missing half is a HANDOFF. `blog:legacy:import --images` reports the
 * complete set of `src` values the archive references; the operator uploads
 * them through the media library, which is the one path with validation, MIME
 * sniffing and size caps; and this map hands the result back. Nothing here
 * creates a media object, and nothing here decides one is safe — the importer
 * asks the registry about every id before a single article is written.
 *
 * ## Why an unknown id must abort the run rather than be skipped
 *
 * `renderGalleryBlockHtml` silently drops a gallery item whose `mediaObjectId`
 * resolves to nothing. A wrong id therefore produces an article that imported
 * cleanly, reports no error, and has lost its photographs — visible only to a
 * reader, on a page nobody re-checks. Refusing the whole run is the only
 * outcome that cannot end there.
 *
 * Pure module: no database, no network.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LegacyMediaMapResult =
  | { ok: true; value: ReadonlyMap<string, string> }
  | { ok: false; errors: string[] };

/** Every distinct media object id the map names, for one round trip to the registry. */
export function mediaObjectIdsIn(
  map: ReadonlyMap<string, string>
): readonly string[] {
  return [...new Set(map.values())];
}

/**
 * Validates a parsed `--media-map` document.
 *
 * A flat `{ "<src>": "<uuid>" }` object, because that is what an operator can
 * produce from a spreadsheet of uploads without a schema, and because the key
 * is the exact string the archive's HTML contains — matching is literal on
 * purpose. Normalising it (trimming a trailing slash, lower-casing a host,
 * resolving a relative path) would silently rewrite what a `src` means, and the
 * failure mode of a WRONG match here is the same as a missing one: photographs
 * gone from a published article.
 *
 * Every problem is reported, not just the first: an operator fixing a
 * 24,000-entry file one error per run is an operator who gives up.
 */
export function parseLegacyMediaMap(raw: unknown): LegacyMediaMapResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        'the media map must be a JSON object of { "<img src>": "<media object uuid>" }'
      ]
    };
  }

  const errors: string[] = [];
  const value = new Map<string, string>();

  for (const [src, mediaObjectId] of Object.entries(
    raw as Record<string, unknown>
  )) {
    if (src.trim().length === 0) {
      errors.push("an entry has an empty `src` key");
      continue;
    }

    if (
      typeof mediaObjectId !== "string" ||
      !UUID_PATTERN.test(mediaObjectId)
    ) {
      errors.push(
        `"${src}" maps to ${JSON.stringify(mediaObjectId)}, which is not a media object uuid`
      );
      continue;
    }

    value.set(src, mediaObjectId);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value };
}

/**
 * What ONE article still needs uploaded, from both places an image can live.
 *
 * Two fields rather than one flat list because the two arrive by completely
 * different routes and had completely different bugs. `body` comes from the
 * converter's own `unmanaged_image` rejections; `featured` is a COLUMN of the
 * legacy row (`foto_berita`) that no body scan can ever see. The upload set was
 * built from `body` alone, so for the SeputarBorneo archive it reported the 2
 * inline images and missed all 25,029 lead photographs — an upload set wrong by
 * the whole archive, and wrong in the direction that reads as "almost nothing
 * to do" (ADR-0114).
 */
export type LegacyArticleImageRefs = {
  /** Every `<img src>` in the body this run could not resolve. */
  body: readonly string[];
  /** The lead photograph's `src`, or `null` when the row has none / it resolved. */
  featured: string | null;
};

export type LegacyImageUsage = {
  src: string;
  /**
   * Articles referencing it at all. Never more than `bodyArticles +
   * featuredArticles`, and less when one article uses the same file both ways.
   */
  articles: number;
  /** …of which, referencing it from the body HTML. */
  bodyArticles: number;
  /** …of which, carrying it as the lead photograph. */
  featuredArticles: number;
};

/**
 * The upload set: every `src` the archive still needs uploaded, most-used
 * first, split by where it came from.
 *
 * Built from the converter's own `unmanaged_image` rejections rather than by
 * scanning the HTML again — a second scanner would be a second answer to "what
 * counts as an image reference", and the two would drift exactly where it
 * matters least visibly. The lead photograph is not scanned for at all; it is
 * read from the field the export supplies.
 *
 * "Still needs uploaded" is the one meaning of this file, for both halves: a
 * `src` the current `--media-map` already resolves is not listed, because the
 * operator has nothing left to do with it.
 */
export function summariseLegacyImageUsage(
  refsPerArticle: readonly LegacyArticleImageRefs[]
): LegacyImageUsage[] {
  const counts = new Map<
    string,
    { articles: number; bodyArticles: number; featuredArticles: number }
  >();

  const bump = (
    src: string,
    field: "bodyArticles" | "featuredArticles",
    countedThisArticle: Set<string>
  ): void => {
    if (src.trim().length === 0) return;

    let entry = counts.get(src);
    if (!entry) {
      entry = { articles: 0, bodyArticles: 0, featuredArticles: 0 };
      counts.set(src, entry);
    }

    entry[field] += 1;
    // `articles` is the UNION: one article using the same file as its lead and
    // again in its body is one article to upload for, not two.
    if (!countedThisArticle.has(src)) {
      countedThisArticle.add(src);
      entry.articles += 1;
    }
  };

  for (const refs of refsPerArticle) {
    const countedThisArticle = new Set<string>();

    // One article referencing the same file twice is one article, not two —
    // this is an upload list, and the count exists to order it.
    for (const src of new Set(refs.body)) {
      bump(src, "bodyArticles", countedThisArticle);
    }

    if (refs.featured !== null) {
      bump(refs.featured, "featuredArticles", countedThisArticle);
    }
  }

  return [...counts.entries()]
    .map(([src, entry]) => ({ src, ...entry }))
    .sort((a, b) => b.articles - a.articles || a.src.localeCompare(b.src));
}
