/**
 * The editor preview's in-place editing overlay (Issue #592, second half of the
 * scope).
 *
 * ## What is at risk here, and what is already covered elsewhere
 *
 * `tests/blog-preview-route.test.ts` guards the preview itself — one renderer,
 * no draft leak, read-only. This file guards the three things the overlay adds:
 *
 * 1. **That the public page did not change.** The renderer learned to stamp
 *    block indexes; a flag that leaked into the default would put an
 *    editing-only attribute on every article a reader loads.
 * 2. **That an index means what the overlay thinks it means.** The overlay
 *    splices an edited block back into the document ARRAY by index. If the
 *    stamp counted rendered elements instead of array positions, a body
 *    containing a gallery would save the edit onto the WRONG block — silently,
 *    and only for articles with media in them.
 * 3. **That the embedded state cannot break out of its `<script>`.** The
 *    canonical body is author-supplied text going into an HTML data block.
 *
 * Pure — no database, no DOM. The overlay module is imported here precisely to
 * prove it does not try to mount without one.
 */
import { describe, expect, test } from "bun:test";

import {
  editableBlockAt,
  isEmptyBlock,
  parsePreviewState,
  replaceBlockAt
} from "../src/lib/ui/blog-preview-overlay";
import {
  PREVIEW_OVERLAY_SCRIPT_SRC,
  PREVIEW_STATE_ELEMENT_ID,
  renderPreviewOverlayHtml
} from "../src/modules/blog-content/domain/preview-overlay";
import {
  EDITABLE_BLOCK_INDEX_ATTRIBUTE,
  renderPortableTextToHtml
} from "../src/modules/blog-content/domain/portable-text-rendering";
import { renderBlogBodyHtml } from "../src/modules/blog-content/domain/blog-body-rendering";
import { pinnedBunVersion } from "../scripts/build-preview-overlay";
import { PUBLIC_ASSET_AUDIENCE } from "../scripts/client-asset-budget";
import type {
  PortableTextBlock,
  PortableTextDocument
} from "../src/modules/blog-content/domain/portable-text";

function block(
  key: string,
  text: string,
  overrides: Partial<PortableTextBlock> = {}
): PortableTextBlock {
  return {
    _type: "block",
    _key: key,
    style: "normal",
    children: [{ _type: "span", _key: `${key}s0`, text, marks: [] }],
    markDefs: [],
    ...overrides
  };
}

const GALLERY = {
  _type: "gallery" as const,
  _key: "g1",
  items: []
};

describe("the public page is untouched", () => {
  test("no stamp without the option, and none with it turned off", () => {
    const body: PortableTextDocument = [
      block("b1", "One"),
      block("b2", "Two", { style: "h2" })
    ];

    const bare = renderPortableTextToHtml(body);

    expect(bare).toBe("<p>One</p>\n<h2>Two</h2>");
    // Byte-identical, not merely "does not contain the attribute": the option
    // threads through every branch of this renderer, and an accidental space
    // before `>` is still a change to what every reader downloads.
    expect(renderPortableTextToHtml(body, undefined, {})).toBe(bare);
    expect(
      renderPortableTextToHtml(body, undefined, { editableBlockIndexes: false })
    ).toBe(bare);
  });

  test("the fallback projection is never stamped, even when asked", () => {
    // Asking is not a mistake — the route passes one flag for the whole body.
    // The projection is not the array the overlay splices into, so a click on a
    // stamped fallback block could not be saved, and the preview would be
    // promising something it cannot do.
    const html = renderBlogBodyHtml(
      {
        bodyPortableText: [],
        contentJson: { blocks: [{ type: "paragraph", text: "Legacy" }] }
      },
      undefined,
      { editableBlockIndexes: true }
    );

    expect(html).toContain("Legacy");
    expect(html).not.toContain(EDITABLE_BLOCK_INDEX_ATTRIBUTE);
  });
});

