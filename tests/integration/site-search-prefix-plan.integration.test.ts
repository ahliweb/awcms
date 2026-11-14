/**
 * Query-plan facts for the prefix `to_tsquery` predicate (ADR-0040 amendment,
 * prefix matching on the last token), measured from BOTH postures that matter.
 *
 * ## Two postures, two different answers
 *
 * 1. INDEX SUITABILITY (superuser, RLS bypassed): `search_vector @@ tsquery`
 *    with a `:*` operand is a shape the GIN index
 *    `awcms_site_search_documents_search_vector_idx` can serve. This proves the
 *    index and the predicate are compatible; it says NOTHING about production.
 * 2. WHAT RUNTIME ACTUALLY GETS (`awcms_app`, `FORCE ROW LEVEL SECURITY`, via
 *    `withTenantOrThrow(getRuntimeSql())`): the tenant policy is a security
 *    barrier, and the `@@` operator's function (`ts_match_vq`) is not
 *    LEAKPROOF, so the planner may not use it as an index condition below the
 *    barrier. The honest result is a tenant-bounded sequential scan, with
 *    `ts_rank` computed per candidate. This is true for the previous
 *    `websearch_to_tsquery` predicate too, so the prefix change widens the
 *    candidate set but does not introduce the scan. The test pins the fact so
 *    nobody claims the index serves production traffic, and so a follow-up that
 *    really fixes it (an explicit tenant-filtered read path, or a recorded
 *    LEAKPROOF decision by ADR) turns the test RED on purpose: flip the
 *    assertion then. Do NOT mark `ts_match_vq` LEAKPROOF without an ADR.
 *
 * The query text is bound as ONE parameter, exactly like `searchSiteContent`
 * does, and `enable_seqscan` is NOT turned off (with it off, "no Seq Scan" is
 * hollow). The fixture is VACUUM ANALYZEd: a GIN index's size statistics live
 * in its metapage and only VACUUM refreshes them.
 *
 * MUTATION PROOF: drop the GIN index -> the suitability cases go RED. Measure
 * the runtime case as the superuser again -> it goes RED (Bitmap Index Scan).
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
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  getAdminSql,
  getRuntimeSql,
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

type Posture = "superuser" | "runtime";

async function plan(
  sqlText: string,
  params: unknown[],
  posture: Posture
): Promise<{ nodes: PlanNode[]; text: string }> {
  const statement = `EXPLAIN (FORMAT JSON) ${sqlText}`;
  const rows = (
    posture === "superuser"
      ? await getAdminSql().unsafe(statement, params as never[])
      : await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
          tx.unsafe(statement, params as never[])
        )
  ) as { "QUERY PLAN": unknown }[];
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

  test("index suitability (superuser): a prefix operand is answered by the GIN index", async () => {
    await seed();
    const text = buildPrefixTsQuery("sungai kapu");
    expect(text).toBe("sungai & kapu:*");

    const { nodes, text: rendered } = await plan(
      PREDICATE,
      [TENANT, "id", text],
      "superuser"
    );

    expect(rendered).toContain("awcms_site_search_documents_search_vector_idx");
    expect(nodes.some((n) => n["Node Type"] === "Seq Scan")).toBe(false);
  });

  test("index suitability (superuser): an exact-only operand uses the same index", async () => {
    await seed();
    const { nodes, text: rendered } = await plan(
      PREDICATE,
      [TENANT, "id", buildPrefixTsQuery("sungai kapuas500")],
      "superuser"
    );

    expect(rendered).toContain("awcms_site_search_documents_search_vector_idx");
    expect(nodes.some((n) => n["Node Type"] === "Seq Scan")).toBe(false);
  });

  test("runtime posture (awcms_app, FORCE RLS): the GIN index is NOT used; the scan is tenant-bounded", async () => {
    await seed();
    for (const q of ["sungai kapu", "sungai kapuas500"]) {
      const { nodes, text: rendered } = await plan(
        PREDICATE,
        [TENANT, "id", buildPrefixTsQuery(q)],
        "runtime"
      );
      // Known limitation, see the header: `ts_match_vq` is not LEAKPROOF.
      expect(rendered).not.toContain(
        "awcms_site_search_documents_search_vector_idx"
      );
      expect(nodes.some((n) => n["Node Type"] === "Seq Scan")).toBe(true);
    }
  });
});
