/**
 * `site_search` search-source registry (ADR-0040 §3, ported from awcms-micro
 * Issue #270) plus the pure query builders the registry protects.
 *
 * Why the identifier assertions matter more than they look: the extraction
 * engine INTERPOLATES a descriptor's table/column names into SQL (values are
 * always bound). The registry gate + `assertSafeIdentifier` are therefore the
 * only thing standing between a mis-declared descriptor and a malformed or
 * injected query, which is why they are asserted from both directions — a valid
 * descriptor passes, and each individually invalid field is named in the issue
 * list rather than silently accepted.
 */
import { describe, expect, test } from "bun:test";

import { listModules } from "../src/modules";
import type {
  ModuleDescriptor,
  SearchSourceDescriptor
} from "../src/modules/_shared/module-contract";
import {
  buildDocumentUrl,
  buildExtractionQuery,
  buildSourceCountQuery,
  buildStaleRemovalQuery,
  computeDocumentChecksum,
  mapRowToDocument
} from "../src/modules/site-search/domain/search-document";
import {
  assertSafeIdentifier,
  assertSafeTableName,
  collectSearchSourceDescriptors,
  validateSearchSourceRegistry
} from "../src/modules/site-search/domain/search-source-registry";

const GOOD: SearchSourceDescriptor = {
  key: "blog_content.post",
  ownerModuleKey: "blog_content",
  resourceType: "blog_post",
  tableName: "awcms_blog_posts",
  localeColumn: "locale",
  updatedAtColumn: "updated_at",
  titleColumn: "title",
  summaryColumn: "excerpt",
  bodyColumns: ["content_text"],
  tagsColumn: null,
  urlTemplate: "/blog/:tenantCode/:slug",
  slugColumn: "slug",
  publicationFilter: {
    equals: { status: "published", visibility: "public" },
    nullColumns: ["deleted_at"],
    notNullColumns: ["published_at"],
    timeReachedColumns: ["published_at"]
  },
  weight: 1,
  privacyClassification: "public"
};

function moduleWith(
  sources: SearchSourceDescriptor[],
  key = "blog_content"
): ModuleDescriptor {
  return {
    key,
    name: "Fixture",
    version: "1.0.0",
    status: "active",
    description: "",
    dependencies: [],
    searchSources: sources
  };
}

