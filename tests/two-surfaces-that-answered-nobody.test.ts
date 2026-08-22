/**
 * Findings D16 and D17 — two media surfaces that answered nobody, in opposite
 * directions.
 *
 * **D16** was a whole lifecycle branch nothing could reach.
 * `markNewsMediaObjectOrphaned` was this repo's only writer of
 * `status = 'orphaned'` and had zero callers, so the reconciliation job's
 * stale-orphan sweep, `sql/041`'s partial index and the grace-period comparison
 * all gated a permanently empty set — and every run printed
 * `staleOrphaned(total=0,deleted=0,deferred=0)`, which reads exactly like a
 * clean bucket. The code is deleted; the SCHEMA is kept, and this file pins
 * both halves of that split so a future reader does not "restore" one of them.
 *
 * **D17** was the reverse: a surface that answered, with something the answer
 * could not be used for. The ad list handed out `mediaObjectId` and nothing
 * else, so an external renderer could neither build an `<img src>` nor
 * reproduce the media-safety filter — it would have had to reimplement
 * `isNewsMediaObjectSafeForPublicReference` from a status string it was not
 * given either.
 */
import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/lib/source-text";
import { categorizeNewsMediaReconciliation } from "../src/modules/media-library/domain/media-reconciliation-categorization";
import { isNewsMediaObjectSafeForPublicReference } from "../src/modules/media-library/application/media-object-directory";

const DIRECTORY =
  "src/modules/media-library/application/media-object-directory.ts";
const RECONCILIATION =
  "src/modules/media-library/application/media-reconciliation.ts";
const AD_DIRECTORY =
  "src/modules/blog-content/application/ad-placement-directory.ts";
const MIGRATION = "sql/041_awcms_news_media_object_registry_schema.sql";

describe("D16 — the unreachable orphan lifecycle is gone", () => {
  test("nothing writes status = 'orphaned' any more", async () => {
    const source = stripComments(await Bun.file(DIRECTORY).text());

    expect(source).not.toContain("markNewsMediaObjectOrphaned");
    expect(source).not.toContain("markStaleOrphanedNewsMediaObjectDeleted");
    expect(source).not.toContain("orphaned_at = now()");
    expect(source).not.toContain("status = 'orphaned'");
  });

  test("the reconciliation job no longer reports a category it cannot fill", async () => {
    // The operator-facing half of the finding. A counter that is structurally
    // always zero is worse than no counter: it reads as a measurement.
    const source = stripComments(await Bun.file(RECONCILIATION).text());
    const script = stripComments(
      await Bun.file("scripts/news-media-r2-reconcile.ts").text()
    );

    expect(source).not.toContain("staleOrphaned");
    expect(script).not.toContain("staleOrphaned");
  });

  test("an `orphaned` row is categorised as nothing, not as a sweep candidate", () => {
    const now = new Date("2026-08-22T00:00:00.000Z");
    const longAgo = new Date("2020-01-01T00:00:00.000Z");

    const result = categorizeNewsMediaReconciliation({
      dbRows: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          objectKey: "by-hand",
          status: "orphaned",
          createdAt: longAgo,
          orphanedAt: longAgo,
          deletedAt: null
        }
      ],
      r2Objects: [{ key: "by-hand", lastModified: longAgo.toISOString() }],
      now,
      pendingTtlMinutes: 60,
      orphanGraceDays: 30
    });

    expect(Object.keys(result).sort()).toEqual([
      "expiredPending",
      "healthy",
      "orphanInDb",
      "orphanInR2"
    ]);
    expect(result.healthy).toHaveLength(0);
    expect(result.orphanInDb).toHaveLength(0);
    expect(result.expiredPending).toHaveLength(0);
  });

  test("the SCHEMA is deliberately kept, and the status stays publicly unsafe", async () => {
    // The decision was "delete the code, keep the schema". An applied migration
    // is immutable in this repo, the column stays honest about what it will
    // hold, and it is where a future detector would write. A row that reached
    // the state by hand must still be refused a public reference.
    const migration = await Bun.file(MIGRATION).text();

    expect(migration).toContain("'orphaned'");
    expect(migration).toContain("orphaned_at");
    expect(isNewsMediaObjectSafeForPublicReference("orphaned")).toBe(false);
  });

  test("the grace-period setting is NOT deleted with it", async () => {
    // It looked dead and is not: `orphanInR2` — an R2 object with no DB row at
    // all — genuinely uses `NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS` to decide when
    // physical deletion is safe. Deleting it with the rest of D16 would have
    // removed a live control.
    const config = await Bun.file(
      "src/modules/media-library/domain/media-r2-config.ts"
    ).text();

    expect(config).toContain("NEWS_MEDIA_R2_ORPHAN_GRACE_DAYS");

    const reconciliation = stripComments(await Bun.file(RECONCILIATION).text());
    expect(reconciliation).toContain("isOrphanInR2EligibleForDeletion");
    expect(reconciliation).toContain("orphanGraceDays");
  });
});

