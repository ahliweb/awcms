/**
 * 3D Mission Control historical replay against a real PostgreSQL (Issue
 * ahliweb/omes#266, epic ahliweb/omes#263; ADR-0031 rule 4). Gated on
 * `DATABASE_URL` (harness §Gating).
 *
 * Proves, under real `FORCE ROW LEVEL SECURITY`:
 *
 *  1. TENANT ISOLATION — tenant A's replay pages and historical scene never
 *     contain tenant B's rows, even with overlapping identifiers.
 *  2. PER-SOURCE AUTHORIZATION — a viewer without
 *     `hermes_orchestration.read` gets NO Hermes events or nodes, and the
 *     omission is reported as a `source_unavailable` gap (never an empty,
 *     healthy-looking history).
 *  3. ORDER AND PAGING — keyset pages of 500 reproduce the database's own
 *     `(at, id)` order exactly, with ties on the same instant, no duplicate and
 *     no skipped event at a page boundary.
 *  4. HONEST HISTORY — `late_arrival` is labelled; a node is absent before its
 *     first evidence; a source's last evidence ages to `stale`; `current_only`
 *     objects are shown unknown and never back-dated; purged / never-observed
 *     intervals are explicit gaps.
 *  5. PERFORMANCE — 6,000 retained events: timing printed.
 *
 * `can` is built exactly as the routes build it (`createMissionControlCan`).
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
import {
  ALL_READ_GUARDS,
  grantRole,
  seedTenant,
  seedTenantUser
} from "./mission-control-fixtures";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { OMES_DESTRUCTIVE_WORKFLOW_KEY } from "../../src/modules/omes-control/domain/operations";
import { createMissionControlCan } from "../../src/modules/omes-control/application/mission-control-directory";
import {
  composeHistoricalMissionControlSceneForViewer,
  fetchMissionControlReplayWindow,
  REPLAY_QUERIES,
  replayQueryParams
} from "../../src/modules/omes-control/application/mission-control-replay-directory";
import { submitOmesOperation } from "../../src/modules/omes-control/application/operation-submission";
import {
  decodeReplayCursor,
  type ReplayCursor
} from "../../src/modules/omes-control/domain/mission-control-replay";
import type {
  MissionControlReplayEvent,
  MissionControlReplayWindow,
  MissionControlSceneView
} from "../../src/modules/omes-control/domain/mission-control-types";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "e2660000-0000-4000-8000-0000000000a1";
const TENANT_B = "e2660000-0000-4000-8000-0000000000b1";
const ROLE_FULL_A = "e2660000-0000-4000-8000-0000000000c1";
const ROLE_NO_HERMES_A = "e2660000-0000-4000-8000-0000000000c2";
const USER_FULL_A = "e2660000-0000-4000-8000-0000000000d1";
const USER_NO_HERMES_A = "e2660000-0000-4000-8000-0000000000d2";
const USER_B = "e2660000-0000-4000-8000-0000000000d4";
const USER_ASSIGNEE_A = "e2660000-0000-4000-8000-0000000000d5";
const USER_ASSIGNEE_B = "e2660000-0000-4000-8000-0000000000d6";
const SESSION_FULL_A = "mc266-it-full-a";
const SESSION_NO_HERMES_A = "mc266-it-no-hermes-a";

const NOW = new Date(Math.floor(Date.now() / 1000) * 1000);
/** Two hours ago, whole seconds — every seeded instant is a fixed offset from it. */
const BASE = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
const at = (seconds: number): Date => new Date(BASE.getTime() + seconds * 1000);
const wire = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;

const WINDOW = { from: BASE, to: at(3600) };

type Seed = {
  prefix: "a" | "b";
  tenantId: string;
  requesterUserId: string;
  assigneeUserId: string;
};

