/**
 * Theme asset media resolution composition root (ADR-0034 Fase 3; ported from
 * awcms-micro Issue #269/ADR-0029 §7). Lives in `src/lib` (never inside the
 * module's own `application`/`domain`) because it is where a media adapter would
 * be wired into `theming` — the ports-and-adapters composition-root convention.
 *
 * ## Port adaptation: media resolution is a NO-OP in this base
 *
 * awcms-micro resolved a theme config's `assetRefs` (assetSlotKey -> media UUID)
 * to safe, same-tenant, verified public URLs through its `media_library` module's
 * `MediaLibraryPort`. That module is NOT part of the awcms base (ADR-0034 Fase 3
 * ports only `theming` first), so there is nothing to resolve against. Rather
 * than import a module that does not exist, this returns an EMPTY map: every
 * asset slot is simply omitted from render and the theme degrades safely (a null
 * logo renders the theme-name fallback in `PublicThemeLayout`). Stored asset ids
 * remain valid DATA; only their URL resolution is deferred until a media module
 * is ported, at which point this seam is the single place to wire it in.
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
