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
 * This lives in `news_portal`'s application layer. It reads the media registry
 * by DIRECT import of `media_library`'s `fetchNewsMediaObjectById`/
 * `isNewsMediaObjectSafeForPublicReference` (`media-object-directory.ts`) rather
 * than the injected `MediaLibraryPort` — a deliberate divergence from the port
 * (ADR-0036): this validator needs the media object's own fields (status AND the
 * MIME type, checked against the target placement's allow-list), not the port's
 * safe/unsafe boolean. The direction is legal (domain → System Foundation;
 * `media_library` never imports back). Same shape as
 * `homepage-section-reference-validation.ts`'s `mediaObjectIds` (`gallery_block`)
 * check.
 */
import type {
  AdPlacementKey,
  AdTargetType
} from "../domain/ad-placement-policy";
import { AD_PLACEMENT_PRESETS } from "../domain/ad-placement-policy";
import {
  fetchNewsMediaObjectById,
  isNewsMediaObjectSafeForPublicReference
} from "../../media-library/application/media-object-directory";

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

/**
 * Same shape, for the targeting columns migration 078 added: the domain
 * validator settles the `targetType`/`targetId` PAIRING (which types require
 * an id), this settles whether the id names something real in this tenant.
 *
 * `target_id` is polymorphic — a post, a page, or a widget depending on
 * `target_type` — so there is no foreign key to lean on and no `ON DELETE`
 * behaviour to inherit. That has two consequences worth stating plainly:
 *
 *   - Existence is checked HERE, at write time, and nowhere else. A target
 *     that never existed is a 422 the editor can act on; without this check it
 *     is an ad that renders on no page and reports no error.
 *   - A target deleted LATER is not an error and never becomes one. The render
 *     query joins nothing on `target_id`, so the ad simply stops matching —
 *     degrade, don't error, the same choice `listActiveAdPlacementsForRendering`
 *     makes for a media object that has since been soft-deleted.
 *
 * A soft-deleted target is treated as non-existent: pointing a new ad at an
 * article that is already in the bin is a mistake worth reporting, not a state
 * worth preserving. Cross-tenant references cannot pass — the queries run
 * inside the caller's tenant-scoped transaction with an explicit `tenant_id`
 * predicate, and FORCE'd RLS behind it.
 */
export async function validateAdPlacementTargetReference(
  tx: Bun.SQL,
  tenantId: string,
  targetType: AdTargetType,
  targetId: string | null
): Promise<AdPlacementReferenceValidationResult> {
  if (targetType === "global" || targetId === null) {
    return { valid: true };
  }

  const rows =
    targetType === "post"
      ? await tx`
          SELECT 1 FROM awcms_blog_posts
          WHERE tenant_id = ${tenantId} AND id = ${targetId} AND deleted_at IS NULL
        `
      : targetType === "page"
        ? await tx`
            SELECT 1 FROM awcms_blog_pages
            WHERE tenant_id = ${tenantId} AND id = ${targetId} AND deleted_at IS NULL
          `
        : await tx`
            SELECT 1 FROM awcms_blog_widgets
            WHERE tenant_id = ${tenantId} AND id = ${targetId} AND deleted_at IS NULL
          `;

  if (rows.length === 0) {
    return {
      valid: false,
      errors: [
        {
          field: "targetId",
          message: `targetId "${targetId}" does not name an existing ${targetType} in this tenant.`
        }
      ]
    };
  }

  return { valid: true };
}
