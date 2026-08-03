/**
 * Content-change → edge-cache invalidation (ADR-0042 §9), the caller side.
 *
 * Content modules call this **inside the transaction that changes the content**.
 * That is the whole point: the invalidation commits with the change, so a
 * rolled-back publish leaves no stray purge and a committed publish can never
 * lose its purge.
 *
 * ## Why module scope and not the resource
 *
 * The obvious call is "purge exactly the post that changed". It would invalidate
 * nothing. `buildScopesForSurface` tags cached responses with tenant, surface,
 * and module keys — **not** resource keys, because the surface registry cannot
 * know a route's resource ids. Enqueuing `t:<tenant>:r:blog_post:<id>` would
 * therefore produce a ban that matches no object, and the stale page would sit
 * there until its TTL expired while the queue reported success.
 *
 * So this purges the owning module for the tenant: every blog surface for that
 * tenant at once. Slightly broader than necessary, and correct — which is the
 * right trade for an invalidation path. A post edit also changes the index, the
 * taxonomy listings, and the feed anyway, so the "narrow" purge would have had
 * to fan out to most of those regardless.
 *
 * When routes start emitting resource keys, add the narrower scope here **and**
 * in `buildScopesForSurface` in the same change — one without the other is a
 * purge that silently misses.
 *
 * ## Why the owning module is not always enough (ADR-0061 §B)
 *
 * A surface's body can be authored by a module that does not own it. The root
 * discovery surfaces (`/sitemap.xml`, `/feed.xml`, …) belong to
 * `seo_distribution`, which owns their routes and the config that shapes them —
 * but their CONTENT is aggregated from every `seo_facts` provider. Publishing a
 * post therefore changes those bodies without touching a single row
 * `seo_distribution` writes.
 *
 * Because a module purge tags `t:<tenant>:m:<moduleKey>`, `blog_content`'s
 * publish purge cannot reach an object tagged `m:seo_distribution`. The visible
 * result would have been an asymmetry nobody would report: the path-scoped
 * `/blog/{code}/feed.xml` purged on publish, the host-resolved `/feed.xml` — the
 * same content — stale until TTL.
 *
 * So a purge for module M also covers every registered module that BOTH declares
 * a `consumes` dependency on M and owns a declared cache surface. Both halves of
 * that condition matter:
 *
 * - **Read from the registry, not hard-coded.** `blog_content` never names
 *   `seo_distribution` anywhere; the consumer's own `capabilities.consumes`
 *   declaration is the wiring. A future `seo_facts` provider inherits this, and
 *   a future consumer of `blog_content` is covered the day it declares itself.
 * - **Only consumers that own a surface.** A ban on a module key that tags no
 *   cached object matches nothing while the queue reports success — the same
 *   "ceremony that looks like coverage" this file's owner gate refuses for
 *   `media_library`. The obligation appears by itself when a consumer declares
 *   its first surface.
 *
 * ## No-op when the edge cache is off
 *
 * Guarded on `EDGE_CACHE_MODE`. Without the guard every publish on every
 * deployment would append rows to a queue no worker drains, growing forever for
 * a feature the operator never enabled.
 */
import { listModules } from "../../modules";
import { loadEdgeCacheConfig } from "./config";
import { enqueueEdgeCachePurge, type SqlExecutor } from "./purge-queue";
import { PUBLIC_CACHE_SURFACES } from "./surface-registry";
import type { SurrogateKeyScope } from "./surrogate-keys";

/** Minimal shape this file needs from a module descriptor — kept structural so the resolver is testable with plain literals. */
export type PurgeFanOutModule = {
  key: string;
  capabilities?: {
    consumes?: readonly { providedBy: string }[];
  };
};

/**
 * The module keys a purge for `moduleKey` must ALSO cover: registered modules
 * that consume a capability from it AND own a declared cache surface.
 *
 * Exported for its own test, because the interesting cases are the ones the live
 * registry does not currently contain — a consumer with no surface (must be
 * excluded), and a consumer of a module nobody else consumes (must yield
 * nothing).
 */
export function resolveDerivedSurfaceModuleKeys(
  moduleKey: string,
  modules: readonly PurgeFanOutModule[] = listModules(),
  surfaces: readonly { moduleKey: string | null }[] = PUBLIC_CACHE_SURFACES
): string[] {
  const surfaceOwners = new Set(
    surfaces
      .map((surface) => surface.moduleKey)
      .filter((key): key is string => Boolean(key))
  );

  return modules
    .filter(
      (module) =>
        module.key !== moduleKey &&
        surfaceOwners.has(module.key) &&
        (module.capabilities?.consumes ?? []).some(
          (dependency) => dependency.providedBy === moduleKey
        )
    )
    .map((module) => module.key);
}

/**
 * Enqueue invalidation for a module's cached surfaces for one tenant, plus the
 * surfaces of any module whose declared content it feeds.
 *
 * Returns the number of keys enqueued (`0` when the subsystem is off), and never
 * throws for a disabled subsystem — callers are content write paths, and a cache
 * concern must not be able to fail a publish.
 */
export async function enqueueModuleContentPurge(
  tx: SqlExecutor,
  tenantId: string,
  moduleKey: string,
  reason: string
): Promise<number> {
  const config = loadEdgeCacheConfig();

  if (config.mode === "off") {
    return 0;
  }

  const scopes: SurrogateKeyScope[] = [
    { kind: "module", tenantId, moduleKey },
    ...resolveDerivedSurfaceModuleKeys(moduleKey).map(
      (derived): SurrogateKeyScope => ({
        kind: "module",
        tenantId,
        moduleKey: derived
      })
    )
  ];

  return enqueueEdgeCachePurge(tx, tenantId, scopes, reason);
}
