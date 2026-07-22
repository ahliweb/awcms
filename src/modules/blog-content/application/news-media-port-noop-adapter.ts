/**
 * PORT-TIME ADDITION (not present in awcms-mini) — a no-op `NewsMediaPort`
 * implementation, injected at every composition root (route handler /
 * `blog:publish:scheduled` worker) inside this module instead of
 * `news-portal/application/news-media-port-adapter.ts`'s concrete adapter.
 *
 * `news_portal` is NOT ported to this base yet, so there is no
 * `awcms_news_media_objects` registry, no full-online-R2-only-mode preset,
 * and no real media object to ever resolve. Every method below reports the
 * exact same "capability not present" answer a genuinely-disabled
 * `news_portal` deployment already produces for a mini tenant that never
 * enabled it:
 *
 *  - `isFullOnlineR2ModeActiveForTenant` -> always `false`. Every caller
 *    (`news-media-reference-gate.ts`, `video-news-thumbnail-reference-
 *    gate.ts`, `content-quality-checklist-gate.ts`) treats `false` as "this
 *    entire check is a no-op" — featured/gallery/thumbnail image references
 *    keep their pre-#636 unchanged behavior (any string id is accepted,
 *    never fetched against a media registry that does not exist).
 *  - `isMediaReferenceSafe` -> always `false` (fail-closed default; never
 *    actually reached in practice since the mode check above always short-
 *    circuits first).
 *  - `resolveMediaReferences` -> always an empty map. Callers that resolve
 *    unconditionally for rendering (`news-article-seo-metadata.ts`) treat a
 *    missing id as "no image available" — the honest answer when there is
 *    no media registry to resolve against, never a fabricated URL.
 *  - `resolveMediaPublicBaseUrl` -> `""`, the port's own documented
 *    "unset" value.
 *
 * Swapping this for the real `news-portal` adapter, once that module is
 * ported, is a pure composition-root change — no file in this module needs
 * to change (every call site already takes the port as an injected
 * parameter, never imports an implementation itself).
 */
import type {
  NewsMediaPort,
  ResolvedNewsMediaReferenceDTO
} from "../../_shared/ports/news-media-port";

export const noopNewsMediaPortAdapter: NewsMediaPort = {
  async isFullOnlineR2ModeActiveForTenant(): Promise<boolean> {
    return false;
  },

  async isMediaReferenceSafe(): Promise<boolean> {
    return false;
  },

  async resolveMediaReferences(): Promise<
    ReadonlyMap<string, ResolvedNewsMediaReferenceDTO>
  > {
    return new Map();
  },

  resolveMediaPublicBaseUrl(): string {
    return "";
  }
};
