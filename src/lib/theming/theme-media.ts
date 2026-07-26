/**
 * Theme asset media resolution composition root (ADR-0034 Fase 3; ported from
 * awcms-micro Issue #269/ADR-0029 §7). Lives in `src/lib` (never inside the
 * module's own `application`/`domain`) because it is where a media adapter would
 * be wired into `theming` — the ports-and-adapters composition-root convention.
 *
 * ## Media resolution is still a NO-OP — but no longer for the original reason
 *
 * awcms-micro resolved a theme config's `assetRefs` (assetSlotKey -> media UUID)
 * to safe, same-tenant, verified public URLs through its `media_library` module's
 * `MediaLibraryPort`. When this seam was written that module was not part of the
 * awcms base (ADR-0034 Fase 3 ported `theming` first), so there was nothing to
 * resolve against and returning an EMPTY map was the honest answer.
 *
 * **`media_library` now EXISTS** (ADR-0036; migrations 041/042/045 and 052-054),
 * and ships a real adapter — `media-library/application/media-library-port-adapter.ts`
 * — already injected at `blog_content` and `news_portal` composition roots. What
 * remains is purely this unwired seam, not a missing dependency.
 *
 * The user-visible consequence, stated plainly so nobody rediscovers it from a
 * bug report: a tenant can upload a logo, the id is stored, and the theme still
 * renders the theme-name fallback in `PublicThemeLayout`, because this function
 * says there are no assets. Stored asset ids remain valid DATA. Wiring the
 * adapter here is a single-file change with no caller churn.
 */
import type { ThemeConfig } from "../../modules/theming/domain/theme-config";

export type ResolvedThemeAsset = { url: string; altText: string | null };

/**
 * Resolve a theme config's `assetRefs` to public URLs. No media module exists in
 * this base yet (see the file header), so this is a documented no-op returning an
 * empty map — every asset slot is omitted from render. The signature keeps the
 * `tx`/`tenantId`/`config` shape so wiring a real media adapter later is a
 * single-file change with no caller churn.
 */
export async function resolveThemeAssetUrls(
  _tx: Bun.SQL,
  _tenantId: string,
  _config: ThemeConfig
): Promise<Record<string, ResolvedThemeAsset>> {
  return {};
}
