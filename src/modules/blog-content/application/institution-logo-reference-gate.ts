/**
 * Application-layer enforcement of Issue #806: when full-online R2-only mode
 * is active for the tenant making a request, `logoMediaId` on an institution
 * must reference an existing, same-tenant, `verified`/`attached` row in the
 * media registry — never another tenant's object, never an unverified/
 * failed/orphaned/deleted one.
 *
 * Deliberately its own tiny file rather than a case added to
 * `news-media-reference-gate.ts`: that file's `validateNewsMediaReferencesForFullOnlineR2Mode`
 * is post/page-shaped (`featuredMediaId`/`seoImageMediaId`/`contentJson`
 * gallery blocks) and is called on every post/page write, a MUCH hotter path
 * than an institution write (an editorial-config resource created rarely,
 * per PRD LenteraKalteng §12.2's own "fifteen DPRDs and fifteen regional
 * governments" scale). Folding a fourth, institution-shaped field into that
 * function's `input` type would make every post/page caller's payload build
 * a `logoMediaId: undefined` it can never have, for a resource the function
 * has no other reason to know about. Same posture `video-news-thumbnail-reference-gate.ts`
 * already takes for its own single-field, single-resource-shape check.
 *
 * Same call convention: runs inside the caller's own tenant-scoped
 * transaction (the route handler's `tx`), gated by the injected
 * `MediaLibraryPort`, called AFTER pure validation
 * (`institution-validation.ts`) passes and BEFORE the institution row is
 * written — so a request that fails this check never creates/updates a
 * partially-written row.
 *
 * When full-online R2-only mode is NOT active for the tenant (the
 * overwhelming majority of deployments/tenants today), this check is a
 * no-op — `logoMediaId` keeps its shape-only, no-existence-check behavior,
 * identical to `featuredMediaId` pre-#636.
 */
import type { MediaLibraryPort } from "../../_shared/ports/media-library-port";

export type InstitutionLogoReferenceValidationError = {
  field: string;
  message: string;
};

export type InstitutionLogoReferenceValidationResult =
  | { valid: true }
  | { valid: false; errors: InstitutionLogoReferenceValidationError[] };

export async function validateInstitutionLogoReferenceForFullOnlineR2Mode(
  tx: Bun.SQL,
  tenantId: string,
  logoMediaId: string | null | undefined,
  mediaPort: MediaLibraryPort,
  env: NodeJS.ProcessEnv = process.env
): Promise<InstitutionLogoReferenceValidationResult> {
  if (!logoMediaId) {
    return { valid: true };
  }

  const modeActive = await mediaPort.isManagedMediaEnforcementActiveForTenant(
    tx,
    tenantId,
    env
  );

  if (!modeActive) {
    return { valid: true };
  }

  const safe = await mediaPort.isMediaReferenceSafe(tx, tenantId, logoMediaId);

  if (safe) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: [
      {
        field: "logoMediaId",
        message:
          "logoMediaId must reference an existing, verified R2 media object belonging to this tenant in full-online R2-only mode."
      }
    ]
  };
}
