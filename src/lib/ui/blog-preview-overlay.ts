import {
  buildBlockFromEditable,
  blockToEditableHtml,
  nextEditorKey
} from "./portable-text-editor";
import { sendJson } from "./admin-form-client";
import { EDITABLE_BLOCK_INDEX_ATTRIBUTE } from "../../modules/blog-content/domain/portable-text-rendering";
import { PREVIEW_STATE_ELEMENT_ID } from "../../modules/blog-content/domain/preview-overlay";
import type {
  PortableTextBlock,
  PortableTextDocument,
  PortableTextNode
} from "../../modules/blog-content/domain/portable-text";

/**
 * The in-place editing overlay for `/admin/blog/{id}/preview` (Issue #592).
 *
 * ## What it is for
 *
 * #635 gave an editor a preview that renders through the PUBLIC template, so
 * "guess what the article will look like" is already answered. The second half
 * of this issue's scope is the part a preview alone does not solve: seeing that
 * a subheading is wrong and then having to find it again in a list of blocks on
 * another screen. Click the sentence, fix the sentence.
 *
 * ## Why this is a bundled module rather than a hand-written `public/js` file
 *
 * `preview.ts` is an `APIRoute` returning an HTML string, and Astro only
 * bundles `<script>` for `.astro` components — so the browser code for this
 * page has to come from `public/`. Writing it there by hand was the cheap
 * option and it costs the one thing this issue cares most about: the overlay
 * would carry a SECOND, untyped copy of the block <-> Portable Text conversion
 * that `portable-text-editor.ts` owns, and a preview whose editor drifts from
 * the real editor is the same defect as a preview whose renderer drifts.
 *
 * So this is TypeScript, it imports the one conversion, and
 * `bun run build:preview-overlay` bundles it to
 * `public/js/blog-preview-overlay.js` — a generated artefact, committed and
 * freshness-gated like every other generated artefact in this repo.
 *
 * ## Why not an `<iframe>` beside the existing editor
 *
 * That would have needed no new asset at all: `/admin/blog` is an `.astro`
 * page, Astro bundles its script, and a same-origin frame is reachable from
 * the parent. It is impossible here, and for a good reason —
 * `security-headers.ts` sends `frame-ancestors 'none'` AND
 * `X-Frame-Options: DENY` on every response. Relaxing either to embed an admin
 * page inside another admin page trades a clickjacking guarantee that covers
 * the whole application for one screen's convenience.
 *
 * ## Why there is no renderer here
 *
 * After a successful save the page RELOADS rather than re-rendering the edited
 * block in the browser. That is the cheaper code and the stronger property: a
 * client-side re-render would be a second renderer, which is exactly what this
 * issue forbids, and the reloaded page is by construction what a reader gets.
 *
 * ## Styling without a stylesheet
 *
 * Every visual affordance is set through `element.style`, not a CSS file. The
 * shell links `/css/public-content.css`, which is a READER asset on the
 * tightest budget in the repo (ADR-0101) — putting admin-only rules there would
 * charge every article page for a screen no reader ever loads. A second
 * stylesheet would need a `<link>`, and `renderPublicPageShell` deliberately
 * has no injection point. CSSOM property assignment is also not "inline style"
 * for CSP purposes, so nothing here depends on widening `style-src`.
 */

export type PreviewEditorState = {
  postId: string;
  document: PortableTextDocument;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the embedded state, or `null` for anything unexpected.
 *
 * `null` means the overlay does not mount and the page stays a plain preview.
 * That is the correct answer to every failure here, including the ordinary one:
 * a row whose canonical body has not been backfilled renders through the lossy
 * projection (`blog-body-rendering.ts`), the route embeds no state for it, and
 * offering clicks that could not be saved would be the preview lying about what
 * it can do.
 */
export function parsePreviewState(
  raw: string | null | undefined
): PreviewEditorState | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const { postId, document: body } = parsed;

  if (typeof postId !== "string" || postId.length === 0) {
    return null;
  }

  if (!Array.isArray(body)) {
    return null;
  }

  return { postId, document: body as PortableTextDocument };
}

