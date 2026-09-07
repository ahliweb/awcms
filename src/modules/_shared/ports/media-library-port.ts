/**
 * `MediaLibraryPort` (ADR-0036 ownership inversion) — the capability
 * `media_library` PROVIDES and `blog_content`/`news_portal`/`social_publishing`
 * consume: whether managed-media enforcement is active for a tenant, and whether
 * a given media object id is a verified, same-tenant, safe-to-reference object.
 *
 * Supersedes `news-media-port.ts`'s `NewsMediaPort`, which this replaces
 * entirely. Same neutral-ground rule as every other port here: this file imports
 * NOTHING from any module, so consumers depend on the TYPE without depending on
 * an implementation.
 *
 * ## What actually changed, and why it is not just a rename
 *
 * `NewsMediaPort` was declared as a capability `news_portal` provides, but two
 * of its three domain methods (`isMediaReferenceSafe`, `resolveMediaReferences`)
 * were implemented purely by calling the media registry — `news_portal` provided
 * them only because the registry used to live inside it (the ownership inversion
 * moved it out). The third, `isFullOnlineR2ModeActiveForTenant`, was the
 * genuinely news_portal-shaped one: it asked "is my editorial R2-only preset on
 * for this tenant". Bundling the three meant the media capability could not be
 * consumed without `news_portal` implementing it.
 *
 * That bundling had a product consequence, not just an architectural one: a
 * brochure-site tenant (`blog_content` + `tenant_domain`, no news portal) got NO
 * managed media at all, because the gate keyed on a mode only `news_portal`
 * could turn on. See ADR-0036 and `sql/053`'s header.
 *
 * So the news_portal-shaped method is not carried over.
 * `isManagedMediaEnforcementActiveForTenant` below replaces it and asks a
 * strictly MEDIA question — "must this tenant's media references be
 * registry-backed?" — answered from `media_library`'s own deployment readiness
 * (`domain/managed-media-readiness.ts`) and its own per-tenant flag
 * (`application/media-library-tenant-state.ts`, `sql/053`). `news_portal`'s
 * R2-only preset (where ported) becomes ONE writer of that flag rather than its
 * owner, which is what lets a tenant have managed media without a news portal.
 *
 * `NewsMediaPort`'s fourth method `resolveMediaPublicBaseUrl` (a pure
 * `social_publishing`-only config read) is also dropped: this base has no
 * `social_publishing` consumer for it.
 */
export type ResolvedMediaReferenceDTO = {
  publicUrl: string;
  altText: string | null;
  /**
   * Metadata fields (content quality checklist, Issue #640) — sourced verbatim
   * from the media registry row; present whenever the id resolves at all (the
   * map never contains an unsafe/nonexistent id in the first place).
   */
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  /**
   * Credit/rights fields (Issue #782) — a news site's legal/reputational
   * obligation to show who a photo is credited to. Unlike `mimeType`/`width`/
   * `height`/`sizeBytes` above, these are NOT sourced verbatim: the concrete
   * adapter populates all three ONLY when the source object's internal
   * `rightsVerificationStatus` is `'verified'`. On anything else
   * (`'unverified'`, `'rejected'`) they come back `null` here — fail-closed,
   * never a partial/best-effort value — even if the underlying row has
   * non-null `creditLine`/`sourceName`/`copyrightStatus`. This DTO
   * deliberately carries no `rightsVerificationStatus` field of its own (a
   * consumer has no business decision to make from it — the gate has already
   * been applied) and no `rightsVerifiedBy`/`rightsVerifiedAt`/`rightsNotes`
   * at all: the first pair names an internal reviewer and a review moment
   * (same posture ADR-0109 took for publishing a byline — an internal
   * identity must never cross into a public surface as a side effect), and
   * the second can carry licensing/contact terms that are editorial-internal,
   * not a credit. See `media-library`'s
   * `domain/media-rights-policy.ts#resolvePublicMediaRightsFields` for the
   * full rationale — this shape is intentionally its OWN, not a re-export of
   * that module's `CopyrightStatus`/`RightsVerificationStatus` types (same
   * "port depends on neither" rule as every other DTO in this file), so keep
   * the literal union below in sync with `COPYRIGHT_STATUSES` by hand.
   */
  creditLine: string | null;
  sourceName: string | null;
  copyrightStatus:
    | "unknown"
    | "owned"
    | "licensed"
    | "public_domain"
    | "permission_granted"
    | "fair_use"
    | null;
};

export type MediaLibraryPort = {
  /**
   * `true` only when managed-media enforcement is genuinely active for
   * `tenantId` — the deployment's media R2 config is complete and separated AND
   * the tenant has opted in. Fail-closed on every ambiguous case.
   *
   * Deliberately NOT named after R2 or any preset: callers gate content
   * validation on "must references be managed", and which storage driver or
   * which preset produced that state is none of their business.
   */
  isManagedMediaEnforcementActiveForTenant(
    tx: Bun.SQL,
    tenantId: string,
    env?: NodeJS.ProcessEnv
  ): Promise<boolean>;

  /** `true` only if `mediaObjectId` exists, belongs to `tenantId`, and is `verified`/`attached`. */
  isMediaReferenceSafe(
    tx: Bun.SQL,
    tenantId: string,
    mediaObjectId: string
  ): Promise<boolean>;

  /** Resolves every id that IS safe (see above) to its public URL/alt text; unsafe/nonexistent/cross-tenant ids are simply absent from the result — never thrown. */
  resolveMediaReferences(
    tx: Bun.SQL,
    tenantId: string,
    mediaObjectIds: readonly string[]
  ): Promise<ReadonlyMap<string, ResolvedMediaReferenceDTO>>;
};
