/**
 * ADR-0042 — content-change purge emission.
 *
 * The assertion that matters most here is the negative one: with the edge cache
 * off, a publish must not append queue rows. Every deployment that has not opted
 * in still runs these write paths, and an unguarded enqueue would grow a table
 * no worker drains.
 */
import { describe, expect, test } from "bun:test";

import { enqueueModuleContentPurge } from "../src/lib/edge-cache/content-purge";
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

  test("enqueues exactly the module-scoped key when enabled", async () => {
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

      expect(enqueued).toBe(1);
      expect(calls).toHaveLength(1);

      // Module scope, NOT a resource key: cached responses are tagged with
      // tenant/surface/module only, so a resource-scoped ban would match no
      // object and the page would stay stale until its TTL expired.
      expect(calls[0]).toEqual([
        TENANT,
        [`t:${TENANT}:m:blog_content`],
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

describe("content write paths emit a purge", () => {
  test.each([
    ["src/pages/api/v1/blog/posts/[id].ts", 2],
    ["src/pages/api/v1/blog/posts/index.ts", 1],
    ["src/modules/blog-content/application/blog-scheduled-publish.ts", 1],
    // `theming` owns the `theming-tokens` surface, so these three change what a
    // cached object contains. `news_portal` and `media_library` are absent on
    // purpose: they own no declared surface, so a ban keyed to them would match
    // nothing while the queue reported success. `edge-cache:surfaces:check`
    // enforces the obligation by ownership and will demand them the day they
    // declare one.
    ["src/pages/api/v1/theming/publish.ts", 1],
    ["src/pages/api/v1/theming/rollback.ts", 1],
    ["src/pages/api/v1/theming/retire.ts", 1]
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
