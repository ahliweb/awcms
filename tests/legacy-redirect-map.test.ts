/**
 * Legacy provenance and the 301 map derived from it (Issue #599).
 *
 * ## What is at risk
 *
 * 23,906 URLs that search engines have indexed for years. The map that keeps
 * their ranking has to be DERIVED from what each article was, not guessed from
 * what it is called now — a slug moves when an editor fixes a headline, and it
 * moves precisely for the articles interesting enough to have inbound links.
 *
 * Pinned here without a database: the SQL predicate that decides which rows are
 * mappable, the fact that the writer is not on the editorial API, and the
 * migration constraints that make a double import impossible.
 *
 * The DB-level behaviour (the partial unique index actually refusing a second
 * claim) belongs to an integration test; what a pure test can hold is that the
 * constraint is WRITTEN and that the query asks for the right rows.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";

const MIGRATION = "sql/138_awcms_blog_legacy_provenance.sql";
const DROP_MIGRATION = "sql/147_awcms_blog_pages_drop_legacy_provenance.sql";
const DIRECTORY = "src/modules/blog-content/application/blog-post-directory.ts";
const CREATE_VALIDATION =
  "src/modules/blog-content/domain/blog-post-validation.ts";

describe("the columns make a second import impossible", () => {
  test("the pair is unique per tenant, and the index is PARTIAL", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    expect(sql).toContain("awcms_blog_posts_legacy_source_dedup");
    expect(sql).toContain(
      "ON awcms_blog_posts (tenant_id, legacy_source_system, legacy_source_id)"
    );
    // Without the WHERE, every natively-authored post (both columns NULL)
    // satisfies it trivially and the index protects nothing it was added for.
    expect(sql).toContain("WHERE legacy_source_id IS NOT NULL");
  });

  test("both columns or neither", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    // A row naming a system without an id cannot be looked up; an id without a
    // system is the ambiguity the pair exists to remove.
    expect(sql).toContain("legacy_provenance_check");
    expect(sql).toContain(
      "(legacy_source_system IS NULL AND legacy_source_id IS NULL)"
    );
  });

  test("the pages half is DROPPED, and nothing reads it", async () => {
    // `sql/138` gave pages the same pair on the reasoning that "a legacy
    // archive has static pages too". Nothing ever wrote or read it. This test
    // used to assert that the migration's TEXT contained
    // `ALTER TABLE awcms_blog_pages` — which reads as coverage, and is not:
    // a test over a migration's source proves a column exists, and cannot
    // notice the column is dead.
    //
    // The real legacy `.htaccess` settled it: the static-page rewrite covers a
    // CLOSED SET OF THREE urls, which is three hand-authored rules in
    // `awcms_seo_redirects`, not an importer. `sql/147` drops the pair.
    const drop = await readFile(DROP_MIGRATION, "utf8");

    expect(drop).toContain("ALTER TABLE awcms_blog_pages");
    expect(drop).toContain("DROP COLUMN IF EXISTS legacy_source_system");
    expect(drop).toContain("DROP COLUMN IF EXISTS legacy_source_id");
    expect(drop).toContain(
      "DROP INDEX IF EXISTS awcms_blog_pages_legacy_source_dedup"
    );

    // The live half is untouched: dropping both would take the 301 map with it.
    expect(drop).not.toContain("ALTER TABLE awcms_blog_posts");
  });

  test("no code reads the dropped columns off a page", async () => {
    // The assertion the old test could not make. A column with no reader is
    // how the pages half looked covered for as long as it did, so the guard
    // against re-adding one is a search for a READER, not for a migration line.
    const sources = await Promise.all(
      [DIRECTORY, CREATE_VALIDATION].map((f) => readFile(f, "utf8"))
    );

    for (const source of sources) {
      expect(stripComments(source)).not.toContain("awcms_blog_pages");
    }
  });

  test("the id is text, not an integer", async () => {
    const sql = await readFile(MIGRATION, "utf8");

    // `id_ber` is numeric; the next system's identifier will be a uuid, a slug
    // or a path. Nothing does arithmetic on it.
    expect(sql).toMatch(/legacy_source_id text/);
  });
});

describe("provenance is written by an importer, not by an editor", () => {
  test("it is not a field on the editorial create input", async () => {
    const source = stripComments(await readFile(CREATE_VALIDATION, "utf8"));

    // Putting it there would let any caller holding `posts.create` claim an
    // article came from somewhere it did not — and the 301 map is derived from
    // exactly that claim.
    expect(source).not.toContain("legacySourceId");
    expect(source).not.toContain("legacySourceSystem");
  });

  test("the writer exists and is its own function", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    expect(source).toContain("export async function recordLegacyProvenance");
    expect(source).toContain("legacy_source_system = ${provenance.system}");
  });
});

describe("the map asks for exactly the rows a redirect may point at", () => {
  test("published, undeleted, and carrying provenance", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));
    const start = source.indexOf(
      "export async function listLegacyRedirectMappings"
    );

    expect(start).toBeGreaterThan(-1);

    const body = source.slice(start);

    // A redirect pointing at a draft sends a crawler to a 404, which is worse
    // than the 404 it already had.
    expect(body).toContain("status = 'published'");
    expect(body).toContain("deleted_at IS NULL");
    expect(body).toContain("legacy_source_id IS NOT NULL");
    expect(body).toContain("legacy_source_system = ${options.system}");
  });

  test("it is paged and bounded, never one 23,906-row result", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    expect(source).toContain("LEGACY_REDIRECT_MAP_LIMIT");
    expect(source).toContain("legacy_source_id > ${after}");
    expect(source).toContain("ORDER BY legacy_source_id ASC");
  });

  test("the legacy URL shape is a parameter, not a hard-coded literal", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    // `/news/{id_ber}_{slug}.html` belongs to the system being migrated FROM.
    // Hard-coding it would make the second migration a code change.
    expect(source).toContain("pathTemplate");
    expect(source).toContain('replace("{legacyId}"');
    expect(source).toContain('replace("{slug}"');
    expect(source).not.toContain("_${row.slug}.html");
  });

  test("the target is this repo's own public post path", async () => {
    const source = stripComments(await readFile(DIRECTORY, "utf8"));

    // ADR-0009 — path-tenant-scoped. A map targeting `/news/**` would point at
    // a route family ADR-0071 deleted.
    expect(source).toContain("`/blog/${options.tenantCode}/${row.slug}`");
  });
});
