/**
 * The HTTP surface of `crm_follow_up`, driven through the REAL route handlers
 * (Issue #1165, ADR-0159):
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every
 *     route, and every guard BITES (a user holding every permission but one is
 *     refused that action), which also proves each guard names a seeded
 *     permission;
 *   * the switches: deployment (503 after authorization), tenant (409 for task
 *     writes and stops, while rules may be prepared);
 *   * rules: create, immutable revisions (an identical republish is refused),
 *     archive, optimistic concurrency, an inactive named user refused;
 *   * simulation answers without writing;
 *   * a staff stop cancels the lead's work; complete and cancel close a task;
 *   * idempotent replay of a mutation.
 *
 * Gated on `DATABASE_URL`.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";
import { randomBytes } from "node:crypto";

import {
  createCookieJar,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  getHandlerDatabaseClient,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { crmFollowUpModule } from "../../src/modules/crm-follow-up/module";
import { createTasksForTrigger } from "../../src/modules/crm-follow-up/application/task-engine";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import {
  GET as getSettings,
  PATCH as patchSettings
} from "../../src/pages/api/v1/crm-follow-up/settings";
import {
  GET as listRules,
  POST as createRule
} from "../../src/pages/api/v1/crm-follow-up/rules/index";
import { POST as simulateRule } from "../../src/pages/api/v1/crm-follow-up/rules/simulate";
import { GET as getRule } from "../../src/pages/api/v1/crm-follow-up/rules/[id]/index";
import { POST as publishRevision } from "../../src/pages/api/v1/crm-follow-up/rules/[id]/revisions";
import { POST as archiveRule } from "../../src/pages/api/v1/crm-follow-up/rules/[id]/archive";
import { GET as listTasks } from "../../src/pages/api/v1/crm-follow-up/tasks/index";
import { GET as getTask } from "../../src/pages/api/v1/crm-follow-up/tasks/[id]/index";
import { POST as completeTask } from "../../src/pages/api/v1/crm-follow-up/tasks/[id]/complete";
import { POST as cancelTask } from "../../src/pages/api/v1/crm-follow-up/tasks/[id]/cancel";
import {
  GET as listStops,
  POST as createStop
} from "../../src/pages/api/v1/crm-follow-up/leads/[leadId]/stop-signals";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const BASE = "/api/v1/crm-follow-up";

type Envelope<T = any> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: any };
};

let env: { tenantId: string; token: string; ownerUserId: string };
let keyCounter = 0;
let userCounter = 0;
let savedEnabled: string | undefined;
const admin = () => getHandlerAdminSql();
const nextKey = () => `idem-${(keyCounter += 1)}-${crypto.randomUUID()}`;

const ALL_PERMISSIONS = (crmFollowUpModule.permissions ?? []).map(
  (p) => `crm_follow_up.${p.activityCode}.${p.action}`
);

async function bootstrap() {
  const loginIdentifier = "follow-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Follow Co",
      tenantCode: "follow-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  const tenantId = setup.body.data.tenantId;
  const login = await invoke<{ data: { token: string } }>(authLogin, {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId
    },
    body: { loginIdentifier, password: OWNER_PASSWORD },
    cookies: createCookieJar()
  });

  expect(login.status).toBe(200);

  const ownerRows = (await admin()`
    SELECT tu.id FROM awcms_tenant_users tu
    JOIN awcms_identities i ON i.id = tu.identity_id
    WHERE tu.tenant_id = ${tenantId} AND i.login_identifier = ${loginIdentifier}
  `) as { id: string }[];

  return {
    tenantId,
    token: login.body.data.token,
    ownerUserId: ownerRows[0]!.id
  };
}

async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x') RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `fu-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level, last_authenticated_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
    `) as { id: string }[];

    for (const key of permissionKeys) {
      const [moduleKey, activityCode, action] = key.split(".");
      const permission = (await sql`
        SELECT id FROM awcms_permissions
        WHERE module_key = ${moduleKey!} AND activity_code = ${activityCode!}
          AND action = ${action!}
      `) as { id: string }[];

      if (!permission[0]) {
        throw new Error(`fixture: permission ${key} is not in the catalogue`);
      }

      await sql`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        VALUES (${tenantId}, ${role[0]!.id}, ${permission[0].id})
      `;
    }

    await withTenantOrThrow(getHandlerDatabaseClient(), tenantId, (tx) =>
      grantRolePolicy(tx, tenantId, {
        tenantUserId: tenantUser[0]!.id,
        roleId: role[0]!.id,
        grantedByTenantUserId: null,
        reason: "crm follow-up fixture"
      })
    );
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

function call<T = any>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string | null;
    idempotencyKey?: string | null;
    query?: string;
  }
) {
  const token = options.token === undefined ? env.token : options.token;
  const mutating = (options.method ?? "GET") !== "GET";
  const key =
    options.idempotencyKey === undefined && mutating
      ? nextKey()
      : options.idempotencyKey;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": env.tenantId
  };

  if (token) headers.authorization = `Bearer ${token}`;
  if (key) headers["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-api-1165" }
  });
}

const DEFINITION = {
  trigger: { kind: "stage_entered", stageCategory: "qualified" },
  taskTitle: "Call the qualified lead",
  dueAfterMinutes: 60,
  assignee: { mode: "lead_owner" },
  notify: { onAssign: true, onDue: true },
  calendar: {
    timeZone: "Asia/Jakarta",
    workingDays: [1, 2, 3, 4, 5],
    workStartMinute: 540,
    workEndMinute: 1020,
    holidays: []
  }
};

async function enableTenant() {
  const res = await call(patchSettings, {
    method: "PATCH",
    path: `${BASE}/settings`,
    body: { enabled: true }
  });
  expect(res.status).toBe(200);
}

async function newRule(code = "qualified-callback"): Promise<any> {
  const res = await call(createRule, {
    method: "POST",
    path: `${BASE}/rules`,
    body: { code, name: "Qualified call-back", definition: DEFINITION }
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

/** A task, created as the consumer would (the event path is covered by the engine suite). */
async function seedTask(leadId: string): Promise<string> {
  const outcome = await withTenantOrThrow(
    getHandlerDatabaseClient(),
    env.tenantId,
    (tx) =>
      createTasksForTrigger(
        tx,
        env.tenantId,
        {
          kind: "stage_entered",
          leadId,
          pipelineId: null,
          stageCategory: "qualified",
          stageKey: "qualified",
          ownerTenantUserId: env.ownerUserId,
          occurredAt: new Date()
        },
        crypto.randomUUID()
      )
  );

  expect(outcome.created).toHaveLength(1);
  return outcome.created[0]!;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("crm_follow_up HTTP surface (#1165)", () => {
  let ready = false;

  beforeAll(async () => {
    savedEnabled = process.env.CRM_FOLLOW_UP_ENABLED;
    process.env.CRM_FOLLOW_UP_ENABLED = "true";
    ready = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    if (savedEnabled === undefined) delete process.env.CRM_FOLLOW_UP_ENABLED;
    else process.env.CRM_FOLLOW_UP_ENABLED = savedEnabled;
    if (ready) await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!ready) return;
    await resetHandlerDatabase();
    env = await bootstrap();
    // The bootstrap owner role is seeded from the catalogue at setup time,
    // which includes sql/370; grant the owner every follow-up permission
    // explicitly anyway so the suite does not depend on that seed.
    const sql = admin();
    const ownerRole = (await sql`
      SELECT r.id FROM awcms_roles r
      WHERE r.tenant_id = ${env.tenantId} AND r.role_code = 'owner'
    `) as { id: string }[];
    if (ownerRole[0]) {
      await sql`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        SELECT ${env.tenantId}, ${ownerRole[0].id}, p.id FROM awcms_permissions p
        WHERE p.module_key = 'crm_follow_up'
        ON CONFLICT DO NOTHING
      `;
    }
  });

  test("default-deny: no token is 401; a user with no role is 403 everywhere", async () => {
    if (!ready) return;
    const id = crypto.randomUUID();
    const nobody = await seedUser(env.tenantId, "nobody", []);
    const routes: [
      Parameters<typeof invoke>[0],
      string,
      string,
      Record<string, string>?
    ][] = [
      [getSettings, "GET", `${BASE}/settings`],
      [patchSettings, "PATCH", `${BASE}/settings`],
      [listRules, "GET", `${BASE}/rules`],
      [createRule, "POST", `${BASE}/rules`],
      [simulateRule, "POST", `${BASE}/rules/simulate`],
      [getRule, "GET", `${BASE}/rules/${id}`, { id }],
      [publishRevision, "POST", `${BASE}/rules/${id}/revisions`, { id }],
      [archiveRule, "POST", `${BASE}/rules/${id}/archive`, { id }],
      [listTasks, "GET", `${BASE}/tasks`],
      [getTask, "GET", `${BASE}/tasks/${id}`, { id }],
      [completeTask, "POST", `${BASE}/tasks/${id}/complete`, { id }],
      [cancelTask, "POST", `${BASE}/tasks/${id}/cancel`, { id }],
      [listStops, "GET", `${BASE}/leads/${id}/stop-signals`, { leadId: id }],
      [createStop, "POST", `${BASE}/leads/${id}/stop-signals`, { leadId: id }]
    ];
    const bodies: Record<string, unknown> = {
      [`${BASE}/settings`]: { enabled: true },
      [`${BASE}/rules`]: { code: "x-rule", name: "x", definition: DEFINITION },
      [`${BASE}/rules/simulate`]: {
        definition: DEFINITION,
        trigger: { kind: "stage_entered", occurredAt: new Date().toISOString() }
      }
    };

    for (const [handler, method, path, params] of routes) {
      const body =
        bodies[path] ??
        (path.endsWith("complete")
          ? { expectedVersion: 1, outcome: "reached" }
          : path.endsWith("stop-signals")
            ? { kind: "manual" }
            : path.endsWith("revisions")
              ? { expectedVersion: 1, definition: DEFINITION }
              : { expectedVersion: 1 });
      const anonymous = await call(handler, {
        method,
        path,
        params,
        body: method === "GET" ? undefined : body,
        token: null
      });
      expect(anonymous.status).toBe(401);
      const denied = await call(handler, {
        method,
        path,
        params,
        body: method === "GET" ? undefined : body,
        token: nobody.token
      });
      expect(denied.status).toBe(403);
    }
  });

  test("every guard bites: all permissions but one is refused that one", async () => {
    if (!ready) return;
    const cases: [string, () => Promise<number>][] = [];

    for (const missing of ALL_PERMISSIONS) {
      const user = await seedUser(
        env.tenantId,
        "almost",
        ALL_PERMISSIONS.filter((key) => key !== missing)
      );
      const probe = async () => {
        switch (missing) {
          case "crm_follow_up.rules.read":
            return (
              await call(listRules, {
                path: `${BASE}/rules`,
                token: user.token
              })
            ).status;
          case "crm_follow_up.rules.configure":
            return (
              await call(createRule, {
                method: "POST",
                path: `${BASE}/rules`,
                body: { code: "bite", name: "x", definition: DEFINITION },
                token: user.token
              })
            ).status;
          case "crm_follow_up.tasks.read":
            return (
              await call(listTasks, {
                path: `${BASE}/tasks`,
                token: user.token
              })
            ).status;
          case "crm_follow_up.tasks.update": {
            const id = crypto.randomUUID();
            return (
              await call(cancelTask, {
                method: "POST",
                path: `${BASE}/tasks/${id}/cancel`,
                params: { id },
                body: { expectedVersion: 1 },
                token: user.token
              })
            ).status;
          }
          default: {
            const id = crypto.randomUUID();
            return (
              await call(createStop, {
                method: "POST",
                path: `${BASE}/leads/${id}/stop-signals`,
                params: { leadId: id },
                body: { kind: "manual" },
                token: user.token
              })
            ).status;
          }
        }
      };
      cases.push([missing, probe]);
    }

    for (const [missing, probe] of cases) {
      expect([missing, await probe()]).toEqual([missing, 403]);
    }
  });

  test("the deployment switch answers 503 after authorization", async () => {
    if (!ready) return;
    process.env.CRM_FOLLOW_UP_ENABLED = "false";

    try {
      expect((await call(listRules, { path: `${BASE}/rules` })).status).toBe(
        503
      );
      const nobody = await seedUser(env.tenantId, "nobody-off", []);
      expect(
        (await call(listRules, { path: `${BASE}/rules`, token: nobody.token }))
          .status
      ).toBe(403);
    } finally {
      process.env.CRM_FOLLOW_UP_ENABLED = "true";
    }
  });

  test("rules: create, immutable revisions, unchanged refused, archive, concurrency", async () => {
    if (!ready) return;
    const rule = await newRule();

    expect(rule.currentRevisionNumber).toBe(1);
    expect(rule.currentRevision.definition.calendar.timeZone).toBe(
      "Asia/Jakarta"
    );

    const same = await call(publishRevision, {
      method: "POST",
      path: `${BASE}/rules/${rule.id}/revisions`,
      params: { id: rule.id },
      body: { expectedVersion: rule.version, definition: DEFINITION }
    });
    expect(same.body.error?.code).toBe("REVISION_UNCHANGED");

    const published = await call(publishRevision, {
      method: "POST",
      path: `${BASE}/rules/${rule.id}/revisions`,
      params: { id: rule.id },
      body: {
        expectedVersion: rule.version,
        definition: { ...DEFINITION, dueAfterMinutes: 30 }
      }
    });
    expect(published.status).toBe(201);
    expect(published.body.data.currentRevisionNumber).toBe(2);

    const stale = await call(publishRevision, {
      method: "POST",
      path: `${BASE}/rules/${rule.id}/revisions`,
      params: { id: rule.id },
      body: {
        expectedVersion: rule.version,
        definition: { ...DEFINITION, dueAfterMinutes: 45 }
      }
    });
    expect(stale.body.error?.code).toBe("VERSION_CONFLICT");

    const detail = await call(getRule, {
      path: `${BASE}/rules/${rule.id}`,
      params: { id: rule.id }
    });
    expect(detail.body.data.revisions).toHaveLength(2);

    const archived = await call(archiveRule, {
      method: "POST",
      path: `${BASE}/rules/${rule.id}/archive`,
      params: { id: rule.id },
      body: { expectedVersion: published.body.data.version }
    });
    expect(archived.body.data.status).toBe("archived");

    const inactive = await seedUser(env.tenantId, "gone", []);
    await admin()`UPDATE awcms_tenant_users SET status = 'inactive' WHERE id = ${inactive.tenantUserId}`;
    const refused = await call(createRule, {
      method: "POST",
      path: `${BASE}/rules`,
      body: {
        code: "fixed-gone",
        name: "Fixed",
        definition: {
          ...DEFINITION,
          assignee: { mode: "fixed_user", tenantUserId: inactive.tenantUserId }
        }
      }
    });
    expect(refused.status).toBe(422);

    const audit = (await admin()`
      SELECT action FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND module_key = 'crm_follow_up'
      ORDER BY created_at, id
    `) as { action: string }[];
    expect(audit.map((row) => row.action)).toEqual([
      "crm_follow_up.rule.create",
      "crm_follow_up.rule.publish",
      "crm_follow_up.rule.archive"
    ]);
  });

  test("simulation answers without writing and needs no Idempotency-Key", async () => {
    if (!ready) return;
    const before = (await admin()`
      SELECT (SELECT count(*) FROM awcms_idempotency_keys)
           + (SELECT count(*) FROM awcms_crm_follow_up_tasks)
           + (SELECT count(*) FROM awcms_audit_events WHERE module_key = 'crm_follow_up') AS n
    `) as { n: string }[];
    const res = await call(simulateRule, {
      method: "POST",
      path: `${BASE}/rules/simulate`,
      idempotencyKey: null,
      body: {
        definition: DEFINITION,
        trigger: {
          kind: "stage_entered",
          stageCategory: "qualified",
          occurredAt: "2026-11-14T05:00:00Z"
        }
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.data.matches).toBe(true);
    // Saturday noon in Jakarta: 60 working minutes land Monday 10:00 local.
    expect(res.body.data.dueAt).toBe("2026-11-16T03:00:00.000Z");
    const after = (await admin()`
      SELECT (SELECT count(*) FROM awcms_idempotency_keys)
           + (SELECT count(*) FROM awcms_crm_follow_up_tasks)
           + (SELECT count(*) FROM awcms_audit_events WHERE module_key = 'crm_follow_up') AS n
    `) as { n: string }[];
    expect(after).toEqual(before);
  });

  test("task writes and stops need the tenant switch; a stop cancels the lead's work", async () => {
    if (!ready) return;
    await newRule();
    const lead = crypto.randomUUID();

    const off = await call(createStop, {
      method: "POST",
      path: `${BASE}/leads/${lead}/stop-signals`,
      params: { leadId: lead },
      body: { kind: "reply_received" }
    });
    expect(off.body.error?.code).toBe("CRM_FOLLOW_UP_TENANT_DISABLED");

    await enableTenant();
    const taskId = await seedTask(lead);
    const key = nextKey();
    const stop = await call(createStop, {
      method: "POST",
      path: `${BASE}/leads/${lead}/stop-signals`,
      params: { leadId: lead },
      body: { kind: "reply_received" },
      idempotencyKey: key
    });
    expect(stop.status).toBe(201);
    expect(stop.body.data.cancelledTaskIds).toEqual([taskId]);

    const replay = await call(createStop, {
      method: "POST",
      path: `${BASE}/leads/${lead}/stop-signals`,
      params: { leadId: lead },
      body: { kind: "reply_received" },
      idempotencyKey: key
    });
    expect(replay.body).toEqual(stop.body);
    const stops = await call(listStops, {
      path: `${BASE}/leads/${lead}/stop-signals`,
      params: { leadId: lead }
    });
    expect(stops.body.data.items).toHaveLength(1);

    const task = await call(getTask, {
      path: `${BASE}/tasks/${taskId}`,
      params: { id: taskId }
    });
    expect(task.body.data.task.status).toBe("cancelled");
    expect(task.body.data.task.cancelReason).toBe("stop_reply_received");
  });

  test("complete and cancel close a task; the worklist filters by assignee", async () => {
    if (!ready) return;
    await newRule();
    await enableTenant();
    const first = await seedTask(crypto.randomUUID());
    const second = await seedTask(crypto.randomUUID());

    const mine = await call(listTasks, {
      path: `${BASE}/tasks`,
      query: "assignee=me&status=open"
    });
    expect(mine.body.data.items.map((t: any) => t.id).sort()).toEqual(
      [first, second].sort()
    );

    const done = await call(completeTask, {
      method: "POST",
      path: `${BASE}/tasks/${first}/complete`,
      params: { id: first },
      body: { expectedVersion: 1, outcome: "reached" }
    });
    expect(done.status).toBe(200);
    expect(done.body.data.outcome).toBe("reached");

    const again = await call(completeTask, {
      method: "POST",
      path: `${BASE}/tasks/${first}/complete`,
      params: { id: first },
      body: { expectedVersion: 2, outcome: "reached" }
    });
    expect(again.body.error?.code).toBe("TASK_CLOSED");

    const cancelled = await call(cancelTask, {
      method: "POST",
      path: `${BASE}/tasks/${second}/cancel`,
      params: { id: second },
      body: { expectedVersion: 1 }
    });
    expect(cancelled.body.data.cancelReason).toBe("manual_cancel");

    const stillOpen = await call(listTasks, {
      path: `${BASE}/tasks`,
      query: "status=open"
    });
    expect(stillOpen.body.data.items).toHaveLength(0);
  });
});
