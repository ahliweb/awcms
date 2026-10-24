/**
 * The edge-cache MODE on its own (ADR-0042, Issue #1132).
 *
 * `loadEdgeCacheConfig()` in `config.ts` resolves the whole subsystem, including
 * `EDGE_CACHE_PURGE_TOKEN`, the credential that purges the shared edge cache. A
 * caller that only asks "is the edge cache off?" (`content-purge.ts`, on every
 * publish) would import a file that reads that token, and `ops/run-job.sh` hands
 * a job every secret its import graph can reach (Issue #1120). This file reads
 * `EDGE_CACHE_MODE` and nothing else, and imports nothing, so a job that imports
 * only this file is not granted the purge token.
 *
 * `loadEdgeCacheConfig()` takes its `mode` from here, so the two cannot disagree
 * on what an unknown value means. Do not add another variable to this file.
 */

/** How aggressively the origin asks the edge to cache. */
export type EdgeCacheMode = "off" | "auto" | "on";

const MODES: readonly EdgeCacheMode[] = ["off", "auto", "on"];

/** `off` (the default) for anything unset or unrecognised: a typo must not switch the cache on. */
export function loadEdgeCacheMode(
  env: Readonly<Record<string, string | undefined>> = process.env
): EdgeCacheMode {
  const rawMode = env.EDGE_CACHE_MODE?.trim().toLowerCase();

  return MODES.includes(rawMode as EdgeCacheMode)
    ? (rawMode as EdgeCacheMode)
    : "off";
}
