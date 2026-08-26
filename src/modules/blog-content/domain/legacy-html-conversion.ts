import {
  isAllowedPortableTextHref,
  type PortableTextAnnotation,
  type PortableTextBlock,
  type PortableTextBlockStyle,
  type PortableTextDocument,
  type PortableTextSpan
} from "./portable-text";

/**
 * Legacy CKEditor HTML -> canonical Portable Text (Issue #599, ADR-0100).
 *
 * ## Why this exists at all
 *
 * PRD §41 imports 23,906 SeputarBorneo articles whose bodies are raw CKEditor
 * HTML. `content_json` cannot hold that, and write-time validation correctly
 * REFUSES `<script>`/`<iframe>`/`<embed>`/`<object>`. So an import needs a
 * converter — and it must target the canonical body, not the projection being
 * replaced, or 23,906 rows land in the lossy shape and the marks are gone
 * before anyone reads them.
 *
 * NOTE ON "23,906" (every occurrence in this file): the measured snapshot is
 * 25,029 — see ADR-0114 §Consequences, which is the single correction the
 * figure points at. Left standing because these are arguments about scale, and
 * scale does not move.
 *
 * ## Rejection, not sanitization — the whole point
 *
 * A sanitizer is a guess about what an attacker meant. A rejection is a
 * statement about what this system stores. `content-validation.ts` already
 * takes that position, and softening it for a bulk import would be the worst
 * possible place to soften it: nobody reads 23,906 articles, so whatever a
 * silent sanitizer swallows is what goes live.
 *
 * So this converter answers with a REPORT. Constructs outside the grammar are
 * listed with what was found and where, the article is marked unconvertible,
 * and an operator decides. The import job (when it lands) prints
 * that report per article and refuses to write a rejected one.
 *
 * ## What "outside the grammar" means here
 *
 * Not "unknown tag". An unknown INLINE tag whose content is text — `<span>`,
 * `<font>` — is unwrapped, because CKEditor emits those by the thousand for
 * styling and dropping the wrapper loses nothing a reader can see. What is
 * REJECTED is anything that can execute, embed, or fetch: script, iframe,
 * object, embed, form, and any attribute that is an event handler or a
 * `javascript:` URL. Those are not formatting a converter could reasonably
 * reinterpret; they are the reason the write validator exists.
 *
 * `<img>` is rejected too, deliberately, and NOT because it is dangerous: a
 * managed-media deployment stores images as media-object references, and an
 * import that silently kept a raw `src` would smuggle unmanaged media past the
 * enforcement `media_library` exists to apply. The report names each one with
 * its `src` so the importer can resolve it to an uploaded object first.
 *
 * That "first" now has a second half. Pass `resolveImage` and a `src` the
 * caller has ALREADY resolved to a verified media object becomes a real image
 * in the body — a one-item `gallery` node — instead of residue. Everything else
 * is unchanged: no resolver, or a `src` the resolver does not know, and the
 * image is refused exactly as before.
 *
 * What this module still refuses to do is resolve one itself. Turning an
 * arbitrary legacy URL into a managed object means fetching third-party bytes
 * from the server at an address somebody else chose, which is a server-side
 * request forgery primitive; `legacy-ad-ingest.ts` faced the same question for
 * `awcms_blog_ads.image_url` and answered it the same way, at length. Bytes get
 * vouched for by the upload pipeline or not at all.
 *
 * Pure module: no database, no network, no DOM. The parser is deliberately
 * small and total — it never throws, because a converter that throws on article
 * 14,002 of 23,906 tells the operator nothing about the other 9,904.
 */

/** Inline tags carried into marks. */
const DECORATOR_TAGS: Readonly<Record<string, string>> = {
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  code: "code"
};

/** Block tags mapped to a Portable Text style. */
const BLOCK_STYLE_TAGS: Readonly<Record<string, PortableTextBlockStyle>> = {
  p: "normal",
  div: "normal",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  blockquote: "blockquote"
};

/**
 * Tags whose presence makes an article unconvertible.
 *
 * `img` is NO LONGER one of them: it is handled before this list is consulted,
 * because whether it makes the article unconvertible now depends on the
 * caller's resolver. Everything left here is unconditional — it can execute,
 * embed or fetch, and no option makes it acceptable. That is the distinction
 * the old comment here was making in prose and the code can now make
 * structurally.
 */
const REJECTED_TAGS: readonly string[] = [
  "script",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "style",
  "link",
  "meta",
  "base"
];

/**
 * Tags dropped WITH their content.
 *
 * `script` and `style` are BOTH rejected (above) and discarded (here), and the
 * pair is deliberate: the rejection is what tells the operator the article
 * cannot be imported, and the discard is what keeps `steal()` from appearing in
 * the preview as though it were a paragraph the journalist wrote. Recording the
 * finding and keeping the payload would be the worst of both.
 */
