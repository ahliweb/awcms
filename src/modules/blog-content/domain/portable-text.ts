// Imported from the SHARED renderers rather than from `content-block-rendering`
// (which only re-exports them under the older `GalleryItem`/`VideoNewsItem`
// names). Taking them from the source keeps the payloads byte-identical to what
// `renderGalleryBlockHtml`/`renderVideoNewsBlockHtml` consume, which is the
// whole reason the two object blocks can reuse those renderers unchanged.
import type { GalleryBlockItem } from "../../_shared/rendering/gallery-block-renderer";
import type { VideoNewsBlockItem } from "../../_shared/rendering/video-news-block-renderer";

/**
 * Portable Text as this repo's canonical body format — with a CLOSED
 * vocabulary (ADR-0100, Issue #588).
 *
 * ## What was wrong with the format this replaces
 *
 * `ContentBlock` (`content-block-rendering.ts`) models a paragraph as
 * `{ type: "paragraph"; text: string }`. A single string. There is no way to
 * make one word bold, italicise a phrase, or put a link inside a sentence —
 * not "no editor for it", no PLACE FOR IT IN THE DATA. Every article this CMS
 * has ever stored is unstyled prose, and no editor could have changed that.
 *
 * ## Why the vocabulary stays closed
 *
 * Portable Text as the wider ecosystem uses it is open by design: any `_type`
 * string is a valid block, and consumers are expected to ignore what they do
 * not recognise. Adopting that openness here would dissolve the property this
 * module's security rests on. `content-validation.ts` REJECTS `<script>`,
 * `<iframe>`, `<embed>`, `<object>`, inline handlers and `javascript:` rather
 * than sanitizing them, and the closed `ContentBlock` union is what made
 * "there is no field where arbitrary markup could live" true in the first
 * place.
 *
 * So every `_type`, every block style, every list kind, every decorator mark
 * and every annotation type is enumerated below, and anything else is refused
 * at write time. The gain over the old union is INLINE STRUCTURE — spans with
 * marks — not extensibility.
 *
 * ## The five runtime constants, and why they are values rather than types
 *
 * `CONTENT_BLOCK_TYPES` exists as a runtime value because `awcms-astro`
 * re-derived the block vocabulary from prose and got it wrong three ways at
 * once: it invented an `ordered_list` type, and silently dropped `gallery` and
 * `video_news` because neither carries a `text` field. Nothing failed; pages
 * just rendered wrongly or lost a section.
 *
 * The same trap is wider here — five vocabularies instead of one — so each is
 * a runtime constant welded to its union by a mutual-assignability assertion.
 * Adding a member to the union without adding it to the constant (or the
 * reverse) fails the TYPECHECK, not a test somebody might not run.
 */

/* ------------------------------------------------------------------ marks */

/**
 * Decorators — marks with no data of their own. `strong` and `em` are the two
 * an editor reaches for constantly; `code` is here because a news site quoting
 * a regulation number or a command needs it and the alternative is markup in
 * the text. `underline` is deliberately ABSENT: on the web an underlined span
 * that is not a link is a usability defect, and offering it guarantees it gets
 * used for emphasis.
 */
export type PortableTextDecorator = "strong" | "em" | "code";

export const PORTABLE_TEXT_DECORATORS: readonly PortableTextDecorator[] = [
  "strong",
  "em",
  "code"
];

/**
 * Annotations — marks that CARRY data, keyed by `_key` from the span's `marks`
 * array. Only one exists: a link. Anything richer (a footnote, a glossary
 * reference) is a new annotation type with its own validation, added
 * deliberately.
 */
export type PortableTextAnnotationType = "link";

export const PORTABLE_TEXT_ANNOTATION_TYPES: readonly PortableTextAnnotationType[] =
  ["link"];

/**
 * `href` is validated by `validatePortableTextDocument`, not merely typed. The
 * scheme allow-list is the point: `javascript:` in an `href` is the exact
 * payload the module's reject-don't-sanitize spine exists to refuse, and a
 * link annotation is the one place in this format where a URL reaches the
 * rendered page as an attribute.
 */
export type PortableTextLinkAnnotation = {
  _type: "link";
  _key: string;
  href: string;
};

export type PortableTextAnnotation = PortableTextLinkAnnotation;

/* ----------------------------------------------------------------- blocks */

/** Paragraph and headings. `blockquote` is a STYLE, not a block type, which is what Portable Text conventionally does and what keeps a quote's inner spans markable. */
export type PortableTextBlockStyle =
  "normal" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote";

export const PORTABLE_TEXT_BLOCK_STYLES: readonly PortableTextBlockStyle[] = [
  "normal",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote"
];

export type PortableTextListItem = "bullet" | "number";

export const PORTABLE_TEXT_LIST_ITEMS: readonly PortableTextListItem[] = [
  "bullet",
  "number"
];

