/**
 * Pre-cutover verification (Issue #599 scope item 4) — sitemap parsing and
 * verdict classification.
 *
 * The value of this job is entirely in what it REFUSES. A verifier that
 * answers "clean" when it has not actually looked is worse than no verifier:
 * it converts an unknown into a false certainty, and the cost is paid months
 * later in ranking that does not come back. Most of what follows tests exactly
 * that boundary.
 */
import { describe, expect, test } from "bun:test";

import {
  CUTOVER_VERDICT_REASON,
  classifyCutoverOutcome,
  isCutoverClean,
  parseSitemapLocations,
  parseUrlListLocations,
  sitemapLocationPath,
  type CutoverVerdict
} from "../src/modules/seo-distribution/domain/cutover-verification";

const urlset = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://seputarborneo.test/news/48213_banjir-kobar.html</loc></url>
  <url><loc>https://seputarborneo.test/news/1_a.html?utm=x&amp;b=2</loc></url>
</urlset>`;

const sitemapindex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://seputarborneo.test/sitemap-1.xml</loc></sitemap>
  <sitemap><loc>https://seputarborneo.test/sitemap-2.xml</loc></sitemap>
</sitemapindex>`;

describe("parseSitemapLocations", () => {
  test("reads every <loc> of a urlset", () => {
    const parsed = parseSitemapLocations(urlset);
    expect(parsed.kind).toBe("urlset");
    expect(parsed.kind === "urlset" && parsed.locations.length).toBe(2);
  });

  test("a sitemap INDEX is reported as an index, never flattened", () => {
    // THE refusal that matters. An index's <loc>s are child sitemaps. Checking
    // them as pages would verify that two .xml files redirect correctly and
    // print a confident green having read none of the 23,906 page URLs.
    const parsed = parseSitemapLocations(sitemapindex);
    expect(parsed.kind).toBe("sitemapindex");
  });

  test("entities are decoded, `&amp;` last", () => {
    const parsed = parseSitemapLocations(urlset);
    const second = parsed.kind === "urlset" ? parsed.locations[1] : "";
    expect(second).toContain("?utm=x&b=2");
    // The ordering trap: decoding `&amp;` first turns `&amp;lt;` into `<`.
    const tricky = parseSitemapLocations(
      "<urlset><url><loc>https://x.test/a?q=&amp;lt;</loc></url></urlset>"
    );
    expect(tricky.kind === "urlset" && tricky.locations[0]).toBe(
      "https://x.test/a?q=&lt;"
    );
  });

  test("an empty or non-sitemap document is refused, not treated as clean", () => {
    expect(parseSitemapLocations("<urlset></urlset>").kind).toBe("empty");
    expect(parseSitemapLocations("not xml at all").kind).toBe("empty");
  });

  test("an oversized document is refused rather than parsed", () => {
    const parsed = parseSitemapLocations("<urlset/>".repeat(100), 16);
    expect(parsed.kind).toBe("too_large");
  });
});

