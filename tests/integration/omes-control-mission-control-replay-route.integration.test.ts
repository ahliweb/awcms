/**
 * The REAL route handlers behind Mission Control replay (Issue
 * ahliweb/omes#266, ADR-0031 rule 4): `GET /api/v1/omes/mission-control/replay`
 * and `GET .../scene` with and without `as_of`, driven through
 * `defineTenantRoute` against a real PostgreSQL — the actual authorization
 * chokepoint, the actual `awcms_role_permissions` grants, the actual query
 * validation and the actual response envelope.
 *
 *  - a window longer than 24 hours, an unknown query parameter, an `as_of` in
 *    the future or older than the retention horizon are each a 400
 *    `VALIDATION_ERROR` for a caller who IS permitted;
 *  - authorization decides first: a caller without `omes_control.servers.read`
 *    gets 403 for a valid AND for an invalid request (the 400 never leaks the
 *    schema to a caller who may not use the endpoint);
 *  - a caller holding only `servers.read` is admitted but sees every other
 *    source as a `source_unavailable` gap — historical access is never broader
 *    than the live view's per-source access.
 *
 * WORLD-2 (harness.ts) — the route handler reaches for `getDatabaseClient()`
 * internally, so this runs against the migrated `DATABASE_URL` database and is
 * skipped unless one is configured.
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
import { GET as replayGet } from "../../src/pages/api/v1/omes/mission-control/replay";
import { GET as sceneGet } from "../../src/pages/api/v1/omes/mission-control/scene";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";

const TENANT = "e2660000-0000-4000-8000-0000000000f1";
const READER = {
  profileId: "e2660000-0000-4000-8000-0000000000f2",
  tenantUserId: "e2660000-0000-4000-8000-0000000000f3",
  identityId: "e2660000-0000-4000-8000-0000000000f4",
  roleId: "e2660000-0000-4000-8000-0000000000f5",
  loginIdentifier: "reader-266@example.test"
};
const NOBODY = {
  profileId: "e2660000-0000-4000-8000-000000000101",
  tenantUserId: "e2660000-0000-4000-8000-000000000102",
  identityId: "e2660000-0000-4000-8000-000000000103",
  roleId: "e2660000-0000-4000-8000-000000000104",
  loginIdentifier: "nobody-266@example.test"
};

let handlerReady = false;
const sessionTokens = new Map<string, string>();

async function seedPersona(
  persona: typeof READER,
  roleName: string,
  permissions: ReadonlyArray<[string, string, string]>
): Promise<void> {
  const sql = getHandlerAdminSql();
  await sql`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name)
    VALUES (${persona.profileId}, ${TENANT}, 'person', ${roleName})
  `;
  await sql`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${persona.identityId}, ${TENANT}, ${persona.profileId},
            ${persona.loginIdentifier}, 'not-a-real-hash', 'active')
  `;
  await sql`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${persona.tenantUserId}, ${TENANT}, ${persona.identityId}, 'active')
  `;
  await sql`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system)
    VALUES (${persona.roleId}, ${TENANT}, ${roleName}, ${roleName}, false)
  `;
  for (const [moduleKey, activityCode, action] of permissions) {
    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT ${TENANT}, ${persona.roleId}, p.id
      FROM awcms_permissions p
      WHERE p.module_key = ${moduleKey} AND p.activity_code = ${activityCode}
        AND p.action = ${action}
    `;
  }
  await grantRolePolicy(sql, TENANT, {
    tenantUserId: persona.tenantUserId,
    roleId: persona.roleId,
    grantedByTenantUserId: null
  });
  const token = generateSessionToken();
  sessionTokens.set(persona.tenantUserId, token);
  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${persona.identityId}, ${hashSessionToken(token)},
            now() + interval '1 hour')
  `;
}

type Envelope = {
  success: boolean;
  data?: {
    window?: {
      events: unknown[];
      evidence_gaps: Array<{ source_kind: string; reason: string }>;
      window: { from: string; to: string };
    };
    scene?: {
      mode: string;
      as_of: string;
      evidence_gaps?: Array<{ source_kind: string; reason: string }>;
    };
  };
  error?: { code: string };
};

function headers(tenantUserId: string): Record<string, string> {
  return {
    "x-awcms-tenant-id": TENANT,
    authorization: `Bearer ${sessionTokens.get(tenantUserId)}`
  };
}

const wire = (ms: number): string =>
  `${new Date(ms).toISOString().slice(0, 19)}Z`;
const ago = (minutes: number): string => wire(Date.now() - minutes * 60_000);

const replay = (who: typeof READER, query: string) =>
  invoke<Envelope>(replayGet, {
    path: `/api/v1/omes/mission-control/replay${query}`,
    headers: headers(who.tenantUserId)
  });
const scene = (who: typeof READER, query: string) =>
  invoke<Envelope>(sceneGet, {
    path: `/api/v1/omes/mission-control/scene${query}`,
    headers: headers(who.tenantUserId)
  });

const suite = integrationEnabled ? describe : describe.skip;

suite(
  "Mission Control replay routes (real route handlers, real PostgreSQL)",
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
      await getHandlerAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
      VALUES (${TENANT}, 'mc266-route', 'Mission Control 266 route', 'active')
    `;
      // servers.read ONLY: admitted to the workspace, no other source.
      await seedPersona(READER, "mc266-reader", [
        ["omes_control", "servers", "read"]
      ]);
      await seedPersona(NOBODY, "mc266-nobody", []);
    });

    afterEach(async () => {
      if (handlerReady) await resetHandlerDatabase();
    });

    test("a window longer than 24 hours is a 400 VALIDATION_ERROR", async () => {
      if (!handlerReady) return;
      const res = await replay(
        READER,
        `?from=${ago(24 * 60 + 5)}&to=${ago(1)}`
      );
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION_ERROR");
    });

    test("an unknown query parameter is a 400 on both routes", async () => {
      if (!handlerReady) return;
      const unknown = await replay(
        READER,
        `?from=${ago(60)}&to=${ago(1)}&limit=10`
      );
      expect(unknown.status).toBe(400);
      expect(unknown.body.error?.code).toBe("VALIDATION_ERROR");
      const sceneUnknown = await scene(READER, "?kind=job");
      expect(sceneUnknown.status).toBe(400);
    });

    test("a future `to`, a tampered cursor, a future as_of and an as_of past the retention horizon are 400s", async () => {
      if (!handlerReady) return;
      const future = wire(Date.now() + 3_600_000);
      expect(
        (await replay(READER, `?from=${ago(30)}&to=${future}`)).status
      ).toBe(400);
      expect(
        (await replay(READER, `?from=${ago(60)}&to=${ago(1)}&cursor=%25%25`))
          .status
      ).toBe(400);
      expect((await scene(READER, `?as_of=${future}`)).status).toBe(400);
      expect((await scene(READER, `?as_of=${ago(200 * 24 * 60)}`)).status).toBe(
        400
      );
    });

    test("a valid window is a 200 envelope; only servers.read is held so every other source is a source_unavailable gap", async () => {
      if (!handlerReady) return;
      const res = await replay(READER, `?from=${ago(60)}&to=${ago(1)}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const window = res.body.data!.window!;
      expect(window.events).toEqual([]);
      const unavailable = window.evidence_gaps
        .filter((g) => g.reason === "source_unavailable")
        .map((g) => g.source_kind);
      for (const source of [
        "omes_deployment_view",
        "omes_job_status",
        "omes_backup_status",
        "hermes_orchestration_tree",
        "omes_architecture_capabilities_view",
        "omes_ai_privacy_posture_view",
        "awcms_workflow_approval"
      ]) {
        expect(unavailable).toContain(source);
      }
      expect(unavailable).not.toContain("omes_server_inventory");
      expect(unavailable).not.toContain("omes_health_readiness");
    });

    test("scene: no as_of is the live scene; a valid as_of is the historical scene with evidence_gaps", async () => {
      if (!handlerReady) return;
      const live = await scene(READER, "");
      expect(live.status).toBe(200);
      expect(live.body.data!.scene!.mode).toBe("live");

      const asOf = ago(10);
      const historical = await scene(READER, `?as_of=${asOf}`);
      expect(historical.status).toBe(200);
      expect(historical.body.data!.scene!.mode).toBe("historical");
      expect(historical.body.data!.scene!.as_of).toBe(asOf);
      expect(
        historical.body.data!.scene!.evidence_gaps!.length
      ).toBeGreaterThan(0);
    });

    test("authorization decides first: a caller without servers.read gets 403 for a valid AND an invalid request", async () => {
      if (!handlerReady) return;
      const valid = await replay(NOBODY, `?from=${ago(60)}&to=${ago(1)}`);
      expect(valid.status).toBe(403);
      const invalid = await replay(
        NOBODY,
        `?from=${ago(60 * 48)}&to=${ago(1)}&limit=5`
      );
      expect(invalid.status).toBe(403);
      expect((await scene(NOBODY, `?as_of=${ago(5)}`)).status).toBe(403);
    });
  }
);
