/**
 * Composition root for `comments`'s registered commentable resources (ADR-0041
 * §3, ported from awcms-micro Issue #271). Lives in `src/lib/` because it is the
 * ONE place allowed to import `src/modules/index` (`listModules()`) and hand the
 * aggregated descriptors to the engine and services — the established
 * `src/lib` → `src/modules` composition-root pattern, matching
 * `src/lib/search/search-sources.ts` (site_search) and
 * `src/lib/seo/discovery-providers.ts` (seo_distribution).
 *
 * The module's own `application`/`domain` code never imports `listModules()`.
 * Descriptors are passed in as a parameter, which keeps the aggregator functions
 * pure and lets tests drive the engine from a fixture registry instead of the
 * real one.
 */
import { listModules } from "../../modules";
import type { CommentableResourceDescriptor } from "../../modules/_shared/module-contract";
import { collectCommentableResourceDescriptors } from "../../modules/comments/domain/commentable-resource-registry";

/** Every reviewed, registered commentable-resource descriptor across the whole module registry. */
export function getRegisteredCommentableResources(): CommentableResourceDescriptor[] {
  return collectCommentableResourceDescriptors(listModules());
}
