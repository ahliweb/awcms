import { describe, expect, test } from "bun:test";

import type { ContentBlock } from "../src/modules/blog-content/domain/content-block-rendering";
import {
  isAllowedPortableTextHref,
  PORTABLE_TEXT_ANNOTATION_TYPES,
  PORTABLE_TEXT_BLOCK_STYLES,
  PORTABLE_TEXT_DECORATORS,
  PORTABLE_TEXT_NODE_TYPES,
  type PortableTextDocument
} from "../src/modules/blog-content/domain/portable-text";
import { validatePortableTextDocument } from "../src/modules/blog-content/domain/portable-text-validation";
import {
  contentBlocksToPortableText,
  portableTextToContentBlocks,
  portableTextToPlainText,
  readLegacyBlocks,
  withProjectedBlocks
} from "../src/modules/blog-content/domain/portable-text-conversion";
import { renderPortableTextToHtml } from "../src/modules/blog-content/domain/portable-text-rendering";

/** A body exercising every node type, style, decorator and the link annotation. */
const RICH: PortableTextDocument = [
  {
    _type: "block",
    _key: "b0",
    style: "h2",
    children: [{ _type: "span", _key: "b0s0", text: "Headline", marks: [] }],
    markDefs: []
  },
  {
    _type: "block",
    _key: "b1",
    style: "normal",
    children: [
      { _type: "span", _key: "b1s0", text: "Plain ", marks: [] },
      { _type: "span", _key: "b1s1", text: "bold", marks: ["strong"] },
      { _type: "span", _key: "b1s2", text: " and ", marks: [] },
      { _type: "span", _key: "b1s3", text: "a link", marks: ["k1"] }
    ],
    markDefs: [{ _type: "link", _key: "k1", href: "https://example.test/a" }]
  },
  {
    _type: "block",
    _key: "b2",
    style: "normal",
    listItem: "bullet",
    level: 1,
    children: [{ _type: "span", _key: "b2s0", text: "First", marks: [] }],
    markDefs: []
  },
  {
    _type: "block",
    _key: "b3",
    style: "normal",
    listItem: "bullet",
    level: 1,
    children: [{ _type: "span", _key: "b3s0", text: "Second", marks: [] }],
    markDefs: []
  },
  {
    _type: "gallery",
    _key: "b4",
    items: [
      {
        mediaType: "image",
        url: "https://cdn.test/a.jpg",
        caption: "A caption"
      }
    ]
  },
  {
    _type: "videoNews",
    _key: "b5",
    provider: "youtube",
    videoId: "abcdefghijk",
    title: "A video title"
  }
];