async function seedEvidence(seed: Seed): Promise<void> {
  const admin = getAdminSql();
  const { prefix, tenantId } = seed;
  const serverId = `srv-${prefix}-1`;

  await admin`
    INSERT INTO awcms_omes_servers
      (tenant_id, server_id, hostname, status, last_heartbeat_at)
    VALUES (${tenantId}, ${serverId}, ${`shared-host-${prefix}.example.test`}, 'online', now())
  `;
  await admin`
    INSERT INTO awcms_omes_deployments
      (tenant_id, deployment_id, server_id, desired_state, observed_state,
       reconciliation_status, last_reconciled_at)
    VALUES (${tenantId}, ${`dep-${prefix}-1`}, ${serverId}, '{"status":"running"}'::jsonb,
            '{"status":"running"}'::jsonb, 'converged', now())
  `;

  // Hermes: root pending -> running, a child, and one event that was RECEIVED
  // after a later one (late arrival).
  const hermes = [
    ["root", "subagent_start", null, "PENDING", 60, 61, null],
    ["root", "subagent_step", 1, "RUNNING", 120, 121, null],
    ["child", "subagent_start", null, "RUNNING", 180, 181, `root-${prefix}`],
    ["root", "subagent_stop", null, "SUCCEEDED", 300, 301, null],
    // at=150 but only recorded at 400, after the at=300 stop was already stored.
    ["root", "subagent_step", 2, "RUNNING", 150, 400, null]
  ] as const;
  for (const [who, type, step, state, ts, received, parent] of hermes) {
    await admin`
      INSERT INTO awcms_omes_hermes_orchestration_events
        (tenant_id, server_id, session_id, subagent_id, parent_subagent_id,
         event_type, role, state, step_number, hermes_version,
         event_timestamp, correlation_id, received_at)
      VALUES (${tenantId}, ${serverId}, ${`sess-${prefix}`}, ${`${who}-${prefix}`},
              ${parent}, ${type}, ${who === "root" ? "orchestrator" : "researcher"},
              ${state}, ${step}, '1.0.0', ${at(ts)}, ${`corr-${prefix}-${ts}`},
              ${at(received)})
    `;
  }

  await admin`
    INSERT INTO awcms_omes_health_snapshots
      (tenant_id, server_id, overall_status, checks, captured_at, created_at)
    VALUES (${tenantId}, ${serverId}, 'healthy', '{"secret":"never-selected"}'::jsonb, ${at(100)}, ${at(100)}),
           (${tenantId}, ${serverId}, 'unhealthy', '{}'::jsonb, ${at(500)}, ${at(500)})
  `;
  await admin`
    INSERT INTO awcms_omes_backup_snapshots
      (tenant_id, backup_id, server_id, status, manifest, captured_at, created_at)
    VALUES (${tenantId}, ${`bk-${prefix}-1`}, ${serverId}, 'verified', '{}'::jsonb, ${at(200)}, ${at(200)})
  `;
  await admin`
    INSERT INTO awcms_omes_jobs
      (tenant_id, job_id, server_id, operation, state, target, payload,
       idempotency_key, created_at, updated_at)
    VALUES (${tenantId}, ${`job_${prefix}_1`}, ${serverId}, 'status', 'completed',
            '{}'::jsonb, '{}'::jsonb, ${`idem-${prefix}-1`}, ${at(250)}, ${at(400)})
  `;
  await admin`
    INSERT INTO awcms_omes_worker_results
      (tenant_id, server_id, worker_id, worker_job_id, correlation_id,
       idempotency_key, operation, reported_state, started_at, completed_at,
       evidence, error, created_at)
    VALUES (${tenantId}, ${serverId}, 'worker-1', 'local-1', ${`corr-job-${prefix}`},
            ${`idem-${prefix}-1`}, 'status', 'succeeded', ${at(380)}, ${at(390)},
            '{"raw":"never-selected"}'::jsonb, '{"raw":"never-selected"}'::jsonb, ${at(400)})
  `;
}

