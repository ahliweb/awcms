import { beforeEach, describe, expect, test } from "bun:test";

import type {
  PortableTextBlock,
  PortableTextDocument
} from "../src/modules/blog-content/domain/portable-text";
import { validatePortableTextDocument } from "../src/modules/blog-content/domain/portable-text-validation";
import {
  blockToEditableHtml,
  buildBlockFromEditable,
  describeOpaqueNode,
  editableHtmlToSpans,
  isOpaqueEditorNode,
  nextEditorKey,
  resetEditorKeysForTests,
  toEditorRows
} from "../src/lib/ui/portable-text-editor";

beforeEach(() => {
  resetEditorKeysForTests();
});

const MARKED_BLOCK: PortableTextBlock = {
  _type: "block",
  _key: "b0",
  style: "normal",
  children: [
    { _type: "span", _key: "b0s0", text: "Plain ", marks: [] },
    { _type: "span", _key: "b0s1", text: "bold", marks: ["strong"] },
    { _type: "span", _key: "b0s2", text: " and ", marks: [] },
    { _type: "span", _key: "b0s3", text: "linked", marks: ["k1"] }
  ],
  markDefs: [{ _type: "link", _key: "k1", href: "https://example.test/a" }]
};

describe("block <-> editable HTML", () => {
  test("renders marks as the four tags the editor owns", () => {
    const html = blockToEditableHtml(MARKED_BLOCK);
    expect(html).toBe(
      'Plain <strong>bold</strong> and <a data-mark="k1">linked</a>'
    );
  });

  test("the href never reaches the editable DOM", () => {
    // It stays in markDefs, so a stray click cannot navigate and the editor
    // never has to trust an href it read back out of its own markup.
    expect(blockToEditableHtml(MARKED_BLOCK)).not.toContain("href");
    expect(blockToEditableHtml(MARKED_BLOCK)).not.toContain("example.test");
  });

  test("round-trips a marked block without losing spans or marks", () => {
    const html = blockToEditableHtml(MARKED_BLOCK);
    const rebuilt = buildBlockFromEditable(
      "b0",
      html,
      "normal",
      undefined,
      MARKED_BLOCK.markDefs
    );

    expect(rebuilt.children.map((c) => c.text)).toEqual([
      "Plain ",
      "bold",
      " and ",
      "linked"
    ]);
    expect(rebuilt.children.map((c) => c.marks)).toEqual([
      [],
      ["strong"],
      [],
      ["k1"]
    ]);
    expect(rebuilt.markDefs).toEqual(MARKED_BLOCK.markDefs);
  });

  test("a rebuilt block still validates", () => {
    const rebuilt = buildBlockFromEditable(
      "b0",
      blockToEditableHtml(MARKED_BLOCK),
      "normal",
      undefined,
      MARKED_BLOCK.markDefs
    );
    const result = validatePortableTextDocument([rebuilt]);
    if (!result.valid) {
      throw new Error(JSON.stringify(result.errors, null, 2));
    }
    expect(result.valid).toBe(true);
  });

  test("escapes author text so typed markup is text, not markup", () => {
    const block: PortableTextBlock = {
      _type: "block",
      _key: "b0",
      style: "normal",
      children: [
        { _type: "span", _key: "s0", text: "<img src=x onerror=1>", marks: [] }
      ],
      markDefs: []
    };
    const html = blockToEditableHtml(block);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");

    // ...and it survives the round trip as the literal characters.
    const rebuilt = buildBlockFromEditable("b0", html, "normal", undefined, []);
    expect(rebuilt.children[0]?.text).toBe("<img src=x onerror=1>");
  });
});

