/**
 * Query and plan budget for the `whatsapp.sender.progress` reads (Issue #1171,
 * security audit M-2d). Every open stream runs these every tick, so their cost
 * is multiplied by the connection count.
 *
 * ## What is measured
 *
 * - **Query budget:** `readSenderCounts`, `readSenderHead` and
 *   `readSenderChangesSince` are ONE statement each, for an unconfined and a
 *   confined (scope-filtered) caller, over a fixture far larger than any
 *   budget (22,000 rows).
 * - **Window:** counts include only messages created inside the counting
 *   window; 2,000 older rows of the same sender are excluded.
 * - **Plan, of the statement the stream really runs:** the PLAN is not read
 *   from a copied `EXPLAIN` (which would measure a hand-written twin of the
 *   query, bound differently). Instead the real function runs with its values
 *   bound exactly as the stream binds them, on one reserved connection, and the
 *   statistics collector says what it did: a `(tenant_id, sender_account_id)`
 *   index was scanned, and the table was NOT sequentially scanned.
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { countQueries } from "./query-budget";
import { seedMetaWabaContainer } from "./meta-waba-fixture";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  readSenderChangesSince,
  readSenderCounts,
  readSenderHead,
  zeroSenderCursor,
  type WhatsappSenderResource
} from "../../src/modules/whatsapp-delivery/application/whatsapp-sender-progress";

const TENANT = "f1171000-0000-4000-8000-000000000001";
const SENDER = "f1171000-0000-4000-8000-0000000000a1";
const OTHER_SENDER = "f1171000-0000-4000-8000-0000000000a2";
const BRAND_A = "f1171000-0000-4000-8000-0000000000b1";
const BRAND_B = "f1171000-0000-4000-8000-0000000000b2";

const IN_WINDOW = 2_000;
const OUT_OF_WINDOW = 2_000;
const OTHER_SENDER_ROWS = 18_000;
const ONE_STATEMENT = 1;

async function seed(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'rt-budget', 'Realtime Budget')
  `;

  for (const [id, external] of [
    [SENDER, "1171000001"],
    [OTHER_SENDER, "1171000002"]
  ] as const) {
    // Issue #1143: a Meta number sends only under a live WABA container.
    const wabaId = await seedMetaWabaContainer(
      admin,
      TENANT,
      `waba-${external}`
    );

    await admin`
      INSERT INTO awcms_channel_accounts
        (id, tenant_id, provider, account_kind, external_id, display_name,
         auth_mode, status, parent_account_id)
      VALUES (${id}, ${TENANT}, 'whatsapp_cloud', 'waba_phone_number',
              ${external}, ${`n-${external}`}, 'api_token', 'connected',
              ${wabaId})
    `;
  }

  // Even rows brand A, odd rows brand B; every 10th unscoped.
  const insert = async (sender: string, rows: number, ageDays: number) => {
    await admin`
      INSERT INTO awcms_whatsapp_messages
        (tenant_id, idempotency_key, template_key, purpose, recipient,
         recipient_hash, recipient_masked, body, status, sender_account_id,
         sender_selection, business_scope_type, business_scope_id,
         created_at, updated_at)
      SELECT ${TENANT}, ${`${sender}-${ageDays}-`} || g, 'it1171.t', 'transactional',
             '+6281200000000', 'k1:h', '+62*', 'x',
             (ARRAY['queued','sent','failed','sending'])[1 + g % 4],
             ${sender}, 'explicit',
             CASE WHEN g % 10 = 0 THEN NULL ELSE 'office' END,
             CASE WHEN g % 10 = 0 THEN NULL
                  WHEN g % 2 = 0 THEN ${BRAND_A}::uuid ELSE ${BRAND_B}::uuid END,
             now() - make_interval(days => ${ageDays}::int) - (g * interval '1 second'),
             now() - make_interval(days => ${ageDays}::int) - (g * interval '1 second')
      FROM generate_series(1, ${rows}) AS g
    `;
  };

  await insert(SENDER, IN_WINDOW, 1);
  await insert(SENDER, OUT_OF_WINDOW, 30);
  await insert(OTHER_SENDER, OTHER_SENDER_ROWS, 1);
  await admin`VACUUM ANALYZE awcms_whatsapp_messages`;
}

const unconfined: WhatsappSenderResource = {
  accountId: SENDER,
  scopeKeys: null
};
const confinedToA: WhatsappSenderResource = {
  accountId: SENDER,
  scopeKeys: [`office:${BRAND_A}`]
};

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "whatsapp sender progress reads: query and plan budget (#1171 M-2d)",
  () => {
    beforeAll(async () => {
      await setupIntegrationDatabase();
    });

    afterAll(async () => {
      await teardownIntegrationDatabase();
    });

    beforeEach(async () => {
      await resetDatabase();
      await seed();
    });

    test("each read is one statement; counts cover the window only and honour the row filter", async () => {
      const runtime = getRuntimeSql();

      for (const [resource, expectedTotal] of [
        [unconfined, IN_WINDOW],
        // Even g, not a multiple of 10: 1,000 even rows minus 200 unscoped.
        [confinedToA, 800]
      ] as const) {
        const counts = await withTenantOrThrow(runtime, TENANT, (tx) =>
          countQueries(tx, (counting) =>
            readSenderCounts(counting, TENANT, resource)
          )
        );

        expect(counts.queries).toBe(ONE_STATEMENT);
        expect(
          Object.values(counts.result).reduce((sum, n) => sum + n, 0)
        ).toBe(expectedTotal);

        const head = await withTenantOrThrow(runtime, TENANT, (tx) =>
          countQueries(tx, (counting) =>
            readSenderHead(counting, TENANT, resource)
          )
        );

        expect(head.queries).toBe(ONE_STATEMENT);

        const changes = await withTenantOrThrow(runtime, TENANT, (tx) =>
          countQueries(tx, (counting) =>
            readSenderChangesSince(
              counting,
              TENANT,
              resource,
              zeroSenderCursor(SENDER),
              50
            )
          )
        );

        expect(changes.queries).toBe(ONE_STATEMENT);
        expect(changes.result.items).toHaveLength(50);
        expect(changes.result.more).toBe(true);
      }

      // A confined caller holding nothing sees nothing (fail-closed).
      const none = await withTenantOrThrow(runtime, TENANT, (tx) =>
        readSenderCounts(tx, TENANT, { accountId: SENDER, scopeKeys: [] })
      );

      expect(Object.values(none).every((n) => n === 0)).toBe(true);
    });

    test("the real counts statement, bound as the stream binds it, reaches the sender through an index and never scans the table", async () => {
      const admin = getAdminSql();
      const connection = await admin.reserve();

      try {
        const stats = async () => {
          await connection`SELECT pg_stat_clear_snapshot()`;
          const rows = (await connection`
          SELECT
            (SELECT coalesce(sum(idx_scan), 0) FROM pg_stat_user_indexes
              WHERE indexrelname IN (
                'awcms_whatsapp_messages_sender_window_idx',
                'awcms_whatsapp_messages_sender_lane_idx',
                'awcms_whatsapp_messages_sender_progress_idx'
              ))::int AS sender_index_scans,
            (SELECT seq_scan FROM pg_stat_user_tables
              WHERE relname = 'awcms_whatsapp_messages')::int AS seq_scans
        `) as { sender_index_scans: number; seq_scans: number }[];

          return rows[0]!;
        };

        await connection`SELECT pg_stat_force_next_flush()`;
        const before = await stats();

        for (const resource of [unconfined, confinedToA]) {
          await connection.begin(async (tx) => {
            await tx`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;
            await readSenderCounts(tx, TENANT, resource);
          });
        }

        await connection`SELECT pg_stat_force_next_flush()`;
        const after = await stats();

        // Which (tenant, sender)-leading index the planner picks depends on its
        // estimates (asserting one by name would measure the planner, not the
        // query); what must hold is that the sender's rows are reached through
        // one, and the 22,000-row table is never scanned whole.
        expect(
          after.sender_index_scans - before.sender_index_scans
        ).toBeGreaterThanOrEqual(2);
        expect(after.seq_scans - before.seq_scans).toBe(0);
      } finally {
        connection.release();
      }
    });
  }
);