describe("parseUrlListLocations", () => {
  test("a --urls list yields the SAME locations as the equivalent <urlset>", () => {
    // The whole justification for the flag: there is no legacy sitemap for
    // SeputarBorneo and there never was one, in the tree or in git history.
    // `--sitemap` always read a local file, so the "needs the live sitemap"
    // blocker was only ever the XML wrapper — and the two paths must produce
    // identical evidence, or the flag is a second, weaker check wearing the
    // first one's name.
    const fromSitemap = parseSitemapLocations(urlset);
    const fromList = parseUrlListLocations(
      [
        "# SeputarBorneo legacy corpus — assembled from a crawl, not a sitemap",
        "",
        "https://seputarborneo.test/news/48213_banjir-kobar.html",
        "   https://seputarborneo.test/news/1_a.html?utm=x&b=2   ",
        ""
      ].join("\n")
    );

    expect(fromList.kind).toBe("urlset");
    expect(fromList.kind === "urlset" && fromList.locations).toEqual(
      fromSitemap.kind === "urlset" ? fromSitemap.locations : []
    );
  });

  test("a `#` INSIDE a URL is a fragment, not a comment", () => {
    // Stripping from the first `#` would truncate a real entry into a shorter
    // URL that still parses — a silently different check.
    const parsed = parseUrlListLocations("/news/1_a.html#komentar");
    expect(parsed.kind === "urlset" && parsed.locations).toEqual([
      "/news/1_a.html#komentar"
    ]);
  });

  test("CRLF line endings do not leave a stray carriage return", () => {
    const parsed = parseUrlListLocations("/a.html\r\n/b.html\r\n");
    expect(parsed.kind === "urlset" && parsed.locations).toEqual([
      "/a.html",
      "/b.html"
    ]);
  });

  test("a file of nothing but blanks and comments is REFUSED, not called clean", () => {
    // Otherwise a mistyped corpus prints "All 0 legacy URL(s) resolve" and the
    // run exits 0 having checked nothing at all.
    expect(parseUrlListLocations("").kind).toBe("empty");
    expect(parseUrlListLocations("\n\n  \n# only a note\n").kind).toBe("empty");
  });

  test("an oversized list is refused rather than parsed", () => {
    expect(parseUrlListLocations("/a.html\n".repeat(100), 16).kind).toBe(
      "too_large"
    );
  });

  test("never reports an index — a list of URLs cannot be one", () => {
    // Even when a line happens to look like sitemap XML.
    const parsed = parseUrlListLocations("<sitemapindex> https://x.test/a.xml");
    expect(parsed.kind).toBe("urlset");
  });
});

describe("sitemapLocationPath", () => {
  test("keeps the path and discards the legacy host", () => {
    // The legacy host is not this deployment's host. Comparing them would
    // reject every entry of a real legacy sitemap.
    expect(
      sitemapLocationPath("https://seputarborneo.test/news/48213_x.html")
    ).toBe("/news/48213_x.html");
  });

  test("accepts a bare absolute path, which real exports do emit", () => {
    expect(sitemapLocationPath("/news/1_a.html")).toBe("/news/1_a.html");
  });

  test("refuses a non-http scheme and other junk", () => {
    expect(sitemapLocationPath("javascript:alert(1)")).toBeNull();
    expect(sitemapLocationPath("ftp://x.test/a")).toBeNull();
    expect(sitemapLocationPath("news/1_a.html")).toBeNull();
    expect(sitemapLocationPath("")).toBeNull();
  });
});

