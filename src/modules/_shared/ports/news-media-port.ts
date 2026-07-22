/**
 * `NewsMediaPort` (Issue #681, epic #679 platform-hardening) — the
 * capability `blog_content` consumes from `news_portal`: whether
 * full-online R2-only mode is active for a tenant, and whether a given
 * media object id is a verified, same-tenant, safe-to-reference R2
 * object. This interface lives in neutral ground (`_shared`, imports
 * NOTHING from either module) so `blog_content`'s application layer can
 * depend on the TYPE without depending on `news_portal`'s implementation.
 *
 * The concrete implementation
 * (`news-portal/application/news-media-port-adapter.ts`) is wired at the
 * composition root — every route handler that needs this capability
 * imports the concrete adapter and passes it into the `blog_content`
 * function that needs it (`news-media-reference-gate.ts`). Neither
 * `blog_content` nor `news_portal`'s own `application`/`domain` files
 * import the other's implementation directly; only this port type and
 * `PublicContentPort` (the mirror-image capability, `news_portal`
 * consuming `blog_content`) cross the module boundary, and only as pure
 * types.
 *
 * Before this issue, `blog-content/application/news-portal-r2-mode-gate.ts`
 * and `blog-content/application/news-media-reference-gate.ts` imported
 * `news-portal/application/news-portal-tenant-state.ts`,
 * `news-portal/domain/news-portal-preset-readiness.ts`, and
 * `news-portal/application/news-media-object-directory.ts` directly — see
 * `news-media-port-adapter.ts`'s header for the full "three failed
 * attempts" history behind `isFullOnlineR2ModeActiveForTenant`, preserved
 * there rather than lost in this extraction.
 */
export type ResolvedNewsMediaReferenceDTO = {
  publicUrl: string;
  altText: string | null;
  /**
   * Metadata fields added by Issue #640 (content quality checklist) —
   * purely additive, every existing caller (render-time gallery/featured
   * image resolution) already destructures only `publicUrl`/`altText` and
   * is unaffected. Sourced verbatim from the news media registry row
   * (Issue #633); present whenever the id resolves at all (the map never
   * contains an unsafe/nonexistent id in the first place, same as before).
   */
  mimeType: string;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
};

export type NewsMediaPort = {
  /**
   * `true` only when full-online R2-only mode is genuinely active for
   * `tenantId` (deployment env configured AND tenant applied the preset).
   * Fail-closed on every ambiguous case.
   */
  isFullOnlineR2ModeActiveForTenant(
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
  ): Promise<ReadonlyMap<string, ResolvedNewsMediaReferenceDTO>>;

  /**
   * The deployment-configured public base URL that verified news-media R2
   * objects are served from (empty string when unset). A PURE config read —
   * no DB, no tenant scope — the config-resolution half of the `news_media`
   * capability, deliberately synchronous so a consumer can call it inline in
   * a hot path. Lets a consumer recognise a URL that genuinely originated
   * from this deployment's own trusted R2 bucket (e.g. the LinkedIn provider
   * adapter's last-mile "is this image safe to hand a third-party API"
   * defense-in-depth check) WITHOUT statically importing `news_portal`'s
   * config module.
   *
   * Issue #859 (epic #818): that static import
   * (`social-publishing/infrastructure/linkedin-provider-adapter.ts` ->
   * `news-portal/domain/news-media-r2-config.ts`'s `resolveNewsMediaR2Config`)
   * was the SOLE reason `social_publishing` had to declare `news_portal` a
   * HARD lifecycle dependency, directly contradicting its own
   * `capabilities.consumes` (`news_media`, `optional: true`). Routing it
   * through this port (injected at the composition root, exactly like
   * `resolveMediaReferences`) makes `news_portal` genuinely optional/
   * disableable per tenant again.
   */
  resolveMediaPublicBaseUrl(env?: NodeJS.ProcessEnv): string;
};
