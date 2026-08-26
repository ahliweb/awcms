/**
 * Pre-cutover verification for a legacy archive (Issue #599, scope item 4).
 *
 * Pure — sitemap parsing and verdict classification — so the decisions run
 * under `bun test` without a database and without a live legacy site. The
 * script (`scripts/blog-legacy-cutover-verify.ts`) supplies the lookups.
 *
 * ## The half no other tool can answer
 *
 * `blog:legacy:redirects:import` derives its rules FROM the posts it imported,
 * so it can prove those rules do not chain. What it structurally cannot see is
 * a legacy URL that was never imported at all — a deleted article, a paginated
 * index, a tag page, a section feed. Those produce no rule, and nobody finds
 * out until a crawler does, months later, as ranking that does not come back.
 *
 * The Definition of Done has two halves — no legacy URL resolves to a 404, and
 * none resolves through a chain longer than one hop. The importer answers the
 * second for the URLs it knows about. This answers both, for every URL the
 * legacy site actually published.
 */

/** A sitemap larger than this is refused rather than parsed — see `parseSitemapLocations`. */
export const SITEMAP_MAX_BYTES = 64 * 1024 * 1024;

export type SitemapParse =
  | { kind: "urlset"; locations: string[] }
  | { kind: "sitemapindex"; locations: string[] }
  | { kind: "empty" }
  | { kind: "too_large"; bytes: number };

const LOC_PATTERN = /<loc>([\s\S]*?)<\/loc>/gi;

/** XML entity decode, `&amp;` LAST so `&amp;lt;` does not become `<`. */
function decodeXmlEntities(text: string): string {
  return text
    .split("&apos;")
    .join("'")
    .split("&quot;")
    .join('"')
    .split("&gt;")
    .join(">")
    .split("&lt;")
    .join("<")
    .split("&amp;")
    .join("&");
}

/**
 * Pull every `<loc>` out of a sitemap document.
 *
 * A sitemap INDEX is reported as such rather than flattened. Its `<loc>`
 * entries are child SITEMAP urls, not page urls; validating them as pages
 * would check that a handful of `.xml` files redirect correctly and report
 * a confident green having looked at none of the 23,906 pages. Refusing is the
 * only honest answer, and the caller is told to pass the children instead.
 */
export function parseSitemapLocations(
  xml: string,
  maxBytes: number = SITEMAP_MAX_BYTES
): SitemapParse {
  const bytes = Buffer.byteLength(xml, "utf8");
  if (bytes > maxBytes) return { kind: "too_large", bytes };

  const locations: string[] = [];
  for (const match of xml.matchAll(LOC_PATTERN)) {
    const value = decodeXmlEntities((match[1] ?? "").trim());
    if (value.length > 0) locations.push(value);
  }

  if (locations.length === 0) return { kind: "empty" };

  // `<sitemapindex>` is the document element of an index. Checked on the raw
  // text rather than by parsing, because the only thing that matters is which
  // of the two schemas this is.
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  return { kind: isIndex ? "sitemapindex" : "urlset", locations };
}

/**
 * The path a sitemap `<loc>` refers to, or `null` when the entry is not a URL
 * this check can reason about.
 *
 * Returns the pathname only. The legacy host is not this deployment's host, and
 * comparing them would reject every entry of a real legacy sitemap.
 */
export function sitemapLocationPath(location: string): string | null {
  try {
    const url = new URL(location);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.pathname;
  } catch {
    // A relative `<loc>` is invalid per the sitemap protocol, but a real
    // legacy export ships them anyway. Accept an absolute path, refuse the rest.
    return location.startsWith("/") ? location : null;
  }
}

/**
 * Pull every URL out of a PLAIN LIST — one per line — and report it in the same
 * shape as a parsed sitemap so the caller has one code path for both.
 *
 * This exists because the premise of `--sitemap` failed on the first real
 * archive it met. SeputarBorneo has no sitemap and never had one: none in the
 * legacy tree, none in its git history, and the live site 404s `/robots.txt`
 * and every conventional sitemap path while serving 200 itself. "Needs the live
 * sitemap" was recorded as a blocker on Issue #711 — but the flag was always
 * reading a LOCAL FILE, so the blocker was only ever the XML wrapper. A list of
 * URLs assembled from a crawl, an access log, a Wayback CDX export or the
 * legacy database is the same evidence without the ceremony.
 *
 * A `#` is honoured ONLY as the first non-blank character of a line. A `#`
 * inside a URL is a fragment, and stripping from the first one would silently
 * truncate a real entry into a shorter URL that happens to parse — the quiet
 * kind of wrong this job exists to refuse.
 *
 * Never returns `sitemapindex`: a list of URLs cannot be one. The `empty` case
 * is still a refusal, because a file whose every line was blank or a comment
 * would otherwise let the run print "All 0 legacy URL(s) resolve" and exit 0.
 */