/**
 * The node at `index`, only when it is a prose block this overlay can edit.
 *
 * A gallery or a video is carried through the editor as an opaque card for a
 * reason (`isOpaqueEditorNode`), and there is no sense in which a
 * `contenteditable` over its rendered markup could be read back. They are not
 * stamped by the renderer either, so this is the second of two answers to the
 * same question — deliberately, because the first one lives in another module
 * and this one must hold on its own.
 */
export function editableBlockAt(
  body: PortableTextDocument,
  index: number
): PortableTextBlock | null {
  const node: PortableTextNode | undefined = body[index];

  if (!isRecord(node) || node._type !== "block") {
    return null;
  }

  return node as PortableTextBlock;
}

/**
 * The document with one block replaced.
 *
 * Every other node is carried through by REFERENCE, untouched — the same
 * property `toEditorRows` exists for. An overlay that rebuilt the array would
 * risk rewriting a gallery nobody edited, and the symptom of that is an image
 * disappearing from an article whose text somebody fixed.
 */
export function replaceBlockAt(
  body: PortableTextDocument,
  index: number,
  block: PortableTextBlock
): PortableTextDocument {
  if (index < 0 || index >= body.length) {
    return body;
  }

  const next = [...body];
  next[index] = block;
  return next;
}

/** True when a rebuilt block carries no text at all. */
export function isEmptyBlock(block: PortableTextBlock): boolean {
  return block.children.every((child) => child.text.trim() === "");
}

const OUTLINE_IDLE = "1px dashed rgba(0, 0, 0, 0.25)";
const OUTLINE_HOVER = "2px solid #2563eb";
const OUTLINE_EDITING = "2px solid #16a34a";

type StatusBar = { show: (message: string) => void; clear: () => void };

function createStatusBar(doc: Document): StatusBar {
  const bar = doc.createElement("div");
  bar.setAttribute("role", "status");
  bar.style.position = "fixed";
  bar.style.insetInlineStart = "0";
  bar.style.insetInlineEnd = "0";
  bar.style.insetBlockEnd = "0";
  bar.style.zIndex = "9999";
  bar.style.padding = "0.5rem 1rem";
  bar.style.font = "14px/1.4 system-ui, sans-serif";
  bar.style.background = "#111827";
  bar.style.color = "#f9fafb";
  bar.style.display = "none";
  doc.body.append(bar);

  return {
    show: (message: string): void => {
      // `textContent`, never `innerHTML`: these messages are this module's own
      // strings today, and a helper that accepts markup is how the next one
      // stops being.
      bar.textContent = message;
      bar.style.display = "block";
    },
    clear: (): void => {
      bar.textContent = "";
      bar.style.display = "none";
    }
  };
}

/**
 * Wires the overlay into an already-rendered preview document.
 *
 * Exported separately from the auto-mount at the bottom so the entry point is
 * one statement and the behaviour is addressable.
 */
