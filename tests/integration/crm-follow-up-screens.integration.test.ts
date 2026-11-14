/**
 * The `/admin/crm-follow-up` screens' loaders against a real PostgreSQL with
 * real sessions (Issue #1165, ADR-0159, ADR-0149).
 *
 * The loaders are run through the REAL `loadAdminScreen` chokepoint, the way the
 * pages run them, so the properties pinned here are the ones a source-text match
 * cannot see:
 *
 * - tenant isolation: a viewer of tenant A never gets tenant B's task, rule or
 *   revision, and a foreign id is the SAME "not found" as an unknown id;
 * - the daily worklist is the SIGNED-IN viewer's own tasks (`assignee=me` is
 *   resolved from the session, never from the URL);
 * - the default view is the live work and the closed history is opt-in; the
 *   merged open+escalated list is due-ordered;
 * - default-deny: a viewer with no permission gets "denied", before the
 *   deployment switch is even read (no oracle); the controls follow the
 *   permission the endpoint behind each one enforces;
 * - the deployment switch off: every loader answers `enabled: false`, never an
 *   error; the tenant switch is reported so the screen can say why writes fail;
 * - the actions the screen drives, through the real routes with the version the
 *   loader returned: one winner on a stale version, a closed task stays closed.
 *
 * There is NO business-scope dimension to confine on: a task holds only an
 * opaque lead id (ADR-0159, no lead copy), exactly as `GET /tasks` lists the
 * tenant's queue.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
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
import { loadAdminScreen } from "../../src/lib/auth/admin-screen";
import type { SsrContext } from "../../src/lib/auth/ssr-session";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import {
  createRule,
  publishRevision
} from "../../src/modules/crm-follow-up/application/rule-directory";
import {
  loadRules,
  loadTaskDetail,
  loadWorklist,
  type FollowUpCan,
  type FollowUpGuard
} from "../../src/modules/crm-follow-up/application/screen-loaders";
import { createTasksForTrigger } from "../../src/modules/crm-follow-up/application/task-engine";
import type { RuleDefinition } from "../../src/modules/crm-follow-up/domain/rule-definition";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as completeRoute } from "../../src/pages/api/v1/crm-follow-up/tasks/[id]/complete";
import { POST as stopRoute } from "../../src/pages/api/v1/crm-follow-up/leads/[leadId]/stop-signals";
import { crmFollowUpModule } from "../../src/modules/crm-follow-up/module";

setDefaultTimeout(60_000);

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const READ_TASKS = "crm_follow_up.tasks.read";
const UPDATE_TASKS = "crm_follow_up.tasks.update";
const READ_RULES = "crm_follow_up.rules.read";
const CONFIGURE_RULES = "crm_follow_up.rules.configure";
const CREATE_STOP = "crm_follow_up.stop_signals.create";

const G = (
  activityCode: string,
  action: FollowUpGuard["action"]
): FollowUpGuard => ({
  moduleKey: "crm_follow_up",
  activityCode,
  action
});
const SCREEN = {
  readTasks: G("tasks", "read"),
  updateTasks: G("tasks", "update"),
  readRules: G("rules", "read"),
  configureRules: G("rules", "configure"),
  createStop: G("stop_signals", "create")
};

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};

let tenantId = "";
let tenantB = "";
let ownerTenantUserId = "";
let counter = 0;
let savedEnabled: string | undefined;
const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "follow-screen-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Follow Screens Co",
      tenantCode: "follow-screens",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);
  tenantId = setup.body.data.tenantId;

  const login = await invoke(authLogin, {
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

  const owner = (await admin()`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  ownerTenantUserId = owner[0]!.id;
}

async function seedUser(
  tenant: string,
  label: string,
  permissionKeys: readonly string[]
): Promise<{ token: string; tenantUserId: string }> {
  counter += 1;
  const sql = admin();
  const tag = `${label}-${counter}`;
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenant}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenant}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenant}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `fs-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at)
    VALUES (${tenant}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenant}, ${`role-${tag}`}, ${`Role ${tag}`}) RETURNING id
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
        VALUES (${tenant}, ${role[0]!.id}, ${permission[0].id})
      `;
    }

    await withTenantOrThrow(getHandlerDatabaseClient(), tenant, (tx) =>
      grantRolePolicy(tx, tenant, {
        tenantUserId: tenantUser[0]!.id,
        roleId: role[0]!.id,
        grantedByTenantUserId: null,
        reason: "follow-up screens fixture"
      })
    );
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

const ALWAYS = {
  timeZone: "UTC",
  workingDays: [1, 2, 3, 4, 5, 6, 7],
  workStartMinute: 0,
  workEndMinute: 1440,
  holidays: [] as string[]
};

function definition(over: Partial<RuleDefinition> = {}): RuleDefinition {
  return {
    trigger: {
      kind: "lead_created",
      pipelineId: null,
      stageCategory: null,
      stageKey: null
    },
    taskTitle: "Call the new lead",
    // The longest due offset: the task is not overdue for a month.
    dueAfterMinutes: 43200,
    escalation: null,
    assignee: { mode: "lead_owner", tenantUserId: null },
    notify: { onAssign: true, onDue: false },
    maxOpenPerLead: 5,
    calendar: ALWAYS,
    ...over
  };
}

const inTenant = <T>(
  tenant: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(getHandlerDatabaseClient(), tenant, fn);

async function newRule(
  tenant: string,
  actor: string,
  code: string,
  def: RuleDefinition = definition()
): Promise<string> {
  const result = await inTenant(tenant, (tx) =>
    createRule(tx, tenant, actor, {
      code,
      name: `Rule ${code}`,
      definition: def
    })
  );

  expect(result.outcome).toBe("created");

  return result.outcome === "created" ? result.rule.id : "";
}

/** A task created as the consumer would; `occurredAt` in the past makes it overdue. */
async function newTask(
  tenant: string,
  owner: string,
  kind: "lead_created" | "stage_entered",
  occurredAt = new Date()
): Promise<{ taskId: string; leadId: string }> {
  const leadId = crypto.randomUUID();
  const outcome = await inTenant(tenant, (tx) =>
    createTasksForTrigger(
      tx,
      tenant,
      {
        kind,
        leadId,
        pipelineId: null,
        stageCategory: null,
        stageKey: null,
        ownerTenantUserId: owner,
        occurredAt
      },
      crypto.randomUUID(),
      occurredAt
    )
  );

  expect(outcome.created).toHaveLength(1);

  return { taskId: outcome.created[0]!, leadId };
}

