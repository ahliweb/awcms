import { containsUnsafeHtml } from "./content-validation";
import {
  isAllowedPortableTextHref,
  isPortableTextNodeType,
  PORTABLE_TEXT_ANNOTATION_TYPES,
  PORTABLE_TEXT_BLOCK_STYLES,
  PORTABLE_TEXT_DECORATORS,
  PORTABLE_TEXT_LIST_ITEMS,
  PORTABLE_TEXT_NODE_TYPES,
  type PortableTextDocument
} from "./portable-text";

/**
 * Write-time validation for a Portable Text body (ADR-0100, Issue #588).
 *
 * ## Rejection, not sanitization — and why that is unchanged
 *
 * `content-validation.ts` refuses `<script>`/`<iframe>`/`<embed>`/`<object>`,
 * inline handler attributes and `javascript:` rather than stripping them, and
 * that choice is what the module's XSS posture rests on: a sanitizer is a
 * guess about what an attacker meant, a rejection is a statement about what
 * this system stores. Nothing here softens it.
 *
 * What changes is that the closed vocabulary now has to be enforced by code
 * rather than by the shape of a TypeScript union. The old `content_json` was a
 * `jsonb` blob whose only real guard was `containsUnsafeHtml` over its
 * stringified form; a body that claimed `{"type":"iframe_embed"}` was
 * structurally accepted and simply failed to render. Portable Text makes the
 * vocabulary explicit, so the validator can refuse an unknown `_type` outright
 * — which is the difference between "does not render" and "cannot be stored".
 *
 * ## Why `containsUnsafeHtml` still runs over the whole document
 *
 * Belt and braces, deliberately. The structural walk below already refuses an
 * unknown `_type`, a bad style and a disallowed href — but `text` and
 * `caption` are free strings by design, and an editor pasting
 * `<script>alert(1)</script>` into a paragraph must be refused even though a
 * paragraph is a perfectly valid node. The spans are plain text and the
 * renderers escape them, so this is defence in depth rather than the only
 * line; it is kept because the cost is one pass and the failure it prevents is
 * stored XSS.
 *
 * Pure module: no database, no config, no `Bun.SQL`.
 */

export type ValidationError = {
  field: string;
  message: string;
};

/** Bounds. Generous — these exist to stop a runaway document, not to shape editorial work. */
export const MAX_PORTABLE_TEXT_NODES = 2000;
export const MAX_PORTABLE_TEXT_SPANS_PER_BLOCK = 500;
export const MAX_PORTABLE_TEXT_LIST_LEVEL = 6;
export const MAX_PORTABLE_TEXT_HREF_LENGTH = 2048;

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushError(
  errors: ValidationError[],
  path: string,
  message: string
): void {
  errors.push({ field: path, message });
}

function validateSpan(
  raw: unknown,
  path: string,
  declaredMarkKeys: ReadonlySet<string>,
  errors: ValidationError[]
): void {
  if (!isRecord(raw)) {
    pushError(errors, path, "A block child must be an object.");
    return;
  }

  if (raw._type !== "span") {
    // Portable Text allows inline objects here; this vocabulary does not, and
    // the message says so rather than leaving an author guessing why a valid
    // upstream construct was refused.
    pushError(
      errors,
      `${path}._type`,
      "A block child must be a span. Inline objects are not part of this vocabulary."
    );
    return;
  }

  if (typeof raw._key !== "string" || !KEY_PATTERN.test(raw._key)) {
    pushError(
      errors,
      `${path}._key`,
      "_key must be 1-64 characters of letters, digits, hyphen or underscore."
    );
  }

  if (typeof raw.text !== "string") {
    pushError(errors, `${path}.text`, "text must be a string.");
  }

  if (raw.marks !== undefined) {
    if (!Array.isArray(raw.marks)) {
      pushError(errors, `${path}.marks`, "marks must be an array of strings.");
    } else {
      for (const [index, mark] of raw.marks.entries()) {
        if (typeof mark !== "string") {
          pushError(
            errors,
            `${path}.marks[${index}]`,
            "A mark must be a string."
          );
          continue;
        }

        const isDecorator = (PORTABLE_TEXT_DECORATORS as string[]).includes(
          mark
        );

        // A mark is EITHER a decorator name OR the `_key` of an annotation
        // declared in this block's own `markDefs`. A mark naming neither is a
        // dangling reference: it renders as nothing, so the emphasis or link
        // the author applied silently disappears.
        if (!isDecorator && !declaredMarkKeys.has(mark)) {
          pushError(
            errors,
            `${path}.marks[${index}]`,
            `Unknown mark "${mark}". Expected one of ${PORTABLE_TEXT_DECORATORS.join(", ")}, or the _key of an annotation declared in this block's markDefs.`
          );
        }
      }
    }
  }
}

