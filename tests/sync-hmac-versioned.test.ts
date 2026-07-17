/**
 * Versioned sync HMAC signatures — security advisory GHSA-c972-3q5p-g3h4
 * (cross-tenant sync forgery).
 *
 * Two layers proved here:
 *  1. v2 signatures bind tenant + node into the signed material, so a signature
 *     minted for tenant A no longer verifies once `X-AWCMS-Tenant-ID` is swapped
 *     to tenant B.
 *  2. Legacy (v1) signatures are accepted only while `SYNC_HMAC_ALLOW_LEGACY`
 *     is not `false` — the operator off-switch that fully closes the hole.
 *  3. First-contact nodes auto-register `inactive` (real-PostgreSQL block,
 *     gated on `DATABASE_URL`), so a forged request for another tenant lands on
 *     a node the `status !== "active"` route gate rejects; an already-`active`
 *     node keeps working.
 *
 * No `mock.module` here: it mutates the live module namespace in place and
 * leaks into every test file that runs afterwards in the same process
 * (see memory `awcms-test-and-txn-traps`). `process.env` is snapshotted and
 * restored around each test for the same reason.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  computeSyncSignature,
  computeSyncSignatureV2,
  verifySyncSignatureV2
} from "../src/modules/sync-storage/domain/sync-hmac";
import {
  resolveOrRegisterSyncNode,
  verifySyncHeaders
} from "../src/modules/sync-storage/application/sync-auth";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const NODE = "kasir-1";
const SECRET = "shared-deployment-secret";

describe("computeSyncSignatureV2 binds tenant + node", () => {
  const timestamp = "2026-07-18T00:00:00.000Z";
  const body = "{}";

  test("a v2 signature for tenant A does not verify under tenant B", () => {
    const sig = computeSyncSignatureV2(SECRET, TENANT_A, NODE, timestamp, body);

    expect(
      verifySyncSignatureV2(SECRET, TENANT_A, NODE, timestamp, body, sig)
    ).toBe(true);
    // Swap the tenant id → different signed material → verification fails.
    expect(
      verifySyncSignatureV2(SECRET, TENANT_B, NODE, timestamp, body, sig)
    ).toBe(false);
  });

  test("a v2 signature for one node does not verify under another node", () => {
    const sig = computeSyncSignatureV2(SECRET, TENANT_A, NODE, timestamp, body);

    expect(
      verifySyncSignatureV2(
        SECRET,
        TENANT_A,
        "other-node",
        timestamp,
        body,
        sig
      )
    ).toBe(false);
  });

  test("v2 material differs from v1 material for the same inputs", () => {
    expect(
      computeSyncSignatureV2(SECRET, TENANT_A, NODE, timestamp, body)
    ).not.toBe(computeSyncSignature(SECRET, timestamp, body));
  });
});

describe("verifySyncHeaders (versioned)", () => {
  const ENV_KEYS = [
    "AWCMS_SYNC_ENABLED",
    "AWCMS_SYNC_HMAC_SECRET",
    "AWCMS_SYNC_MAX_SKEW_SEC",
    "SYNC_HMAC_ALLOW_LEGACY"
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
    }
    process.env.AWCMS_SYNC_ENABLED = "true";
    process.env.AWCMS_SYNC_HMAC_SECRET = SECRET;
    delete process.env.AWCMS_SYNC_MAX_SKEW_SEC;
    delete process.env.SYNC_HMAC_ALLOW_LEGACY;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  const freshTimestamp = () => new Date().toISOString();

  test("v2: accepts a correctly bound request", () => {
    const ts = freshTimestamp();
    const body = "{}";
    const sig = computeSyncSignatureV2(SECRET, TENANT_A, NODE, ts, body);

    const result = verifySyncHeaders(TENANT_A, NODE, ts, sig, "2", body);

    expect(result.ok).toBe(true);
  });

  test("v2: rejects a tenant-swapped request (the advisory attack)", () => {
    const ts = freshTimestamp();
    const body = "{}";
    // Attacker mints a valid v2 signature for their own tenant A ...
    const sig = computeSyncSignatureV2(SECRET, TENANT_A, NODE, ts, body);

    // ... then replays it with X-AWCMS-Tenant-ID swapped to tenant B.
    const result = verifySyncHeaders(TENANT_B, NODE, ts, sig, "2", body);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  test("v1: accepted while legacy is allowed (default)", () => {
    const ts = freshTimestamp();
    const body = "{}";
    const sig = computeSyncSignature(SECRET, ts, body);

    // No X-AWCMS-Signature-Version header → legacy path.
    const result = verifySyncHeaders(TENANT_A, NODE, ts, sig, null, body);

    expect(result.ok).toBe(true);
  });

  test("v1: rejected once SYNC_HMAC_ALLOW_LEGACY=false (off-switch)", () => {
    process.env.SYNC_HMAC_ALLOW_LEGACY = "false";
    const ts = freshTimestamp();
    const body = "{}";
    const sig = computeSyncSignature(SECRET, ts, body);

    const result = verifySyncHeaders(TENANT_A, NODE, ts, sig, null, body);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  test("v2: still accepted when legacy is disabled", () => {
    process.env.SYNC_HMAC_ALLOW_LEGACY = "false";
    const ts = freshTimestamp();
    const body = "{}";
    const sig = computeSyncSignatureV2(SECRET, TENANT_A, NODE, ts, body);

    const result = verifySyncHeaders(TENANT_A, NODE, ts, sig, "2", body);

    expect(result.ok).toBe(true);
  });
});

// --- Real-PostgreSQL: node auto-registration is quarantined `inactive` -------

const DATABASE_URL =
  process.env.SYNC_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

describeOrSkip("resolveOrRegisterSyncNode (real PostgreSQL)", () => {
  let sql: Bun.SQL;
  const createdTenantIds: string[] = [];

  async function createTenant(label: string): Promise<string> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const rows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`sync-${label}-${suffix}`}, ${`Sync HMAC test ${label}`})
      RETURNING id
    `) as { id: string }[];
    const tenantId = rows[0]!.id;
    createdTenantIds.push(tenantId);
    return tenantId;
  }

  /** Mirrors `withTenant`: pins the tenant GUC inside one transaction. */
  async function inTenant<T>(
    tenantId: string,
    fn: (tx: Bun.SQL) => Promise<T>
  ): Promise<T> {
    return sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(tx as unknown as Bun.SQL);
    });
  }

  beforeAll(() => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 5 });
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      await sql`DELETE FROM awcms_sync_nodes WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }
    await sql.close({ timeout: 5 });
  });

  test("a first-contact node auto-registers as inactive (not active)", async () => {
    const tenantId = await createTenant("inactive");

    const node = await inTenant(tenantId, (tx) =>
      resolveOrRegisterSyncNode(tx, tenantId, "kasir-new")
    );

    expect(node).not.toBeNull();
    expect(node!.status).toBe("inactive");
    // This is exactly the route gate `node.status !== "active"` — an
    // unapproved node cannot pull/push.
    expect(node!.status !== "active").toBe(true);
  });

  test("an already-active node keeps working", async () => {
    const tenantId = await createTenant("active");

    await inTenant(tenantId, async (tx) => {
      await tx`
        INSERT INTO awcms_sync_nodes (tenant_id, node_code, node_name, status)
        VALUES (${tenantId}, ${"kasir-approved"}, ${"kasir-approved"}, 'active')
      `;
    });

    const node = await inTenant(tenantId, (tx) =>
      resolveOrRegisterSyncNode(tx, tenantId, "kasir-approved")
    );

    expect(node).not.toBeNull();
    expect(node!.status).toBe("active");
  });
});
