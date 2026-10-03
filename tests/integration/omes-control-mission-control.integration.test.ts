/**
 * 3D Mission Control scene composition against a real PostgreSQL (Issue
 * ahliweb/omes#265, epic ahliweb/omes#263; ADR-0031). Gated on
 * `DATABASE_URL` (harness §Gating).
 *
 * Proves, under real `FORCE ROW LEVEL SECURITY`, the two properties a static
 * source-text assertion cannot:
 *
 *  1. TENANT ISOLATION — tenant A's composed scene never contains tenant B's
 *     server, deployment, job, health, backup, Hermes, or approval rows, even
 *     when both tenants use overlapping identifiers and labels.
 *  2. PER-SOURCE AUTHORIZATION — a viewer who lacks a source's own read
 *     permission (here `hermes_orchestration.read`) gets that source reported
 *     `unavailable` with NO nodes from it, while the sources they may read are
 *     still composed. Permission-limited never reads as "healthy and empty".
 *
 * `can` is built exactly as `GET /api/v1/omes/mission-control/scene` builds
 * it: `authorizeInTransaction` over the viewer's real session.
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
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import {
  ALL_READ_GUARDS,
  grantRole,
  seedTenant,
  seedTenantUser
} from "./mission-control-fixtures";
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import type { AccessRequest } from "../../src/modules/identity-access/domain/access-control";
import { OMES_DESTRUCTIVE_WORKFLOW_KEY } from "../../src/modules/omes-control/domain/operations";
import { OMES_GUARDS } from "../../src/modules/omes-control/domain/permissions";
import { composeMissionControlSceneForViewer } from "../../src/modules/omes-control/application/mission-control-directory";
import { submitOmesOperation } from "../../src/modules/omes-control/application/operation-submission";
import type {
  MissionControlSceneNode,
  MissionControlSceneView
} from "../../src/modules/omes-control/domain/mission-control-types";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "e2650000-0000-4000-8000-0000000000a1";
const TENANT_B = "e2650000-0000-4000-8000-0000000000b1";
const ROLE_FULL_A = "e2650000-0000-4000-8000-0000000000c1";
const ROLE_NO_HERMES_A = "e2650000-0000-4000-8000-0000000000c2";
const ROLE_SERVERS_ONLY_A = "e2650000-0000-4000-8000-0000000000c3";
const USER_FULL_A = "e2650000-0000-4000-8000-0000000000d1";
const USER_NO_HERMES_A = "e2650000-0000-4000-8000-0000000000d2";
const USER_SERVERS_ONLY_A = "e2650000-0000-4000-8000-0000000000d3";
const USER_B = "e2650000-0000-4000-8000-0000000000d4";
const USER_ASSIGNEE_A = "e2650000-0000-4000-8000-0000000000d5";
const USER_ASSIGNEE_B = "e2650000-0000-4000-8000-0000000000d6";
const SESSION_FULL_A = "mc-it-full-a";
const SESSION_NO_HERMES_A = "mc-it-no-hermes-a";
const SESSION_SERVERS_ONLY_A = "mc-it-servers-only-a";

type Seed = {
  prefix: "a" | "b";
  tenantId: string;
  requesterUserId: string;
  assigneeUserId: string;
};

/** One row of every source kind, with SHARED labels and distinct ids per tenant. */
async function seedFleet(seed: Seed): Promise<void> {
  const admin = getAdminSql();
  const { prefix, tenantId } = seed;
  const serverId = `srv-${prefix}-1`;
  const deploymentId = `dep-${prefix}-1`;

  await admin`
    INSERT INTO awcms_omes_servers
      (tenant_id, server_id, hostname, status, last_heartbeat_at)
    VALUES (${tenantId}, ${serverId}, ${`shared-host-${prefix}.example.test`}, 'online', now())
  `;
  await admin`
    INSERT INTO awcms_omes_deployments
      (tenant_id, deployment_id, server_id, desired_state, observed_state,
       reconciliation_status, last_reconciled_at)
    VALUES (${tenantId}, ${deploymentId}, ${serverId}, '{"status":"running"}'::jsonb,
            '{"status":"running"}'::jsonb, 'converged', now())
  `;
  await admin`
    INSERT INTO awcms_omes_jobs
      (tenant_id, job_id, server_id, operation, state, target, payload, idempotency_key)
    VALUES (${tenantId}, ${`job_${prefix}_1`}, ${serverId}, 'status', 'running',
            ${{ server_id: serverId }}::jsonb, '{}'::jsonb, ${`idem-${prefix}-1`})
  `;
  await admin`
    INSERT INTO awcms_omes_health_snapshots
      (tenant_id, server_id, overall_status, checks, captured_at)
    VALUES (${tenantId}, ${serverId}, 'healthy', '{}'::jsonb, now())
  `;
  await admin`
    INSERT INTO awcms_omes_backup_snapshots
      (tenant_id, backup_id, server_id, status, manifest, captured_at)
    VALUES (${tenantId}, ${`bk-${prefix}-1`}, ${serverId}, 'verified', '{}'::jsonb, now())
  `;
  await admin`
    INSERT INTO awcms_omes_hermes_orchestration_trees
      (tenant_id, server_id, session_id, root_subagent_id, generated_at,
       active_count, completed_count, failed_count, nodes, correlation_id)
    VALUES (${tenantId}, ${serverId}, ${`sess-${prefix}`}, ${`root-${prefix}`}, now(),
            1, 0, 0,
            ${[
              {
                subagent_id: `root-${prefix}`,
                parent_subagent_id: null,
                role: "orchestrator",
                state: "RUNNING",
                children: [`child-${prefix}`]
              },
              {
                subagent_id: `child-${prefix}`,
                parent_subagent_id: `root-${prefix}`,
                role: "researcher",
                state: "RUNNING",
                children: []
              }
            ]}::jsonb,
            ${`corr-${prefix}`})
  `;
}

