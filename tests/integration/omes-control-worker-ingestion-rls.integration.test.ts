/**
 * Issue #1185 - DB-backed FORCE RLS probes for the worker-ingestion tables of
 * `omes_control` that no other suite touches directly:
 *
 *   awcms_omes_operation_requests, awcms_omes_jobs,
 *   awcms_omes_worker_nonces, awcms_omes_worker_results
 *
 * plus the two anchors `awcms_omes_servers` and `awcms_omes_enrollments`
 * (one combined test at the end).
 *
 * Every statement runs as the real least-privilege `awcms_app` login through
 * `getRuntimeSql()` (never a superuser, never `SET ROLE`), so a table whose
 * `FORCE ROW LEVEL SECURITY` or tenant predicate is removed turns these tests
 * red. Seeding goes through the migration-owner admin connection.
 *
 * What "cross-tenant write refused" means: UPDATE/DELETE of a foreign row
 * matches ZERO rows (the USING predicate), and a foreign-tenant INSERT hits
 * the RLS WITH CHECK (defaults to USING for a FOR ALL policy).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { randomUUID } from "node:crypto";

import {
  assertRejectedInSavepoint,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "e2000000-0000-4000-8000-0000000000a1";
const TENANT_B = "e2000000-0000-4000-8000-0000000000b1";
const SERVER_ID = "srv-rls-1";

type Seeded = {
  operationRequestId: string;
  jobRowId: string;
  jobId: string;
  idempotencyKey: string;
  nonceId: string;
  resultId: string;
};

async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${code})
  `;
}

/** One full ingestion chain for a tenant: op request -> job -> nonce -> result. */
async function seedChain(tenantId: string, workerId: string): Promise<Seeded> {
  const admin = getAdminSql();
  const idempotencyKey = `idem_${randomUUID().replace(/-/g, "")}`;
  const jobId = `job_${randomUUID().replace(/-/g, "")}`;

  await admin`
    INSERT INTO awcms_omes_servers (tenant_id, server_id, hostname, status)
    VALUES (${tenantId}, ${SERVER_ID}, ${`${SERVER_ID}.example.test`}, 'online')
  `;
  await admin`
    INSERT INTO awcms_omes_enrollments
      (tenant_id, server_id, worker_id, status, public_key, enrolled_at)
    VALUES (${tenantId}, ${SERVER_ID}, ${workerId}, 'enrolled', 'pem', now())
  `;

  const op = (await admin`
    INSERT INTO awcms_omes_operation_requests
      (tenant_id, request_id, server_id, operation, parameters, status)
    VALUES (${tenantId}, ${randomUUID()}, ${SERVER_ID}, 'status', '{}'::jsonb, 'approved')
    RETURNING id
  `) as { id: string }[];

  const job = (await admin`
    INSERT INTO awcms_omes_jobs
      (tenant_id, job_id, operation_request_id, server_id, operation, state, idempotency_key)
    VALUES (${tenantId}, ${jobId}, ${op[0]!.id}, ${SERVER_ID}, 'status', 'leased', ${idempotencyKey})
    RETURNING id
  `) as { id: string }[];

  const nonce = (await admin`
    INSERT INTO awcms_omes_worker_nonces
      (tenant_id, server_id, worker_id, nonce, route, expires_at)
    VALUES (${tenantId}, ${SERVER_ID}, ${workerId}, ${`nonce_${randomUUID()}`}, 'poll', now() + interval '1 hour')
    RETURNING id
  `) as { id: string }[];

  const result = (await admin`
    INSERT INTO awcms_omes_worker_results
      (tenant_id, server_id, worker_id, worker_job_id, correlation_id,
       idempotency_key, operation, reported_state, started_at, completed_at)
    VALUES (${tenantId}, ${SERVER_ID}, ${workerId}, 'wj-1', 'corr-1',
            ${idempotencyKey}, 'status', 'succeeded', now(), now())
    RETURNING id
  `) as { id: string }[];

  return {
    operationRequestId: op[0]!.id,
    jobRowId: job[0]!.id,
    jobId,
    idempotencyKey,
    nonceId: nonce[0]!.id,
    resultId: result[0]!.id
  };
}

