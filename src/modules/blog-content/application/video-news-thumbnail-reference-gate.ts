import { collectVideoNewsThumbnailReferences } from "../domain/content-block-media-references";
import type { NewsMediaPort } from "../../_shared/ports/news-media-port";

/**
 * Sibling to `news-media-reference-gate.ts`'s
 * `validateNewsMediaReferencesForFullOnlineR2Mode` (Issue #636) for the
 * `video_news` block's `thumbnailMediaObjectId` (Issue #639) — deliberately
 * kept as an entirely separate function/file rather than folding into that
 * one, so this issue's changes never touch #636's already-reviewed gate
 * function body (reduces merge-collision surface with any other in-flight
 * issue also extending content-block validation).
 *
 * Same mode-gating convention as #636: a no-op when full-online R2-only
 * mode is not active for the tenant. A custom thumbnail is OPTIONAL per the
 * issue's own Rules ("Tenant policy may optionally allow provider default
 * thumbnail") — even when the mode IS active, a `video_news` block with no
 * `thumbnailMediaObjectId` at all is valid; only a PRESENT reference must
 * resolve to a verified, same-tenant, non-deleted media object.
 */
export type VideoNewsThumbnailReferenceValidationError = {
  field: string;
  message: string;
};

export type VideoNewsThumbnailReferenceValidationResult =
  | { valid: true }
  | { valid: false; errors: VideoNewsThumbnailReferenceValidationError[] };

export async function validateVideoNewsThumbnailReferencesForFullOnlineR2Mode(
  tx: Bun.SQL,
  tenantId: string,
  contentJson: Record<string, unknown> | undefined,
  mediaPort: NewsMediaPort,
  env: NodeJS.ProcessEnv = process.env
): Promise<VideoNewsThumbnailReferenceValidationResult> {
  if (!contentJson) {
    return { valid: true };
  }

  const modeActive = await mediaPort.isFullOnlineR2ModeActiveForTenant(
    tx,
    tenantId,
    env
  );

  if (!modeActive) {
    return { valid: true };
  }

  const { mediaObjectIds, violations } =
    collectVideoNewsThumbnailReferences(contentJson);

  const errors: VideoNewsThumbnailReferenceValidationError[] = [];

  for (const violation of violations) {
    errors.push({
      field: "contentJson",
      message: `contentJson.blocks[${violation.blockIndex}].thumbnailMediaObjectId must be a valid UUID referencing a verified R2 media object in full-online R2-only mode.`
    });
  }

  for (const mediaObjectId of mediaObjectIds) {
    const safe = await mediaPort.isMediaReferenceSafe(
      tx,
      tenantId,
      mediaObjectId
    );

    if (!safe) {
      errors.push({
        field: "contentJson",
        message: `contentJson references thumbnailMediaObjectId "${mediaObjectId}" which does not exist, does not belong to this tenant, or is not a verified R2 media object.`
      });
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
