/**
 * Integration tests for `idn_admin_regions` (ADR-0046, migrations sql/080 +
 * sql/081) against a real PostgreSQL under the ephemeral-database harness.
 * These prove the claims a typecheck cannot:
 *
 *   1. The two tables really are GLOBAL — no `tenant_id` column, RLS not
 *      forced — because that is a deliberate exception to this repo's default
 *      and would otherwise be indistinguishable from an oversight.
 *   2. "Only one dataset can be active" is enforced by the DATABASE (the partial
 *      unique index), not by application code a second connection could race.
 *   3. Import → activate → rollback works end to end on real rows, and rollback
 *      restores the PREVIOUS version rather than re-importing anything.
 *   4. Lookup resolves the active dataset by default, honours tier/parent/search
 *      filters, paginates by keyset, and reports "no active dataset" as a reason
 *      rather than an indistinguishable empty list.
 *
 * Skipped unless a real database is configured (see tests/integration/harness.ts).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  getAdminSql,
  integrationEnabled,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import {
  commitDatasetImport,
  deriveDatasetCode,
  type DatasetImportPlan
} from "../../src/modules/idn-admin-regions/application/dataset-import";
import {
  activateDataset,
  DatasetLifecycleError,
  getActiveDataset,
  listDatasets,
  rollbackActiveDataset
} from "../../src/modules/idn-admin-regions/application/dataset-lifecycle";
import {
  getRegionByCode,
  queryRegions
} from "../../src/modules/idn-admin-regions/application/region-lookup";
import { normalizeRegionRows } from "../../src/modules/idn-admin-regions/domain/region-normalization";

const suite = integrationEnabled ? describe : describe.skip;

/**
 * Runs a service function against the pooled admin connection.
 *
 * Deliberately NOT `sql.begin(...)`: no other integration test in this repo
 * opens an explicit transaction, and doing so here starved the 4-connection
 * admin pool — the run hung with every connection idle after COMMIT. What these
 * tests are proving is behaviour and DATABASE-level constraints (the partial
 * unique index, the grants, the absence of RLS), none of which need the caller
 * to hold a transaction. Import atomicity is a property of the production path,
 * where the job opens the transaction.
 */
function asTx<T>(
  sql: Bun.SQL,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return fn(sql as unknown as Bun.TransactionSQL);
}

/** A miniature but STRUCTURALLY complete hierarchy: all four tiers, real codes. */
const SAMPLE_ROWS = [
  { code: "11", name: "Aceh", lineNumber: 1 },
  { code: "11.01", name: "Kabupaten Aceh Selatan", lineNumber: 2 },
  { code: "11.01.01", name: "Bakongan", lineNumber: 3 },
  { code: "11.01.01.2001", name: "Keude Bakongan", lineNumber: 4 },
  { code: "11.01.01.2002", name: "Ujong Mangki", lineNumber: 5 },
  { code: "31", name: "Daerah Khusus Ibukota Jakarta", lineNumber: 6 },
  { code: "31.71", name: "Kota Administrasi Jakarta Pusat", lineNumber: 7 },
  { code: "31.71.01", name: "Gambir", lineNumber: 8 },
  { code: "31.71.01.1001", name: "Gambir", lineNumber: 9 }
];

function planFor(suffix: string): DatasetImportPlan {
  const { regions } = normalizeRegionRows(SAMPLE_ROWS);
  const countsByType: Record<string, number> = {};
  for (const region of regions) {
    countsByType[region.regionType] =
      (countsByType[region.regionType] ?? 0) + 1;
  }

  return {
    datasetCode: deriveDatasetCode(`commit${suffix}`, `sha256${suffix}`),
    sourceFile:
      "data/idn-admin-regions/upstream/cahyadsn-wilayah/db/wilayah.sql",
    sourceFileSha256: `sha256${suffix}`,
    sourceCommitSha: `commit${suffix}`,
    decreeReference: "Kepmendagri No 300.2.2-2138 Tahun 2025",
    rowCount: regions.length,
    countsByType,
    errors: [],
    regions
  };
}

