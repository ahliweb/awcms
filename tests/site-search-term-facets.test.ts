/**
 * Issue #633 — term facets (channel, topic, institution, region).
 *
 * ## What was actually blocking them, and why it is worth restating here
 *
 * PRD FR-DSC-002 asks for six facets. #632 landed content type alone, and not
 * for want of time: `awcms_site_search_documents.tags` is filled from the
 * descriptor's `tagsColumn`, and `tagsColumn` names ONE COLUMN ON THE SOURCE
 * TABLE. Since `sql/131`, channel and topic are `awcms_blog_terms` rows reached
 * through `awcms_blog_post_terms`, and institution is `awcms_blog_institutions`
 * reached through `awcms_blog_post_institutions`. A column name cannot express a
 * join. There was no value `tagsColumn` could have been given that was correct.
 *
 * So the fix is a contract change, and a contract whose every field is
 * interpolated into SQL is a contract that needs its gate in the same change.
 * That is most of what this file tests.
 *
 * Pure — no database. The counts themselves, and the cross-tenant negative, need
 * real Postgres and live in `tests/integration/site-search.integration.test.ts`.
 */
import { describe, expect, test } from "bun:test";

import {
  buildExtractionQuery,
  computeDocumentChecksum,
  mapRowToDocument,
  MAX_TERM_FACETS_PER_DOCUMENT
} from "../src/modules/site-search/domain/search-document";
import {
  collectTermFacetKeys,
  validateSearchSourceRegistry
} from "../src/modules/site-search/domain/search-source-registry";
import { parseTermFilters } from "../src/modules/site-search/domain/search-query";
import { buildTermFilterOperand } from "../src/modules/site-search/application/search-service";
import { collectDescriptorTables } from "../scripts/site-search-sources-check";
import { listModules } from "../src/modules";
import type {
  ModuleDescriptor,
  SearchSourceDescriptor,
  SearchSourceTermFacet
} from "../src/modules/_shared/module-contract";

const TENANT = "11111111-1111-4111-8111-111111111111";

function descriptor(
  termFacets?: readonly SearchSourceTermFacet[]
): SearchSourceDescriptor {
  return {
    key: "blog_content.post",
    ownerModuleKey: "blog_content",
    resourceType: "blog_post",
    tableName: "awcms_blog_posts",
    localeColumn: "locale",
    updatedAtColumn: "updated_at",
    titleColumn: "title",
    bodyColumns: ["content_text"],
    urlTemplate: "/blog/:tenantCode/:slug",
    slugColumn: "slug",
    publicationFilter: { equals: { status: "published" } },
    weight: 1,
    privacyClassification: "public",
    ...(termFacets ? { termFacets } : {})
  };
}

const CHANNEL_FACET: SearchSourceTermFacet = {
  facetKey: "channel",
  kind: "join",
  linkTable: "awcms_blog_post_terms",
  linkSourceColumn: "post_id",
  linkValueColumn: "term_id",
  valueTable: "awcms_blog_terms",
  valueIdColumn: "id",
  valueColumn: "slug",
  labelColumn: "name",
  valueEquals: { taxonomy_type: "channel" },
  valueNullColumns: ["deleted_at"]
};

function moduleWith(descriptors: SearchSourceDescriptor[]): ModuleDescriptor[] {
  return [
    {
      key: "blog_content",
      name: "Blog",
      version: "1.0.0",
      status: "active",
      description: "test",
      dependencies: [],
      type: "domain",
      searchSources: descriptors
    } as unknown as ModuleDescriptor
  ];
}

