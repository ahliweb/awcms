import type { ResolvedGalleryMediaUrls } from "../../_shared/rendering/gallery-block-renderer";
import {
  collectRenderableGalleryMediaObjectIds,
  collectRenderableVideoNewsThumbnailMediaObjectIds,
  renderContentJsonToHtml
} from "./content-block-rendering";
import {
  renderPortableTextToHtml,
  type PortableTextRenderOptions
} from "./portable-text-rendering";

/**
 * The ONE place that decides which stored body a reader actually sees
 * (Issue #624).
 *
 * ## The defect this closes
 *
 * ADR-0100 made Portable Text the canonical body, and #605/#606 gave editors an
 * editor that produces bold, italic, code and inline links. `renderPortableTextToHtml`
 * renders all of it correctly — and had ZERO production callers. Every public
 * surface rendered `content_json.blocks` instead, the projection that
 * `portable-text-conversion.ts` itself calls lossy by construction: "ContentBlock
 * has no marks. So bold, italic, code and links flatten to their plain text on the
 * way back."
 *
 * So a journalist bolded a phrase, saved, opened the public page, and read it
 * plain. No error, no log, no red gate.
 *
 * ## Why this is a fallback and not a swap
 *
 * `sql/134` gives `body_portable_text` a `'[]'::jsonb` DEFAULT and leaves the
 * conversion to `bun run blog:portable-text:backfill`, a deployment job that
 * deliberately does not run from the migration (the tables are FORCE RLS; DML in a
 * migration is green on an empty CI database and breaks in production).
 *
 * On a deployment that has not run that job, the canonical column is empty for
 * every pre-existing row. An unconditional switch would render EVERY article blank
 * — and blank is indistinguishable from "the editor wrote nothing", which is the
 * worst possible failure shape for a news site.
 *
 * So: render the canonical body when it holds something, fall back to the
 * projection when it does not. That is byte-identical to today's output on a
 * deployment that has not backfilled, needs no release coordination, and heals
 * PER ROW as the backfill progresses.
 *
 * ## Why "empty canonical" is a safe signal
 *
 * Every write since #605 populates both columns in the same statement
 * (`blog-post-directory.ts` / `blog-page-directory.ts` derive `content_json` from
 * the Portable Text via `withProjectedBlocks`), so the two are consistent by
 * construction for anything written since. An empty canonical body therefore means
 * exactly one of two things — the row predates the backfill, or the editor really
 * did clear the body — and both are served correctly by falling back, because in
 * the second case the projection is empty too and both renderers return `""`.
 *
 * Pure module: no database, no I/O.
 */

export type BlogBodySource = {
  /** The canonical body (ADR-0100). `unknown` because it arrives as jsonb and a pre-backfill row can hold anything a caller must not trust. */
  bodyPortableText: unknown;
  /** The lossy derived projection, still the fallback for un-backfilled rows. */
  contentJson: Record<string, unknown>;
};

/**
 * Whether the canonical body carries content.
 *
 * A non-array is not "malformed" here — it is what `undefined` looks like when a
 * query did not select the column. Both answer `false` and fall back, which is
 * the same "degrade, never throw" rule both renderers already follow.
 */
export function hasCanonicalPortableTextBody(body: BlogBodySource): boolean {
  return (
    Array.isArray(body.bodyPortableText) && body.bodyPortableText.length > 0
  );
}

/**
 * Renders a post or page body to safe HTML from whichever source is live for
 * this row.
 *
 * Both branches escape every character of author-supplied content and emit tags
 * only from closed mappings — the safety property does not depend on which one
 * runs.
 *
 * `options` reaches ONLY the canonical branch, and that is a statement about
 * the feature rather than an oversight: `editableBlockIndexes` exists so an
 * overlay can splice an edited block back into a Portable Text ARRAY (Issue
 * #592), and the projection is not that array. Stamping the fallback would
 * offer an editor a click that could not be saved — the preview lying about
 * what it can do, which is the failure this issue is about. The caller decides
 * whether to offer editing at all by asking `hasCanonicalPortableTextBody`
 * first; #624's single-decision-point rule is untouched, because this is still
 * the only function that chooses a body.
 */