describe("vocabulary constants stay welded to their unions", () => {
  test("every constant is non-empty and has no duplicates", () => {
    for (const list of [
      PORTABLE_TEXT_NODE_TYPES,
      PORTABLE_TEXT_BLOCK_STYLES,
      PORTABLE_TEXT_DECORATORS,
      PORTABLE_TEXT_ANNOTATION_TYPES
    ]) {
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  test("underline is deliberately absent", () => {
    // An underlined span that is not a link is a usability defect, and offering
    // it guarantees it gets used for emphasis.
    expect(PORTABLE_TEXT_DECORATORS).not.toContain("underline");
  });
});

describe("link href allow-list", () => {
  test("accepts the schemes a newsroom actually needs", () => {
    expect(isAllowedPortableTextHref("https://example.test/a")).toBe(true);
    expect(isAllowedPortableTextHref("http://example.test")).toBe(true);
    expect(isAllowedPortableTextHref("mailto:redaksi@example.test")).toBe(true);
    expect(isAllowedPortableTextHref("tel:+6281234567890")).toBe(true);
    expect(isAllowedPortableTextHref("/internal/page")).toBe(true);
  });

  test("refuses script-bearing and data schemes, including obfuscations", () => {
    expect(isAllowedPortableTextHref("javascript:alert(1)")).toBe(false);
    expect(isAllowedPortableTextHref("JaVaScRiPt:alert(1)")).toBe(false);
    // Parsed, not pattern-matched — a regex over the raw string is exactly how
    // an embedded newline gets through.
    expect(isAllowedPortableTextHref("java\nscript:alert(1)")).toBe(false);
    expect(isAllowedPortableTextHref("data:text/html;base64,PHN2Zz4=")).toBe(
      false
    );
    expect(isAllowedPortableTextHref("vbscript:msgbox")).toBe(false);
    expect(isAllowedPortableTextHref("")).toBe(false);
    expect(isAllowedPortableTextHref("   ")).toBe(false);
  });
});

describe("validatePortableTextDocument", () => {
  test("accepts the rich document", () => {
    const result = validatePortableTextDocument(RICH);
    if (!result.valid) {
      throw new Error(JSON.stringify(result.errors, null, 2));
    }
    expect(result.valid).toBe(true);
  });

  test("refuses an unknown _type — the closed vocabulary is the point", () => {
    const result = validatePortableTextDocument([
      { _type: "iframeEmbed", _key: "b0", src: "https://evil.test" }
    ]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors[0]?.field).toBe("bodyPortableText[0]._type");
  });

  test("refuses a javascript: link annotation", () => {
    const result = validatePortableTextDocument([
      {
        _type: "block",
        _key: "b0",
        style: "normal",
        children: [{ _type: "span", _key: "s0", text: "x", marks: ["k"] }],
        markDefs: [{ _type: "link", _key: "k", href: "javascript:alert(1)" }]
      }
    ]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.some((e) => e.field.endsWith(".href"))).toBe(true);
  });

  test("refuses a mark naming no decorator and no declared annotation", () => {
    // A dangling mark renders as nothing, so the emphasis or link the author
    // applied silently disappears.
    const result = validatePortableTextDocument([
      {
        _type: "block",
        _key: "b0",
        style: "normal",
        children: [{ _type: "span", _key: "s0", text: "x", marks: ["ghost"] }],
        markDefs: []
      }
    ]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors[0]?.message).toContain("Unknown mark");
  });

  test("refuses script markup pasted into a paragraph", () => {
    const result = validatePortableTextDocument([
      {
        _type: "block",
        _key: "b0",
        style: "normal",
        children: [
          {
            _type: "span",
            _key: "s0",
            text: "<script>alert(1)</script>",
            marks: []
          }
        ],
        markDefs: []
      }
    ]);
    expect(result.valid).toBe(false);
  });

  test("refuses a gallery item carrying both url and mediaObjectId, and one carrying neither", () => {
    const both = validatePortableTextDocument([
      {
        _type: "gallery",
        _key: "b0",
        items: [
          {
            mediaType: "image",
            url: "https://a.test/x.jpg",
            mediaObjectId: "m1"
          }
        ]
      }
    ]);
    const neither = validatePortableTextDocument([
      { _type: "gallery", _key: "b0", items: [{ mediaType: "image" }] }
    ]);
    expect(both.valid).toBe(false);
    expect(neither.valid).toBe(false);
  });

  test("refuses a level without a listItem", () => {
    const result = validatePortableTextDocument([
      {
        _type: "block",
        _key: "b0",
        style: "normal",
        level: 2,
        children: [{ _type: "span", _key: "s0", text: "x", marks: [] }],
        markDefs: []
      }
    ]);
    expect(result.valid).toBe(false);
  });

  test("refuses a non-array body", () => {
    expect(validatePortableTextDocument({ blocks: [] }).valid).toBe(false);
    expect(validatePortableTextDocument(null).valid).toBe(false);
  });

  test("does not rewrite what it validates", () => {
    // A validator that also normalises makes a round-trip untestable, because
    // the caller cannot tell what was stored from what it sent.
    const input = structuredClone(RICH);
    const result = validatePortableTextDocument(input);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.value).toEqual(RICH);
  });
});

describe("conversion from the retired vocabulary", () => {
  const LEGACY: ContentBlock[] = [
    { type: "heading", level: 2, text: "Headline" },
    { type: "paragraph", text: "Body text" },
    { type: "quote", text: "A quote" },
    { type: "list", ordered: false, items: ["First", "Second"] },
    { type: "list", ordered: true, items: ["One", "Two"] },
    {
      type: "gallery",
      items: [{ mediaType: "image", url: "https://a.test/x.jpg" }]
    },
    { type: "video_news", provider: "youtube", videoId: "abcdefghijk" }
  ];

  test("every legacy block converts to a valid Portable Text document", () => {
    const converted = contentBlocksToPortableText(LEGACY);
    const result = validatePortableTextDocument(converted);
    if (!result.valid) {
      throw new Error(JSON.stringify(result.errors, null, 2));
    }
    expect(result.valid).toBe(true);
  });

  test("a list becomes one block per item, as Portable Text models lists", () => {
    const converted = contentBlocksToPortableText([
      { type: "list", ordered: false, items: ["a", "b", "c"] }
    ]);
    expect(converted).toHaveLength(3);
    expect(converted.every((n) => n._type === "block")).toBe(true);
  });

  test("legacy -> portable text -> legacy round-trips for markless content", () => {
    // Markless is the whole legacy corpus: the old format had no marks to lose.
    const back = portableTextToContentBlocks(
      contentBlocksToPortableText(LEGACY)
    );
    expect(back).toEqual(LEGACY);
  });

  test("conversion is deterministic — the backfill must be re-runnable", () => {
    expect(contentBlocksToPortableText(LEGACY)).toEqual(
      contentBlocksToPortableText(LEGACY)
    );
  });

  test("the reverse projection is LOSSY, and the test says so rather than hiding it", () => {
    // Marks flatten to plain text. This is acceptable only because the
    // projection is an output for a sibling repo, never a source of truth.
    const back = portableTextToContentBlocks(RICH);
    const paragraph = back.find((b) => b.type === "paragraph");
    expect(paragraph).toEqual({
      type: "paragraph",
      text: "Plain bold and a link"
    });
  });

  test("adjacent lists of different kinds are not merged", () => {
    const back = portableTextToContentBlocks(
      contentBlocksToPortableText([
        { type: "list", ordered: false, items: ["a"] },
        { type: "list", ordered: true, items: ["b"] }
      ])
    );
    expect(back).toHaveLength(2);
    expect(back[0]).toEqual({ type: "list", ordered: false, items: ["a"] });
    expect(back[1]).toEqual({ type: "list", ordered: true, items: ["b"] });
  });
});

describe("the awcms-astro envelope is preserved", () => {
  test("withProjectedBlocks replaces blocks and keeps every other key", () => {
    const envelope = {
      blocks: [{ type: "paragraph", text: "old" }],
      awcmsAstro: { schemaVersion: 1, urutan: 3, kategori: "layanan" }
    };

    const next = withProjectedBlocks(envelope, RICH);

    // The sidecar the sibling repo depends on survives untouched.
    expect(next.awcmsAstro).toEqual(envelope.awcmsAstro);
    expect(Array.isArray(next.blocks)).toBe(true);
    expect(next.blocks).not.toEqual(envelope.blocks);
  });

  test("a projected body is never an empty array for a non-empty document", () => {
    // awcms-astro's renderer returns "" for a non-array and renders nothing for
    // an empty one — either way a blank article with a green build.
    const next = withProjectedBlocks({}, RICH);
    expect((next.blocks as unknown[]).length).toBeGreaterThan(0);
  });

  test("readLegacyBlocks tolerates every shape a real envelope takes", () => {
    expect(readLegacyBlocks({ blocks: [] })).toEqual([]);
    expect(readLegacyBlocks({ awcmsAstro: {} })).toBeNull();
    expect(readLegacyBlocks(null)).toBeNull();
    expect(readLegacyBlocks([])).toBeNull();
    expect(readLegacyBlocks("nonsense")).toBeNull();
  });
});

describe("plain-text derivation for the search index", () => {
  test("includes prose, gallery captions and video titles", () => {
    const text = portableTextToPlainText(RICH);
    expect(text).toContain("Headline");
    expect(text).toContain("Plain bold and a link");
    expect(text).toContain("A caption");
    expect(text).toContain("A video title");
  });

  test("excludes identifiers — a search for a bare video id must not match every embed", () => {
    expect(portableTextToPlainText(RICH)).not.toContain("abcdefghijk");
    expect(portableTextToPlainText(RICH)).not.toContain("youtube");
  });
});

describe("rendering", () => {
  test("emits marks as tags from a closed mapping", () => {
    const html = renderPortableTextToHtml(RICH);
    expect(html).toContain("<h2>Headline</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain(
      '<a href="https://example.test/a" rel="noopener noreferrer">a link</a>'
    );
  });

  test("wraps consecutive list items in ONE list", () => {
    const html = renderPortableTextToHtml(RICH);
    expect(html).toContain("<ul><li>First</li><li>Second</li></ul>");
  });

  test("escapes author text — every character leaves through escapeHtml", () => {
    const html = renderPortableTextToHtml([
      {
        _type: "block",
        _key: "b0",
        style: "normal",
        children: [
          {
            _type: "span",
            _key: "s0",
            text: "<img src=x onerror=1>",
            marks: []
          }
        ],
        markDefs: []
      }
    ]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  test("escapes an href that reached the database before validation tightened", () => {
    // Write-time validation governs what is stored; the renderer governs what a
    // body already in the database can do. Both, not either.
    const html = renderPortableTextToHtml([
      {
        _type: "block",
        _key: "b0",
        style: "normal",
        children: [{ _type: "span", _key: "s0", text: "x", marks: ["k"] }],
        markDefs: [
          { _type: "link", _key: "k", href: '" onmouseover="alert(1)' }
        ]
      }
    ]);
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain("&quot;");
  });

  test("an unknown mark renders as plain text, never as a tag", () => {
    const html = renderPortableTextToHtml([
      {
        _type: "block",
        _key: "b0",
        style: "normal",
        children: [
          { _type: "span", _key: "s0", text: "hi", marks: ["script"] }
        ],
        markDefs: []
      }
    ]);
    expect(html).toBe("<p>hi</p>");
  });

  test("degrades rather than throwing on a malformed document", () => {
    expect(renderPortableTextToHtml(null)).toBe("");
    expect(renderPortableTextToHtml("nonsense")).toBe("");
    expect(renderPortableTextToHtml([null, 42, { _type: "unknown" }])).toBe("");
  });
});