const DISCARDED_TAGS: readonly string[] = [
  "head",
  "title",
  "noscript",
  "script",
  "style"
];

export type LegacyConversionRejection = {
  reason:
    "executable_markup" | "unmanaged_image" | "unsafe_href" | "event_handler";
  /** The tag or attribute that caused it — never the full payload. */
  found: string;
  /** Approximate character offset in the source, so an operator can find it. */
  offset: number;
  /** Present for `unmanaged_image`: the `src` an importer must resolve to a media object. */
  detail?: string;
};

/**
 * Answers "which managed media object is this legacy `src`?", or `null`.
 *
 * The converter never decides this itself, and cannot: the answer needs the
 * media registry, and this module is pure. What it CAN do is refuse to guess —
 * a resolver that returns an id the registry does not vouch for produces a
 * gallery item `renderGalleryBlockHtml` silently drops, i.e. an article that
 * looks imported and has lost its photographs. So the caller's contract is that
 * a returned id has already been checked (`isMediaReferenceSafe`), and
 * `blog:legacy:import` refuses the whole run rather than pass one through
 * unverified.
 */
export type LegacyImageResolver = (src: string) => string | null;

export type LegacyConversionOptions = {
  /**
   * Turns `<img src=…>` into a managed media reference instead of a rejection
   * (Issue #599). Absent — the default — keeps the original behaviour: every
   * image is `unmanaged_image` residue with its `src` named.
   */
  resolveImage?: LegacyImageResolver;
};

export type LegacyConversionResult = {
  /** `false` when anything was rejected — the caller must not write the body. */
  ok: boolean;
  /** The converted body. Present even when `ok` is false, for a preview; never for writing. */
  document: PortableTextDocument;
  rejections: LegacyConversionRejection[];
  /** Plain text of the converted body, for `content_text`. */
  plainText: string;
};

type Token =
  | { kind: "text"; value: string; offset: number }
  | {
      kind: "open" | "close" | "selfclose";
      name: string;
      attrs: Record<string, string>;
      offset: number;
    };

const TAG_PATTERN =
  /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR_PATTERN =
  /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

/**
 * The named entities CKEditor actually emits.
 *
 * `nbsp` maps to a REGULAR space, deliberately, not U+00A0. CKEditor emits it as
 * filler by the thousand, and a non-breaking space survives into `content_text`
 * — where it is not a word separator, so "Menteri Ani" becomes one token and
 * stops matching a search for either name.
 */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'"
};

/**
 * Decodes the entity set CKEditor actually emits, in ONE pass.
 *
 * The pass count is the security property, not a performance note. A chain of
 * `.replace()` calls decodes `&amp;lt;` to `&lt;` and then to `<`, because the
 * `&` the first replacement produced is still in the string when the second one
 * runs — double-unescaping, which CodeQL's `js/double-escaping` flags and which
 * turns text an author wrote as the literal characters `&lt;` into markup. A
 * single regex never re-scans its own output.
 *
 * Deliberately not exhaustive: an unrecognised entity is left as written rather
 * than guessed at, which shows up as literal text a proofreader can see instead
 * of a wrong character nobody notices.
 */
function decodeEntities(value: string): string {
  return value.replace(
    /&(nbsp|amp|lt|gt|quot|apos|#39|#\d+);/g,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const point = Number(entity.slice(1));
        return Number.isInteger(point) && point > 0 && point < 0x110000
          ? String.fromCodePoint(point)
          : match;
      }

      return NAMED_ENTITIES[entity] ?? match;
    }
  );
}

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTR_PATTERN.exec(raw)) !== null) {
    const name = match[1]!.toLowerCase();
    attrs[name] = decodeEntities(match[3] ?? match[4] ?? match[5] ?? "");
  }

  return attrs;
}

/**
 * Tokenizes into tags and text.
 *
 * A regex rather than a parser, and the limit is stated rather than hidden: it
 * does not understand `<` inside an attribute value beyond the quoting the
 * pattern handles, and it does not track implicit closes. Both are acceptable
 * because malformed input degrades to text or to an unbalanced tag, and an
 * unbalanced tag is reported rather than silently accepted. Whatever it fails to
 * recognise as a tag stays TEXT and gets escaped downstream — the failure
 * direction that cannot produce markup.
 */