describe("validateSearchSourceRegistry — aggregation + validation (ADR-0040 §3)", () => {
  test("the live base registry validates cleanly", () => {
    const result = validateSearchSourceRegistry(listModules());
    expect(result.valid).toBe(true);
    expect(result.descriptors.length).toBeGreaterThanOrEqual(1);
  });

  test("collect flattens every module's searchSources in listModules order", () => {
    const descriptors = collectSearchSourceDescriptors(listModules());
    expect(descriptors.some((d) => d.key === "blog_content.post")).toBe(true);
  });

  test("blog_content — and only blog_content — declares a source in this base", () => {
    const owners = listModules()
      .filter((m) => (m.searchSources ?? []).length > 0)
      .map((m) => m.key);
    expect(owners).toEqual(["blog_content"]);
  });

  test("site_search itself declares NO search source — it is the consumer, not a provider", () => {
    const siteSearch = listModules().find((m) => m.key === "site_search");
    expect(siteSearch).toBeDefined();
    expect(siteSearch!.searchSources ?? []).toHaveLength(0);
  });

  test("a further content module can contribute a valid source without base edits", () => {
    const extra = moduleWith(
      [
        {
          ...GOOD,
          key: "example_shop.product",
          ownerModuleKey: "example_shop",
          resourceType: "product",
          tableName: "awcms_example_products"
        }
      ],
      "example_shop"
    );
    const result = validateSearchSourceRegistry([...listModules(), extra]);
    expect(result.valid).toBe(true);
  });

  test("ownerModuleKey must equal the declaring module's key", () => {
    const bad = moduleWith([{ ...GOOD, ownerModuleKey: "someone_else" }]);
    const result = validateSearchSourceRegistry([bad]);
    expect(result.valid).toBe(false);
    expect(result.issues[0]!.message).toContain("ownerModuleKey");
  });

  test("duplicate key across the registry is flagged", () => {
    const result = validateSearchSourceRegistry([moduleWith([GOOD, GOOD])]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.message.includes("registered 2 times"))
    ).toBe(true);
  });

  test("two sources reading the same table as the same resource type are flagged", () => {
    const result = validateSearchSourceRegistry([
      moduleWith([GOOD, { ...GOOD, key: "blog_content.post_alias" }])
    ]);
    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) =>
        i.message.includes("would produce duplicate documents")
      )
    ).toBe(true);
  });

  test("bad identifiers / table name / weight / privacy are each named", () => {
    const bad = moduleWith([
      {
        ...GOOD,
        key: "blog_content.bad",
        tableName: "not_prefixed",
        titleColumn: "DROP TABLE",
        weight: 99,
        privacyClassification: "private" as unknown as "public"
      }
    ]);
    const result = validateSearchSourceRegistry([bad]);
    expect(result.valid).toBe(false);
    const combined = result.issues.map((i) => i.message).join(" ");
    expect(combined).toContain("tableName");
    expect(combined).toContain("titleColumn");
    expect(combined).toContain("weight");
    expect(combined).toContain("privacyClassification");
  });

  test("urlTemplate using :slug requires slugColumn", () => {
    const bad = moduleWith([
      { ...GOOD, key: "blog_content.noslug", slugColumn: null }
    ]);
    const result = validateSearchSourceRegistry([bad]);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("slugColumn"))).toBe(
      true
    );
  });

  test("a urlTemplate carrying a scheme or a wildcard is rejected", () => {
    for (const urlTemplate of [
      "https://evil.example/:slug",
      "/blog/:slug?x=1",
      "javascript:alert(1)"
    ]) {
      const result = validateSearchSourceRegistry([
        moduleWith([{ ...GOOD, key: "blog_content.badurl", urlTemplate }])
      ]);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.message.includes("urlTemplate"))).toBe(
        true
      );
    }
  });
});

describe("assertSafeIdentifier / assertSafeTableName — SQL-injection gate", () => {
  test("accepts snake_case, rejects anything else", () => {
    expect(assertSafeIdentifier("content_text", "col")).toBe("content_text");
    expect(() => assertSafeIdentifier("a; DROP TABLE x", "col")).toThrow();
    expect(() => assertSafeIdentifier("Title", "col")).toThrow();
    expect(assertSafeTableName("awcms_blog_posts")).toBe("awcms_blog_posts");
    expect(() => assertSafeTableName("pg_catalog.pg_tables")).toThrow();
    // The gate is LEXICAL, not a catalog lookup: it enforces the `awcms_`
    // prefix so a descriptor can never name a system or third-party relation.
    // An unprefixed name is rejected here; a well-formed but non-existent
    // `awcms_*` name is caught by PostgreSQL at query time instead.
    expect(() => assertSafeTableName("blog_posts")).toThrow();
    expect(() => assertSafeTableName("information_schema")).toThrow();
  });
});

describe("buildExtractionQuery — parameterized, identifiers validated (ADR-0040 §3)", () => {
  test("batch query binds tenant + filter VALUES as parameters, not interpolated", () => {
    const { text, values } = buildExtractionQuery("tenant-1", GOOD, {
      mode: "batch",
      cursorId: null,
      batchSize: 100
    });
    expect(values).toContain("tenant-1");
    expect(values).toContain("published");
    expect(values).toContain("public");
    expect(text).toContain("$1");
    // Filter VALUES are bound parameters ($2, $3, ...), never interpolated.
    expect(text).not.toContain("'published'");
    // The publication predicate is present in full.
    expect(text).toContain("IS NULL");
    expect(text).toContain("IS NOT NULL");
    expect(text).toContain("<= now()");
    expect(text).toContain("awcms_blog_posts");
  });

  test("single-resource mode binds the resource id", () => {
    const { text, values } = buildExtractionQuery("t", GOOD, {
      mode: "single",
      resourceId: "res-1"
    });
    expect(values).toContain("res-1");
    expect(text).toContain("LIMIT 1");
  });

  test("count + stale-removal queries use the same predicate", () => {
    const count = buildSourceCountQuery("t", GOOD);
    expect(count.text).toContain("count(*)");
    expect(count.text).toContain("<= now()");
    const stale = buildStaleRemovalQuery("t", GOOD);
    expect(stale.text).toContain("NOT EXISTS");
    expect(stale.text).toContain("awcms_site_search_documents");
    expect(stale.text).toContain("<= now()");
  });

  test("an unsafe descriptor identifier throws before any SQL text is produced", () => {
    expect(() =>
      buildExtractionQuery(
        "t",
        { ...GOOD, titleColumn: "title; DROP TABLE x" },
        {
          mode: "batch",
          cursorId: null,
          batchSize: 10
        }
      )
    ).toThrow(/unsafe titleColumn identifier/);
  });
});

