/**
 * The legacy image map: `<img src>` -> managed media object id (Issue #599).
 *
 * ## Why an operator has to supply this, rather than the import deriving it
 *
 * `legacy-html-conversion.ts` refuses a raw `<img>` because a managed-media
 * deployment stores images as registry references, and an import that kept the
 * `src` would smuggle unmanaged media past the enforcement `media_library`
 * exists to apply. That refusal names the `src` — and until now that was where
 * the trail ended, which for an archive of 23,906 CKEditor articles meant
 * essentially every row was residue and nothing could be imported at all.
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

export type LegacyImageUsage = {
  src: string;
  /** How many articles in the file reference it. */
  articles: number;
};

/**
 * The upload set: every `src` the archive references, most-used first.
 *
 * Built from the converter's own `unmanaged_image` rejections rather than by
 * scanning the HTML again — a second scanner would be a second answer to "what
 * counts as an image reference", and the two would drift exactly where it
 * matters least visibly.
 */
export function summariseLegacyImageUsage(
  srcsPerArticle: readonly (readonly string[])[]
): LegacyImageUsage[] {
  const counts = new Map<string, number>();

  for (const srcs of srcsPerArticle) {
    // One article referencing the same file twice is one article, not two —
    // this is an upload list, and the count exists to order it.
    for (const src of new Set(srcs)) {
      if (src.trim().length === 0) continue;
      counts.set(src, (counts.get(src) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([src, articles]) => ({ src, articles }))
    .sort((a, b) => b.articles - a.articles || a.src.localeCompare(b.src));
}
