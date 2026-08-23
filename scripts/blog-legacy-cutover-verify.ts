/**
 * blog-legacy-cutover-verify.ts — `bun run blog:legacy:cutover:verify`.
 *
 * Issue #599 scope item 4, and the only tool in the set that can fail the
 * Definition of Done's first half.
 *
 * ## What the other two jobs structurally cannot see
 *
 * `blog:legacy:import` writes provenance; `blog:legacy:redirects:import`
 * derives one rule per imported post and proves those rules do not chain. Both
 * reason only about articles that were imported. A legacy URL that was NOT —
 * a deleted article, a paginated index, a tag page, a section feed — produces
 * no rule at all, and nothing in the pipeline notices. It answers 404 on
 * cutover day, and the ranking does not come back.
 *
 * This job starts from the other end: the legacy site's OWN sitemap, which is
 * the closest thing there is to the set of URLs search engines actually hold.
 *
 * ## It writes nothing
 *
 * There is no `--commit` because there is nothing to commit. Every other job in
 * this family defaults to a report and takes a flag to write; this one has no
 * write mode at all, which is why it is safe to run against production
 * repeatedly, and why it should be run again after the redirect import.
 *
 * ## It drives the real resolution path
 *
 * The chain walk is `resolveRedirectChain` with `findActiveRedirectByPath` as
 * its lookup — the same function pair the middleware uses on a live request —
 * and target liveness is `fetchPublicBlogPostBySlug`, the same call the public
 * post route makes. A verifier that reimplements resolution proves that the
 * reimplementation agrees with the sitemap, which is not the question.
 *
 * The retired-`/news` family is applied in the SAME precedence the resolver
 * uses (ADR-0111): a tenant rule first, that rewrite only as a fallback. Before
 * that ADR the order was reversed, and it silently made every rule this job
 * checks unreachable.
 *
 * ## Roles
 *
 * The APP role. It reads posts and redirect rules inside a tenant transaction;
 * `awcms_worker` has no reason to gain SELECT on either for a job run by hand.
 */
import { readFileSync } from "node:fs";

import { getDatabaseClient } from "../src/lib/database/client";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import { logScriptFailure } from "../src/lib/logging/error-log";
import { fetchPublicBlogPostBySlug } from "../src/modules/blog-content/application/public-blog-directory";
import {
  CUTOVER_VERDICT_REASON,
  classifyCutoverOutcome,
  parseSitemapLocations,
  sitemapLocationPath,
  type CutoverVerdict
} from "../src/modules/seo-distribution/domain/cutover-verification";
import { findActiveRedirectByPath } from "../src/modules/seo-distribution/application/redirect-directory";
import { resolveRedirectChain } from "../src/modules/seo-distribution/domain/redirect-chain";
import { isRedirectEligiblePath } from "../src/modules/seo-distribution/domain/redirect-eligibility";
import { normalizeRedirectPath } from "../src/modules/seo-distribution/domain/redirect-path";
import {
  buildLegacyBlogPath,
  parseRetiredNewsPath
} from "../src/modules/seo-distribution/domain/retired-news-redirect";
import { splitPublicLocalePath } from "../src/lib/i18n/public-locale-path";

/** Examples printed per failing verdict. The full set goes to `--json`. */
const EXAMPLES_PER_VERDICT = 5;

function flag(name: string): string | null {
  const found = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.split("=").slice(1).join("=") || null : null;
}

function flags(name: string): string[] {
  return process.argv
    .filter((arg) => arg.startsWith(`--${name}=`))
    .map((arg) => arg.split("=").slice(1).join("="))
    .filter((value) => value.length > 0);
}

function usage(message: string): void {
  console.error(
    `blog:legacy:cutover:verify — ${message}\n\n` +
      "  --tenant=<uuid>          the tenant that will serve the migrated archive (required)\n" +
      "  --tenant-code=<code>     its public tenant_code, used for the retired-/news fallback (required)\n" +
      "  --sitemap=<path>         the LEGACY site's sitemap XML. Repeat for each child of an index.\n" +
      "  --host=<host>            scope host-scoped rules to this verified host (optional)\n" +
      "  --limit=<n>              stop after n URLs — for a quick sample, not for a cutover decision\n" +
      "  --json=<path>            write the full per-URL report here\n\n" +
      "Writes nothing. Exits non-zero when any URL would lose its ranking.\n"
  );
}

/**
 * The slug a public blog path points at, or `null` when the path is not a post
 * detail URL of this tenant.
 *
 * Target liveness is only decidable for paths this repo serves as posts. A rule
 * pointing at a category archive or an external site is reported as resolving
 * without a liveness claim rather than as a failure, because asserting a claim
 * this job cannot check is how a green report stops meaning anything.
 */
function postSlugFromPath(path: string, tenantCode: string): string | null {
  const { pathname: bare } = splitPublicLocalePath(path);
  const prefix = `/blog/${tenantCode}/`;
  if (!bare.startsWith(prefix)) return null;

  const rest = bare.slice(prefix.length);
  // A post detail URL has exactly one segment left. `category/x` and `tag/y`
  // are archives, not posts.
  if (rest.length === 0 || rest.includes("/")) return null;
  return rest;
}

