/**
 * The single, named way a public route tells the edge-cache layer which tenant
 * its response belongs to — ADR-0042 §8 source (1), wired by ADR-0061.
 *
 * `resolveEdgeCacheTenantId` has always preferred a route-published tenant over
 * re-deriving one in middleware, and `src/env.d.ts` has always documented
 * `locals.edgeCacheTenantId` as the source "published by a public route that has
 * already resolved its tenant". Until ADR-0061 **no route ever set it**, so that
 * branch was unreachable and every host-resolved surface was uncacheable by
 * construction. This function is what makes it reachable.
 *
 * ## Why a function rather than an assignment
 *
 * The assignment itself is one line. What is not one line is *when* it is
 * correct to make it, and that rule is the whole reason this file exists:
 *
 * **Publish only on the path that actually serves the resource.**
 *
 * The host-resolved families deliberately collapse "unknown host", "module
 * disabled", "route family switched off" and "no such post/term" into ONE
 * generic 404, and pad the unresolved-host path so the four are
 * indistinguishable in the time domain too (`padUnresolvedHostRouteLatency`,
 * `padUnresolvedSeoTenantLatency`). Cache annotation is a second observable
 * channel over the same question. A 404 is a cacheable status, so publishing the
 * tenant before the "no such post" branch would annotate the missing-resource
 * 404 with `Surrogate-Control` while the unknown-host 404 gets
 * `Cache-Control: private, no-store` — handing a prober the exact answer
 * ("does this hostname map to a live tenant?") that the latency padding exists
 * to withhold, from a single request, with no timing analysis at all.
 *
 * So: resolve, gate, produce the resource, and publish last. A route that
 * forgets to publish loses caching and nothing else — `requiresTenant` surfaces
 * fail closed to `tenant_unresolved`. That asymmetry is intentional: forgetting
 * is a performance cost, publishing too early is a disclosure.
 *
 * Index-style surfaces (`/news`) have no missing-resource branch — their
 * outcomes are a 200 or the generic 404, already distinguishable by status — so
 * for them "publish once the tenant is gated" and "publish on the serving path"
 * are the same instant.
 */

/**
 * Structural, not `App.Locals`, so the rule above is unit-testable without an
 * Astro request context. Astro's `locals` satisfies it.
 */
export type EdgeCacheTenantPublisher = {
  edgeCacheTenantId?: string | null;
};

/**
 * Record `tenantId` as the tenant to tag this response's cache entry with.
 *
 * Tolerates a missing `locals` (a caller outside a request context, e.g. a
 * test) and an empty id rather than throwing: this is an optimization hint, and
 * ADR-0042's standing rule is that no fault in the cache layer may turn a
 * working public page into a 500. An unpublished tenant simply means uncached.
 */
export function publishEdgeCacheTenant(
  locals: EdgeCacheTenantPublisher | undefined | null,
  tenantId: string | null | undefined
): void {
  if (!locals || !tenantId) {
    return;
  }

  locals.edgeCacheTenantId = tenantId;
}
