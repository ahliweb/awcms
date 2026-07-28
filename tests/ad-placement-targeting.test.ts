import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  AD_TARGET_TYPES,
  isAdTargetType
} from "../src/modules/blog-content/domain/ad-placement-policy";

/**
 * ADR-0044 §4, first step: widen `awcms_news_portal_ad_placements` so it can
 * express everything the free-URL system could, BEFORE any row moves and
 * before `awcms_blog_ads` is dropped.
 *
 * The promise this file guards is a sequencing promise, and sequencing is
 * exactly what a typecheck and a green test suite cannot see. Widening after
 * the drop, or bundling the drop into this migration, would destroy per-post
 * and per-page ad targeting with every gate still green — the ads would simply
 * stop appearing on the pages they were bought for, and nothing would say so.
 *
 * So the assertions below are about what migration 078 does and, just as
 * importantly, what it must NOT yet do.
 */
const MIGRATION_PATH = "sql/078_awcms_ad_placement_targeting.sql";
const MIGRATION = readFileSync(MIGRATION_PATH, "utf8");

describe("migration 078 — ad placement targeting", () => {
  test("adds both targeting columns", () => {
    expect(MIGRATION).toContain(
      "ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'global'"
    );
    expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS target_id uuid");
  });

  test("the target vocabulary in SQL matches the domain vocabulary exactly", () => {
    // Two independent declarations of the same closed set — the CHECK
    // constraint and `AD_TARGET_TYPES` — will drift the moment someone adds a
    // type to one of them. Whichever side is behind then rejects rows the
    // other accepts, and the failure surfaces as a raw Postgres error at write
    // time rather than as a field error the editor can act on.
    const check = MIGRATION.match(/target_type IN \(([^)]*)\)/);
    expect(check).not.toBeNull();

    const inSql = check![1]!
      .split(",")
      .map((value) => value.trim().replace(/^'|'$/g, ""))
      .sort();

    expect(inSql).toEqual([...AD_TARGET_TYPES].sort());

    for (const targetType of inSql) {
      expect(isAdTargetType(targetType)).toBe(true);
    }
  });

  test("the pairing rule is a database CHECK, not application-only", () => {
    // The retired `awcms_blog_ad_placements` left `target_id` plainly nullable
    // and enforced the pairing only in `domain/ad-policy.ts`. That holds
    // exactly as long as every writer goes through that validator — a migration,
    // a backfill script, or a future direct INSERT does not.
    expect(MIGRATION).toContain(
      "awcms_news_portal_ad_placements_target_pairing_check"
    );
    expect(MIGRATION).toContain("target_type = 'global' AND target_id IS NULL");
    expect(MIGRATION).toContain(
      "target_type <> 'global' AND target_id IS NOT NULL"
    );
  });

  test("constraints are dropped before being added, so the file is re-runnable", () => {
    for (const constraint of [
      "awcms_news_portal_ad_placements_target_type_check",
      "awcms_news_portal_ad_placements_target_pairing_check"
    ]) {
      const dropIndex = MIGRATION.indexOf(
        `DROP CONSTRAINT IF EXISTS ${constraint}`
      );
      const addIndex = MIGRATION.indexOf(`ADD CONSTRAINT ${constraint}`);

      expect(dropIndex).toBeGreaterThan(-1);
      expect(addIndex).toBeGreaterThan(dropIndex);
    }
  });

  test("the replacement index is created BEFORE the old one is dropped", () => {
    // Reversed, there is a window inside the migration transaction with no
    // index serving the render query at all. Harmless on a small table, and
    // exactly the kind of ordering nobody notices until the table is not small.
    const createIndex = MIGRATION.indexOf(
      "CREATE INDEX IF NOT EXISTS awcms_news_portal_ad_placements_tenant_target_idx"
    );
    const dropIndex = MIGRATION.indexOf(
      "DROP INDEX IF EXISTS awcms_news_portal_ad_placements_tenant_key_idx"
    );

    expect(createIndex).toBeGreaterThan(-1);
    expect(dropIndex).toBeGreaterThan(createIndex);
  });

  test("the replacement index leads with the columns the dropped one indexed", () => {
    // This is what makes dropping the old index safe rather than merely tidy:
    // a composite index serves any query its LEADING columns satisfy. Reorder
    // these and the drop silently removes an index nothing replaces.
    expect(MIGRATION).toContain(
      "(tenant_id, placement_key, target_type, target_id)"
    );
  });

  test("moves no data and drops no table — the ingest and the drop are later steps", () => {
    // ADR-0044 §4 sequences this deliberately: widen, then ingest with a
    // dry-runnable residue report, then drop. A DML statement here would mean
    // rows moved before anyone could preview what would fail to move, and the
    // ADR is explicit that an ad vanishing from a live site with no record is
    // worse than one that fails to migrate loudly.
    const statements = MIGRATION.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .toUpperCase();

    for (const forbidden of [
      "INSERT INTO",
      "UPDATE ",
      "DELETE FROM",
      "DROP TABLE"
    ]) {
      expect(statements).not.toContain(forbidden);
    }
  });

  test("both legacy ad tables are still present in the schema", () => {
    // The counterpart to the assertion above, stated positively: until the
    // ingest job has run in production and its residue report has been read,
    // these tables are the only copy of the free-URL ads.
    const schema = readFileSync(
      "sql/037_awcms_blog_content_presentation_schema.sql",
      "utf8"
    );

    expect(schema).toContain("CREATE TABLE IF NOT EXISTS awcms_blog_ads");
    expect(schema).toContain(
      "CREATE TABLE IF NOT EXISTS awcms_blog_ad_placements"
    );
  });
});