export function mountBlogPreviewOverlay(doc: Document): void {
  const stateElement = doc.getElementById(PREVIEW_STATE_ELEMENT_ID);
  const state = parsePreviewState(stateElement?.textContent);

  if (!state) {
    return;
  }

  const status = createStatusBar(doc);
  let body = state.document;
  let editing: {
    element: HTMLElement;
    index: number;
    original: string;
  } | null = null;

  const blocks = [
    ...doc.querySelectorAll<HTMLElement>(`[${EDITABLE_BLOCK_INDEX_ATTRIBUTE}]`)
  ];

  const finishEditing = (element: HTMLElement): void => {
    element.contentEditable = "false";
    element.style.outline = OUTLINE_IDLE;
    editing = null;
    status.clear();
  };

  const cancelEditing = (): void => {
    if (!editing) {
      return;
    }
    editing.element.innerHTML = editing.original;
    finishEditing(editing.element);
  };

  const saveEditing = async (): Promise<void> => {
    if (!editing) {
      return;
    }

    const { element, index } = editing;
    const block = editableBlockAt(body, index);

    if (!block) {
      cancelEditing();
      return;
    }

    const rebuilt = buildBlockFromEditable(
      typeof block._key === "string" && block._key.length > 0
        ? block._key
        : nextEditorKey("b"),
      element.innerHTML,
      block.style,
      block.listItem,
      Array.isArray(block.markDefs) ? block.markDefs : []
    );

    if (isEmptyBlock(rebuilt)) {
      // Deliberately refused rather than treated as a delete. The full editor
      // drops an empty block on save, and doing the same from a single click
      // would make an accidental select-all-delete indistinguishable from a
      // deliberate removal — with no undo on this page.
      status.show(
        "A block cannot be emptied here. Press Escape to cancel, or remove it in the editor."
      );
      return;
    }

    status.show("Saving…");

    // No `Idempotency-Key`: `PATCH /api/v1/blog/posts/{id}` requires none, and
    // a same-body retry converges to the same end state. Only the body is
    // sent — a PATCH is partial, and this overlay owns exactly one field.
    const result = await sendJson(
      "PATCH",
      `/api/v1/blog/posts/${state.postId}`,
      { bodyPortableText: replaceBlockAt(body, index, rebuilt) }
    );

    if (!result.ok) {
      status.show(
        result.errorCode === "FORBIDDEN"
          ? "You do not have permission to edit this article."
          : "Could not save the change. Press Escape to cancel, or try again."
      );
      return;
    }

    body = replaceBlockAt(body, index, rebuilt);
    finishEditing(element);
    // The server re-renders through the same template the reader gets, which
    // is the whole premise of this screen. A client-side re-render would be
    // the second renderer this issue forbids.
    doc.defaultView?.location.reload();
  };

  const beginEditing = (element: HTMLElement, index: number): void => {
    if (editing) {
      return;
    }

    const block = editableBlockAt(body, index);
    if (!block) {
      return;
    }

    editing = { element, index, original: element.innerHTML };
    element.innerHTML = blockToEditableHtml(block);
    element.contentEditable = "true";
    element.style.outline = OUTLINE_EDITING;
    element.focus();
    status.show("Editing — Enter saves, Escape cancels.");
  };

  for (const element of blocks) {
    const index = Number(
      element.getAttribute(EDITABLE_BLOCK_INDEX_ATTRIBUTE) ?? ""
    );

    if (!Number.isInteger(index) || !editableBlockAt(body, index)) {
      continue;
    }

    element.style.outline = OUTLINE_IDLE;
    element.style.outlineOffset = "4px";
    element.style.cursor = "text";
    element.title = "Click to edit";

    element.addEventListener("mouseenter", () => {
      if (!editing) {
        element.style.outline = OUTLINE_HOVER;
      }
    });
    element.addEventListener("mouseleave", () => {
      if (!editing) {
        element.style.outline = OUTLINE_IDLE;
      }
    });

    element.addEventListener("click", (event) => {
      // Already editing THIS block: let the click through so the browser can
      // place the caret where the pointer is.
      if (editing?.element === element) {
        return;
      }

      // A rendered body carries real `<a href>` anchors, and clicking a linked
      // phrase to fix its wording would otherwise NAVIGATE — off the preview,
      // with the edit unmade. Inside the editable form the same anchors are
      // `<a data-mark>` with no href (`blockToEditableHtml`), which is why this
      // only has to hold for the first click.
      event.preventDefault();

      if (editing) {
        status.show(
          "Finish the block you are editing first — Enter or Escape."
        );
        return;
      }

      beginEditing(element, index);
    });

    element.addEventListener("paste", (event) => {
      // Same rule the block editor applies, and for the same reason: the
      // editable region must only ever contain tags this code emitted, so
      // `editableHtmlToSpans` never has to understand markup a browser
      // produced from a Word paste.
      const clipboard = event.clipboardData;
      if (!clipboard) {
        return;
      }
      event.preventDefault();
      doc.execCommand("insertText", false, clipboard.getData("text/plain"));
    });

    element.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelEditing();
        return;
      }

      // A block IS the paragraph, so a newline inside one has nowhere to go —
      // which makes Enter free to mean "done".
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void saveEditing();
      }
    });
  }
}

// The bundle's entry point. Guarded so importing this module in `bun test`
// — where there is no DOM — exercises the pure functions above without
// trying to mount anything.
if (typeof document !== "undefined") {
  mountBlogPreviewOverlay(document);
}