/** Publishes a one-approver destructive-operation workflow and submits a rollback (leaves a PENDING instance). */
async function seedPendingApproval(seed: Seed): Promise<void> {
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
  if (outcome.outcome === "created") {
    expect(outcome.operationRequest.status).toBe("requested");
    expect(outcome.operationRequest.workflowInstanceId).not.toBeNull();
  }
}

async function composeAs(
  tenantId: string,
  sessionToken: string
): Promise<MissionControlSceneView> {
  const tokenHash = hashSessionToken(sessionToken);
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    const now = new Date();
    const can = async (guard: AccessRequest): Promise<boolean> =>
      (await authorizeInTransaction(tx, tenantId, tokenHash, now, guard))
        .allowed;
    return composeMissionControlSceneForViewer({ tx, tenantId, now, can });
  });
}

function sourceStatus(
  scene: MissionControlSceneView,
  sourceKind: string
): string | undefined {
  return scene.sources.find((s) => s.source_kind === sourceKind)?.status;
}

suite("Mission Control scene composition (real PostgreSQL)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "mc-it-tenant-a");
    await seedTenant(TENANT_B, "mc-it-tenant-b");
    await seedTenantUser(TENANT_A, USER_FULL_A, "full-a", SESSION_FULL_A);
    await seedTenantUser(
      TENANT_A,
      USER_NO_HERMES_A,
      "nohermes-a",
      SESSION_NO_HERMES_A
    );
    await seedTenantUser(
      TENANT_A,
      USER_SERVERS_ONLY_A,
      "serversonly-a",
      SESSION_SERVERS_ONLY_A
    );
    await seedTenantUser(TENANT_A, USER_ASSIGNEE_A, "assignee-a", null);
    await seedTenantUser(TENANT_B, USER_B, "user-b", null);
    await seedTenantUser(TENANT_B, USER_ASSIGNEE_B, "assignee-b", null);

    await grantRole(
      TENANT_A,
      ROLE_FULL_A,
      "mc_full",
      USER_FULL_A,
      ALL_READ_GUARDS
    );
    await grantRole(
      TENANT_A,
      ROLE_NO_HERMES_A,
      "mc_no_hermes",
      USER_NO_HERMES_A,
      ALL_READ_GUARDS.filter(
        ([, activity]) => activity !== "hermes_orchestration"
      )
    );
    await grantRole(
      TENANT_A,
      ROLE_SERVERS_ONLY_A,
      "mc_servers_only",
      USER_SERVERS_ONLY_A,
      [["omes_control", "servers", "read"]]
    );

    await seedFleet({
      prefix: "a",
      tenantId: TENANT_A,
      requesterUserId: USER_FULL_A,
      assigneeUserId: USER_ASSIGNEE_A
    });
    await seedFleet({
      prefix: "b",
      tenantId: TENANT_B,
      requesterUserId: USER_B,
      assigneeUserId: USER_ASSIGNEE_B
    });
  }, 60000);

  describe("tenant isolation under RLS", () => {
    test("tenant A's scene contains tenant A's rows of every kind and none of tenant B's", async () => {
      // Sanity: tenant B's rows really exist (so absence below is isolation, not an empty seed).
      const bCounts = (await getAdminSql()`
        SELECT
          (SELECT count(*)::int FROM awcms_omes_servers WHERE tenant_id = ${TENANT_B}) AS servers,
          (SELECT count(*)::int FROM awcms_omes_jobs WHERE tenant_id = ${TENANT_B}) AS jobs,
          (SELECT count(*)::int FROM awcms_omes_hermes_orchestration_trees WHERE tenant_id = ${TENANT_B}) AS trees
      `) as { servers: number; jobs: number; trees: number }[];
      expect(bCounts[0]).toEqual({ servers: 1, jobs: 1, trees: 1 });

      await seedPendingApproval({
        prefix: "a",
        tenantId: TENANT_A,
        requesterUserId: USER_FULL_A,
        assigneeUserId: USER_ASSIGNEE_A
      });
      await seedPendingApproval({
        prefix: "b",
        tenantId: TENANT_B,
        requesterUserId: USER_B,
        assigneeUserId: USER_ASSIGNEE_B
      });

      const scene = await composeAs(TENANT_A, SESSION_FULL_A);
      expect(scene.tenant_id).toBe(TENANT_A);

      const ids = new Map<string, MissionControlSceneNode>(
        scene.nodes.map((n) => [`${n.kind}:${n.source_id}`, n] as const)
      );
      // Tenant A's own rows are all there.
      for (const key of [
        "server:srv-a-1",
        "deployment:dep-a-1",
        "job:job_a_1",
        "health_report:srv-a-1",
        "backup:bk-a-1",
        "hermes_subagent:root-a",
        "hermes_subagent:child-a"
      ]) {
        expect(ids.has(key)).toBe(true);
      }
      expect(scene.nodes.some((n) => n.kind === "approval_item")).toBe(true);

      // Not one tenant-B identifier or label appears anywhere in the payload.
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

      // Relations were composed from A's evidence only.
      const nodeId = (key: string) => ids.get(key)!.node_id;
      expect(
        scene.relations.some(
          (r) =>
            r.relation === "hosts" &&
            r.from === nodeId("server:srv-a-1") &&
            r.to === nodeId("deployment:dep-a-1")
        )
      ).toBe(true);
      expect(
        scene.relations.some(
          (r) =>
            r.relation === "delegates_to" &&
            r.from === nodeId("hermes_subagent:root-a") &&
            r.to === nodeId("hermes_subagent:child-a")
        )
      ).toBe(true);
      // The pending approval awaits a decision for A's deployment (workflow facts link).
      const approval = scene.nodes.find((n) => n.kind === "approval_item")!;
      expect(approval.source_state).toBe("pending");
      expect(approval.visual_state).toBe("pending");
      expect(approval.label).toBe("rollback");
      expect(
        scene.relations.some(
          (r) =>
            r.relation === "awaits_decision_for" &&
            r.from === approval.node_id &&
            r.to === nodeId("deployment:dep-a-1")
        )
      ).toBe(true);
    });

    test("composing under tenant B sees only tenant B (the isolation is symmetric)", async () => {
      // Tenant B has no session in this suite; compose with tenant A's `can`
      // semantics is meaningless, so authorize everything and let RLS alone scope the rows.
      const scene = await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
        composeMissionControlSceneForViewer({
          tx,
          tenantId: TENANT_B,
          now: new Date(),
          can: async () => true
        })
      );
      const serialized = JSON.stringify(scene);
      expect(serialized).toContain("srv-b-1");
      expect(serialized).toContain("root-b");
      for (const foreign of [
        "srv-a-1",
        "job_a_1",
        "root-a",
        "bk-a-1",
        TENANT_A
      ]) {
        expect(serialized).not.toContain(foreign);
      }
    });

    test("even with `can` forced true, a transaction scoped to tenant B cannot be made to read tenant A by passing A's id", async () => {
      // The composer filters by the tenantId it is GIVEN and RLS filters by the
      // transaction's tenant; a mismatch must yield nothing from A — never a leak.
      const scene = await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
        composeMissionControlSceneForViewer({
          tx,
          tenantId: TENANT_A,
          now: new Date(),
          can: async () => true
        })
      );
      const serialized = JSON.stringify(scene);
      for (const foreign of ["srv-a-1", "job_a_1", "root-a", "bk-a-1"]) {
        expect(serialized).not.toContain(foreign);
      }
    });
  });

  describe("per-source authorization", () => {
    test("a viewer without hermes_orchestration.read gets that source unavailable and no Hermes nodes", async () => {
      const scene = await composeAs(TENANT_A, SESSION_NO_HERMES_A);

      expect(sourceStatus(scene, "hermes_orchestration_tree")).toBe(
        "unavailable"
      );
      // The repository-progress source reuses the same permission (source map).
      expect(sourceStatus(scene, "github_repository_progress_view")).toBe(
        "unavailable"
      );
      expect(scene.nodes.some((n) => n.kind === "hermes_subagent")).toBe(false);
      expect(JSON.stringify(scene)).not.toContain("root-a");

      // Sources the viewer MAY read are still composed.
      expect(sourceStatus(scene, "omes_server_inventory")).not.toBe(
        "unavailable"
      );
      expect(scene.nodes.some((n) => n.kind === "server")).toBe(true);
      expect(scene.nodes.some((n) => n.kind === "job")).toBe(true);
      expect(scene.nodes.some((n) => n.kind === "deployment")).toBe(true);
    });

    test("a servers.read-only viewer sees servers and health; every other source is unavailable with no nodes", async () => {
      const scene = await composeAs(TENANT_A, SESSION_SERVERS_ONLY_A);

      const kinds = new Set(scene.nodes.map((n) => n.kind));
      expect(kinds).toEqual(new Set(["server", "health_report"]));
      for (const sourceKind of [
        "omes_deployment_view",
        "omes_job_status",
        "omes_backup_status",
        "hermes_orchestration_tree",
        "omes_architecture_capabilities_view",
        "github_repository_progress_view",
        "omes_ai_privacy_posture_view",
        "awcms_workflow_approval"
      ]) {
        expect(sourceStatus(scene, sourceKind)).toBe("unavailable");
      }
      // Every consulted source is reported, so the scene says what it is missing.
      expect(scene.sources).toHaveLength(10);
    });

    test("the route guard literal the composer's first source uses is servers.read (no new permission)", () => {
      expect(OMES_GUARDS.servers.read).toEqual({
        moduleKey: "omes_control",
        activityCode: "servers",
        action: "read"
      });
    });
  });
});