describe("a stamped index is a position in the ARRAY", () => {
  test("every prose style carries it", () => {
    const html = renderPortableTextToHtml(
      [
        block("b1", "Para"),
        block("b2", "Head", { style: "h3" }),
        block("b3", "Quote", { style: "blockquote" })
      ],
      undefined,
      { editableBlockIndexes: true }
    );

    expect(html).toContain('<p data-pt-index="0">Para</p>');
    expect(html).toContain('<h3 data-pt-index="1">Head</h3>');
    expect(html).toContain('<blockquote data-pt-index="2">Quote</blockquote>');
  });

  test("an opaque node CONSUMES an index without carrying one", () => {
    // The failure this catches: a stamp derived from a counter of rendered
    // prose elements would label the paragraph after a gallery `1` while it
    // sits at position 2 in the document — and the overlay would save the edit
    // over the gallery. Only articles with media would be affected, which is
    // the worst kind of "works on my draft".
    const html = renderPortableTextToHtml(
      [block("b1", "Before"), GALLERY, block("b3", "After")],
      undefined,
      { editableBlockIndexes: true }
    );

    expect(html).toContain('<p data-pt-index="0">Before</p>');
    expect(html).toContain('<p data-pt-index="2">After</p>');
    expect(html).not.toContain('data-pt-index="1"');
  });

  test("each list ITEM is stamped, because each one is its own block", () => {
    const html = renderPortableTextToHtml(
      [
        block("b1", "First", { listItem: "bullet", level: 1 }),
        block("b2", "Second", { listItem: "bullet", level: 1 })
      ],
      undefined,
      { editableBlockIndexes: true }
    );

    // Still ONE list — the wrapping behaviour that keeps a page from becoming
    // a run of single-item lists must survive the stamping.
    expect(html).toBe(
      '<ul><li data-pt-index="0">First</li><li data-pt-index="1">Second</li></ul>'
    );
  });
});

describe("the embedded state", () => {
  test("carries the post id and the document", () => {
    const html = renderPreviewOverlayHtml("post-1", [block("b1", "Hello")]);

    expect(html).toContain(`id="${PREVIEW_STATE_ELEMENT_ID}"`);
    expect(html).toContain('"postId":"post-1"');
    expect(html).toContain('"Hello"');
  });

  test("the overlay is loaded EXTERNALLY, never as inline JavaScript", () => {
    const html = renderPreviewOverlayHtml("post-1", []);

    // The CSP is `default-src 'self'` with no `'unsafe-inline'`. An inline
    // module here would be refused by the browser and the overlay would be
    // rendered-but-dead — the exact failure `build:inline-scripts:check`
    // exists for, in a route that gate cannot see.
    expect(html).toContain(
      `<script type="module" src="${PREVIEW_OVERLAY_SCRIPT_SRC}"></script>`
    );
    expect(PREVIEW_OVERLAY_SCRIPT_SRC.startsWith("/")).toBe(true);
  });

  test("a `</script>` in the article body cannot close the data block", () => {
    const html = renderPreviewOverlayHtml("post-1", [
      block("b1", "</script><script>alert(1)</script>")
    ]);

    // The HTML tokenizer looks for `</script` before any JSON parsing begins,
    // so this is a parser question, not a JSON-escaping one.
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script");
    // Exactly the two closing tags this function itself emits.
    expect([...html.matchAll(/<\/script>/g)]).toHaveLength(2);
  });

  test("the asset is declared, and declared `app`", () => {
    // `PUBLIC_ASSET_AUDIENCE` is a gate, not documentation (ADR-0101) — but the
    // AUDIENCE is a judgement it cannot make. Charging an admin-only overlay to
    // the reader budget would overstate the tightest ceiling in the repo by 26%.
    expect(PUBLIC_ASSET_AUDIENCE[PREVIEW_OVERLAY_SCRIPT_SRC.slice(1)]).toBe(
      "app"
    );
  });
});