function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  TAG_PATTERN.lastIndex = 0;

  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_PATTERN.exec(html)) !== null) {
    if (match.index > cursor) {
      tokens.push({
        kind: "text",
        value: html.slice(cursor, match.index),
        offset: cursor
      });
    }

    const raw = match[0]!;
    const name = match[1]!.toLowerCase();
    const attrsRaw = match[2] ?? "";

    tokens.push({
      kind: raw.startsWith("</")
        ? "close"
        : attrsRaw.trimEnd().endsWith("/")
          ? "selfclose"
          : "open",
      name,
      attrs: raw.startsWith("</") ? {} : parseAttributes(attrsRaw),
      offset: match.index
    });

    cursor = match.index + raw.length;
  }

  if (cursor < html.length) {
    tokens.push({ kind: "text", value: html.slice(cursor), offset: cursor });
  }

  return tokens;
}

/** Deterministic keys — position-derived, no clock and no randomness, so a re-run after a crash produces the same document. */
function nodeKey(index: number): string {
  return `n${index}`;
}

function spanKey(blockIndex: number, spanIndex: number): string {
  return `n${blockIndex}s${spanIndex}`;
}

type OpenBlock = {
  style: PortableTextBlockStyle;
  listItem?: "bullet" | "number";
  spans: { text: string; marks: string[] }[];
  markDefs: PortableTextAnnotation[];
};

/**
 * Converts one legacy HTML body.
 *
 * Never throws. A body it cannot make sense of yields rejections and whatever
 * it did understand, because an importer walking 23,906 articles needs a report
 * per article rather than a stack trace on one of them.
 */
