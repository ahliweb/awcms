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
import { convertLegacyHtmlToPortableText } from "../src/modules/blog-content/domain/legacy-html-conversion";
import { parseLegacyImportRecord } from "../src/modules/blog-content/domain/legacy-import-record";
import type { LegacyImportRecord } from "../src/modules/blog-content/domain/legacy-import-record";
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
      "  --commit             write. Without it, nothing is written and you get the report.\n"
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const file = flag("file");
  const tenantId = flag("tenant");
  const authorId = flag("author");
  const system = flag("system");
  const defaultLocale = flag("locale") ?? "id";

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

    const body = convertLegacyHtmlToPortableText(record.value.bodyHtml);

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

  const sql = getDatabaseClient();
  let imported = 0;
  let alreadyPresent = 0;

  try {
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