function validateMarkDefs(
  raw: unknown,
  path: string,
  errors: ValidationError[]
): Set<string> {
  const keys = new Set<string>();

  if (raw === undefined) {
    return keys;
  }

  if (!Array.isArray(raw)) {
    pushError(errors, path, "markDefs must be an array.");
    return keys;
  }

  for (const [index, def] of raw.entries()) {
    const defPath = `${path}[${index}]`;

    if (!isRecord(def)) {
      pushError(errors, defPath, "An annotation must be an object.");
      continue;
    }

    if (
      typeof def._type !== "string" ||
      !(PORTABLE_TEXT_ANNOTATION_TYPES as string[]).includes(def._type)
    ) {
      pushError(
        errors,
        `${defPath}._type`,
        `Annotation _type must be one of ${PORTABLE_TEXT_ANNOTATION_TYPES.join(", ")}.`
      );
      continue;
    }

    if (typeof def._key !== "string" || !KEY_PATTERN.test(def._key)) {
      pushError(
        errors,
        `${defPath}._key`,
        "_key must be 1-64 characters of letters, digits, hyphen or underscore."
      );
      continue;
    }

    keys.add(def._key);

    if (typeof def.href !== "string") {
      pushError(errors, `${defPath}.href`, "A link annotation requires href.");
      continue;
    }

    if (def.href.length > MAX_PORTABLE_TEXT_HREF_LENGTH) {
      pushError(
        errors,
        `${defPath}.href`,
        `href must be at most ${MAX_PORTABLE_TEXT_HREF_LENGTH} characters.`
      );
      continue;
    }

    if (!isAllowedPortableTextHref(def.href)) {
      // The message names the allowed set rather than echoing the rejected
      // value — echoing it back into an admin screen is how a stored payload
      // gets a second chance to render.
      pushError(
        errors,
        `${defPath}.href`,
        "href must be a relative URL or use the http, https, mailto or tel scheme."
      );
    }
  }

  return keys;
}

function validateBlockNode(
  node: Record<string, unknown>,
  path: string,
  errors: ValidationError[]
): void {
  if (
    typeof node.style !== "string" ||
    !(PORTABLE_TEXT_BLOCK_STYLES as string[]).includes(node.style)
  ) {
    pushError(
      errors,
      `${path}.style`,
      `style must be one of ${PORTABLE_TEXT_BLOCK_STYLES.join(", ")}.`
    );
  }

  if (node.listItem !== undefined) {
    if (
      typeof node.listItem !== "string" ||
      !(PORTABLE_TEXT_LIST_ITEMS as string[]).includes(node.listItem)
    ) {
      pushError(
        errors,
        `${path}.listItem`,
        `listItem must be one of ${PORTABLE_TEXT_LIST_ITEMS.join(", ")}.`
      );
    }

    const level = node.level;
    if (
      level !== undefined &&
      (typeof level !== "number" ||
        !Number.isInteger(level) ||
        level < 1 ||
        level > MAX_PORTABLE_TEXT_LIST_LEVEL)
    ) {
      pushError(
        errors,
        `${path}.level`,
        `level must be an integer between 1 and ${MAX_PORTABLE_TEXT_LIST_LEVEL}.`
      );
    }
  } else if (node.level !== undefined) {
    // A level without a listItem is a nesting depth for something that is not
    // a list. Harmless to render and meaningless to store, which is exactly
    // the kind of drift a closed vocabulary exists to refuse.
    pushError(
      errors,
      `${path}.level`,
      "level is only meaningful on a list item; omit it or set listItem."
    );
  }

  const markKeys = validateMarkDefs(node.markDefs, `${path}.markDefs`, errors);

  if (!Array.isArray(node.children)) {
    pushError(
      errors,
      `${path}.children`,
      "children must be an array of spans."
    );
    return;
  }

  if (node.children.length > MAX_PORTABLE_TEXT_SPANS_PER_BLOCK) {
    pushError(
      errors,
      `${path}.children`,
      `A block may hold at most ${MAX_PORTABLE_TEXT_SPANS_PER_BLOCK} spans.`
    );
    return;
  }

  for (const [index, child] of node.children.entries()) {
    validateSpan(child, `${path}.children[${index}]`, markKeys, errors);
  }
}

