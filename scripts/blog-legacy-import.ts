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
 * Three independent gates, all reported per row, none of which silently
 * repairs anything:
 *
 * 1. **The record** — a line with no `legacyId` cannot be part of a redirect
 *    map and is refused rather than imported under a generated one; a
 *    `published` row with no `publishedAt` is refused rather than re-dated to
 *    the cutover afternoon.
 * 2. **The body** — `convertLegacyHtmlToPortableText` rejects `<script>`,
 *    `<iframe>`, event handlers, `javascript:` hrefs and unmanaged `<img>`
 *    sources. This job does NOT import the sanitized remainder: a body whose
 *    images were dropped is a broken article that looks imported, and finding
 *    that out from a report beats finding it out from a reader.
 * 3. **The slug** — checked against what this tenant already has, up front and
 *    in one query, so a collision is a line in the report rather than a
 *    constraint error 12,000 rows into a run.
 *
 * ## The images, and the two flags that make the archive importable at all
 *
 * Gate 2 above meant that in practice EVERY row of a real CKEditor archive was
 * residue: `<img>` is refused because a managed-media deployment stores images
 * as registry references, and nothing here can turn a legacy URL into one.
 * That is not a gap to close by fetching the file — see
 * `legacy-media-map.ts` and `legacy-ad-ingest.ts` for why the server must not.
 * It is a handoff, and it now has both halves:
 *
 *   `--images=<path>`     writes the upload set (every distinct `<img src>` in
 *                         the archive, most-used first) and stops. Upload those
 *                         through `/admin/media`.
 *   `--media-map=<path>`  takes the result back as `{ "<src>": "<uuid>" }`.
 *                         Every id is checked against THIS tenant's registry
 *                         before a single article is converted, and one that is
 *                         not verified media aborts the run — an unresolvable
 *                         media reference renders as nothing, so importing past
 *                         it would produce articles that look fine and have
 *                         lost their photographs.
 *
 * A mapped image becomes a one-item `gallery` node in the position it occupied
 * in the article; an unmapped one is refused exactly as before.
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
import type { LegacyImageUsage } from "../src/modules/blog-content/domain/legacy-media-map";
import { mediaLibraryPortAdapter } from "../src/modules/media-library/application/media-library-port-adapter";
import {
  findTakenSlugs,
  importLegacyBlogPost
} from "../src/modules/blog-content/application/legacy-import-directory";

/** One transaction per batch — small enough to retry, large enough to be worth a round trip. */
const BATCH_SIZE = 200;

type Refusal = {
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
      "  --images=<path>      write the upload set — every <img src> the archive\n" +
      "                       references, most-used first — and stop there\n" +
      '  --media-map=<path>   JSON { "<img src>": "<media object uuid>" }; every id is\n' +
      "                       checked against this tenant's registry before anything is written\n" +
      "  --commit             write. Without it, nothing is written and you get the report.\n"
  );
  process.exitCode = 1;
}

/**
 * The upload set, written for the operator and nothing else.
 *
 * This is the first half of the handoff `legacy-media-map.ts` describes: the
 * converter refuses a raw `<img>` and names its `src`, and an archive of 23,906
 * articles turns that into a refusal log nobody can act on. The same
 * information, deduplicated and ordered, is a work list.
 */
async function writeImageInventory(
  path: string,
  usage_: readonly LegacyImageUsage[]
): Promise<void> {
  await Bun.write(path, `${JSON.stringify(usage_, null, 2)}\n`);

  console.log(
    `\nblog:legacy:import — wrote the upload set to ${path}\n` +
      `  distinct images  ${usage_.length}\n\n` +
      "  Upload these through the media library (`/admin/media`), which is the\n" +
      "  one path with upload validation, MIME sniffing and size caps. This job\n" +
      "  deliberately does not fetch them: pulling third-party bytes from the\n" +
      "  server at an address somebody else chose is a request-forgery\n" +
      "  primitive, and minting a `verified` registry row for bytes nothing\n" +
      "  inspected is the assertion the upload pipeline exists to make.\n\n" +
      "  Then hand the result back as --media-map=<path>.\n"
  );
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

  if (!file) return usage("`--file=<path>` is required.");
  if (!tenantId) return usage("`--tenant=<uuid>` is required.");
  if (!authorId) return usage("`--author=<uuid>` is required.");
  if (!system) return usage("`--system=<name>` is required.");

  const text = await Bun.file(file).text();
  const lines = text.split("\n");

  const accepted: LegacyImportRecord[] = [];
  const acceptedBodies = new Map<
    string,
    ReturnType<typeof convertLegacyHtmlToPortableText>
  >();
  const refusals: Refusal[] = [];
  const seenLegacyIds = new Set<string>();
  /** One entry per article, so `summariseLegacyImageUsage` can count articles rather than tags. */
  const imageSrcsPerArticle: string[][] = [];

  const sql = getDatabaseClient();
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
      const unsafe = await withTenantOrThrow(sql, tenantId, async (tx) => {
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

      const body = convertLegacyHtmlToPortableText(record.value.bodyHtml, {
        resolveImage
      });

      // Collected from the converter's own findings, for every article, whether
      // or not it is importable — the upload set is the whole archive's, and an
      // article refused for a bad slug still needs its photographs uploaded.
      imageSrcsPerArticle.push(
        body.rejections
          .filter((rejection) => rejection.reason === "unmanaged_image")
          .map((rejection) => rejection.detail ?? "")
      );

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

      accepted.push(record.value);
      acceptedBodies.set(record.value.legacyId, body);
    }

    if (imagesPath) {
      // A report, not a run. Writing the upload set and then importing would
      // invite reading the summary and skipping the list it just produced.
      await writeImageInventory(
        imagesPath,
        summariseLegacyImageUsage(imageSrcsPerArticle)
      );
      return;
    }

    // One query for every slug in the file, before anything is written.
    const taken = await withTenantOrThrow(sql, tenantId, (tx) =>
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

        await withTenantOrThrow(sql, tenantId, async (tx) => {
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
                metaDescription: record.metaDescription
              }
            );

            if (outcome.postId) imported += 1;
            else alreadyPresent += 1;
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
    await sql.close({ timeout: 5 });
  }
}

await main();