describe("the extraction query", () => {
  test("a source with no facets is byte-identical apart from an empty column", () => {
    const built = buildExtractionQuery(TENANT, descriptor(), {
      mode: "batch",
      cursorId: null,
      batchSize: 10
    });

    // No subquery, no extra parameter — a source that declares nothing pays
    // nothing.
    expect(built.text).toContain("'[]'::jsonb AS term_facets");
    expect(built.text).not.toContain("jsonb_agg");
    expect(built.values).toEqual([TENANT, "published", 10]);
  });

  test("a join facet binds the tenant on BOTH tables", () => {
    const built = buildExtractionQuery(TENANT, descriptor([CHANNEL_FACET]), {
      mode: "batch",
      cursorId: null,
      batchSize: 10
    });

    // A join is the one place a row from another tenant could be reached
    // without the outer predicate noticing. RLS would also catch it; that is
    // not a reason to leave the predicate out of a public, anonymous surface
    // where a count discloses content without showing it.
    expect(built.text).toContain("AND v.tenant_id = $1");
    expect(built.text).toContain("WHERE l.tenant_id = $1");
  });

  test("the facet key and every valueEquals value are BOUND, never interpolated", () => {
    const built = buildExtractionQuery(TENANT, descriptor([CHANNEL_FACET]), {
      mode: "batch",
      cursorId: null,
      batchSize: 10
    });

    expect(built.values).toContain("channel");
    expect(built.values).toContain("channel"); // facetKey and taxonomy_type both
    expect(built.text).not.toContain("'channel'");
    expect(built.text).toContain("taxonomy_type = $");
  });

  test("parameter numbering survives a facet sitting between the filter and the cursor", () => {
    const built = buildExtractionQuery(TENANT, descriptor([CHANNEL_FACET]), {
      mode: "batch",
      cursorId: "cursor-id",
      batchSize: 7
    });

    // The facet binds two params between the publication filter and the
    // cursor/limit. If the counter and the push order ever disagree, the query
    // still PARSES — it just filters by the wrong values, which is the kind of
    // defect that reaches production.
    const highest = Math.max(
      ...[...built.text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]))
    );

    expect(highest).toBe(built.values.length);
    expect(built.values).toEqual([
      TENANT,
      "published",
      "channel",
      "channel",
      "cursor-id",
      7
    ]);
  });

  test("a column facet needs no join and no link table", () => {
    const built = buildExtractionQuery(
      TENANT,
      descriptor([
        { facetKey: "region", kind: "column", valueColumn: "region_code" }
      ]),
      { mode: "batch", cursorId: null, batchSize: 10 }
    );

    expect(built.text).not.toContain("jsonb_agg");
    expect(built.text).toContain("awcms_blog_posts.region_code");
    // An empty string is as absent as NULL: it would produce a clickable filter
    // that matches nothing.
    expect(built.text).toContain(
      "btrim(awcms_blog_posts.region_code::text) = ''"
    );
  });

  test("an unsafe identifier throws at build time even if the gate were bypassed", () => {
    expect(() =>
      buildExtractionQuery(
        TENANT,
        descriptor([
          {
            ...CHANNEL_FACET,
            valueColumn: "slug; DROP TABLE awcms_blog_posts; --"
          }
        ]),
        { mode: "batch", cursorId: null, batchSize: 10 }
      )
    ).toThrow(/unsafe/);
  });
});

describe("mapping a row", () => {
  const base = {
    id: "post-1",
    locale: "id",
    updated_at: new Date("2026-01-01T00:00:00Z"),
    title: "Judul",
    summary: null,
    body: null,
    tags: null,
    slug: "judul"
  };

  test("duplicates collapse and order is stable", () => {
    const doc = mapRowToDocument(
      descriptor([CHANNEL_FACET]),
      {
        ...base,
        term_facets: [
          { facet: "topic", value: "pemilu", label: "Pemilu" },
          { facet: "channel", value: "politik", label: "Politik" },
          { facet: "channel", value: "politik", label: "Politik" }
        ]
      },
      { tenantCode: "t" }
    );

    // Two source rows can legitimately carry the same term; a facet list that
    // repeated a value would render two identical filter chips. The sort is
    // what keeps the checksum from changing because Postgres aggregated the
    // same set in a different order.
    expect(doc.termFacets).toEqual([
      { facet: "channel", value: "politik", label: "Politik" },
      { facet: "topic", value: "pemilu", label: "Pemilu" }
    ]);
  });

  test("a missing label falls back to the value", () => {
    const doc = mapRowToDocument(
      descriptor(),
      { ...base, term_facets: [{ facet: "region", value: "62.71" }] },
      { tenantCode: "t" }
    );

    // Not an error: a `kind: "column"` facet may have no label column, and the
    // value is then the honest display text.
    expect(doc.termFacets).toEqual([
      { facet: "region", value: "62.71", label: "62.71" }
    ]);
  });

  test("entries without a facet or a value are dropped", () => {
    const doc = mapRowToDocument(
      descriptor(),
      {
        ...base,
        term_facets: [
          { facet: "channel", value: "" },
          { facet: "", value: "politik" },
          null,
          "not an object",
          { facet: "channel", value: "politik", label: "Politik" }
        ]
      },
      { tenantCode: "t" }
    );

    expect(doc.termFacets).toHaveLength(1);
  });

  test("the per-document list is bounded", () => {
    const doc = mapRowToDocument(
      descriptor(),
      {
        ...base,
        term_facets: Array.from({ length: 500 }, (_, i) => ({
          facet: "topic",
          value: `t-${i}`,
          label: `T ${i}`
        }))
      },
      { tenantCode: "t" }
    );

    // A post filed under five hundred topics would otherwise put five hundred
    // entries into the row AND into every facet count derived from it.
    expect(doc.termFacets).toHaveLength(MAX_TERM_FACETS_PER_DOCUMENT);
  });

  test("a non-array column yields no facets rather than throwing", () => {
    expect(
      mapRowToDocument(
        descriptor(),
        { ...base, term_facets: null },
        { tenantCode: "t" }
      ).termFacets
    ).toEqual([]);
  });
});