describe("the overlay's own logic", () => {
  test("state that is not a usable pair is refused", () => {
    expect(parsePreviewState(null)).toBeNull();
    expect(parsePreviewState("")).toBeNull();
    expect(parsePreviewState("not json")).toBeNull();
    expect(parsePreviewState("[]")).toBeNull();
    expect(parsePreviewState('{"postId":"p1"}')).toBeNull();
    expect(parsePreviewState('{"document":[]}')).toBeNull();
    expect(parsePreviewState('{"postId":"","document":[]}')).toBeNull();
    // Refusing means the overlay does not mount and the page stays a plain
    // preview — the same answer as "this row has no canonical body".
    expect(parsePreviewState('{"postId":"p1","document":[]}')).toEqual({
      postId: "p1",
      document: []
    });
  });

  test("only a prose block is editable", () => {
    const body: PortableTextDocument = [block("b1", "Text"), GALLERY];

    expect(editableBlockAt(body, 0)?._key).toBe("b1");
    // A gallery is carried through the editor as an opaque card; there is no
    // sense in which a `contenteditable` over its markup could be read back.
    expect(editableBlockAt(body, 1)).toBeNull();
    expect(editableBlockAt(body, 9)).toBeNull();
    expect(editableBlockAt(body, -1)).toBeNull();
  });

  test("replacing one block leaves every other node BY REFERENCE", () => {
    const untouched = GALLERY;
    const body: PortableTextDocument = [block("b1", "Old"), untouched];
    const next = replaceBlockAt(body, 0, block("b1", "New"));

    expect(next).not.toBe(body);
    expect(body[0]).toEqual(block("b1", "Old"));
    // The gallery is the same object, not a re-derived equal one. An overlay
    // that rebuilt the array could drop a media reference nobody edited, and
    // the symptom is a photo vanishing from an article whose text was fixed.
    expect(next[1]).toBe(untouched);
  });

  test("an out-of-range index changes nothing", () => {
    const body: PortableTextDocument = [block("b1", "Only")];

    expect(replaceBlockAt(body, 5, block("b2", "Lost"))).toBe(body);
    expect(replaceBlockAt(body, -1, block("b2", "Lost"))).toBe(body);
  });

  test("a block emptied to whitespace is recognised as empty", () => {
    // The overlay refuses to save one rather than treating it as a delete:
    // there is no undo on that page, and an accidental select-all-delete would
    // otherwise be indistinguishable from a deliberate removal.
    expect(isEmptyBlock(block("b1", "   "))).toBe(true);
    expect(isEmptyBlock(block("b1", ""))).toBe(true);
    expect(isEmptyBlock(block("b1", "x"))).toBe(false);
  });
});

describe("the committed bundle", () => {
  test("the pin is read from `packageManager`, not written down twice", () => {
    expect(pinnedBunVersion("bun@1.3.14")).toBe("1.3.14");
    expect(pinnedBunVersion("bun@1.3.14 ")).toBe("1.3.14");
    // No `@`, wrong type, or absent: an unreadable pin must not silently
    // become a version that some Bun could equal, because that would turn the
    // strict branch on by accident on an arbitrary machine.
    expect(pinnedBunVersion("bun")).toBe("");
    expect(pinnedBunVersion(undefined)).toBe("");
    expect(pinnedBunVersion(42)).toBe("");
  });

  test("matches its TypeScript source", async () => {
    // `public/js/blog-preview-overlay.js` is generated. The point of generating
    // it — rather than hand-writing it beside `news-share.js` — is that the
    // block <-> Portable Text conversion has ONE definition, and a stale bundle
    // is that guarantee quietly expiring.
    //
    // The assertion carries the gate's own precondition, and is NOT weakened by
    // it. A minified bundle's bytes belong to the bundler as much as to the
    // source, so only a run on the PINNED Bun can tell a stale artefact from a
    // newer minifier. CI installs that Bun in every job, so there the strict
    // branch below is what runs — the same demand this test always made.
    //
    // Off the pin it asserts the other half, which is the half that was broken:
    // the gate must NOT claim staleness it cannot have established, and must
    // not exit non-zero for it. Accepting any output here instead would make
    // the test blind, which is the defect one layer up.
    const pkg = (await Bun.file("package.json").json()) as {
      packageManager?: unknown;
    };
    const pinned = pinnedBunVersion(pkg.packageManager);
    expect(pinned).not.toBe("");

    const { spawnSync } = await import("node:child_process");
    const result = spawnSync("bun", ["run", "build:preview-overlay:check"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const output = result.stdout + result.stderr;

    expect(result.status).toBe(0);

    if (Bun.version === pinned) {
      expect(output).toContain("OK");
      expect(output).not.toContain("UNVERIFIED");
    } else {
      expect(output).toMatch(/OK|UNVERIFIED/);
      expect(output).not.toContain("STALE");
    }
  });
});
