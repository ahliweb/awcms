/**
 * OMES Control Center owner/operator API (Issue ahliweb/omes#198) against a
 * real PostgreSQL: tenant isolation under RLS, default-deny RBAC, safe vs
 * destructive operation submission (workflow-approval gating), and
 * idempotent replay of a mutation. Gated on `DATABASE_URL` (harness §Gating).
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
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { OMES_GUARDS } from "../../src/modules/omes-control/domain/permissions";
import {
  fetchServerDetail,
  fetchServers,
  registerServer
} from "../../src/modules/omes-control/application/server-directory";
import { submitOmesOperation } from "../../src/modules/omes-control/application/operation-submission";
import { issueEnrollmentChallengeForServer } from "../../src/modules/omes-control/application/enrollment-management";
import { OMES_DESTRUCTIVE_WORKFLOW_KEY } from "../../src/modules/omes-control/domain/operations";
import {
  computeRequestHash,
  findIdempotencyRecord,
  saveIdempotencyRecord
} from "../../src/modules/_shared/idempotency";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "e1000000-0000-4000-8000-0000000000a1";
const TENANT_B = "e1000000-0000-4000-8000-0000000000b1";
const OWNER_ROLE_A = "e1000000-0000-4000-8000-0000000000c1";
const OWNER_USER_A = "e1000000-0000-4000-8000-0000000000d1";
const NO_PERMISSION_USER_A = "e1000000-0000-4000-8000-0000000000e1";
const OWNER_SESSION = "omes-it-owner-session";
const NO_PERMISSION_SESSION = "omes-it-no-permission-session";

async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${id}, ${code}, ${code})
  `;
}

async function seedTenantUser(
  tenantId: string,
  id: string,
  label: string,
  sessionToken: string
): Promise<void> {
  const admin = getAdminSql();

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Display ${label}`})
    RETURNING id
  `) as { id: string }[];

  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${id}, ${tenantId}, ${identity[0]!.id})
  `;

  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(sessionToken)}, now() + interval '8 hours')
  `;
}

/** Grants exactly one omes_control permission to OWNER_ROLE_A and assigns it to OWNER_USER_A. */
async function grantOmesPermission(
  activityCode: string,
  action: string
): Promise<void> {
  const admin = getAdminSql();

  const roleExists = (await admin`
    SELECT 1 FROM awcms_roles WHERE id = ${OWNER_ROLE_A}
  `) as unknown[];

  if (roleExists.length === 0) {
    await admin`
      INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system)
      VALUES (${OWNER_ROLE_A}, ${TENANT_A}, 'owner', 'Owner', true)
    `;
    // Granted through the REAL writer (not a raw INSERT) — see
    // tests/integration/grant-readers.integration.test.ts for why: a
    // hand-rolled row could land in whatever table this test happens to
    // pick, which proves nothing about what authorizeInTransaction reads.
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      grantRolePolicy(tx, TENANT_A, {
        tenantUserId: OWNER_USER_A,
        roleId: OWNER_ROLE_A,
        grantedByTenantUserId: null
      })
    );
  }

  const permission = (await admin`
    SELECT id FROM awcms_permissions
    WHERE module_key = 'omes_control' AND activity_code = ${activityCode} AND action = ${action}
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    VALUES (${TENANT_A}, ${OWNER_ROLE_A}, ${permission[0]!.id})
    ON CONFLICT DO NOTHING
  `;
}