describe("D17 — an ad row a renderer can actually use", () => {
  test("every read path resolves the media object in the same query", async () => {
    // Not an N+1 across the list, and not a second endpoint. The join is what
    // makes the resolved fields available at all, and it must be on every path
    // that produces the view — including the two WRITES, which use a
    // data-modifying CTE so a freshly created ad is not reported as
    // unreferenceable.
    const source = stripComments(await Bun.file(AD_DIRECTORY).text());
    const joins = source.split("LEFT JOIN awcms_news_media_objects").length - 1;

    // fetch by id, admin list, create, update.
    expect(joins).toBe(4);
    expect(source.split("WITH written AS").length - 1).toBe(2);
  });

  test("the verdict is computed server-side, never handed over as a status", async () => {
    // The rule turns on which lifecycle states count as verified, and a
    // consumer reimplementing it gets that wrong in the permissive direction —
    // which publishes an unverified image. So the endpoint answers the
    // QUESTION, not the input to it.
    const source = stripComments(await Bun.file(AD_DIRECTORY).text());

    expect(source).toContain("mediaPubliclyReferenceable");
    expect(source).toContain("isNewsMediaObjectSafeForPublicReference");
    // `media_status` is selected, but it must not reach the view.
    expect(source).not.toContain("mediaStatus: row.media_status");
  });

  test("the contract requires the three fields, so a consumer can rely on them", async () => {
    const spec = await Bun.file(
      "openapi/modules/blog-content.openapi.yaml"
    ).text();
    const schema = spec.slice(
      spec.indexOf("    AdPlacementItem:"),
      spec.indexOf("    AdPlacementCreateRequest:")
    );

    for (const field of [
      "mediaPublicUrl",
      "mediaAltText",
      "mediaPubliclyReferenceable"
    ]) {
      // Present as a property AND on `required` — an optional field is one a
      // consumer has to defend against, which is the state D17 describes.
      expect(schema, field).toContain(`        - ${field}`);
      expect(schema, field).toContain(`        ${field}:`);
    }
  });

  test("a soft-deleted media object leaves the placement visible and unsafe", async () => {
    // The reason the join is LEFT and its media predicate sits in the ON
    // clause. An INNER join would drop the broken placement from the one screen
    // that could repair it, which is the same class of silence D16 was about.
    const source = await Bun.file(AD_DIRECTORY).text();

    expect(source).toContain("LEFT JOIN awcms_news_media_objects m");
    expect(source).toContain("AND m.deleted_at IS NULL\n");
    // Null media columns must produce `false`, never `undefined`/`true`.
    expect(source).toContain("row.media_status !== null &&");
  });
});

describe("docs:i18n:stamp refuses to declare a mirror nobody re-translated", () => {
  // PROJECT_STATE §4, found while working. The marker says "this mirror was
  // translated from a source with this hash", and re-writing it is a CLAIM
  // about the translation. The tool used to make that claim unconditionally, so
  // "edit the English, run the stamp" turned `check:docs:translation` green over
  // an Indonesian mirror that still said the old thing — which happened, and was
  // caught by a test that counts `sql/NNN` ranges for an unrelated reason.
  const SCRIPT = "scripts/docs-i18n-stamp.mjs";

  test("the refusal exists and is reachable", async () => {
    const source = stripComments(await Bun.file(SCRIPT).text());

    expect(source).toContain("mayRestamp");
    expect(source).toContain("REFUSES to re-stamp");
    expect(source).toContain("process.exit(1)");
  });

  test("both allow-paths are the ones that mean the translation was looked at", async () => {
    const source = stripComments(await Bun.file(SCRIPT).text());

    // 1. the mirror is modified/untracked in this working tree;
    expect(source).toContain("touched.has(mirrorPath)");
    // 2. the source changed only in whitespace since HEAD — the reflow case
    //    the tool was built for, where no translator needs to do anything.
    expect(source).toContain("withoutWhitespace(committed)");
    // and the deliberate override, for a reword the translation survives.
    expect(source).toContain("--force-restamp");
  });

  test("a missing HEAD version does not silently allow the re-stamp", async () => {
    // `committedContent` returns null for a file not in HEAD. Reading that as
    // "formatting-only" would reopen the hole for exactly the case where the
    // source is brand new and the mirror is not.
    const source = stripComments(await Bun.file(SCRIPT).text());

    expect(source).toContain("committed !== null &&");
  });
});
