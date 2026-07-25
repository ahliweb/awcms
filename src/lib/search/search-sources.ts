/**
 * Composition root for `site_search`'s registered search sources (ADR-0040 §3,
 * ported from awcms-micro Issue #270). Lives in `src/lib/` because it is the ONE
 * place allowed to import `src/modules/index` (`listModules()`) and hand the
 * aggregated descriptors to the engine/services — exactly the established
 * `src/lib` → `src/modules` composition-root pattern
 * (`src/lib/seo/discovery-providers.ts` does the same for `seo_distribution`).
 * The module's own `application`/`domain` code never imports `listModules()`,
 * keeping the aggregator functions pure and passing `modules` as a parameter (the
 * `reporting`/`data_lifecycle` registry convention).
 */
import { listModules } from "../../modules";
import type { SearchSourceDescriptor } from "../../modules/_shared/module-contract";
import { collectSearchSourceDescriptors } from "../../modules/site-search/domain/search-source-registry";

/** Every reviewed, registered search-source descriptor across the whole module registry. */
export function getRegisteredSearchSources(): SearchSourceDescriptor[] {
  return collectSearchSourceDescriptors(listModules());
}