async function main(): Promise<void> {
  const tenantId = flag("tenant");
  const tenantCode = flag("tenant-code");
  const sitemapPaths = flags("sitemap");
  const host = flag("host");
  const limitRaw = flag("limit");
  const jsonPath = flag("json");

  if (!tenantId) return usage("--tenant=<uuid> is required");
  if (!tenantCode) return usage("--tenant-code=<code> is required");
  if (sitemapPaths.length === 0) {
    return usage("--sitemap=<path> is required (repeat it for each child)");
  }

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
    return usage("--limit must be a positive integer");
  }

  // Collect every `<loc>`, refusing a sitemap index rather than checking its
  // children as if they were pages.
  const paths: string[] = [];
  const unparsable: string[] = [];
  for (const file of sitemapPaths) {
    const parsed = parseSitemapLocations(readFileSync(file, "utf8"));

    if (parsed.kind === "too_large") {
      console.error(
        `${file}: ${parsed.bytes} bytes exceeds the parse ceiling. Split it, or pass the index's children.`
      );
      process.exitCode = 1;
      return;
    }
    if (parsed.kind === "empty") {
      console.error(`${file}: no <loc> entries — is this a sitemap?`);
      process.exitCode = 1;
      return;
    }
    if (parsed.kind === "sitemapindex") {
      console.error(
        `${file}: this is a sitemap INDEX. Its ${parsed.locations.length} <loc> entries are child sitemaps, not pages.\n` +
          "Download the children and pass each with its own --sitemap= flag. Checking the index itself\n" +
          "would verify that a handful of .xml files redirect and report success having read no page URL."
      );
      process.exitCode = 1;
      return;
    }

    for (const location of parsed.locations) {
      const path = sitemapLocationPath(location);
      if (path === null) unparsable.push(location);
      else paths.push(path);
    }
  }

  const targets = limit === null ? paths : paths.slice(0, limit);

  console.log(
    `Verifying ${targets.length} legacy URL(s)` +
      (limit !== null && paths.length > targets.length
        ? ` (SAMPLE of ${paths.length} — not a cutover decision)`
        : "") +
      ` against tenant ${tenantId}.\n`
  );

  const sql = getDatabaseClient();
  const now = new Date();

  type Row = {
    path: string;
    verdict: CutoverVerdict;
    resolvedTo: string | null;
    hops: number;
  };
  const rows: Row[] = [];

  await withTenantOrThrow(sql, tenantId, async (tx) => {
    for (const path of targets) {
      const normalized = normalizeRedirectPath(path);
      const lookupPath = normalized.ok ? normalized.path : path;
      const eligible = isRedirectEligiblePath(path);

      const outcome = eligible
        ? await resolveRedirectChain(lookupPath, (pathKey) =>
            findActiveRedirectByPath(tx, tenantId, pathKey, {
              locale: null,
              host,
              now
            })
          )
        : ({ outcome: "none" } as const);

      let hops = 0;
      let resolvedTo: string | null = null;
      let refusal: "loop" | "chain_too_long" | null = null;

      if (outcome.outcome === "redirect") {
        hops = outcome.hops.length;
        resolvedTo = outcome.finalTarget;
      } else if (outcome.outcome === "loop") {
        refusal = "loop";
      } else if (outcome.outcome === "chain_too_long") {
        refusal = "chain_too_long";
      }

      // No tenant rule fired. The retired-`/news` family is the fallback, in
      // the same precedence the resolver applies (ADR-0111) — so a URL only
      // reaches it when nothing more specific claimed the path.
      if (hops === 0 && refusal === null) {
        const rest = parseRetiredNewsPath(path);
        if (rest !== null) {
          hops = 1;
          resolvedTo = buildLegacyBlogPath(tenantCode, rest);
        }
      }

      // Liveness, only where it is decidable — see `postSlugFromPath`.
      let targetLive: boolean | null = null;
      if (resolvedTo !== null) {
        const slug = postSlugFromPath(resolvedTo, tenantCode);
        if (slug !== null) {
          const post = await fetchPublicBlogPostBySlug(tx, tenantId, slug);
          targetLive = post !== null;
        }
      }

      rows.push({
        path,
        verdict: classifyCutoverOutcome({
          eligible,
          hops,
          refusal,
          targetLive
        }),
        resolvedTo,
        hops
      });
    }
  });

  const byVerdict = new Map<CutoverVerdict, Row[]>();
  for (const row of rows) {
    const list = byVerdict.get(row.verdict) ?? [];
    list.push(row);
    byVerdict.set(row.verdict, list);
  }

  const clean = byVerdict.get("ok")?.length ?? 0;
  console.log(`  ok              ${clean}`);
  for (const [verdict, list] of [...byVerdict].sort()) {
    if (verdict === "ok") continue;
    console.log(`  ${verdict.padEnd(15)} ${list.length}`);
    console.log(`      ${CUTOVER_VERDICT_REASON[verdict]}`);
    for (const row of list.slice(0, EXAMPLES_PER_VERDICT)) {
      console.log(
        `      ${row.path}${row.resolvedTo ? ` -> ${row.resolvedTo}` : ""}`
      );
    }
    if (list.length > EXAMPLES_PER_VERDICT) {
      console.log(
        `      ... and ${list.length - EXAMPLES_PER_VERDICT} more (use --json for all)`
      );
    }
  }

  if (unparsable.length > 0) {
    console.log(
      `\n  ${unparsable.length} <loc> entry/entries were not usable URLs and were NOT checked:`
    );
    for (const location of unparsable.slice(0, EXAMPLES_PER_VERDICT)) {
      console.log(`      ${location}`);
    }
  }

  if (jsonPath) {
    await Bun.write(jsonPath, `${JSON.stringify(rows, null, 2)}\n`);
    console.log(`\nFull report written to ${jsonPath}`);
  }

  const failures = rows.length - clean;
  if (failures > 0 || unparsable.length > 0) {
    console.error(
      `\n${failures} URL(s) would lose their ranking at cutover. Nothing was written; fix the map and run again.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\nAll ${rows.length} legacy URL(s) resolve in one hop to a page this deployment serves.`
  );
}

main().catch((error) => {
  logScriptFailure("blog:legacy:cutover:verify", error);
  process.exitCode = 1;
});
