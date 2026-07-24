/**
 * Real-PostgreSQL tests for audit log retention/purge (Issue #146).
 *
 * A fake `Bun.SQL` would prove nothing here: the behaviors under test are
 * the bounded `DELETE ... LIMIT` batching loop, the self-audit write landing
 * in the SAME transaction as its DELETE, and per-tenant isolation under
 * FORCE RLS — all properties of PostgreSQL, not of the caller.
 *
 * Requires a throwaway database whose schema has had `sql/` applied
 * (`bun run db:migrate`). Gated on `DATABASE_URL` — same convention as
 * `workflow-approval-concurrency.test.ts`: `ci.yml`'s `quality` job has no
 * database so this skips cleanly there; it actually executes in `ci.yml`'s
 * `integration-tests` job and `release.yml`'s `validate` job, each in a
 * dedicated `bun test <legacy files>` step run separately from the
 * harness-based `tests/integration/` suite (see `tests/integration/
 * harness.ts` — the two collide if run together in one `bun test` process).
 *
 * The suite only ever touches tenants it creates itself, and deletes them
 * again afterwards.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  AUDIT_EVENT_DEFAULT_RETENTION_DAYS,
  countPurgeableAuditEvents,
  purgeExpiredAuditEvents,
  resolveAuditRetentionCutoff
} from "../src/modules/logging/application/audit-purge";
import {
  resolveRetentionDays,
  runAuditLogPurge
} from "../scripts/audit-log-purge";
import type { LegalHoldGuardPort } from "../src/modules/_shared/ports/legal-hold-guard-port";

const DATABASE_URL = process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

const TENANT_A = "a1a1a1a1-aaaa-4aaa-8aaa-a1a1a1a1a1a1";
const TENANT_B = "b1b1b1b1-bbbb-4bbb-8bbb-b1b1b1b1b1b1";
const NOW = new Date("2026-07-01T00:00:00.000Z");

// Legal hold enforcement (ADR-0037) is REQUIRED but orthogonal to these
// retention-behavior tests: a stub guard that reports nothing held keeps the
// existing assertions focused on the cutoff/batching logic. The end-to-end
// "an active hold blocks the purge" coupling is proven in the dedicated
// data_lifecycle integration test.
const NEVER_HELD: LegalHoldGuardPort = {
  async isDescriptorHeld() {
    return false;
  }
};

describe("resolveRetentionDays", () => {
  test("prefers the CLI flag over the env var", () => {
    expect(
      resolveRetentionDays(["--retention-days=30"], {
        AUDIT_LOG_RETENTION_DAYS: "90"
      })
    ).toBe(30);
  });

  /**
   * The whole point of Issue #146: `AUDIT_LOG_RETENTION_DAYS` was
   * documented in `.env.example` and validated by `scripts/validate-env.ts`
   * while NOTHING read it. This assertion is the one that would fail if the
   * variable ever went back to being decorative.
   */
  test("reads AUDIT_LOG_RETENTION_DAYS when no flag is given", () => {
    expect(resolveRetentionDays([], { AUDIT_LOG_RETENTION_DAYS: "90" })).toBe(
      90
    );
  });

  test("falls back to the documented default", () => {
    expect(resolveRetentionDays([], {})).toBe(
      AUDIT_EVENT_DEFAULT_RETENTION_DAYS
    );
    expect(AUDIT_EVENT_DEFAULT_RETENTION_DAYS).toBe(730);
  });

  test("ignores a non-positive or unparseable value", () => {
    expect(resolveRetentionDays([], { AUDIT_LOG_RETENTION_DAYS: "0" })).toBe(
      AUDIT_EVENT_DEFAULT_RETENTION_DAYS
    );
    expect(
      resolveRetentionDays(["--retention-days=abc"], {
        AUDIT_LOG_RETENTION_DAYS: "-5"
      })
    ).toBe(AUDIT_EVENT_DEFAULT_RETENTION_DAYS);
  });
});

describe("resolveAuditRetentionCutoff", () => {
  test("subtracts whole days from now", () => {
    expect(resolveAuditRetentionCutoff(NOW, 30).toISOString()).toBe(
      "2026-06-01T00:00:00.000Z"
    );
  });
});

