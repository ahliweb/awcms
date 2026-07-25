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
 * ## No-op when the edge cache is off
 *
 * Guarded on `EDGE_CACHE_MODE`. Without the guard every publish on every
 * deployment would append rows to a queue no worker drains, growing forever for
 * a feature the operator never enabled.
 */
import { loadEdgeCacheConfig } from "./config";
import { enqueueEdgeCachePurge, type SqlExecutor } from "./purge-queue";
import type { SurrogateKeyScope } from "./surrogate-keys";

/**
 * Enqueue invalidation for a module's cached surfaces for one tenant.
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

  const scopes: SurrogateKeyScope[] = [{ kind: "module", tenantId, moduleKey }];

  return enqueueEdgeCachePurge(tx, tenantId, scopes, reason);
}