async function enableTenantSwitch(tenant: string): Promise<void> {
  await admin()`
    INSERT INTO awcms_crm_follow_up_settings (tenant_id, enabled)
    VALUES (${tenant}, true)
    ON CONFLICT (tenant_id) DO UPDATE SET enabled = true
  `;
}

/**
 * Runs one of the SCREENS' loaders the way the pages do: the real
 * `loadAdminScreen` chokepoint, one transaction, the viewer's real session.
 */
async function screen<T>(
  token: string,
  entry: FollowUpGuard,
  run: (input: {
    context: Parameters<typeof loadWorklist>[0]["context"];
    can: FollowUpCan;
  }) => Promise<T>,
  tenant = tenantId
): Promise<T | "denied" | "error"> {
  const tokenHash = hashSessionToken(token);
  const outcome = await loadAdminScreen({
    ssr: { tenantId: tenant, tokenHash } as unknown as SsrContext,
    sql: getHandlerDatabaseClient(),
    workClass: "interactive",
    authorize: entry,
    load: ({ tx, auth, can }) =>
      run({
        context: { tx, tenantId: tenant, auth, now: new Date() },
        can
      }),
    onError: () => {}
  });

  return outcome.state === "allowed" ? outcome.data : outcome.state;
}

const worklist = (
  token: string,
  filters: Parameters<typeof loadWorklist>[0]["filters"] = {},
  tenant = tenantId
) =>
  screen(
    token,
    SCREEN.readTasks,
    ({ context, can }) =>
      loadWorklist({
        context,
        filters,
        rulesReadGuard: SCREEN.readRules,
        can
      }),
    tenant
  );