async function seedServer(
  tenantId: string,
  serverId: string,
  hostname: string
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_omes_servers (tenant_id, server_id, hostname, status)
    VALUES (${tenantId}, ${serverId}, ${hostname}, 'offline')
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

suite("omes_control owner/operator API (real PostgreSQL)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "omes-it-tenant-a");
    await seedTenant(TENANT_B, "omes-it-tenant-b");
    await seedTenantUser(TENANT_A, OWNER_USER_A, "owner", OWNER_SESSION);
    await seedTenantUser(
      TENANT_A,
      NO_PERMISSION_USER_A,
      "noperm",
      NO_PERMISSION_SESSION
    );
  }, 30000);

  describe("tenant isolation under RLS", () => {
    test("a server registered for tenant B is invisible to tenant A's list and detail reads", async () => {
      await seedServer(TENANT_A, "srv-a-1", "a1.example.test");
      const serverBRowId = await seedServer(
        TENANT_B,
        "srv-b-1",
        "b1.example.test"
      );

      const listForA = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT_A,
        (tx) => fetchServers(tx, TENANT_A, new Date())
      );

      expect(listForA.servers).toHaveLength(1);
      expect(listForA.servers[0]!.hostname).toBe("a1.example.test");

      // Cross-tenant reference by id -> neutral not-found, never a leak or a 403.
      const detailFromA = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT_A,
        (tx) => fetchServerDetail(tx, TENANT_A, serverBRowId, new Date())
      );

      expect(detailFromA).toBeNull();
    });

    test("registerServer under tenant A never creates a row tenant B's transaction can see", async () => {
      await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        registerServer(tx, TENANT_A, new Date(), {
          hostname: "isolated.example.test",
          platform: { os: "ubuntu", version: "24.04", arch: "amd64" }
        })
      );

      const listForB = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT_B,
        (tx) => fetchServers(tx, TENANT_B, new Date())
      );

      expect(listForB.servers).toHaveLength(0);
    });
  });

  describe("default-deny RBAC", () => {
    test("a session with no granted permission is denied servers.read", async () => {
      const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        authorizeInTransaction(
          tx,
          TENANT_A,
          hashSessionToken(NO_PERMISSION_SESSION),
          new Date(),
          OMES_GUARDS.servers.read
        )
      );

      expect(result.allowed).toBe(false);
    });

    test("the same permission, once granted, is allowed", async () => {
      await grantOmesPermission("servers", "read");

      const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        authorizeInTransaction(
          tx,
          TENANT_A,
          hashSessionToken(OWNER_SESSION),
          new Date(),
          OMES_GUARDS.servers.read
        )
      );

      expect(result.allowed).toBe(true);
    });
  });

  describe("operation submission — safe vs destructive", () => {
    test("a safe operation (status) is auto-approved with no workflow involved", async () => {
      const serverRowId = await seedServer(
        TENANT_A,
        "srv-a-2",
        "a2.example.test"
      );

      const outcome = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        submitOmesOperation(
          tx,
          TENANT_A,
          OWNER_USER_A,
          {
            serverId: "srv-a-2",
            operation: "status",
            parameters: {}
          },
          new Date()
        )
      );

      expect(outcome.outcome).toBe("created");
      if (outcome.outcome === "created") {
        expect(outcome.operationRequest.status).toBe("approved");
        expect(outcome.operationRequest.workflowInstanceId).toBeNull();
      }

      void serverRowId;
    });

    test("a destructive operation (stop) is refused when no workflow is published", async () => {
      const outcome = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        submitOmesOperation(
          tx,
          TENANT_A,
          OWNER_USER_A,
          {
            serverId: "srv-a-3",
            operation: "stop",
            parameters: {}
          },
          new Date()
        )
      );

      expect(outcome.outcome).toBe("approval_workflow_not_configured");

      // Nothing was persisted — a refused destructive submission leaves no
      // dangling row for a later approval to accidentally pick up.
      const rows = (await getAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_operation_requests
        WHERE tenant_id = ${TENANT_A} AND server_id = 'srv-a-3'
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(0);
    });

    test("a destructive operation (rollback) is approved through the canonical workflow-approval engine once a definition is published", async () => {
      // A single `end` node resolves synchronously (zero required approvers) —
      // proves the LINK to workflow-approval, not its own approval-graph logic
      // (already covered by tests/workflow-approval*.test.ts).
      const graph = {
        startNodeId: "end_approved",
        nodes: [{ id: "end_approved", type: "end", outcome: "approved" }]
      };
      // Declares every key submitOmesOperation's `facts` passes to
      // startWorkflowInstance (application/operation-submission.ts) —
      // an undeclared fact key is refused by validateFactsAgainstSchema.
      const factsSchema = [
        { key: "operation", type: "string" },
        { key: "serverId", type: "string" },
        { key: "deploymentId", type: "string" }
      ];

      await getAdminSql()`
        INSERT INTO awcms_workflow_definitions
          (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
        VALUES (
          ${TENANT_A}, ${OMES_DESTRUCTIVE_WORKFLOW_KEY}, 'OMES destructive op', 1,
          'active', ${graph}::jsonb, ${factsSchema}::jsonb
        )
      `;

      const outcome = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        submitOmesOperation(
          tx,
          TENANT_A,
          OWNER_USER_A,
          {
            serverId: "srv-a-4",
            deploymentId: "dep-a-4",
            operation: "rollback",
            parameters: {},
            rollbackRef: "backup-42"
          },
          new Date()
        )
      );

      expect(outcome.outcome).toBe("created");
      if (outcome.outcome === "created") {
        expect(outcome.operationRequest.status).toBe("approved");
        expect(outcome.operationRequest.workflowInstanceId).not.toBeNull();
      }
    });
  });

  describe("enrollment challenge issuance", () => {
    test("re-issuing a challenge for the same server supersedes (expires) the prior pending one", async () => {
      const serverRowId = await seedServer(
        TENANT_A,
        "srv-a-5",
        "a5.example.test"
      );

      const first = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        issueEnrollmentChallengeForServer(tx, TENANT_A, serverRowId, new Date())
      );
      expect(first.outcome).toBe("issued");

      const second = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        issueEnrollmentChallengeForServer(tx, TENANT_A, serverRowId, new Date())
      );
      expect(second.outcome).toBe("issued");

      const rows = (await getAdminSql()`
        SELECT worker_id, status FROM awcms_omes_enrollments
        WHERE tenant_id = ${TENANT_A} AND server_id = 'srv-a-5'
        ORDER BY created_at
      `) as { worker_id: string; status: string }[];

      // Exactly one row is still `pending` — the SECOND, most recent
      // challenge. The first is `expired`, never a second live challenge
      // outstanding for the same server under a different worker_id.
      expect(rows).toHaveLength(2);
      const pending = rows.filter((r) => r.status === "pending");
      expect(pending).toHaveLength(1);
      if (second.outcome === "issued") {
        expect(pending[0]!.worker_id).toBe(second.workerId);
      }
      const expired = rows.filter((r) => r.status === "expired");
      expect(expired).toHaveLength(1);
      if (first.outcome === "issued") {
        expect(expired[0]!.worker_id).toBe(first.workerId);
      }
    });
  });

  describe("idempotent replay", () => {
    test("resubmitting the same registration request with the same Idempotency-Key replays without a second row", async () => {
      const input = {
        hostname: "replay.example.test",
        platform: {
          os: "ubuntu" as const,
          version: "24.04",
          arch: "amd64" as const
        }
      };
      const requestHash = computeRequestHash({
        action: "register_server",
        input
      });
      const idempotencyKey = "replay-key-1";

      // First attempt: no prior record, do the mutation, save the record —
      // exactly the sequence servers/index.ts's POST handler follows.
      const first = await withTenantOrThrow(
        getRuntimeSql(),
        TENANT_A,
        async (tx) => {
          const existing = await findIdempotencyRecord(
            tx,
            TENANT_A,
            "omes_server_register",
            idempotencyKey
          );
          expect(existing).toBeNull();

          const outcome = await registerServer(tx, TENANT_A, new Date(), input);
          await saveIdempotencyRecord(
            tx,
            TENANT_A,
            "omes_server_register",
            idempotencyKey,
            requestHash,
            201,
            { server: outcome.server }
          );

          return outcome;
        }
      );

      expect(first.outcome).toBe("registered");

      // Second attempt with the SAME key: the replay path must be taken —
      // never a second registerServer call.
      const replay = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
        findIdempotencyRecord(
          tx,
          TENANT_A,
          "omes_server_register",
          idempotencyKey
        )
      );

      expect(replay).not.toBeNull();
      expect(replay!.requestHash).toBe(requestHash);
      expect(replay!.responseStatus).toBe(201);

      const rows = (await getAdminSql()`
        SELECT count(*)::int AS count FROM awcms_omes_servers
        WHERE tenant_id = ${TENANT_A} AND hostname = 'replay.example.test'
      `) as { count: number }[];
      expect(rows[0]!.count).toBe(1);
    });
  });
});
