import { describe, expect, test } from "bun:test";

import {
  applyInternalTagLinksToHtml,
  createInternalTagLinkEngine,
  type InternalTagLinkCandidate,
  type InternalTagLinkingPolicy
} from "../src/modules/blog-content/domain/internal-tag-linking";

const BASE_POLICY: InternalTagLinkingPolicy = {
  enabled: true,
  maxPerPost: 10,
  maxPerTag: 1,
  minTermLength: 3,
  linkFirstOccurrenceOnly: true,
  excludeHeadings: true,
  caseInsensitive: false
};

function candidate(
  tagId: string,
  name: string,
  url: string
): InternalTagLinkCandidate {
  return { tagId, name, url };
}

describe("applyInternalTagLinksToHtml (Issue #641)", () => {
  test("exact match links a matching term to its tag archive URL", async () => {
    const html = "<p>This article is about Jakarta today.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      BASE_POLICY
    );

    expect(result.html).toContain(
      '<a href="/news/tag/jakarta" class="auto-internal-link" data-tag-id="t1" rel="tag">Jakarta</a>'
    );
    expect(result.matches).toEqual([
      {
        tagId: "t1",
        tagName: "Jakarta",
        url: "/news/tag/jakarta",
        matchedText: "Jakarta"
      }
    ]);
  });

  test("exact match (case-sensitive default) does NOT link a different-case occurrence", async () => {
    const html = "<p>jakarta is a city.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      BASE_POLICY
    );

    expect(result.html).toBe(html);
    expect(result.matches).toHaveLength(0);
  });

  test("case-insensitive matching links regardless of case, preserving the original matched casing", async () => {
    const html = "<p>jakarta is a city. JAKARTA is busy.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      {
        ...BASE_POLICY,
        caseInsensitive: true,
        linkFirstOccurrenceOnly: false,
        maxPerTag: 5
      }
    );

    expect(result.html).toContain(">jakarta</a>");
    expect(result.html).toContain(">JAKARTA</a>");
    expect(result.matches).toHaveLength(2);
  });

  test("Indonesian word boundary: a tag is not linked as a substring of a larger word sharing the same root", async () => {
    const html = "<p>Saya suka memakan makanan enak. Ayo makan bersama.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "makan", "/news/tag/makan")],
      BASE_POLICY
    );

    // "memakan" and "makanan" must NOT be linked -- only the standalone
    // occurrence of "makan" qualifies.
    expect(result.html).not.toContain(">memakan</a>");
    expect(result.html).not.toContain(">makanan</a>");
    expect(result.html).toContain(
      '<a href="/news/tag/makan" class="auto-internal-link" data-tag-id="t1" rel="tag">makan</a>'
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matchedText).toBe("makan");
  });

  test("Indonesian word boundary: a hyphenated compound still matches its own boundary-delimited occurrence", async () => {
    const html = "<p>Kata-kata itu penting. Kata itu indah.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Kata", "/news/tag/kata")],
      { ...BASE_POLICY, linkFirstOccurrenceOnly: true }
    );

    // Only the first eligible occurrence is linked (maxPerTag effectively 1).
    expect(result.matches).toHaveLength(1);
  });

  test("duplicate prevention: maxPerTag caps links to the same tag within one post", async () => {
    const html =
      "<p>Berita pertama. Berita kedua. Berita ketiga. Berita keempat.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Berita", "/news/tag/berita")],
      { ...BASE_POLICY, linkFirstOccurrenceOnly: false, maxPerTag: 2 }
    );

    expect(result.matches).toHaveLength(2);
  });

  test("linkFirstOccurrenceOnly caps a tag to exactly one link even when maxPerTag is higher", async () => {
    const html = "<p>Berita pertama. Berita kedua. Berita ketiga.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Berita", "/news/tag/berita")],
      { ...BASE_POLICY, linkFirstOccurrenceOnly: true, maxPerTag: 5 }
    );

    expect(result.matches).toHaveLength(1);
  });

  test("maxPerPost caps the total number of links across all tags", async () => {
    const html = "<p>Politik dan Ekonomi dan Politik dan Ekonomi.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [
        candidate("t1", "Politik", "/news/tag/politik"),
        candidate("t2", "Ekonomi", "/news/tag/ekonomi")
      ],
      {
        ...BASE_POLICY,
        linkFirstOccurrenceOnly: false,
        maxPerTag: 5,
        maxPerPost: 1
      }
    );

    expect(result.matches).toHaveLength(1);
  });

  test("longest match wins when one tag name is a prefix of another", async () => {
    const html = "<p>Warga Jakarta Selatan dan warga Jakarta lainnya.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [
        candidate("t1", "Jakarta", "/news/tag/jakarta"),
        candidate("t2", "Jakarta Selatan", "/news/tag/jakarta-selatan")
      ],
      { ...BASE_POLICY, linkFirstOccurrenceOnly: false }
    );

    expect(result.html).toContain(
      '<a href="/news/tag/jakarta-selatan" class="auto-internal-link" data-tag-id="t2" rel="tag">Jakarta Selatan</a>'
    );
    expect(result.html).toContain(
      '<a href="/news/tag/jakarta" class="auto-internal-link" data-tag-id="t1" rel="tag">Jakarta</a>'
    );
    expect(result.matches).toHaveLength(2);
  });

  test("existing anchor exclusion: never inserts a link inside an existing <a> element", async () => {
    const html =
      '<p>Read about Jakarta <a href="/other">Jakarta history</a> here.</p>';
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      { ...BASE_POLICY, linkFirstOccurrenceOnly: false, maxPerTag: 5 }
    );

    // The pre-existing anchor's text is byte-for-byte untouched.
    expect(result.html).toContain('<a href="/other">Jakarta history</a>');
    // Only the OUTSIDE occurrence was linked.
    expect(result.matches).toHaveLength(1);
  });

  test("code/pre block exclusion: never links inside <code> or <pre>", async () => {
    const html = "<p>Jakarta <code>Jakarta</code> <pre>Jakarta</pre> end.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      { ...BASE_POLICY, linkFirstOccurrenceOnly: false, maxPerTag: 5 }
    );

    expect(result.html).toContain("<code>Jakarta</code>");
    expect(result.html).toContain("<pre>Jakarta</pre>");
    expect(result.matches).toHaveLength(1);
  });

  test("script/style exclusion: never links inside <script> or <style> (defense in depth)", async () => {
    const html =
      "<p>Jakarta</p><script>var Jakarta = 1;</script><style>.Jakarta{}</style>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      BASE_POLICY
    );

    expect(result.html).toContain("<script>var Jakarta = 1;</script>");
    expect(result.html).toContain("<style>.Jakarta{}</style>");
    expect(result.matches).toHaveLength(1);
  });

  test("figcaption exclusion: never links inside a figure caption", async () => {
    const html =
      '<figure><img src="/x.jpg"><figcaption>Jakarta skyline</figcaption></figure><p>Jakarta news.</p>';
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      BASE_POLICY
    );

    expect(result.html).toContain("<figcaption>Jakarta skyline</figcaption>");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.matchedText).toBe("Jakarta");
  });

  test("embed exclusion: never links inside an iframe/object/embed/video/audio element", async () => {
    const html = '<iframe title="Jakarta"></iframe><p>Jakarta news.</p>';
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      BASE_POLICY
    );

    expect(result.html).toContain('<iframe title="Jakarta"></iframe>');
    expect(result.matches).toHaveLength(1);
  });

  test("heading exclusion: excludeHeadings=true skips h1-h6 text", async () => {
    const html = "<h1>Jakarta Today</h1><p>Jakarta news.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      { ...BASE_POLICY, excludeHeadings: true }
    );

    expect(result.html).toContain("<h1>Jakarta Today</h1>");
    expect(result.matches).toHaveLength(1);
  });

  test("heading exclusion can be disabled via policy", async () => {
    const html = "<h1>Jakarta Today</h1>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      { ...BASE_POLICY, excludeHeadings: false }
    );

    expect(result.matches).toHaveLength(1);
  });

  test("minTermLength filters out short tag names entirely", async () => {
    const html = "<p>AI is everywhere.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "AI", "/news/tag/ai")],
      { ...BASE_POLICY, minTermLength: 3 }
    );

    expect(result.matches).toHaveLength(0);
    expect(result.html).toBe(html);
  });

  test("disabled policy is a byte-for-byte no-op (no HTMLRewriter pass at all)", async () => {
    const html = "<p>Jakarta news.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      { ...BASE_POLICY, enabled: false }
    );

    expect(result.html).toBe(html);
    expect(result.matches).toHaveLength(0);
  });

  test("XSS safety: a tag name containing HTML-special characters matches the escaped text safely, without corrupting markup", async () => {
    const html = "<p>Sesi Q&amp;A akan diadakan.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Q&A", "/news/tag/q-and-a")],
      BASE_POLICY
    );

    expect(result.html).toBe(
      '<p>Sesi <a href="/news/tag/q-and-a" class="auto-internal-link" data-tag-id="t1" rel="tag">Q&amp;A</a> akan diadakan.</p>'
    );
    expect(result.matches).toHaveLength(1);
  });

  test("XSS safety: a malicious tag name can never inject markup -- href/attributes are always escaped", async () => {
    const html = '<p>Jakarta says "hello".</p>';
    const maliciousTagId = '"><script>alert(1)</script>';
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate(maliciousTagId, "Jakarta", "/news/tag/jakarta")],
      BASE_POLICY
    );

    expect(result.html).not.toContain("<script>alert(1)</script>");
    expect(result.html).toContain('data-tag-id="&quot;&gt;&lt;script&gt;');
  });

  test("XSS safety: a malicious tag NAME (the realistic vector, not just tagId) is only ever matched in its escaped form and never introduces a real <script> tag", async () => {
    // Tag names, unlike slugs/ids, have no character restriction at write
    // time -- this is the actual attacker-controlled field the issue's
    // security note is about. The article HTML the matcher receives is
    // already-escaped (the whitelist renderer's own output), so a mention
    // of this name in prose would already read as escaped entities.
    const maliciousName = '"><script>alert(1)</script>';
    const html =
      "<p>Warning: &quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; was mentioned.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", maliciousName, "/news/tag/malicious")],
      BASE_POLICY
    );

    expect(result.html).not.toContain("<script>alert(1)</script>");
    expect(result.html).toContain(
      '<a href="/news/tag/malicious" class="auto-internal-link" data-tag-id="t1" rel="tag">&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</a>'
    );
    expect(result.matches).toHaveLength(1);
  });

  test("XSS safety: content containing a raw <script>-like text node is never re-interpreted as markup by the matcher itself", async () => {
    // `renderContentJsonToHtml` never emits this shape in practice (its own
    // whitelist rejects raw HTML), but this module must not assume that --
    // it operates on whatever HTML string it is given, always via a real
    // parser, never a naive string replace.
    const html =
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; mentions Jakarta.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      BASE_POLICY
    );

    expect(result.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(result.html).toContain(
      '<a href="/news/tag/jakarta" class="auto-internal-link" data-tag-id="t1" rel="tag">Jakarta</a>'
    );
  });

  test("no candidates and no matching terms both produce a byte-for-byte unchanged result", async () => {
    const html = "<p>Nothing to see here.</p>";
    const resultNoCandidates = await applyInternalTagLinksToHtml(
      html,
      [],
      BASE_POLICY
    );
    expect(resultNoCandidates.html).toBe(html);

    const resultNoMatch = await applyInternalTagLinksToHtml(
      html,
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      BASE_POLICY
    );
    expect(resultNoMatch.html).toBe(html);
  });

  test("duplicate candidate names collapse to a single deterministic match target", async () => {
    const html = "<p>Jakarta news.</p>";
    const result = await applyInternalTagLinksToHtml(
      html,
      [
        candidate("t1", "Jakarta", "/news/tag/jakarta-1"),
        candidate("t2", "Jakarta", "/news/tag/jakarta-2")
      ],
      BASE_POLICY
    );

    expect(result.matches).toHaveLength(1);
    // Deterministic: t1 sorts first (same escaped length, alphabetical tie
    // broken by original candidate order via Array#sort stability on name).
    expect(result.matches[0]?.tagId).toBe("t1");
  });
});

describe("createInternalTagLinkEngine", () => {
  test("returns null when policy is disabled", () => {
    const engine = createInternalTagLinkEngine(
      [candidate("t1", "Jakarta", "/news/tag/jakarta")],
      { ...BASE_POLICY, enabled: false }
    );
    expect(engine).toBeNull();
  });

  test("returns null when there are no eligible candidates", () => {
    const engine = createInternalTagLinkEngine(
      [candidate("t1", "AI", "/news/tag/ai")],
      { ...BASE_POLICY, minTermLength: 5 }
    );
    expect(engine).toBeNull();
  });
});
