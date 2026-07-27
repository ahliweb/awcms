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
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  PUBLIC_CACHE_SURFACES,
  matchPublicCacheSurface
} from "../src/lib/edge-cache/surface-registry";
import { listModules } from "../src/modules";

/** Roots searched for `enqueueModuleContentPurge` call sites. */
const PURGE_CALLER_ROOTS = ["src/pages", "src/modules"];

/**
 * Collect the module keys any code actually enqueues a purge for.
 *
 * Matches the literal third argument of `enqueueModuleContentPurge(...)`, which
 * is a deliberate restriction: a computed module key cannot be verified
 * statically, and a purge whose target is unknown at review time is exactly the
 * thing this gate exists to prevent.
 */
export async function collectPurgedModuleKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const constants = new Map<string, string>();
  const pattern =
    /enqueueModuleContentPurge\(\s*[^,]+,\s*[^,]+,\s*(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/g;
  const constantPattern =
    /export const ([A-Z][A-Z0-9_]*_MODULE_KEY)\s*=\s*"([^"]+)"/g;
  const callSites: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }

      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".astro")) {
        continue;
      }

      const source = await readFile(full, "utf8");

      // Collect exported `*_MODULE_KEY` constants from every file first, so a
      // call site may name one that is declared elsewhere — which is the
      // readable spelling and the one existing code uses.
      for (const declared of source.matchAll(constantPattern)) {
        constants.set(declared[1]!, declared[2]!);
      }

      if (source.includes("enqueueModuleContentPurge(")) {
        callSites.push(source);
      }
    }
  }

  for (const root of PURGE_CALLER_ROOTS) {
    await walk(root);
  }

  for (const source of callSites) {
    for (const match of source.matchAll(pattern)) {
      const literal = match[1];

      if (literal) {
        keys.add(literal);
        continue;
      }

      const resolved = constants.get(match[2]!);

      if (resolved) {
        keys.add(resolved);
      }

      // An unresolvable identifier is deliberately NOT counted. A purge whose
      // target cannot be read at review time is the thing this gate exists to
      // catch, so it should fail loudly rather than be assumed correct.
    }
  }

  return keys;
}

/**
 * Paths that must never resolve to a cacheable surface. Includes traversal and
 * encoding shapes, because a pattern that is safe against a clean path is not
 * necessarily safe against a hostile one.
 */
export const MUST_NEVER_MATCH = [
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

/**
 * Shape of one registry entry, kept structural so a test can plant a violation
 * without constructing a whole `PublicCacheSurface`.
 */
export type SurfaceLike = {
  key: string;
  pattern: RegExp;
  ttlSeconds: number;
  requiresTenant: boolean;
  allowedQueryParams: readonly string[];
  /** `null` in the live registry for a surface no module owns. */
  moduleKey?: string | null;
  rationale?: string;
};

/** Every per-entry rule. Pure: no filesystem, no registry import. */
export function validateSurfaces(
  surfaces: readonly SurfaceLike[],
  moduleKeys: ReadonlySet<string>
): string[] {
  const failures: string[] = [];
  const seenKeys = new Set<string>();

  for (const surface of surfaces) {
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

  return failures;
}

/**
 * The check that earns this file's existence. Takes the matcher as an argument
 * so a test can drive it with a planted pattern instead of the live registry —
 * without that seam, the only observable behaviour is "the current registry
 * passes", which proves nothing about the rule.
 */
export function findCacheableForbiddenPaths(
  paths: readonly string[],
  match: (path: string) => { key: string } | null | undefined
): string[] {
  const failures: string[] = [];

  for (const path of paths) {
    const matched = match(path);

    if (matched) {
      failures.push(
        `Path "${path}" must never be cacheable but matched surface "${matched.key}".`
      );
    }
  }

  return failures;
}

/**
 * Every module that OWNS a cacheable surface must emit purges for it.
 *
 * This is the asymmetry that makes stale content silent. Declaring a surface is
 * one line in the registry and takes effect immediately; wiring the
 * invalidation is a separate edit in a different file that nothing forces. Miss
 * it and the surface caches correctly, serves correctly, and never updates —
 * with no error anywhere.
 *
 * Framed by OWNERSHIP rather than by module list on purpose. Modules with no
 * declared surface (`news_portal`, `media_library` today) are correctly silent:
 * a ban for a module key that tags no cached object matches nothing while the
 * queue reports success, so demanding a purge from them would add ceremony that
 * looks like coverage and provides none. The obligation appears by itself on
 * the day they declare a surface.
 */
export function findOwnersWithoutPurges(
  surfaces: readonly SurfaceLike[],
  purgedKeys: ReadonlySet<string>
): string[] {
  const declaredOwners = new Set(
    surfaces
      .map((surface) => surface.moduleKey)
      .filter((key): key is string => Boolean(key))
  );

  return [...declaredOwners]
    .filter((owner) => !purgedKeys.has(owner))
    .map(
      (owner) =>
        `Module "${owner}" owns a cacheable surface but no code calls ` +
        `enqueueModuleContentPurge(..., "${owner}", ...). Its cached pages ` +
        `would go stale until TTL with nothing reporting a problem.`
    );
}

async function main(): Promise<void> {
  const moduleKeys = new Set(listModules().map((module) => module.key));
  const purgedKeys = await collectPurgedModuleKeys();

  const failures = [
    ...validateSurfaces(PUBLIC_CACHE_SURFACES, moduleKeys),
    ...findCacheableForbiddenPaths(MUST_NEVER_MATCH, matchPublicCacheSurface),
    ...findOwnersWithoutPurges(PUBLIC_CACHE_SURFACES, purgedKeys)
  ];

  if (failures.length > 0) {
    console.error("edge-cache:surfaces:check FAILED");

    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }

    process.exitCode = 1;
    return;
  }

  const declaredOwners = new Set(
    PUBLIC_CACHE_SURFACES.map((surface) => surface.moduleKey).filter(Boolean)
  );

  console.log(
    `edge-cache:surfaces:check OK — ${PUBLIC_CACHE_SURFACES.length} declared surfaces, ` +
      `${MUST_NEVER_MATCH.length} never-cacheable probes held, ` +
      `${declaredOwners.size} surface-owning module(s) emit purges.`
  );
}

// Guarded so a test can import the pure validators above without executing the
// gate — the reason this file had no tests: a bare `await main()` at module
// scope ran the check on import, and its `process.exit(1)` would have taken the
// test runner with it.
if (import.meta.main) {
  await main();
}
