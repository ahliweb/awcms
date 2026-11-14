/**
 * The prefix `to_tsquery` predicate is still served by the GIN index on
 * `awcms_site_search_documents.search_vector` (ADR-0040 amendment, prefix
 * matching on the last token).
 *
 * ## What this binds and why
 *
 * The query text is bound as ONE parameter, exactly like `searchSiteContent`
 * does. Substituting a literal would let the planner see the value at plan time
 * and prove nothing about the bound path, so the statement is run through the
 * extended protocol with `$n` placeholders.
 *
 * The plan is measured AS THE PLANNER CHOOSES IT. `enable_seqscan` is NOT turned
 * off: with it off, "no Seq Scan" is hollow, because the planner is forbidden
 * from picking one. The fixture is big enough, and the term selective enough,
 * that an index is the honest winner; the test asserts that the named GIN index
 * is the access path and that the table is not scanned sequentially.
 *
 * MUTATION PROOF: drop `awcms_site_search_documents_search_vector_idx` -> the
 * cases go RED with a `Seq Scan` in the plan.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { buildPrefixTsQuery } from "../../src/modules/site-search/domain/search-query";
import {
  getAdminSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";

const TENANT = "d5d5d5d5-d5d5-4d5d-8d5d-d5d5d5d5d5d5";
const DOCS = 6000;

type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  Plans?: PlanNode[];
};

function flatten(node: PlanNode, out: PlanNode[] = []): PlanNode[] {
  out.push(node);
  for (const child of node.Plans ?? []) flatten(child, out);
  return out;
}

async function plan(
  sqlText: string,
  params: unknown[]
): Promise<{ nodes: PlanNode[]; text: string }> {
  const rows = (await getAdminSql().unsafe(
    `EXPLAIN (FORMAT JSON) ${sqlText}`,
    params as never[]
  )) as { "QUERY PLAN": unknown }[];
  const raw = rows[0]!["QUERY PLAN"];
  const document = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
    Plan: PlanNode;
  }[];
  const nodes = flatten(document[0]!.Plan);
  const text = nodes
    .map(
      (n) =>
        `${n["Node Type"]}${n["Index Name"] ? ` using ${n["Index Name"]}` : ""}${n["Relation Name"] ? ` on ${n["Relation Name"]}` : ""}`
    )
    .join("\n");
  return { nodes, text };
}

const suite = integrationEnabled ? describe : describe.skip;

suite("site_search prefix query plan (integration)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seed(): Promise<void> {
    const admin = getAdminSql();
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
      VALUES (${TENANT}, 'd5-plan', 'D5 Plan', 'active')
    `;
    // Mostly common words, a few rare "kapuas*" words: a prefix on the rare
    // stem is selective, which is the case the index exists for.
    await admin.unsafe(
      `INSERT INTO awcms_site_search_documents
         (tenant_id, source_key, resource_type, resource_id, locale, url, title,
          body_text, source_updated_at, source_checksum)
       SELECT $1, 'blog_content.post', 'blog_post', 'r' || g, 'id',
              '/blog/d5-plan/p' || g,
              'Berita nomor ' || g,
              CASE WHEN g % 500 = 0 THEN 'sungai kapuas' || g
                   ELSE 'isi umum biasa ' || g END,
              now(), 'c' || g
       FROM generate_series(1, ${DOCS}) g`,
      [TENANT]
    );
    // VACUUM, not just ANALYZE: a GIN index's size statistics live in its
    // metapage and only VACUUM refreshes them. On a freshly built index the
    // planner costs the index as if it were empty-sized and picks a Seq Scan
    // for a perfectly selective term.
    await admin.unsafe("VACUUM ANALYZE awcms_site_search_documents");
  }

  const PREDICATE = `
    SELECT d.id FROM awcms_site_search_documents d
    WHERE d.tenant_id = $1 AND d.locale = $2
      AND d.search_vector @@ to_tsquery('simple', $3)`;

  test("a prefix operand is answered by the GIN index, with no sequential scan", async () => {
    await seed();
    const text = buildPrefixTsQuery("sungai kapu");
    expect(text).toBe("sungai & kapu:*");

    const { nodes, text: rendered } = await plan(PREDICATE, [
      TENANT,
      "id",
      text
    ]);

    expect(rendered).toContain("awcms_site_search_documents_search_vector_idx");
    expect(nodes.some((n) => n["Node Type"] === "Seq Scan")).toBe(false);
  });

  test("an exact-only operand (no prefix) uses the same index", async () => {
    await seed();
    const { nodes, text: rendered } = await plan(PREDICATE, [
      TENANT,
      "id",
      buildPrefixTsQuery("sungai kapuas500")
    ]);

    expect(rendered).toContain("awcms_site_search_documents_search_vector_idx");
    expect(nodes.some((n) => n["Node Type"] === "Seq Scan")).toBe(false);
  });
});
