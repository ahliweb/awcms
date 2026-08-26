/**
 * blog-legacy-import.ts — `bun run blog:legacy:import`.
 *
 * Issue #599, the deliverable the first design pass forgot: **something that
 * actually writes `legacy_source_id`**. `sql/138` added the column and
 * `listLegacyRedirectMappings` reads it, but nothing filled it, so the redirect
 * map had a reader and no writer.
 *
 * ## Preview is the default, `--commit` is a second deliberate act
 *
 * Same inversion as `blog:ads:ingest`, for the same reason and more of it: this
 * is run once, by hand, against a live newsroom's entire archive, by an operator
 * who is about to point 23,906 indexed URLs at it. The expensive mistake is not
 * "forgot to preview" — it is "previewed, then never read the rejections". The
 * report is therefore what you get unless you say otherwise, and the run that
 * writes has to be typed on purpose.
 *
 * NOTE ON "23,906": the measured snapshot is 25,029 — see ADR-0114
 * §Consequences, which is the single correction the figure points at. Left
 * standing here because this is an argument about scale, and it does not move.
 *
 * ## Input
 *
 * NDJSON on a path given by `--file=<path>`, one article per line. See
 * `blog-content/domain/legacy-import-record.ts` for the field list and for why
 * the format is a file rather than a connection to the legacy database.
 *
 *   {"legacyId":"48213","title":"...","slug":"banjir-kobar","bodyHtml":"<p>…",
 *    "publishedAt":"2019-03-04T02:11:00Z","status":"published"}
 *
 * ## What gets refused, and why refusal is the feature
 *
 * Four independent gates, all reported per row, none of which silently repairs
 * anything:
 *
 * 1. **The record** — a line with no `legacyId` cannot be part of a redirect
 *    map and is refused rather than imported under a generated one; a
 *    `published` row with no `publishedAt` is refused rather than re-dated to
 *    the cutover afternoon. A `legacyId` or a `slug` appearing TWICE in one
 *    file is the export script's bug and is refused on its second occurrence.
 * 2. **The body** — `convertLegacyHtmlToPortableText` rejects `<script>`,
 *    `<iframe>`, event handlers, `javascript:` hrefs and unmanaged `<img>`
 *    sources. This job does NOT import the sanitized remainder: a body whose
 *    images were dropped is a broken article that looks imported, and finding
 *    that out from a report beats finding it out from a reader.
 * 3. **The lead photograph** — a `featuredImageSrc` the `--media-map` does not
 *    cover is refused for the same reason as an unmanaged `<img>`: an article
 *    that imported cleanly and lost the picture the legacy page led with looks
 *    like a success.
 * 4. **The slug** — checked against what this tenant already has, up front and
 *    in one query, so a collision is a line in the report rather than a
 *    constraint error 12,000 rows into a run.
 *
 * ## The images, and the two flags that make the archive importable at all
 *
 * Gate 2 refuses a raw `<img>`, because a managed-media deployment stores images
 * as registry references and nothing here can turn a legacy URL into one.
 *
 * This paragraph used to say that in practice EVERY row of a real CKEditor
 * archive was residue. **Measured, it is 4 of 25,029 — 0.02%** — and only 2
 * bodies contain an `<img>` at all. The handoff below is still the right shape;
 * what was wrong was the scale it implied. The real media task is the LEAD
 * photograph, which lives in the `foto_berita` column and not in the body: all
 * 25,029 articles have one, and body scanning never mentioned them (see
 * ADR-0114 and the ORIGIN ROUND in `docs/PROJECT_STATE.md` §4). That gap is now
 * closed — the record carries `featuredImageSrc`, `--images` reports it beside
 * the body images with the two counted separately, and a mapped one is written
 * to `awcms_blog_posts.featured_media_id`, the column `sql/035:46` has had
 * since the schema was created and `public-content-port-adapter.ts` has been
 * serving to `awcms-astro` all along.
 *
 * It is still not a gap to close by fetching the file — see
 * `legacy-media-map.ts` and `legacy-ad-ingest.ts` for why the server must not.
 * It is a handoff, and it has both halves:
 *
 *   `--images=<path>`     writes the upload set — every distinct `src` the
 *                         archive still needs uploaded, body images and lead
 *                         photographs alike, most-used first — and stops.
 *                         Upload those through `/admin/media`.
 *   `--media-map=<path>`  takes the result back as `{ "<src>": "<uuid>" }`.
 *                         ONE map for both kinds. Every id in it is checked
 *                         against THIS tenant's registry before a single
 *                         article is converted, and one that is not verified
 *                         media aborts the run — an unresolvable media
 *                         reference renders as nothing, so importing past it
 *                         would produce articles that look fine and have lost
 *                         their photographs.
 *
 * A mapped body image becomes a one-item `gallery` node in the position it
 * occupied in the article; a mapped lead photograph becomes
 * `featured_media_id`; an unmapped one of either kind is refused.
 *
 * ## The categories, and why they are the same handoff again
 *
 * `LegacyPostImportInput` carried no taxonomy and this job wrote no join row,
 * so a real import landed every article with ZERO categories. The redirect map
 * would then have pointed the legacy rubrik URLs at
 * `/{locale}/kategori/{slug}` pages that resolve, load, and list nothing — a
 * SOFT 404, which is worse for the ranking than the hard 404 this issue exists
 * to prevent, because nothing reports it.
 *
 *   `--terms=<path>`      writes the category work list (every legacy category
 *                         the archive files under, most-used first) and stops.
 *                         Create the terms you want in `/admin/blog-taxonomy`.
 *   `--term-map=<path>`   takes the result back as `{ "<name>": "<term uuid>" }`.
 *                         Every id is checked against this tenant's LIVE
 *                         taxonomy before a single article is written, and one
 *                         that is not aborts the run.
 *
 * Names are never created from a row. An importer that creates a term because
 * an export mentioned one turns a single typo into a published category nobody
 * chose, with no review step where anyone would notice; a newsroom's taxonomy
 * is an editorial decision, not a side effect of an import. A row naming a
 * category the map does not cover is refused, for the same reason a row with an
 * unmanaged `<img>` is: an article that imported cleanly and lost its filing
 * looks like a success.
 *
 * ## Roles and transactions
 *
 * Runs as the APP role, not `awcms_worker`. This creates content, which is an
 * authoring action; giving the worker INSERT on `awcms_blog_posts` so a one-shot
 * operator script could use it would widen a scheduled role's reach permanently
 * for a job that runs once. RLS is FORCE'd either way, so every batch is inside
 * `withTenantOrThrow`.
 *
 * Batched: each batch is one transaction, so an interrupted run leaves whole
 * batches rather than half an article, and `ON CONFLICT DO NOTHING` makes the
 * re-run skip what landed.
 *
 * Not a `runJob` worker — no advisory lock, no `JobResult`. Run one at a time.
 */
import { getDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { safeErrorDetail } from "../src/lib/logging/error-sanitizer";
import { convertLegacyHtmlToPortableText } from "../src/modules/blog-content/domain/legacy-html-conversion";
import { parseLegacyImportRecord } from "../src/modules/blog-content/domain/legacy-import-record";
import type { LegacyImportRecord } from "../src/modules/blog-content/domain/legacy-import-record";
import {
  mediaObjectIdsIn,
  parseLegacyMediaMap,
  summariseLegacyImageUsage
} from "../src/modules/blog-content/domain/legacy-media-map";
import type {
  LegacyArticleImageRefs,
  LegacyImageUsage
} from "../src/modules/blog-content/domain/legacy-media-map";
import { mediaLibraryPortAdapter } from "../src/modules/media-library/application/media-library-port-adapter";
import {
  findTakenSlugs,
  importLegacyBlogPost
} from "../src/modules/blog-content/application/legacy-import-directory";
import {
  findUnknownTermIds,
  syncPostTermAssignments
} from "../src/modules/blog-content/application/blog-taxonomy-directory";
import {
  parseLegacyTermMap,
  summariseLegacyCategoryUsage,
  termIdsIn
} from "../src/modules/blog-content/domain/legacy-term-map";
import type { LegacyCategoryUsage } from "../src/modules/blog-content/domain/legacy-term-map";

/** One transaction per batch — small enough to retry, large enough to be worth a round trip. */
const BATCH_SIZE = 200;

export type Refusal = {
  line: number;
  legacyId: string;
  reasons: string[];
};

function flag(name: string): string | null {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") || null : null;
}

function usage(message: string): void {
  console.error(
    `blog:legacy:import — ${message}\n\n` +
      "  --file=<path>        NDJSON, one article per line (required)\n" +
      "  --tenant=<uuid>      the tenant to import INTO (required)\n" +
      "  --author=<uuid>      awcms_tenant_users.id recorded as the author (required)\n" +
      "  --system=<name>      legacy_source_system value, e.g. seputarborneo (required)\n" +
      "  --locale=<tag>       default locale for lines that carry none (default: id)\n" +
      "  --images=<path>      write the upload set — every src the archive still needs\n" +
      "                       uploaded, body images AND lead photographs, most-used\n" +
      "                       first — and stop there\n" +
      '  --media-map=<path>   JSON { "<src>": "<media object uuid>" }, one map for body\n' +
      "                       images and lead photographs alike; every id is checked\n" +
      "                       against this tenant's registry before anything is written\n" +
      "  --terms=<path>       write the category work list — every legacy category the\n" +
      "                       archive files under, most-used first — and stop there\n" +
      '  --term-map=<path>    JSON { "<legacy category name>": "<term uuid>" }; every id is\n' +
      "                       checked against this tenant's taxonomy before anything is written\n" +
      "  --commit             write. Without it, nothing is written and you get the report.\n"
  );
  process.exitCode = 1;
}

/**
 * The upload set, written for the operator and nothing else.
 *
 * This is the first half of the handoff `legacy-media-map.ts` describes: the
 * converter refuses a raw `<img>` and names its `src`, and an archive of 25,029
 * articles turns that into a refusal log nobody can act on. The same
 * information, deduplicated and ordered, is a work list.
 *
 * The body/lead split is printed, not just the total, because the total on its
 * own is what hid the real task: body scanning found 2 images in the
 * SeputarBorneo archive and the honest number is ~25,031. A summary that cannot
 * be read as "almost nothing to do" is the whole point of the two extra lines.
 */
async function writeImageInventory(
  path: string,
  usage_: readonly LegacyImageUsage[]
): Promise<void> {
  await Bun.write(path, `${JSON.stringify(usage_, null, 2)}\n`);

  const fromBody = usage_.filter((entry) => entry.bodyArticles > 0).length;
  const leadPhotographs = usage_.filter(
    (entry) => entry.featuredArticles > 0
  ).length;
  const articlesWithLead = usage_.reduce(
    (total, entry) => total + entry.featuredArticles,
    0
  );

  console.log(
    `\nblog:legacy:import — wrote the upload set to ${path}\n` +
      `  distinct images       ${usage_.length}\n` +
      `    lead photographs    ${leadPhotographs}  (featuredImageSrc, in ${articlesWithLead} article(s))\n` +
      `    body images         ${fromBody}  (<img src> the converter refused)\n` +
      "  (an image used both ways is counted in both lines and once in the total)\n\n" +
      "  Upload these through the media library (`/admin/media`), which is the\n" +
      "  one path with upload validation, MIME sniffing and size caps. This job\n" +
      "  deliberately does not fetch them: pulling third-party bytes from the\n" +
      "  server at an address somebody else chose is a request-forgery\n" +
      "  primitive, and minting a `verified` registry row for bytes nothing\n" +
      "  inspected is the assertion the upload pipeline exists to make.\n\n" +
      "  Then hand the result back as --media-map=<path>.\n"
  );
}

/**
 * The category work list, the other half of the same handoff.
 *
 * Written for the operator, and ordered by demand so that mapping the first
 * twenty covers most of the archive and the long tail is visible as exactly
 * what it costs.
 */
async function writeCategoryInventory(
  path: string,
  usage_: readonly LegacyCategoryUsage[]
): Promise<void> {
  await Bun.write(path, `${JSON.stringify(usage_, null, 2)}\n`);

  console.log(
    `\nblog:legacy:import — wrote the category work list to ${path}\n` +
      `  distinct categories  ${usage_.length}\n\n` +
      "  Create the terms you want in `/admin/blog-taxonomy` — deliberately not\n" +
      "  here. A term created because a row mentioned one turns a typo in the\n" +
      "  export into a published category nobody chose, with no review step\n" +
      "  where anyone would notice. The taxonomy of a newsroom is an editorial\n" +
      "  decision, not a side effect of an import.\n\n" +
      "  Then hand the result back as --term-map=<path>.\n"
  );
}

/**
 * The whole per-row decision, with no database in it.
 *
 * ## Why this is a function and not just the middle of `main`
 *
 * It used to be the middle of `main`, and the only way to observe what it
 * decided was to run the CLI against a live Postgres. That made the DB-free
 * test for the in-file slug guard a SOURCE-TEXT test — it asserted that the
 * identifier `seenSlugs` appeared, and appeared before
 * `categoriesPerArticle.push`. Delete only the `continue;` from the collision
 * branch and every one of those assertions still held: the Map was still
 * there, the refusal was still pushed, the ordering was still right, and the
 * second colliding row sailed on into `accepted` to raise 23505 mid-batch —
 * after earlier batches had already committed. `DATABASE_URL="" bun run check`
 * was green on a dedupe that did not dedupe.
 *
 * Everything this needs is already RESOLVED before the first line is read: the
 * media map has been verified against this tenant's registry and the term map
 * against its taxonomy, both by `main`, both before any row is parsed. So the
 * row decisions need no connection, and pulling them out makes the refusals
 * and the accepted set ordinary return values that a test can read.
 *
 * `main` keeps what genuinely needs the database: the two verification sweeps
 * above it, the one `findTakenSlugs` query below it, and the batched write.
 */
export type LegacyImportPlanInput = {
  lines: readonly string[];
  defaultLocale: string;
  /** Already verified against this tenant's media registry by the caller. */
  mediaMap: ReadonlyMap<string, string>;
  /** Null when `--media-map` was not passed — which changes the refusal wording AND whether body images resolve at all. */
  mediaMapPath: string | null;
  /** Already verified against this tenant's live taxonomy by the caller. */
  termMap: ReadonlyMap<string, string>;
  /** Null when `--term-map` was not passed, for the same two reasons. */
  termMapPath: string | null;
};

export type LegacyImportPlan = {
  /** Rows that passed every gate, in file order. */
  accepted: LegacyImportRecord[];
  acceptedBodies: Map<
    string,
    ReturnType<typeof convertLegacyHtmlToPortableText>
  >;
  /** Resolved lead photograph per accepted row, keyed by `legacyId` like `acceptedBodies`. */
  acceptedFeaturedMediaIds: Map<string, string | null>;
  refusals: Refusal[];
  /** One entry per article, so `summariseLegacyImageUsage` can count articles rather than tags. */
  imageRefsPerArticle: LegacyArticleImageRefs[];
  /** Same, for categories — collected from EVERY parsed row, importable or not. */
  categoriesPerArticle: string[][];
};

export function planLegacyImportRows({
  lines,
  defaultLocale,
  mediaMap,
  mediaMapPath,
  termMap,
  termMapPath
}: LegacyImportPlanInput): LegacyImportPlan {
  const accepted: LegacyImportRecord[] = [];
  const acceptedBodies = new Map<
    string,
    ReturnType<typeof convertLegacyHtmlToPortableText>
  >();
  const acceptedFeaturedMediaIds = new Map<string, string | null>();
  const refusals: Refusal[] = [];
  const imageRefsPerArticle: LegacyArticleImageRefs[] = [];
  const categoriesPerArticle: string[][] = [];
  const seenLegacyIds = new Set<string>();
  /**
   * Line number of the row that first claimed each slug, so the refusal can
   * name the row it collides with rather than just saying "duplicate".
   */
  const seenSlugs = new Map<string, number>();

  /**
   * `undefined` rather than a function returning null when there is no map:
   * the converter distinguishes "no resolver was supplied" from "the resolver
   * did not know this src", and only the first is a run that was never asked
   * to place images.
   */
  const resolveImage = mediaMapPath
    ? (src: string): string | null => mediaMap.get(src) ?? null
    : undefined;

  for (const [index, raw] of lines.entries()) {
    const lineNumber = index + 1;
    const trimmed = raw.trim();

    if (trimmed.length === 0) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      refusals.push({
        line: lineNumber,
        legacyId: "(unparseable)",
        reasons: ["line is not valid JSON"]
      });
      continue;
    }

    const record = parseLegacyImportRecord(parsed, { locale: defaultLocale });

    if (!record.ok) {
      refusals.push({
        line: lineNumber,
        legacyId:
          typeof (parsed as { legacyId?: unknown })?.legacyId === "string"
            ? String((parsed as { legacyId: string }).legacyId)
            : "(missing)",
        reasons: record.errors
      });
      continue;
    }

    // A duplicate inside ONE file is the export script's bug, and the database
    // would answer it with a silent `DO NOTHING` — which reads in the report as
    // "already imported" and hides the real problem.
    if (seenLegacyIds.has(record.value.legacyId)) {
      refusals.push({
        line: lineNumber,
        legacyId: record.value.legacyId,
        reasons: ["legacyId appears more than once in this file"]
      });
      continue;
    }
    seenLegacyIds.add(record.value.legacyId);

    // The same argument as `seenLegacyIds`, against a different constraint.
    // `findTakenSlugs` asks the DATABASE which slugs are taken, so it cannot
    // see two rows of THIS file claiming one — and `awcms_blog_posts` has its
    // own slug uniqueness, so the second one raises 23505 in the middle of a
    // committing batch, after earlier batches have already landed. The real
    // SeputarBorneo archive has 84 such collision groups across 171 rows, so
    // this is not a hypothetical: without this set the first real run dies
    // part-imported.
    const collidesWith = seenSlugs.get(record.value.slug);
    if (collidesWith !== undefined) {
      refusals.push({
        line: lineNumber,
        legacyId: record.value.legacyId,
        reasons: [
          `slug "${record.value.slug}" is already claimed by line ${collidesWith} of this file`
        ]
      });
      continue;
    }
    seenSlugs.set(record.value.slug, lineNumber);

    // Collected before every refusal BELOW, for the same reason the image set
    // is: the work list belongs to the whole archive, and an article refused
    // for an unmapped category or a rejected body still names a category
    // somebody has to map.
    //
    // Deliberately below the two in-file gates above, though: a duplicate is
    // the SAME article twice, and counting it again would inflate the work
    // list with demand that does not exist.
    categoriesPerArticle.push([...record.value.categories]);

    const body = convertLegacyHtmlToPortableText(record.value.bodyHtml, {
      resolveImage
    });

    const featuredMediaId = record.value.featuredImageSrc
      ? (mediaMap.get(record.value.featuredImageSrc) ?? null)
      : null;

    // Collected from the converter's own findings plus the record's own lead
    // photograph, for every article, whether or not it is importable — the
    // upload set is the whole archive's, and an article refused for an
    // unmapped category still needs its photographs uploaded.
    //
    // This sits ABOVE the category gate, not below it. It used to sit below,
    // so a first run — which by definition has no `--term-map` yet, because
    // `--terms` is how you get one — refused every categorised row before
    // reaching this line and reported ZERO images. The whole point of
    // `--images` is to be run BEFORE you have everything else. Exactly the
    // same ordering bug was already fixed for `categoriesPerArticle` above.
    imageRefsPerArticle.push({
      body: body.rejections
        .filter((rejection) => rejection.reason === "unmanaged_image")
        .map((rejection) => rejection.detail ?? ""),
      // Only when it still needs uploading — one meaning for this file, the
      // same one the body half has: a `src` the current map already resolves
      // is not work.
      featured: featuredMediaId === null ? record.value.featuredImageSrc : null
    });

    // A category this run cannot resolve is refused, not dropped. Importing
    // past it produces an article that landed cleanly, reported nothing, and
    // is filed under nothing — and `/{locale}/kategori/{slug}` then answers a
    // crawler with a page that loads and lists nothing, which is read as a
    // soft 404. That is the failure this whole issue exists to prevent,
    // arriving through the door built to prevent it.
    const unmapped = record.value.categories.filter(
      (name) => !termMap.has(name)
    );

    if (unmapped.length > 0) {
      refusals.push({
        line: lineNumber,
        legacyId: record.value.legacyId,
        reasons: unmapped.map((name) =>
          termMapPath
            ? `category ${JSON.stringify(name)} is not in ${termMapPath}`
            : `category ${JSON.stringify(name)} needs a --term-map (run --terms=<path> to get the work list)`
        )
      });
      continue;
    }

    if (!body.ok) {
      refusals.push({
        line: lineNumber,
        legacyId: record.value.legacyId,
        reasons: body.rejections.map(
          (rejection) =>
            `${rejection.reason} at offset ${rejection.offset}: ${rejection.found}` +
            (rejection.detail ? ` (${rejection.detail})` : "")
        )
      });
      continue;
    }

    // The lead photograph gets the same answer as an unmanaged `<img>`, and
    // for the same reason: `foto_berita` is the picture the legacy page led
    // with, and an article that imported cleanly without it is a broken
    // article that looks imported. Every one of the 25,029 SeputarBorneo rows
    // has one, so silently importing past this would strip the archive.
    if (record.value.featuredImageSrc && featuredMediaId === null) {
      refusals.push({
        line: lineNumber,
        legacyId: record.value.legacyId,
        reasons: [
          mediaMapPath
            ? `featuredImageSrc ${JSON.stringify(record.value.featuredImageSrc)} is not in ${mediaMapPath}`
            : `featuredImageSrc ${JSON.stringify(record.value.featuredImageSrc)} needs a --media-map (run --images=<path> to get the upload set)`
        ]
      });
      continue;
    }

    accepted.push(record.value);
    acceptedBodies.set(record.value.legacyId, body);
    acceptedFeaturedMediaIds.set(record.value.legacyId, featuredMediaId);
  }

  return {
    accepted,
    acceptedBodies,
    acceptedFeaturedMediaIds,
    refusals,
    imageRefsPerArticle,
    categoriesPerArticle
  };
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const file = flag("file");
  const tenantId = flag("tenant");
  const authorId = flag("author");
  const system = flag("system");
  const defaultLocale = flag("locale") ?? "id";
  const imagesPath = flag("images");
  const mediaMapPath = flag("media-map");
  const termsPath = flag("terms");
  const termMapPath = flag("term-map");

  if (!file) return usage("`--file=<path>` is required.");
  if (!tenantId) return usage("`--tenant=<uuid>` is required.");
  if (!authorId) return usage("`--author=<uuid>` is required.");
  if (!system) return usage("`--system=<name>` is required.");

  const text = await Bun.file(file).text();
  const lines = text.split("\n");

  /**
   * Opened on first USE, not up front.
   *
   * `--terms` and `--images` read one file and write one file; they issue no
   * query and stop before the slug check. Calling `getDatabaseClient()`
   * unconditionally made them throw `DATABASE_URL … is required` for a run that
   * needs no database — and the two flags exist precisely to be run FIRST, by
   * somebody who does not yet have the tenant wired up. It also meant the
   * ordering fix below could only be proved against a live Postgres, which is
   * how the ordering bug survived in the first place.
   *
   * On an OBJECT rather than in a bare `let`, because the only writer is the
   * closure below and TypeScript's control-flow analysis cannot see a closure's
   * assignment: `let sql: Bun.SQL | null = null` reads as exactly `null` in the
   * `finally`, so `sql.close()` there is an error on type `never`. A property
   * whose object is reassigned out of view falls back to its declared type,
   * which is the honest answer here.
   */
  const connection: { client: Bun.SQL | null } = { client: null };
  const db = (): Bun.SQL => (connection.client ??= getDatabaseClient());
  let imported = 0;
  let alreadyPresent = 0;

  try {
    let mediaMap: ReadonlyMap<string, string> = new Map();

    if (mediaMapPath) {
      let rawMap: unknown;
      try {
        rawMap = JSON.parse(await Bun.file(mediaMapPath).text());
      } catch (error) {
        console.error(
          `blog:legacy:import — ${mediaMapPath} is not valid JSON: ${safeErrorDetail(error)}`
        );
        process.exitCode = 1;
        return;
      }

      const parsedMap = parseLegacyMediaMap(rawMap);

      if (!parsedMap.ok) {
        console.error(
          `blog:legacy:import — ${mediaMapPath} is not a usable media map:\n` +
            parsedMap.errors.map((line) => `  - ${line}`).join("\n")
        );
        process.exitCode = 1;
        return;
      }

      // Every id, against the registry, BEFORE a single article is converted.
      // `renderGalleryBlockHtml` silently drops an item whose media object does
      // not resolve, so an id this tenant does not own produces an article that
      // imported cleanly and has lost its photographs — visible only to a
      // reader. That cannot be a per-row refusal either: a map is one artefact,
      // and a wrong id in it is a wrong artefact.
      const ids = mediaObjectIdsIn(parsedMap.value);
      const unsafe = await withTenantOrThrow(db(), tenantId, async (tx) => {
        const found: string[] = [];
        for (const id of ids) {
          const safe = await mediaLibraryPortAdapter.isMediaReferenceSafe(
            tx,
            tenantId,
            id
          );
          if (!safe) found.push(id);
        }
        return found;
      });

      if (unsafe.length > 0) {
        console.error(
          `blog:legacy:import — ${unsafe.length} of ${ids.length} media object id(s) in ` +
            `${mediaMapPath} are not verified media of this tenant:\n` +
            unsafe.map((id) => `  - ${id}`).join("\n") +
            "\n\n  Nothing was written. An id the registry does not vouch for renders\n" +
            "  as NOTHING, so importing past this would produce articles that look\n" +
            "  fine and have lost their photographs.\n"
        );
        process.exitCode = 1;
        return;
      }

      console.log(
        `blog:legacy:import — ${ids.length} media object id(s) verified against this tenant's registry.`
      );

      mediaMap = parsedMap.value;
    }

    let termMap: ReadonlyMap<string, string> = new Map();

    if (termMapPath) {
      let rawMap: unknown;
      try {
        rawMap = JSON.parse(await Bun.file(termMapPath).text());
      } catch (error) {
        console.error(
          `blog:legacy:import — ${termMapPath} is not valid JSON: ${safeErrorDetail(error)}`
        );
        process.exitCode = 1;
        return;
      }

      const parsedMap = parseLegacyTermMap(rawMap);

      if (!parsedMap.ok) {
        console.error(
          `blog:legacy:import — ${termMapPath} is not a usable term map:\n` +
            parsedMap.errors.map((line) => `  - ${line}`).join("\n")
        );
        process.exitCode = 1;
        return;
      }

      // Every id, against this tenant's taxonomy, BEFORE a single article is
      // written — and one bad id stops the run rather than becoming a per-row
      // refusal. A map is ONE artefact: a wrong id in it is a wrong artefact,
      // and the failure it produces is silent in the worst way. `INSERT` into
      // `awcms_blog_post_terms` with a term another tenant owns is refused by
      // the composite foreign key, but a term id that is merely SOFT-DELETED
      // here would file the whole archive under a category an editor removed
      // and resurrect it in every listing.
      const ids = termIdsIn(parsedMap.value);
      const unknown = await withTenantOrThrow(db(), tenantId, (tx) =>
        findUnknownTermIds(tx, tenantId, ids)
      );

      if (unknown.length > 0) {
        console.error(
          `blog:legacy:import — ${unknown.length} of ${ids.length} term id(s) in ` +
            `${termMapPath} are not live terms of this tenant:\n` +
            unknown.map((id) => `  - ${id}`).join("\n") +
            "\n\n  Nothing was written. Create the terms in `/admin/blog-taxonomy`\n" +
            "  first — this job will not create one from a name, because a typo\n" +
            "  in the export would then become a published category nobody chose.\n"
        );
        process.exitCode = 1;
        return;
      }

      console.log(
        `blog:legacy:import — ${ids.length} term id(s) verified against this tenant's taxonomy.`
      );

      termMap = parsedMap.value;
    }

    const {
      accepted,
      acceptedBodies,
      acceptedFeaturedMediaIds,
      refusals,
      imageRefsPerArticle,
      categoriesPerArticle
    } = planLegacyImportRows({
      lines,
      defaultLocale,
      mediaMap,
      mediaMapPath,
      termMap,
      termMapPath
    });

    if (termsPath) {
      // Before `--images`, because the two are independent and an operator who
      // asked for both should get both files rather than discovering the order
      // matters.
      await writeCategoryInventory(
        termsPath,
        summariseLegacyCategoryUsage(categoriesPerArticle)
      );
    }

    if (imagesPath) {
      // A report, not a run. Writing the upload set and then importing would
      // invite reading the summary and skipping the list it just produced.
      await writeImageInventory(
        imagesPath,
        summariseLegacyImageUsage(imageRefsPerArticle)
      );
    }

    if (termsPath || imagesPath) return;

    // One query for every slug in the file, before anything is written.
    const taken = await withTenantOrThrow(db(), tenantId, (tx) =>
      findTakenSlugs(
        tx,
        tenantId,
        accepted.map((record) => record.slug)
      )
    );

    const importable = accepted.filter((record) => {
      if (taken.has(record.slug)) {
        refusals.push({
          line: 0,
          legacyId: record.legacyId,
          reasons: [
            `slug "${record.slug}" is already used by another post in this tenant`
          ]
        });
        return false;
      }
      return true;
    });

    if (commit) {
      for (let offset = 0; offset < importable.length; offset += BATCH_SIZE) {
        const batch = importable.slice(offset, offset + BATCH_SIZE);

        await withTenantOrThrow(db(), tenantId, async (tx) => {
          for (const record of batch) {
            const body = acceptedBodies.get(record.legacyId)!;
            const outcome = await importLegacyBlogPost(
              tx,
              tenantId,
              authorId,
              system,
              {
                legacyId: record.legacyId,
                title: record.title,
                slug: record.slug,
                excerpt: record.excerpt,
                bodyPortableText: body.document,
                locale: record.locale,
                status: record.status,
                visibility: record.visibility,
                publishedAt: record.publishedAt,
                seoTitle: record.seoTitle,
                metaDescription: record.metaDescription,
                // Already verified against this tenant's registry, once per
                // distinct id, before any article was converted — the same
                // `isMediaReferenceSafe` sweep the body images went through.
                // There is deliberately no second check here.
                featuredMediaId:
                  acceptedFeaturedMediaIds.get(record.legacyId) ?? null
              }
            );

            if (outcome.postId) {
              imported += 1;

              // Same transaction as the INSERT. An article that committed and
              // then failed to be filed is exactly the empty-category outcome
              // this flag exists to prevent, and it would be invisible: the
              // import reports success and the archive listing is short.
              //
              // Only for a row this run actually inserted — `ON CONFLICT DO
              // NOTHING` means `postId` is null when the article was already
              // present, and re-running would otherwise DELETE the filings an
              // editor has since corrected by hand (`syncPostTermAssignments`
              // replaces the set rather than adding to it).
              if (record.categories.length > 0) {
                await syncPostTermAssignments(
                  tx,
                  tenantId,
                  outcome.postId,
                  record.categories.map((name) => termMap.get(name)!)
                );
              }
            } else alreadyPresent += 1;
          }
        });

        console.log(
          `  ... ${Math.min(offset + BATCH_SIZE, importable.length)}/${importable.length}`
        );
      }
    }

    console.log(
      `\nblog:legacy:import ${commit ? "COMMITTED" : "PREVIEW (nothing written — pass --commit to write)"}\n` +
        `  file             ${file}\n` +
        `  tenant           ${tenantId}\n` +
        `  system           ${system}\n` +
        `  lines read       ${lines.filter((l) => l.trim().length > 0).length}\n` +
        `  importable       ${importable.length}\n` +
        `  refused          ${refusals.length}\n` +
        (commit
          ? `  inserted         ${imported}\n  already present  ${alreadyPresent}\n`
          : "")
    );

    if (refusals.length > 0) {
      console.log("Refused rows — fix the export and re-run:\n");
      for (const refusal of refusals) {
        const where = refusal.line > 0 ? `line ${refusal.line}` : "slug check";
        console.log(`  [${refusal.legacyId}] ${where}`);
        for (const reason of refusal.reasons) {
          console.log(`      - ${reason}`);
        }
      }
      console.log(
        "\n  Nothing was silently repaired. A body with a rejected element was NOT\n" +
          "  imported with that element stripped — an article whose images vanished\n" +
          "  is a broken article that looks imported.\n"
      );
    }

    // A refusal is not a failure of the run: previewing a messy archive and
    // getting a list is the job working. Only an actual error exits non-zero.
  } catch (error) {
    logScriptFailure("blog:legacy:import", error);
    process.exitCode = 1;
  } finally {
    // Only if something opened it — a `--terms`/`--images` run never does.
    if (connection.client) await connection.client.close({ timeout: 5 });
  }
}

/**
 * Guarded, because `planLegacyImportRows` above is now imported by
 * `tests/blog-legacy-import.test.ts`. Unguarded, that import RUNS the CLI: no
 * `--file`, so `usage()` prints and sets `process.exitCode = 1`, and the whole
 * DB-free suite exits non-zero for a reason nothing in it mentions.
 */
if (import.meta.main) {
  await main();
}
