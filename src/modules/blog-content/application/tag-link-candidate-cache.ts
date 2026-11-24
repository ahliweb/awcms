/**
 * Per-tenant, in-process cache of the internal-tag-link candidate list
 * (Issue #1454).
 *
 * ## Why it exists
 *
 * `listTagLinkCandidates` ranks a tenant's tags by how many live posts carry
 * them: a three-way join with a GROUP BY over every post/tag assignment. It ran
 * on EVERY public post view. Measured locally with 5,000 posts, 800 tags and
 * 15,000 assignments it cost about 10 ms of execution plus about 3 ms of
 * planning per view, which lifted the `interactive` slot hold from a median
 * 0.8 ms to 8 ms and made the 8-slot pool the ceiling (about 300 views/s).
 * The vocabulary changes rarely; the query was paid per view.
 *
 * ## Safety properties
 *
 * - Keyed by `tenantId` ONLY and filled from a query that ran inside that
 *   tenant's own RLS transaction, so one tenant's list can never be served to
 *   another. Nothing here bypasses RLS: the cache is a read-through on top of
 *   it, and the caller still opens its `withTenant` transaction.
 * - Bounded: LRU with `MAX_TENANTS` entries, so a public route that is reached
 *   before authorisation cannot grow it without limit.
 * - Short TTL (default 60 s, `BLOG_TAG_LINK_CANDIDATE_CACHE_TTL_SECONDS`, `0`
 *   disables it). Staleness is bounded by it: a tag created, renamed or deleted
 *   on ANOTHER replica is picked up within the TTL. In this process the term
 *   mutators call {@link invalidateTagLinkCandidates}.
 * - The tenant's per-tag opt-outs (`disabled_tag_ids`) are NOT cached: they are
 *   read from settings on every render, so disabling a tag takes effect at once.
 * - Single flight: concurrent misses for one tenant share one query instead of
 *   each paying for it. A failed fill is never cached.
 */
import type { TagLinkCandidateRow } from "./blog-taxonomy-directory";

const MAX_TENANTS = 256;
const DEFAULT_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 3600;

type Entry = {
  expiresAtMs: number;
  rows: TagLinkCandidateRow[];
};

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<TagLinkCandidateRow[]>>();
/** Bumped on every invalidation so a fill that started before it is not stored. */
const generations = new Map<string, number>();

export function resolveTagLinkCandidateCacheTtlMs(
  env: Record<string, string | undefined> = process.env
): number {
  const raw = Number(
    env.BLOG_TAG_LINK_CANDIDATE_CACHE_TTL_SECONDS ?? DEFAULT_TTL_SECONDS
  );

  if (!Number.isFinite(raw) || raw < 0) {
    return DEFAULT_TTL_SECONDS * 1000;
  }

  return Math.min(MAX_TTL_SECONDS, Math.floor(raw)) * 1000;
}

export function invalidateTagLinkCandidates(tenantId: string): void {
  entries.delete(tenantId);
  generations.set(tenantId, (generations.get(tenantId) ?? 0) + 1);
}

export function resetTagLinkCandidateCacheForTests(): void {
  entries.clear();
  inflight.clear();
  generations.clear();
}

export function tagLinkCandidateCacheSizeForTests(): number {
  return entries.size;
}

/**
 * Returns the cached list for `tenantId`, or runs `load` (once, however many
 * callers arrive meanwhile) and caches what it returns.
 */
export async function getCachedTagLinkCandidates(
  tenantId: string,
  load: () => Promise<TagLinkCandidateRow[]>,
  options: { nowMs?: number; ttlMs?: number } = {}
): Promise<TagLinkCandidateRow[]> {
  const ttlMs = options.ttlMs ?? resolveTagLinkCandidateCacheTtlMs();

  if (ttlMs === 0) {
    return load();
  }

  const nowMs = options.nowMs ?? Date.now();
  const hit = entries.get(tenantId);

  if (hit && hit.expiresAtMs > nowMs) {
    // Refresh recency (Map iteration order is insertion order).
    entries.delete(tenantId);
    entries.set(tenantId, hit);

    return hit.rows;
  }

  const pending = inflight.get(tenantId);

  if (pending) {
    return pending;
  }

  const generation = generations.get(tenantId) ?? 0;
  const fill = load()
    .then((rows) => {
      if ((generations.get(tenantId) ?? 0) === generation) {
        entries.delete(tenantId);
        entries.set(tenantId, { expiresAtMs: nowMs + ttlMs, rows });

        while (entries.size > MAX_TENANTS) {
          const oldest = entries.keys().next().value;

          if (oldest === undefined) {
            break;
          }

          entries.delete(oldest);
        }
      }

      return rows;
    })
    .finally(() => {
      inflight.delete(tenantId);
    });

  inflight.set(tenantId, fill);

  return fill;
}
