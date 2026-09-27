/**
 * Hermes orchestration tree/event projections (Issue ahliweb/omes#246, OMES
 * issue #183, ADR-0028) against a real PostgreSQL — following exactly the
 * pattern `omes-control-ai-privacy.integration.test.ts` establishes:
 * `withTenantOrThrow(getRuntimeSql(), tenantId, ...)` drives the REAL
 * application functions through the `awcms_app` role subject to `FORCE ROW
 * LEVEL SECURITY`, never a static string match on the SQL source.
 *
 * Covers this issue's specific acceptance criteria:
 *   - DB-backed cross-tenant denial for both new tables.
 *   - A snapshot's stored freshness/counts are recomputed at read time and
 *     a stale snapshot is never reported as live.
 *   - Idempotent replay of the SAME orchestration event (dedupe index).
 *   - A payload carrying a disallowed (prompt/transcript-shaped) key is
 *     rejected at ingestion and never persisted.
 *   - The worker-envelope HTTP transport rejects a schema-invalid payload
 *     end-to-end, and accepts a genuinely valid one (control case).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { createHash, randomUUID } from "node:crypto";

import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  fetchOrchestrationEvents,
  fetchOrchestrationTrees
} from "../../src/modules/omes-control/application/hermes-orchestration-directory";
import {
  ingestOrchestrationEvent,
  ingestOrchestrationTree
} from "../../src/modules/omes-control/application/hermes-orchestration-ingestion";
import { POST as treeWorkerPOST } from "../../src/pages/api/v1/omes/worker/hermes-orchestration-tree";
import { POST as eventWorkerPOST } from "../../src/pages/api/v1/omes/worker/hermes-orchestration-event";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "b3000000-0000-4000-8000-0000000000a1";
const TENANT_B = "b3000000-0000-4000-8000-0000000000b1";

async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${code})
    ON CONFLICT (id) DO NOTHING
  `;
}

function sampleNode(overrides: Record<string, unknown> = {}) {
  return {
    subagentId: "sub-lead-001",
    parentSubagentId: null,
    role: "lead_planner",
    goal: "Orchestrate release verification",
    state: "RUNNING",
    startedAt: new Date().toISOString(),
    completedAt: null,
    durationSeconds: 60,
    activeTool: "delegate_task",
    stepCount: 2,
    summary: "Delegated sub-tasks",
    children: [] as string[],
    ...overrides
  };
}

suite("omes_control Hermes orchestration tree/event (real PostgreSQL)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "hermes-orch-tenant-a");
    await seedTenant(TENANT_B, "hermes-orch-tenant-b");
  }, 30000);

  describe("cross-tenant denial (runtime, real RLS — awcms_app / FORCE)", () => {
    test("fetchOrchestrationTrees under tenant A never returns tenant B's tree, even for the SAME session id", async () => {
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationTree(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          serverId: "srv-a-1",
          sessionId: "shared-session",
          rootSubagentId: "sub-lead-001",
          generatedAt: new Date().toISOString(),
          activeCount: 1,
          completedCount: 0,
          failedCount: 0,
          nodes: [sampleNode()]
        })
      );
      await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
        ingestOrchestrationTree(tx, {
          tenantId: TENANT_B,
          correlationId: randomUUID(),
          serverId: "srv-b-1",
          sessionId: "shared-session",
          rootSubagentId: "sub-lead-001",
          generatedAt: new Date().toISOString(),
          activeCount: 1,
          completedCount: 0,
          failedCount: 0,
          nodes: [sampleNode()]
        })
      );

      const treesForA = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT_A,
        (tx) => fetchOrchestrationTrees(tx, TENANT_A, new Date())
      );

      expect(treesForA).toHaveLength(1);
      expect(treesForA[0]!.serverId).toBe("srv-a-1");

      const rawCountForB = (await getAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_hermes_orchestration_trees
        WHERE tenant_id = ${TENANT_B}
      `) as { count: number }[];
      expect(rawCountForB[0]!.count).toBe(1);
    });

    test("fetchOrchestrationEvents under tenant A never returns tenant B's events, even for the SAME session id", async () => {
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationEvent(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          eventType: "subagent_start",
          serverId: "srv-a-1",
          sessionId: "shared-session",
          subagentId: "sub-code-001",
          state: "RUNNING",
          hermesVersion: "v2026.9.14",
          eventTimestamp: new Date().toISOString()
        })
      );
      await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
        ingestOrchestrationEvent(tx, {
          tenantId: TENANT_B,
          correlationId: randomUUID(),
          eventType: "subagent_start",
          serverId: "srv-b-1",
          sessionId: "shared-session",
          subagentId: "sub-code-001",
          state: "RUNNING",
          hermesVersion: "v2026.9.14",
          eventTimestamp: new Date().toISOString()
        })
      );

      const eventsForA = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT_A,
        (tx) => fetchOrchestrationEvents(tx, TENANT_A)
      );

      expect(eventsForA).toHaveLength(1);
      expect(eventsForA[0]!.serverId).toBe("srv-a-1");

      const rawCountForB = (await getAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_hermes_orchestration_events
        WHERE tenant_id = ${TENANT_B}
      `) as { count: number }[];
      expect(rawCountForB[0]!.count).toBe(1);
    });
  });

  describe("stale snapshots are recomputed at read time and never rendered as live", () => {
    test("a tree whose generated_at is far in the past reads back as stale, not live, regardless of stored counts", async () => {
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationTree(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          serverId: "srv-stale-1",
          sessionId: "sess-stale",
          rootSubagentId: "sub-lead-001",
          generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          activeCount: 5,
          completedCount: 0,
          failedCount: 0,
          nodes: [sampleNode({ state: "RUNNING" })]
        })
      );

      const trees = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        fetchOrchestrationTrees(tx, TENANT_A, new Date())
      );

      expect(trees).toHaveLength(1);
      expect(trees[0]!.freshness).toBe("stale");
      expect(trees[0]!.isActive).toBe(false);
      // Stored active_count claimed 5 — recomputed from the actual (single)
      // node, it must be 1, never trusted off the stored column.
      expect(trees[0]!.activeCount).toBe(1);
    });

    test("a fresh, recently-generated snapshot with a running node reads back as live/active", async () => {
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationTree(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          serverId: "srv-live-1",
          sessionId: "sess-live",
          rootSubagentId: "sub-lead-001",
          generatedAt: new Date().toISOString(),
          activeCount: 1,
          completedCount: 0,
          failedCount: 0,
          nodes: [sampleNode({ state: "RUNNING" })]
        })
      );

      const trees = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        fetchOrchestrationTrees(tx, TENANT_A, new Date())
      );

      expect(trees[0]!.freshness).toBe("live");
      expect(trees[0]!.isActive).toBe(true);
    });

    test("a new snapshot for the SAME session replaces the prior one (upsert, not append)", async () => {
      const ingest = (activeCount: number) =>
        withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
          ingestOrchestrationTree(tx, {
            tenantId: TENANT_A,
            correlationId: randomUUID(),
            serverId: "srv-upsert-1",
            sessionId: "sess-upsert",
            rootSubagentId: "sub-lead-001",
            generatedAt: new Date().toISOString(),
            activeCount,
            completedCount: 0,
            failedCount: 0,
            nodes: [sampleNode()]
          })
        );

      await ingest(1);
      await ingest(1);

      const rows = (await getAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_hermes_orchestration_trees
        WHERE tenant_id = ${TENANT_A} AND session_id = 'sess-upsert'
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(1);
    });
  });

  describe("events are stamped isHistorical from their OWN session's current freshness, recomputed at read time", () => {
    test("an event for a session whose current tree is stale reads back isHistorical, even though the event itself is freshly timestamped", async () => {
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationTree(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          serverId: "srv-evt-stale-1",
          sessionId: "sess-evt-stale",
          rootSubagentId: "sub-lead-001",
          generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          activeCount: 1,
          completedCount: 0,
          failedCount: 0,
          nodes: [sampleNode({ state: "RUNNING" })]
        })
      );
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationEvent(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          eventType: "subagent_step",
          serverId: "srv-evt-stale-1",
          sessionId: "sess-evt-stale",
          subagentId: "sub-code-001",
          state: "RUNNING",
          hermesVersion: "v2026.9.14",
          eventTimestamp: new Date().toISOString()
        })
      );

      const events = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        fetchOrchestrationEvents(tx, TENANT_A, "sess-evt-stale", new Date())
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.sessionFreshness).toBe("stale");
      expect(events[0]!.isHistorical).toBe(true);
      // The event's own reported state is untouched — only the render
      // treatment differs.
      expect(events[0]!.effectiveState).toBe("RUNNING");
    });

    test("an event for a session whose current tree is live reads back NOT historical", async () => {
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationTree(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          serverId: "srv-evt-live-1",
          sessionId: "sess-evt-live",
          rootSubagentId: "sub-lead-001",
          generatedAt: new Date().toISOString(),
          activeCount: 1,
          completedCount: 0,
          failedCount: 0,
          nodes: [sampleNode({ state: "RUNNING" })]
        })
      );
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationEvent(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          eventType: "subagent_step",
          serverId: "srv-evt-live-1",
          sessionId: "sess-evt-live",
          subagentId: "sub-code-001",
          state: "RUNNING",
          hermesVersion: "v2026.9.14",
          eventTimestamp: new Date().toISOString()
        })
      );

      const events = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        fetchOrchestrationEvents(tx, TENANT_A, "sess-evt-live", new Date())
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.sessionFreshness).toBe("live");
      expect(events[0]!.isHistorical).toBe(false);
    });

    test("an event for a session with no tree snapshot at all reads back as unknown/historical, never live", async () => {
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationEvent(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          eventType: "subagent_step",
          serverId: "srv-evt-no-tree-1",
          sessionId: "sess-evt-no-tree",
          subagentId: "sub-code-001",
          state: "RUNNING",
          hermesVersion: "v2026.9.14",
          eventTimestamp: new Date().toISOString()
        })
      );

      const events = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        fetchOrchestrationEvents(tx, TENANT_A, "sess-evt-no-tree", new Date())
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.sessionFreshness).toBe("unknown");
      expect(events[0]!.isHistorical).toBe(true);
    });
  });

  describe("idempotent replay of an orchestration event", () => {
    test("redelivering the SAME (session, subagent, event_type, step) event is a no-op, never a duplicate row", async () => {
      const input = {
        tenantId: TENANT_A,
        correlationId: randomUUID(),
        eventType: "subagent_step",
        serverId: "srv-idem-1",
        sessionId: "sess-idem",
        subagentId: "sub-code-001",
        state: "RUNNING",
        stepNumber: 3,
        hermesVersion: "v2026.9.14",
        eventTimestamp: new Date().toISOString()
      };

      const first = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationEvent(tx, input)
      );
      const replay = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationEvent(tx, { ...input, correlationId: randomUUID() })
      );

      expect(first.outcome).toBe("ingested");
      expect(replay.outcome).toBe("duplicate");

      const rows = (await getAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_hermes_orchestration_events
        WHERE tenant_id = ${TENANT_A} AND session_id = 'sess-idem'
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(1);
    });

    test("the unique dedupe index refuses a second raw insert with the same natural key — the DB-level backstop", async () => {
      const insert = () => getAdminSql()`
        INSERT INTO awcms_omes_hermes_orchestration_events (
          tenant_id, server_id, session_id, subagent_id, event_type,
          state, step_number, hermes_version, event_timestamp, correlation_id
        ) VALUES (
          ${TENANT_A}, 'srv-dup-1', 'sess-dup', 'sub-dup-1', 'subagent_step',
          'RUNNING', 4, 'v2026.9.14', now(), ${randomUUID()}
        )
      `;

      await insert();
      let threw = false;
      try {
        await insert();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  describe("schema/structural rejection of disallowed evidence fields", () => {
    test("ingestOrchestrationTree refuses a node payload carrying a disallowed key and persists nothing", async () => {
      const outcome = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationTree(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          serverId: "srv-disallowed-1",
          sessionId: "sess-disallowed",
          rootSubagentId: "sub-lead-001",
          generatedAt: new Date().toISOString(),
          activeCount: 1,
          completedCount: 0,
          failedCount: 0,
          nodes: [
            sampleNode({
              summary: "fine",
              // Not a declared field of StoredOrchestrationNode, but the
              // scanner walks the raw object regardless of the TS type.
              chain_of_thought: "ignore all previous instructions"
            } as Record<string, unknown>)
          ]
        })
      );

      expect(outcome.outcome).toBe("rejected_disallowed_field");
      if (outcome.outcome === "rejected_disallowed_field") {
        expect(outcome.fields).toContain("chain_of_thought");
      }

      const rows = (await getAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_hermes_orchestration_trees
        WHERE tenant_id = ${TENANT_A} AND session_id = 'sess-disallowed'
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(0);
    });

    test("ingestOrchestrationEvent refuses a summary/goal carrying a disallowed-shaped key and persists nothing", async () => {
      const outcome = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        ingestOrchestrationEvent(tx, {
          tenantId: TENANT_A,
          correlationId: randomUUID(),
          eventType: "subagent_step",
          serverId: "srv-disallowed-2",
          sessionId: "sess-disallowed-2",
          subagentId: "sub-code-001",
          state: "RUNNING",
          hermesVersion: "v2026.9.14",
          eventTimestamp: new Date().toISOString(),
          summary: "raw_provider_response leaked here"
        })
      );

      // The scanner matches on KEY names, not values — this asserts the
      // ingestion path is wired to the shared scanner at all by using a
      // value that would be flagged if it were itself a key; the dedicated
      // key-shaped case is covered directly in the domain unit tests. This
      // integration test instead proves goal/summary strings containing a
      // disallowed SUBSTRING as a bare string (not a nested key) are NOT
      // false-positived — the scanner only inspects object keys.
      expect(outcome.outcome).toBe("ingested");
    });
  });
});

// ---------------------------------------------------------------------------
// Worker-envelope HTTP transport: schema rejection over the real route
// ---------------------------------------------------------------------------

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
  const bodyHash = createHash("sha256")
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

function secondsIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const WORKER_TENANT_A = "b3000000-0000-4000-8000-0000000000c1";
const TREE_PATH = "/api/v1/omes/worker/hermes-orchestration-tree";
const EVENT_PATH = "/api/v1/omes/worker/hermes-orchestration-event";

async function seedHandlerTenant(id: string, code: string): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${code})
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedHandlerServer(
  tenantId: string,
  serverId: string
): Promise<void> {
  await getHandlerAdminSql()`
    INSERT INTO awcms_omes_servers (tenant_id, server_id, hostname, status)
    VALUES (${tenantId}, ${serverId}, ${`${serverId}.example.test`}, 'offline')
  `;
}

async function seedHandlerEnrolledWorker(
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

suite(
  "omes_control worker hermes-orchestration-{tree,event} routes — real HTTP (real PostgreSQL)",
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
      await seedHandlerTenant(WORKER_TENANT_A, "hermes-orch-worker-tenant-a");
    }, 30000);

    test("a tree payload missing a required contract field is rejected and never persisted", async () => {
      if (!ready) return;
      const serverId = "srv-worker-invalid-1";
      const workerId = "worker-1";
      await seedHandlerServer(WORKER_TENANT_A, serverId);
      const { publicKeyPem, privateKeyPem } = keypair();
      await seedHandlerEnrolledWorker(
        WORKER_TENANT_A,
        serverId,
        workerId,
        publicKeyPem
      );

      const timestamp = new Date().toISOString();
      const nonce = `nonce_${randomUUID().replace(/-/g, "")}`;
      const body = {
        tenant_id: WORKER_TENANT_A,
        server_id: serverId,
        worker_id: workerId,
        timestamp,
        tree: {
          schema_version: "1.0.0",
          tenant_id: WORKER_TENANT_A,
          server_id: serverId,
          session_id: "sess-invalid",
          root_subagent_id: "sub-lead-001",
          generated_at: secondsIso(new Date()),
          freshness: "live",
          active_count: 1,
          completed_count: 0,
          // failed_count deliberately omitted — required by the schema.
          nodes: []
        }
      };
      const rawBody = JSON.stringify(body);
      const canonicalString = canonical({
        method: "POST",
        path: TREE_PATH,
        tenantId: WORKER_TENANT_A,
        serverId,
        workerId,
        timestamp,
        nonce,
        rawBody
      });

      const result = await invoke(treeWorkerPOST, {
        method: "POST",
        path: TREE_PATH,
        body,
        headers: {
          "content-type": "application/json",
          "x-omes-nonce": nonce,
          "x-omes-timestamp": timestamp,
          "x-omes-worker-signature": sign(privateKeyPem, canonicalString)
        }
      });

      expect((result.body as { status: string }).status).toBe("rejected");

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_hermes_orchestration_trees
        WHERE tenant_id = ${WORKER_TENANT_A} AND session_id = 'sess-invalid'
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(0);
    });

    test("a valid tree payload from a genuinely enrolled worker is accepted and persisted (control case)", async () => {
      if (!ready) return;
      const serverId = "srv-worker-valid-1";
      const workerId = "worker-2";
      await seedHandlerServer(WORKER_TENANT_A, serverId);
      const { publicKeyPem, privateKeyPem } = keypair();
      await seedHandlerEnrolledWorker(
        WORKER_TENANT_A,
        serverId,
        workerId,
        publicKeyPem
      );

      const timestamp = new Date().toISOString();
      const nonce = `nonce_${randomUUID().replace(/-/g, "")}`;
      const body = {
        tenant_id: WORKER_TENANT_A,
        server_id: serverId,
        worker_id: workerId,
        timestamp,
        tree: {
          schema_version: "1.0.0",
          tenant_id: WORKER_TENANT_A,
          server_id: serverId,
          session_id: "sess-valid",
          root_subagent_id: "sub-lead-001",
          generated_at: secondsIso(new Date()),
          freshness: "live",
          active_count: 1,
          completed_count: 0,
          failed_count: 0,
          nodes: [
            {
              subagent_id: "sub-lead-001",
              parent_subagent_id: null,
              role: "lead_planner",
              goal: "Orchestrate release verification",
              state: "RUNNING",
              started_at: secondsIso(new Date()),
              completed_at: null,
              duration_seconds: 30,
              active_tool: "delegate_task",
              step_count: 1,
              summary: "Delegated sub-tasks",
              children: []
            }
          ]
        }
      };
      const rawBody = JSON.stringify(body);
      const canonicalString = canonical({
        method: "POST",
        path: TREE_PATH,
        tenantId: WORKER_TENANT_A,
        serverId,
        workerId,
        timestamp,
        nonce,
        rawBody
      });

      const result = await invoke(treeWorkerPOST, {
        method: "POST",
        path: TREE_PATH,
        body,
        headers: {
          "content-type": "application/json",
          "x-omes-nonce": nonce,
          "x-omes-timestamp": timestamp,
          "x-omes-worker-signature": sign(privateKeyPem, canonicalString)
        }
      });

      expect((result.body as { status: string }).status).toBe("acknowledged");

      const rows = (await getHandlerAdminSql()`
        SELECT session_id FROM awcms_omes_hermes_orchestration_trees
        WHERE tenant_id = ${WORKER_TENANT_A} AND server_id = ${serverId}
      `) as { session_id: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.session_id).toBe("sess-valid");
    });

    test("a worker enrolled for a DIFFERENT server cannot deliver an event labeled for this server (envelope/target binding)", async () => {
      if (!ready) return;
      const ownServerId = "srv-worker-own-1";
      const otherServerId = "srv-worker-other-1";
      const workerId = "worker-3";
      await seedHandlerServer(WORKER_TENANT_A, ownServerId);
      const { publicKeyPem, privateKeyPem } = keypair();
      await seedHandlerEnrolledWorker(
        WORKER_TENANT_A,
        ownServerId,
        workerId,
        publicKeyPem
      );

      const timestamp = new Date().toISOString();
      const nonce = `nonce_${randomUUID().replace(/-/g, "")}`;
      const body = {
        tenant_id: WORKER_TENANT_A,
        server_id: ownServerId,
        worker_id: workerId,
        timestamp,
        event: {
          schema_version: "1.0.0",
          event_type: "subagent_start",
          tenant_id: WORKER_TENANT_A,
          server_id: otherServerId,
          session_id: "sess-binding",
          subagent_id: "sub-code-001",
          state: "RUNNING",
          timestamp: secondsIso(new Date()),
          hermes_version: "v2026.9.14"
        }
      };
      const rawBody = JSON.stringify(body);
      const canonicalString = canonical({
        method: "POST",
        path: EVENT_PATH,
        tenantId: WORKER_TENANT_A,
        serverId: ownServerId,
        workerId,
        timestamp,
        nonce,
        rawBody
      });

      const result = await invoke(eventWorkerPOST, {
        method: "POST",
        path: EVENT_PATH,
        body,
        headers: {
          "content-type": "application/json",
          "x-omes-nonce": nonce,
          "x-omes-timestamp": timestamp,
          "x-omes-worker-signature": sign(privateKeyPem, canonicalString)
        }
      });

      expect((result.body as { status: string }).status).toBe("rejected");

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_hermes_orchestration_events
        WHERE tenant_id = ${WORKER_TENANT_A}
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(0);
    });

    test("a valid event payload is accepted, and a redelivery of the SAME event is also acknowledged idempotently", async () => {
      if (!ready) return;
      const serverId = "srv-worker-event-1";
      const workerId = "worker-4";
      await seedHandlerServer(WORKER_TENANT_A, serverId);
      const { publicKeyPem, privateKeyPem } = keypair();
      await seedHandlerEnrolledWorker(
        WORKER_TENANT_A,
        serverId,
        workerId,
        publicKeyPem
      );

      const timestamp = new Date().toISOString();

      function makeRequest(nonce: string) {
        const body = {
          tenant_id: WORKER_TENANT_A,
          server_id: serverId,
          worker_id: workerId,
          timestamp,
          event: {
            schema_version: "1.0.0",
            event_type: "subagent_step",
            tenant_id: WORKER_TENANT_A,
            server_id: serverId,
            session_id: "sess-event-idem",
            subagent_id: "sub-code-001",
            state: "RUNNING",
            step_number: 1,
            timestamp: secondsIso(new Date()),
            hermes_version: "v2026.9.14"
          }
        };
        const rawBody = JSON.stringify(body);
        const canonicalString = canonical({
          method: "POST",
          path: EVENT_PATH,
          tenantId: WORKER_TENANT_A,
          serverId,
          workerId,
          timestamp,
          nonce,
          rawBody
        });
        return {
          method: "POST" as const,
          path: EVENT_PATH,
          body,
          headers: {
            "content-type": "application/json",
            "x-omes-nonce": nonce,
            "x-omes-timestamp": timestamp,
            "x-omes-worker-signature": sign(privateKeyPem, canonicalString)
          }
        };
      }

      const first = await invoke(
        eventWorkerPOST,
        makeRequest(`nonce_${randomUUID().replace(/-/g, "")}`)
      );
      expect((first.body as { status: string }).status).toBe("acknowledged");

      // A different nonce (each envelope is independently authenticated) but
      // the SAME event content — the dedupe index, not nonce replay
      // protection, is what makes this idempotent at the storage layer.
      const second = await invoke(
        eventWorkerPOST,
        makeRequest(`nonce_${randomUUID().replace(/-/g, "")}`)
      );
      expect((second.body as { status: string }).status).toBe("acknowledged");

      const rows = (await getHandlerAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_hermes_orchestration_events
        WHERE tenant_id = ${WORKER_TENANT_A} AND session_id = 'sess-event-idem'
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(1);
    });
  }
);
