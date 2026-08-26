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
 * This job starts from the other end: a corpus of the URLs the legacy site
 * actually published — its own sitemap (`--sitemap`), or a plain list of URLs
 * (`--urls`) when there is no sitemap to have. SeputarBorneo is the second case
 * and it is not exotic: no sitemap in the legacy tree, none in its git history,
 * and the live site 404s `/robots.txt` and every conventional sitemap path
 * while serving 200 itself. `--sitemap` always read a LOCAL FILE, so the
 * long-standing "needs the live sitemap" blocker on Issue #711 was only ever
 * the XML wrapper — a list assembled from a crawl, an access log, a Wayback CDX
 * export or the legacy database is the same evidence.
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
 * and target liveness goes through whichever loader the destination's own route
 * calls: `fetchPublicBlogPostBySlug`, `fetchPublicBlogPageBySlug` or
 * `fetchPublicTermBySlug`, plus the `legacyTenantRouteEnabled` /
 * `rssEnabled` / `sitemapEnabled` settings each of those routes consults BEFORE
 * it looks anything up. A verifier that reimplements resolution proves that the
 * reimplementation agrees with the sitemap, which is not the question.
 *
 * The retired-`/news` family is applied in the SAME precedence the resolver
 * uses (ADR-0111): a tenant rule first, that rewrite only as a fallback. Before
 * that ADR the order was reversed, and it silently made every rule this job
 * checks unreachable.
 *
 * ## What a green run does NOT prove
 *
 * This job makes ZERO HTTP requests. It asks the database "is there a rule, and
 * is there a row at the end of it" — which is not the question "does the origin
 * a reader hits emit a 301". Every claim below is scoped to THIS deployment's
 * tables and THIS deployment's routes, and a green run is a partial claim by
 * construction.
 *
 * Two ways that gap has already bitten, both recorded in ADR-0114:
 *
 *  - **A different repo serves the target.** ADR-0113's 63 rubrik rules — over
 *    the 68 entries in `data/seputarborneo-legacy/rubrik-redirects.json`; count
 *    that file rather than trusting this comment — point at `/kategori/**`,
 *    which is served by `ahliweb/awcms-astro`, a separate `output: "static"`
 *    deployment with no middleware file at all. No lookup this job can make
 *    would ever notice. The 67 entries committed at the time were replayed
 *    against that repo's real built server and returned 404 with zero
 *    `Location` headers (the 68th was added afterwards and has not been
 *    replayed), while this job had nothing to say about it. That is why an
 *    unlookupable destination is now `target_unverifiable` and not `ok`.
 *
 *  - **A different LAYER serves the redirect.** ADR-0114 puts the SeputarBorneo
 *    legacy 301s at the EDGE (Coolify/Varnish), the only layer that can collapse
 *    `http→https` + `www→apex` + `legacy→new` into the one hop PRD §9.2 demands.
 *    `awcms_seo_redirects` — the only table this job reads — is applied at
 *    exactly one call site, `src/middleware.ts:341`, which those requests never
 *    reach. For that cutover a green run here says the DB agrees with itself,
 *    and says nothing whatsoever about what the edge is configured to send.
 *
 * Verifying the edge means requesting the legacy URLs over HTTP and reading the
 * `Location` headers that come back. That is a different tool, and this is not
 * it.
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
import {
  fetchPublicBlogPageBySlug,
  fetchPublicBlogPostBySlug,
  fetchPublicTermBySlug
} from "../src/modules/blog-content/application/public-blog-directory";
import {
  fetchEffectivePublicRouteSettings,
  type EffectivePublicRouteSettings
} from "../src/modules/blog-content/application/public-route-settings";
import {
  CUTOVER_VERDICT_REASON,
  classifyCutoverOutcome,
  parseSitemapLocations,
  parseUrlListLocations,
  sitemapLocationPath,
  type CutoverVerdict,
  type SitemapParse
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

/**
 * Print the usage banner AND fail the run.
 *
 * `process.exitCode = 1` is the whole point of this function existing rather
 * than a bare `console.error`. Without it every usage error exited 0 — no args,
 * a missing `--tenant`, a missing `--tenant-code`, a missing `--sitemap`, a
 * misspelled flag name, `--limit=abc` — so
 * `bun run blog:legacy:cutover:verify --sitemap=$F && deploy` deployed when the
 * flag was mistyped, having verified nothing, while the last line of this very
 * banner promised "exits non-zero when any URL would lose its ranking".
 */
function usage(message: string): void {
  console.error(
    `blog:legacy:cutover:verify — ${message}\n\n` +
      "  --tenant=<uuid>          the tenant that will serve the migrated archive (required)\n" +
      "  --tenant-code=<code>     its public tenant_code, used for the retired-/news fallback (required)\n" +
      "  --sitemap=<path>         the LEGACY site's sitemap XML. Repeat for each child of an index.\n" +
      "  --urls=<path>            a plain list of legacy URLs instead — one per line, blank lines and\n" +
      "                           whole-line `#` comments skipped. Use this when the legacy site has no\n" +
      "                           sitemap (SeputarBorneo never had one). Repeatable; combines with --sitemap.\n" +
      "  --host=<host>            scope host-scoped rules to this verified host (optional)\n" +
      "  --limit=<n>              stop after n URLs — for a quick sample, not for a cutover decision\n" +
      "  --json=<path>            write the full per-URL report here\n\n" +
      "At least one --sitemap or --urls is required.\n" +
      "Writes nothing. Exits non-zero when any URL would lose its ranking.\n"
  );
  process.exitCode = 1;
}

/**
 * The segments under `/blog/{tenantCode}/`, or `null` when the target is not on
 * this deployment's public blog surface at all.
 *
 * Locale prefix, query and fragment are stripped first. A relative rule target
 * may legitimately carry a query — `normalizeRedirectPath` keeps one on a
 * target, and drops it only on a source — and the route that serves it looks at
 * the path segments alone, so matching `…/foo?page=2` against a slug would
 * report a working destination as missing.
 *
 * `/blog/{code}` exactly (the index) yields `[]`, which is a real answer and
 * not the same as `null`.
 */
function publicBlogSegments(path: string, tenantCode: string): string[] | null {
  const withoutFragment = path.split("#")[0] ?? "";
  const withoutQuery = withoutFragment.split("?")[0] ?? "";
  const { pathname: bare } = splitPublicLocalePath(withoutQuery);

  const root = `/blog/${tenantCode}`;
  if (bare === root || bare === `${root}/`) return [];
  if (!bare.startsWith(`${root}/`)) return null;

  return bare.slice(root.length + 1).split("/");
}

/**
 * Which of this deployment's public blog routes a redirect target names.
 *
 * `null` means "not this deployment's surface" — another origin, another
 * deployment, an external URL. That answer is the honest one and it is NOT a
 * pass: the caller turns it into `target_unverifiable`.
 *
 * `unrouted` is the opposite: the target IS under `/blog/{tenantCode}/` and no
 * route matches it, so `src/pages/[...path].ts` answers 404. That is knowable
 * without a lookup, and it is a failure.
 *
 * The enumeration is the eight files under `src/pages/blog/[tenantCode]/`, and
 * it has to stay that way. Leaving a real family out does not make this job
 * cautious — it makes it report `target_unverifiable`, and therefore red, for a
 * destination that works.
 */
export type PublicBlogTarget =
  | { kind: "index" }
  | { kind: "search" }
  | { kind: "feed" }
  | { kind: "sitemap" }
  | { kind: "post"; slug: string }
  | { kind: "page"; slug: string }
  | { kind: "term"; taxonomyType: "category" | "tag"; slug: string }
  | { kind: "unrouted" };

export function classifyPublicBlogTarget(
  path: string,
  tenantCode: string
): PublicBlogTarget | null {
  const segments = publicBlogSegments(path, tenantCode);
  if (segments === null) return null;

  if (segments.length === 0) return { kind: "index" };

  if (segments.length === 1) {
    const only = segments[0] ?? "";
    if (only === "search") return { kind: "search" };
    if (only === "feed.xml") return { kind: "feed" };
    if (only === "sitemap-blog.xml") return { kind: "sitemap" };
    // A trailing slash left an empty last segment: `/blog/{code}/x/` is not the
    // post `x`, it is a path no route claims.
    if (only.length === 0) return { kind: "unrouted" };
    return { kind: "post", slug: only };
  }

  if (segments.length === 2) {
    const [family, slug] = segments;
    if (slug === undefined || slug.length === 0) return { kind: "unrouted" };
    if (family === "category" || family === "tag") {
      return { kind: "term", taxonomyType: family, slug };
    }
    if (family === "pages") return { kind: "page", slug };
  }

  return { kind: "unrouted" };
}

/**
 * Whether the origin would serve this redirect destination.
 *
 * `null` is reserved for one meaning and one only: the destination is not this
 * deployment's surface, so nothing here looked. The caller turns that into
 * `target_unverifiable` — never into `ok`.
 *
 * `settings` is read ONCE per run and passed in, because every one of the eight
 * `/blog/{tenantCode}/*` routes consults it BEFORE looking anything up
 * (`public-route-settings.ts`; ADR-0071 §3). A verifier that checks only for a
 * row reports a live destination for a surface the tenant does not serve at
 * all — the same shape of wrong answer as checking a repo that does not serve
 * the target, which is the defect ADR-0114 records.
 */
export async function resolveTargetLiveness(
  tx: Bun.SQL,
  tenantId: string,
  tenantCode: string,
  settings: EffectivePublicRouteSettings,
  target: string
): Promise<boolean | null> {
  const classified = classifyPublicBlogTarget(target, tenantCode);
  if (classified === null) return null;
  if (classified.kind === "unrouted") return false;

  // Past this point every family is gated on the public surface being on, so an
  // off tenant is `false` everywhere without a single lookup.
  if (!settings.legacyTenantRouteEnabled) return false;

  switch (classified.kind) {
    case "index":
    case "search":
      return true;
    case "feed":
      return settings.rssEnabled;
    case "sitemap":
      return settings.sitemapEnabled;
    case "post":
      return (
        (await fetchPublicBlogPostBySlug(tx, tenantId, classified.slug)) !==
        null
      );
    case "page":
      return (
        (await fetchPublicBlogPageBySlug(tx, tenantId, classified.slug)) !==
        null
      );
    case "term":
      return (
        (await fetchPublicTermBySlug(
          tx,
          tenantId,
          classified.taxonomyType,
          classified.slug
        )) !== null
      );
  }
}

async function main(): Promise<void> {
  const tenantId = flag("tenant");
  const tenantCode = flag("tenant-code");
  const sitemapPaths = flags("sitemap");
  const urlListPaths = flags("urls");
  const host = flag("host");
  const limitRaw = flag("limit");
  const jsonPath = flag("json");

  if (!tenantId) return usage("--tenant=<uuid> is required");
  if (!tenantCode) return usage("--tenant-code=<code> is required");
  if (sitemapPaths.length === 0 && urlListPaths.length === 0) {
    return usage(
      "one of --sitemap=<path> or --urls=<path> is required (both are repeatable)"
    );
  }

  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) {
    return usage("--limit must be a positive integer");
  }

  // One loop over both corpus formats — a `--urls` list is reported in the same
  // shape as a parsed sitemap precisely so no refusal below is reachable from
  // one flag and not the other.
  const sources: {
    file: string;
    parse: (text: string) => SitemapParse;
    emptyMessage: string;
  }[] = [
    ...sitemapPaths.map((file) => ({
      file,
      parse: (text: string) => parseSitemapLocations(text),
      emptyMessage: "no <loc> entries — is this a sitemap?"
    })),
    ...urlListPaths.map((file) => ({
      file,
      parse: (text: string) => parseUrlListLocations(text),
      emptyMessage: "no URL lines — every line was blank or a `#` comment"
    }))
  ];

  // Collect every location, refusing a sitemap index rather than checking its
  // children as if they were pages.
  const paths: string[] = [];
  const unparsable: string[] = [];
  for (const { file, parse, emptyMessage } of sources) {
    const parsed = parse(readFileSync(file, "utf8"));

    if (parsed.kind === "too_large") {
      console.error(
        `${file}: ${parsed.bytes} bytes exceeds the parse ceiling. Split it, or pass the index's children.`
      );
      process.exitCode = 1;
      return;
    }
    if (parsed.kind === "empty") {
      console.error(`${file}: ${emptyMessage}`);
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
    /** The operator-facing line for `verdict`, so `--json` stands on its own. */
    reason: string;
    resolvedTo: string | null;
    hops: number;
    /** `true`/`false` checked, `null` NOT checked — the distinction `--json` used to drop. */
    targetLive: boolean | null;
  };
  const rows: Row[] = [];

  try {
    await withTenantOrThrow(sql, tenantId, async (tx) => {
      // Read ONCE, before the loop: these are tenant-level settings, and every
      // one of the eight `/blog/{tenantCode}/*` routes consults them BEFORE it
      // looks up anything (`public-route-settings.ts`; ADR-0071 §3). A verifier
      // that checks only for a row reports a live destination for a surface the
      // tenant does not serve at all — the same shape of wrong answer as
      // checking a repo that does not serve the target.
      const routeSettings = await fetchEffectivePublicRouteSettings(
        tx,
        tenantId
      );

      if (!routeSettings.legacyTenantRouteEnabled) {
        console.warn(
          `  WARNING: this tenant's \`legacyTenantRouteEnabled\` is OFF, so every /blog/${tenantCode}/…\n` +
            "  destination below answers 404 no matter which row backs it. Turn the public surface on\n" +
            "  before reading anything else in this report.\n"
        );
      }

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

        // Liveness. `null` here means NOT CHECKED, and the classifier turns
        // that into `target_unverifiable` rather than `ok`.
        const targetLive =
          resolvedTo === null
            ? null
            : await resolveTargetLiveness(
                tx,
                tenantId,
                tenantCode,
                routeSettings,
                resolvedTo
              );

        const verdict = classifyCutoverOutcome({
          eligible,
          hops,
          refusal,
          targetLive
        });

        rows.push({
          path,
          verdict,
          reason: CUTOVER_VERDICT_REASON[verdict],
          resolvedTo,
          hops,
          targetLive
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
    console.log(`  ok                  ${clean}`);
    for (const [verdict, list] of [...byVerdict].sort()) {
      if (verdict === "ok") continue;
      console.log(`  ${verdict.padEnd(19)} ${list.length}`);
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
        `\n  ${unparsable.length} entry/entries were not usable URLs and were NOT checked:`
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
        `\n${failures} URL(s) are not ready for cutover. Nothing was written; fix the map and run again.`
      );
      process.exitCode = 1;
      return;
    }

    console.log(
      `\nAll ${rows.length} legacy URL(s) resolve in one hop to a page THIS deployment serves.\n` +
        "That is a claim about this repo's tables and routes only — no HTTP request was made,\n" +
        "and under ADR-0114 the SeputarBorneo 301s execute at the EDGE, which this cannot see."
    );
  } finally {
    // Without this the pool holds its connections open and the process lingers
    // past the report — the shape every other `blog:legacy:*` script closes.
    await sql.close({ timeout: 5 });
  }
}

if (import.meta.main) {
  await main().catch((error) => {
    logScriptFailure("blog:legacy:cutover:verify", error);
    process.exitCode = 1;
  });
}
