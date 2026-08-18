/**
 * ADR-0042 — content-change purge emission.
 *
 * The assertion that matters most here is the negative one: with the edge cache
 * off, a publish must not append queue rows. Every deployment that has not opted
 * in still runs these write paths, and an unguarded enqueue would grow a table
 * no worker drains.
 */
import { describe, expect, test } from "bun:test";

import {
  enqueueModuleContentPurge,
  resolveDerivedSurfaceModuleKeys
} from "../src/lib/edge-cache/content-purge";
import type { SqlExecutor } from "../src/lib/edge-cache/purge-queue";

/** Records the parameter arrays passed to the tagged-template executor. */
function recordingTx(): { tx: SqlExecutor; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const tx = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push(values);

    return Promise.resolve([]);
  }) as SqlExecutor;

  return { tx, calls };
}

const TENANT = "11111111-1111-4111-8111-111111111111";

describe("enqueueModuleContentPurge", () => {
  test("is a no-op when the edge cache is disabled", async () => {
    const { tx, calls } = recordingTx();
    const previous = process.env.EDGE_CACHE_MODE;

    delete process.env.EDGE_CACHE_MODE;

    try {
      const enqueued = await enqueueModuleContentPurge(
        tx,
        TENANT,
        "blog_content",
        "blog.post.published"
      );

      expect(enqueued).toBe(0);
      expect(calls).toHaveLength(0);
    } finally {
      if (previous === undefined) {
        delete process.env.EDGE_CACHE_MODE;
      } else {
        process.env.EDGE_CACHE_MODE = previous;
      }
    }
  });

  test("enqueues the owning module's key plus its derived consumers", async () => {
    const { tx, calls } = recordingTx();
    const previous = process.env.EDGE_CACHE_MODE;

    process.env.EDGE_CACHE_MODE = "auto";

    try {
      const enqueued = await enqueueModuleContentPurge(
        tx,
        TENANT,
        "blog_content",
        "blog.post.published"
      );

      expect(enqueued).toBe(2);
      // Still ONE statement: the two keys go in a single enqueue, so the purge
      // commits atomically with the content change rather than half-committing.
      expect(calls).toHaveLength(1);

      // Module scope, NOT a resource key: cached responses are tagged with
      // tenant/surface/module only, so a resource-scoped ban would match no
      // object and the page would stay stale until its TTL expired.
      //
      // `seo_distribution` rides along (ADR-0061 §B) because it declares
      // `consumes: seo_facts providedBy blog_content` AND owns surfaces whose
      // bodies aggregate that content. Without it, publishing a post would purge
      // `/blog/{code}/feed.xml` and leave `/feed.xml` — the same content, the
      // host-resolved spelling — stale until TTL.
      expect(calls[0]).toEqual([
        TENANT,
        [`t:${TENANT}:m:blog_content`, `t:${TENANT}:m:seo_distribution`],
        "blog.post.published"
      ]);
    } finally {
      if (previous === undefined) {
        delete process.env.EDGE_CACHE_MODE;
      } else {
        process.env.EDGE_CACHE_MODE = previous;
      }
    }
  });
});

describe("derived-surface fan-out (ADR-0061 §B)", () => {
  const SURFACES = [{ moduleKey: "owner" }, { moduleKey: "consumer" }];

  test("a consumer that owns a surface is covered", () => {
    expect(
      resolveDerivedSurfaceModuleKeys(
        "owner",
        [
          { key: "owner" },
          {
            key: "consumer",
            capabilities: { consumes: [{ providedBy: "owner" }] }
          }
        ],
        SURFACES
      )
    ).toEqual(["consumer"]);
  });

  test("a consumer that owns NO surface is excluded", () => {
    // The condition this repo already applies to `media_library`: a ban on a
    // module key that tags no cached object matches nothing while the queue
    // reports success. Adding it would be ceremony that reads as coverage.
    expect(
      resolveDerivedSurfaceModuleKeys(
        "owner",
        [
          { key: "owner" },
          {
            key: "surfaceless",
            capabilities: { consumes: [{ providedBy: "owner" }] }
          }
        ],
        [{ moduleKey: "owner" }]
      )
    ).toEqual([]);
  });

  test("a surface owner that consumes nothing from the changing module is excluded", () => {
    expect(
      resolveDerivedSurfaceModuleKeys(
        "owner",
        [
          { key: "owner" },
          {
            key: "consumer",
            capabilities: { consumes: [{ providedBy: "somebody_else" }] }
          }
        ],
        SURFACES
      )
    ).toEqual([]);
  });

  test("the changing module never fans out to itself", () => {
    // It is already scope #1. A duplicate key would enqueue the same ban twice.
    expect(
      resolveDerivedSurfaceModuleKeys(
        "owner",
        [
          {
            key: "owner",
            capabilities: { consumes: [{ providedBy: "owner" }] }
          }
        ],
        SURFACES
      )
    ).toEqual([]);
  });

  test("against the LIVE registry, blog_content reaches seo_distribution and theming does not", () => {
    // The literals above prove the rule; this proves the rule is wired to the
    // real declarations. `theming` feeds no aggregator, so it must stay a
    // single-key purge — otherwise the fan-out is over-broad rather than exact.
    expect(resolveDerivedSurfaceModuleKeys("blog_content")).toEqual([
      "seo_distribution"
    ]);
    expect(resolveDerivedSurfaceModuleKeys("theming")).toEqual([]);
  });
});

describe("content write paths emit a purge", () => {
  test.each([
    ["src/pages/api/v1/blog/posts/[id].ts", 2],
    ["src/pages/api/v1/blog/posts/index.ts", 1],
    // 2 since Issue #591: the publish sweep and the unpublish sweep each emit
    // one. The second matters MORE than the first — a withdrawn article still
    // sitting in the edge cache is the withdrawal not having happened, which is
    // the failure an embargo exists to prevent.
    ["src/modules/blog-content/application/blog-scheduled-publish.ts", 2],
    // `theming` owns the `theming-tokens` surface, so these three change what a
    // cached object contains. `news_portal` and `media_library` are absent on
    // purpose: they own no declared surface, so a ban keyed to them would match
    // nothing while the queue reported success. `edge-cache:surfaces:check`
    // enforces the obligation by ownership and will demand them the day they
    // declare one.
    ["src/pages/api/v1/theming/publish.ts", 1],
    ["src/pages/api/v1/theming/rollback.ts", 1],
    ["src/pages/api/v1/theming/retire.ts", 1],
    // `seo_distribution` owns the three `seo-*` discovery surfaces as of
    // ADR-0061 §B, so its own config write must purge them: the tenant-wide
    // `noindex` switch alone rewrites `/robots.txt`, and serving a stale crawl
    // policy to crawlers is the one staleness here with a lasting consequence.
    ["src/pages/api/v1/seo/config.ts", 1]
  ])(
    "%s calls enqueueModuleContentPurge %i time(s)",
    async (path, expected) => {
      // A source-level assertion on purpose. These are the paths that make
      // content change; if someone adds a fourth mutating handler without an
      // enqueue, the edge cache silently serves stale content — a failure that
      // no unit test of the handler itself would surface.
      const source = await Bun.file(path).text();
      const occurrences =
        source.split("await enqueueModuleContentPurge(").length - 1;

      expect(occurrences).toBe(expected);
    }
  );
});