/** A destructive-operation workflow + one submitted request; the instance is then dated inside the window and approved. */
async function seedApproval(seed: Seed): Promise<void> {
  const { prefix, tenantId, requesterUserId, assigneeUserId } = seed;
  const graph = {
    startNodeId: "approve",
    nodes: [
      {
        id: "approve",
        type: "approval",
        name: "Approve destructive operation",
        assigneeTenantUserIds: [assigneeUserId],
        quorumRule: "any",
        onApprove: "end_approved",
        onReject: "end_rejected"
      },
      { id: "end_approved", type: "end", outcome: "approved" },
      { id: "end_rejected", type: "end", outcome: "rejected" }
    ]
  };
  const factsSchema = [
    { key: "operation", type: "string" },
    { key: "serverId", type: "string" },
    { key: "deploymentId", type: "string" }
  ];
  await getAdminSql()`
    INSERT INTO awcms_workflow_definitions
      (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
    VALUES (${tenantId}, ${OMES_DESTRUCTIVE_WORKFLOW_KEY}, 'OMES destructive op', 1,
            'active', ${graph}::jsonb, ${factsSchema}::jsonb)
  `;
  const outcome = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    submitOmesOperation(
      tx,
      tenantId,
      requesterUserId,
      {
        serverId: `srv-${prefix}-1`,
        deploymentId: `dep-${prefix}-1`,
        operation: "rollback",
        parameters: {},
        rollbackRef: `bk-${prefix}-1`
      },
      new Date()
    )
  );
  expect(outcome.outcome).toBe("created");
  await getAdminSql()`
    UPDATE awcms_workflow_instances
       SET created_at = ${at(300)}, updated_at = ${at(600)}, status = 'approved'
     WHERE tenant_id = ${tenantId}
  `;
}

function canFor(tenantId: string, sessionToken: string, tx: Bun.SQL) {
  return createMissionControlCan({
    tx,
    tenantId,
    tokenHash: hashSessionToken(sessionToken),
    now: new Date()
  });
}

async function replayAs(
  tenantId: string,
  sessionToken: string,
  window: { from: Date; to: Date },
  cursor: ReplayCursor | null = null
): Promise<MissionControlReplayWindow> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    fetchMissionControlReplayWindow({
      tx,
      tenantId,
      now: new Date(),
      can: canFor(tenantId, sessionToken, tx),
      from: window.from,
      to: window.to,
      cursor
    })
  );
}

async function sceneAs(
  tenantId: string,
  sessionToken: string,
  asOf: Date
): Promise<MissionControlSceneView> {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    composeHistoricalMissionControlSceneForViewer({
      tx,
      tenantId,
      now: new Date(),
      asOf,
      can: canFor(tenantId, sessionToken, tx)
    })
  );
}

const find = (scene: MissionControlSceneView, kind: string, id: string) =>
  scene.nodes.find((n) => n.kind === kind && n.source_id === id);