export function parseUrlListLocations(
  text: string,
  maxBytes: number = SITEMAP_MAX_BYTES
): SitemapParse {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) return { kind: "too_large", bytes };

  const locations: string[] = [];
  for (const line of text.split("\n")) {
    const value = line.trim();
    if (value.length === 0 || value.startsWith("#")) continue;
    locations.push(value);
  }

  if (locations.length === 0) return { kind: "empty" };
  return { kind: "urlset", locations };
}

export type CutoverVerdict =
  | "ok"
  | "no_rule"
  | "ineligible"
  | "chain_too_long"
  | "loop"
  | "target_missing"
  | "target_unverifiable";

export type CutoverFacts = {
  /** `isRedirectEligiblePath` — false means a tenant rule can never fire here. */
  eligible: boolean;
  /** How many rules the chain walked. 0 when nothing matched. */
  hops: number;
  /** The chain resolver's own refusal, when it refused. */
  refusal: "loop" | "chain_too_long" | null;
  /**
   * Whether the final destination is a page this deployment actually serves.
   *
   * `null` carries TWO different meanings, and the classifier separates them by
   * the hop count rather than by this field:
   *  - nothing resolved, so there is no destination to check (`hops === 0`);
   *  - a destination exists but is outside the surface the caller can look up
   *    (`hops > 0`) — another origin, another deployment, an external URL.
   */
  targetLive: boolean | null;
};

/**
 * Turn one URL's facts into a verdict.
 *
 * Only `ok` passes, and `ok` means CHECKED. Every other verdict is either a URL
 * that loses its ranking at cutover or one whose destination nobody looked at —
 * and the second used to be spelled `ok`.
 *
 * That was the defect `target_unverifiable` exists to close. `targetLive` came
 * back `null` for every destination the caller could not resolve, `null` fell
 * through to `return "ok"`, and the 62 `/kategori/**` rules of ADR-0113 were
 * therefore reported clean by a job that had not — could not — check a single
 * one of them, because they are served by a different deployment entirely
 * (ADR-0114). A verdict that says "I did not check this" is worth having; a
 * green that means "I did not check this" is worth less than no check at all.
 */
export function classifyCutoverOutcome(facts: CutoverFacts): CutoverVerdict {
  if (facts.refusal !== null) return facts.refusal;

  // Checked BEFORE the hop count: an ineligible path may still be claimed by
  // the retired-`/news` family, which resolves without any rule. Reporting it
  // as `no_rule` would send an operator looking for a missing row that was
  // never the problem.
  if (!facts.eligible && facts.hops === 0) return "ineligible";

  if (facts.hops === 0) return "no_rule";
  if (facts.hops > 1) return "chain_too_long";
  if (facts.targetLive === false) return "target_missing";

  // `hops` is necessarily 1 by the time control reaches here — 0 and >1 both
  // returned above — so the guard is redundant TODAY. It is written out anyway
  // because the invariant it protects is not local: `targetLive === null` also
  // means "nothing resolved", and that case is `no_rule`/`ineligible`, never
  // this. Reorder the lines above without the guard and an unresolved URL
  // starts reporting as an unverifiable one.
  if (facts.hops > 0 && facts.targetLive === null) return "target_unverifiable";

  return "ok";
}

/** Whether a verdict means this URL is ready for cutover. */
export function isCutoverClean(verdict: CutoverVerdict): boolean {
  return verdict === "ok";
}

/** One line of operator-facing explanation per verdict. */
export const CUTOVER_VERDICT_REASON: Record<CutoverVerdict, string> = {
  ok: "resolves in one hop to a page this deployment serves",
  no_rule:
    "no redirect rule matches — this URL will answer 404 after cutover, and its ranking is lost",
  ineligible:
    "the path is excluded from tenant redirects (admin/api/asset/discovery family) and nothing else claims it",
  chain_too_long:
    "resolves through more than one hop — PRD 9.2 forbids a chain here",
  loop: "the rules for this path form a loop and fail closed to a 404",
  target_missing:
    "redirects to a path this deployment does not serve — a 301 into a 404, which is worse than the 404 it replaces",
  target_unverifiable:
    "resolves in one hop, but to a destination outside the surface this job can look up — nothing here checked that the page at the end of it exists, and unchecked is not verified"
};
