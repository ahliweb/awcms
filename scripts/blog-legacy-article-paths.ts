/**
 * blog-legacy-article-paths.ts — `bun run blog:legacy:article-paths`.
 *
 * ADR-0114's missing artefact, and ADR-0115's destination for it. Issues #599
 * and #711.
 *
 * ## What this produces, and for whom
 *
 * An **id → path table**: every legacy article id this tenant carries, against
 * the path the consuming site serves that article at. ADR-0114 decided a legacy
 * article URL resolves on its LEADING DIGITS — `/news/{id}_{Judul}.html` is
 * keyed on `{id}` against `awcms_blog_posts.legacy_source_id`, never on a
 * title-derived slug — and that the 301 executes at the EDGE, which is the only
 * layer that can collapse `http→https`, `www→apex` and `legacy→new` into the
 * one hop PRD §9.2 requires.
 *
 * So the deliverable from this repo is an artefact plus its provenance, not a
 * write. Nothing here touches `awcms_seo_redirects`: ADR-0114 declares that
 * table, and the `--path-template` flag on `blog:legacy:redirects:import`,
 * INERT for this cutover — they write rules into a table consulted by a
 * middleware these requests never reach.
 *
 * ## Why it is not committed, when the rubrik map is
 *
 * The exact inverse of that map's justification, and the same rule underneath:
 * **commit what cannot be regenerated.** The rubrik map came from a PHP working
 * copy and a MariaDB volume that live on one workstation and ship nowhere. This
 * one is re-derivable from the tenant by definition — `legacy_source_id` is a
 * column on every imported row — and 25,029 rows of a live newsroom's headlines
 * are still growing, so a committed copy would be wrong the week after it landed
 * and would carry an editorial archive into git history for no gain.
 *
 * ## The destination, which had never been decided (ADR-0115)
 *
 * ADR-0113 sent the rubrik listings to `/kategori/{slug}`, served by
 * `ahliweb/awcms-astro`. Nothing then said where the ARTICLES go, and the only
 * article derivation in the repo — `listLegacyRedirectMappings` — hard-codes
 * `/blog/{tenantCode}/{slug}`, THIS repo's surface. The two committed halves of
 * one cutover therefore pointed at two different origins, and a reader clicking
 * an article out of a category archive would have crossed between them.
 *
 * ADR-0115 puts both halves on `awcms-astro`, so an article's path is
 * `/{section}/{slug}` — the shape `[tab]/[...slug].astro` serves, where the tab
 * comes from `content_json.awcmsAstro.kategori`.
 *
 * ## Why a row with no section is REFUSED rather than given a path
 *
 * That field is not decoration on the consuming side: `getArticles` keeps a
 * post only when `readBlock(post).kategori === tab`, so a post without one is
 * not built AT ALL — no article page, and no category archive either, because
 * those are assembled from the same tab-filtered set. Emitting `/{null}/{slug}`
 * or guessing a section would produce exactly
 * `CUTOVER_VERDICT_REASON.target_missing`: "a 301 into a 404, which is worse
 * than the 404 it replaces".
 *
 * The fix is upstream and it is a flag: re-run `blog:legacy:import` with
 * `--section-map=<path>`. This job reports the count and refuses to emit while
 * any remain, because an artefact that is 96% right is one nobody audits.
 *
 * ## What it deliberately does NOT emit
 *
 * No VCL, no nginx `map`, no Cloudflare bulk-redirect CSV. `infra/varnish/default.vcl`
 * is the file that runs in production (`docs/awcms/environments.md`: "copied
 * verbatim … checksums matched"), and it `import std;` and nothing else —
 * Varnish OSS has no dictionary vmod here, so 25,029 keyed lookups are not
 * expressible in it at all. Choosing a tier and a syntax on the operator's
 * behalf is precisely the class of guess ADR-0114 exists to record: the last one
 * assumed which repo would serve a path and was wrong. Two neutral forms are
 * written instead — JSON with provenance, and a two-column TSV — and the edge
 * wiring stays an operational step, named as one.
 *
 * ## Roles
 *
 * The APP role, reading inside a tenant transaction. It writes nothing to the
 * database and takes no `--commit`, because there is nothing to commit.
 */
import path from "node:path";

import { getDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import {
  listLegacyArticlePaths,
  type LegacyArticlePath
} from "../src/modules/blog-content/application/blog-post-directory";
import { isValidSlug } from "../src/modules/blog-content/domain/slug-policy";

/**
 * Anchored to this file, exactly as the rubrik builder's map is: an artefact
 * belongs beside the data directory it describes, not in whatever directory the
 * operator happened to be standing in.
 */
const EMIT_DIR = path.resolve(import.meta.dir, "../data/seputarborneo-legacy");

/** A pageful is `LEGACY_REDIRECT_MAP_LIMIT`; this bounds a runaway loop, not a page. */
const MAX_PAGES = 2_000;

export type ArticlePathEntry = {
  legacyId: string;
  /**
   * The path the consuming site serves.
   *
   * Unprefixed for `--default-locale`, `/{locale}`-prefixed otherwise. It does
   * NOT claim the locale "has routes" — an earlier version of this line did,
   * and nothing in the file asked. Whether the consuming site is configured for
   * a locale is a fact in another repository; what this file can promise is
   * that all three segments are valid path segments, and it now checks all
   * three. A locale with no routes on that site shows up as a 404 in
   * `blog:legacy:edge:verify`, which is the tool that CAN ask.
   */
  targetPath: string;
  slug: string;
  section: string;
  locale: string;
};

export type ArticlePathProblem = {
  legacyId: string;
  problem: string;
};

/**
 * Something worth seeing that does NOT stop the artefact being written.
 *
 * Separate from `problems` because `main` refuses the whole run on a single
 * problem. Folding the two together made the report say "N row(s) cannot be
 * given a path" about rows that had been given one — a message that sends an
 * operator looking for a defect that is not there.
 */
export type ArticlePathNote = {
  legacyId: string;
  note: string;
};

export type ArticlePathBuild = {
  entries: ArticlePathEntry[];
  problems: ArticlePathProblem[];
  notes: ArticlePathNote[];
};

/**
 * The path the CONSUMING site serves one article at.
 *
 * ## Why this is not `withPublicLocalePrefix`
 *
 * That function is this repo's rule for `/blog/**` and it prefixes EVERY
 * locale, the default one included: `/id/hukum/x`. `awcms-astro` does the
 * opposite — `localePath` in its `config/site.ts` returns the path UNCHANGED
 * when the locale is its default, and only a non-default locale gets a `/{lang}`
 * segment. Using this repo's rule would therefore emit `/id/hukum/x` for the
 * 25,029 Indonesian articles of a site whose Indonesian pages live at
 * `/hukum/x`, and every one of them would 301 into a 404.
 *
 * The committed rubrik map already says so out loud: its targets are
 * `/kategori/daerah`, not `/id/kategori/daerah`.
 *
 * ## Why `defaultLocale` is a PARAMETER and not a constant
 *
 * It is the consuming repo's `siteConfig` value, not ours. Hard-coding `"id"`
 * here would bake one deployment's configuration into a generator, and the
 * failure it produces — a whole archive prefixed or unprefixed wrongly — is
 * silent. ADR-0114 exists because a decision was made about another repo's
 * behaviour without reading it; a required flag is the smallest thing that
 * stops this being the same mistake.
 *
 * ## The trailing slash is the consumer's CANONICAL form, and that is the whole
 * reason — it is NOT a hop
 *
 * `awcms-astro` builds with Astro's default directory format, so an article is
 * `dist/client/{tab}/{slug}/index.html`; it links its own articles as
 * `/{tab}/{slug}/` (`lib/menu.ts`, `lib/feed-seksi.ts`), its sitemap lists that
 * form, and the page's own `<link rel="canonical">` names it.
 *
 * An earlier version of this comment said a redirect onto the slashless
 * spelling "is at best one more hop". **Measured against the real built server
 * — `node server/penyaji.mjs`, both spellings requested — that is FALSE:
 * `/panduan/artikel-0` and `/panduan/artikel-0/` both answer 200 with no
 * `Location` at all.** The reason to emit the slash is therefore
 * canonicalisation, not hop count: 25,029 permanent redirects onto a
 * non-canonical spelling point every one of them at a page whose own canonical
 * tag names a different URL, which for a migration whose entire purpose is
 * preserving ranking is the thing that matters. Corrected here rather than
 * quietly dropped, because the wrong reason would have survived as folklore.
 */
export function consumerArticlePath(
  section: string,
  slug: string,
  locale: string,
  defaultLocale: string
): string {
  const bare = `/${section}/${slug}/`;
  return locale === defaultLocale ? bare : `/${locale}${bare}`;
}

/**
 * Rows in, artefact out. Pure, so every refusal is provable without a database.
 */
export function buildArticlePaths(
  rows: readonly LegacyArticlePath[],
  options: { defaultLocale: string }
): ArticlePathBuild {
  const entries: ArticlePathEntry[] = [];
  const problems: ArticlePathProblem[] = [];
  const notes: ArticlePathNote[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Map<string, string>();

  for (const row of rows) {
    if (seenIds.has(row.legacyId)) {
      // The keyset page walk uses `legacy_source_id > after`, so a repeat means
      // the paging broke rather than the data being odd — and a duplicate key
      // in a redirect table is a rule whose behaviour depends on load order.
      problems.push({
        legacyId: row.legacyId,
        problem: "legacy id appears twice — the page walk returned it again"
      });
      continue;
    }
    seenIds.add(row.legacyId);

    if (row.section === null || row.section.length === 0) {
      problems.push({
        legacyId: row.legacyId,
        problem:
          "no content_json.awcmsAstro.kategori — the consuming site builds NO page for this " +
          "article, so any rule pointing at it would 301 into a 404. Re-run " +
          "`blog:legacy:import --section-map=<path>`"
      });
      continue;
    }

    // THREE segments become a URL here — `/{locale}/{section}/{slug}/` — and
    // every one of them is checked with the repo's ONE slug rule rather than a
    // copy of it. A section is validated at map-parse time too; it is checked
    // AGAIN here because the value read back out of the database may predate
    // that check.
    //
    // The locale used to be interpolated raw, under a comment that said "both
    // halves … are checked" while the function built three. That is this repo's
    // named class in a file added to fix an instance of it: a comment asserting
    // a binding no call makes. `awcms_blog_posts.locale` is a plain text column
    // with no CHECK constraint, so the only thing between it and a path segment
    // is this line.
    if (!isValidSlug(row.locale)) {
      problems.push({
        legacyId: row.legacyId,
        problem: `locale "${row.locale}" is not a valid slug — it cannot be a path segment`
      });
      continue;
    }

    if (!isValidSlug(row.section)) {
      problems.push({
        legacyId: row.legacyId,
        problem: `section "${row.section}" is not a valid slug — it cannot be a path segment`
      });
      continue;
    }

    if (!isValidSlug(row.slug)) {
      problems.push({
        legacyId: row.legacyId,
        problem: `slug "${row.slug}" is not a valid slug — it cannot be a path segment`
      });
      continue;
    }

    const targetPath = consumerArticlePath(
      row.section,
      row.slug,
      row.locale,
      options.defaultLocale
    );

    // Two legacy ids resolving to ONE page is not an error — a legacy archive
    // republished an article under a second id often enough — so BOTH ids keep
    // their entry and both reach the edge.
    //
    // It is recorded as a `note`, not a `problem`, and that distinction is the
    // whole reason this type has two lists. It used to push a `problem` under a
    // comment saying it was "reported without refusing", while `main` refuses
    // the entire artefact the moment `problems` is non-empty and prints
    // "N row(s) cannot be given a path" — about a row that HAD been given one
    // and was sitting in `entries`. The comment described the branch; the exit
    // code described the run; they disagreed.
    const firstClaim = seenPaths.get(targetPath);
    if (firstClaim !== undefined) {
      notes.push({
        legacyId: row.legacyId,
        note: `resolves to ${targetPath}, already claimed by legacy id ${firstClaim} — two legacy URLs land on one page, and both keep their rule`
      });
    } else {
      seenPaths.set(targetPath, row.legacyId);
    }

    entries.push({
      legacyId: row.legacyId,
      targetPath,
      slug: row.slug,
      section: row.section,
      locale: row.locale
    });
  }

  return { entries, problems, notes };
}

/**
 * The TSV half of the artefact — `legacyId<TAB>path`, one per line.
 *
 * Deliberately the dumbest format that carries the whole answer. Every edge
 * tier can read two columns; none of them agree on anything richer, and this
 * repo does not know which tier will load it (see the header).
 */
export function renderArticlePathTsv(
  entries: readonly ArticlePathEntry[]
): string {
  return `${entries.map((entry) => `${entry.legacyId}\t${entry.targetPath}`).join("\n")}\n`;
}

function flag(name: string): string | null {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") || null : null;
}

/**
 * Print the usage banner AND fail the run.
 *
 * `process.exitCode = 1` is why this is a function rather than a bare
 * `console.error`: `blog:legacy:cutover:verify` exited 0 on every usage error
 * for its whole life, so `… && deploy` deployed when a flag was misspelled,
 * having verified nothing. The same shape would be the same bug here.
 */
function usage(message: string): void {
  console.error(
    `blog:legacy:article-paths — ${message}\n\n` +
      "  --tenant=<uuid>      the tenant holding the imported archive (required)\n" +
      "  --system=<name>      the legacy_source_system the import wrote (required)\n" +
      "  --default-locale=<c> the CONSUMING site's default locale (required). Articles in it\n" +
      "                       are served unprefixed; every other locale gets a /{code} segment.\n" +
      "                       Read it from that repo's siteConfig — guessing prefixes or\n" +
      "                       unprefixes the whole archive, silently.\n" +
      "  --emit               write the artefact. Without it you get the report only.\n\n" +
      "Writes nothing to the database. Exits non-zero on a usage error or when any\n" +
      "row cannot be given a path.\n"
  );
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const tenantId = flag("tenant");
  const system = flag("system");
  const defaultLocale = flag("default-locale");
  const emit = process.argv.includes("--emit");

  if (!tenantId) return usage("--tenant=<uuid> is required");
  if (!system) return usage("--system=<name> is required");
  // Required rather than defaulted. It is the CONSUMING repo's config value,
  // and the whole archive is prefixed or unprefixed wrongly if it is guessed —
  // silently, because both spellings look like paths.
  if (!defaultLocale) {
    return usage(
      "--default-locale=<code> is required (the consuming site's siteConfig defaultLocale)"
    );
  }

  const sql = getDatabaseClient();

  try {
    const rows: LegacyArticlePath[] = [];

    await withTenantOrThrow(sql, tenantId, async (tx) => {
      let after: string | null = null;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const batch: LegacyArticlePath[] = await listLegacyArticlePaths(
          tx,
          tenantId,
          { system, afterLegacyId: after }
        );

        if (batch.length === 0) return;

        rows.push(...batch);
        after = batch[batch.length - 1]!.legacyId;
      }

      // Reaching the bound means the walk did not terminate. Reported rather
      // than silently truncated: a partial artefact loaded at the edge is a map
      // that looks complete and 404s the tail.
      throw new Error(
        `the page walk did not finish within ${MAX_PAGES} pages (${rows.length} rows so far) — refusing a partial artefact`
      );
    });

    const { entries, problems, notes } = buildArticlePaths(rows, {
      defaultLocale
    });

    console.log(
      `blog:legacy:article-paths ${emit ? "EMIT" : "PREVIEW (nothing written — pass --emit)"}\n` +
        `  tenant      ${tenantId}\n` +
        `  system      ${system}\n` +
        `  rows read   ${rows.length}\n` +
        `  entries     ${entries.length}\n` +
        `  problems    ${problems.length}\n` +
        `  notes       ${notes.length}\n` +
        `  sections    ${[...new Set(entries.map((entry) => entry.section))].sort().join(", ") || "(none)"}\n`
    );

    if (notes.length > 0) {
      // Printed BEFORE the refusal block and on stdout: these do not stop the
      // run, and mixing them into the failure list is what made the old message
      // false.
      console.log(
        `${notes.length} row(s) worth seeing (the artefact is still written):\n`
      );
      for (const note of notes.slice(0, 20)) {
        console.log(`  [${note.legacyId}] ${note.note}`);
      }
      if (notes.length > 20) {
        console.log(`  ... and ${notes.length - 20} more\n`);
      }
      console.log("");
    }

    if (problems.length > 0) {
      console.error(`${problems.length} row(s) cannot be given a path:\n`);
      for (const problem of problems.slice(0, 20)) {
        console.error(`  [${problem.legacyId}] ${problem.problem}`);
      }
      if (problems.length > 20) {
        console.error(`  ... and ${problems.length - 20} more`);
      }
      console.error(
        "\n  Nothing was written. An artefact missing rows is a map that looks complete\n" +
          "  and 404s whatever it left out.\n"
      );
      process.exitCode = 1;
      return;
    }

    if (!emit) {
      console.log(
        "Preview only. Re-run with --emit to write the artefact.\n\n" +
          "  It is loaded by the EDGE (ADR-0114), not by this application — nothing here\n" +
          "  writes awcms_seo_redirects for this cutover. After the edge is wired, prove it\n" +
          "  over HTTP with `bun run blog:legacy:edge:verify`, which is the only tool in\n" +
          "  this repo that requests the URLs a reader would.\n"
      );
      return;
    }

    const jsonPath = path.join(EMIT_DIR, "article-paths.json");
    const tsvPath = path.join(EMIT_DIR, "article-paths.tsv");

    // `generatedAt` is the ONE place a timestamp belongs in this artefact, and
    // it is the reason a regenerated file always differs from the last: the
    // table is a snapshot of a live newsroom, and a copy with no date on it
    // cannot be told apart from a stale one.
    await Bun.write(
      jsonPath,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: {
            tenantId,
            system,
            defaultLocale,
            derivedFrom:
              "awcms_blog_posts.legacy_source_id + content_json.awcmsAstro.kategori",
            decision: "ADR-0114 (id-keyed, edge-owned) + ADR-0115 (destination)"
          },
          entries
        },
        null,
        2
      )}\n`
    );

    await Bun.write(tsvPath, renderArticlePathTsv(entries));

    console.log(
      `wrote ${jsonPath} (${entries.length} entries)\n` +
        `wrote ${tsvPath}\n\n` +
        "  REGENERATED, never hand-edited. Both files are gitignored: they are derived\n" +
        "  from a tenant that keeps growing, and a committed copy is wrong the week after.\n"
    );
  } finally {
    // Without this the pool holds its connections open and the process lingers
    // past the report — the shape every other `blog:legacy:*` script closes.
    await sql.close({ timeout: 5 });
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    logScriptFailure("blog:legacy:article-paths", error);
    process.exitCode = 1;
  });
}