suite("Mission Control historical replay (real PostgreSQL)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "mc266-tenant-a");
    await seedTenant(TENANT_B, "mc266-tenant-b");
    await seedTenantUser(TENANT_A, USER_FULL_A, "full-a", SESSION_FULL_A);
    await seedTenantUser(
      TENANT_A,
      USER_NO_HERMES_A,
      "nohermes-a",
      SESSION_NO_HERMES_A
    );
    await seedTenantUser(TENANT_A, USER_ASSIGNEE_A, "assignee-a", null);
    await seedTenantUser(TENANT_B, USER_B, "user-b", null);
    await seedTenantUser(TENANT_B, USER_ASSIGNEE_B, "assignee-b", null);
    await grantRole(
      TENANT_A,
      ROLE_FULL_A,
      "mc266_full",
      USER_FULL_A,
      ALL_READ_GUARDS
    );
    await grantRole(
      TENANT_A,
      ROLE_NO_HERMES_A,
      "mc266_no_hermes",
      USER_NO_HERMES_A,
      ALL_READ_GUARDS.filter(
        ([, activity]) => activity !== "hermes_orchestration"
      )
    );
    for (const seed of [
      {
        prefix: "a",
        tenantId: TENANT_A,
        requesterUserId: USER_FULL_A,
        assigneeUserId: USER_ASSIGNEE_A
      },
      {
        prefix: "b",
        tenantId: TENANT_B,
        requesterUserId: USER_B,
        assigneeUserId: USER_ASSIGNEE_B
      }
    ] as Seed[]) {
      await seedEvidence(seed);
      await seedApproval(seed);
    }
  }, 120000);

  describe("replay window", () => {
    test("tenant A's replay carries every evidence kind of tenant A and nothing of tenant B", async () => {
      const page = await replayAs(TENANT_A, SESSION_FULL_A, WINDOW);

      expect(page.tenant_id).toBe(TENANT_A);
      expect(page.next_cursor).toBeNull();
      const kinds = new Set(page.events.map((e) => e.evidence_kind));
      expect(kinds).toEqual(
        new Set([
          "hermes_event",
          "health_snapshot",
          "backup_snapshot",
          "job_record",
          "worker_result",
          "workflow_decision"
        ])
      );
      // 5 hermes + 2 health + 1 backup + (created+terminal) job + 1 result + (created+terminal) approval
      expect(page.events).toHaveLength(13);

      const serialized = JSON.stringify(page);
      for (const foreign of [
        "srv-b-1",
        "job_b_1",
        "bk-b-1",
        "root-b",
        "child-b",
        "corr-b-",
        TENANT_B
      ]) {
        expect(serialized).not.toContain(foreign);
      }
      // No raw column ever reaches the page.
      expect(serialized).not.toContain("never-selected");
      expect(serialized).not.toContain("orchestrator");
    });

    test("events are ordered by (at, evidence_kind, evidence_id) with the child linked to its parent by evidence", async () => {
      const page = await replayAs(TENANT_A, SESSION_FULL_A, WINDOW);
      const keys = page.events.map((e) => [
        e.at,
        e.evidence_kind,
        e.evidence_id
      ]);
      const sorted = [...keys].sort((a, b) =>
        a[0]! < b[0]!
          ? -1
          : a[0]! > b[0]!
            ? 1
            : a[1]! < b[1]!
              ? -1
              : a[1]! > b[1]!
                ? 1
                : a[2]! < b[2]!
                  ? -1
                  : 1
      );
      expect(keys).toEqual(sorted);

      const child = page.events.find((e) => e.source_id === "child-a")!;
      expect(child.parent_source_id).toBe("root-a");
      expect(child.visual_state).toBe("in_progress");
      const job = page.events.filter((e) => e.kind === "job");
      expect(job.map((e) => e.source_state)).toEqual([
        "queued",
        "succeeded",
        "completed"
      ]);
    });

    test("an event recorded after a later one is labelled late_arrival; the rest are observed", async () => {
      const page = await replayAs(TENANT_A, SESSION_FULL_A, WINDOW);
      const hermes = page.events.filter((e) => e.kind === "hermes_subagent");
      const late = hermes.filter((e) => e.provenance === "late_arrival");
      expect(late).toHaveLength(1);
      expect(late[0]!.at).toBe(wire(at(150)));
      expect(late[0]!.source_state).toBe("RUNNING");
      expect(
        page.events.filter((e) => e.provenance === "late_arrival")
      ).toHaveLength(1);
    });

    test("a viewer without hermes_orchestration.read gets no Hermes events and an explicit source_unavailable gap", async () => {
      const page = await replayAs(TENANT_A, SESSION_NO_HERMES_A, WINDOW);

      expect(page.events.some((e) => e.kind === "hermes_subagent")).toBe(false);
      expect(JSON.stringify(page)).not.toContain("root-a");
      const unavailable = page.evidence_gaps
        .filter((g) => g.reason === "source_unavailable")
        .map((g) => g.source_kind);
      expect(unavailable).toContain("hermes_orchestration_tree");
      expect(unavailable).toContain("github_repository_progress_view");
      // Everything else the viewer may read is still there.
      expect(page.events.some((e) => e.kind === "job")).toBe(true);
      expect(page.events.some((e) => e.kind === "health_report")).toBe(true);
    });

    test("current_only sources are never replayed: a not_retained gap over the whole window, no events", async () => {
      const page = await replayAs(TENANT_A, SESSION_FULL_A, WINDOW);
      const notRetained = page.evidence_gaps
        .filter((g) => g.reason === "not_retained")
        .map((g) => g.source_kind);
      for (const source of [
        "omes_server_inventory",
        "omes_deployment_view",
        "omes_architecture_capabilities_view",
        "github_repository_progress_view",
        "omes_ai_privacy_posture_view",
        // terminal_transitions: intermediate steps are an explicit gap
        "omes_job_status",
        "awcms_workflow_approval"
      ]) {
        expect(notRetained).toContain(source);
      }
      expect(page.events.some((e) => e.kind === "server")).toBe(false);
      for (const gap of page.evidence_gaps.filter(
        (g) => g.reason === "not_retained"
      )) {
        expect(gap.from).toBe(wire(WINDOW.from));
        expect(gap.to).toBe(wire(WINDOW.to));
      }
    });

    test("a window that starts before the first retained row reports before_first_observation", async () => {
      const page = await replayAs(TENANT_A, SESSION_FULL_A, {
        from: at(-1800),
        to: at(0)
      });
      expect(page.events).toHaveLength(0);
      const first = page.evidence_gaps.filter(
        (g) => g.reason === "before_first_observation"
      );
      expect(first.map((g) => g.source_kind)).toContain(
        "hermes_orchestration_tree"
      );
    });

    test("a window older than a source's data-lifecycle retention reports retention_expired for that source only", async () => {
      const old = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
      const page = await replayAs(TENANT_A, SESSION_FULL_A, {
        from: old,
        to: new Date(old.getTime() + 3600 * 1000)
      });
      const expired = page.evidence_gaps
        .filter((g) => g.reason === "retention_expired")
        .map((g) => g.source_kind);
      // health snapshots: 30 d; jobs: 60 d; backups/hermes: 90 d.
      expect(expired).toEqual(["omes_health_readiness"]);
    });

    test("keyset paging reproduces the database order exactly: 500 per page, ties on one instant, no duplicate or skipped event", async () => {
      // 1,200 Hermes events, four per second -> many identical timestamps.
      await getAdminSql()`
        INSERT INTO awcms_omes_hermes_orchestration_events
          (tenant_id, server_id, session_id, subagent_id, event_type, state,
           step_number, hermes_version, event_timestamp, correlation_id, received_at)
        SELECT ${TENANT_A}, 'srv-a-1', 'bulk', 'bulk-sub', 'subagent_step', 'RUNNING',
               g, '1.0.0', ${at(1000)}::timestamptz + (g / 4) * interval '1 second',
               'corr-bulk', ${at(1000)}::timestamptz + (g / 4) * interval '1 second'
        FROM generate_series(1, 1200) AS g
      `;
      const expectedHermes = (
        (await getAdminSql()`
          SELECT id::text AS id FROM awcms_omes_hermes_orchestration_events
          WHERE tenant_id = ${TENANT_A}
          ORDER BY event_timestamp, id
        `) as { id: string }[]
      ).map((r) => r.id);

      const collected: MissionControlReplayEvent[] = [];
      const sizes: number[] = [];
      let cursor: ReplayCursor | null = null;
      for (let guard = 0; guard < 10; guard += 1) {
        const page: MissionControlReplayWindow = await replayAs(
          TENANT_A,
          SESSION_FULL_A,
          WINDOW,
          cursor
        );
        sizes.push(page.events.length);
        expect(page.events.length).toBeLessThanOrEqual(500);
        collected.push(...page.events);
        if (!page.next_cursor) break;
        cursor = decodeReplayCursor(page.next_cursor);
        expect(cursor).not.toBeNull();
      }
      expect(sizes.slice(0, -1).every((n) => n === 500)).toBe(true);
      expect(collected).toHaveLength(1200 + 13);

      const keys = collected.map((e) => `${e.evidence_kind}|${e.evidence_id}`);
      expect(new Set(keys).size).toBe(keys.length);
      for (let i = 1; i < collected.length; i += 1) {
        expect(collected[i - 1]!.at <= collected[i]!.at).toBe(true);
      }
      const hermesOrder = collected
        .filter((e) => e.evidence_kind === "hermes_event")
        .map((e) => e.evidence_id);
      expect(hermesOrder).toEqual(expectedHermes);
    });
  });

  describe("historical scene", () => {
    test("a node is absent before its first evidence and in its evidenced state afterwards", async () => {
      const early = await sceneAs(TENANT_A, SESSION_FULL_A, at(130));

      expect(early.mode).toBe("historical");
      expect(early.as_of).toBe(wire(at(130)));
      expect(find(early, "hermes_subagent", "root-a")?.source_state).toBe(
        "RUNNING"
      );
      expect(find(early, "hermes_subagent", "root-a")?.freshness).toBe("live");
      // child-a / backup / job / approval have no evidence yet.
      expect(find(early, "hermes_subagent", "child-a")).toBeUndefined();
      expect(find(early, "backup", "bk-a-1")).toBeUndefined();
      expect(find(early, "job", "job_a_1")).toBeUndefined();
      expect(early.nodes.some((n) => n.kind === "approval_item")).toBe(false);
      expect(find(early, "health_report", "srv-a-1")?.source_state).toBe(
        "healthy"
      );

      const later = await sceneAs(TENANT_A, SESSION_FULL_A, at(420));
      expect(find(later, "job", "job_a_1")?.source_state).toBe("completed");
      expect(find(later, "job", "job_a_1")?.visual_state).toBe("ok");
      expect(find(later, "backup", "bk-a-1")?.source_state).toBe("verified");
      expect(
        later.nodes.find((n) => n.kind === "approval_item")?.source_state
      ).toBe("pending");
      const after = await sceneAs(TENANT_A, SESSION_FULL_A, at(700));
      expect(
        after.nodes.find((n) => n.kind === "approval_item")?.source_state
      ).toBe("approved");
    });

    test("a source whose last evidence is old is stale at as_of, never live", async () => {
      const scene = await sceneAs(TENANT_A, SESSION_FULL_A, at(450));
      const root = find(scene, "hermes_subagent", "root-a")!;
      // Last evidence is the at=300 SUCCEEDED stop, 120 s+ before as_of.
      expect(root.source_state).toBe("SUCCEEDED");
      expect(root.freshness).toBe("stale");
      expect(root.visual_state).toBe("stale");
      // The health snapshot (1,800 s budget) is still within budget.
      expect(find(scene, "health_report", "srv-a-1")?.freshness).toBe("live");
    });

    test("current_only objects appear unknown and not back-dated, with a not_retained gap for their source", async () => {
      const scene = await sceneAs(TENANT_A, SESSION_FULL_A, at(420));
      const server = find(scene, "server", "srv-a-1")!;
      expect(server.source_state).toBe("not_reported");
      expect(server.freshness).toBe("unknown");
      expect(server.visual_state).toBe("unknown");
      expect(server.observed_at).toBeNull();
      expect(scene.evidence_gaps?.map((g) => g.source_kind)).toContain(
        "omes_server_inventory"
      );
      expect(find(scene, "deployment", "dep-a-1")?.visual_state).toBe(
        "unknown"
      );
    });

    test("tenant isolation: tenant A's historical scene contains none of tenant B", async () => {
      const scene = await sceneAs(TENANT_A, SESSION_FULL_A, at(420));
      const serialized = JSON.stringify(scene);
      for (const foreign of [
        "srv-b-1",
        "dep-b-1",
        "job_b_1",
        "bk-b-1",
        "root-b",
        "child-b",
        "shared-host-b.example.test",
        TENANT_B
      ]) {
        expect(serialized).not.toContain(foreign);
      }
      expect(serialized).not.toContain("never-selected");
    });

    test("a viewer without hermes_orchestration.read gets Hermes unavailable, no Hermes nodes and a source_unavailable gap", async () => {
      const scene = await sceneAs(TENANT_A, SESSION_NO_HERMES_A, at(420));
      expect(
        scene.sources.find((s) => s.source_kind === "hermes_orchestration_tree")
          ?.status
      ).toBe("unavailable");
      expect(scene.nodes.some((n) => n.kind === "hermes_subagent")).toBe(false);
      expect(JSON.stringify(scene)).not.toContain("root-a");
      expect(
        scene.evidence_gaps?.some(
          (g) =>
            g.source_kind === "hermes_orchestration_tree" &&
            g.reason === "source_unavailable"
        )
      ).toBe(true);
      expect(find(scene, "job", "job_a_1")).toBeDefined();
    });

    test("an as_of older than a source's retention is unavailable with a retention_expired gap; younger sources still compose", async () => {
      const old = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
      const scene = await sceneAs(TENANT_A, SESSION_FULL_A, old);
      expect(
        scene.sources.find((s) => s.source_kind === "omes_health_readiness")
          ?.status
      ).toBe("unavailable");
      expect(
        scene.evidence_gaps?.some(
          (g) =>
            g.source_kind === "omes_health_readiness" &&
            g.reason === "retention_expired"
        )
      ).toBe(true);
      expect(
        scene.sources.find((s) => s.source_kind === "hermes_orchestration_tree")
          ?.status
      ).toBe("available");
      expect(scene.nodes.some((n) => n.kind === "hermes_subagent")).toBe(false);
    });
  });

  describe("performance and query plans (6,000 retained Hermes events)", () => {
    test("pages and a historical scene over 6,000 events (nested delegations, one long session) stay fast", async () => {
      // 6,000 events across a 3,000 s span: a long session, 1,000 subagents in
      // a delegation chain (sub-N is a child of sub-(N-1)), six events each.
      await getAdminSql()`
        INSERT INTO awcms_omes_hermes_orchestration_events
          (tenant_id, server_id, session_id, subagent_id, parent_subagent_id,
           event_type, role, state, step_number, hermes_version,
           event_timestamp, correlation_id, received_at)
        SELECT ${TENANT_A}, 'srv-a-1', 'long-session',
               'sub-' || (g / 6),
               CASE WHEN g / 6 = 0 THEN NULL ELSE 'sub-' || (g / 6 - 1) END,
               'subagent_step', 'worker',
               (ARRAY['PENDING','STARTING','RUNNING','RUNNING','RUNNING','SUCCEEDED'])[1 + g % 6],
               g, '1.0.0',
               ${at(500)}::timestamptz + (g / 2) * interval '1 second',
               'corr-perf',
               ${at(500)}::timestamptz + (g / 2) * interval '1 second'
        FROM generate_series(0, 5999) AS g
      `;
      const count = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_omes_hermes_orchestration_events
        WHERE tenant_id = ${TENANT_A}
      `) as { n: number }[];
      expect(count[0]!.n).toBeGreaterThanOrEqual(6000);

      const wideWindow = { from: BASE, to: at(3600) };
      const pageTimes: number[] = [];
      let total = 0;
      let cursor: ReplayCursor | null = null;
      for (let guard = 0; guard < 40; guard += 1) {
        const started = performance.now();
        const page: MissionControlReplayWindow = await replayAs(
          TENANT_A,
          SESSION_FULL_A,
          wideWindow,
          cursor
        );
        pageTimes.push(performance.now() - started);
        expect(page.events.length).toBeLessThanOrEqual(500);
        total += page.events.length;
        if (!page.next_cursor) break;
        cursor = decodeReplayCursor(page.next_cursor);
      }
      expect(total).toBe(6000 + 13);

      const sceneStarted = performance.now();
      const scene = await sceneAs(TENANT_A, SESSION_FULL_A, at(3000));
      const sceneMs = performance.now() - sceneStarted;
      expect(scene.nodes.length).toBeLessThanOrEqual(500);
      expect(scene.truncated.nodes).toBeGreaterThan(0);

      const worst = Math.max(...pageTimes);
      const mean = pageTimes.reduce((a, b) => a + b, 0) / pageTimes.length;
      console.log(
        `[mission-control replay perf] 6,000 Hermes events: ${pageTimes.length} pages, ` +
          `mean ${mean.toFixed(1)} ms, worst ${worst.toFixed(1)} ms/page; ` +
          `historical scene (as_of mid-window, ${scene.nodes.length} nodes, ` +
          `${scene.truncated.nodes} truncated) ${sceneMs.toFixed(1)} ms`
      );
      expect(worst).toBeLessThan(2000);
      expect(sceneMs).toBeLessThan(3000);
    });

    test("every replay range query is index-bounded: with sequential scans disabled none plans a Seq Scan", async () => {
      await getAdminSql()`
        INSERT INTO awcms_omes_hermes_orchestration_events
          (tenant_id, server_id, session_id, subagent_id, event_type, state,
           step_number, hermes_version, event_timestamp, correlation_id)
        SELECT ${TENANT_A}, 'srv-a-1', 's', 'x', 'subagent_step', 'RUNNING', g, '1.0.0',
               ${at(0)}::timestamptz + g * interval '1 second', 'c'
        FROM generate_series(1, 3000) AS g
      `;
      // Health snapshots and backups rely on the pre-existing
      // (tenant_id, captured_at) index plus an incremental sort on `id`; give
      // the planner a realistic row count so it shows that.
      await getAdminSql()`
        INSERT INTO awcms_omes_health_snapshots
          (tenant_id, server_id, overall_status, checks, captured_at)
        SELECT ${TENANT_A}, 'srv-a-' || (g % 20), 'healthy', '{}'::jsonb,
               ${at(-86400)}::timestamptz + g * interval '10 seconds'
        FROM generate_series(1, 20000) AS g
      `;
      await getAdminSql()`ANALYZE`;
      const plans: Record<string, string> = {};
      for (const spec of REPLAY_QUERIES) {
        const rows = (await withTenantOrThrow(
          getRuntimeSql(),
          TENANT_A,
          async (tx) => {
            await tx`SET LOCAL enable_seqscan = off`;
            return tx.unsafe(
              `EXPLAIN ${spec.sql}`,
              replayQueryParams(spec, {
                tenantId: TENANT_A,
                lower: wire(at(0)),
                upper: wire(at(3601)),
                cursor: null,
                limit: 501
              })
            );
          }
        )) as { "QUERY PLAN": string }[];
        plans[`${spec.sourceKind}/${spec.evidenceKind}/${spec.kind}`] = rows
          .map((r) => r["QUERY PLAN"])
          .join("\n");
      }
      if (process.env.MC_PRINT_PLANS)
        console.log(JSON.stringify(plans, null, 1));
      for (const [name, plan] of Object.entries(plans)) {
        expect(plan, name).not.toContain("Seq Scan");
        expect(plan, name).toMatch(/Index/);
      }
      expect(
        plans["hermes_orchestration_tree/hermes_event/hermes_subagent"]
      ).toContain("awcms_omes_hermes_orchestration_events_tenant_event_ts_idx");
    });
  });
});
