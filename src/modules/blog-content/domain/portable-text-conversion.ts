import type { ContentBlock } from "./content-block-rendering";
import type {
  PortableTextBlock,
  PortableTextDocument,
  PortableTextSpan
} from "./portable-text";

/**
 * Conversion between the retired `ContentBlock[]` vocabulary and Portable Text
 * (ADR-0100, Issue #588), plus the plain-text derivation that feeds search.
 *
 * ## Why BOTH directions exist, and when the reverse one dies
 *
 * Forward (`contentBlocksToPortableText`) runs once per row in the backfill,
 * and again whenever a legacy payload arrives. That much is obvious.
 *
 * The reverse (`portableTextToContentBlocks`) exists for one reason with a
 * stated expiry: **`ahliweb/awcms-astro` reads `contentJson.blocks`**
 * (`src/lib/content-blocks.ts`, `renderContentBlocks`) and it is a separate
 * repository on a separate deploy cadence. Worse, its guard returns `""` for a
 * non-array — so if this repo simply stopped writing `blocks`, that site would
 * render **every article as an empty page and its build would stay green**.
 * Nothing would fail; the articles would just be blank.
 *
 * So `content_json.blocks` keeps being written, as a DERIVED PROJECTION of the
 * Portable Text body. This is not dual-write in the sense of two sources of
 * truth: nothing in this repo READS `blocks` any more, and a change to it is
 * discarded on the next save. It is an output format, like the rendered HTML.
 *
 * It is deleted when `awcms-astro` reads `bodyPortableText` instead. That is a
 * PR in the other repo, tracked on Issue #588, and it cannot be done from here.
 *
 * ## What the reverse conversion loses, and why that is acceptable
 *
 * `ContentBlock` has no marks. So bold, italic, code and links flatten to their
 * plain text on the way back. The projection is therefore LOSSY BY
 * CONSTRUCTION, and that is fine precisely because it is only a projection —
 * the Portable Text column keeps the marks, and the moment the sibling repo
 * reads it the formatting appears. What must never happen is the reverse being
 * treated as a round trip; `portable_text -> blocks -> portable_text` does not
 * return what it started with, and no code should assume it does.
 *
 * Pure module: no database, no config, no I/O.
 */

/**
 * Deterministic keys.
 *
 * `Math.random()` and `Date.now()` are both unavailable in the workflow
 * sandbox and undesirable here anyway: a converter that produces different
 * output for identical input makes the backfill non-idempotent, so re-running
 * it after a partial failure would rewrite every row with fresh keys and defeat
 * any diff a reviewer wanted to take. Position-derived keys are stable.
 */
function nodeKey(index: number): string {
  return `b${index}`;
}

function spanKey(blockIndex: number, spanIndex: number): string {
  return `b${blockIndex}s${spanIndex}`;
}

function plainSpan(text: string, key: string): PortableTextSpan {
  return { _type: "span", _key: key, text, marks: [] };
}

/**
 * `ContentBlock[]` -> Portable Text.
 *
 * A `list` block becomes SEVERAL Portable Text blocks — one per item, each
 * carrying `listItem` and `level: 1`. That is how Portable Text models lists,
 * and collapsing them back into one node would produce a shape no standard
 * renderer understands.
 */
export function contentBlocksToPortableText(
  blocks: readonly ContentBlock[]
): PortableTextDocument {
  const out: PortableTextDocument = [];

  for (const block of blocks) {
    const index = out.length;

    switch (block.type) {
      case "paragraph":
        out.push({
          _type: "block",
          _key: nodeKey(index),
          style: "normal",
          children: [plainSpan(block.text, spanKey(index, 0))],
          markDefs: []
        });
        break;

      case "heading":
        out.push({
          _type: "block",
          _key: nodeKey(index),
          style: `h${block.level}` as PortableTextBlock["style"],
          children: [plainSpan(block.text, spanKey(index, 0))],
          markDefs: []
        });
        break;

      case "quote":
        out.push({
          _type: "block",
          _key: nodeKey(index),
          style: "blockquote",
          children: [plainSpan(block.text, spanKey(index, 0))],
          markDefs: []
        });
        break;

      case "list": {
        const listItem = block.ordered ? "number" : "bullet";
        for (const item of block.items) {
          const itemIndex = out.length;
          out.push({
            _type: "block",
            _key: nodeKey(itemIndex),
            style: "normal",
            listItem,
            level: 1,
            children: [plainSpan(item, spanKey(itemIndex, 0))],
            markDefs: []
          });
        }
        break;
      }

      case "gallery":
        // Payload carried across verbatim — the shared renderer consumes the
        // same record on both sides of this conversion.
        out.push({
          _type: "gallery",
          _key: nodeKey(index),
          items: block.items
        });
        break;

      case "video_news": {
        const { type: _ignored, ...payload } = block;
        void _ignored;
        out.push({
          _type: "videoNews",
          _key: nodeKey(index),
          ...payload
        });
        break;
      }
    }
  }

  return out;
}

