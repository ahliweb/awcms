/**
 * Application-layer existence/ownership/safety check for a news portal ad
 * placement's `mediaObjectId` (Issue #638) — the domain validator
 * (`../domain/ad-placement-policy.ts`) only checks shape (well-formed
 * UUID); this checks that the referenced media object actually exists,
 * belongs to the SAME tenant, is a verified/attached R2 object safe to
 * reference publicly, and (defense in depth) has a MIME type the target
 * placement allows. Same "shape in the pure validator, existence in an
 * application-layer gate called right before write" convention
 * `news-media-reference-gate.ts` (Issue #636) and `homepage-section-
 * reference-validation.ts` (Issue #637) already established.
 *
 * Unlike `blog_content`'s Issue #636 gate, this is deliberately
 * UNCONDITIONAL — no full-online-R2-mode check — for the exact same reason
 * `homepage-section-reference-validation.ts` is unconditional: this is a
 * brand-new table with zero pre-existing rows, so there is no legacy
 * free-URL shape to stay backward compatible with (see migration 048's
 * header comment).
 *
 * This lives in `news_portal`'s OWN application layer, not behind a
 * `_shared/ports/` capability — `fetchNewsMediaObjectById`/
 * `isNewsMediaObjectSafeForPublicReference` are this module's OWN code
 * (`news-media-object-directory.ts`, Issue #633), not a cross-module
 * import, exactly like `homepage-section-reference-validation.ts`'s
 * `mediaObjectIds` (`gallery_block`) check.
 */
import type { AdPlacementKey } from "../domain/ad-placement-policy";
import { AD_PLACEMENT_PRESETS } from "../domain/ad-placement-policy";
import {
  fetchNewsMediaObjectById,
  isNewsMediaObjectSafeForPublicReference
} from "./news-media-object-directory";

export type AdPlacementReferenceValidationError = {
  field: string;
  message: string;
};

export type AdPlacementReferenceValidationResult =
  | { valid: true }
  | { valid: false; errors: AdPlacementReferenceValidationError[] };

/** Runs inside the caller's own tenant-scoped transaction (the route handler's `withTenant` `tx`). */
export async function validateAdPlacementMediaReference(
  tx: Bun.SQL,
  tenantId: string,
  mediaObjectId: string,
  placementKey: AdPlacementKey
): Promise<AdPlacementReferenceValidationResult> {
  const media = await fetchNewsMediaObjectById(tx, tenantId, mediaObjectId);

  if (!media || !isNewsMediaObjectSafeForPublicReference(media.status)) {
    return {
      valid: false,
      errors: [
        {
          field: "mediaObjectId",
          message: `mediaObjectId "${mediaObjectId}" does not exist, does not belong to this tenant, or is not a verified R2 media object.`
        }
      ]
    };
  }

  const preset = AD_PLACEMENT_PRESETS[placementKey];

  if (!preset.allowedMediaTypes.includes(media.mimeType)) {
    return {
      valid: false,
      errors: [
        {
          field: "mediaObjectId",
          message: `mediaObjectId "${mediaObjectId}" has mime type "${media.mimeType}", which is not allowed for placement "${placementKey}" (allowed: ${preset.allowedMediaTypes.join(", ")}).`
        }
      ]
    };
  }

  return { valid: true };
}