describe("buildDocumentUrl — every substituted value is encoded (path-safety)", () => {
  test("substitutes and encodes :tenantCode / :slug", () => {
    expect(
      buildDocumentUrl(GOOD, {
        slug: "hello-world",
        id: "1",
        tenantCode: "acme"
      })
    ).toBe("/blog/acme/hello-world");
  });

  test("a malicious slug cannot inject a new path segment or a traversal", () => {
    const evil = buildDocumentUrl(GOOD, {
      slug: "../../etc/passwd",
      id: "1",
      tenantCode: "acme"
    });
    expect(evil).not.toContain("../");
    expect(
      buildDocumentUrl(GOOD, { slug: "a/b", id: "1", tenantCode: "acme" })
    ).toBe("/blog/acme/a%2Fb");
  });

  test("a tenant code is encoded too, so it cannot escape its own segment", () => {
    expect(
      buildDocumentUrl(GOOD, { slug: "s", id: "1", tenantCode: "a/b" })
    ).toBe("/blog/a%2Fb/s");
  });

  test("a :tenantCode template with no tenant code THROWS rather than emitting a literal placeholder", () => {
    expect(() =>
      buildDocumentUrl(GOOD, { slug: "s", id: "1", tenantCode: null })
    ).toThrow(/requires a tenantCode/);
  });

  test("a template without :tenantCode needs none", () => {
    const hostResolved = { ...GOOD, urlTemplate: "/news/:slug" };
    expect(buildDocumentUrl(hostResolved, { slug: "x", id: "1" })).toBe(
      "/news/x"
    );
  });
});

describe("computeDocumentChecksum / mapRowToDocument", () => {
  test("checksum is deterministic and content-sensitive, ignores updated_at", () => {
    const fields = {
      resourceType: "blog_post",
      resourceId: "1",
      locale: "en",
      url: "/blog/acme/x",
      title: "T",
      summary: "S",
      bodyText: "B",
      tags: ["a"],
      weight: 1
    };
    const a = computeDocumentChecksum(fields);
    expect(a).toBe(computeDocumentChecksum(fields));
    expect(a).not.toBe(computeDocumentChecksum({ ...fields, title: "T2" }));
    // The URL is part of the checksum, so a tenant-code rename re-indexes.
    expect(a).not.toBe(
      computeDocumentChecksum({ ...fields, url: "/blog/other/x" })
    );
  });

  test("mapRowToDocument truncates, cleans control chars, builds url + checksum", () => {
    const row = {
      id: "res-1",
      locale: "en",
      updated_at: new Date("2026-01-01T00:00:00Z"),
      title: `Hello${String.fromCharCode(0)}World`,
      summary: "sum",
      body: "b".repeat(20000),
      tags: ["x", "y"],
      slug: "hello-world"
    };
    const doc = mapRowToDocument(GOOD, row, { tenantCode: "acme" });
    expect(doc.title).toBe("Hello World");
    expect(doc.bodyText!.length).toBeLessThanOrEqual(16000);
    expect(doc.url).toBe("/blog/acme/hello-world");
    expect(doc.tags).toEqual(["x", "y"]);
    expect(doc.tagsText).toBe("x y");
    expect(doc.sourceChecksum).toMatch(/^[a-f0-9]{64}$/);
  });
});