/** The plain text of one block, marks discarded. */
function blockPlainText(block: PortableTextBlock): string {
  return block.children.map((span) => span.text).join("");
}

/**
 * Portable Text -> `ContentBlock[]`, the compatibility projection.
 *
 * LOSSY on purpose (see the header). Consecutive list items of the same kind
 * are re-collapsed into a single `list` block, because that is the only shape
 * the old vocabulary can express and leaving them as separate paragraphs would
 * render a bulleted list as loose prose on the sibling site.
 */
export function portableTextToContentBlocks(
  document: PortableTextDocument
): ContentBlock[] {
  const out: ContentBlock[] = [];

  for (const node of document) {
    if (node._type === "gallery") {
      out.push({ type: "gallery", items: node.items });
      continue;
    }

    if (node._type === "videoNews") {
      const { _type: _ignoredType, _key: _ignoredKey, ...payload } = node;
      void _ignoredType;
      void _ignoredKey;
      out.push({ type: "video_news", ...payload });
      continue;
    }

    const text = blockPlainText(node);

    if (node.listItem) {
      const ordered = node.listItem === "number";
      const previous = out[out.length - 1];

      // Merge into the run being built, but only when the KIND matches — a
      // bulleted list directly followed by a numbered one is two lists, and
      // merging them would silently renumber the second.
      if (
        previous &&
        previous.type === "list" &&
        Boolean(previous.ordered) === ordered
      ) {
        previous.items.push(text);
      } else {
        out.push({ type: "list", ordered, items: [text] });
      }
      continue;
    }

    if (node.style === "blockquote") {
      out.push({ type: "quote", text });
      continue;
    }

    if (node.style !== "normal") {
      const level = Number(node.style.slice(1));
      out.push({
        type: "heading",
        level: level as 1 | 2 | 3 | 4 | 5 | 6,
        text
      });
      continue;
    }

    out.push({ type: "paragraph", text });
  }

  return out;
}

/**
 * The searchable plain text of a whole body.
 *
 * This is what `content_text` becomes: SERVER-DERIVED rather than
 * client-supplied. Today `contentText` is a required request field validated
 * independently of `contentJson`, with no check that the two agree — so a
 * caller can send a body about one subject and search text about another, and
 * the search index believes the search text. Deriving it closes that gap by
 * construction rather than by adding a consistency check nobody can enforce
 * across every writer.
 *
 * Gallery captions and video titles are included: they are real words on the
 * page, and an article whose only mention of a subject is a photo caption
 * should still be findable. `videoId` and `provider` are excluded — they are
 * identifiers, and indexing them would let a search for a bare id surface
 * every article embedding that clip.
 */
export function portableTextToPlainText(
  document: PortableTextDocument
): string {
  const parts: string[] = [];

  for (const node of document) {
    if (node._type === "block") {
      const text = blockPlainText(node);
      if (text.trim().length > 0) {
        parts.push(text);
      }
      continue;
    }

    if (node._type === "gallery") {
      for (const item of node.items) {
        if (item.caption && item.caption.trim().length > 0) {
          parts.push(item.caption);
        }
      }
      continue;
    }

    for (const value of [node.title, node.caption, node.sourceLabel]) {
      if (value && value.trim().length > 0) {
        parts.push(value);
      }
    }
  }

  return parts.join("\n\n");
}

/**
 * Reads a legacy `content_json` envelope and returns its `blocks`, or `null`
 * when there is nothing convertible.
 *
 * `content_json` is NOT body-only: `awcms-astro` stores a structured sidecar
 * under `content_json.awcmsAstro` (procedure steps, costs, legal basis, FAQ).
 * The backfill must therefore read `blocks` and leave every other key alone —
 * replacing the whole envelope would delete that sidecar for every article on
 * the sibling site, and nothing in this repo would notice.
 */
export function readLegacyBlocks(contentJson: unknown): ContentBlock[] | null {
  if (
    typeof contentJson !== "object" ||
    contentJson === null ||
    Array.isArray(contentJson)
  ) {
    return null;
  }

  const blocks = (contentJson as Record<string, unknown>).blocks;
  return Array.isArray(blocks) ? (blocks as ContentBlock[]) : null;
}

/**
 * Writes the compatibility projection back into an existing envelope,
 * preserving every other key — including `awcmsAstro`.
 */
export function withProjectedBlocks(
  contentJson: unknown,
  document: PortableTextDocument
): Record<string, unknown> {
  const envelope =
    typeof contentJson === "object" &&
    contentJson !== null &&
    !Array.isArray(contentJson)
      ? { ...(contentJson as Record<string, unknown>) }
      : {};

  envelope.blocks = portableTextToContentBlocks(document);
  return envelope;
}
