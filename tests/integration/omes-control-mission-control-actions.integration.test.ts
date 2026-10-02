/**
 * The REAL route handlers behind Mission Control contextual actions (Issue
 * ahliweb/omes#267, epic ahliweb/omes#263, ADR-0031 rule 3) against a real
 * PostgreSQL: `GET /api/v1/omes/mission-control/actions` plus the EXISTING
 * mutation endpoints it shortcuts, driven through `defineTenantRoute` — the
 * actual authorization chokepoint, the actual `awcms_role_permissions` grants
 * and the actual response envelopes.
 *
 * Proves:
 *  - TENANT ISOLATION / no existence oracle: another tenant's id, an unknown
 *    id, and an object in a source the viewer may not read all answer with the
 *    SAME all-`not_found` result, for every kind that has a record;
 *  - PER-ACTION PERMISSION: a viewer who can see a queued job but lacks
 *    `jobs.cancel` gets `permission_denied`; a user holding it gets `available`
 *    with the EXISTING endpoint path (the row id the canonical screen sends);
 *  - the availability endpoint is ADVISORY: a forged direct POST to the
 *    existing cancel endpoint without the permission is still a 403 and the job
 *    stays queued, a forged POST at another tenant's job is a 404 and leaves it
 *    queued, and the real cancel (with the suggested path and an
 *    Idempotency-Key) works and is idempotent;
 *  - stale / decommissioned / unverified-backup facts are NON-BLOCKING
 *    advisories (the action stays available), destructive actions carry
 *    `requires_approval`, and operation bodies are exactly what the canonical
 *    Operations screen sends;
 *  - query validation: `command=` and other unknown parameters are a 400 and
 *    authorization decides first (403 for a caller without `servers.read`).
 *
 * WORLD-2 (harness.ts): route handlers use the migrated `DATABASE_URL`
 * database, so this skips unless one is configured.
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
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { GET as actionsGet } from "../../src/pages/api/v1/omes/mission-control/actions";
import { POST as cancelPost } from "../../src/pages/api/v1/omes/jobs/[id]/cancel";
import { POST as approvePost } from "../../src/pages/api/v1/omes/jobs/[id]/approve";
import { POST as operationsPost } from "../../src/pages/api/v1/omes/operations/index";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { OMES_DESTRUCTIVE_WORKFLOW_KEY } from "../../src/modules/omes-control/domain/operations";
import { submitOmesOperation } from "../../src/modules/omes-control/application/operation-submission";

const TENANT_A = "e2670000-0000-4000-8000-0000000000a1";
const TENANT_B = "e2670000-0000-4000-8000-0000000000b1";

type Persona = {
  profileId: string;
  tenantUserId: string;
  identityId: string;
  roleId: string;
  loginIdentifier: string;
};
const persona = (n: number): Persona => ({
  profileId: `e2670000-0000-4000-8000-0000000001${n}1`,
  tenantUserId: `e2670000-0000-4000-8000-0000000001${n}2`,
  identityId: `e2670000-0000-4000-8000-0000000001${n}3`,
  roleId: `e2670000-0000-4000-8000-0000000001${n}4`,
  loginIdentifier: `mc267-${n}@example.test`
});
const ADMIN = persona(1);
const VIEWER = persona(2);
const SERVERS_ONLY = persona(3);
const NOBODY = persona(4);
const OTHER_TENANT_ADMIN = persona(5);

const READ: Array<[string, string, string]> = [
  ["omes_control", "servers", "read"],
  ["omes_control", "deployments", "read"],
  ["omes_control", "jobs", "read"],
  ["omes_control", "backups", "read"],
  ["workflow", "approval", "read"]
];
const MUTATE: Array<[string, string, string]> = [
  ["omes_control", "deployments", "operate"],
  ["omes_control", "jobs", "cancel"],
  ["omes_control", "jobs", "approve"],
  ["omes_control", "backups", "restore"],
  ["omes_control", "backups", "rollback"]
];

// Rows. Business ids overlap across tenants on purpose (`srv-shared`).
const A_JOB_QUEUED = "job_a_queued";
const A_JOB_FAILED = "job_a_failed";
const B_JOB_QUEUED = "job_b_queued";
const A_BACKUP_UNVERIFIED = "bk-a-unverified";
const A_BACKUP_VERIFIED = "bk-a-verified";
const B_BACKUP = "bk-b-1";

let handlerReady = false;
const sessionTokens = new Map<string, string>();
const rowIds = new Map<string, string>();

async function seedPersona(
  tenantId: string,
  who: Persona,
  roleName: string,
  permissions: ReadonlyArray<[string, string, string]>
): Promise<void> {
  const sql = getHandlerAdminSql();
  await sql`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name)
    VALUES (${who.profileId}, ${tenantId}, 'person', ${roleName})
  `;
  await sql`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${who.identityId}, ${tenantId}, ${who.profileId},
            ${who.loginIdentifier}, 'not-a-real-hash', 'active')
  `;
  await sql`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${who.tenantUserId}, ${tenantId}, ${who.identityId}, 'active')
  `;
  await sql`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system)
    VALUES (${who.roleId}, ${tenantId}, ${roleName}, ${roleName}, false)
  `;
  for (const [moduleKey, activityCode, action] of permissions) {
    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT ${tenantId}, ${who.roleId}, p.id
      FROM awcms_permissions p
      WHERE p.module_key = ${moduleKey} AND p.activity_code = ${activityCode}
        AND p.action = ${action}
    `;
  }
  await grantRolePolicy(sql, tenantId, {
    tenantUserId: who.tenantUserId,
    roleId: who.roleId,
    grantedByTenantUserId: null
  });
  const token = generateSessionToken();
  sessionTokens.set(who.tenantUserId, token);
  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${who.identityId}, ${hashSessionToken(token)},
            now() + interval '1 hour')
  `;
}

async function seedFleet(
  tenantId: string,
  jobs: Array<[string, string]>,
  backups: Array<[string, string]>
): Promise<void> {
  const sql = getHandlerAdminSql();
  await sql`
    INSERT INTO awcms_omes_servers
      (tenant_id, server_id, hostname, status, last_heartbeat_at)
    VALUES (${tenantId}, 'srv-shared', 'shared-host.example.test', 'online', now())
  `;
  await sql`
    INSERT INTO awcms_omes_deployments
      (tenant_id, deployment_id, server_id, desired_state, observed_state,
       reconciliation_status, last_reconciled_at)
    VALUES (${tenantId}, ${`dep-${tenantId.slice(-2)}`}, 'srv-shared',
            '{"status":"running"}'::jsonb, '{"status":"running"}'::jsonb,
            'converged', now())
  `;
  for (const [jobId, state] of jobs) {
    const rows = (await sql`
      INSERT INTO awcms_omes_jobs
        (tenant_id, job_id, server_id, operation, state, target, payload, idempotency_key)
      VALUES (${tenantId}, ${jobId}, 'srv-shared', 'status', ${state},
              '{}'::jsonb, '{}'::jsonb, ${`idem-${jobId}`})
      RETURNING id
    `) as { id: string }[];
    rowIds.set(jobId, rows[0]!.id);
  }
  for (const [backupId, status] of backups) {
    const rows = (await sql`
      INSERT INTO awcms_omes_backup_snapshots
        (tenant_id, backup_id, server_id, status, manifest, captured_at)
      VALUES (${tenantId}, ${backupId}, 'srv-shared', ${status}, '{}'::jsonb, now())
      RETURNING id
    `) as { id: string }[];
    rowIds.set(backupId, rows[0]!.id);
  }
  await sql`
    INSERT INTO awcms_omes_health_snapshots
      (tenant_id, server_id, overall_status, checks, captured_at)
    VALUES (${tenantId}, 'srv-shared', 'healthy', '{}'::jsonb, now())
  `;
}

/** A published one-approver workflow and one PENDING rollback for `tenantId`. */
async function seedPendingApproval(
  tenantId: string,
  requester: Persona,
  assignee: Persona
): Promise<string> {
  const sql = getHandlerAdminSql();
  const graph = {
    startNodeId: "approve",
    nodes: [
      {
        id: "approve",
        type: "approval",
        name: "Approve destructive operation",
        assigneeTenantUserIds: [assignee.tenantUserId],
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
  await sql`
    INSERT INTO awcms_workflow_definitions
      (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
    VALUES (${tenantId}, ${OMES_DESTRUCTIVE_WORKFLOW_KEY}, 'OMES destructive op', 1,
            'active', ${graph}::jsonb, ${factsSchema}::jsonb)
  `;
  const outcome = await submitOmesOperation(
    sql,
    tenantId,
    requester.tenantUserId,
    {
      serverId: "srv-shared",
      deploymentId: `dep-${tenantId.slice(-2)}`,
      operation: "rollback",
      parameters: {}
    },
    new Date()
  );
  expect(outcome.outcome).toBe("created");
  if (outcome.outcome !== "created") throw new Error("not created");
  expect(outcome.operationRequest.workflowInstanceId).not.toBeNull();
  return outcome.operationRequest.workflowInstanceId as string;
}

type ActionWire = {
  action: string;
  available: boolean;
  reason: string;
  requires_approval: boolean;
  mutating: boolean;
  method: string;
  path: string;
  advisories: string[];
  body?: { serverId: string; operation: string; deploymentId?: string };
};
type Envelope = {
  success: boolean;
  data?: {
    actions?: {
      kind: string;
      source_id: string;
      advisory: boolean;
      actions: ActionWire[];
    };
  };
  error?: { code: string };
};

const headers = (
  who: Persona,
  tenantId = TENANT_A
): Record<string, string> => ({
  "x-awcms-tenant-id": tenantId,
  authorization: `Bearer ${sessionTokens.get(who.tenantUserId)}`
});

const actions = (who: Persona, query: string, tenantId = TENANT_A) =>
  invoke<Envelope>(actionsGet, {
    path: `/api/v1/omes/mission-control/actions${query}`,
    headers: headers(who, tenantId)
  });

async function actionsFor(
  who: Persona,
  kind: string,
  id: string
): Promise<ActionWire[]> {
  const res = await actions(who, `?kind=${kind}&id=${encodeURIComponent(id)}`);
  expect(res.status).toBe(200);
  expect(res.body.data?.actions?.advisory).toBe(true);
  return res.body.data!.actions!.actions;
}
const pick = (list: ActionWire[], action: string): ActionWire => {
  const found = list.find((a) => a.action === action);
  expect(found, action).toBeDefined();
  return found as ActionWire;
};

const cancel = (
  who: Persona,
  rowId: string,
  key: string,
  tenantId = TENANT_A
) =>
  invoke<{ success: boolean; error?: { code: string } }>(cancelPost, {
    method: "POST",
    path: `/api/v1/omes/jobs/${rowId}/cancel`,
    params: { id: rowId },
    headers: { ...headers(who, tenantId), "idempotency-key": key }
  });

async function jobState(jobId: string, tenantId: string): Promise<string> {
  const rows = (await getHandlerAdminSql()`
    SELECT state FROM awcms_omes_jobs WHERE tenant_id = ${tenantId} AND job_id = ${jobId}
  `) as { state: string }[];
  return rows[0]!.state;
}

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "Mission Control contextual actions (real route handlers, real PostgreSQL)",
  () => {
    beforeAll(async () => {
      handlerReady = await ensureHandlerDatabaseReady();
    });
    afterAll(async () => {
      if (handlerReady) await teardownHandlerDatabase();
    });

    beforeEach(async () => {
      if (!handlerReady) return;
      await resetHandlerDatabase();
      sessionTokens.clear();
      rowIds.clear();
      const sql = getHandlerAdminSql();
      for (const [id, code] of [
        [TENANT_A, "mc267-a"],
        [TENANT_B, "mc267-b"]
      ] as const) {
        await sql`
          INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
          VALUES (${id}, ${code}, ${code}, 'active')
        `;
      }
      await seedPersona(TENANT_A, ADMIN, "mc267-admin", [...READ, ...MUTATE]);
      await seedPersona(TENANT_A, VIEWER, "mc267-viewer", READ);
      await seedPersona(TENANT_A, SERVERS_ONLY, "mc267-servers", [
        ["omes_control", "servers", "read"]
      ]);
      await seedPersona(TENANT_A, NOBODY, "mc267-nobody", []);
      await seedPersona(TENANT_B, OTHER_TENANT_ADMIN, "mc267-b-admin", [
        ...READ,
        ...MUTATE
      ]);
      await seedFleet(
        TENANT_A,
        [
          [A_JOB_QUEUED, "queued"],
          [A_JOB_FAILED, "failed"]
        ],
        [
          [A_BACKUP_UNVERIFIED, "in_progress"],
          [A_BACKUP_VERIFIED, "verified"]
        ]
      );
      await seedFleet(
        TENANT_B,
        [[B_JOB_QUEUED, "queued"]],
        [[B_BACKUP, "verified"]]
      );
    });

    afterEach(async () => {
      if (handlerReady) await resetHandlerDatabase();
    });

    // -- tenant isolation / no existence oracle ------------------------------
    test("another tenant's id, an unknown id, and an unreadable source all answer all-not_found, identically", async () => {
      if (!handlerReady) return;
      const missing = await actionsFor(ADMIN, "job", "job_does_not_exist");
      expect(missing.length).toBeGreaterThan(0);
      for (const a of missing) {
        expect(a.available).toBe(false);
        expect(a.reason).toBe("not_found");
        expect(a.advisories).toEqual([]);
        expect(a.body).toBeUndefined();
      }

      // Tenant B's job exists in the database (sanity), but is invisible to A.
      const exists = (await getHandlerAdminSql()`
        SELECT count(*)::int AS n FROM awcms_omes_jobs WHERE job_id = ${B_JOB_QUEUED}
      `) as { n: number }[];
      expect(exists[0]!.n).toBe(1);

      const strip = (list: ActionWire[]) =>
        list.map(({ path: _path, ...rest }) => rest);
      expect(strip(await actionsFor(ADMIN, "job", B_JOB_QUEUED))).toEqual(
        strip(missing)
      );

      // Every record-backed kind: tenant B's id is not_found for tenant A.
      const unknownForEveryKind: Array<[string, string]> = [
        ["backup", B_BACKUP],
        ["health_report", "srv-only-in-b"],
        ["deployment", "dep-b-only"],
        ["server", "srv-only-in-b"],
        ["approval_item", "e2670000-0000-4000-8000-0000000fffff"],
        ["approval_item", "not-a-uuid"],
        ["hermes_subagent", "nobody-here"],
        ["repository_milestone", "999999"]
      ];
      for (const [kind, id] of unknownForEveryKind) {
        for (const a of await actionsFor(ADMIN, kind, id)) {
          expect(a.reason, `${kind}:${id}:${a.action}`).toBe("not_found");
          expect(a.available).toBe(false);
        }
      }

      // The object exists for tenant B's own admin (the isolation is by tenant).
      const own = await actions(
        OTHER_TENANT_ADMIN,
        `?kind=job&id=${B_JOB_QUEUED}`,
        TENANT_B
      );
      expect(pick(own.body.data!.actions!.actions, "job.cancel").reason).toBe(
        "available"
      );

      // A viewer who may not READ the job source cannot tell it exists either.
      const hidden = await actionsFor(SERVERS_ONLY, "job", A_JOB_QUEUED);
      expect(strip(hidden)).toEqual(strip(missing));
    });

    // -- per-action permission and state -------------------------------------
    test("a viewer who can see a queued job but lacks jobs.cancel gets permission_denied; the admin gets available with the existing endpoint's row-id path", async () => {
      if (!handlerReady) return;
      const asViewer = await actionsFor(VIEWER, "job", A_JOB_QUEUED);
      expect(pick(asViewer, "job.cancel")).toMatchObject({
        available: false,
        reason: "permission_denied"
      });
      expect(pick(asViewer, "job.requeue").reason).toBe("permission_denied");
      expect(pick(asViewer, "open_details")).toMatchObject({
        available: true,
        reason: "available"
      });

      const asAdmin = await actionsFor(ADMIN, "job", A_JOB_QUEUED);
      const rowId = rowIds.get(A_JOB_QUEUED)!;
      expect(pick(asAdmin, "job.cancel")).toMatchObject({
        available: true,
        reason: "available",
        method: "POST",
        mutating: true,
        requires_approval: false,
        path: `/api/v1/omes/jobs/${rowId}/cancel`
      });
      // Requeue only applies to a failed job.
      expect(pick(asAdmin, "job.requeue").reason).toBe("state_not_eligible");

      const failed = await actionsFor(ADMIN, "job", A_JOB_FAILED);
      expect(pick(failed, "job.requeue")).toMatchObject({
        available: true,
        path: `/api/v1/omes/jobs/${rowIds.get(A_JOB_FAILED)}/approve`
      });
      expect(pick(failed, "job.cancel").reason).toBe("state_not_eligible");
    });

    test("servers, deployments and backups: operation bodies are the canonical screen's, destructive ones need approval, stale/decommissioned/unverified are non-blocking advisories", async () => {
      if (!handlerReady) return;
      const server = await actionsFor(ADMIN, "server", "srv-shared");
      expect(server.map((a) => a.action).sort()).toEqual([
        "open_details",
        "operation.preflight",
        "operation.status"
      ]);
      expect(pick(server, "operation.status")).toMatchObject({
        available: true,
        body: { serverId: "srv-shared", operation: "status" }
      });

      const deployment = await actionsFor(ADMIN, "deployment", "dep-a1");
      expect(pick(deployment, "operation.start").body).toEqual({
        serverId: "srv-shared",
        operation: "start",
        deploymentId: "dep-a1"
      });
      for (const op of ["stop", "rollback"]) {
        expect(pick(deployment, `operation.${op}`)).toMatchObject({
          available: true,
          requires_approval: true
        });
      }
      for (const op of ["start", "restart", "update", "backup", "status"]) {
        expect(pick(deployment, `operation.${op}`).requires_approval).toBe(
          false
        );
      }

      // Stale heartbeat + decommissioned: warnings only, never blocking.
      await getHandlerAdminSql()`
        UPDATE awcms_omes_servers
        SET status = 'decommissioned', last_heartbeat_at = now() - interval '2 hours'
        WHERE tenant_id = ${TENANT_A} AND server_id = 'srv-shared'
      `;
      const afterFacts = await actionsFor(ADMIN, "server", "srv-shared");
      expect(pick(afterFacts, "operation.status")).toMatchObject({
        available: true,
        advisories: ["target_decommissioned"]
      });
      const deployAfter = await actionsFor(ADMIN, "deployment", "dep-a1");
      expect(pick(deployAfter, "operation.restart")).toMatchObject({
        available: true,
        advisories: ["target_decommissioned"]
      });

      await getHandlerAdminSql()`
        UPDATE awcms_omes_deployments
        SET last_reconciled_at = now() - interval '2 hours'
        WHERE tenant_id = ${TENANT_A} AND deployment_id = 'dep-a1'
      `;
      const staleDeploy = await actionsFor(ADMIN, "deployment", "dep-a1");
      expect(pick(staleDeploy, "operation.start")).toMatchObject({
        available: true,
        advisories: ["target_stale", "target_decommissioned"]
      });
      // status / preflight never warn about freshness.
      expect(pick(staleDeploy, "operation.status").advisories).toEqual([
        "target_decommissioned"
      ]);

      const unverified = await actionsFor(ADMIN, "backup", A_BACKUP_UNVERIFIED);
      expect(pick(unverified, "backup.restore")).toMatchObject({
        available: true,
        requires_approval: true,
        advisories: ["backup_not_verified"],
        path: `/api/v1/omes/backups/${rowIds.get(A_BACKUP_UNVERIFIED)}/restore`
      });
      const verified = await actionsFor(ADMIN, "backup", A_BACKUP_VERIFIED);
      expect(pick(verified, "backup.restore").advisories).toEqual([]);
      // Without backups.restore the same backup is permission_denied.
      expect(
        pick(
          await actionsFor(VIEWER, "backup", A_BACKUP_VERIFIED),
          "backup.restore"
        ).reason
      ).toBe("permission_denied");
    });

    test("read-only kinds offer only open_details; a pending approval offers the inbox link", async () => {
      if (!handlerReady) return;
      const health = await actionsFor(ADMIN, "health_report", "srv-shared");
      expect(health.map((a) => a.action)).toEqual(["open_details"]);
      expect(health[0]).toMatchObject({ available: true });

      const instance = await seedPendingApproval(TENANT_A, ADMIN, VIEWER);
      const approval = await actionsFor(ADMIN, "approval_item", instance);
      expect(pick(approval, "approval.open_in_inbox")).toMatchObject({
        available: true,
        method: "GET",
        path: `/admin/approvals?workflowKey=${OMES_DESTRUCTIVE_WORKFLOW_KEY}&instance=${instance}`
      });
      expect(approval.some((a) => a.mutating)).toBe(false);
      // Not visible to a viewer without workflow.approval.read.
      for (const a of await actionsFor(
        SERVERS_ONLY,
        "approval_item",
        instance
      )) {
        expect(a.reason).toBe("not_found");
      }
    });

    // -- the availability endpoint is advisory; the mutation endpoints decide --
    test("a forged direct POST to the existing cancel endpoint without the permission is still 403, whatever the advisory said", async () => {
      if (!handlerReady) return;
      const rowId = rowIds.get(A_JOB_QUEUED)!;
      const forged = await cancel(VIEWER, rowId, "forged-viewer-1");
      expect(forged.status).toBe(403);
      expect(await jobState(A_JOB_QUEUED, TENANT_A)).toBe("queued");

      const noPerms = await cancel(SERVERS_ONLY, rowId, "forged-servers-1");
      expect(noPerms.status).toBe(403);
      const nobody = await cancel(NOBODY, rowId, "forged-nobody-1");
      expect(nobody.status).toBe(403);

      // Same for requeue and for a destructive operation submission.
      const failedRow = rowIds.get(A_JOB_FAILED)!;
      const requeue = await invoke<unknown>(approvePost, {
        method: "POST",
        path: `/api/v1/omes/jobs/${failedRow}/approve`,
        params: { id: failedRow },
        headers: { ...headers(VIEWER), "idempotency-key": "forged-requeue-1" }
      });
      expect(requeue.status).toBe(403);
      expect(await jobState(A_JOB_FAILED, TENANT_A)).toBe("failed");

      const stop = await invoke<unknown>(operationsPost, {
        method: "POST",
        path: "/api/v1/omes/operations",
        headers: { ...headers(VIEWER), "idempotency-key": "forged-stop-1" },
        body: { serverId: "srv-shared", operation: "stop" }
      });
      expect(stop.status).toBe(403);
      const requests = (await getHandlerAdminSql()`
        SELECT count(*)::int AS n FROM awcms_omes_operation_requests WHERE tenant_id = ${TENANT_A}
      `) as { n: number }[];
      expect(requests[0]!.n).toBe(0);
    });

    test("a forged POST at another tenant's job id is refused and leaves that job queued", async () => {
      if (!handlerReady) return;
      const foreignRow = rowIds.get(B_JOB_QUEUED)!;
      const res = await cancel(ADMIN, foreignRow, "forged-cross-tenant-1");
      expect(res.status).toBe(404);
      expect(await jobState(B_JOB_QUEUED, TENANT_B)).toBe("queued");
    });

    test("the real cancel through the suggested path works, is idempotent under the same key, and the advisory then reflects the new state", async () => {
      if (!handlerReady) return;
      const before = pick(
        await actionsFor(ADMIN, "job", A_JOB_QUEUED),
        "job.cancel"
      );
      expect(before.available).toBe(true);
      const rowId = rowIds.get(A_JOB_QUEUED)!;
      expect(before.path).toBe(`/api/v1/omes/jobs/${rowId}/cancel`);

      const first = await cancel(ADMIN, rowId, "real-cancel-1");
      expect(first.status).toBe(200);
      expect(await jobState(A_JOB_QUEUED, TENANT_A)).toBe("cancelled");
      const replay = await cancel(ADMIN, rowId, "real-cancel-1");
      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(first.body);

      expect(
        pick(await actionsFor(ADMIN, "job", A_JOB_QUEUED), "job.cancel")
      ).toMatchObject({ available: false, reason: "state_not_eligible" });
    });

    // -- query validation -----------------------------------------------------
    test("unknown parameters (command, shell, target, url), a bad kind and a bad id are 400s; authorization decides first", async () => {
      if (!handlerReady) return;
      for (const query of [
        "?kind=server&id=srv-shared&command=reboot",
        "?command=reboot",
        "?kind=server&id=srv-shared&shell=ls",
        "?kind=server&id=srv-shared&target=10.0.0.1",
        "?kind=server&id=srv-shared&url=http%3A%2F%2Fx",
        "?kind=host&id=srv-shared",
        "?kind=server",
        "?kind=server&id=a%20b",
        `?kind=server&id=${"a".repeat(129)}`
      ]) {
        const res = await actions(ADMIN, query);
        expect(res.status, query).toBe(400);
        expect(res.body.error?.code).toBe("VALIDATION_ERROR");
      }
      const valid = await actions(NOBODY, "?kind=server&id=srv-shared");
      expect(valid.status).toBe(403);
      const invalid = await actions(
        NOBODY,
        "?kind=server&id=srv-shared&command=x"
      );
      expect(invalid.status).toBe(403);
    });
  }
);
