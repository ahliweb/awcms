/**
 * The ONE conversion between the plain text an author types into the admin
 * body `<textarea>` and the `content_json` document the blog API stores.
 *
 * Pure — no DOM, no fetch, no database — so the `.astro` frontmatter (server
 * side, prefilling an edit form) and the page's hoisted `<script>` (browser
 * side, building the payload) share one definition instead of two that drift.
 * Lives beside `admin-form-client.ts` for the same reason that file gives:
 * a hoisted `<script>` with no imports is INLINED by Astro, and this app's CSP
 * is `default-src 'self'` with no `'unsafe-inline'`.
 *
 * ## Why it exists
 *
 * `/admin/blog` and `/admin/blog-pages` shipped create forms that sent
 * `contentJson: {}` and `contentText: ""`, under a legend promising a body
 * editor "which is not part of this screen yet". `validateContentTextField`
 * requires a non-empty `contentText`, so every create from either screen was
 * answered 400 and no article could be authored through the CMS at all — the
 * defect was the missing INPUT, not the validator.
 *
 * Relaxing the validator would have been the worse repair:
 * `content-quality-checklist.ts` has no "body present" rule of its own, so an
 * empty `contentText` accepted at write time reaches `publish` unchallenged
 * and the site serves a headline with nothing under it.
 *
 * ## The block vocabulary is NOT redefined here
 *
 * `content-block-rendering.ts` owns it — six types, with a runtime constant
 * and a mutual-assignability assertion guarding it. This editor writes exactly
 * ONE of them, `paragraph`, and the type import below is what keeps that
 * promise checked by `tsc` rather than by a comment. The import is
 * `import type`, so nothing from that module (or its renderers) reaches the
 * client bundle.
 *
 * Headings, lists, quotes, galleries and video embeds have no authoring
 * surface in this repo yet. A textarea that silently rewrote them as
 * paragraphs would DESTROY them on the first save, so `readParagraphBodyText`
 * refuses — returns `null` — for any document this editor cannot represent,
 * and the screens then offer no body field for that row at all. A control that
 * can only lose content is worse than an absent one.
 */
import type { ContentBlock } from "../../modules/blog-content/domain/content-block-rendering";

/**
 * The single block type this editor writes, narrowed FROM the module's own
 * union rather than restated: renaming or reshaping `paragraph` over there
 * fails the typecheck here instead of silently producing blocks the renderer
 * skips.
 */
export type ParagraphBlock = Extract<ContentBlock, { type: "paragraph" }>;

export type ParagraphBodyDocument = { blocks: ParagraphBlock[] };

/**
 * A blank line separates paragraphs — the one convention a plain `<textarea>`
 * can carry without inventing a markup language the renderer does not read.
 * A single newline stays INSIDE its paragraph, so a wrapped sentence is not
 * torn into two blocks.
 */
const PARAGRAPH_BREAK = /\r?\n[ \t]*\r?\n/;

export function splitBodyTextIntoParagraphs(bodyText: string): string[] {
  return bodyText
    .split(PARAGRAPH_BREAK)
    .map((paragraph) => paragraph.replace(/\r\n/g, "\n").trim())
    .filter((paragraph) => paragraph.length > 0);
}

/** The `contentJson` half of the payload: `{ blocks: [...] }`, the lossy projection kept for consumers of the old vocabulary. Since Issue #624 a reader is served the canonical Portable Text half whenever it holds content — see `blog-body-rendering.ts`. */
export function buildContentJsonFromBodyText(
  bodyText: string
): ParagraphBodyDocument {
  return {
    blocks: splitBodyTextIntoParagraphs(bodyText).map(
      (text): ParagraphBlock => ({ type: "paragraph", text })
    )
  };
}

/**
 * The `contentText` half: the plain-text mirror the search index and
 * `validateContentTextField` read. Empty in, empty out — "the body is empty"
 * is a message the form owns, so this function reports it as `""` rather than
 * throwing or substituting a placeholder.
 */
export function buildContentTextFromBodyText(bodyText: string): string {
  return splitBodyTextIntoParagraphs(bodyText).join("\n\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The reverse trip, for prefilling an edit form: the textarea text for a
 * stored document, or `null` when the document holds anything this editor
 * cannot represent.
 *
 * `null` is a REFUSAL, not an error — the caller renders no body field, so the
 * gallery or video block that caused it survives the save. An empty string is
 * the different, legitimate answer for a document with no blocks (`{}`, which
 * is what a client outside this screen may still write).
 */
export function readParagraphBodyText(contentJson: unknown): string | null {
  if (!isRecord(contentJson)) {
    return null;
  }

  const blocks = contentJson.blocks;

  if (blocks === undefined) {
    return "";
  }

  if (!Array.isArray(blocks)) {
    return null;
  }

  const paragraphs: string[] = [];

  for (const block of blocks) {
    if (
      !isRecord(block) ||
      block.type !== "paragraph" ||
      typeof block.text !== "string"
    ) {
      return null;
    }

    paragraphs.push(block.text);
  }

  return paragraphs.join("\n\n");
}
