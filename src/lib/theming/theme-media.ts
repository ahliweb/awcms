/**
 * Theme asset media resolution composition root (ADR-0034 Fase 3; ported from
 * awcms-micro Issue #269/ADR-0029 §7). Lives in `src/lib` (never inside the
 * module's own `application`/`domain`) because it is where the media adapter is
 * wired into `theming` — the ports-and-adapters composition-root convention.
 *
 * ## What this used to do, and why it changed
 *
 * This returned an EMPTY map. When the seam was written that was honest:
 * ADR-0034 Fase 3 ported `theming` first and there was no media module to
 * resolve against. The header said so, and stayed saying so after ADR-0036
 * landed `media_library` — so the no-op read as a deliberate design rather than
 * an unfinished wire, and the consequence went unnoticed: a tenant could upload
 * a logo, the id was stored and valid, and `PublicThemeLayout` rendered the
 * theme-name fallback forever, because this function reported no assets.
 *
 * It now resolves through `MediaLibraryPort`, the same capability
 * `blog_content` and `news_portal` already consume.
 *
 * ## Safety comes from the port, not from here
 *
 * `resolveMediaReferences` returns entries ONLY for ids that exist, belong to
 * this tenant, and are `verified`/`attached`. An unsafe, cross-tenant, or
 * deleted id is simply absent from the map — never thrown. So the degradation
 * this function was already designed around is preserved exactly: an
 * unresolvable slot is omitted and the theme falls back, which matters because
 * a theme is public-facing and must not 500 on a stale asset id.
 *
 * That also means this file performs no validation of its own. Adding an
 * ownership or status check here would duplicate the port's contract in a
 * second place that could drift from it.
 */
import type { MediaLibraryPort } from "../../modules/_shared/ports/media-library-port";
import { mediaLibraryPortAdapter } from "../../modules/media-library/application/media-library-port-adapter";
import type { ThemeConfig } from "../../modules/theming/domain/theme-config";

export type ResolvedThemeAsset = { url: string; altText: string | null };

/**
 * Resolve a theme config's `assetRefs` (assetSlotKey -> media object id) to
 * public URLs, keyed by slot.
 *
 * `media` is injectable and defaults to the real adapter: this is the
 * composition root, so the default belongs here, while tests can drive the
 * omission paths (unsafe id, cross-tenant id, empty config) without a database.
 * A slot whose id does not resolve is omitted from the result.
 */
export async function resolveThemeAssetUrls(
  tx: Bun.SQL,
  tenantId: string,
  config: ThemeConfig,
  media: MediaLibraryPort = mediaLibraryPortAdapter
): Promise<Record<string, ResolvedThemeAsset>> {
  const slots = Object.entries(config.assetRefs ?? {}).filter(
    ([, mediaObjectId]) => typeof mediaObjectId === "string" && mediaObjectId
  );

  // Skip the round trip entirely for the common case — most themes set no
  // assets at all, and every public page render passes through here.
  if (slots.length === 0) {
    return {};
  }

  const resolved = await media.resolveMediaReferences(
    tx,
    tenantId,
    // De-duplicated: two slots may legitimately point at the same object (a
    // logo reused as favicon), and the port should not be asked twice.
    [...new Set(slots.map(([, mediaObjectId]) => mediaObjectId))]
  );

  const assets: Record<string, ResolvedThemeAsset> = {};

  for (const [slotKey, mediaObjectId] of slots) {
    const reference = resolved.get(mediaObjectId);

    if (reference) {
      assets[slotKey] = {
        url: reference.publicUrl,
        altText: reference.altText
      };
    }
  }

  return assets;
}