describe("classifyCutoverOutcome", () => {
  const base = {
    eligible: true,
    hops: 1,
    refusal: null,
    targetLive: true
  } as const;

  test("one hop to a live page is the only clean answer", () => {
    expect(classifyCutoverOutcome(base)).toBe("ok");
    expect(isCutoverClean("ok")).toBe(true);
  });

  test("no rule is a 404 after cutover", () => {
    expect(classifyCutoverOutcome({ ...base, hops: 0, targetLive: null })).toBe(
      "no_rule"
    );
  });

  test("more than one hop fails — PRD 9.2", () => {
    expect(classifyCutoverOutcome({ ...base, hops: 2 })).toBe("chain_too_long");
  });

  test("a 301 into a 404 is a failure, not a pass", () => {
    // The verdict that justifies the whole liveness lookup: a rule can be
    // present, unique, and one hop, and still send a crawler nowhere.
    expect(classifyCutoverOutcome({ ...base, targetLive: false })).toBe(
      "target_missing"
    );
  });

  test("an UNCHECKED target is not `ok` — the defect this verdict exists for", () => {
    // THE regression. `targetLive: null` on a resolved chain means "this job
    // could not look the destination up", and it used to fall through to `ok`.
    // Under that reading the 62 `/kategori/**` rules of ADR-0113 were reported
    // clean by a job that could not check one of them — they are served by a
    // different deployment entirely (ADR-0114), which no lookup here can reach.
    //
    // Delete the `target_unverifiable` line from `classifyCutoverOutcome` and
    // this assertion fails.
    expect(classifyCutoverOutcome({ ...base, targetLive: null })).toBe(
      "target_unverifiable"
    );
    expect(isCutoverClean("target_unverifiable")).toBe(false);
  });

  test("an unchecked target is still distinguished from a MISSING one", () => {
    // Two different operator actions. `target_missing` means fix the map;
    // `target_unverifiable` means go and check the layer this job cannot see.
    expect(classifyCutoverOutcome({ ...base, targetLive: false })).toBe(
      "target_missing"
    );
    expect(classifyCutoverOutcome({ ...base, targetLive: null })).toBe(
      "target_unverifiable"
    );
  });

  test("`targetLive: null` with NOTHING resolved stays no_rule/ineligible", () => {
    // The ordering trap the new branch had to avoid: `null` also means "there
    // was no destination to check". Reporting an unresolved URL as
    // unverifiable would hide a plain 404 behind a softer-sounding word.
    expect(classifyCutoverOutcome({ ...base, hops: 0, targetLive: null })).toBe(
      "no_rule"
    );
    expect(
      classifyCutoverOutcome({
        eligible: false,
        hops: 0,
        refusal: null,
        targetLive: null
      })
    ).toBe("ineligible");
  });

  test("the resolver's own refusals are surfaced verbatim", () => {
    expect(classifyCutoverOutcome({ ...base, hops: 0, refusal: "loop" })).toBe(
      "loop"
    );
    expect(
      classifyCutoverOutcome({ ...base, hops: 3, refusal: "chain_too_long" })
    ).toBe("chain_too_long");
  });

  test("an ineligible path is named as such, not as a missing rule", () => {
    // Otherwise an operator goes looking for a row that was never the problem:
    // no rule can EVER fire on an excluded family, so adding one will not help.
    expect(
      classifyCutoverOutcome({
        eligible: false,
        hops: 0,
        refusal: null,
        targetLive: null
      })
    ).toBe("ineligible");
  });

  test("an ineligible path that still resolves is judged on the resolution", () => {
    // The retired-`/news` rewrite needs no rule, so an excluded path can still
    // have a destination. Reporting `ineligible` there would hide a real 404.
    expect(
      classifyCutoverOutcome({
        eligible: false,
        hops: 1,
        refusal: null,
        targetLive: false
      })
    ).toBe("target_missing");
  });

  /**
   * DERIVED from the reason map, never re-listed by hand.
   *
   * Both tests below used to carry their own literal array of seven verdicts.
   * They passed over the members they listed and said nothing about a member
   * they did not — so `unreachable` was added to the union, `Record<CutoverVerdict,
   * string>` forced a reason for it at COMPILE time, and these two runtime
   * gates stayed green while covering six of seven. A list a human maintains
   * beside a union a compiler maintains falls behind on the first addition,
   * and it falls behind silently, which is this repo's named failure mode.
   *
   * `Record<CutoverVerdict, string>` is what makes this exhaustive: the type
   * cannot compile with a missing key, so its keys ARE the union.
   */
  const ALL_VERDICTS = Object.keys(CUTOVER_VERDICT_REASON) as CutoverVerdict[];

  test("the derived list really is every verdict, and it grew", () => {
    // Pins the count so a DELETION is as visible as an addition — a union that
    // silently shrinks takes its gate's coverage with it.
    //
    // This assertion has already earned its place once: it went red the moment
    // `unsafe_redirect` was added, which is precisely what the seven-entry
    // hand-written arrays it replaced could never do.
    expect(ALL_VERDICTS).toHaveLength(9);
    expect(ALL_VERDICTS).toContain("unreachable");
    expect(ALL_VERDICTS).toContain("unsafe_redirect");
  });

  test("every verdict has a reason an operator can act on", () => {
    for (const verdict of ALL_VERDICTS) {
      expect(CUTOVER_VERDICT_REASON[verdict]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  test("only `ok` is clean", () => {
    for (const verdict of ALL_VERDICTS) {
      expect(isCutoverClean(verdict)).toBe(verdict === "ok");
    }
  });

  test("`no_rule`'s reason is true at BOTH layers that produce it", () => {
    // It used to read "this URL will answer 404 after cutover, and its ranking
    // is lost" — a prediction the database resolver can make and an HTTP probe
    // cannot. Found by running the probe against a real built server: a legacy
    // URL answering 200 with no redirect gets this same verdict, and telling an
    // operator that a page they can open will answer 404 is the
    // confidently-wrong message this repo keeps recording.
    expect(CUTOVER_VERDICT_REASON.no_rule).not.toContain("will answer 404");
    expect(CUTOVER_VERDICT_REASON.no_rule).toContain("no redirect matches");
  });
});
