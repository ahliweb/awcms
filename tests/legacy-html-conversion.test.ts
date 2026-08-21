/**
 * Legacy CKEditor HTML -> Portable Text (Issue #599).
 *
 * ## What is at risk
 *
 * 23,906 articles nobody will read individually. So the property that matters
 * is not "does it convert a paragraph" — it is **what happens to the things it
 * cannot convert**. A sanitizer that silently swallows a `<script>` produces a
 * clean-looking import and an unnoticed hole; a converter that rejects produces
 * a report an operator has to answer.
 *
 * Pinned here:
 *
 * 1. Executable markup is REJECTED, never stripped-and-accepted.
 * 2. `<img>` is rejected with its `src`, so managed-media enforcement cannot be
 *    bypassed by an import that predates it.
 * 3. Formatting survives — headings, lists, quotes, links, emphasis — because a
 *    converter that is safe and lossy loses the marks #624 just finished making
 *    reach a reader.
 * 4. It never throws. An importer walking 23,906 rows needs a report per
 *    article, not a stack trace on one of them.
 *
 * Pure — no database, no DOM.
 */
import { describe, expect, test } from "bun:test";

import {
  convertLegacyHtmlToPortableText,
  formatConversionRejection
} from "../src/modules/blog-content/domain/legacy-html-conversion";
import { validatePortableTextDocument } from "../src/modules/blog-content/domain/portable-text-validation";

function textOf(document: unknown): string {
  return JSON.stringify(document);
}

describe("what it refuses", () => {
  test("a script tag makes the article unconvertible", () => {
    const result = convertLegacyHtmlToPortableText(
      "<p>Before</p><script>steal()</script><p>After</p>"
    );

    expect(result.ok).toBe(false);
    expect(result.rejections.map((entry) => entry.reason)).toEqual([
      "executable_markup"
    ]);
    // The surrounding prose is still converted — the operator gets to see what
    // the article WOULD be, which is what makes the report actionable.
    expect(textOf(result.document)).toContain("Before");
    expect(textOf(result.document)).toContain("After");
    // But never the script's own text.
    expect(textOf(result.document)).not.toContain("steal");
  });

  test("iframe, object, embed and form are all refused", () => {
    for (const tag of ["iframe", "object", "embed", "form"]) {
      const result = convertLegacyHtmlToPortableText(`<${tag}></${tag}>`);

      expect(result.ok).toBe(false);
      expect(result.rejections[0]?.found).toBe(tag);
    }
  });

  test("an inline event handler is refused even on an allowed tag", () => {
    // `<p onclick=…>` is not a paragraph with a decoration. It is script.
    const result = convertLegacyHtmlToPortableText(
      '<p onclick="steal()">Text</p>'
    );

    expect(result.ok).toBe(false);
    expect(result.rejections[0]?.reason).toBe("event_handler");
    expect(result.rejections[0]?.found).toBe("p[onclick]");
  });

  test("a javascript: link is refused rather than unwrapped", () => {
    const result = convertLegacyHtmlToPortableText(
      '<p><a href="javascript:steal()">click</a></p>'
    );

    expect(result.ok).toBe(false);
    expect(result.rejections[0]?.reason).toBe("unsafe_href");
    // Dropping it silently would also drop the evidence that the legacy body
    // contained one.
    expect(textOf(result.document)).not.toContain("javascript:");
  });

  test("an image is refused WITH its src, so it can be resolved first", () => {
    const result = convertLegacyHtmlToPortableText(
      '<p>Photo</p><img src="https://legacy.example/foto.jpg" alt="x">'
    );

    expect(result.ok).toBe(false);

    const rejection = result.rejections[0];
    expect(rejection?.reason).toBe("unmanaged_image");
    expect(rejection?.detail).toBe("https://legacy.example/foto.jpg");

    // Not because an image is dangerous — because keeping a raw `src` would
    // smuggle unmanaged media past the enforcement `media_library` applies.
    expect(formatConversionRejection(rejection!)).toContain("media library");
  });

  test("a rejection message never echoes the payload back", () => {
    const result = convertLegacyHtmlToPortableText(
      '<p onclick="alert(document.cookie)">x</p>'
    );

    const line = formatConversionRejection(result.rejections[0]!);

    expect(line).not.toContain("document.cookie");
  });
});

