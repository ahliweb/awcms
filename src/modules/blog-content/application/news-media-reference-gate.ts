/**
 * Application-layer enforcement of Issue #636 (epic `news_portal`): when
 * full-online R2-only mode is active for the tenant making a request,
 * `featuredMediaId` and every image-gallery block item must reference an
 * existing, same-tenant, `verified`/`attached` row in the news media
 * registry (Issue #633) — never a raw URL, never another tenant's object,
 * never an unverified/failed/orphaned/deleted one.
 *
 * Deliberately NOT part of the pure validators in `blog-post-validation.ts`/
 * `blog-page-validation.ts` — this needs a real database round trip, so it
 * follows the exact same convention `countExistingTerms` already
 * established for `termIds` (Issue #539): shape-only checks stay in the
 * pure validator, existence/ownership checks run here, called from the
 * route handler AFTER pure validation passes and BEFORE the post/page is
 * written — so a request that fails this check never creates a
 * partially-written row.
 *
 * When full-online R2-only mode is NOT active for the tenant (the
 * overwhelming majority of deployments/tenants today), this entire check
 * is a no-op — `featuredMediaId`/gallery `url` fields keep their existing,
 * unchanged, pre-#636 behavior. This is intentionally conditional, not a
 * blanket tightening of `blog_content` itself (issue's own "Security
 * notes": enforce hard in R2-only mode, but the mode itself stays opt-in).
 *
 * Issue #681 (epic #679, platform-hardening) — this file previously
 * imported `news-portal/application/news-media-object-directory.ts` and
 * `news-portal/application/news-portal-tenant-state.ts`/`domain/
 * news-portal-preset-readiness.ts` (via `news-portal-r2-mode-gate.ts`)
 * directly, a genuine `blog_content` application-layer import of
 * `news_portal`'s implementation. Both are now accessed only through
 * `_shared/ports/news-media-port.ts`'s `NewsMediaPort` interface, injected
 * by the caller — the route handler (composition root) imports the
 * concrete adapter (`news-portal/application/news-media-port-adapter.ts`)
 * and passes it in. `resolveVerifiedNewsMediaReferences` (the render-time
 * resolution half of this file, before this issue) is GONE — every caller
 * (this module's own public detail routes, `news_portal`'s homepage
 * composer) now calls `NewsMediaPort.resolveMediaReferences` directly,
 * since that IS the port's own capability with nothing left for this file
 * to add on top.
 */
import {
  collectGalleryImageReferences,
  type GalleryImageReferenceViolation
} from "../domain/content-block-media-references";
import type { NewsMediaPort } from "../../_shared/ports/news-media-port";

export type NewsMediaReferenceValidationError = {
  field: string;
  message: string;
};

export type NewsMediaReferenceValidationResult =
  | { valid: true }
  | { valid: false; errors: NewsMediaReferenceValidationError[] };

function violationMessage(violation: GalleryImageReferenceViolation): string {
  const prefix = `contentJson.blocks[].items[${violation.itemIndex}]`;

  if (violation.reason === "raw_url_not_allowed") {
    return `${prefix}: image gallery items must use "mediaObjectId" (a verified R2 media object), not a raw "url", in full-online R2-only mode.`;
  }

  return `${prefix}: image gallery items require a valid "mediaObjectId" (UUID) in full-online R2-only mode.`;
}

/**
 * Runs inside the caller's own tenant-scoped transaction (same `tx` the
 * route handler already opened via `withTenant`). `mediaPort` is the
 * caller-injected `NewsMediaPort` implementation — every existence check
 * below is naturally tenant-scoped by the port's own `tenantId` parameter,
 * so a cross-tenant `mediaObjectId` simply resolves to "unsafe", never
 * leaking whether the id belongs to a different tenant.
 */
export async function validateNewsMediaReferencesForFullOnlineR2Mode(
  tx: Bun.SQL,
  tenantId: string,
  input: {
    featuredMediaId: string | null | undefined;
    /** Issue #649 — same existence/ownership/verified-status check as `featuredMediaId`, for the explicit SEO/social preview image override. */
    seoImageMediaId?: string | null | undefined;
    contentJson: Record<string, unknown> | undefined;
  },
  mediaPort: NewsMediaPort,
  env: NodeJS.ProcessEnv = process.env
): Promise<NewsMediaReferenceValidationResult> {
  const modeActive = await mediaPort.isFullOnlineR2ModeActiveForTenant(
    tx,
    tenantId,
    env
  );

  if (!modeActive) {
    return { valid: true };
  }

  const errors: NewsMediaReferenceValidationError[] = [];

  if (input.featuredMediaId) {
    const safe = await mediaPort.isMediaReferenceSafe(
      tx,
      tenantId,
      input.featuredMediaId
    );

    if (!safe) {
      errors.push({
        field: "featuredMediaId",
        message:
          "featuredMediaId must reference an existing, verified R2 media object belonging to this tenant in full-online R2-only mode."
      });
    }
  }

  if (input.seoImageMediaId) {
    const safe = await mediaPort.isMediaReferenceSafe(
      tx,
      tenantId,
      input.seoImageMediaId
    );

    if (!safe) {
      errors.push({
        field: "seoImageMediaId",
        message:
          "seoImageMediaId must reference an existing, verified R2 media object belonging to this tenant in full-online R2-only mode."
      });
    }
  }

  if (input.contentJson) {
    const { mediaObjectIds, violations } = collectGalleryImageReferences(
      input.contentJson
    );

    for (const violation of violations) {
      errors.push({
        field: "contentJson",
        message: violationMessage(violation)
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
          message: `contentJson references mediaObjectId "${mediaObjectId}" which does not exist, does not belong to this tenant, or is not a verified R2 media object.`
        });
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}