describe("the checksum", () => {
  const fields = {
    resourceType: "blog_post",
    resourceId: "1",
    locale: "id",
    url: "/blog/t/x",
    title: "T",
    summary: null,
    bodyText: null,
    tags: [] as string[],
    weight: 1
  };

  test("a document with no facets hashes exactly as it did before #633", () => {
    // Otherwise the first reconcile after deploying this rewrites every
    // document in every tenant to store an identical row.
    expect(computeDocumentChecksum(fields)).toBe(
      computeDocumentChecksum({ ...fields, termFacets: [] })
    );
  });

  test("moving a post between channels changes the checksum", () => {
    // The checksum is the ONLY thing deciding whether an upsert rewrites a row.
    // Without the facets in it, a re-index reports "unchanged" and the facet
    // keeps counting the post under its old channel forever.
    const before = computeDocumentChecksum({
      ...fields,
      termFacets: [{ facet: "channel", value: "politik", label: "Politik" }]
    });
    const after = computeDocumentChecksum({
      ...fields,
      termFacets: [{ facet: "channel", value: "ekonomi", label: "Ekonomi" }]
    });

    expect(before).not.toBe(after);
  });

  test("relabelling a channel also changes it", () => {
    // The label is stored on the document and returned to readers, so a rename
    // that did not reindex would show the old name next to the new count.
    expect(
      computeDocumentChecksum({
        ...fields,
        termFacets: [{ facet: "channel", value: "politik", label: "Politik" }]
      })
    ).not.toBe(
      computeDocumentChecksum({
        ...fields,
        termFacets: [
          {
            facet: "channel",
            value: "politik",
            label: "Politik & Pemerintahan"
          }
        ]
      })
    );
  });
});

describe("the registry gate grows with the contract", () => {
  const invalid = (facet: unknown) =>
    validateSearchSourceRegistry(
      moduleWith([descriptor([facet as SearchSourceTermFacet])])
    );

  test("the real registry is valid", () => {
    expect(validateSearchSourceRegistry(listModules()).valid).toBe(true);
  });

  test("it rejects a link or value table outside awcms_", () => {
    expect(invalid({ ...CHANNEL_FACET, linkTable: "pg_catalog" }).valid).toBe(
      false
    );
    expect(invalid({ ...CHANNEL_FACET, valueTable: "pg_user" }).valid).toBe(
      false
    );
  });

  test("it rejects an injection-shaped identifier in every join position", () => {
    for (const field of [
      "linkSourceColumn",
      "linkValueColumn",
      "valueIdColumn",
      "valueColumn",
      "labelColumn",
      "tenantColumn"
    ] as const) {
      const result = invalid({ ...CHANNEL_FACET, [field]: "x; DROP TABLE y" });
      expect(result.valid).toBe(false);
    }
  });

  test("it rejects an injection-shaped key in valueEquals", () => {
    expect(
      invalid({
        ...CHANNEL_FACET,
        valueEquals: { "taxonomy_type = 'x' OR 1=1 --": "channel" }
      }).valid
    ).toBe(false);
  });

  test("it rejects an unknown kind", () => {
    expect(invalid({ facetKey: "channel", kind: "view" }).valid).toBe(false);
  });

  test("it rejects two facets sharing one name", () => {
    // They would silently merge in the response, and the reader would see one
    // list built from two vocabularies.
    const result = validateSearchSourceRegistry(
      moduleWith([
        descriptor([
          CHANNEL_FACET,
          { ...CHANNEL_FACET, valueEquals: { taxonomy_type: "topic" } }
        ])
      ])
    );

    expect(result.valid).toBe(false);
    expect(
      result.issues.some((i) => i.message.includes("declared more than once"))
    ).toBe(true);
  });

  test("a facetKey that is not snake_case is rejected", () => {
    // It travels verbatim into a public response body and a query string.
    expect(invalid({ ...CHANNEL_FACET, facetKey: "Channel Name" }).valid).toBe(
      false
    );
  });
});