describe("editableHtmlToSpans is a whitelist, not a sanitizer", () => {
  test("an unknown tag contributes no markup but keeps its text", () => {
    const spans = editableHtmlToSpans(
      '<script>alert(1)</script><span style="x">kept</span>'
    );
    const text = spans.map((s) => s.text).join("");
    expect(text).toBe("alert(1)kept");
    expect(spans.every((s) => s.marks.length === 0)).toBe(true);
  });

  test("an <a> without data-mark opens no mark", () => {
    // A link the editor did not create carries no annotation, so it cannot
    // produce a mark naming a markDef that does not exist.
    const spans = editableHtmlToSpans('<a href="https://evil.test">text</a>');
    expect(spans).toEqual([{ text: "text", marks: [] }]);
  });

  test("browser variants b and i map onto the canonical marks", () => {
    const spans = editableHtmlToSpans("<b>x</b><i>y</i>");
    expect(spans).toEqual([
      { text: "x", marks: ["strong"] },
      { text: "y", marks: ["em"] }
    ]);
  });

  test("adjacent identical-mark runs are merged", () => {
    // A browser splits text nodes freely as an author types; un-merged spans
    // would make every save produce a different document for identical content.
    const spans = editableHtmlToSpans(
      "<strong>a</strong><strong>b</strong>plain"
    );
    expect(spans).toEqual([
      { text: "ab", marks: ["strong"] },
      { text: "plain", marks: [] }
    ]);
  });

  test("a stray closing tag does not lose the author's text", () => {
    const spans = editableHtmlToSpans("before</strong>after");
    expect(spans.map((s) => s.text).join("")).toBe("beforeafter");
  });

  test("an unterminated tag keeps the remainder as text", () => {
    const spans = editableHtmlToSpans("kept <strong");
    expect(spans.map((s) => s.text).join("")).toContain("kept");
  });

  test("<br> inside a block becomes a space — a block IS the paragraph", () => {
    expect(
      editableHtmlToSpans("a<br>b")
        .map((s) => s.text)
        .join("")
    ).toBe("a b");
    expect(
      editableHtmlToSpans("a<br/>b")
        .map((s) => s.text)
        .join("")
    ).toBe("a b");
  });

  test("entities decode back to their characters", () => {
    expect(editableHtmlToSpans("&amp;&lt;&gt;&quot;")[0]?.text).toBe('&<>"');
  });
});

describe("orphaned annotations are pruned with their marks", () => {
  test("a markDef nothing references is dropped", () => {
    // The validator refuses a mark naming no declared annotation, so the two
    // must be pruned together or a save fails on content the editor produced.
    const rebuilt = buildBlockFromEditable(
      "b0",
      "plain text",
      "normal",
      undefined,
      [{ _type: "link", _key: "gone", href: "https://example.test" }]
    );
    expect(rebuilt.markDefs).toEqual([]);
    expect(validatePortableTextDocument([rebuilt]).valid).toBe(true);
  });

  test("a referenced markDef is kept", () => {
    const rebuilt = buildBlockFromEditable(
      "b0",
      '<a data-mark="k1">x</a>',
      "normal",
      undefined,
      [{ _type: "link", _key: "k1", href: "https://example.test" }]
    );
    expect(rebuilt.markDefs).toHaveLength(1);
    expect(validatePortableTextDocument([rebuilt]).valid).toBe(true);
  });
});

describe("list blocks", () => {
  test("a list item carries listItem and level, and validates", () => {
    const block = buildBlockFromEditable("b0", "item", "normal", "bullet", []);
    expect(block.listItem).toBe("bullet");
    expect(block.level).toBe(1);
    expect(validatePortableTextDocument([block]).valid).toBe(true);
  });

  test("a non-list block carries neither — level without listItem is refused", () => {
    const block = buildBlockFromEditable("b0", "para", "normal", undefined, []);
    expect(block.listItem).toBeUndefined();
    expect(block.level).toBeUndefined();
    expect(validatePortableTextDocument([block]).valid).toBe(true);
  });
});

describe("opaque nodes — the actual bug #589 exists for", () => {
  const DOC: PortableTextDocument = [
    MARKED_BLOCK,
    {
      _type: "gallery",
      _key: "g1",
      items: [{ mediaType: "image", url: "https://cdn.test/a.jpg" }]
    },
    {
      _type: "videoNews",
      _key: "v1",
      provider: "youtube",
      videoId: "abcdefghijk",
      title: "A clip"
    }
  ];

  test("galleries and videos are recognised as opaque", () => {
    expect(isOpaqueEditorNode(DOC[1]!)).toBe(true);
    expect(isOpaqueEditorNode(DOC[2]!)).toBe(true);
    expect(isOpaqueEditorNode(DOC[0]!)).toBe(false);
  });

  test("rows preserve order and index so a save reassembles exactly", () => {
    const rows = toEditorRows(DOC);
    expect(rows.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(rows.map((r) => r.opaque)).toEqual([false, true, true]);
  });

  test("an opaque node is carried through byte-identical", () => {
    // The previous editor REFUSED to open such a post because saving would have
    // destroyed these. Carrying them untouched is what makes it editable.
    const rows = toEditorRows(DOC);
    expect(rows[1]!.node).toBe(DOC[1]!);
    expect(rows[2]!.node).toBe(DOC[2]!);
  });

  test("each gets a label an author can recognise", () => {
    expect(describeOpaqueNode(DOC[1]!)).toBe("Image gallery — 1 item");
    expect(describeOpaqueNode(DOC[2]!)).toBe("Video — A clip");
  });
});

describe("keys are deterministic", () => {
  test("two runs from a fresh counter produce identical keys", () => {
    const first = [nextEditorKey("b"), nextEditorKey("b")];
    resetEditorKeysForTests();
    const second = [nextEditorKey("b"), nextEditorKey("b")];
    expect(first).toEqual(second);
  });
});