suite("idn_admin_regions (real PostgreSQL)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    const sql = getAdminSql();
    await sql.unsafe("DELETE FROM awcms_idn_admin_regions");
    await sql.unsafe("DELETE FROM awcms_idn_region_datasets");
  });

  test("both tables are GLOBAL: no tenant_id column, no forced RLS", async () => {
    const sql = getAdminSql();

    const columns = (await sql.unsafe(`
      SELECT table_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name = 'tenant_id'
        AND table_name IN ('awcms_idn_region_datasets', 'awcms_idn_admin_regions')
    `)) as { table_name: string }[];

    expect(columns).toEqual([]);

    const rls = (await sql.unsafe(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('awcms_idn_region_datasets', 'awcms_idn_admin_regions')
    `)) as {
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }[];

    expect(rls).toHaveLength(2);
    for (const row of rls) {
      expect(row.relrowsecurity).toBe(false);
      expect(row.relforcerowsecurity).toBe(false);
    }
  });

  test("neither runtime role may DELETE — a dataset is superseded, never deleted", async () => {
    const sql = getAdminSql();

    const grants = (await sql.unsafe(`
      SELECT grantee, privilege_type, table_name
      FROM information_schema.role_table_grants
      WHERE table_name IN ('awcms_idn_region_datasets', 'awcms_idn_admin_regions')
        AND grantee IN ('awcms_app', 'awcms_worker')
    `)) as { grantee: string; privilege_type: string; table_name: string }[];

    expect(grants.some((grant) => grant.privilege_type === "DELETE")).toBe(
      false
    );
    // And the request-path role must not be able to INSERT regions: that path
    // belongs to the worker job alone.
    expect(
      grants.some(
        (grant) =>
          grant.grantee === "awcms_app" &&
          grant.table_name === "awcms_idn_admin_regions" &&
          grant.privilege_type !== "SELECT"
      )
    ).toBe(false);
  });

  test("import writes one dataset plus its regions, landing `validated` (never active)", async () => {
    const sql = getAdminSql();

    const result = await asTx(sql, (tx) =>
      commitDatasetImport(tx, planFor("a"))
    );

    expect(result.rowCount).toBe(SAMPLE_ROWS.length);
    expect(result.status).toBe("validated");
    expect(await getActiveDataset(sql)).toBeNull();

    const rows = (await sql.unsafe(
      "SELECT count(*)::int AS count FROM awcms_idn_admin_regions"
    )) as { count: number }[];
    expect(rows[0]?.count).toBe(SAMPLE_ROWS.length);
  });

  test("the single-active rule is enforced by the database, not by application code", async () => {
    const sql = getAdminSql();

    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("a")));
    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("b")));

    const datasets = await listDatasets(sql);
    expect(datasets).toHaveLength(2);

    await asTx(sql, (tx) => activateDataset(tx, datasets[0]!.id));

    // Bypassing the service entirely — a raw UPDATE that would create a second
    // active dataset must be rejected by the partial unique index itself.
    //
    // Written as try/catch, NOT `await expect(query).rejects.toThrow()`: a
    // `Bun.SQL` query object is lazy, and handing it to `.rejects` never
    // executed it — the test hung until the timeout killed it rather than
    // failing. Awaiting the query directly is what runs it.
    let violation: unknown;

    try {
      await sql.unsafe(
        `UPDATE awcms_idn_region_datasets SET status = 'active' WHERE id = '${datasets[1]!.id}'`
      );
    } catch (error) {
      violation = error;
    }

    expect(violation).toBeInstanceOf(Error);
    expect(String(violation)).toContain(
      "awcms_idn_region_datasets_single_active"
    );
  });

  test("activation supersedes the previous dataset and is idempotent on repeat", async () => {
    const sql = getAdminSql();

    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("a")));
    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("b")));

    const [second, first] = await listDatasets(sql);

    const firstActivation = await asTx(sql, (tx) =>
      activateDataset(tx, first!.id)
    );
    expect(firstActivation.changed).toBe(true);

    const repeat = await asTx(sql, (tx) => activateDataset(tx, first!.id));
    expect(repeat.changed).toBe(false);

    const swap = await asTx(sql, (tx) => activateDataset(tx, second!.id));
    expect(swap.supersededId).toBe(first!.id);
    expect((await getActiveDataset(sql))?.id).toBe(second!.id);
  });

  test("rollback restores the previously active dataset without touching its rows", async () => {
    const sql = getAdminSql();

    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("a")));
    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("b")));

    const [second, first] = await listDatasets(sql);

    await asTx(sql, (tx) => activateDataset(tx, first!.id));
    await asTx(sql, (tx) => activateDataset(tx, second!.id));

    const rolledBack = await asTx(sql, (tx) => rollbackActiveDataset(tx));

    expect(rolledBack.dataset.id).toBe(first!.id);
    expect(rolledBack.rolledBackFromId).toBe(second!.id);

    // Both versions' rows are still present — rollback is a status flip.
    const rows = (await sql.unsafe(
      "SELECT count(*)::int AS count FROM awcms_idn_admin_regions"
    )) as { count: number }[];
    expect(rows[0]?.count).toBe(SAMPLE_ROWS.length * 2);
  });

  test("rollback with no earlier activation refuses instead of guessing", async () => {
    const sql = getAdminSql();

    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("a")));
    const [only] = await listDatasets(sql);
    await asTx(sql, (tx) => activateDataset(tx, only!.id));

    await expect(asTx(sql, (tx) => rollbackActiveDataset(tx))).rejects.toThrow(
      DatasetLifecycleError
    );
  });

  test("lookup defaults to the active dataset and filters by tier, parent, and name", async () => {
    const sql = getAdminSql();

    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("a")));
    const [dataset] = await listDatasets(sql);
    await asTx(sql, (tx) => activateDataset(tx, dataset!.id));

    const provinces = await queryRegions(sql, { level: 1 });
    expect(provinces.items.map((item) => item.code)).toEqual(["11", "31"]);
    expect(provinces.datasetCode).toBe(dataset!.datasetCode);

    const children = await queryRegions(sql, { parentCode: "11.01.01" });
    expect(children.items.map((item) => item.name)).toEqual([
      "Keude Bakongan",
      "Ujong Mangki"
    ]);

    const search = await queryRegions(sql, { search: "jakarta" });
    expect(
      search.items.every((item) => item.name.toLowerCase().includes("jakarta"))
    ).toBe(true);

    const one = await getRegionByCode(sql, "31.71.01.1001");
    expect(one.region?.fullPathName).toBe(
      "Daerah Khusus Ibukota Jakarta, Kota Administrasi Jakarta Pusat, Gambir, Gambir"
    );
    expect(one.region?.localTerm).toBe("Kelurahan");
  });

  test("keyset pagination walks the whole set without repeating or dropping a row", async () => {
    const sql = getAdminSql();

    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("a")));
    const [dataset] = await listDatasets(sql);
    await asTx(sql, (tx) => activateDataset(tx, dataset!.id));

    const seen: string[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < 10; page += 1) {
      const result = await queryRegions(sql, { limit: 2, afterCode: cursor });
      seen.push(...result.items.map((item) => item.code));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(SAMPLE_ROWS.length);
    expect(new Set(seen).size).toBe(SAMPLE_ROWS.length);
  });

  test("with nothing activated, lookup answers with a REASON rather than a bare empty list", async () => {
    const sql = getAdminSql();

    await asTx(sql, (tx) => commitDatasetImport(tx, planFor("a")));

    const result = await queryRegions(sql, {});
    expect(result.items).toEqual([]);
    expect(result.reason).toBe("no_active_dataset");

    const named = await queryRegions(sql, { datasetCode: "does-not-exist" });
    expect(named.reason).toBe("dataset_not_found");
  });
});
