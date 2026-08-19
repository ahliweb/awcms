import { escapeHtml } from "../../../lib/html/escape";
import {
  renderGalleryBlockHtml,
  type ResolvedGalleryMediaUrls
} from "../../_shared/rendering/gallery-block-renderer";
import { renderVideoNewsBlockHtml } from "../../_shared/rendering/video-news-block-renderer";
import {
  PORTABLE_TEXT_DECORATORS,
  type PortableTextAnnotation,
  type PortableTextBlock,
  type PortableTextDocument,
  type PortableTextSpan
} from "./portable-text";

/**
 * Portable Text -> safe HTML (ADR-0100, Issue #588).
 *
 * ## The safety property, unchanged from `content-block-rendering.ts`
 *
 * Every character of author-supplied content leaves this module through
 * `escapeHtml`. There is no raw-HTML escape hatch, and adding one would
 * undo the reason the vocabulary is closed. What is new is that spans carry
 * MARKS, so this renderer emits tags the old one could not — `<strong>`,
 * `<em>`, `<code>`, `<a>` — and every one of them is emitted from a CLOSED
 * mapping, never from author-supplied names.
 *
 * The `<a href>` is the only place an author-supplied VALUE becomes an
 * attribute. It is escaped, and the scheme was already refused at write time
 * by `isAllowedPortableTextHref`. Both, not either: write-time validation
 * governs what is stored, and this governs what a body already in the
 * database can do — including one written before a validator was tightened.
 *
 * ## Degrade, never throw
 *
 * A malformed or unknown node renders as nothing, exactly as
 * `renderContentJsonToHtml` does. A corrupt shape must produce "renders less",
 * not a 500 with a stack trace (doc issue #540).
 *
 * Pure module: no database, no I/O.
 */

const DECORATOR_TAGS: Readonly<Record<string, string>> = {
  strong: "strong",
  em: "em",
  code: "code"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Wraps one span's escaped text in its marks.
 *
 * Decorators nest in the order the marks array gives, which keeps the output
 * stable for a given input. An unknown mark is IGNORED rather than rendered —
 * it cannot become a tag name, because tags come only from `DECORATOR_TAGS`
 * and from the annotation branch.
 */
function renderSpan(
  span: PortableTextSpan,
  annotationsByKey: ReadonlyMap<string, PortableTextAnnotation>
): string {
  let html = escapeHtml(span.text);

  if (!Array.isArray(span.marks)) {
    return html;
  }

  const decorators: string[] = [];
  let link: PortableTextAnnotation | undefined;

  for (const mark of span.marks) {
    if (typeof mark !== "string") {
      continue;
    }

    if ((PORTABLE_TEXT_DECORATORS as string[]).includes(mark)) {
      decorators.push(mark);
      continue;
    }

    const annotation = annotationsByKey.get(mark);
    if (annotation) {
      link = annotation;
    }
    // A mark matching neither is dangling. Write-time validation refuses it;
    // a body that predates that validation renders as plain text rather than
    // as a broken tag.
  }

  for (const decorator of decorators) {
    const tag = DECORATOR_TAGS[decorator];
    if (tag) {
      html = `<${tag}>${html}</${tag}>`;
    }
  }

  if (link && link._type === "link" && typeof link.href === "string") {
    // `rel="noopener noreferrer"` unconditionally: the renderer cannot tell an
    // internal link from an external one without knowing the site's own
    // origin, and the attribute is harmless on an internal link while its
    // absence on an external one is a real tabnabbing surface.
    html = `<a href="${escapeHtml(link.href)}" rel="noopener noreferrer">${html}</a>`;
  }

  return html;
}

function renderBlockChildren(
  block: PortableTextBlock,
  annotationsByKey: ReadonlyMap<string, PortableTextAnnotation>
): string {
  if (!Array.isArray(block.children)) {
    return "";
  }

  return block.children
    .filter((span): span is PortableTextSpan => isRecord(span))
    .map((span) => renderSpan(span, annotationsByKey))
    .join("");
}

function annotationMap(
  block: PortableTextBlock
): ReadonlyMap<string, PortableTextAnnotation> {
  const map = new Map<string, PortableTextAnnotation>();

  if (!Array.isArray(block.markDefs)) {
    return map;
  }

  for (const def of block.markDefs) {
    if (isRecord(def) && typeof def._key === "string") {
      map.set(def._key, def as PortableTextAnnotation);
    }
  }

  return map;
}

function renderProseBlock(block: PortableTextBlock): string {
  const inner = renderBlockChildren(block, annotationMap(block));

  if (block.style === "blockquote") {
    return `<blockquote>${inner}</blockquote>`;
  }

  if (block.style && block.style !== "normal") {
    // Tag name comes from the enumerated style, never from the payload.
    const level = Number(String(block.style).slice(1));
    if (Number.isInteger(level) && level >= 1 && level <= 6) {
      return `<h${level}>${inner}</h${level}>`;
    }
    return `<p>${inner}</p>`;
  }

  return `<p>${inner}</p>`;
}

const EMPTY_RESOLVED_MEDIA_URLS: ResolvedGalleryMediaUrls = new Map();

/**
 * Renders a whole Portable Text body.
 *
 * Consecutive list items of the same kind are wrapped in a single `<ul>`/`<ol>`
 * — Portable Text stores each item as its own block, so a renderer that
 * emitted one list per item would produce a page of single-item lists that
 * looks broken to a reader and to a screen reader alike.
 *
 * `resolvedMediaUrls` defaults to empty, matching `renderContentJsonToHtml`:
 * a gallery item referencing an unresolved `mediaObjectId` renders nothing
 * rather than a broken `<img>`.
 */
export function renderPortableTextToHtml(
  document: unknown,
  resolvedMediaUrls: ResolvedGalleryMediaUrls = EMPTY_RESOLVED_MEDIA_URLS
): string {
  if (!Array.isArray(document)) {
    return "";
  }

  const out: string[] = [];
  let openList: { tag: "ul" | "ol"; items: string[] } | null = null;

  const flushList = (): void => {
    if (!openList) {
      return;
    }
    out.push(
      `<${openList.tag}>${openList.items.map((item) => `<li>${item}</li>`).join("")}</${openList.tag}>`
    );
    openList = null;
  };

  for (const node of document as PortableTextDocument) {
    if (!isRecord(node)) {
      continue;
    }

    if (node._type === "block") {
      const block = node as PortableTextBlock;

      if (block.listItem === "bullet" || block.listItem === "number") {
        const tag = block.listItem === "number" ? "ol" : "ul";
        const inner = renderBlockChildren(block, annotationMap(block));

        if (openList && openList.tag === tag) {
          openList.items.push(inner);
        } else {
          flushList();
          openList = { tag, items: [inner] };
        }
        continue;
      }

      flushList();
      out.push(renderProseBlock(block));
      continue;
    }

    flushList();

    if (node._type === "gallery") {
      const html = renderGalleryBlockHtml(node.items, resolvedMediaUrls);
      if (html) {
        out.push(html);
      }
      continue;
    }

    if (node._type === "videoNews") {
      const html = renderVideoNewsBlockHtml(node, resolvedMediaUrls);
      if (html) {
        out.push(html);
      }
    }
  }

  flushList();

  return out.filter(Boolean).join("\n");
}
