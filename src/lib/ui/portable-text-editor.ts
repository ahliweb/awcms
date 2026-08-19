import type {
  PortableTextAnnotation,
  PortableTextBlock,
  PortableTextDocument,
  PortableTextNode,
  PortableTextSpan
} from "../../modules/blog-content/domain/portable-text";

/**
 * The ONE conversion between what an author edits in a `contenteditable` block
 * and the Portable Text this repo stores (ADR-0100, Issue #589).
 *
 * Pure — no DOM, no `fetch`, no database — so the `.astro` frontmatter
 * (prefilling an edit form, server side) and the page's hoisted `<script>`
 * (building the payload, browser side) share ONE definition instead of two that
 * drift. Same reasoning `blog-body-editor.ts` gives, and the same reason this
 * lives beside `admin-form-client.ts`: a hoisted `<script>` with no imports is
 * INLINED by Astro, and this app's CSP is `default-src 'self'` with no
 * `'unsafe-inline'`.
 *
 * ## Why parsing arbitrary pasted HTML is not a problem this module has
 *
 * A rich-text editor's hardest security question is normally "what do I do with
 * the markup a browser produced when somebody pasted from Word". This editor
 * does not have that question, because **paste is intercepted and inserted as
 * PLAIN TEXT** (see the page script). The editable region therefore only ever
 * contains tags this module itself emitted, and `editableHtmlToSpans` only has
 * to understand its own four.
 *
 * That is a product decision as much as a security one: pasted Word markup is a
 * newsroom problem in its own right, and the copy that survives is the copy the
 * author meant.
 *
 * Anything unrecognised is still dropped rather than trusted — the parser is a
 * whitelist, not a sanitizer — because "only our tags can be here" is an
 * invariant of the page, and a module that assumes a caller's invariant without
 * enforcing it is one refactor away from being wrong.
 *
 * ## Why the editor is BLOCK-based rather than one document-wide editable
 *
 * Portable Text is an array of blocks, and Sanity's own editor is block-based
 * for the same reason: a single document-wide `contenteditable` has to solve
 * cross-block selection, block splitting and undo across the whole array — the
 * problems that make a general editing framework large. One editable element
 * per block maps 1:1 onto the data, keeps every hard case local, and is why
 * this needs no editing framework at all.
 */

/** Tags this editor emits and understands. Nothing else survives a round trip. */
const DECORATOR_TAG_BY_MARK: Readonly<Record<string, string>> = {
  strong: "strong",
  em: "em",
  code: "code"
};

const MARK_BY_DECORATOR_TAG: Readonly<Record<string, string>> = {
  STRONG: "strong",
  B: "strong",
  EM: "em",
  I: "em",
  CODE: "code"
};

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * One block's spans -> the `innerHTML` of its editable element.
 *
 * Annotation marks become `<a data-mark="KEY">`, not `<a href>`. The href stays
 * in `markDefs` and never reaches the editable DOM, so a stray click inside the
 * editor cannot navigate and — more importantly — the editor never has to trust
 * an href it read back out of its own markup.
 */
export function blockToEditableHtml(block: PortableTextBlock): string {
  if (!Array.isArray(block.children)) {
    return "";
  }

  return block.children
    .map((span) => {
      const text = escapeHtmlText(span.text ?? "");
      const marks = Array.isArray(span.marks) ? span.marks : [];

      let html = text;
      let annotationKey: string | null = null;

      for (const mark of marks) {
        const tag = DECORATOR_TAG_BY_MARK[mark];
        if (tag) {
          html = `<${tag}>${html}</${tag}>`;
        } else {
          annotationKey = mark;
        }
      }

      if (annotationKey) {
        html = `<a data-mark="${escapeHtmlText(annotationKey)}">${html}</a>`;
      }

      return html;
    })
    .join("");
}

type ParsedSpan = { text: string; marks: string[] };

/**
 * The editable element's `innerHTML` -> spans.
 *
 * A hand-written tokenizer rather than `DOMParser`, for two reasons: it runs
 * identically in `bun test` (there is no DOM there) and it is a WHITELIST by
 * construction — an unrecognised tag contributes nothing rather than being
 * stripped by a sanitizer whose rules have to be kept in step with an attacker.
 *
 * Adjacent spans carrying identical marks are merged, because a browser splits
 * text nodes freely as an author types and un-merged spans would make every
 * save produce a different document for identical content.
 */
