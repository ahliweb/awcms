/**
 * `edge-cache:surfaces:check` — the gate that had none.
 *
 * Of the gates in `bun run check`, this was the only one carrying substantial
 * logic (278 lines) with no test at all, and the reason was structural: the
 * file ended in a bare `await main()`, so importing it ran the gate — and its
 * `process.exit(1)` would have taken the test runner with it. The entrypoint is
 * guarded now and the rules are exported, which is what makes this file
 * possible.
 *
 * That matters more here than for most gates. This registry is an ALLOW-LIST
 * deciding what a shared cache may store; a mistake in it is a cross-tenant
 * disclosure, not a slow page. Its own header says the probe list is what earns
 * the file's existence — and until now nothing had ever observed that probe
 * list reject anything.
 *
 * Every case below plants a violation. A gate that has only ever been observed
 * passing has not been observed at all.
 */
import { describe, expect, test } from "bun:test";

import {
  MUST_NEVER_MATCH,
  collectPurgedModuleKeys,
  findCacheableForbiddenPaths,
  findOwnersWithoutPurges,
  validateSurfaces,
  type SurfaceLike
} from "../scripts/edge-cache-surfaces-check";
import {
  PUBLIC_CACHE_SURFACES,
  matchPublicCacheSurface
} from "../src/lib/edge-cache/surface-registry";
import { listModules } from "../src/modules";

const SAFE: SurfaceLike = {
  key: "blog-post",
  pattern: /^\/blog\/[^/]+\/[^/]+$/,
  ttlSeconds: 300,
  requiresTenant: true,
  allowedQueryParams: [],
  moduleKey: "blog_content",
  rationale: "Public blog post body, identical for every anonymous visitor."
};

const MODULE_KEYS = new Set(listModules().map((module) => module.key));

describe("validateSurfaces", () => {
  test("the clean entry passes, so every failure below is about the planted flaw", () => {
    expect(validateSurfaces([SAFE], MODULE_KEYS)).toEqual([]);
  });

  test("an unanchored pattern is rejected", () => {
    // `\/blog\/x` matches INSIDE `/admin/blog/x`, so an unanchored pattern
    // silently widens the allow-list to paths nobody reviewed.
    const failures = validateSurfaces(
      [{ ...SAFE, pattern: /\/blog\/[^/]+/ }],
      MODULE_KEYS
    );

    expect(failures.join(" ")).toContain("not fully anchored");
  });

  test("a greedy wildcard is rejected because it spans path separators", () => {
    const failures = validateSurfaces(
      [{ ...SAFE, pattern: /^\/blog\/.*$/ }],
      MODULE_KEYS
    );

    expect(failures.join(" ")).toContain("greedy wildcard");
  });

  test("requiresTenant=false is rejected — such an object can never be purged", () => {
    const failures = validateSurfaces(
      [{ ...SAFE, requiresTenant: false }],
      MODULE_KEYS
    );

    expect(failures.join(" ")).toContain("requiresTenant=false");
  });

  test("a duplicate key is rejected — surrogate keys would collide", () => {
    const failures = validateSurfaces([SAFE, { ...SAFE }], MODULE_KEYS);

    expect(failures.join(" ")).toContain("Duplicate surface key");
  });

  test("a key that is not a safe surrogate-key segment is rejected", () => {
    const failures = validateSurfaces(
      [{ ...SAFE, key: "blog post/../x" }],
      MODULE_KEYS
    );

    expect(failures.join(" ")).toContain("not a safe surrogate-key segment");
  });

  test.each([
    [0, "ttlSeconds=0"],
    [86_401, "ttlSeconds=86401"]
  ])("a TTL outside 1..86400 is rejected (%p)", (ttlSeconds, expected) => {
    const failures = validateSurfaces([{ ...SAFE, ttlSeconds }], MODULE_KEYS);

    expect(failures.join(" ")).toContain(expected);
  });

  test("a module key absent from the registry is rejected", () => {
    // A module-scoped purge for a key nothing tags matches nothing, while the
    // queue happily reports success.
    const failures = validateSurfaces(
      [{ ...SAFE, moduleKey: "not_a_module" }],
      MODULE_KEYS
    );

    expect(failures.join(" ")).toContain("not in the base registry");
  });

  test("an empty rationale is rejected", () => {
    const failures = validateSurfaces(
      [{ ...SAFE, rationale: "" }],
      MODULE_KEYS
    );

    expect(failures.join(" ")).toContain("no meaningful rationale");
  });

  test("an oversized query allow-list is rejected", () => {
    const failures = validateSurfaces(
      [{ ...SAFE, allowedQueryParams: ["a", "b", "c", "d", "e"] }],
      MODULE_KEYS
    );

    expect(failures.join(" ")).toContain("query parameters");
  });
});

describe("findCacheableForbiddenPaths — the check this gate exists for", () => {
  test("a pattern that swallows /admin is caught", () => {
    // The concrete failure the gate's own header describes: `/^\/blog\/.*$/`
    // reads fine in a diff and matches `/blog/../admin/users`. Driving the
    // matcher directly is the only way to observe the rule REJECT something.
    const greedy = /^\/blog\/.*$/;
    const failures = findCacheableForbiddenPaths(
      ["/blog/../admin/users"],
      (path) => (greedy.test(path) ? { key: "blog-greedy" } : null)
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("must never be cacheable");
    expect(failures[0]).toContain("blog-greedy");
  });

  test("a matcher that refuses everything produces no findings", () => {
    expect(findCacheableForbiddenPaths(MUST_NEVER_MATCH, () => null)).toEqual(
      []
    );
  });

  test("the probe list covers traversal, encoding, admin and API shapes", () => {
    // A shrinking probe list is how this check quietly stops proving anything.
    expect(MUST_NEVER_MATCH.length).toBeGreaterThanOrEqual(16);
    expect(MUST_NEVER_MATCH).toContain("/blog/../admin/users");
    expect(MUST_NEVER_MATCH).toContain("/blog/%2e%2e/admin");
    expect(MUST_NEVER_MATCH).toContain("/admin/users");
    expect(MUST_NEVER_MATCH).toContain("/api/v1/health");
  });
});

describe("findOwnersWithoutPurges", () => {
  test("an owner that emits no purge is caught", () => {
    // The asymmetry that makes stale content silent: declaring a surface takes
    // effect immediately, wiring the purge is a separate edit nothing forces.
    const failures = findOwnersWithoutPurges([SAFE], new Set());

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("blog_content");
    expect(failures[0]).toContain("would go stale until TTL");
  });

  test("a surface owned by nobody creates no obligation", () => {
    expect(
      findOwnersWithoutPurges([{ ...SAFE, moduleKey: null }], new Set())
    ).toEqual([]);
  });

  test("an owner that does emit a purge passes", () => {
    expect(findOwnersWithoutPurges([SAFE], new Set(["blog_content"]))).toEqual(
      []
    );
  });
});

describe("the real registry", () => {
  test("passes every per-entry rule", () => {
    expect(validateSurfaces(PUBLIC_CACHE_SURFACES, MODULE_KEYS)).toEqual([]);
  });

  test("caches none of the paths that must never be cacheable", () => {
    expect(
      findCacheableForbiddenPaths(MUST_NEVER_MATCH, matchPublicCacheSurface)
    ).toEqual([]);
  });

  test("every surface-owning module emits a purge", async () => {
    expect(
      findOwnersWithoutPurges(
        PUBLIC_CACHE_SURFACES,
        await collectPurgedModuleKeys()
      )
    ).toEqual([]);
  }, 60000);
});