describe("the column is written as jsonb, not as a jsonb string", () => {
  test("the upsert binds the array itself", async () => {
    const source = await Bun.file(
      "src/modules/site-search/application/search-index-engine.ts"
    ).text();

    // Bun JSON-ENCODES a string parameter bound to a jsonb slot, so
    // `${JSON.stringify(x)}::jsonb` stores the jsonb SCALAR STRING `"[]"`.
    // `sql/140`'s `jsonb_typeof = 'array'` CHECK is what turns that into an
    // error instead of a silence — but the write should be right in the first
    // place, and this is what keeps it that way.
    expect(source).toContain("${doc.termFacets}::jsonb");
    expect(source).not.toContain("JSON.stringify(doc.termFacets)");
  });
});

describe("the grants gate walks joined tables too", () => {
  test("a join facet contributes its link and value tables", () => {
    // This is the #625 failure one layer deeper: a descriptor whose facet joins
    // a table `awcms_worker` cannot SELECT is green here and red at 03:00.
    expect(collectDescriptorTables(descriptor([CHANNEL_FACET]))).toEqual([
      "awcms_blog_post_terms",
      "awcms_blog_posts",
      "awcms_blog_terms"
    ]);
  });

  test("a column facet contributes nothing extra", () => {
    expect(
      collectDescriptorTables(
        descriptor([
          { facetKey: "region", kind: "column", valueColumn: "region_code" }
        ])
      )
    ).toEqual(["awcms_blog_posts"]);
  });
});

describe("request parsing", () => {
  const keys = collectTermFacetKeys(listModules());

  test("the real registry declares the four PRD dimensions", () => {
    expect(keys).toEqual(["channel", "institution", "region", "topic"]);
  });

  test("an undeclared parameter is ignored, not passed through", () => {
    // Without the allow-list, every query-string key would reach the jsonb
    // containment operand, and an anonymous caller could probe the index's
    // shape by watching the result count.
    const params = new URLSearchParams(
      "channel=politik&secret_facet=x&utm_source=facebook"
    );

    expect(parseTermFilters(params, keys)).toEqual({ channel: "politik" });
  });

  test("only the first value of a repeated key is used", () => {
    // `?channel=a&channel=b` is ambiguous between "either" and "both"; picking
    // one silently would eventually make the count and the list disagree.
    expect(
      parseTermFilters(new URLSearchParams("channel=a&channel=b"), keys)
    ).toEqual({ channel: "a" });
  });

  test("blank and over-long values are dropped", () => {
    expect(
      parseTermFilters(new URLSearchParams("channel=%20%20"), keys)
    ).toEqual({});
    expect(
      parseTermFilters(new URLSearchParams(`topic=${"x".repeat(201)}`), keys)
    ).toEqual({});
  });
});

describe("the filter operand", () => {
  test("nothing to filter by is null, not an empty array", () => {
    // `term_facets @> '[]'` is TRUE for every row, so an empty array would be a
    // no-op that still costs an index probe — and `null` is what the
    // `IS NULL OR` shape in both queries expects.
    expect(buildTermFilterOperand(null)).toBeNull();
    expect(buildTermFilterOperand({})).toBeNull();
    expect(buildTermFilterOperand({ channel: "" })).toBeNull();
  });

  test("several filters become ONE containment operand", () => {
    expect(
      buildTermFilterOperand({ channel: "politik", topic: "pemilu" })
    ).toEqual([
      { facet: "channel", value: "politik" },
      { facet: "topic", value: "pemilu" }
    ]);
  });

  test("the operand is an ARRAY, never a JSON string", () => {
    // Bun JSON-ENCODES a string parameter bound to a jsonb slot, so a
    // stringified operand compares against the jsonb SCALAR STRING and matches
    // nothing — silently, because `@>` against a scalar is false rather than an
    // error. The filter would return zero results and the facet counts beside
    // it would quietly go to zero, which looks exactly like "no matches".
    const operand = buildTermFilterOperand({ channel: "politik" });

    expect(Array.isArray(operand)).toBe(true);
    expect(typeof operand).not.toBe("string");
  });

  test("excluding a facet removes only that one", () => {
    // This is the entire mechanism behind "a facet does not narrow itself".
    expect(
      buildTermFilterOperand({ channel: "politik", topic: "pemilu" }, "channel")
    ).toEqual([{ facet: "topic", value: "pemilu" }]);
  });

  test("excluding the only filter yields null", () => {
    expect(
      buildTermFilterOperand({ channel: "politik" }, "channel")
    ).toBeNull();
  });
});