describeOrSkip("audit log purge (real PostgreSQL)", () => {
  let sql: Bun.SQL;

  async function seedEvents(
    tenantId: string,
    count: number,
    ageDays: number
  ): Promise<void> {
    const createdAt = new Date(NOW.getTime() - ageDays * 24 * 60 * 60 * 1000);

    for (let index = 0; index < count; index += 1) {
      await sql`
        INSERT INTO awcms_audit_events
          (tenant_id, module_key, action, resource_type, message, created_at)
        VALUES (${tenantId}, 'probe', 'login', 'session',
                ${`seeded ${ageDays}d #${index}`}, ${createdAt})
      `;
    }
  }

  async function countEvents(tenantId: string): Promise<number> {
    const rows = (await sql`
      SELECT count(*)::int AS count FROM awcms_audit_events
      WHERE tenant_id = ${tenantId}
    `) as { count: number }[];

    return rows[0]!.count;
  }

  beforeAll(async () => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 5 });

    for (const [tenantId, code] of [
      [TENANT_A, "audit-purge-probe-a"],
      [TENANT_B, "audit-purge-probe-b"]
    ] as const) {
      await sql`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
        VALUES (${tenantId}, ${code}, ${code}, 'active')
        ON CONFLICT (id) DO NOTHING
      `;
    }
  });

  afterAll(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }

    await sql.close({ timeout: 1 });
  });

  test("deletes only rows past the cutoff, and never another tenant's", async () => {
    await seedEvents(TENANT_A, 6, 900); // past a 730-day cutoff
    await seedEvents(TENANT_A, 2, 10); // recent, must survive
    await seedEvents(TENANT_B, 4, 900); // past cutoff but ANOTHER tenant

    const result = await purgeExpiredAuditEvents(sql, TENANT_A, NEVER_HELD, {
      now: NOW
    });

    expect(result.purgedCount).toBe(6);
    expect(result.cutoff).toEqual(
      resolveAuditRetentionCutoff(NOW, AUDIT_EVENT_DEFAULT_RETENTION_DAYS)
    );
    // 2 recent survivors + 1 self-audit purge event.
    expect(await countEvents(TENANT_A)).toBe(3);
    // Tenant B is untouched even though its rows are equally old.
    expect(await countEvents(TENANT_B)).toBe(4);
  });

  test("records the purge itself as an audit event (never a silent purge)", async () => {
    const rows = (await sql`
      SELECT module_key, action, resource_type, severity, attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${TENANT_A} AND action = 'purge'
    `) as {
      module_key: string;
      action: string;
      resource_type: string;
      severity: string;
      attributes: Record<string, unknown>;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.module_key).toBe("logging");
    expect(rows[0]!.resource_type).toBe("audit_event");
    expect(rows[0]!.severity).toBe("warning");
    expect(rows[0]!.attributes).toMatchObject({
      retentionDays: AUDIT_EVENT_DEFAULT_RETENTION_DAYS,
      purgedCount: 6
    });
  });

  test("an empty batch writes no audit event and reports zero", async () => {
    const before = await countEvents(TENANT_A);
    const result = await purgeExpiredAuditEvents(sql, TENANT_A, NEVER_HELD, {
      now: NOW
    });

    expect(result.purgedCount).toBe(0);
    // No new "purged 0 events" noise — the table is unchanged.
    expect(await countEvents(TENANT_A)).toBe(before);
  });

  test("batchLimit bounds a single call; the job loops until drained", async () => {
    // `runAuditLogPurge` below iterates EVERY active tenant, so tenant B's
    // leftovers from earlier tests would land in `totalPurged` too — clear
    // both so the assertion measures only what this test seeds.
    await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${TENANT_A}`;
    await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${TENANT_B}`;
    await seedEvents(TENANT_A, 7, 900);

    // One bounded call must delete at most batchLimit rows...
    const first = await purgeExpiredAuditEvents(sql, TENANT_A, NEVER_HELD, {
      now: NOW,
      batchLimit: 3
    });

    expect(first.purgedCount).toBe(3);

    // ...and the job's own loop keeps going until the backlog is drained.
    const jobResult = await runAuditLogPurge(
      sql,
      { dryRun: false, correlationId: "test-correlation-id" },
      { now: NOW, batchLimit: 3 }
    );

    expect(jobResult.totalPurged).toBe(4);
    expect(jobResult.tenantsHitPassLimit).toEqual([]);

    const remaining = (await sql`
      SELECT count(*)::int AS count FROM awcms_audit_events
      WHERE tenant_id = ${TENANT_A} AND action <> 'purge'
    `) as { count: number }[];

    expect(remaining[0]!.count).toBe(0);
  });

  test("surfaces a tenant whose backlog was not drained (status partial)", async () => {
    await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${TENANT_A}`;
    await seedEvents(TENANT_A, 6, 900);

    // 1 pass x batchLimit 2 cannot drain 6 rows — the run must report it
    // rather than silently leaving a backlog behind.
    const jobResult = await runAuditLogPurge(
      sql,
      { dryRun: false, correlationId: "test-correlation-id" },
      { now: NOW, batchLimit: 2, maxPasses: 1 }
    );

    expect(jobResult.tenantsHitPassLimit).toContain(TENANT_A);
  });

  test("dry run counts what a real run would purge, and deletes nothing", async () => {
    await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${TENANT_A}`;
    await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${TENANT_B}`;
    await seedEvents(TENANT_A, 5, 900);
    await seedEvents(TENANT_A, 2, 10);
    await seedEvents(TENANT_B, 3, 900);

    const dryRun = await runAuditLogPurge(
      sql,
      { dryRun: true, correlationId: "test-correlation-id" },
      { now: NOW }
    );

    expect(dryRun.totalPurged).toBe(8);
    expect(await countEvents(TENANT_A)).toBe(7);
    expect(await countEvents(TENANT_B)).toBe(3);

    const realRun = await runAuditLogPurge(
      sql,
      { dryRun: false, correlationId: "test-correlation-id" },
      { now: NOW }
    );

    // Dry-run/real-run parity: the preview is not allowed to drift from
    // what the real run treats as "past retention".
    expect(realRun.totalPurged).toBe(dryRun.totalPurged);
    expect(realRun.cutoffIso).toBe(dryRun.cutoffIso);
  });

  test("countPurgeableAuditEvents agrees with the cutoff it is given", async () => {
    await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${TENANT_B}`;
    await seedEvents(TENANT_B, 3, 40);

    const cutoff = resolveAuditRetentionCutoff(NOW, 30);

    expect(await countPurgeableAuditEvents(sql, TENANT_B, cutoff)).toBe(3);
    expect(
      await countPurgeableAuditEvents(
        sql,
        TENANT_B,
        resolveAuditRetentionCutoff(NOW, 50)
      )
    ).toBe(0);
  });
});
