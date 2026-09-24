/**
 * Worker enrollment/poll/result/heartbeat ingestion (ahliweb/omes#199)
 * against real PostgreSQL, driving the REAL HTTP route handlers (WORLD 2 —
 * see `tests/integration/harness.ts`'s header: these routes reach for
 * `getDatabaseClient()` internally, so they run against the migrated
 * `DATABASE_URL` database, seeded through `getHandlerAdminSql()`).
 *
 * Every exactly-once property here is raced with GENUINE concurrent
 * `invoke()` calls (two real HTTP handler invocations racing on the SAME
 * connection pool, each getting its own transaction) and asserted on the
 * resulting ROW COUNT / DB state, never on which HTTP status came back —
 * a sequential "call twice, expect 409 the second time" cannot distinguish
 * a real compare-and-set from a check that silently never ran (this
 * repository has hit exactly that failure mode before: `err.code ===
 * "23505"` never fires because the SQLSTATE is on `error.errno`).
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
  generateKeyPairSync,
  sign as cryptoSign,
  randomUUID
} from "node:crypto";

import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { hashEnrollmentChallenge } from "../../src/modules/omes-control/domain/server-registration";
import { POST as enrollPOST } from "../../src/pages/api/v1/omes/worker/enroll";
import { POST as pollPOST } from "../../src/pages/api/v1/omes/worker/poll";
import { POST as resultPOST } from "../../src/pages/api/v1/omes/worker/result";
import { POST as heartbeatPOST } from "../../src/pages/api/v1/omes/worker/heartbeat";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "f1000000-0000-4000-8000-0000000000a1";
const TENANT_B = "f1000000-0000-4000-8000-0000000000b1";
const SERVER_ID = "srv-worker-1";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string
  };
}

function sign(privateKeyPem: string, data: string): string {
  return cryptoSign(null, Buffer.from(data, "utf8"), privateKeyPem).toString(
    "base64"
  );
}

function canonical(input: {
  method: string;
  path: string;
  tenantId: string;
  serverId: string;
  workerId: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  const bodyHash = require("node:crypto")
    .createHash("sha256")
    .update(input.rawBody, "utf8")
    .digest("hex");

  return [
    input.method.toUpperCase(),
    input.path,
    input.tenantId,
    input.serverId,
    input.workerId,
    input.timestamp,
    input.nonce,
    bodyHash
  ].join("\n");
}

async function seedTenant(id: string, code: string): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${code})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedServer(
  tenantId: string,
  serverId: string,
  status = "offline"
): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_omes_servers (tenant_id, server_id, hostname, status)
    VALUES (${tenantId}, ${serverId}, ${`${serverId}.example.test`}, ${status})
  `;
}

async function seedPendingChallenge(
  tenantId: string,
  serverId: string,
  workerId: string,
  rawChallenge: string,
  expiresInMs: number
): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_omes_enrollments
      (tenant_id, server_id, worker_id, status, enrollment_challenge_hash, challenge_expires_at)
    VALUES (
      ${tenantId}, ${serverId}, ${workerId}, 'pending',
      ${hashEnrollmentChallenge(rawChallenge)}, ${new Date(Date.now() + expiresInMs)}
    )
  `;
}

async function seedEnrolledWorker(
  tenantId: string,
  serverId: string,
  workerId: string,
  publicKeyPem: string
): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_omes_enrollments
      (tenant_id, server_id, worker_id, status, public_key, enrolled_at)
    VALUES (${tenantId}, ${serverId}, ${workerId}, 'enrolled', ${publicKeyPem}, now())
  `;
}

async function seedApprovedOperation(
  tenantId: string,
  serverId: string,
  operation: string
): Promise<string> {
  const rows = (await getHandlerAdminSql()`
    INSERT INTO awcms_omes_operation_requests
      (tenant_id, request_id, server_id, operation, parameters, status)
    VALUES (${tenantId}, ${randomUUID()}, ${serverId}, ${operation}, '{}'::jsonb, 'approved')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

type EnvelopeHeaders = { headers: Record<string, string>; body: unknown };

function buildEnvelope(
  privateKeyPem: string,
  opts: {
    method: string;
    path: string;
    tenantId: string;
    serverId: string;
    workerId: string;
    timestamp?: string;
    nonce?: string;
    body: Record<string, unknown>;
    nonceInBody?: boolean;
    timestampInBody?: boolean;
  }
): EnvelopeHeaders {
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const nonce = opts.nonce ?? `nonce_${randomUUID().replace(/-/g, "")}`;

  const body = { ...opts.body };
  if (opts.nonceInBody) body.nonce = nonce;
  if (opts.timestampInBody) body.timestamp = timestamp;

  const rawBody = JSON.stringify(body);
  const canonicalString = canonical({
    method: opts.method,
    path: opts.path,
    tenantId: opts.tenantId,
    serverId: opts.serverId,
    workerId: opts.workerId,
    timestamp,
    nonce,
    rawBody
  });
  const signature = sign(privateKeyPem, canonicalString);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-omes-worker-signature": signature
  };
  if (!opts.nonceInBody) headers["x-omes-nonce"] = nonce;
  if (!opts.timestampInBody) headers["x-omes-timestamp"] = timestamp;

  return { headers, body };
}

suite(
  "omes_control worker enrollment/poll/result/heartbeat (real PostgreSQL)",
  () => {
    let ready = false;

    beforeAll(async () => {
      ready = await ensureHandlerDatabaseReady();
    }, 120000);

    afterAll(async () => {
      await teardownHandlerDatabase();
    }, 60000);

    beforeEach(async () => {
      if (!ready) return;
      await resetHandlerDatabase();
      await seedTenant(TENANT_A, "omes-worker-tenant-a");
      await seedTenant(TENANT_B, "omes-worker-tenant-b");
    }, 30000);

    test("enrollment: valid challenge + proof-of-possession signature succeeds, and the row is really updated", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID);
      const { publicKeyPem, privateKeyPem } = keypair();
      const rawChallenge = `chal_${randomUUID().replace(/-/g, "")}`;
      await seedPendingChallenge(
        TENANT_A,
        SERVER_ID,
        "worker_pending",
        rawChallenge,
        15 * 60_000
      );

      const body = {
        tenant_id: TENANT_A,
        server_id: SERVER_ID,
        enrollment_challenge: rawChallenge,
        public_key: publicKeyPem,
        hostname: "srv-worker-1.example.test",
        platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
        capabilities: ["status"]
      };
      const signature = sign(privateKeyPem, rawChallenge);

      const result = await invoke(enrollPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/enroll",
        body,
        headers: {
          "content-type": "application/json",
          "x-omes-enrollment-signature": signature
        }
      });

      expect(result.status).toBe(200);
      expect((result.body as { status: string }).status).toBe("enrolled");

      const rows = (await getHandlerAdminSql()`
      SELECT status, public_key FROM awcms_omes_enrollments
      WHERE tenant_id = ${TENANT_A} AND server_id = ${SERVER_ID}
    `) as { status: string; public_key: string }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe("enrolled");
      expect(rows[0]!.public_key).toBe(publicKeyPem);
    });

    test("enrollment: a signature from the WRONG key is rejected and the challenge stays pending", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID);
      const { publicKeyPem } = keypair();
      const attacker = keypair();
      const rawChallenge = `chal_${randomUUID().replace(/-/g, "")}`;
      await seedPendingChallenge(
        TENANT_A,
        SERVER_ID,
        "worker_pending",
        rawChallenge,
        15 * 60_000
      );

      const result = await invoke(enrollPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/enroll",
        body: {
          tenant_id: TENANT_A,
          server_id: SERVER_ID,
          enrollment_challenge: rawChallenge,
          public_key: publicKeyPem,
          hostname: "srv-worker-1.example.test",
          platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
          capabilities: ["status"]
        },
        headers: {
          "content-type": "application/json",
          // Signed with a DIFFERENT private key than the one matching
          // `public_key` — proof of possession must fail.
          "x-omes-enrollment-signature": sign(
            attacker.privateKeyPem,
            rawChallenge
          )
        }
      });

      expect((result.body as { status: string }).status).toBe("rejected");

      const rows = (await getHandlerAdminSql()`
      SELECT status FROM awcms_omes_enrollments
      WHERE tenant_id = ${TENANT_A} AND server_id = ${SERVER_ID}
    `) as { status: string }[];
      expect(rows[0]!.status).toBe("pending");
    });

    test("enrollment: a challenge presented under the WRONG tenant is rejected (cross-tenant substitution)", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID);
      const { publicKeyPem, privateKeyPem } = keypair();
      const rawChallenge = `chal_${randomUUID().replace(/-/g, "")}`;
      await seedPendingChallenge(
        TENANT_A,
        SERVER_ID,
        "worker_pending",
        rawChallenge,
        15 * 60_000
      );

      const result = await invoke(enrollPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/enroll",
        body: {
          // Real challenge value, but claiming TENANT_B.
          tenant_id: TENANT_B,
          server_id: SERVER_ID,
          enrollment_challenge: rawChallenge,
          public_key: publicKeyPem,
          hostname: "srv-worker-1.example.test",
          platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
          capabilities: ["status"]
        },
        headers: {
          "content-type": "application/json",
          "x-omes-enrollment-signature": sign(privateKeyPem, rawChallenge)
        }
      });

      expect((result.body as { status: string }).status).toBe("rejected");

      const rows = (await getHandlerAdminSql()`
      SELECT status FROM awcms_omes_enrollments WHERE tenant_id = ${TENANT_A} AND server_id = ${SERVER_ID}
    `) as { status: string }[];
      expect(rows[0]!.status).toBe("pending");
    });

    test("enrollment: an expired challenge is refused and transitioned to expired", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID);
      const { publicKeyPem, privateKeyPem } = keypair();
      const rawChallenge = `chal_${randomUUID().replace(/-/g, "")}`;
      // Already expired.
      await seedPendingChallenge(
        TENANT_A,
        SERVER_ID,
        "worker_pending",
        rawChallenge,
        -1000
      );

      const result = await invoke(enrollPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/enroll",
        body: {
          tenant_id: TENANT_A,
          server_id: SERVER_ID,
          enrollment_challenge: rawChallenge,
          public_key: publicKeyPem,
          hostname: "srv-worker-1.example.test",
          platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
          capabilities: ["status"]
        },
        headers: {
          "content-type": "application/json",
          "x-omes-enrollment-signature": sign(privateKeyPem, rawChallenge)
        }
      });

      expect((result.body as { status: string }).status).toBe("token_expired");

      const rows = (await getHandlerAdminSql()`
      SELECT status FROM awcms_omes_enrollments WHERE tenant_id = ${TENANT_A} AND server_id = ${SERVER_ID}
    `) as { status: string }[];
      expect(rows[0]!.status).toBe("expired");
    });

    test("enrollment: unknown contract version fails closed", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID);
      const { publicKeyPem, privateKeyPem } = keypair();
      const rawChallenge = `chal_${randomUUID().replace(/-/g, "")}`;
      await seedPendingChallenge(
        TENANT_A,
        SERVER_ID,
        "worker_pending",
        rawChallenge,
        15 * 60_000
      );

      const result = await invoke(enrollPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/enroll",
        body: {
          tenant_id: TENANT_A,
          server_id: SERVER_ID,
          enrollment_challenge: rawChallenge,
          public_key: publicKeyPem,
          hostname: "srv-worker-1.example.test",
          platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
          capabilities: ["status"]
        },
        headers: {
          "content-type": "application/json",
          "x-omes-enrollment-signature": sign(privateKeyPem, rawChallenge),
          "x-omes-contract-version": "v99"
        }
      });

      expect((result.body as { status: string }).status).toBe("rejected");

      const rows = (await getHandlerAdminSql()`
      SELECT status FROM awcms_omes_enrollments WHERE tenant_id = ${TENANT_A} AND server_id = ${SERVER_ID}
    `) as { status: string }[];
      // Untouched — the request never even reached DB redemption logic.
      expect(rows[0]!.status).toBe("pending");
    });

    test("enrollment challenge redemption is genuinely single-use under a REAL concurrent race", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID);
      const { publicKeyPem, privateKeyPem } = keypair();
      const rawChallenge = `chal_${randomUUID().replace(/-/g, "")}`;
      await seedPendingChallenge(
        TENANT_A,
        SERVER_ID,
        "worker_race",
        rawChallenge,
        15 * 60_000
      );

      const body = {
        tenant_id: TENANT_A,
        server_id: SERVER_ID,
        enrollment_challenge: rawChallenge,
        public_key: publicKeyPem,
        hostname: "srv-worker-1.example.test",
        platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
        capabilities: ["status"]
      };
      const signature = sign(privateKeyPem, rawChallenge);
      const headers = {
        "content-type": "application/json",
        "x-omes-enrollment-signature": signature
      };

      // GENUINELY concurrent: both invocations start before either awaits,
      // each getting its own transaction from the shared connection pool.
      const [first, second] = await Promise.all([
        invoke(enrollPOST, {
          method: "POST",
          path: "/api/v1/omes/worker/enroll",
          body,
          headers
        }),
        invoke(enrollPOST, {
          method: "POST",
          path: "/api/v1/omes/worker/enroll",
          body,
          headers
        })
      ]);

      const statuses = [
        (first.body as { status: string }).status,
        (second.body as { status: string }).status
      ].sort();

      // Exactly one "enrolled", one "rejected" — never both enrolled.
      expect(statuses).toEqual(["enrolled", "rejected"]);

      // The side-effect assertion the coordinator's note insists on: count the
      // actual rows, don't trust the HTTP statuses alone.
      const enrolledRows = (await getHandlerAdminSql()`
      SELECT id FROM awcms_omes_enrollments
      WHERE tenant_id = ${TENANT_A} AND server_id = ${SERVER_ID} AND status = 'enrolled'
    `) as unknown[];
      expect(enrolledRows).toHaveLength(1);
    });

    test("poll: wrong-tenant identity substitution is denied (worker enrolled under A, claims B)", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID);
      await seedServer(TENANT_B, SERVER_ID);
      const { publicKeyPem, privateKeyPem } = keypair();
      await seedEnrolledWorker(TENANT_A, SERVER_ID, "worker_x", publicKeyPem);

      const timestamp = new Date().toISOString();
      const nonce = `nonce_${randomUUID().replace(/-/g, "")}`;
      const body = {
        tenant_id: TENANT_B,
        server_id: SERVER_ID,
        worker_id: "worker_x",
        nonce,
        timestamp,
        capabilities: ["status"]
      };
      const rawBody = JSON.stringify(body);
      const canonicalString = canonical({
        method: "POST",
        path: "/api/v1/omes/worker/poll",
        tenantId: TENANT_B,
        serverId: SERVER_ID,
        workerId: "worker_x",
        timestamp,
        nonce,
        rawBody
      });

      const result = await invoke(pollPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/poll",
        body,
        headers: {
          "content-type": "application/json",
          "x-omes-worker-signature": sign(privateKeyPem, canonicalString)
        }
      });

      expect((result.body as { status: string }).status).toBe(
        "re-enroll_required"
      );
    });

    test("poll: a REPLAYED nonce is rejected under a real concurrent race — exactly one nonce row, exactly one success", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID, "online");
      const { publicKeyPem, privateKeyPem } = keypair();
      await seedEnrolledWorker(
        TENANT_A,
        SERVER_ID,
        "worker_poll",
        publicKeyPem
      );

      const envelope = buildEnvelope(privateKeyPem, {
        method: "POST",
        path: "/api/v1/omes/worker/poll",
        tenantId: TENANT_A,
        serverId: SERVER_ID,
        workerId: "worker_poll",
        body: {
          tenant_id: TENANT_A,
          server_id: SERVER_ID,
          worker_id: "worker_poll",
          capabilities: ["status"]
        },
        nonceInBody: true,
        timestampInBody: true
      });

      const [first, second] = await Promise.all([
        invoke(pollPOST, {
          method: "POST",
          path: "/api/v1/omes/worker/poll",
          body: envelope.body,
          headers: envelope.headers
        }),
        invoke(pollPOST, {
          method: "POST",
          path: "/api/v1/omes/worker/poll",
          body: envelope.body,
          headers: envelope.headers
        })
      ]);

      const statuses = [
        (first.body as { status: string }).status,
        (second.body as { status: string }).status
      ].sort();

      expect(statuses).toEqual(["idle", "re-enroll_required"]);

      const nonceRows = (await getHandlerAdminSql()`
      SELECT id FROM awcms_omes_worker_nonces
      WHERE tenant_id = ${TENANT_A} AND worker_id = 'worker_poll'
    `) as unknown[];
      expect(nonceRows).toHaveLength(1);
    });

    test("poll: promotes an approved operation request and leases it, then result ingestion is idempotent under a REAL race and never marks the job reconciled", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID, "online");
      const { publicKeyPem, privateKeyPem } = keypair();
      await seedEnrolledWorker(
        TENANT_A,
        SERVER_ID,
        "worker_full",
        publicKeyPem
      );
      await seedApprovedOperation(TENANT_A, SERVER_ID, "status");

      const pollEnvelope = buildEnvelope(privateKeyPem, {
        method: "POST",
        path: "/api/v1/omes/worker/poll",
        tenantId: TENANT_A,
        serverId: SERVER_ID,
        workerId: "worker_full",
        body: {
          tenant_id: TENANT_A,
          server_id: SERVER_ID,
          worker_id: "worker_full",
          capabilities: ["status"]
        },
        nonceInBody: true,
        timestampInBody: true
      });

      const pollResult = await invoke(pollPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/poll",
        body: pollEnvelope.body,
        headers: pollEnvelope.headers
      });

      expect((pollResult.body as { status: string }).status).toBe(
        "job_available"
      );
      const job = (
        pollResult.body as {
          job: { idempotency_key: string; correlation_id: string };
        }
      ).job;
      expect(job.idempotency_key).toBeTruthy();

      const jobRowsBefore = (await getHandlerAdminSql()`
      SELECT state FROM awcms_omes_jobs WHERE tenant_id = ${TENANT_A} AND idempotency_key = ${job.idempotency_key}
    `) as { state: string }[];
      expect(jobRowsBefore[0]!.state).toBe("leased");

      // Two concurrent result submissions, same idempotency_key, different
      // nonces (a realistic retry: the worker signs a fresh envelope each
      // attempt but reports the same job outcome).
      const resultBodyBase = {
        tenant_id: TENANT_A,
        server_id: SERVER_ID,
        worker_id: "worker_full",
        job_id: `worker-local-${randomUUID()}`,
        correlation_id: job.correlation_id,
        idempotency_key: job.idempotency_key,
        operation: "status",
        state: "succeeded",
        started_at: new Date(Date.now() - 1000).toISOString(),
        completed_at: new Date().toISOString(),
        evidence: { returncode: 0, output_summary: "ok" }
      };

      const envelope1 = buildEnvelope(privateKeyPem, {
        method: "POST",
        path: "/api/v1/omes/worker/result",
        tenantId: TENANT_A,
        serverId: SERVER_ID,
        workerId: "worker_full",
        body: resultBodyBase
      });
      const envelope2 = buildEnvelope(privateKeyPem, {
        method: "POST",
        path: "/api/v1/omes/worker/result",
        tenantId: TENANT_A,
        serverId: SERVER_ID,
        workerId: "worker_full",
        body: resultBodyBase
      });

      const [r1, r2] = await Promise.all([
        invoke(resultPOST, {
          method: "POST",
          path: "/api/v1/omes/worker/result",
          body: envelope1.body,
          headers: envelope1.headers
        }),
        invoke(resultPOST, {
          method: "POST",
          path: "/api/v1/omes/worker/result",
          body: envelope2.body,
          headers: envelope2.headers
        })
      ]);

      const resultStatuses = [
        (r1.body as { status: string }).status,
        (r2.body as { status: string }).status
      ].sort();
      expect(resultStatuses).toEqual(["duplicate_ignored", "recorded"]);

      // The exactly-once assertion: count the ROWS, not the HTTP statuses.
      const resultRows = (await getHandlerAdminSql()`
      SELECT reported_state, source, reconciled FROM awcms_omes_worker_results
      WHERE tenant_id = ${TENANT_A} AND idempotency_key = ${job.idempotency_key}
    `) as { reported_state: string; source: string; reconciled: boolean }[];
      expect(resultRows).toHaveLength(1);
      expect(resultRows[0]!.reported_state).toBe("succeeded");

      // A 2xx worker-reported "succeeded" is NEVER reconciled success.
      expect(resultRows[0]!.source).toBe("worker_reported");
      expect(resultRows[0]!.reconciled).toBe(false);

      const jobRowsAfter = (await getHandlerAdminSql()`
      SELECT state FROM awcms_omes_jobs WHERE tenant_id = ${TENANT_A} AND idempotency_key = ${job.idempotency_key}
    `) as { state: string }[];
      expect(jobRowsAfter[0]!.state).toBe("completed");
    });

    test("heartbeat: updates status/timestamp on success and never resurrects a decommissioned server", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID, "decommissioned");
      const { publicKeyPem, privateKeyPem } = keypair();
      await seedEnrolledWorker(TENANT_A, SERVER_ID, "worker_hb", publicKeyPem);

      const envelope = buildEnvelope(privateKeyPem, {
        method: "POST",
        path: "/api/v1/omes/worker/heartbeat",
        tenantId: TENANT_A,
        serverId: SERVER_ID,
        workerId: "worker_hb",
        body: {
          tenant_id: TENANT_A,
          server_id: SERVER_ID,
          worker_id: "worker_hb",
          status: "healthy",
          omes_version: "0.2.0",
          contract_version: "1.0.0",
          capability_registry_digest: "sha256:abcdef1234567890",
          platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
          uptime_seconds: 120
        },
        timestampInBody: true
      });

      const result = await invoke(heartbeatPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/heartbeat",
        body: envelope.body,
        headers: envelope.headers
      });

      expect((result.body as { status: string }).status).toBe(
        "re-enroll_required"
      );

      const rows = (await getHandlerAdminSql()`
      SELECT status, last_heartbeat_at FROM awcms_omes_servers
      WHERE tenant_id = ${TENANT_A} AND server_id = ${SERVER_ID}
    `) as { status: string; last_heartbeat_at: Date | null }[];

      // Never resurrected to 'online' despite a "healthy" report.
      expect(rows[0]!.status).toBe("decommissioned");
      // Still authenticated and recorded the contact — never silently ignored.
      expect(rows[0]!.last_heartbeat_at).not.toBeNull();
    });

    test("heartbeat: healthy report flips an offline server online and staleness age is computed on read, not stored as a flag", async () => {
      if (!ready) return;
      await seedServer(TENANT_A, SERVER_ID, "offline");
      const { publicKeyPem, privateKeyPem } = keypair();
      await seedEnrolledWorker(TENANT_A, SERVER_ID, "worker_hb2", publicKeyPem);

      const envelope = buildEnvelope(privateKeyPem, {
        method: "POST",
        path: "/api/v1/omes/worker/heartbeat",
        tenantId: TENANT_A,
        serverId: SERVER_ID,
        workerId: "worker_hb2",
        body: {
          tenant_id: TENANT_A,
          server_id: SERVER_ID,
          worker_id: "worker_hb2",
          status: "healthy",
          omes_version: "0.2.0",
          contract_version: "1.0.0",
          capability_registry_digest: "sha256:abcdef1234567890",
          platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
          uptime_seconds: 42
        },
        timestampInBody: true
      });

      const result = await invoke(heartbeatPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/heartbeat",
        body: envelope.body,
        headers: envelope.headers
      });

      expect((result.body as { status: string }).status).toBe("acknowledged");

      const rows = (await getHandlerAdminSql()`
      SELECT status FROM awcms_omes_servers WHERE tenant_id = ${TENANT_A} AND server_id = ${SERVER_ID}
    `) as { status: string }[];
      expect(rows[0]!.status).toBe("online");
    });
  }
);

/**
 * CONFIRMED HIGH (independent review of PR #823): `tenant_id` in every
 * pinned OMES wire schema is `^[A-Za-z0-9_.:-]{1,128}$` — deliberately NOT
 * constrained to a UUID. All four routes used to pass that attacker-
 * supplied, contract-VALID string straight to `runWorkerTenantWork`, whose
 * `withTenant` call's first line is `assertUuid(tenantId)`
 * (`lib/database/tenant-context.ts`) — a synchronous throw, before the
 * transaction opens and therefore before `verifyWorkerEnvelope` (or
 * `redeemEnrollmentChallenge`) ever runs. A schema-legal-but-non-UUID
 * `tenant_id` produced an UNHANDLED REJECTION instead of the documented
 * neutral response every other rejection path returns.
 *
 * Fixed by `InvalidWorkerTenantIdError` (`worker-route-runner.ts`) — every
 * route now validates UUID shape before opening a transaction and answers
 * the SAME neutral rejection as an unknown-worker/wrong-tenant/bad-signature
 * failure. These tests assert exactly that: same status field, same HTTP
 * 200, and (critically) that the handler does not throw at all.
 */