export function renderBlogBodyHtml(
  body: BlogBodySource,
  resolvedMediaUrls?: ResolvedGalleryMediaUrls,
  options?: PortableTextRenderOptions
): string {
  return hasCanonicalPortableTextBody(body)
    ? renderPortableTextToHtml(
        body.bodyPortableText,
        resolvedMediaUrls,
        options
      )
    : renderContentJsonToHtml(body.contentJson, resolvedMediaUrls);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Projects a Portable Text document into the `{ blocks: [...] }` shape the
 * existing reference collectors read.
 *
 * Deliberately a shape adapter rather than a second extractor: "which gallery
 * item references a media object" is a rule with a write-time half
 * (`collectGalleryImageReferences` decides what must be verified before a post is
 * stored) and a render-time half. Re-implementing the UUID check, the
 * image-only filter and the missing-vs-malformed distinction here would give the
 * two halves two chances to drift, and the symptom of that drift is an image an
 * editor placed that silently renders nothing.
 *
 * Only the two media-bearing node types are projected — prose blocks reference
 * no media, and `portableTextToContentBlocks` cannot be reused for this because
 * it assumes a well-formed document and this input comes straight from jsonb.
 */
function portableTextMediaProjection(
  document: unknown
): Record<string, unknown> {
  if (!Array.isArray(document)) {
    return {};
  }

  const blocks: Record<string, unknown>[] = [];

  for (const node of document) {
    if (!isRecord(node)) {
      continue;
    }

    if (node._type === "gallery") {
      blocks.push({ type: "gallery", items: node.items });
      continue;
    }

    if (node._type === "videoNews") {
      blocks.push({
        type: "video_news",
        thumbnailMediaObjectId: node.thumbnailMediaObjectId
      });
    }
  }

  return { blocks };
}

function unionInOrder(...lists: readonly string[][]): string[] {
  return [...new Set(lists.flat())];
}

export type BlogBodyMediaReferences = {
  /** Gallery IMAGE ids, in the order they appear in the body that will actually be rendered. */
  galleryImageMediaObjectIds: string[];
  /** `video_news` / `videoNews` thumbnail ids. */
  videoThumbnailMediaObjectIds: string[];
};

/**
 * Every media object id a rendered body can reference, collected from BOTH
 * stored shapes.
 *
 * The union is belt-and-braces: the write path derives one shape from the other,
 * so the id sets are identical today. Collecting from only the rendered source
 * would make that an unstated invariant whose first violation shows up as a
 * missing photo on a live article, and the union costs one extra traversal of a
 * body already in memory.
 *
 * ORDER follows the rendered source, because the caller's "first image in the
 * content" social-preview fallback (`social-preview-image-resolution.ts`) means
 * the first image a READER sees, not the first one in whichever shape happened
 * to be traversed first.
 */
export function collectBlogBodyMediaObjectIds(
  body: BlogBodySource
): BlogBodyMediaReferences {
  const canonicalProjection = portableTextMediaProjection(
    body.bodyPortableText
  );
  const rendersCanonical = hasCanonicalPortableTextBody(body);

  const first = rendersCanonical ? canonicalProjection : body.contentJson;
  const second = rendersCanonical ? body.contentJson : canonicalProjection;

  return {
    galleryImageMediaObjectIds: unionInOrder(
      collectRenderableGalleryMediaObjectIds(first),
      collectRenderableGalleryMediaObjectIds(second)
    ),
    videoThumbnailMediaObjectIds: unionInOrder(
      collectRenderableVideoNewsThumbnailMediaObjectIds(first),
      collectRenderableVideoNewsThumbnailMediaObjectIds(second)
    )
  };
}
