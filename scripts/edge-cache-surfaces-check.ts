/**
 * edge-cache-surfaces-check.ts — `bun run edge-cache:surfaces:check`.
 *
 * ADR-0042 registry gate, part of `bun run check`. Pure: no database, no
 * network. It runs in CI on every change because the surface registry is an
 * allow-list that decides what a shared cache may store — a mistake in it is a
 * cross-tenant disclosure, not a performance bug, and it is exactly the kind of
 * mistake that reads fine in review.
 *
 * The check that earns this file's existence is #3: it probes every declared
 * pattern against a list of paths that must NEVER be cacheable. A regex like
 * `/^\/blog\/.*​/` looks reasonable in a diff and quietly matches
 * `/blog/../admin/users`. Asserting the property directly is far more reliable
 * than asking a reviewer to simulate regexes in their head.
 */
import {
  PUBLIC_CACHE_SURFACES,
  matchPublicCacheSurface
} from "../src/lib/edge-cache/surface-registry";
import { listModules } from "../src/modules";

/**
 * Paths that must never resolve to a cacheable surface. Includes traversal and
 * encoding shapes, because a pattern that is safe against a clean path is not
 * necessarily safe against a hostile one.
 */
const MUST_NEVER_MATCH = [
  "/admin",
  "/admin/",
  "/admin/users",
  "/admin/comments",
  "/api/v1/health",
  "/api/v1/comments",
  "/api/v1/tenant/domains",
  "/login",
  // Three segments, so it satisfies the blog-post pattern on its face — the
  // traversal guard in `matchPublicCacheSurface` is what stops it.
  "/blog/../admin",
  "/blog/%2e%2e/admin",
  "/blog/../admin/users",
  "/blog/tenant/../../admin",
  "/theming/preview/abc123",
  "/theming/preview-tokens/abc123.css",
  "/search",
  "/blog/acme/search"
] as const;

/** Mirrors `sanitizeKeySegment` — a surface key becomes a surrogate-key segment. */
const SAFE_SURFACE_KEY = /^[A-Za-z0-9._-]{1,128}$/;

const MAX_DECLARED_TTL_SECONDS = 86_400;

function main(): void {
  const failures: string[] = [];
  const seenKeys = new Set<string>();
  const moduleKeys = new Set(listModules().map((module) => module.key));

  for (const surface of PUBLIC_CACHE_SURFACES) {
    if (!SAFE_SURFACE_KEY.test(surface.key)) {
      failures.push(
        `Surface key "${surface.key}" is not a safe surrogate-key segment (allowed: A-Z a-z 0-9 . _ -).`
      );
    }

    if (seenKeys.has(surface.key)) {
      failures.push(
        `Duplicate surface key "${surface.key}" — surrogate keys would collide and one surface's purge would flush the other.`
      );
    }

    seenKeys.add(surface.key);

    const source = surface.pattern.source;

    if (!source.startsWith("^") || !source.endsWith("$")) {
      failures.push(
        `Surface "${surface.key}" pattern is not fully anchored (${source}) — an unanchored pattern matches substrings of unrelated paths.`
      );
    }

    if (source.includes(".*") || source.includes(".+")) {
      failures.push(
        `Surface "${surface.key}" pattern uses a greedy wildcard (${source}) — use an explicit [^/]+ segment so it cannot span path separators.`
      );
    }

    if (
      surface.ttlSeconds <= 0 ||
      surface.ttlSeconds > MAX_DECLARED_TTL_SECONDS
    ) {
      failures.push(
        `Surface "${surface.key}" declares ttlSeconds=${surface.ttlSeconds}, outside 1..${MAX_DECLARED_TTL_SECONDS}.`
      );
    }

    if (!surface.requiresTenant) {
      failures.push(
        `Surface "${surface.key}" sets requiresTenant=false — an object with no tenant surrogate key can never be purged and would go stale permanently.`
      );
    }

    // An unbounded query allow-list re-opens the cache-fill hole the bound
    // exists to close, so keep it small and named.
    if (surface.allowedQueryParams.length > 4) {
      failures.push(
        `Surface "${surface.key}" allows ${surface.allowedQueryParams.length} query parameters — each one multiplies the cache key space; keep the allow-list minimal.`
      );
    }

    for (const param of surface.allowedQueryParams) {
      if (!/^[a-z][a-z0-9_]{0,31}$/.test(param)) {
        failures.push(
          `Surface "${surface.key}" allows query parameter "${param}", which is not a simple lowercase identifier.`
        );
      }
    }

    if (surface.moduleKey && !moduleKeys.has(surface.moduleKey)) {
      failures.push(
        `Surface "${surface.key}" names module "${surface.moduleKey}", which is not in the base registry — module-scoped purges for it would never match.`
      );
    }

    if (!surface.rationale || surface.rationale.trim().length < 20) {
      failures.push(
        `Surface "${surface.key}" has no meaningful rationale. Every entry widens what a shared cache may store; say why it is safe.`
      );
    }
  }

  for (const path of MUST_NEVER_MATCH) {
    const matched = matchPublicCacheSurface(path);

    if (matched) {
      failures.push(
        `Path "${path}" must never be cacheable but matched surface "${matched.key}".`
      );
    }
  }

  if (failures.length > 0) {
    console.error("edge-cache:surfaces:check FAILED");

    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }

    process.exit(1);
  }

  console.log(
    `edge-cache:surfaces:check OK — ${PUBLIC_CACHE_SURFACES.length} declared surfaces, ` +
      `${MUST_NEVER_MATCH.length} never-cacheable probes held.`
  );
}

main();
