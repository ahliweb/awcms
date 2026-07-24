/**
 * Social/SEO preview image source-priority resolution (Issue #649, epic
 * `news_portal`). Pure function — takes candidate media object ids plus the
 * SET of ids that already resolved safely (`MediaLibraryPort.resolveMediaReferences`'s
 * result keys: existing, same-tenant, `verified`/`attached` R2 objects only)
 * and returns the FIRST candidate, in priority order, that is actually safe
 * to use. Never does its own database round trip or R2 verification — that
 * stays the caller's job (the render route/checklist gate), reusing the
 * SAME bulk resolution Issue #636 already established for featured/gallery
 * images, never re-deriving it here.
 *
 * Issue body's "Metadata source priority" (image):
 *   1. explicit SEO/social preview image media object (`seoImageMediaId`)
 *   2. featured image media object (`featuredMediaId`)
 *   3. first verified R2 image in content, if tenant policy allows
 *      (`contentImageMediaIds`, in document order — the caller passes an
 *      EMPTY array when the tenant has disabled this fallback, rather than
 *      this function taking a policy flag itself, so it stays a pure id-only
 *      priority chain)
 *   4. tenant-level R2 fallback social image (`tenantFallbackImageMediaId`)
 *
 * A candidate that is present but did NOT resolve safely (missing,
 * cross-tenant, wrong status) is simply skipped — the chain falls through to
 * the next source, it never throws or stops early. This mirrors every other
 * "unsafe reference is silently absent from the resolved map, never thrown"
 * convention this epic already uses (`resolveOgImageUrl`,
 * `content-quality-checklist-gate.ts`).
 */
export type SocialPreviewImageCandidates = {
  explicitSocialImageMediaId: string | null;
  featuredMediaId: string | null;
  /** Ordered by document position. Pass `[]` (not the full list) when the tenant has disabled the content-image fallback — this function has no separate policy parameter by design. */
  contentImageMediaIds: readonly string[];
  tenantFallbackImageMediaId: string | null;
};

/**
 * Returns the first candidate id, in priority order, present in
 * `resolvedMediaIds` — or `null` if none of the candidates resolved safely
 * (the caller then omits `og:image`/`twitter:image`/JSON-LD `image`
 * entirely, per Issue #636's "no trusted source, no image tag" convention).
 */
export function resolveSocialPreviewImageSourceId(
  candidates: SocialPreviewImageCandidates,
  resolvedMediaIds: ReadonlySet<string>
): string | null {
  const orderedCandidates = [
    candidates.explicitSocialImageMediaId,
    candidates.featuredMediaId,
    ...candidates.contentImageMediaIds,
    candidates.tenantFallbackImageMediaId
  ];

  for (const candidateId of orderedCandidates) {
    if (candidateId && resolvedMediaIds.has(candidateId)) {
      return candidateId;
    }
  }

  return null;
}