function validateGalleryNode(
  node: Record<string, unknown>,
  path: string,
  errors: ValidationError[]
): void {
  if (!Array.isArray(node.items)) {
    pushError(errors, `${path}.items`, "A gallery requires an items array.");
    return;
  }

  for (const [index, item] of node.items.entries()) {
    const itemPath = `${path}.items[${index}]`;

    if (!isRecord(item)) {
      pushError(errors, itemPath, "A gallery item must be an object.");
      continue;
    }

    if (item.mediaType !== "image" && item.mediaType !== "video") {
      pushError(
        errors,
        `${itemPath}.mediaType`,
        "mediaType must be image or video."
      );
    }

    // Exactly one reference shape. Both is ambiguous — the renderer would have
    // to pick, and whichever it picked would surprise half the callers — and
    // neither is an item that renders as nothing.
    const hasUrl = typeof item.url === "string" && item.url.length > 0;
    const hasMediaObjectId =
      typeof item.mediaObjectId === "string" && item.mediaObjectId.length > 0;

    if (hasUrl === hasMediaObjectId) {
      pushError(
        errors,
        itemPath,
        "A gallery item must carry exactly one of url or mediaObjectId."
      );
    }
  }
}

function validateVideoNewsNode(
  node: Record<string, unknown>,
  path: string,
  errors: ValidationError[]
): void {
  // Provider/videoId shape is owned by `video-news-block-validation.ts`, which
  // holds the provider allow-list and the per-provider id patterns. Duplicating
  // it here would produce two allow-lists that disagree the first time one is
  // extended, so this checks only that the fields an author must supply are
  // present and stringy.
  if (typeof node.provider !== "string" || node.provider.length === 0) {
    pushError(errors, `${path}.provider`, "provider is required.");
  }

  if (typeof node.videoId !== "string" || node.videoId.length === 0) {
    pushError(errors, `${path}.videoId`, "videoId is required.");
  }
}

export type PortableTextValidationResult =
  | { valid: true; value: PortableTextDocument }
  | { valid: false; errors: ValidationError[] };

/**
 * Validates a whole body and, on success, hands back the SAME value typed.
 *
 * It does not normalise, rewrite or fill in defaults. A validator that also
 * rewrites is the reason `validateAndNormalizeContentJsonVideoBlocks` makes a
 * round-trip test impossible to state: the caller cannot tell what was stored
 * from what it sent. Normalisation, where it is needed, is a separate step
 * with its own name.
 */
export function validatePortableTextDocument(
  value: unknown,
  field = "bodyPortableText"
): PortableTextValidationResult {
  const errors: ValidationError[] = [];

  if (!Array.isArray(value)) {
    return {
      valid: false,
      errors: [
        {
          field,
          message: "bodyPortableText must be an array of Portable Text nodes."
        }
      ]
    };
  }

  if (value.length > MAX_PORTABLE_TEXT_NODES) {
    return {
      valid: false,
      errors: [
        {
          field,
          message: `bodyPortableText must hold at most ${MAX_PORTABLE_TEXT_NODES} nodes.`
        }
      ]
    };
  }

  for (const [index, raw] of value.entries()) {
    const path = `${field}[${index}]`;

    if (!isRecord(raw)) {
      pushError(errors, path, "A node must be an object.");
      continue;
    }

    if (!isPortableTextNodeType(raw._type)) {
      pushError(
        errors,
        `${path}._type`,
        `_type must be one of ${PORTABLE_TEXT_NODE_TYPES.join(", ")}.`
      );
      continue;
    }

    if (typeof raw._key !== "string" || !KEY_PATTERN.test(raw._key)) {
      pushError(
        errors,
        `${path}._key`,
        "_key must be 1-64 characters of letters, digits, hyphen or underscore."
      );
    }

    if (raw._type === "block") {
      validateBlockNode(raw, path, errors);
    } else if (raw._type === "gallery") {
      validateGalleryNode(raw, path, errors);
    } else {
      validateVideoNewsNode(raw, path, errors);
    }
  }

  // Defence in depth over the free-text fields — see this file's header.
  if (errors.length === 0 && containsUnsafeHtml(JSON.stringify(value))) {
    return {
      valid: false,
      errors: [
        {
          field,
          message:
            "bodyPortableText must not contain <script>, <iframe>, <embed>, <object>, inline event handler attributes, or javascript: URLs."
        }
      ]
    };
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, value: value as PortableTextDocument };
}
