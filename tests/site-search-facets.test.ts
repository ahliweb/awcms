/**
 * Facet counts on the public search endpoint (Issue #607 for content type,
 * #633 for terms).
 *
 * ## What is at risk, and it is not the arithmetic
 *
 * 1. **That the neutral payload stays neutral.** `GET /api/v1/site-search/query`
 *    is anonymous and answers an unresolved host, a disabled tenant and a
 *    zero-result query with the SAME body, on purpose. A `facets` key present in
 *    one shape and absent in another re-opens exactly the distinction that
 *    payload exists to close.
 * 2. **That a facet is never narrowed by its OWN filter, while every other
 *    filter still applies.** A facet answers "what else is there". Applying
 *    `resourceType` to the type counts zeroes every other value the moment a
 *    reader picks one, and a list of zeroes gives them no way back to results
 *    that still exist. Issue #633 generalized this the moment there was more
 *    than one facet: the type counts now DO apply the term filters, and each
 *    term facet applies the type filter and every term filter but its own.
 *    That is why the signature stopped being an `Omit` — it has to be told
 *    about the filters it is going to leave out.
 * 3. **That it shares every OTHER predicate with the results.** A count derived
 *    from a wider predicate advertises documents the reader cannot reach.
 *
 * The cross-tenant negative — a count must never include another tenant's rows —
 * needs a real database and lives in
 * `tests/integration/site-search.integration.test.ts`.
 *
 * Pure — no database.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, test } from "bun:test";

import { stripComments } from "../scripts/access-chokepoint-check";

const ROUTE = "src/pages/api/v1/site-search/query.ts";
const SERVICE = "src/modules/site-search/application/search-service.ts";
const FRAGMENT = "openapi/modules/site-search.openapi.yaml";

describe("the neutral payload stays one shape", () => {
  test("every return path from the route carries facets", async () => {
    const source = stripComments(await readFile(ROUTE, "utf8"));

    // Three shapes: rejected query, real answer, and the unresolved/disabled
    // fallback. Each must name `facets`, or the body tells a caller which one
    // it got.
    const returns = [...source.matchAll(/facets/g)].length;

    expect(returns).toBeGreaterThanOrEqual(4);
    // One named constant rather than a repeated literal, so the two neutral
    // payloads cannot drift apart one edit at a time — and it must carry BOTH
    // keys, because a `terms`-less shape distinguishes the same two states the
    // whole neutral payload exists to make identical.
    expect(source).toContain(
      "const EMPTY_FACETS = { resourceTypes: [], terms: {} }"
    );
    expect(source).toContain("facets: EMPTY_FACETS");
    expect(source).toContain("facets,");
  });

  test("the contract marks facets required, not optional", async () => {
    const fragment = await readFile(FRAGMENT, "utf8");
    const start = fragment.indexOf("SiteSearchQueryResult:");

    expect(start).toBeGreaterThan(-1);

    const block = fragment.slice(start, fragment.indexOf("SiteSearchFacets:"));

    // Optional would let a client branch on its presence, which is the same
    // leak as omitting it.
    expect(block).toContain("- facets");
  });
});

describe("the facet query is the result query minus its own filter", () => {
  test("it applies tenant, locale, the tsquery and the allow-list", async () => {
    const source = stripComments(await readFile(SERVICE, "utf8"));
    const start = source.indexOf("export async function countSearchFacets");

    expect(start).toBeGreaterThan(-1);

    const body = source.slice(start, source.indexOf("export", start + 10));

    expect(body).toContain("d.tenant_id = ${tenantId}");
    expect(body).toContain("d.locale = ${options.locale}");
    expect(body).toContain(
      "d.search_vector @@ websearch_to_tsquery('simple', ${options.query})"
    );
    expect(body).toContain("d.resource_type = ANY(");
  });

  test("the TYPE counts still do not apply the resourceType filter", async () => {
    const source = stripComments(await readFile(SERVICE, "utf8"));
    const start = source.indexOf("export async function countSearchFacets");
    const body = source.slice(start, source.indexOf("export", start + 10));
    const typeQuery = body.slice(
      body.indexOf("SELECT d.resource_type AS value"),
      body.indexOf("const terms")
    );

    expect(typeQuery.length).toBeGreaterThan(0);
    // The type facet's own filter, and only its own: the term filters ARE
    // applied here (#633), because they are somebody else's facet.
    expect(typeQuery).not.toContain("options.resourceType");
    expect(typeQuery).not.toContain("d.resource_type = ${typeFilter}");
    expect(typeQuery).toContain("typeFacetTermFilter");
  });

  test("a TERM facet applies the type filter and every term filter but its own", async () => {
    const source = stripComments(await readFile(SERVICE, "utf8"));
    const start = source.indexOf("async function countTermFacetRows");

    expect(start).toBeGreaterThan(-1);

    const body = source.slice(start, source.indexOf("\nexport", start));

    // `exclude` is the facet being counted. Passing it into the operand builder
    // is the ENTIRE mechanism — if this call ever loses its second argument,
    // every filtered facet silently collapses to one value with the count of
    // the current selection, which looks plausible on screen.
    expect(body).toContain("buildTermFilterOperand(");
    expect(body).toContain("exclude ?? undefined");
    expect(body).toContain("d.resource_type = ${typeFilter}");
    expect(body).toContain("d.tenant_id = ${tenantId}");
    expect(body).toContain("d.locale = ${options.locale}");
    expect(body).toContain(
      "d.search_vector @@ websearch_to_tsquery('simple', ${options.query})"
    );
  });

  test("the result query filters by the SAME operand the facets exclude from", async () => {
    const source = stripComments(await readFile(SERVICE, "utf8"));
    const start = source.indexOf("export async function searchSiteContent");
    const body = source.slice(start, source.indexOf("\nexport", start + 10));

    // One builder, one containment operator, in both places. Two spellings of
    // "carries this term" would eventually disagree, and the disagreement would
    // show up as counts that do not match the list under them.
    expect(body).toContain("buildTermFilterOperand(options.termFilters)");
    expect(body).toContain("d.term_facets @> ${termFilter}::jsonb");
  });

  test("the value list is bounded", async () => {
    const source = stripComments(await readFile(SERVICE, "utf8"));

    // A public anonymous body whose length is decided by however many resource
    // types the registry grows to is a body with no ceiling.
    expect(source).toContain("MAX_FACET_VALUES");
    expect(source).toContain("LIMIT ${MAX_FACET_VALUES}");
  });

  test("the two queries run sequentially on the shared transaction", async () => {
    const source = stripComments(await readFile(ROUTE, "utf8"));

    // Concurrent queries on one transaction connection leak it — the rule every
    // admin screen here already follows.
    expect(source).not.toContain("Promise.all");
    expect(source).toContain("await countSearchFacets(");
  });
});