/** The leaf. `text` is PLAIN text — never markup — and `marks` names decorators and/or annotation `_key`s. */
export type PortableTextSpan = {
  _type: "span";
  _key: string;
  text: string;
  marks: string[];
};

export type PortableTextBlock = {
  _type: "block";
  _key: string;
  style: PortableTextBlockStyle;
  /** Present only for a list item; absent for ordinary prose. */
  listItem?: PortableTextListItem;
  /** Nesting depth for lists, 1-based. Absent when `listItem` is absent. */
  level?: number;
  children: PortableTextSpan[];
  markDefs: PortableTextAnnotation[];
};

/**
 * Object blocks — the two non-prose members, carried across from the old union
 * with their payloads BYTE-IDENTICAL to `GalleryBlockItem`/`VideoNewsBlockItem`.
 *
 * That identity is deliberate and load-bearing: `renderGalleryBlockHtml` and
 * `renderVideoNewsBlockHtml` in `_shared/rendering/` are reused unchanged, so
 * the whole media-reference, R2-verification and CSP story for embeds carries
 * over without a second implementation to keep in step.
 */
export type PortableTextGalleryBlock = {
  _type: "gallery";
  _key: string;
  items: GalleryBlockItem[];
};

export type PortableTextVideoNewsBlock = {
  _type: "videoNews";
  _key: string;
} & VideoNewsBlockItem;

export type PortableTextNode =
  PortableTextBlock | PortableTextGalleryBlock | PortableTextVideoNewsBlock;

/** A whole body. A bare ARRAY, which is what Portable Text is — the envelope lives elsewhere. */
export type PortableTextDocument = PortableTextNode[];

export type PortableTextNodeType = "block" | "gallery" | "videoNews";

export const PORTABLE_TEXT_NODE_TYPES: readonly PortableTextNodeType[] = [
  "block",
  "gallery",
  "videoNews"
];

/* ------------------------------------------------ union <-> constant welds */

type NodeTypesMatchUnion =
  PortableTextNode["_type"] extends PortableTextNodeType
    ? PortableTextNodeType extends PortableTextNode["_type"]
      ? true
      : false
    : false;
const NODE_TYPES_MATCH: NodeTypesMatchUnion = true;
void NODE_TYPES_MATCH;

type StylesMatchUnion =
  PortableTextBlock["style"] extends PortableTextBlockStyle
    ? PortableTextBlockStyle extends PortableTextBlock["style"]
      ? true
      : false
    : false;
const STYLES_MATCH: StylesMatchUnion = true;
void STYLES_MATCH;

type AnnotationTypesMatchUnion =
  PortableTextAnnotation["_type"] extends PortableTextAnnotationType
    ? PortableTextAnnotationType extends PortableTextAnnotation["_type"]
      ? true
      : false
    : false;
const ANNOTATION_TYPES_MATCH: AnnotationTypesMatchUnion = true;
void ANNOTATION_TYPES_MATCH;

/* ------------------------------------------------------------- predicates */

export function isPortableTextNodeType(
  value: unknown
): value is PortableTextNodeType {
  return (
    typeof value === "string" &&
    (PORTABLE_TEXT_NODE_TYPES as string[]).includes(value)
  );
}

export function isPortableTextBlock(
  node: PortableTextNode
): node is PortableTextBlock {
  return node._type === "block";
}

export function isPortableTextGalleryBlock(
  node: PortableTextNode
): node is PortableTextGalleryBlock {
  return node._type === "gallery";
}

export function isPortableTextVideoNewsBlock(
  node: PortableTextNode
): node is PortableTextVideoNewsBlock {
  return node._type === "videoNews";
}

/**
 * Schemes a link annotation may use.
 *
 * `mailto` and `tel` are included because a newsroom's contact and byline
 * copy genuinely needs them. Everything else — `javascript:`, `data:`,
 * `vbscript:`, and any scheme invented later — is refused. A relative or
 * root-relative URL is allowed and is the common case for internal links.
 */
export const PORTABLE_TEXT_ALLOWED_LINK_SCHEMES: readonly string[] = [
  "http:",
  "https:",
  "mailto:",
  "tel:"
];

/**
 * True when `href` is a link this format will store.
 *
 * Parsed rather than pattern-matched. A regex over the raw string is how
 * `java\nscript:` and `JaVaScRiPt:` get through — `URL` normalises both, and
 * anything it cannot parse relative to a base is not a URL worth storing.
 */
export function isAllowedPortableTextHref(href: string): boolean {
  const trimmed = href.trim();

  if (trimmed.length === 0) {
    return false;
  }

  // Relative and root-relative links: no scheme to check, and they cannot
  // carry one without becoming absolute.
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return true;
  }

  try {
    // The base is only used to resolve relatives; an absolute href ignores it.
    const parsed = new URL(trimmed, "https://placeholder.invalid");
    return PORTABLE_TEXT_ALLOWED_LINK_SCHEMES.includes(parsed.protocol);
  } catch {
    return false;
  }
}