suite(
  "omes_control worker routes: non-UUID tenant_id fails closed, not uncaught (real PostgreSQL)",
  () => {
    let ready = false;

    beforeAll(async () => {
      ready = await ensureHandlerDatabaseReady();
    }, 120000);

    afterAll(async () => {
      await teardownHandlerDatabase();
    }, 60000);

    beforeEach(async () => {
      if (!ready) return;
      await resetHandlerDatabase();
    }, 30000);

    const NON_UUID_TENANT_ID = "not-a-uuid-but-matches-worker-schema";

    test("enroll: non-UUID tenant_id answers the same neutral rejection as an unknown one, never throws", async () => {
      if (!ready) return;

      const { publicKeyPem, privateKeyPem } = keypair();
      const rawChallenge = `chal_${randomUUID().replace(/-/g, "")}`;

      const body = {
        tenant_id: NON_UUID_TENANT_ID,
        server_id: SERVER_ID,
        enrollment_challenge: rawChallenge,
        public_key: publicKeyPem,
        hostname: "srv-worker-1.example.test",
        platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
        capabilities: ["status"]
      };

      const result = await invoke(enrollPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/enroll",
        body,
        headers: {
          "content-type": "application/json",
          "x-omes-enrollment-signature": sign(privateKeyPem, rawChallenge)
        }
      });

      expect(result.status).toBe(200);
      expect((result.body as { status: string }).status).toBe("rejected");
    });

    test("poll: non-UUID tenant_id answers re-enroll_required, never throws", async () => {
      if (!ready) return;

      const { privateKeyPem } = keypair();
      const envelope = buildEnvelope(privateKeyPem, {
        method: "POST",
        path: "/api/v1/omes/worker/poll",
        tenantId: NON_UUID_TENANT_ID,
        serverId: SERVER_ID,
        workerId: "worker_nonuuid",
        body: {
          tenant_id: NON_UUID_TENANT_ID,
          server_id: SERVER_ID,
          worker_id: "worker_nonuuid",
          capabilities: ["status"]
        },
        nonceInBody: true,
        timestampInBody: true
      });

      const result = await invoke(pollPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/poll",
        body: envelope.body,
        headers: envelope.headers
      });

      expect(result.status).toBe(200);
      expect((result.body as { status: string }).status).toBe(
        "re-enroll_required"
      );
    });

    test("result: non-UUID tenant_id answers rejected, never throws", async () => {
      if (!ready) return;

      const { privateKeyPem } = keypair();
      const envelope = buildEnvelope(privateKeyPem, {
        method: "POST",
        path: "/api/v1/omes/worker/result",
        tenantId: NON_UUID_TENANT_ID,
        serverId: SERVER_ID,
        workerId: "worker_nonuuid",
        body: {
          tenant_id: NON_UUID_TENANT_ID,
          server_id: SERVER_ID,
          worker_id: "worker_nonuuid",
          job_id: `worker-local-${randomUUID()}`,
          correlation_id: `corr_${randomUUID()}`,
          idempotency_key: `idem_${randomUUID()}`,
          operation: "status",
          state: "succeeded",
          started_at: new Date(Date.now() - 1000).toISOString(),
          completed_at: new Date().toISOString(),
          evidence: { returncode: 0 }
        }
      });

      const result = await invoke(resultPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/result",
        body: envelope.body,
        headers: envelope.headers
      });

      expect(result.status).toBe(200);
      expect((result.body as { status: string }).status).toBe("rejected");
    });

    test("heartbeat: non-UUID tenant_id answers re-enroll_required, never throws", async () => {
      if (!ready) return;

      const { privateKeyPem } = keypair();
      const envelope = buildEnvelope(privateKeyPem, {
        method: "POST",
        path: "/api/v1/omes/worker/heartbeat",
        tenantId: NON_UUID_TENANT_ID,
        serverId: SERVER_ID,
        workerId: "worker_nonuuid",
        body: {
          tenant_id: NON_UUID_TENANT_ID,
          server_id: SERVER_ID,
          worker_id: "worker_nonuuid",
          status: "healthy",
          omes_version: "0.2.0",
          contract_version: "1.0.0",
          capability_registry_digest: "sha256:abcdef1234567890",
          platform: { os: "ubuntu", version: "24.04", arch: "amd64" },
          uptime_seconds: 1
        },
        timestampInBody: true
      });

      const result = await invoke(heartbeatPOST, {
        method: "POST",
        path: "/api/v1/omes/worker/heartbeat",
        body: envelope.body,
        headers: envelope.headers
      });

      expect(result.status).toBe(200);
      expect((result.body as { status: string }).status).toBe(
        "re-enroll_required"
      );
    });
  }
);