suite("omes_control worker-ingestion tables: FORCE RLS as awcms_app", () => {
  let a: Seeded;
  let b: Seeded;

  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "omes-rls-tenant-a");
    await seedTenant(TENANT_B, "omes-rls-tenant-b");
    a = await seedChain(TENANT_A, "worker_a");
    b = await seedChain(TENANT_B, "worker_b");
  }, 30000);

  const TABLES = [
    "awcms_omes_operation_requests",
    "awcms_omes_jobs",
    "awcms_omes_worker_nonces",
    "awcms_omes_worker_results"
  ] as const;

  test("control: the four tables are ENABLE+FORCE RLS and the probe role is neither superuser nor bypassrls", async () => {
    const rows = (await getAdminSql()`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      WHERE c.relname = ANY(${[...TABLES]}::text[])
    `) as {
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }[];
    expect(rows.map((r) => r.relname).sort()).toEqual([...TABLES].sort());
    for (const r of rows) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }

    const me = (await getRuntimeSql()`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user
    `) as { u: string; rolsuper: boolean; rolbypassrls: boolean }[];
    expect(me[0]!.u).toBe("awcms_app");
    expect(me[0]!.rolsuper).toBe(false);
    expect(me[0]!.rolbypassrls).toBe(false);
  });

  test("reads: tenant A sees exactly its own row in every table, and tenant B's ids by direct reference return nothing", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
      const own = {
        awcms_omes_operation_requests: a.operationRequestId,
        awcms_omes_jobs: a.jobRowId,
        awcms_omes_worker_nonces: a.nonceId,
        awcms_omes_worker_results: a.resultId
      };
      const foreign = {
        awcms_omes_operation_requests: b.operationRequestId,
        awcms_omes_jobs: b.jobRowId,
        awcms_omes_worker_nonces: b.nonceId,
        awcms_omes_worker_results: b.resultId
      };

      for (const table of TABLES) {
        const all = (await tx.unsafe(`SELECT id, tenant_id FROM ${table}`)) as {
          id: string;
          tenant_id: string;
        }[];
        expect(
          all.map((r) => r.id),
          table
        ).toEqual([own[table]]);
        expect(all[0]!.tenant_id).toBe(TENANT_A);

        const byForeignId = (await tx.unsafe(
          `SELECT id FROM ${table} WHERE id = $1`,
          [foreign[table]]
        )) as unknown[];
        expect(byForeignId, table).toHaveLength(0);

        // Naming the foreign tenant explicitly changes nothing.
        const byForeignTenant = (await tx.unsafe(
          `SELECT id FROM ${table} WHERE tenant_id = $1`,
          [TENANT_B]
        )) as unknown[];
        expect(byForeignTenant, table).toHaveLength(0);
      }
    });
  });

  test("no tenant GUC: every table answers zero rows (default-deny), not an error and not everything", async () => {
    const sql = getRuntimeSql();
    for (const table of TABLES) {
      const rows = (await sql.unsafe(`SELECT id FROM ${table}`)) as unknown[];
      expect(rows, table).toHaveLength(0);
    }

    // An explicitly EMPTY GUC (not just an unset one) is also zero rows.
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', '', true)`;
      for (const table of TABLES) {
        const rows = (await tx.unsafe(`SELECT id FROM ${table}`)) as unknown[];
        expect(rows, table).toHaveLength(0);
      }
    });
  });

  test("writes (full-CRUD tables): UPDATE and DELETE of the other tenant's operation request and job affect zero rows and leave the data intact", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
      const upOp = (await tx`
        UPDATE awcms_omes_operation_requests SET status = 'rejected'
        WHERE id = ${b.operationRequestId} RETURNING id
      `) as unknown[];
      expect(upOp).toHaveLength(0);

      const upJob = (await tx`
        UPDATE awcms_omes_jobs SET state = 'cancelled'
        WHERE id = ${b.jobRowId} RETURNING id
      `) as unknown[];
      expect(upJob).toHaveLength(0);

      const delJob = (await tx`
        DELETE FROM awcms_omes_jobs WHERE id = ${b.jobRowId} RETURNING id
      `) as unknown[];
      expect(delJob).toHaveLength(0);

      const delOp = (await tx`
        DELETE FROM awcms_omes_operation_requests
        WHERE id = ${b.operationRequestId} RETURNING id
      `) as unknown[];
      expect(delOp).toHaveLength(0);

      // Control: the SAME statements against the tenant's own row succeed,
      // so the zero above is scoping, not a broken statement.
      const ownUp = (await tx`
        UPDATE awcms_omes_operation_requests SET status = 'dispatched'
        WHERE id = ${a.operationRequestId} RETURNING id
      `) as unknown[];
      expect(ownUp).toHaveLength(1);
    });

    const intact = (await getAdminSql()`
      SELECT
        (SELECT status FROM awcms_omes_operation_requests WHERE id = ${b.operationRequestId}) AS op_status,
        (SELECT state FROM awcms_omes_jobs WHERE id = ${b.jobRowId}) AS job_state
    `) as { op_status: string; job_state: string }[];
    expect(intact[0]).toEqual({ op_status: "approved", job_state: "leased" });
  });

  test("writes: a foreign-tenant INSERT is refused by RLS in all four tables", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
      const e1 = await assertRejectedInSavepoint(
        tx,
        (sp) => sp`
          INSERT INTO awcms_omes_operation_requests
            (tenant_id, request_id, server_id, operation, parameters, status)
          VALUES (${TENANT_B}, ${randomUUID()}, ${SERVER_ID}, 'status', '{}'::jsonb, 'approved')`,
        "foreign-tenant operation request"
      );
      expect(e1.message).toContain("row-level security");

      const e2 = await assertRejectedInSavepoint(
        tx,
        (sp) => sp`
          INSERT INTO awcms_omes_jobs
            (tenant_id, job_id, server_id, operation, state, idempotency_key)
          VALUES (${TENANT_B}, ${`job_${randomUUID()}`}, ${SERVER_ID}, 'status', 'queued', ${`idem_${randomUUID()}`})`,
        "foreign-tenant job"
      );
      expect(e2.message).toContain("row-level security");

      const e3 = await assertRejectedInSavepoint(
        tx,
        (sp) => sp`
          INSERT INTO awcms_omes_worker_nonces
            (tenant_id, server_id, worker_id, nonce, route, expires_at)
          VALUES (${TENANT_B}, ${SERVER_ID}, 'worker_b', ${`nonce_${randomUUID()}`}, 'poll', now() + interval '1 hour')`,
        "foreign-tenant nonce"
      );
      expect(e3.message).toContain("row-level security");

      const e4 = await assertRejectedInSavepoint(
        tx,
        (sp) => sp`
          INSERT INTO awcms_omes_worker_results
            (tenant_id, server_id, worker_id, worker_job_id, correlation_id,
             idempotency_key, operation, reported_state, started_at, completed_at)
          VALUES (${TENANT_B}, ${SERVER_ID}, 'worker_b', 'wj-x', 'corr-x',
                  ${b.idempotencyKey}, 'status', 'succeeded', now(), now())`,
        "foreign-tenant result"
      );
      expect(e4.message).toContain("row-level security");
    });

    const counts = (await getAdminSql()`
      SELECT
        (SELECT count(*)::int FROM awcms_omes_operation_requests WHERE tenant_id = ${TENANT_B}) AS ops,
        (SELECT count(*)::int FROM awcms_omes_jobs WHERE tenant_id = ${TENANT_B}) AS jobs,
        (SELECT count(*)::int FROM awcms_omes_worker_nonces WHERE tenant_id = ${TENANT_B}) AS nonces,
        (SELECT count(*)::int FROM awcms_omes_worker_results WHERE tenant_id = ${TENANT_B}) AS results
    `) as { ops: number; jobs: number; nonces: number; results: number }[];
    expect(counts[0]).toEqual({ ops: 1, jobs: 1, nonces: 1, results: 1 });
  });

  test("writes (nonces/results): UPDATE and DELETE of the other tenant's rows affect zero rows and leave the data intact", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
      const upNonce = (await tx`
        UPDATE awcms_omes_worker_nonces SET route = 'result'
        WHERE id = ${b.nonceId} RETURNING id
      `) as unknown[];
      expect(upNonce).toHaveLength(0);

      const upResult = (await tx`
        UPDATE awcms_omes_worker_results SET reconciled = true
        WHERE id = ${b.resultId} RETURNING id
      `) as unknown[];
      expect(upResult).toHaveLength(0);

      const delNonce = (await tx`
        DELETE FROM awcms_omes_worker_nonces WHERE id = ${b.nonceId} RETURNING id
      `) as unknown[];
      expect(delNonce).toHaveLength(0);

      const delResult = (await tx`
        DELETE FROM awcms_omes_worker_results WHERE id = ${b.resultId} RETURNING id
      `) as unknown[];
      expect(delResult).toHaveLength(0);

      // Control: the same UPDATE shape on the tenant's own nonce matches.
      const ownUp = (await tx`
        UPDATE awcms_omes_worker_nonces SET route = 'result'
        WHERE id = ${a.nonceId} RETURNING id
      `) as unknown[];
      expect(ownUp).toHaveLength(1);
    });

    const intact = (await getAdminSql()`
      SELECT
        (SELECT route FROM awcms_omes_worker_nonces WHERE id = ${b.nonceId}) AS route,
        (SELECT reconciled FROM awcms_omes_worker_results WHERE id = ${b.resultId}) AS reconciled
    `) as { route: string; reconciled: boolean }[];
    expect(intact[0]).toEqual({ route: "poll", reconciled: false });
  });

  test("servers and enrollments (ingestion anchors): ENABLE+FORCE RLS, foreign read/UPDATE/DELETE hit zero rows, foreign INSERT is refused", async () => {
    const flags = (await getAdminSql()`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('awcms_omes_servers', 'awcms_omes_enrollments')
    `) as {
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }[];
    expect(flags.map((r) => r.relname).sort()).toEqual([
      "awcms_omes_enrollments",
      "awcms_omes_servers"
    ]);
    for (const r of flags) {
      expect(r.relrowsecurity, r.relname).toBe(true);
      expect(r.relforcerowsecurity, r.relname).toBe(true);
    }

    await withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
      const servers = (await tx`SELECT tenant_id FROM awcms_omes_servers`) as {
        tenant_id: string;
      }[];
      expect(servers.map((r) => r.tenant_id)).toEqual([TENANT_A]);
      const enrollments = (await tx`
        SELECT tenant_id FROM awcms_omes_enrollments
      `) as { tenant_id: string }[];
      expect(enrollments.map((r) => r.tenant_id)).toEqual([TENANT_A]);

      const upServer = (await tx`
        UPDATE awcms_omes_servers SET status = 'decommissioned'
        WHERE tenant_id = ${TENANT_B} RETURNING 1
      `) as unknown[];
      expect(upServer).toHaveLength(0);
      const upEnrollment = (await tx`
        UPDATE awcms_omes_enrollments SET status = 'revoked'
        WHERE tenant_id = ${TENANT_B} RETURNING 1
      `) as unknown[];
      expect(upEnrollment).toHaveLength(0);
      const delEnrollment = (await tx`
        DELETE FROM awcms_omes_enrollments WHERE tenant_id = ${TENANT_B} RETURNING 1
      `) as unknown[];
      expect(delEnrollment).toHaveLength(0);

      const e1 = await assertRejectedInSavepoint(
        tx,
        (sp) => sp`
          INSERT INTO awcms_omes_servers (tenant_id, server_id, hostname, status)
          VALUES (${TENANT_B}, 'srv-evil', 'evil.example.test', 'online')`,
        "foreign-tenant server"
      );
      expect(e1.message).toContain("row-level security");
      const e2 = await assertRejectedInSavepoint(
        tx,
        (sp) => sp`
          INSERT INTO awcms_omes_enrollments
            (tenant_id, server_id, worker_id, status, public_key, enrolled_at)
          VALUES (${TENANT_B}, ${SERVER_ID}, 'worker_evil', 'enrolled', 'pem', now())`,
        "foreign-tenant enrollment"
      );
      expect(e2.message).toContain("row-level security");
    });

    const intact = (await getAdminSql()`
      SELECT
        (SELECT status FROM awcms_omes_servers WHERE tenant_id = ${TENANT_B}) AS server_status,
        (SELECT status FROM awcms_omes_enrollments WHERE tenant_id = ${TENANT_B}) AS enrollment_status
    `) as { server_status: string; enrollment_status: string }[];
    expect(intact[0]).toEqual({
      server_status: "online",
      enrollment_status: "enrolled"
    });
  });

  test("a result row cannot reference another tenant's job: the composite FK is not satisfiable across tenants", async () => {
    // Admin (RLS-bypassing owner) tries to attach a tenant A result to tenant
    // B's idempotency key. The FK includes tenant_id, so this must fail even
    // for the owner; FK checks run past RLS.
    const err = await getAdminSql()`
      INSERT INTO awcms_omes_worker_results
        (tenant_id, server_id, worker_id, worker_job_id, correlation_id,
         idempotency_key, operation, reported_state, started_at, completed_at)
      VALUES (${TENANT_A}, ${SERVER_ID}, 'worker_a', 'wj-2', 'corr-2',
              ${b.idempotencyKey}, 'status', 'succeeded', now(), now())
    `.then(
      () => null,
      (e: Error) => e
    );
    expect(err).not.toBeNull();
    expect(String(err!.message)).toContain("foreign key");
  });
});
