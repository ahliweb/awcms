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

  test("an undecidable target is NOT reported as broken", () => {
    // `targetLive: null` means the destination is an archive or an external
    // URL this job cannot check. Calling that a failure would train an
    // operator to ignore the report, which costs more than the check is worth.
    expect(classifyCutoverOutcome({ ...base, targetLive: null })).toBe("ok");
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

  test("every verdict has a reason an operator can act on", () => {
    const verdicts: CutoverVerdict[] = [
      "ok",
      "no_rule",
      "ineligible",
      "chain_too_long",
      "loop",
      "target_missing"
    ];
    for (const verdict of verdicts) {
      expect(CUTOVER_VERDICT_REASON[verdict]?.length ?? 0).toBeGreaterThan(20);
    }
  });

  test("only `ok` is clean", () => {
    const verdicts: CutoverVerdict[] = [
      "no_rule",
      "ineligible",
      "chain_too_long",
      "loop",
      "target_missing"
    ];
    for (const verdict of verdicts) {
      expect(isCutoverClean(verdict)).toBe(false);
    }
  });
});
