/**
 * Trigger and SECURITY DEFINER functions cannot be fed a temp-table shadow
 * (Issue #1046).
 *
 * `awcms_app` and `awcms_worker` hold TEMP, and PostgreSQL resolves an
 * unqualified relation name through `pg_temp` BEFORE `public`. A guard that
 * reads `awcms_inventory_movements` without pinning `search_path` therefore
 * reads whatever table its caller `CREATE TEMP TABLE`-d under that name -- the
 * mechanism by which #1032's workflow triggers were bypassed.
 *
 * Three things are proved here against a real, fully migrated database:
 *
 *   1. ATTACK: as the runtime role, shadow the table the transfer-balance
 *      constraint trigger reads, commit one real unpaired leg, and require the
 *      guard to refuse it anyway. This fails on a database migrated without
 *      `sql/296`.
 *   2. BACKSTOP: every trigger / SECURITY DEFINER function in `public` carries
 *      a `proconfig` `search_path` whose last element is `pg_temp`, read from
 *      `pg_proc` itself rather than from the SQL text.
 *   3. PARSER PARITY: the set the static gate
 *      (`db:function-search-path:check`) judges equals the set `pg_proc`
 *      reports, so a function the parser cannot see cannot hide.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
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
  appRoleActivated,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import {
  foldFunctions,
  isInScope
} from "../../scripts/db-function-search-path-check";
import { loadMigrations } from "../../scripts/lib/migrations";

const TENANT = "a1046000-0000-4000-8000-00000000000a";

type ProcRow = { proname: string; proconfig: string[] | null };

async function inScopeFunctions(): Promise<ProcRow[]> {
  return (await getAdminSql()`
    SELECT p.proname, p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.prorettype = 'pg_catalog.trigger'::regtype OR p.prosecdef)
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
    ORDER BY p.proname
  `) as ProcRow[];
}

function pinnedPath(config: string[] | null): string[] | null {
  const entry = config?.find((item) => item.startsWith("search_path="));

  return entry
    ? entry
        .slice("search_path=".length)
        .split(",")
        .map((part) => part.trim().replace(/^"|"$/g, ""))
    : null;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("function search_path pinning (Issue #1046)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  describe("catalogue backstop", () => {
    test("every trigger / SECURITY DEFINER function ends with search_path ... pg_temp", async () => {
      const rows = await inScopeFunctions();

      expect(rows.length).toBeGreaterThan(50);

      const unpinned = rows
        .filter((row) => {
          const path = pinnedPath(row.proconfig);

          return path === null || path[path.length - 1] !== "pg_temp";
        })
        .map((row) => row.proname);

      expect(unpinned).toEqual([]);
    });

    test("the static gate judges exactly the functions pg_proc reports", async () => {
      const { functions } = foldFunctions(loadMigrations());
      const fromSql = [...functions.values()]
        .filter(isInScope)
        .map((state) => state.name);
      const fromCatalogue = (await inScopeFunctions()).map(
        (row) => row.proname
      );

      expect([...new Set(fromSql)].sort()).toEqual(
        [...new Set(fromCatalogue)].sort()
      );
    });
  });

  describe("temp-table shadowing", () => {
    let locationOut = "";
    let locationIn = "";

    beforeEach(async () => {
      await resetDatabase();

      const sql = getAdminSql();

      await sql`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${TENANT}, 'sp-1046', 'Search path 1046')
      `;

      const locations = (await sql`
        INSERT INTO awcms_inventory_locations (tenant_id, code, name)
        VALUES (${TENANT}, 'out', 'Out'), (${TENANT}, 'in', 'In')
        RETURNING id, code
      `) as { id: string; code: string }[];

      locationOut = locations.find((row) => row.code === "out")!.id;
      locationIn = locations.find((row) => row.code === "in")!.id;
    });

    test("the runtime role really holds TEMP (the premise of the attack)", async () => {
      expect(appRoleActivated).toBe(true);

      const rows = (await getRuntimeSql()`
        SELECT has_database_privilege(current_user, current_database(), 'TEMP') AS ok
      `) as { ok: boolean }[];

      expect(rows[0]!.ok).toBe(true);
    });

    test("a temp-table shadow cannot launder an unpaired transfer leg past the balance guard", async () => {
      const attack = getRuntimeSql().begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant_id = '${TENANT}'`);

        // The shadow: same name, in pg_temp, holding a BALANCED pair for the
        // transfer the real table will only hold one leg of.
        await tx.unsafe(`
          CREATE TEMP TABLE awcms_inventory_movements (
            tenant_id uuid, transfer_id uuid, movement_type text,
            quantity_delta numeric, item_type text, item_ref text,
            unit_code text, location_id uuid
          ) ON COMMIT DROP
        `);

        const transferId = crypto.randomUUID();

        await tx.unsafe(
          `INSERT INTO pg_temp.awcms_inventory_movements VALUES
             ($1, $2, 'transfer_out', -1, 'x.y', 'orphan', 'unit', $3),
             ($1, $2, 'transfer_in',   1, 'x.y', 'orphan', 'unit', $4)`,
          [TENANT, transferId, locationOut, locationIn]
        );

        // The real, UNPAIRED leg -- schema-qualified so it reaches the real table.
        await tx.unsafe(
          `INSERT INTO public.awcms_inventory_movements
             (tenant_id, location_id, item_type, item_ref, unit_code,
              movement_type, quantity_delta, balance_after, source_type,
              source_id, operation, transfer_id, request_fingerprint)
           VALUES ($1, $2, 'x.y', 'orphan', 'unit', 'transfer_out', -1, -1,
                   'raw', 'raw-1046', 'transfer_out', $3, 'f')`,
          [TENANT, locationOut, transferId]
        );
      });

      // The deferred constraint trigger fires at COMMIT and must refuse (23514).
      await expect(attack).rejects.toMatchObject({ errno: "23514" });

      const rows = (await getAdminSql()`
        SELECT count(*)::int AS n FROM public.awcms_inventory_movements
        WHERE tenant_id = ${TENANT}
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(0);
    });
  });
});
