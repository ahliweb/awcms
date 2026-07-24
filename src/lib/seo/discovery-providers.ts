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
import { blogContentSeoFactsAdapter } from "../../modules/blog-content/application/seo-facts-port-adapter";
import { mediaLibraryPortAdapter } from "../../modules/media-library/application/media-library-port-adapter";
import { fetchTenantModuleEntry } from "../../modules/module-management/application/tenant-module-lifecycle";
import type { MediaLibraryPort } from "../../modules/_shared/ports/media-library-port";
import type { SeoFactsSource } from "../../modules/_shared/ports/seo-facts-port";

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
 */
export async function resolveEnabledSeoProviders(
  tx: Bun.TransactionSQL,
  tenantId: string
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
    providers.push(blogContentSeoFactsAdapter);
  }

  const mediaLibrary =
    (mediaEntry?.tenantEnabled ?? false) ? mediaLibraryPortAdapter : null;

  return { providers, mediaLibrary };
}