describe("what it keeps", () => {
  test("headings, paragraphs and a blockquote map to styles", () => {
    const result = convertLegacyHtmlToPortableText(
      "<h2>Judul</h2><p>Isi</p><blockquote>Kutipan</blockquote>"
    );

    expect(result.ok).toBe(true);
    expect(
      result.document.map((node) => (node as { style: string }).style)
    ).toEqual(["h2", "normal", "blockquote"]);
  });

  test("emphasis becomes marks, not lost formatting", () => {
    const result = convertLegacyHtmlToPortableText(
      "<p>Menteri <b>menegaskan</b> dan <i>menambahkan</i></p>"
    );

    expect(result.ok).toBe(true);

    const spans = (
      result.document[0] as { children: { text: string; marks: string[] }[] }
    ).children;

    // `<b>`/`<i>` are CKEditor's spelling of the same two decorators. Mapping
    // them is the difference between an import that preserves emphasis and one
    // that flattens 23,906 articles to plain prose.
    expect(spans.find((span) => span.text === "menegaskan")?.marks).toEqual([
      "strong"
    ]);
    expect(spans.find((span) => span.text === "menambahkan")?.marks).toEqual([
      "em"
    ]);
  });

  test("a list becomes list items, not one run-on paragraph", () => {
    const result = convertLegacyHtmlToPortableText(
      "<ul><li>Satu</li><li>Dua</li></ul>"
    );

    expect(result.ok).toBe(true);
    expect(
      result.document.map((node) => (node as { listItem?: string }).listItem)
    ).toEqual(["bullet", "bullet"]);
  });

  test("an ordered list keeps its kind", () => {
    const result = convertLegacyHtmlToPortableText(
      "<ol><li>Satu</li><li>Dua</li></ol>"
    );

    expect(
      result.document.map((node) => (node as { listItem?: string }).listItem)
    ).toEqual(["number", "number"]);
  });

  test("a safe link becomes an annotation the renderer can emit", () => {
    const result = convertLegacyHtmlToPortableText(
      '<p>Lihat <a href="https://example.org/a">sumber</a></p>'
    );

    expect(result.ok).toBe(true);

    const block = result.document[0] as {
      markDefs: { _type: string; href: string; _key: string }[];
      children: { text: string; marks: string[] }[];
    };

    expect(block.markDefs[0]?.href).toBe("https://example.org/a");
    expect(
      block.children.find((span) => span.text === "sumber")?.marks
    ).toEqual([block.markDefs[0]!._key]);
  });

  test("a styling wrapper is unwrapped rather than rejected", () => {
    // CKEditor emits these by the thousand. Rejecting them would fail almost
    // every article for no safety gain.
    const result = convertLegacyHtmlToPortableText(
      '<p><span style="color:red"><font face="Arial">Teks</font></span></p>'
    );

    expect(result.ok).toBe(true);
    expect(textOf(result.document)).toContain("Teks");
  });

  test("entities are decoded, and an unknown one is left visible", () => {
    const result = convertLegacyHtmlToPortableText(
      "<p>A&nbsp;B &amp; C &#8212; D &weird; E</p>"
    );

    const text = (
      result.document[0] as { children: { text: string }[] }
    ).children
      .map((span) => span.text)
      .join("");

    expect(text).toContain("A B");
    expect(text).toContain("& C");
    expect(text).toContain("—");
    // Guessed wrong is worse than left literal: a proofreader can see this.
    expect(text).toContain("&weird;");
  });

  test("the plain text mirrors the converted body, for content_text", () => {
    const result = convertLegacyHtmlToPortableText(
      "<h2>Judul</h2><p>Isi <b>tebal</b></p>"
    );

    expect(result.plainText).toBe("Judul\n\nIsi tebal");
  });
});

describe("it survives whatever the archive holds", () => {
  test("empty, non-string and whitespace input convert to an empty body", () => {
    for (const input of ["", "   ", null, undefined, 42, {}]) {
      const result = convertLegacyHtmlToPortableText(input);

      expect(result.ok).toBe(true);
      expect(result.document).toEqual([]);
    }
  });

  test("unbalanced and malformed markup never throws", () => {
    const nasty = [
      "<p>unclosed",
      "</p></div></p>",
      "<p><b>mixed</i></p>",
      "<<>><p>x</p>",
      "<p attr=unquoted>x</p>",
      "a < b and c > d"
    ];

    for (const html of nasty) {
      expect(() => convertLegacyHtmlToPortableText(html)).not.toThrow();
    }
  });

  test("a converted body passes the write-time validator", () => {
    // The end-to-end property: whatever this produces must be storable. A
    // converter whose output the validator rejects would fail at row 1 of
    // 23,906, and only in the importer.
    const result = convertLegacyHtmlToPortableText(
      '<h2>Judul</h2><p>Isi <b>tebal</b>, <a href="https://example.org">tautan</a></p><ul><li>Satu</li></ul>'
    );

    expect(result.ok).toBe(true);
    expect(validatePortableTextDocument(result.document).valid).toBe(true);
  });

  test("keys are position-derived, so a re-run produces the same document", () => {
    // No clock and no randomness — an import that crashes at article 14,002 is
    // resumed, not restarted, and the rows already written must match.
    const html = "<p>Satu</p><p>Dua</p>";

    expect(convertLegacyHtmlToPortableText(html).document).toEqual(
      convertLegacyHtmlToPortableText(html).document
    );
  });
});
