/**
 * Composition root for the public SEO discovery routes (ADR-0038 §3)
 * — the ONE place that wires content-module `seo_facts` providers and the
 * `media_library` port into `seo_distribution`'s aggregator. Lives in `src/lib`
 * (not inside any module's `application`/`domain`) precisely because a
 * composition root is allowed to know about concrete modules, whereas
 * `seo_distribution`'s own layers must not import a content module (the
 * ports-and-adapters rule the boundary tests enforce). Same role the `/blog/{tenantCode}`
 * route files' inline imports play, factored into one function so all six
 * discovery routes wire providers identically.
 *
 * Providers are included ONLY when the tenant has the owning module enabled:
 * `blog_content` (the single declared `seo_facts` provider) contributes its
 * adapter when enabled; `media_library` supplies the image port when enabled.
 * A tenant with a content module disabled simply contributes no facts / no
 * images — the aggregator degrades safely (`consumes` optional, ADR-0038 §2).
 */
import {
  fetchEffectivePublicRouteSettings,
  resolvePublicContentBasePath
} from "../../blog-content/application/public-route-settings";
import { createBlogContentSeoFactsAdapter } from "../../blog-content/application/seo-facts-port-adapter";
import { mediaLibraryPortAdapter } from "../../media-library/application/media-library-port-adapter";
import { fetchTenantModuleEntry } from "../../module-management/application/tenant-module-lifecycle";
import type { MediaLibraryPort } from "../../_shared/ports/media-library-port";
import type { SeoFactsSource } from "../../_shared/ports/seo-facts-port";

export type EnabledSeoProviders = {
  providers: SeoFactsSource[];
  mediaLibrary: MediaLibraryPort | null;
};

const BLOG_CONTENT_MODULE_KEY = "blog_content";
const MEDIA_LIBRARY_MODULE_KEY = "media_library";

/**
 * Resolve the `seo_facts` providers + media port enabled for `tenantId`. Runs
 * inside the caller's tenant transaction. Fail-closed: a missing tenant-module
 * entry (module not enabled) contributes nothing rather than defaulting on.
 *
 * ## The base path is chosen, never assumed (ADR-0059 §C)
 *
 * `blog_content` serves its public content through TWO route families —
 * host-resolved `/news/**` and path-based `/blog/{tenantCode}/**` (ADR-0009) —
 * each with its own per-tenant switch. `resolvePublicContentBasePath` picks the
 * one that will actually answer, and returns `null` when a tenant has switched
 * BOTH off. `null` contributes NO provider: a tenant with no public content URL
 * gets an empty sitemap/feed rather than one full of links that are certain to
 * 404, which is the invariant this whole composition root exists to hold.
 *
 * Both this pipeline and `/news/**` resolve their tenant with the same
 * host resolver, so the two can never disagree about which tenant a request is
 * for.
 */
export async function resolveEnabledSeoProviders(
  tx: Bun.TransactionSQL,
  tenantId: string,
  tenantCode: string
): Promise<EnabledSeoProviders> {
  // Sequential, not Promise.all: concurrent queries on one tx connection leak it (idle in transaction).
  const blogEntry = await fetchTenantModuleEntry(
    tx,
    tenantId,
    BLOG_CONTENT_MODULE_KEY
  );
  const mediaEntry = await fetchTenantModuleEntry(
    tx,
    tenantId,
    MEDIA_LIBRARY_MODULE_KEY
  );

  const providers: SeoFactsSource[] = [];
  if (blogEntry?.tenantEnabled ?? false) {
    const routeSettings = await fetchEffectivePublicRouteSettings(tx, tenantId);
    const basePath = resolvePublicContentBasePath(routeSettings, tenantCode);

    if (basePath !== null) {
      providers.push(createBlogContentSeoFactsAdapter(basePath));
    }
  }

  const mediaLibrary =
    (mediaEntry?.tenantEnabled ?? false) ? mediaLibraryPortAdapter : null;

  return { providers, mediaLibrary };
}