const detailOf = (token: string, taskId: string | null, tenant = tenantId) =>
  screen(
    token,
    SCREEN.readTasks,
    ({ context, can }) =>
      loadTaskDetail({
        context,
        taskId,
        updateGuard: SCREEN.updateTasks,
        stopGuard: SCREEN.createStop,
        can
      }),
    tenant
  );

const rulesOf = (
  token: string,
  selectedRuleId: string | null = null,
  tenant = tenantId
) =>
  screen(
    token,
    SCREEN.readRules,
    ({ context, can }) =>
      loadRules({
        context,
        selectedRuleId,
        configureGuard: SCREEN.configureRules,
        can
      }),
    tenant
  );

const titles = (data: unknown) =>
  (data as { tasks: { id: string }[] }).tasks.map((task) => task.id);

function headers(token: string, extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": tenantId,
    authorization: `Bearer ${token}`,
    ...extra
  };
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("crm_follow_up screens (#1165, ADR-0159)", () => {
  beforeAll(async () => {
    savedEnabled = process.env.CRM_FOLLOW_UP_ENABLED;
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    if (savedEnabled === undefined) delete process.env.CRM_FOLLOW_UP_ENABLED;
    else process.env.CRM_FOLLOW_UP_ENABLED = savedEnabled;

    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    expect(handlerReady, "the handler database must be available").toBe(true);
    process.env.CRM_FOLLOW_UP_ENABLED = "true";
    await resetHandlerDatabase();
    await bootstrap();
    tenantB = crypto.randomUUID();
    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${tenantB}, 'follow-screens-b', 'Follow Screens B')
    `;
  });

  test("the worklist is the viewer's tenant only, the viewer's own tasks for 'me', and live work by default", async () => {
    await enableTenantSwitch(tenantId);
    const me = await seedUser(tenantId, "me", [READ_TASKS, READ_RULES]);
    const colleague = await seedUser(tenantId, "colleague", [READ_TASKS]);
    const staffB = await seedUser(tenantB, "staff-b", []);

    await newRule(tenantId, ownerTenantUserId, "future");
    await newRule(
      tenantId,
      ownerTenantUserId,
      "late",
      definition({
        trigger: {
          kind: "stage_entered",
          pipelineId: null,
          stageCategory: null,
          stageKey: null
        },
        dueAfterMinutes: 0,
        taskTitle: "Late call"
      })
    );
    await newRule(tenantB, staffB.tenantUserId, "future-b");

    const mine = await newTask(tenantId, me.tenantUserId, "lead_created");
    const theirs = await newTask(
      tenantId,
      colleague.tenantUserId,
      "lead_created"
    );
    const lateMine = await newTask(
      tenantId,
      me.tenantUserId,
      "stage_entered",
      new Date(Date.now() - 21 * 86_400_000)
    );
    const foreign = await newTask(tenantB, staffB.tenantUserId, "lead_created");
    const closed = await newTask(tenantId, me.tenantUserId, "lead_created");

    await admin()`
      UPDATE awcms_crm_follow_up_tasks
      SET status = 'cancelled', cancel_reason = 'manual_cancel',
          closed_at = now(), closed_by = ${me.tenantUserId}, version = version + 1
      WHERE id = ${closed.taskId}
    `;

    // The whole tenant, live work only, due-ordered (the late one first), and
    // never tenant B's task nor the closed one.
    const all = await worklist(me.token);

    expect(all).not.toBe("denied");
    expect(titles(all)).toEqual([lateMine.taskId, mine.taskId, theirs.taskId]);
    expect(titles(all)).not.toContain(foreign.taskId);
    expect(titles(all)).not.toContain(closed.taskId);
    expect(all).toMatchObject({
      enabled: true,
      more: false,
      tenantEnabled: true,
      canSeeRules: true
    });

    // The daily worklist: "me" is the SESSION's person.
    expect(titles(await worklist(me.token, { assignee: "me" }))).toEqual([
      lateMine.taskId,
      mine.taskId
    ]);
    expect(titles(await worklist(colleague.token, { assignee: "me" }))).toEqual(
      [theirs.taskId]
    );

    // The overdue queue.
    expect(titles(await worklist(me.token, { overdue: "true" }))).toEqual([
      lateMine.taskId
    ]);
    expect(
      (await worklist(me.token, { overdue: "true" })) as {
        tasks: { overdue: boolean }[];
      }
    ).toMatchObject({ tasks: [{ overdue: true }] });

    // The closed history is opt-in, and a status is one status.
    expect(titles(await worklist(me.token, { status: "all" }))).toContain(
      closed.taskId
    );
    expect(titles(await worklist(me.token, { status: "cancelled" }))).toEqual([
      closed.taskId
    ]);
    expect(titles(await worklist(me.token, { status: "completed" }))).toEqual(
      []
    );

    // An unknown filter value never widens to someone else's tasks or history.
    expect(
      titles(await worklist(me.token, { status: "garbage", assignee: "x" }))
    ).toEqual([lateMine.taskId, mine.taskId, theirs.taskId]);

    // Tenant B's viewer sees B's task only, and nothing of tenant A.
    expect(await worklist(staffB.token, {}, tenantB)).toBe("denied");
    const readerB = await seedUser(tenantB, "reader-b", [READ_TASKS]);

    expect(titles(await worklist(readerB.token, {}, tenantB))).toEqual([
      foreign.taskId
    ]);
  });

  test("open and escalated work is merged in due order", async () => {
    await enableTenantSwitch(tenantId);
    const me = await seedUser(tenantId, "me", [READ_TASKS]);

    await newRule(tenantId, ownerTenantUserId, "future");

    const first = await newTask(tenantId, me.tenantUserId, "lead_created");
    const second = await newTask(tenantId, me.tenantUserId, "lead_created");
    const third = await newTask(tenantId, me.tenantUserId, "lead_created");

    await admin()`
      UPDATE awcms_crm_follow_up_tasks
      SET status = 'escalated', escalated_at = now(), version = version + 1
      WHERE id = ${second.taskId}
    `;

    const merged = await worklist(me.token);

    expect(titles(merged)).toEqual([first.taskId, second.taskId, third.taskId]);
    expect(
      (merged as { tasks: { status: string }[] }).tasks.map((t) => t.status)
    ).toEqual(["open", "escalated", "open"]);
    expect(titles(await worklist(me.token, { status: "escalated" }))).toEqual([
      second.taskId
    ]);
  });

  test("a viewer with no permission is denied, before the deployment switch is read", async () => {
    const nobody = await seedUser(tenantId, "nobody", []);
    const rulesOnly = await seedUser(tenantId, "rules-only", [READ_RULES]);

    expect(await worklist(nobody.token)).toBe("denied");
    // A rules-only viewer may not read the task queue ...
    expect(await worklist(rulesOnly.token)).toBe("denied");
    expect(await detailOf(rulesOnly.token, crypto.randomUUID())).toBe("denied");
    // ... and a tasks-only viewer may not read the rules.
    const tasksOnly = await seedUser(tenantId, "tasks-only", [READ_TASKS]);

    expect(await rulesOf(tasksOnly.token)).toBe("denied");

    // With the deployment switch OFF, an unauthorised caller still learns
    // nothing about it: the answer is the same "denied".
    delete process.env.CRM_FOLLOW_UP_ENABLED;
    expect(await worklist(nobody.token)).toBe("denied");
    expect(await rulesOf(nobody.token)).toBe("denied");
  });

  test("with the deployment switch off every loader says so, not an error", async () => {
    const viewer = await seedUser(tenantId, "viewer", [READ_TASKS, READ_RULES]);

    delete process.env.CRM_FOLLOW_UP_ENABLED;

    expect(await worklist(viewer.token)).toMatchObject({
      enabled: false,
      tasks: []
    });
    expect(await detailOf(viewer.token, crypto.randomUUID())).toEqual({
      enabled: false
    });
    expect(await rulesOf(viewer.token)).toMatchObject({
      enabled: false,
      rules: []
    });
  });

  test("a task's detail carries its history and notices; a foreign or unknown id is one answer", async () => {
    await enableTenantSwitch(tenantId);
    const staffB = await seedUser(tenantB, "staff-b", []);
    const reader = await seedUser(tenantId, "reader", [READ_TASKS]);
    const manager = await seedUser(tenantId, "manager", [
      READ_TASKS,
      UPDATE_TASKS,
      CREATE_STOP
    ]);

    await newRule(tenantId, ownerTenantUserId, "future");
    await newRule(tenantB, staffB.tenantUserId, "future-b");

    const task = await newTask(tenantId, manager.tenantUserId, "lead_created");
    const foreign = await newTask(tenantB, staffB.tenantUserId, "lead_created");
    const detail = await detailOf(manager.token, task.taskId);

    expect(detail).toMatchObject({
      enabled: true,
      found: true,
      tenantEnabled: true,
      canUpdate: true,
      canStop: true,
      me: manager.tenantUserId
    });

    const found = detail as {
      task: { id: string; status: string; version: number };
      actions: { action: string; toStatus: string }[];
      notifications: { kind: string; status: string }[];
      stopSignals: unknown[];
    };

    expect(found.task.id).toBe(task.taskId);
    expect(found.actions.map((entry) => entry.action)).toEqual(["created"]);
    expect(found.notifications.map((entry) => entry.kind)).toEqual([
      "assigned"
    ]);
    expect(found.stopSignals).toEqual([]);

    // A read-only holder gets no write control; the manager does.
    expect(await detailOf(reader.token, task.taskId)).toMatchObject({
      found: true,
      canUpdate: false,
      canStop: false
    });

    // Tenant B's task, a random id and no id at all are the SAME answer.
    const notFound = { enabled: true, found: false } as const;

    expect(await detailOf(manager.token, foreign.taskId)).toEqual(notFound);
    expect(await detailOf(manager.token, crypto.randomUUID())).toEqual(
      notFound
    );
    expect(await detailOf(manager.token, null)).toEqual(notFound);
  });

  test("the tenant switch is reported, so the screen can say why a write is refused", async () => {
    const manager = await seedUser(tenantId, "manager", [
      READ_TASKS,
      UPDATE_TASKS
    ]);

    await newRule(tenantId, ownerTenantUserId, "future");
    // Created while the tenant switch is still off is impossible for the
    // consumer; the fixture creates it directly, as the engine tests do.
    const task = await newTask(tenantId, manager.tenantUserId, "lead_created");

    expect(await worklist(manager.token)).toMatchObject({
      tenantEnabled: false
    });
    expect(await detailOf(manager.token, task.taskId)).toMatchObject({
      tenantEnabled: false,
      canUpdate: true
    });

    await enableTenantSwitch(tenantId);

    expect(await worklist(manager.token)).toMatchObject({
      tenantEnabled: true
    });
  });

  test("rules: the catalogue, the revision history, tenant isolation and the configure control", async () => {
    await enableTenantSwitch(tenantId);
    const staffB = await seedUser(tenantB, "staff-b", []);
    const reader = await seedUser(tenantId, "reader", [READ_RULES]);
    const admin1 = await seedUser(tenantId, "admin", [
      READ_RULES,
      CONFIGURE_RULES
    ]);
    const ruleId = await newRule(tenantId, ownerTenantUserId, "alpha");
    const ruleB = await newRule(tenantB, staffB.tenantUserId, "beta");

    const published = await inTenant(tenantId, (tx) =>
      publishRevision(tx, tenantId, ownerTenantUserId, ruleId, {
        expectedVersion: 1,
        definition: definition({ taskTitle: "Call again" })
      })
    );

    expect(published.outcome).toBe("published");

    const catalogue = await rulesOf(reader.token, ruleId);

    expect(catalogue).toMatchObject({
      enabled: true,
      canConfigure: false,
      selectedNotFound: false,
      settings: { enabled: true }
    });

    const data = catalogue as {
      rules: { code: string; currentRevisionNumber: number }[];
      selected: {
        rule: { id: string; currentRevisionNumber: number };
        revisions: { revisionNumber: number }[];
      };
    };

    expect(data.rules.map((rule) => rule.code)).toEqual(["alpha"]);
    expect(data.selected.rule.id).toBe(ruleId);
    expect(data.selected.rule.currentRevisionNumber).toBe(2);
    expect(data.selected.revisions.map((r) => r.revisionNumber).sort()).toEqual(
      [1, 2]
    );

    // Tenant B's rule is "not found", the same as an unknown id.
    for (const id of [ruleB, crypto.randomUUID()]) {
      const other = await rulesOf(reader.token, id);

      expect(other).toMatchObject({ selected: null, selectedNotFound: true });
    }

    // The configure control follows the endpoint's permission.
    expect(await rulesOf(admin1.token)).toMatchObject({ canConfigure: true });
  });

  test("the actions the screen drives: a stale version loses, a closed task stays closed, a stop cancels the lead's work", async () => {
    await enableTenantSwitch(tenantId);
    const manager = await seedUser(tenantId, "manager", [
      READ_TASKS,
      UPDATE_TASKS,
      CREATE_STOP
    ]);

    await newRule(tenantId, ownerTenantUserId, "future");

    const task = await newTask(tenantId, manager.tenantUserId, "lead_created");
    const loaded = (await detailOf(manager.token, task.taskId)) as {
      task: { version: number };
    };
    const send = (key: string, body: unknown) =>
      invoke<Envelope>(completeRoute, {
        method: "POST",
        path: `/api/v1/crm-follow-up/tasks/${task.taskId}/complete`,
        headers: headers(manager.token, { "idempotency-key": key }),
        params: { id: task.taskId },
        body
      });

    // The version the loader returned is the one the endpoint accepts ...
    const stale = await send(crypto.randomUUID(), {
      outcome: "reached",
      expectedVersion: loaded.task.version + 1
    });

    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("VERSION_CONFLICT");

    const key = crypto.randomUUID();
    const done = await send(key, {
      outcome: "reached",
      expectedVersion: loaded.task.version
    });

    expect(done.status).toBe(200);

    // ... a retry with the same key replays, a new key meets a closed task.
    expect(
      (
        await send(key, {
          outcome: "reached",
          expectedVersion: loaded.task.version
        })
      ).status
    ).toBe(200);
    const reloaded = (await detailOf(manager.token, task.taskId)) as {
      task: { version: number };
    };

    expect(
      (
        await send(crypto.randomUUID(), {
          outcome: "reached",
          expectedVersion: reloaded.task.version
        })
      ).body.error?.code
    ).toBe("TASK_CLOSED");

    // The screen now shows it closed, with its outcome, off the live view.
    expect(titles(await worklist(manager.token))).not.toContain(task.taskId);
    expect(
      (await detailOf(manager.token, task.taskId)) as {
        task: { status: string; outcome: string };
        actions: { action: string }[];
      }
    ).toMatchObject({
      task: { status: "completed", outcome: "reached" },
      actions: [{ action: "created" }, { action: "completed" }]
    });

    // A stop for another lead cancels that lead's live task, and the screen
    // lists the signal on the detail.
    const other = await newTask(tenantId, manager.tenantUserId, "lead_created");
    const stop = await invoke<Envelope>(stopRoute, {
      method: "POST",
      path: `/api/v1/crm-follow-up/leads/${other.leadId}/stop-signals`,
      headers: headers(manager.token, {
        "idempotency-key": crypto.randomUUID()
      }),
      params: { leadId: other.leadId },
      body: { kind: "manual" }
    });

    // The lead does not exist in crm_leads here, so the endpoint refuses with
    // its uniform 404 and nothing is cancelled: the screen must not claim a
    // stop it did not record.
    expect(stop.status).toBe(404);
    expect(titles(await worklist(manager.token))).toContain(other.taskId);
    expect(
      (await detailOf(manager.token, other.taskId)) as {
        stopSignals: unknown[];
      }
    ).toMatchObject({ stopSignals: [] });
  });

  test("the module declares exactly the five permissions the screens use", () => {
    expect(
      (crmFollowUpModule.permissions ?? [])
        .map((p) => `crm_follow_up.${p.activityCode}.${p.action}`)
        .sort()
    ).toEqual(
      [
        READ_TASKS,
        UPDATE_TASKS,
        READ_RULES,
        CONFIGURE_RULES,
        CREATE_STOP
      ].sort()
    );
  });
});