export function convertLegacyHtmlToPortableText(
  html: unknown,
  options: LegacyConversionOptions = {}
): LegacyConversionResult {
  if (typeof html !== "string" || html.trim().length === 0) {
    return { ok: true, document: [], rejections: [], plainText: "" };
  }

  const rejections: LegacyConversionRejection[] = [];
  const document: PortableTextDocument = [];

  const listStack: ("bullet" | "number")[] = [];
  const markStack: string[] = [];
  let discardDepth = 0;
  let current: OpenBlock | null = null;
  let annotationCounter = 0;

  const flush = (): void => {
    if (!current) return;

    const hasText = current.spans.some((span) => span.text.trim().length > 0);

    if (hasText) {
      const index = document.length;
      const block: PortableTextBlock = {
        _type: "block",
        _key: nodeKey(index),
        style: current.style,
        children: current.spans
          .filter((span) => span.text.length > 0)
          .map((span, spanIndex): PortableTextSpan => ({
            _type: "span",
            _key: spanKey(index, spanIndex),
            text: span.text,
            marks: [...span.marks]
          })),
        markDefs: current.markDefs
      };

      if (current.listItem) {
        block.listItem = current.listItem;
        block.level = 1;
      }

      document.push(block);
    }

    current = null;
  };

  /**
   * Places a resolved image in the document, in the position it occupied in the
   * article (Issue #599).
   *
   * `gallery` is the ONLY node in ADR-0100's closed vocabulary that carries an
   * image, so a lone photograph is a one-item gallery. That is not a workaround:
   * the alternative is a new `_type`, and the vocabulary is closed precisely so
   * that adding one is a deliberate act with its own validation, not something
   * an import script invents.
   *
   * CONSECUTIVE images join the gallery already at the end of the document
   * rather than each starting one, which is the common CKEditor photo-row shape.
   * `flush()` first is what makes that test correct: it pushes any pending text,
   * so a gallery can only still be last when nothing was written between the two
   * images.
   *
   * No `caption`, and that is a decision rather than an omission.
   * `renderGalleryBlockHtml` prints `caption` as a VISIBLE `<figcaption>` (and
   * reuses it as the `alt`), while a legacy `alt` is very often the file name.
   * Carrying it across would print a filename under 23,906 photographs — a
   * silent edit to every article in the archive, made by an import script. An
   * uncaptioned image is the honest result; a caption is something an editor
   * adds on purpose.
   */
  const appendGalleryImage = (mediaObjectId: string): void => {
    flush();

    const last = document[document.length - 1];

    if (last && last._type === "gallery") {
      last.items.push({ mediaType: "image", mediaObjectId });
      return;
    }

    const index = document.length;
    document.push({
      _type: "gallery",
      _key: nodeKey(index),
      items: [{ mediaType: "image", mediaObjectId }]
    });
  };

  const open = (style: PortableTextBlockStyle): void => {
    flush();
    current = {
      style,
      ...(listStack.length > 0
        ? { listItem: listStack[listStack.length - 1] }
        : {}),
      spans: [],
      markDefs: []
    };
  };

  const push = (text: string): void => {
    if (text.length === 0) return;
    if (!current) open("normal");
    current!.spans.push({ text, marks: [...markStack] });
  };

  for (const token of tokenize(html)) {
    if (token.kind === "text") {
      if (discardDepth === 0) push(decodeEntities(token.value));
      continue;
    }

    const { name } = token;

    if (DISCARDED_TAGS.includes(name)) {
      // Rejected AND discarded when it is also executable — see DISCARDED_TAGS.
      if (token.kind === "open" && REJECTED_TAGS.includes(name)) {
        rejections.push({
          reason: "executable_markup",
          found: name,
          offset: token.offset
        });
      }

      if (token.kind === "open") discardDepth += 1;
      else if (token.kind === "close" && discardDepth > 0) discardDepth -= 1;
      continue;
    }

    if (discardDepth > 0) continue;

    if (token.kind !== "close") {
      // Event handlers are rejected wherever they appear, including on a tag
      // that is otherwise fine — `<p onclick=…>` is not a paragraph with a
      // decoration, it is script.
      for (const attr of Object.keys(token.attrs)) {
        if (attr.startsWith("on")) {
          rejections.push({
            reason: "event_handler",
            found: `${name}[${attr}]`,
            offset: token.offset
          });
        }
      }
    }

    if (name === "img" && token.kind !== "close") {
      const src = token.attrs.src ?? "";
      const mediaObjectId = src ? (options.resolveImage?.(src) ?? null) : null;

      if (mediaObjectId) {
        appendGalleryImage(mediaObjectId);
      } else {
        rejections.push({
          reason: "unmanaged_image",
          found: "img",
          offset: token.offset,
          detail: src
        });
      }
      continue;
    }

    if (REJECTED_TAGS.includes(name)) {
      if (token.kind !== "close") {
        rejections.push({
          reason: "executable_markup",
          found: name,
          offset: token.offset
        });
      }
      continue;
    }

    if (name === "br") {
      push("\n");
      continue;
    }

    if (name === "ul" || name === "ol") {
      if (token.kind === "open") {
        flush();
        listStack.push(name === "ol" ? "number" : "bullet");
      } else if (token.kind === "close") {
        flush();
        listStack.pop();
      }
      continue;
    }

    if (name === "li") {
      if (token.kind === "open") {
        open("normal");
      } else if (token.kind === "close") {
        flush();
      }
      continue;
    }

    const style = BLOCK_STYLE_TAGS[name];
    if (style) {
      if (token.kind === "open") open(style);
      else if (token.kind === "close") flush();
      continue;
    }

    const decorator = DECORATOR_TAGS[name];
    if (decorator) {
      if (token.kind === "open") markStack.push(decorator);
      else if (token.kind === "close") {
        const at = markStack.lastIndexOf(decorator);
        if (at >= 0) markStack.splice(at, 1);
      }
      continue;
    }

    if (name === "a") {
      if (token.kind === "open") {
        const href = token.attrs.href ?? "";

        if (!isAllowedPortableTextHref(href)) {
          // Rejected rather than unwrapped: an import that quietly dropped a
          // `javascript:` link would also quietly drop the evidence that the
          // legacy body contained one.
          rejections.push({
            reason: "unsafe_href",
            found: "a[href]",
            offset: token.offset
          });
          continue;
        }

        if (!current) open("normal");
        annotationCounter += 1;
        const key = `l${annotationCounter}`;
        current!.markDefs.push({ _type: "link", _key: key, href });
        markStack.push(key);
      } else if (token.kind === "close") {
        // Pop the most recent link mark, whichever it is: nesting anchors is
        // invalid HTML, so the innermost open link is always the one closing.
        for (let i = markStack.length - 1; i >= 0; i -= 1) {
          if (markStack[i]!.startsWith("l")) {
            markStack.splice(i, 1);
            break;
          }
        }
      }
      continue;
    }

    // Everything else — `<span>`, `<font>`, `<table>`, an unknown wrapper — is
    // UNWRAPPED: its text is kept, the tag is dropped. CKEditor emits these by
    // the thousand for styling, and losing a wrapper loses nothing a reader can
    // see. Rejecting them would fail almost every article for no safety gain.
  }

  flush();

  const plainText = document
    .map((node) =>
      node._type === "block"
        ? node.children.map((span) => span.text).join("")
        : ""
    )
    .filter((line) => line.length > 0)
    .join("\n\n");

  return {
    ok: rejections.length === 0,
    document,
    rejections,
    plainText
  };
}

/** One line per rejection, for an importer's per-article report. */
export function formatConversionRejection(
  rejection: LegacyConversionRejection
): string {
  const where = `at offset ${rejection.offset}`;

  switch (rejection.reason) {
    case "unmanaged_image":
      return `unmanaged image ${where}: ${rejection.detail || "(no src)"} — upload it to the media library and reference the object id`;
    case "unsafe_href":
      return `link with a disallowed scheme ${where}`;
    case "event_handler":
      return `inline event handler ${where}: ${rejection.found}`;
    case "executable_markup":
      return `executable markup ${where}: <${rejection.found}>`;
  }
}