export function editableHtmlToSpans(html: string): ParsedSpan[] {
  const spans: ParsedSpan[] = [];
  const openMarks: string[] = [];
  let index = 0;

  const push = (text: string): void => {
    if (text.length === 0) {
      return;
    }

    const marks = [...openMarks];
    const previous = spans[spans.length - 1];

    if (
      previous &&
      previous.marks.length === marks.length &&
      previous.marks.every((mark, i) => mark === marks[i])
    ) {
      previous.text += text;
      return;
    }

    spans.push({ text, marks });
  };

  while (index < html.length) {
    const nextTag = html.indexOf("<", index);

    if (nextTag === -1) {
      push(decodeEntities(html.slice(index)));
      break;
    }

    if (nextTag > index) {
      push(decodeEntities(html.slice(index, nextTag)));
    }

    const tagEnd = html.indexOf(">", nextTag);
    if (tagEnd === -1) {
      // Unterminated tag: treat the remainder as text rather than dropping it.
      push(decodeEntities(html.slice(nextTag)));
      break;
    }

    const raw = html.slice(nextTag + 1, tagEnd).trim();
    index = tagEnd + 1;

    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim().toUpperCase();
      const mark =
        name === "A"
          ? openMarks[openMarks.length - 1]
          : MARK_BY_DECORATOR_TAG[name];
      // Pop the matching mark. Closing something never opened is ignored — a
      // browser can emit that mid-edit, and refusing would lose the author's text.
      const at = mark ? openMarks.lastIndexOf(mark) : -1;
      if (at >= 0) {
        openMarks.splice(at, 1);
      }
      continue;
    }

    if (raw.endsWith("/")) {
      // `<br/>` and friends: a line break inside one block is a space, because
      // a block IS the paragraph. Anything else self-closing contributes nothing.
      if (raw.replace("/", "").trim().toUpperCase().startsWith("BR")) {
        push(" ");
      }
      continue;
    }

    const name = raw.split(/\s/)[0]!.toUpperCase();

    if (name === "BR") {
      push(" ");
      continue;
    }

    if (name === "A") {
      const keyMatch = raw.match(/data-mark="([^"]*)"/i);
      if (keyMatch?.[1]) {
        openMarks.push(decodeEntities(keyMatch[1]));
      }
      continue;
    }

    const mark = MARK_BY_DECORATOR_TAG[name];
    if (mark) {
      openMarks.push(mark);
    }
    // Any other tag opens nothing: its text still survives, its markup does not.
  }

  return spans;
}

let keyCounter = 0;

/**
 * Keys are position-and-counter derived rather than random.
 *
 * `crypto.randomUUID()` would work in the browser but makes two saves of an
 * untouched document differ, which turns every diff and every revision-worthy
 * comparison into noise.
 */
export function nextEditorKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}${keyCounter}`;
}

export function resetEditorKeysForTests(): void {
  keyCounter = 0;
}

/** Rebuilds one block from the editable element's HTML plus its controls. */
export function buildBlockFromEditable(
  key: string,
  html: string,
  style: PortableTextBlock["style"],
  listItem: PortableTextBlock["listItem"],
  markDefs: PortableTextAnnotation[]
): PortableTextBlock {
  const parsed = editableHtmlToSpans(html);

  const children: PortableTextSpan[] = parsed.map((span, index) => ({
    _type: "span",
    _key: `${key}s${index}`,
    text: span.text,
    marks: span.marks
  }));

  // A block with no children at all is refused by nothing and renders as an
  // empty paragraph; giving it one empty span keeps the shape uniform for every
  // consumer that maps over `children`.
  if (children.length === 0) {
    children.push({ _type: "span", _key: `${key}s0`, text: "", marks: [] });
  }

  // Only the annotations still referenced survive. An orphaned markDef is a
  // dangling href kept alive by nothing an author can see, and the validator
  // refuses a mark naming no declared annotation — so the two must be pruned
  // together or a save fails on content the editor itself produced.
  const usedKeys = new Set(children.flatMap((child) => child.marks));
  const keptDefs = markDefs.filter((def) => usedKeys.has(def._key));

  const block: PortableTextBlock = {
    _type: "block",
    _key: key,
    style,
    children,
    markDefs: keptDefs
  };

  if (listItem) {
    block.listItem = listItem;
    block.level = 1;
  }

  return block;
}

/**
 * True when a node is one the editor renders as an opaque card rather than as
 * editable text.
 *
 * This is the whole reason #589 exists: the previous editor REFUSED to open any
 * post containing one of these, because it could only write paragraphs and
 * saving would have destroyed them. Carrying them through untouched is what
 * makes such a post editable at all.
 */
export function isOpaqueEditorNode(node: PortableTextNode): boolean {
  return node._type === "gallery" || node._type === "videoNews";
}

/** A short, human-readable label for an opaque node, for its card in the editor. */
export function describeOpaqueNode(node: PortableTextNode): string {
  if (node._type === "gallery") {
    const count = Array.isArray(node.items) ? node.items.length : 0;
    return `Image gallery — ${count} item${count === 1 ? "" : "s"}`;
  }

  if (node._type === "videoNews") {
    return node.title
      ? `Video — ${node.title}`
      : `Video — ${node.provider}/${node.videoId}`;
  }

  return "Content block";
}

/**
 * Splits a document into the ordered list the editor renders.
 *
 * Every node keeps its index so a save can reassemble the array in order with
 * the opaque nodes exactly as they arrived — byte-identical, never re-derived.
 */
export function toEditorRows(
  document: PortableTextDocument
): { index: number; node: PortableTextNode; opaque: boolean }[] {
  return document.map((node, index) => ({
    index,
    node,
    opaque: isOpaqueEditorNode(node)
  }));
}
