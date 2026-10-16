/**
 * The attendance and correction HTTP surface, driven through the REAL route
 * handlers against a real PostgreSQL (Issue #947, ADR-0132) — WORLD-2 of the
 * harness.
 *
 * Proves what the unit and database tests cannot: every new permission BITES;
 * default-deny; an employee clocks for THEMSELVES only (S3) and reads their own
 * events (S1); a supervisor reads their reports through the manager chain (S6)
 * and a deleted manager breaks it; the skew, back-dating and replay rules through
 * the handler; the whole correction flow through the REAL workflow engine
 * (request -> approve in `workflow_approval` -> settle -> a NEW superseding
 * event, the original untouched); who sees the sensitive reason; the requester
 * can never approve (S5), directly, through a delegate, or with a workflow that
 * finished without a human; concurrent settles append once; replay is idempotent;
 * no audit row, event or workflow record carries the reason.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
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
import { hrWorkforceModule } from "../../src/modules/hr-workforce/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as createEmployment } from "../../src/pages/api/v1/hr-workforce/employments/index";
import { PUT as assignAccount } from "../../src/pages/api/v1/hr-workforce/employments/[id]/account";
import { POST as changeTerms } from "../../src/pages/api/v1/hr-workforce/employments/[id]/terms";
import { DELETE as deleteEmployment } from "../../src/pages/api/v1/hr-workforce/employments/[id]";
import {
  GET as listEvents,
  POST as recordEvent
} from "../../src/pages/api/v1/hr-workforce/attendance-events/index";
import {
  GET as listCorrections,
  POST as createCorrection
} from "../../src/pages/api/v1/hr-workforce/attendance-corrections/index";
import { GET as getCorrection } from "../../src/pages/api/v1/hr-workforce/attendance-corrections/[id]";
import { POST as withdrawCorrection } from "../../src/pages/api/v1/hr-workforce/attendance-corrections/[id]/withdraw";
import { POST as settleCorrection } from "../../src/pages/api/v1/hr-workforce/attendance-corrections/[id]/settle";
import { PUT as putSettings } from "../../src/pages/api/v1/hr-workforce/settings";
import { POST as decideTask } from "../../src/pages/api/v1/workflows/tasks/[id]/decisions";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
// A sentinel that must never appear anywhere but the correction's own row.
const REASON = "SENTINEL-reason-xk7q9 my child was ill";

type Env = { tenantId: string; token: string; ownerTenantUserId: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

type Event = {
  id: string;
  employmentId: string;
  kind: string;
  occurredAt: string;
  recordedAt: string;
  source: string;
  clientEventKey: string;
  supersedesEventId: string | null;
  supersededByEventId: string | null;
  correctionId: string | null;
  late: boolean;
};

type Correction = {
  id: string;
  employmentId: string;
  kind: string;
  targetEventId: string | null;
  status: string;
  workflowInstanceId: string;
  requestedBy: string;
  decidedBy: string | null;
  appliedEventId: string | null;
  reason?: string;
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;
let numberCounter = 0;

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "att-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Attendance Co",
      tenantCode: "att-co",
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

  const owner = (await admin()`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  return {
    tenantId,
    token: login.body.data.token,
    ownerTenantUserId: owner[0]!.id
  };
}

async function seedProfile(tenantId: string, tag: string): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${`Person ${tag}`})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[],
  existingProfileId?: string
): Promise<{
  token: string;
  tenantUserId: string;
  profileId: string;
  identityId: string;
}> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = existingProfileId
    ? [{ id: existingProfileId }]
    : ((await sql`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        VALUES (${tenantId}, 'person', ${`User ${tag}`})
        RETURNING id
      `) as { id: string }[]);
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  const token = `att-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours')
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`role-${tag}`}, ${`Role ${tag}`})
      RETURNING id
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
        reason: "partial-permission fixture"
      })
    );
  }

  return {
    token,
    tenantUserId: tenantUser[0]!.id,
    profileId: profile[0]!.id,
    identityId: identity[0]!.id
  };
}

const ALL_HR_PERMISSIONS = (hrWorkforceModule.permissions ?? []).map(
  (permission) => `hr_workforce.${permission.activityCode}.${permission.action}`
);
const WORKFLOW_DECIDE = "workflow.approval.approve";

function call<T = unknown>(
  handler: Parameters<typeof invoke>[0],
  options: {
    method?: string;
    path: string;
    body?: unknown;
    params?: Record<string, string>;
    token?: string | null;
    idempotencyKey?: string | null;
    query?: string;
    tenantId?: string;
  }
) {
  const token = options.token === undefined ? env.token : options.token;
  const mutating = (options.method ?? "GET") !== "GET";
  const key =
    options.idempotencyKey === undefined && mutating
      ? nextKey()
      : options.idempotencyKey;
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": options.tenantId ?? env.tenantId
  };

  if (token) requestHeaders.authorization = `Bearer ${token}`;
  if (key) requestHeaders["idempotency-key"] = key;

  return invoke<Envelope<T>>(handler, {
    method: options.method,
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers: requestHeaders,
    body: options.body,
    params: options.params,
    locals: { correlationId: "corr-api-947" }
  });
}

async function count(table: string): Promise<number> {
  const rows = (await admin()`
    SELECT count(*)::int AS n FROM ${admin().unsafe(table)}
    WHERE tenant_id = ${env.tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

/** An employment (no login yet). */
async function hire(
  tag: string,
  managerId?: string,
  existingProfileId?: string
): Promise<string> {
  const profileId = existingProfileId ?? (await seedProfile(env.tenantId, tag));
  numberCounter += 1;
  const response = await call<{ id: string }>(createEmployment, {
    method: "POST",
    path: "/api/v1/hr-workforce/employments",
    body: {
      profileId,
      employeeNo: `A-${numberCounter}`,
      hiredOn: "2026-01-05",
      employmentType: "permanent",
      status: "active",
      jobTitle: "Barista",
      ...(managerId ? { managerEmploymentId: managerId } : {})
    }
  });
  expect(response.status).toBe(201);

  return response.body.data!.id;
}

async function link(employmentId: string, tenantUserId: string) {
  const response = await call(assignAccount, {
    method: "PUT",
    path: `/api/v1/hr-workforce/employments/${employmentId}/account`,
    params: { id: employmentId },
    body: { tenantUserId }
  });
  expect(response.status).toBe(200);
}

/** A login linked to a fresh employment: an employee. */
async function employee(
  label: string,
  permissions: readonly string[],
  managerId?: string
) {
  const user = await seedUser(env.tenantId, label, permissions);
  // The employment is the PERSON of the login (#979: the link must match).
  const employmentId = await hire(label, managerId, user.profileId);

  await link(employmentId, user.tenantUserId);

  return { ...user, employmentId };
}

function iso(offsetSeconds: number): string {
  return new Date(Date.now() + offsetSeconds * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

function clock(
  employmentId: string,
  extra: Record<string, unknown> = {},
  token?: string,
  key?: string | null
) {
  numberCounter += 1;

  return call<Event>(recordEvent, {
    method: "POST",
    path: "/api/v1/hr-workforce/attendance-events",
    body: {
      employmentId,
      kind: "clock_in",
      occurredAt: iso(0),
      source: "self",
      clientEventKey: `ck-${numberCounter}-${crypto.randomUUID()}`,
      ...extra
    },
    token,
    idempotencyKey: key
  });
}

function events(query: string, token?: string) {
  return call<{ events: Event[]; nextCursor: string | null }>(listEvents, {
    path: "/api/v1/hr-workforce/attendance-events",
    query,
    token
  });
}

function requestCorrection(
  body: Record<string, unknown>,
  token?: string,
  key?: string | null
) {
  return call<Correction>(createCorrection, {
    method: "POST",
    path: "/api/v1/hr-workforce/attendance-corrections",
    body: {
      kind: "add",
      proposedKind: "clock_out",
      proposedOccurredAt: iso(-3600),
      reason: REASON,
      ...body
    },
    token,
    idempotencyKey: key
  });
}

function readCorrection(id: string, token?: string) {
  return call<Correction>(getCorrection, {
    path: `/api/v1/hr-workforce/attendance-corrections/${id}`,
    params: { id },
    token
  });
}

function settle(id: string, token?: string, key?: string | null) {
  return call<Correction>(settleCorrection, {
    method: "POST",
    path: `/api/v1/hr-workforce/attendance-corrections/${id}/settle`,
    params: { id },
    token,
    idempotencyKey: key
  });
}

function withdraw(id: string, token?: string) {
  return call<Correction>(withdrawCorrection, {
    method: "POST",
    path: `/api/v1/hr-workforce/attendance-corrections/${id}/withdraw`,
    params: { id },
    token
  });
}

/** Publishes the tenant's correction workflow: one approval node, the given approvers. */
async function publishWorkflow(approvers: string[]) {
  await admin()`
    INSERT INTO awcms_workflow_definitions
      (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
    VALUES (${env.tenantId}, 'hr.attendance_correction', 'Attendance correction',
            1, 'active',
            ${{
              startNodeId: "approval",
              nodes: [
                {
                  id: "approval",
                  type: "approval",
                  name: "Approval",
                  assigneeTenantUserIds: approvers,
                  quorumRule: "any",
                  onApprove: "end_approved",
                  onReject: "end_rejected"
                },
                { id: "end_approved", type: "end", outcome: "approved" },
                { id: "end_rejected", type: "end", outcome: "rejected" }
              ]
            }}::jsonb,
            '[]'::jsonb)
  `;
}

async function taskOf(instanceId: string): Promise<string> {
  const rows = (await admin()`
    SELECT id FROM awcms_workflow_tasks
    WHERE tenant_id = ${env.tenantId} AND workflow_instance_id = ${instanceId}
    ORDER BY created_at LIMIT 1
  `) as { id: string }[];

  return rows[0]!.id;
}

/**
 * Simulates a delegate's decision by rewriting the recorded decision. The
 * decision log is append-only (`sql/252`, #999) -- no role can UPDATE it -- so
 * this fixture steps outside the guard the way a superuser maintenance session
 * would (`session_replication_role = replica`), for this one statement only.
 */
async function forgeDecisionOnBehalfOf(
  taskId: string,
  onBehalfOf: string
): Promise<void> {
  await admin().begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");
    await tx`
      UPDATE awcms_workflow_decisions
      SET on_behalf_of_tenant_user_id = ${onBehalfOf}
      WHERE workflow_task_id = ${taskId}`;
  });
}

/** The approver decides in the REAL workflow engine. */
async function decide(
  instanceId: string,
  token: string,
  decision: "approve" | "reject" = "approve"
) {
  const taskId = await taskOf(instanceId);

  return call(decideTask, {
    method: "POST",
    path: `/api/v1/workflows/tasks/${taskId}/decisions`,
    params: { id: taskId },
    body: { decision },
    token
  });
}

async function eventRow(id: string) {
  const rows = (await admin()`
    SELECT * FROM awcms_hr_attendance_events WHERE id = ${id}
  `) as Record<string, unknown>[];

  return rows[0]!;
}

/**
 * A pending correction written straight to the tables (the guard triggers still
 * run), for cases that need a particular requester or a ready verdict.
 */
async function seedCorrection(
  employmentId: string,
  requestedBy: string,
  options: { status?: "pending" | "approved"; approver?: string } = {}
): Promise<{ id: string; instanceId: string }> {
  const id = crypto.randomUUID();
  const definition = (await admin()`
    SELECT id FROM awcms_workflow_definitions
    WHERE tenant_id = ${env.tenantId} AND lifecycle_status = 'active' LIMIT 1
  `) as { id: string }[];
  const instance = (await admin()`
    INSERT INTO awcms_workflow_instances
      (tenant_id, workflow_definition_id, resource_type, resource_id, status,
       requested_by_tenant_user_id)
    VALUES (${env.tenantId}, ${definition[0]!.id}, 'hr_attendance_correction',
            ${id}, 'pending', ${requestedBy})
    RETURNING id
  `) as { id: string }[];

  await admin()`
    INSERT INTO awcms_hr_attendance_corrections
      (id, tenant_id, employment_id, kind, proposed_kind, proposed_occurred_at,
       reason, workflow_instance_id, requested_by)
    VALUES (${id}, ${env.tenantId}, ${employmentId}, 'add', 'clock_out',
            now() - interval '1 hour', ${REASON}, ${instance[0]!.id}, ${requestedBy})
  `;

  if (options.status === "approved") {
    // A verdict with no engine behind it: HR's own guard is what is under test,
    // so step outside the workflow bindings (sql/252, sql/301) the way a
    // superuser maintenance session does.
    await admin().begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica");
      const task = (await tx`
        INSERT INTO awcms_workflow_tasks (tenant_id, workflow_instance_id, node_id)
        VALUES (${env.tenantId}, ${instance[0]!.id}, 'approval') RETURNING id
      `) as { id: string }[];

      await tx`
        INSERT INTO awcms_workflow_decisions
          (tenant_id, workflow_task_id, decision, decided_by_tenant_user_id)
        VALUES (${env.tenantId}, ${task[0]!.id}, 'approve', ${options.approver!})
      `;
      await tx`
        UPDATE awcms_workflow_instances SET status = 'approved' WHERE id = ${instance[0]!.id}
      `;
    });
  }

  return { id, instanceId: instance[0]!.id };
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("hr_workforce attendance HTTP surface (Issue #947)", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    env = await bootstrap();
  });

  test("default-deny: no token is 401; a user with no role is 403 on every route and writes nothing", async () => {
    if (!handlerReady) return;
    const noRole = await seedUser(env.tenantId, "norole", []);
    const target = await employee("deny", []);
    await publishWorkflow([env.ownerTenantUserId]);
    const correction = (
      await requestCorrection({ employmentId: target.employmentId })
    ).body.data!;
    const beforeEvents = await count("awcms_hr_attendance_events");
    const beforeCorrections = await count("awcms_hr_attendance_corrections");

    expect(
      (
        await call(listEvents, {
          path: "/api/v1/hr-workforce/attendance-events",
          token: null
        })
      ).status
    ).toBe(401);

    const attempts = [
      events("", noRole.token),
      clock(target.employmentId, {}, noRole.token),
      call(listCorrections, {
        path: "/api/v1/hr-workforce/attendance-corrections",
        token: noRole.token
      }),
      requestCorrection({ employmentId: target.employmentId }, noRole.token),
      readCorrection(correction.id, noRole.token),
      withdraw(correction.id, noRole.token),
      settle(correction.id, noRole.token)
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await count("awcms_hr_attendance_events")).toBe(beforeEvents);
    expect(await count("awcms_hr_attendance_corrections")).toBe(
      beforeCorrections
    );
  });

  test("every attendance permission BITES: all-but-one is refused, only-that-one succeeds", async () => {
    if (!handlerReady) return;
    await publishWorkflow([env.ownerTenantUserId]);
    const colleague = await hire("bite-colleague");

    type Runner = (who: {
      token: string;
      tenantUserId: string;
      profileId: string;
    }) => Promise<{ status: number }>;
    // Each case is built so a call by an AUTHORISED user succeeds (2xx). Cases that
    // need the caller to own an employment link one first.
    const cases: [string, Runner][] = [
      [
        "hr_workforce.clock.create",
        async (who) => {
          const own = await hire(
            `own-${who.tenantUserId.slice(0, 4)}`,
            undefined,
            who.profileId
          );
          await link(own, who.tenantUserId);

          return clock(own, {}, who.token);
        }
      ],
      [
        "hr_workforce.attendance.create",
        (who) =>
          clock(colleague, { source: "kiosk", occurredAt: iso(-1) }, who.token)
      ],
      ["hr_workforce.attendance.read", (who) => events("", who.token)],
      [
        "hr_workforce.corrections.create",
        async (who) => {
          const own = await hire(
            `corr-${who.tenantUserId.slice(0, 4)}`,
            undefined,
            who.profileId
          );
          await link(own, who.tenantUserId);

          return requestCorrection({ employmentId: own }, who.token);
        }
      ],
      [
        "hr_workforce.corrections.read",
        (who) =>
          call(listCorrections, {
            path: "/api/v1/hr-workforce/attendance-corrections",
            token: who.token
          })
      ],
      [
        "hr_workforce.corrections.cancel",
        async (who) => {
          const own = await hire(
            `wd-${who.tenantUserId.slice(0, 4)}`,
            undefined,
            who.profileId
          );
          const seeded = await seedCorrection(own, who.tenantUserId);

          return withdraw(seeded.id, who.token);
        }
      ],
      [
        "hr_workforce.corrections.approve",
        async (who) => {
          const own = await hire(
            `ap-${who.tenantUserId.slice(0, 4)}`,
            undefined,
            who.profileId
          );
          const approver = await seedUser(env.tenantId, "bite-approver", []);
          const seeded = await seedCorrection(own, env.ownerTenantUserId, {
            status: "approved",
            approver: approver.tenantUserId
          });

          return settle(seeded.id, who.token);
        }
      ]
    ];

    // Seven attendance permissions exist; the cases must cover exactly them.
    expect(cases.map(([key]) => key).sort()).toEqual(
      ALL_HR_PERMISSIONS.filter((key) =>
        /\.(clock|attendance|corrections)\./.test(key)
      ).sort()
    );

    for (const [key, run] of cases) {
      const others = ALL_HR_PERMISSIONS.filter(
        (permission) => permission !== key
      );
      const without = await seedUser(env.tenantId, "without", others);
      const only = await seedUser(env.tenantId, "only", [key]);

      expect((await run(without)).status).toBe(403);
      expect([200, 201]).toContain((await run(only)).status);
    }
  });

  describe("recording events", () => {
    test("S3: an employee clocks in for themself; the same employee cannot record for a colleague", async () => {
      if (!handlerReady) return;
      const me = await employee("me", ["hr_workforce.clock.create"]);
      const colleague = await hire("colleague");

      const own = await clock(me.employmentId, {}, me.token);

      expect(own.status).toBe(201);
      expect(own.body.data!.source).toBe("self");
      expect(own.body.data!.late).toBe(false);

      for (const response of [
        // For somebody else as self ...
        await clock(colleague, {}, me.token),
        // ... or as any other source (no `attendance.create`).
        await clock(colleague, { source: "supervisor" }, me.token),
        await clock(me.employmentId, { source: "kiosk" }, me.token),
        // An id that does not exist answers like somebody else's.
        await clock(crypto.randomUUID(), {}, me.token)
      ]) {
        expect(response.status).toBe(403);
      }

      expect(await count("awcms_hr_attendance_events")).toBe(1);
    });

    test("#998: an event recorded for somebody else leaves an audit row (a supervisor always; a kiosk or import only when late); self never; a replay adds none", async () => {
      if (!handlerReady) return;
      const me = await employee("me", ["hr_workforce.clock.create"]);
      const hr = await seedUser(env.tenantId, "hr-audit", [
        "hr_workforce.attendance.create"
      ]);
      const target = await hire("audited");
      const audited = async () =>
        (await admin()`
          SELECT resource_id, severity, attributes::text AS attributes,
                 actor_tenant_user_id
          FROM awcms_audit_events
          WHERE tenant_id = ${env.tenantId}
            AND action = 'hr_workforce.attendance_event.recorded_for_other'
          ORDER BY created_at`) as {
          resource_id: string;
          severity: string;
          attributes: string;
          actor_tenant_user_id: string;
        }[];

      // self: never audited.
      expect((await clock(me.employmentId, {}, me.token)).status).toBe(201);
      expect(await audited()).toHaveLength(0);

      // A punctual kiosk tap: not audited (the event is the record).
      const punctual = await clock(
        target,
        { source: "kiosk", occurredAt: iso(-5) },
        hr.token
      );
      expect(punctual.status).toBe(201);
      expect(punctual.body.data!.late).toBe(false);
      expect(await audited()).toHaveLength(0);

      // A supervisor event: always audited, with the actor and no free text.
      const key = nextKey();
      // Pinned: a default instant is "now" at second precision, so a second
      // boundary between the call and its replay would change the request hash.
      const supervisedAt = iso(-2);
      const supervised = await clock(
        target,
        {
          source: "supervisor",
          clientEventKey: "sup-1",
          occurredAt: supervisedAt
        },
        hr.token,
        key
      );
      expect(supervised.status).toBe(201);
      const rows = await audited();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.resource_id).toBe(supervised.body.data!.id);
      expect(rows[0]!.actor_tenant_user_id).toBe(hr.tenantUserId);
      expect(rows[0]!.severity).toBe("info");
      expect(rows[0]!.attributes).toContain(target);
      expect(rows[0]!.attributes).toContain("supervisor");

      // A replay of the same request adds no second row.
      const replay = await clock(
        target,
        {
          source: "supervisor",
          clientEventKey: "sup-1",
          occurredAt: supervisedAt
        },
        hr.token,
        key
      );
      expect(replay.body).toEqual(supervised.body);
      expect(await audited()).toHaveLength(1);

      // A stale offline replay (past fifteen minutes): audited, as a warning.
      const late = await clock(
        target,
        { source: "import", occurredAt: iso(-3600) },
        hr.token
      );
      expect(late.status).toBe(201);
      expect(late.body.data!.late).toBe(true);
      const afterLate = await audited();
      expect(afterLate).toHaveLength(2);
      expect(afterLate[1]!.resource_id).toBe(late.body.data!.id);
      expect(afterLate[1]!.severity).toBe("warning");
    });

    test("a holder of attendance.create records for others but can never use source self", async () => {
      if (!handlerReady) return;
      const supervisor = await seedUser(env.tenantId, "sup", [
        "hr_workforce.attendance.create"
      ]);
      const target = await hire("target");

      const ok = await clock(
        target,
        { source: "supervisor" },
        supervisor.token
      );

      expect(ok.status).toBe(201);
      expect(ok.body.data!.source).toBe("supervisor");
      expect((await clock(target, {}, supervisor.token)).status).toBe(403);
    });

    test("the server clock decides recordedAt and the body cannot carry a location, a late flag or a recorded time", async () => {
      if (!handlerReady) return;
      const me = await employee("me", ["hr_workforce.clock.create"]);

      for (const extra of [
        { recordedAt: "2001-01-01T00:00:00Z" },
        { late: true },
        { latitude: -2.2, longitude: 113.9 },
        { location: { lat: 1, lng: 2 } },
        { photo: "data:image/png;base64,AAAA" },
        { deviceId: "abc" }
      ]) {
        const refused = await clock(me.employmentId, extra, me.token);

        expect(refused.status).toBe(400);
        expect(refused.body.error!.code).toBe("VALIDATION_ERROR");
      }

      const recorded = await clock(me.employmentId, {}, me.token);
      const age = Math.abs(
        Date.now() - new Date(recorded.body.data!.recordedAt).getTime()
      );

      expect(age).toBeLessThan(30_000);
    });

    test("future and back-dated claims are 422, named; a stricter tenant skew bites", async () => {
      if (!handlerReady) return;
      const me = await employee("me", ["hr_workforce.clock.create"]);
      const kiosk = await seedUser(env.tenantId, "kiosk", [
        "hr_workforce.attendance.create"
      ]);

      const future = await clock(
        me.employmentId,
        { occurredAt: iso(900) },
        me.token
      );
      const past = await clock(
        me.employmentId,
        { occurredAt: iso(-900) },
        me.token
      );

      expect(future.status).toBe(422);
      expect(future.body.error!.code).toBe("ATTENDANCE_TIME_IN_FUTURE");
      expect(past.status).toBe(422);
      expect(past.body.error!.code).toBe("ATTENDANCE_BACKDATED");

      // A kiosk replay of the same age is fine, flagged late.
      const replayed = await clock(
        me.employmentId,
        { source: "kiosk", occurredAt: iso(-900) },
        kiosk.token
      );

      expect(replayed.status).toBe(201);
      expect(replayed.body.data!.late).toBe(true);

      const tooOld = await clock(
        me.employmentId,
        { source: "import", occurredAt: iso(-8 * 24 * 3600) },
        kiosk.token
      );

      expect(tooOld.status).toBe(422);
      expect(tooOld.body.error!.code).toBe("ATTENDANCE_TOO_OLD");

      // Tighten the skew: what the default accepted is now refused.
      expect(
        (
          await call(putSettings, {
            method: "PUT",
            path: "/api/v1/hr-workforce/settings",
            body: { clockSkewSeconds: 5 }
          })
        ).status
      ).toBe(200);
      const strict = await clock(
        me.employmentId,
        { occurredAt: iso(60) },
        me.token
      );

      expect(strict.status).toBe(422);
      expect(strict.body.error!.code).toBe("ATTENDANCE_TIME_IN_FUTURE");
    });

    test("replay: the same clientEventKey returns the ORIGINAL (200); a different event under it is 409; the same Idempotency-Key replays byte for byte", async () => {
      if (!handlerReady) return;
      const me = await employee("me", ["hr_workforce.clock.create"]);
      const body = { clientEventKey: "queue-001", occurredAt: iso(-5) };

      const first = await clock(me.employmentId, body, me.token);
      const replay = await clock(me.employmentId, body, me.token);

      expect(first.status).toBe(201);
      expect(replay.status).toBe(200);
      expect(replay.body.data!.id).toBe(first.body.data!.id);
      expect(await count("awcms_hr_attendance_events")).toBe(1);

      const conflict = await clock(
        me.employmentId,
        { ...body, kind: "clock_out" },
        me.token
      );

      expect(conflict.status).toBe(409);
      expect(conflict.body.error!.code).toBe("CLIENT_EVENT_KEY_CONFLICT");

      const key = nextKey();
      const one = await clock(
        me.employmentId,
        { clientEventKey: "queue-002" },
        me.token,
        key
      );
      const two = await clock(
        me.employmentId,
        { clientEventKey: "queue-002" },
        me.token,
        key
      );

      expect(two.status).toBe(one.status);
      expect(two.body).toEqual(one.body);
      expect(
        (
          await clock(
            me.employmentId,
            { clientEventKey: "queue-003" },
            me.token,
            key
          )
        ).body.error!.code
      ).toBe("IDEMPOTENCY_CONFLICT");
      expect(await count("awcms_hr_attendance_events")).toBe(2);
    });

    test("concurrent posts of one clientEventKey record exactly one event", async () => {
      if (!handlerReady) return;
      const me = await employee("me", ["hr_workforce.clock.create"]);
      const body = { clientEventKey: "race-queue", occurredAt: iso(-2) };

      const all = await Promise.all(
        Array.from({ length: 6 }, () => clock(me.employmentId, body, me.token))
      );

      expect(all.every((r) => r.status === 201 || r.status === 200)).toBe(true);
      expect(new Set(all.map((r) => r.body.data!.id)).size).toBe(1);
      expect(await count("awcms_hr_attendance_events")).toBe(1);
    });

    test("S15: another tenant's employment id is refused; a deleted or terminated employment cannot clock", async () => {
      if (!handlerReady) return;
      const supervisor = await seedUser(env.tenantId, "sup", [
        "hr_workforce.attendance.create"
      ]);
      const other = (await admin()`
        INSERT INTO awcms_tenants (tenant_code, tenant_name) VALUES ('other-t', 'Other') RETURNING id
      `) as { id: string }[];
      const otherProfile = await seedProfile(other[0]!.id, "x");
      const otherEmployment = (await admin()`
        INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
        VALUES (${other[0]!.id}, ${otherProfile}, 'X-1', '2026-01-01') RETURNING id
      `) as { id: string }[];

      expect(
        (
          await clock(
            otherEmployment[0]!.id,
            { source: "supervisor" },
            supervisor.token
          )
        ).body.error!.code
      ).toBe("EMPLOYMENT_NOT_FOUND");

      const gone = await hire("gone");
      expect(
        (
          await call(deleteEmployment, {
            method: "DELETE",
            path: `/api/v1/hr-workforce/employments/${gone}`,
            params: { id: gone },
            body: { reason: "entered by mistake" }
          })
        ).status
      ).toBe(200);
      expect(
        (await clock(gone, { source: "supervisor" }, supervisor.token)).status
      ).toBe(422);

      const leaver = await hire("leaver");
      expect(
        (
          await call(changeTerms, {
            method: "POST",
            path: `/api/v1/hr-workforce/employments/${leaver}/terms`,
            params: { id: leaver },
            body: {
              effectiveFrom: "2026-09-01",
              employmentType: "permanent",
              status: "terminated"
            }
          })
        ).status
      ).toBe(201);
      const terminated = await clock(
        leaver,
        { source: "supervisor" },
        supervisor.token
      );

      expect(terminated.status).toBe(409);
      expect(terminated.body.error!.code).toBe("EMPLOYMENT_TERMINATED");
    });
  });

  describe("who reads which events", () => {
    test("S1: an employee reads their OWN events (mine) and nothing of a colleague's; the unrestricted list needs the permission", async () => {
      if (!handlerReady) return;
      const me = await employee("me", ["hr_workforce.clock.create"]);
      const peer = await employee("peer", ["hr_workforce.clock.create"]);
      const mine = (await clock(me.employmentId, {}, me.token)).body.data!;
      await clock(peer.employmentId, {}, peer.token);

      const own = await events("mine=true", me.token);

      expect(own.status).toBe(200);
      expect(own.body.data!.events.map((e) => e.id)).toEqual([mine.id]);

      for (const response of [
        await events("", me.token),
        await events(`employmentId=${peer.employmentId}`, me.token),
        await events(`mine=true&employmentId=${peer.employmentId}`, me.token),
        await events(`reports=true&employmentId=${peer.employmentId}`, me.token)
      ]) {
        expect(response.status).toBe(403);
      }

      // A person with no employment gets an EMPTY own list, not another's.
      const stranger = await seedUser(env.tenantId, "stranger", []);
      expect(
        (await events("mine=true", stranger.token)).body.data!.events
      ).toEqual([]);
      // (A malformed request is held until authorization decides: the caller must
      // be allowed in to hear that it is malformed.)
      expect((await events("mine=true&reports=true")).status).toBe(400);
    });

    test("mine covers EVERY live employment of the caller (a rehire reads the old and the new), never another person's or a deleted one", async () => {
      if (!handlerReady) return;
      const approver = await seedUser(env.tenantId, "approver", [
        WORKFLOW_DECIDE
      ]);
      await publishWorkflow([approver.tenantUserId]);
      const me = await employee("me", [
        "hr_workforce.clock.create",
        "hr_workforce.corrections.create"
      ]);
      const peer = await employee("peer", ["hr_workforce.clock.create"]);
      const oldEvent = (await clock(me.employmentId, {}, me.token)).body.data!;
      const oldCorrection = (
        await requestCorrection({ employmentId: me.employmentId }, me.token)
      ).body.data!;
      const peerEvent = (await clock(peer.employmentId, {}, peer.token)).body
        .data!;

      // They leave, and are rehired under the SAME login: a second employment.
      expect(
        (
          await call(changeTerms, {
            method: "POST",
            path: `/api/v1/hr-workforce/employments/${me.employmentId}/terms`,
            params: { id: me.employmentId },
            body: {
              effectiveFrom: "2026-09-01",
              employmentType: "permanent",
              status: "terminated"
            }
          })
        ).status
      ).toBe(201);
      const rehired = await hire("me-again", undefined, me.profileId);
      await link(rehired, me.tenantUserId);
      const newEvent = (await clock(rehired, {}, me.token)).body.data!;
      const newCorrection = (
        await requestCorrection({ employmentId: rehired }, me.token)
      ).body.data!;

      const own = await events("mine=true", me.token);
      const ownIds = own.body.data!.events.map((e) => e.id);

      expect(own.status).toBe(200);
      expect(ownIds).toHaveLength(2);
      expect(ownIds).toContain(oldEvent.id);
      expect(ownIds).toContain(newEvent.id);
      expect(ownIds).not.toContain(peerEvent.id);

      const ownCorrections = await call<{ corrections: Correction[] }>(
        listCorrections,
        {
          path: "/api/v1/hr-workforce/attendance-corrections",
          query: "mine=true",
          token: me.token
        }
      );
      const correctionIds = ownCorrections.body.data!.corrections.map(
        (c) => c.id
      );

      expect(correctionIds).toHaveLength(2);
      expect(correctionIds).toContain(oldCorrection.id);
      expect(correctionIds).toContain(newCorrection.id);

      // The old employment is theirs to name as a filter; the peer's is not.
      expect(
        (
          await events(`mine=true&employmentId=${me.employmentId}`, me.token)
        ).body.data!.events.map((e) => e.id)
      ).toEqual([oldEvent.id]);
      expect(
        (await events(`mine=true&employmentId=${peer.employmentId}`, me.token))
          .status
      ).toBe(403);
      // ...and the other way: the peer never reads either of mine.
      const theirs = await events("mine=true", peer.token);

      expect(theirs.body.data!.events.map((e) => e.id)).toEqual([peerEvent.id]);
      expect(
        (await events(`mine=true&employmentId=${rehired}`, peer.token)).status
      ).toBe(403);

      // A soft-deleted employment is no longer anybody's to read.
      expect(
        (
          await call(deleteEmployment, {
            method: "DELETE",
            path: `/api/v1/hr-workforce/employments/${rehired}`,
            params: { id: rehired },
            body: { reason: "entered by mistake" }
          })
        ).status
      ).toBe(200);
      expect(
        (await events("mine=true", me.token)).body.data!.events.map((e) => e.id)
      ).toEqual([oldEvent.id]);
    });

    test("S4/S6: a supervisor reads their reports through the manager chain, not their peers or managers", async () => {
      if (!handlerReady) return;
      const boss = await employee("boss", []);
      const lead = await employee("lead", [], boss.employmentId);
      const worker = await employee(
        "worker",
        ["hr_workforce.clock.create"],
        lead.employmentId
      );
      const peer = await employee(
        "peer",
        ["hr_workforce.clock.create"],
        boss.employmentId
      );
      const outsider = await employee("outsider", [
        "hr_workforce.clock.create"
      ]);
      const hr = await seedUser(env.tenantId, "hr", [
        "hr_workforce.attendance.read"
      ]);

      const ids: Record<string, string> = {};
      for (const [name, who] of [
        ["worker", worker],
        ["peer", peer],
        ["outsider", outsider]
      ] as const) {
        ids[name] = (
          await clock(who.employmentId, {}, who.token)
        ).body.data!.id;
      }

      // Boss: direct and transitive reports.
      const bossView = await events("reports=true", boss.token);

      expect(bossView.status).toBe(200);
      expect(bossView.body.data!.events.map((e) => e.id).sort()).toEqual(
        [ids.worker!, ids.peer!].sort()
      );
      // Lead: only the worker. Worker: nobody.
      expect(
        (await events("reports=true", lead.token)).body.data!.events.map(
          (e) => e.id
        )
      ).toEqual([ids.worker!]);
      expect(
        (await events("reports=true", worker.token)).body.data!.events
      ).toEqual([]);
      // Outside the chain: 403, same as absent.
      expect(
        (
          await events(
            `reports=true&employmentId=${outsider.employmentId}`,
            boss.token
          )
        ).status
      ).toBe(403);
      expect(
        (
          await events(
            `reports=true&employmentId=${boss.employmentId}`,
            lead.token
          )
        ).status
      ).toBe(403);
      // The grant is READ-only: a supervisor cannot record for a report.
      expect(
        (await clock(worker.employmentId, { source: "supervisor" }, boss.token))
          .status
      ).toBe(403);
      // HR (the permission) sees everyone.
      expect((await events("", hr.token)).body.data!.events).toHaveLength(3);
    });

    test("a soft-deleted middle manager breaks the chain; a terminated manager supervises nobody", async () => {
      if (!handlerReady) return;
      const boss = await employee("boss", []);
      const lead = await employee("lead", [], boss.employmentId);
      const worker = await employee(
        "worker",
        ["hr_workforce.clock.create"],
        lead.employmentId
      );
      await clock(worker.employmentId, {}, worker.token);

      expect(
        (await events("reports=true", boss.token)).body.data!.events
      ).toHaveLength(1);

      expect(
        (
          await call(deleteEmployment, {
            method: "DELETE",
            path: `/api/v1/hr-workforce/employments/${lead.employmentId}`,
            params: { id: lead.employmentId },
            body: { reason: "entered by mistake" }
          })
        ).status
      ).toBe(200);

      // Fail closed: the skip-level manager no longer sees the worker.
      expect(
        (await events("reports=true", boss.token)).body.data!.events
      ).toEqual([]);

      const manager = await employee("manager", []);
      const report = await employee(
        "report",
        ["hr_workforce.clock.create"],
        manager.employmentId
      );
      await clock(report.employmentId, {}, report.token);
      expect(
        (await events("reports=true", manager.token)).body.data!.events
      ).toHaveLength(1);

      expect(
        (
          await call(changeTerms, {
            method: "POST",
            path: `/api/v1/hr-workforce/employments/${manager.employmentId}/terms`,
            params: { id: manager.employmentId },
            body: {
              effectiveFrom: "2026-09-01",
              employmentType: "permanent",
              status: "terminated"
            }
          })
        ).status
      ).toBe(201);
      expect(
        (await events("reports=true", manager.token)).body.data!.events
      ).toEqual([]);
    });

    test("keyset pagination: a full page carries a cursor that continues without repeating", async () => {
      if (!handlerReady) return;
      const sup = await seedUser(env.tenantId, "bulk", [
        "hr_workforce.attendance.create",
        "hr_workforce.attendance.read"
      ]);
      const target = await hire("bulk");

      // 101 rows in one statement, as the admin (the route's page size is 100).
      await admin()`
        INSERT INTO awcms_hr_attendance_events
          (tenant_id, employment_id, kind, occurred_at, source, client_event_key)
        SELECT ${env.tenantId}, ${target}, 'clock_in',
               now() - (g * interval '1 second'), 'kiosk', 'bulk-' || g
        FROM generate_series(1, 101) g
      `;

      const first = await events("", sup.token);

      expect(first.body.data!.events).toHaveLength(100);
      expect(first.body.data!.nextCursor).not.toBeNull();

      const second = await events(
        `cursor=${encodeURIComponent(first.body.data!.nextCursor!)}`,
        sup.token
      );
      const seen = new Set(first.body.data!.events.map((e) => e.id));

      expect(second.body.data!.events).toHaveLength(1);
      expect(seen.has(second.body.data!.events[0]!.id)).toBe(false);
      expect((await events("cursor=garbage", sup.token)).status).toBe(400);
    });
  });

  describe("sensitive-read audit (Issue #1083)", () => {
    type AuditRow = {
      action: string;
      actor_tenant_user_id: string;
      attributes: Record<string, unknown> | string;
    };

    async function auditRows(kind: string): Promise<AuditRow[]> {
      return (await admin()`
        SELECT action, actor_tenant_user_id, attributes
        FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND action = ${kind}
        ORDER BY created_at, id
      `) as AuditRow[];
    }

    const attrs = (row: AuditRow) =>
      (typeof row.attributes === "string"
        ? JSON.parse(row.attributes)
        : row.attributes) as Record<string, unknown>;

    test("M-2: an all-employee list and a manager-chain (reports) list are recorded with their mode; mine is not", async () => {
      if (!handlerReady) return;
      const hr = await seedUser(env.tenantId, "hr-audit", [
        "hr_workforce.attendance.read"
      ]);
      // A director with NO permission at all, who reads through the chain.
      const boss = await employee("boss-audit", []);
      const report = await employee(
        "rep-audit",
        ["hr_workforce.clock.create"],
        boss.employmentId
      );
      await clock(report.employmentId, {}, report.token);

      expect((await events("mine=true", report.token)).status).toBe(200);
      expect(await auditRows("sensitive_read.attendance_events")).toHaveLength(
        0
      );

      expect((await events("", hr.token)).status).toBe(200);
      expect((await events("reports=true", boss.token)).status).toBe(200);

      const rows = await auditRows("sensitive_read.attendance_events");
      const byActor = new Map(
        rows.map((row) => [row.actor_tenant_user_id, row])
      );

      expect(attrs(byActor.get(hr.tenantUserId)!).mode).toBe("all");
      expect(attrs(byActor.get(boss.tenantUserId)!).mode).toBe("reports");
      expect(attrs(byActor.get(boss.tenantUserId)!).resourceIds).toEqual([
        report.employmentId
      ]);
    });

    test("M-1: the corrections list is recorded; the single record only when the reason came from the role grant", async () => {
      if (!handlerReady) return;
      const approver = await seedUser(env.tenantId, "approver-a", [
        WORKFLOW_DECIDE
      ]);
      await publishWorkflow([approver.tenantUserId]);
      const hr = await seedUser(env.tenantId, "hr-corr", [
        "hr_workforce.corrections.read"
      ]);
      const worker = await employee("worker-a", [
        "hr_workforce.clock.create",
        "hr_workforce.corrections.create"
      ]);
      const created = (
        await requestCorrection(
          { employmentId: worker.employmentId },
          worker.token
        )
      ).body.data!;

      // The requester reads their own correction: nothing recorded.
      expect((await readCorrection(created.id, worker.token)).status).toBe(200);
      expect(
        await auditRows("sensitive_read.attendance_corrections")
      ).toHaveLength(0);

      // HR lists everyone's, then reads the record with its reason.
      const list = await call(listCorrections, {
        path: "/api/v1/hr-workforce/attendance-corrections",
        token: hr.token
      });

      expect(list.status).toBe(200);

      const single = await readCorrection(created.id, hr.token);

      expect(single.status).toBe(200);
      expect(single.body.data!.reason).toBe(REASON);

      const rows = await auditRows("sensitive_read.attendance_corrections");

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(
        rows.every((row) => row.actor_tenant_user_id === hr.tenantUserId)
      ).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("SENTINEL-reason");
      expect(rows.map((row) => attrs(row).mode)).toContain("all");
      expect(
        rows.some((row) =>
          (attrs(row).resourceIds as string[]).includes(worker.employmentId)
        )
      ).toBe(true);
    });
  });

  describe("corrections", () => {
    async function setup() {
      const approver = await seedUser(env.tenantId, "approver", [
        WORKFLOW_DECIDE
      ]);
      const hr = await seedUser(env.tenantId, "hr", [
        "hr_workforce.corrections.approve",
        "hr_workforce.corrections.read",
        "hr_workforce.attendance.read"
      ]);
      await publishWorkflow([approver.tenantUserId]);
      const worker = await employee("worker", [
        "hr_workforce.clock.create",
        "hr_workforce.corrections.create",
        "hr_workforce.corrections.cancel"
      ]);

      return { approver, hr, worker };
    }

    test("fail-closed: with no published workflow (or workflow off) nothing is created", async () => {
      if (!handlerReady) return;
      const worker = await employee("worker", [
        "hr_workforce.corrections.create"
      ]);
      const before = await count("awcms_hr_attendance_corrections");

      const refused = await requestCorrection(
        { employmentId: worker.employmentId },
        worker.token
      );

      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("APPROVAL_WORKFLOW_NOT_CONFIGURED");
      expect(await count("awcms_hr_attendance_corrections")).toBe(before);
      expect(await count("awcms_workflow_instances")).toBe(0);
    });

    test("the whole flow: request -> approve in the workflow -> settle -> a NEW event supersedes, the original is untouched", async () => {
      if (!handlerReady) return;
      const { approver, hr, worker } = await setup();
      const original = (await clock(worker.employmentId, {}, worker.token)).body
        .data!;
      const before = await eventRow(original.id);

      const requested = await requestCorrection(
        {
          employmentId: worker.employmentId,
          kind: "replace",
          targetEventId: original.id,
          proposedKind: "clock_in",
          proposedOccurredAt: iso(-7200)
        },
        worker.token
      );

      expect(requested.status).toBe(201);
      expect(requested.body.data!.status).toBe("pending");
      // No write response carries the reason; only the single read does.
      expect(requested.body.data!.reason).toBeUndefined();

      const id = requested.body.data!.id;
      const instance = requested.body.data!.workflowInstanceId;

      // Not decided yet.
      const early = await settle(id, hr.token);

      expect(early.status).toBe(409);
      expect(early.body.error!.code).toBe("CORRECTION_STILL_PENDING");

      // The workflow's approver decides, in the real engine.
      expect((await decide(instance, approver.token)).status).toBe(200);

      const settled = await settle(id, hr.token);

      expect(settled.status).toBe(200);
      expect(settled.body.data!.status).toBe("approved");
      expect(settled.body.data!.decidedBy).toBe(approver.tenantUserId);
      expect(settled.body.data!.appliedEventId).not.toBeNull();

      // The original is byte-identical; the new event supersedes it.
      expect(await eventRow(original.id)).toEqual(before);
      const effective = await events("effective=true", hr.token);
      const applied = effective.body.data!.events.find(
        (e) => e.id === settled.body.data!.appliedEventId
      )!;

      expect(effective.body.data!.events).toHaveLength(1);
      expect(applied.source).toBe("correction");
      expect(applied.supersedesEventId).toBe(original.id);
      expect(applied.correctionId).toBe(id);
      expect(new Date(applied.occurredAt).getTime()).toBeLessThan(
        new Date(original.occurredAt).getTime() - 3_000_000
      );

      const all = await events("", hr.token);

      expect(all.body.data!.events).toHaveLength(2);
      expect(
        all.body.data!.events.find((e) => e.id === original.id)!
          .supersededByEventId
      ).toBe(applied.id);

      // A second settle is a state conflict, not a second event.
      const again = await settle(id, hr.token);

      expect(again.status).toBe(409);
      expect(again.body.error!.code).toBe("CORRECTION_NOT_PENDING");
      expect(await count("awcms_hr_attendance_events")).toBe(2);
    });

    test("S5: the requester cannot settle their own correction; and an approval they took part in is refused", async () => {
      if (!handlerReady) return;
      const { approver, hr, worker } = await setup();
      // The requester also holds the settle power.
      const requester = await employee("requester", [
        "hr_workforce.corrections.create",
        "hr_workforce.corrections.approve"
      ]);
      const created = (
        await requestCorrection(
          { employmentId: requester.employmentId },
          requester.token
        )
      ).body.data!;

      expect(
        (await decide(created.workflowInstanceId, approver.token)).status
      ).toBe(200);

      const own = await settle(created.id, requester.token);

      expect(own.status).toBe(403);
      expect(await count("awcms_hr_attendance_events")).toBe(0);

      // A delegate who acted on the requester's behalf: refused with a named 409,
      // and the correction stays pending.
      await forgeDecisionOnBehalfOf(
        await taskOf(created.workflowInstanceId),
        requester.tenantUserId
      );
      const viaDelegate = await settle(created.id, hr.token);

      expect(viaDelegate.status).toBe(409);
      expect(viaDelegate.body.error!.code).toBe("CORRECTION_SELF_APPROVED");
      expect(
        (await readCorrection(created.id, hr.token)).body.data!.status
      ).toBe("pending");
      expect(await count("awcms_hr_attendance_events")).toBe(0);
      expect(worker.employmentId).toBeTruthy();
    });

    test("the workflow's own guard refuses the requester deciding; a workflow that finished with no human decision cannot be applied", async () => {
      if (!handlerReady) return;
      const { hr } = await setup();
      const requester = await employee("requester", [
        "hr_workforce.corrections.create",
        WORKFLOW_DECIDE
      ]);
      // The requester is ALSO the sole assignee: the engine refuses them.
      await admin()`
        UPDATE awcms_workflow_definitions SET lifecycle_status = 'retired'
        WHERE tenant_id = ${env.tenantId}`;
      await admin()`
        INSERT INTO awcms_workflow_definitions
          (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
        VALUES (${env.tenantId}, 'hr.attendance_correction', 'Self', 2, 'active',
                ${{
                  startNodeId: "approval",
                  nodes: [
                    {
                      id: "approval",
                      type: "approval",
                      name: "Approval",
                      assigneeTenantUserIds: [requester.tenantUserId],
                      quorumRule: "any",
                      onApprove: "end_approved",
                      onReject: "end_rejected"
                    },
                    { id: "end_approved", type: "end", outcome: "approved" },
                    { id: "end_rejected", type: "end", outcome: "rejected" }
                  ]
                }}::jsonb, '[]'::jsonb)`;
      const created = (
        await requestCorrection(
          { employmentId: requester.employmentId },
          requester.token
        )
      ).body.data!;

      const own = await decide(created.workflowInstanceId, requester.token);

      expect([403, 409]).toContain(own.status);

      // A graph that auto-approves (no approval node) leaves no human decision.
      await admin()`
        UPDATE awcms_workflow_definitions SET lifecycle_status = 'retired'
        WHERE tenant_id = ${env.tenantId}`;
      await admin()`
        INSERT INTO awcms_workflow_definitions
          (tenant_id, workflow_key, name, version, lifecycle_status, graph, facts_schema)
        VALUES (${env.tenantId}, 'hr.attendance_correction', 'Auto', 3, 'active',
                ${{ startNodeId: "end", nodes: [{ id: "end", type: "end", outcome: "approved" }] }}::jsonb,
                '[]'::jsonb)`;
      const auto = (
        await requestCorrection(
          { employmentId: requester.employmentId },
          requester.token
        )
      ).body.data!;

      const refused = await settle(auto.id, hr.token);

      expect(refused.status).toBe(409);
      expect(refused.body.error!.code).toBe("CORRECTION_NO_APPROVER");
      expect(await count("awcms_hr_attendance_events")).toBe(0);
    });

    test("reject in the workflow -> settle makes it rejected and appends nothing; admin cancel -> withdrawn", async () => {
      if (!handlerReady) return;
      const { approver, hr, worker } = await setup();
      const a = (
        await requestCorrection(
          { employmentId: worker.employmentId },
          worker.token
        )
      ).body.data!;

      expect(
        (await decide(a.workflowInstanceId, approver.token, "reject")).status
      ).toBe(200);

      const rejected = await settle(a.id, hr.token);

      expect(rejected.status).toBe(200);
      expect(rejected.body.data!.status).toBe("rejected");
      expect(rejected.body.data!.decidedBy).toBe(approver.tenantUserId);

      const b = (
        await requestCorrection(
          { employmentId: worker.employmentId },
          worker.token
        )
      ).body.data!;
      await admin()`
        UPDATE awcms_workflow_instances
        SET status = 'cancelled', cancelled_at = now(),
            cancelled_by_tenant_user_id = ${env.ownerTenantUserId}
        WHERE id = ${b.workflowInstanceId}`;

      const withdrawn = await settle(b.id, hr.token);

      expect(withdrawn.body.data!.status).toBe("withdrawn");
      expect(await count("awcms_hr_attendance_events")).toBe(0);
    });

    test("#998: the requester can settle their OWN rejected or cancelled correction (nothing is applied); approving stays refused", async () => {
      if (!handlerReady) return;
      const { approver } = await setup();
      const requester = await employee("self-closer", [
        "hr_workforce.corrections.create",
        "hr_workforce.corrections.approve"
      ]);
      const request = async () =>
        (
          await requestCorrection(
            { employmentId: requester.employmentId },
            requester.token
          )
        ).body.data!;

      const rejected = await request();
      expect(
        (await decide(rejected.workflowInstanceId, approver.token, "reject"))
          .status
      ).toBe(200);
      const closed = await settle(rejected.id, requester.token);

      expect(closed.status).toBe(200);
      expect(closed.body.data!.status).toBe("rejected");
      expect(closed.body.data!.decidedBy).toBe(approver.tenantUserId);

      const cancelled = await request();
      await admin()`
        UPDATE awcms_workflow_instances
        SET status = 'cancelled', cancelled_at = now(),
            cancelled_by_tenant_user_id = ${env.ownerTenantUserId}
        WHERE id = ${cancelled.workflowInstanceId}`;
      const withdrawn = await settle(cancelled.id, requester.token);

      expect(withdrawn.status).toBe(200);
      expect(withdrawn.body.data!.status).toBe("withdrawn");

      // Still pending in the engine: the guard applies, 403 (not 409).
      const stillPending = await request();
      expect((await settle(stillPending.id, requester.token)).status).toBe(403);
      // Approved by somebody else: the guard still applies to the requester.
      const approved = await request();
      expect(
        (await decide(approved.workflowInstanceId, approver.token)).status
      ).toBe(200);
      expect((await settle(approved.id, requester.token)).status).toBe(403);
      expect(await count("awcms_hr_attendance_events")).toBe(0);

      // The permission itself is still required.
      const noApprove = await employee("no-approve", [
        "hr_workforce.corrections.create"
      ]);
      const mine = (
        await requestCorrection(
          { employmentId: noApprove.employmentId },
          noApprove.token
        )
      ).body.data!;
      await decide(mine.workflowInstanceId, approver.token, "reject");
      expect((await settle(mine.id, noApprove.token)).status).toBe(403);
    });

    test("withdraw: the REQUESTER only, while pending; the instance is cancelled; a replay is idempotent", async () => {
      if (!handlerReady) return;
      const { approver, worker } = await setup();
      const other = await employee("other", [
        "hr_workforce.corrections.create",
        "hr_workforce.corrections.cancel"
      ]);
      const created = (
        await requestCorrection(
          { employmentId: worker.employmentId },
          worker.token
        )
      ).body.data!;

      // Somebody else, even with the permission: indistinguishable from absent.
      expect((await withdraw(created.id, other.token)).status).toBe(404);
      expect((await withdraw(crypto.randomUUID(), worker.token)).status).toBe(
        404
      );

      const key = nextKey();
      const first = await call<Correction>(withdrawCorrection, {
        method: "POST",
        path: `/api/v1/hr-workforce/attendance-corrections/${created.id}/withdraw`,
        params: { id: created.id },
        token: worker.token,
        idempotencyKey: key
      });
      const replay = await call<Correction>(withdrawCorrection, {
        method: "POST",
        path: `/api/v1/hr-workforce/attendance-corrections/${created.id}/withdraw`,
        params: { id: created.id },
        token: worker.token,
        idempotencyKey: key
      });

      expect(first.status).toBe(200);
      expect(first.body.data!.status).toBe("withdrawn");
      expect(replay.body).toEqual(first.body);

      const instance = (await admin()`
        SELECT status FROM awcms_workflow_instances WHERE id = ${created.workflowInstanceId}
      `) as { status: string }[];

      expect(instance[0]!.status).toBe("cancelled");
      // A different key is now a state conflict.
      expect((await withdraw(created.id, worker.token)).body.error!.code).toBe(
        "CORRECTION_NOT_PENDING"
      );
      // The (cancelled) approver can no longer decide.
      expect([403, 404, 409]).toContain(
        (await decide(created.workflowInstanceId, approver.token)).status
      );
    });

    test("a correction targets an event of THAT employment, once: the target must exist, not be replaced, not already be pending", async () => {
      if (!handlerReady) return;
      const { worker } = await setup();
      const peer = await employee("peer", ["hr_workforce.clock.create"]);
      const mine = (await clock(worker.employmentId, {}, worker.token)).body
        .data!;
      const theirs = (await clock(peer.employmentId, {}, peer.token)).body
        .data!;

      const foreign = await requestCorrection(
        {
          employmentId: worker.employmentId,
          kind: "replace",
          targetEventId: theirs.id
        },
        worker.token
      );

      expect(foreign.status).toBe(422);
      expect(foreign.body.error!.code).toBe("TARGET_EVENT_NOT_FOUND");
      expect(
        (
          await requestCorrection(
            {
              employmentId: worker.employmentId,
              kind: "replace",
              targetEventId: crypto.randomUUID()
            },
            worker.token
          )
        ).body.error!.code
      ).toBe("TARGET_EVENT_NOT_FOUND");

      const first = await requestCorrection(
        {
          employmentId: worker.employmentId,
          kind: "replace",
          targetEventId: mine.id
        },
        worker.token
      );
      const second = await requestCorrection(
        {
          employmentId: worker.employmentId,
          kind: "replace",
          targetEventId: mine.id
        },
        worker.token
      );

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(second.body.error!.code).toBe("CORRECTION_ALREADY_PENDING");
      // No instance leaked from the refused request.
      expect(await count("awcms_workflow_instances")).toBe(1);
    });

    test("a request for somebody else's employment needs the record-for-others power; S15 other tenant is refused", async () => {
      if (!handlerReady) return;
      const { worker } = await setup();
      const peer = await employee("peer", []);
      const supervisor = await seedUser(env.tenantId, "supervisor", [
        "hr_workforce.corrections.create",
        "hr_workforce.attendance.create"
      ]);

      expect(
        (
          await requestCorrection(
            { employmentId: peer.employmentId },
            worker.token
          )
        ).status
      ).toBe(403);
      // With the power, a supervisor may file one — and then cannot approve it.
      const filed = await requestCorrection(
        { employmentId: peer.employmentId },
        supervisor.token
      );

      expect(filed.status).toBe(201);
      expect(filed.body.data!.requestedBy).toBe(supervisor.tenantUserId);
      expect(
        (
          await requestCorrection(
            { employmentId: crypto.randomUUID() },
            supervisor.token
          )
        ).body.error!.code
      ).toBe("EMPLOYMENT_NOT_FOUND");
    });

    test("the reason is SENSITIVE: the requester, an assignee and a corrections.read holder see it; a supervisor through the chain and a colleague do not; the list never carries it", async () => {
      if (!handlerReady) return;
      const { approver, hr } = await setup();
      const boss = await employee("boss", []);
      const worker = await employee(
        "worker",
        ["hr_workforce.corrections.create"],
        boss.employmentId
      );
      const colleague = await employee("colleague", []);
      const created = (
        await requestCorrection(
          { employmentId: worker.employmentId },
          worker.token
        )
      ).body.data!;

      const seesReason = async (token: string) =>
        (await readCorrection(created.id, token)).body.data?.reason;

      expect(await seesReason(worker.token)).toBe(REASON);
      expect(await seesReason(approver.token)).toBe(REASON);
      expect(await seesReason(hr.token)).toBe(REASON);

      const viaChain = await readCorrection(created.id, boss.token);

      expect(viaChain.status).toBe(200);
      expect(viaChain.body.data!.status).toBe("pending");
      expect("reason" in viaChain.body.data!).toBe(false);
      expect(JSON.stringify(viaChain.body)).not.toContain("SENTINEL");

      expect((await readCorrection(created.id, colleague.token)).status).toBe(
        403
      );
      // A missing id and somebody else's are both 403 to a caller without the permission.
      expect(
        (await readCorrection(crypto.randomUUID(), colleague.token)).status
      ).toBe(403);

      for (const token of [worker.token, hr.token, boss.token]) {
        const list = await call(listCorrections, {
          path: "/api/v1/hr-workforce/attendance-corrections",
          query:
            token === hr.token
              ? ""
              : token === boss.token
                ? "reports=true"
                : "mine=true",
          token
        });

        expect(list.status).toBe(200);
        expect(JSON.stringify(list.body)).not.toContain("SENTINEL");
        expect(JSON.stringify(list.body)).toContain(created.id);
      }

      // Own / reports / permission bases on the list are exclusive.
      expect(
        (
          await call(listCorrections, {
            path: "/api/v1/hr-workforce/attendance-corrections",
            query: `employmentId=${worker.employmentId}`,
            token: colleague.token
          })
        ).status
      ).toBe(403);
    });

    test("idempotent create: a replay returns the same correction and one instance; the same key with another body is 409", async () => {
      if (!handlerReady) return;
      const { worker } = await setup();
      const key = nextKey();
      // A pinned instant: the default is "now - 1h" at second precision, so a
      // second boundary between the two calls changed the request hash.
      const proposedOccurredAt = iso(-3600);
      const first = await requestCorrection(
        { employmentId: worker.employmentId, proposedOccurredAt },
        worker.token,
        key
      );
      const replay = await requestCorrection(
        { employmentId: worker.employmentId, proposedOccurredAt },
        worker.token,
        key
      );

      expect(first.status).toBe(201);
      expect(replay.body).toEqual(first.body);
      expect(await count("awcms_hr_attendance_corrections")).toBe(1);
      expect(await count("awcms_workflow_instances")).toBe(1);
      expect(
        (
          await requestCorrection(
            { employmentId: worker.employmentId, proposedKind: "clock_in" },
            worker.token,
            key
          )
        ).body.error!.code
      ).toBe("IDEMPOTENCY_CONFLICT");
    });

    test("concurrent settles append exactly one superseding event", async () => {
      if (!handlerReady) return;
      const { approver, hr, worker } = await setup();
      const original = (await clock(worker.employmentId, {}, worker.token)).body
        .data!;
      const created = (
        await requestCorrection(
          {
            employmentId: worker.employmentId,
            kind: "replace",
            targetEventId: original.id
          },
          worker.token
        )
      ).body.data!;
      expect(
        (await decide(created.workflowInstanceId, approver.token)).status
      ).toBe(200);

      const all = await Promise.all(
        Array.from({ length: 5 }, () => settle(created.id, hr.token))
      );

      expect(all.filter((r) => r.status === 200)).toHaveLength(1);
      expect(
        all
          .filter((r) => r.status !== 200)
          .every((r) => r.body.error!.code === "CORRECTION_NOT_PENDING")
      ).toBe(true);
      expect(await count("awcms_hr_attendance_events")).toBe(2);
    });

    test("validation: a reason is mandatory, an add has no target, a replace needs one, no location field exists", async () => {
      if (!handlerReady) return;
      const { worker } = await setup();
      const base = { employmentId: worker.employmentId };

      for (const body of [
        { ...base, reason: "" },
        { ...base, reason: "   " },
        { ...base, reason: "x".repeat(501) },
        { ...base, reason: undefined },
        { ...base, kind: "replace" },
        { ...base, kind: "add", targetEventId: crypto.randomUUID() },
        { ...base, kind: "delete" },
        { ...base, latitude: 1 },
        { ...base, proposedOccurredAt: "yesterday" }
      ]) {
        const refused = await requestCorrection(body, worker.token);

        expect(refused.status).toBe(400);
        expect(refused.body.error!.code).toBe("VALIDATION_ERROR");
      }

      expect(await count("awcms_hr_attendance_corrections")).toBe(0);
      expect(await count("awcms_workflow_instances")).toBe(0);
    });

    test("a proposed instant beyond the tenant skew is refused at request (422, nothing created), by the same rule as an event; within the skew it is accepted", async () => {
      if (!handlerReady) return;
      const { worker } = await setup();
      const before = await count("awcms_hr_attendance_corrections");

      const future = await requestCorrection(
        { employmentId: worker.employmentId, proposedOccurredAt: iso(900) },
        worker.token
      );

      expect(future.status).toBe(422);
      expect(future.body.error!.code).toBe("ATTENDANCE_TIME_IN_FUTURE");
      expect(await count("awcms_hr_attendance_corrections")).toBe(before);
      expect(await count("awcms_workflow_instances")).toBe(0);
      // It is the same code, and the same verdict, as the event path's.
      expect(
        (
          await clock(
            worker.employmentId,
            { occurredAt: iso(900) },
            worker.token
          )
        ).body.error!.code
      ).toBe("ATTENDANCE_TIME_IN_FUTURE");

      // Inside the default skew (300 s) it is accepted, like an event would be.
      const near = await requestCorrection(
        { employmentId: worker.employmentId, proposedOccurredAt: iso(120) },
        worker.token
      );

      expect(near.status).toBe(201);

      // A stricter tenant skew bites a correction as it does an event.
      expect(
        (
          await call(putSettings, {
            method: "PUT",
            path: "/api/v1/hr-workforce/settings",
            body: { clockSkewSeconds: 5 }
          })
        ).status
      ).toBe(200);
      const strict = await requestCorrection(
        { employmentId: worker.employmentId, proposedOccurredAt: iso(60) },
        worker.token
      );

      expect(strict.status).toBe(422);
      expect(strict.body.error!.code).toBe("ATTENDANCE_TIME_IN_FUTURE");
      expect(await count("awcms_hr_attendance_corrections")).toBe(before + 1);
    });

    test("CORRECTION_NOT_APPLICABLE stays reachable only for what changes after the request: a deleted employment, or a skew lowered below the proposal; the correction stays pending and appends nothing", async () => {
      if (!handlerReady) return;
      const { approver, hr, worker } = await setup();

      // (1) Approved, then the employment is soft-deleted before settle.
      const first = await requestCorrection(
        { employmentId: worker.employmentId },
        worker.token
      );
      expect(first.status).toBe(201);
      expect(
        (await decide(first.body.data!.workflowInstanceId, approver.token))
          .status
      ).toBe(200);
      expect(
        (
          await call(deleteEmployment, {
            method: "DELETE",
            path: `/api/v1/hr-workforce/employments/${worker.employmentId}`,
            params: { id: worker.employmentId },
            body: { reason: "entered by mistake" }
          })
        ).status
      ).toBe(200);
      const deleted = await settle(first.body.data!.id, hr.token);

      expect(deleted.status).toBe(409);
      expect(deleted.body.error!.code).toBe("CORRECTION_NOT_APPLICABLE");
      expect(await count("awcms_hr_attendance_events")).toBe(0);
      expect(
        (await readCorrection(first.body.data!.id, hr.token)).body.data!.status
      ).toBe("pending");

      // (2) A proposal inside the skew at request, the skew lowered before settle.
      const second = await employee("second", [
        "hr_workforce.corrections.create"
      ]);
      const near = await requestCorrection(
        { employmentId: second.employmentId, proposedOccurredAt: iso(120) },
        second.token
      );
      expect(near.status).toBe(201);
      expect(
        (await decide(near.body.data!.workflowInstanceId, approver.token))
          .status
      ).toBe(200);
      expect(
        (
          await call(putSettings, {
            method: "PUT",
            path: "/api/v1/hr-workforce/settings",
            body: { clockSkewSeconds: 5 }
          })
        ).status
      ).toBe(200);
      const lowered = await settle(near.body.data!.id, hr.token);

      expect(lowered.status).toBe(409);
      expect(lowered.body.error!.code).toBe("CORRECTION_NOT_APPLICABLE");
      expect(await count("awcms_hr_attendance_events")).toBe(0);
      expect(
        (await readCorrection(near.body.data!.id, hr.token)).body.data!.status
      ).toBe("pending");
    });

    test("SoD covers the SUBJECT: the employee a colleague filed a correction about cannot approve it (directly, as a delegator, or by settling it), and a re-link sheds nothing", async () => {
      if (!handlerReady) return;
      const other = await seedUser(env.tenantId, "other", [WORKFLOW_DECIDE]);
      const hr = await seedUser(env.tenantId, "hr", [
        "hr_workforce.corrections.approve",
        "hr_workforce.corrections.read",
        "hr_workforce.attendance.read"
      ]);
      const subject = await employee("subject", [
        "hr_workforce.clock.create",
        "hr_workforce.corrections.approve",
        WORKFLOW_DECIDE
      ]);
      // A colleague files it FOR the subject (the record-for-others power).
      const colleague = await employee("colleague", [
        "hr_workforce.corrections.create",
        "hr_workforce.attendance.create"
      ]);
      await publishWorkflow([subject.tenantUserId, other.tenantUserId]);
      const file = async () =>
        (
          await requestCorrection(
            { employmentId: subject.employmentId },
            colleague.token
          )
        ).body.data!;
      const refusedAndPending = async (id: string, token: string) => {
        const refused = await settle(id, token);

        expect(refused.status).toBe(409);
        expect(refused.body.error!.code).toBe("CORRECTION_SELF_APPROVED");
        expect((await readCorrection(id, hr.token)).body.data!.status).toBe(
          "pending"
        );
        expect(await count("awcms_hr_attendance_events")).toBe(0);
      };

      // (1) The subject approves in the workflow themself.
      const direct = await file();
      expect(
        (await decide(direct.workflowInstanceId, subject.token)).status
      ).toBe(200);
      await refusedAndPending(direct.id, hr.token);

      // (2) A delegate acted on the subject's behalf.
      const delegated = await file();
      expect(
        (await decide(delegated.workflowInstanceId, other.token)).status
      ).toBe(200);
      await forgeDecisionOnBehalfOf(
        await taskOf(delegated.workflowInstanceId),
        subject.tenantUserId
      );
      await refusedAndPending(delegated.id, hr.token);

      // (3) Another approved it, but the SUBJECT tries to settle it.
      const settledBySubject = await file();
      expect(
        (await decide(settledBySubject.workflowInstanceId, other.token)).status
      ).toBe(200);
      await refusedAndPending(settledBySubject.id, subject.token);

      // (4) The subject approved; the employment is re-linked to another login
      // before the settle: the request-time snapshot still excludes them.
      const relinked = await file();
      expect(
        (await decide(relinked.workflowInstanceId, subject.token)).status
      ).toBe(200);
      // A second login of the SAME person: the link guard (#979) admits no other.
      const successor = await seedUser(
        env.tenantId,
        "successor",
        [],
        subject.profileId
      );
      await admin()`
        UPDATE awcms_hr_employments SET tenant_user_id = ${successor.tenantUserId}
        WHERE id = ${subject.employmentId}`;
      await refusedAndPending(relinked.id, hr.token);

      // (5) Control: an unrelated approver settles normally (no manager-chain rule).
      const fine = await file();
      expect((await decide(fine.workflowInstanceId, other.token)).status).toBe(
        200
      );
      const done = await settle(fine.id, hr.token);

      expect(done.status).toBe(200);
      expect(done.body.data!.status).toBe("approved");
      expect(done.body.data!.decidedBy).toBe(other.tenantUserId);
    });

    test("a workflow seat that was reassigned or skipped no longer sees the sensitive reason; a pending or decided seat does", async () => {
      if (!handlerReady) return;
      const { approver, worker } = await setup();
      const created = (
        await requestCorrection(
          { employmentId: worker.employmentId },
          worker.token
        )
      ).body.data!;
      const seat = async (status: string) => {
        const taskId = await taskOf(created.workflowInstanceId);

        // A seat flipped in any direction is a state the engine never makes
        // (sql/301 guards seat moves); it is a maintenance-level fixture.
        await admin().begin(async (tx) => {
          await tx.unsafe("SET LOCAL session_replication_role = replica");
          await tx`
            UPDATE awcms_workflow_task_assignments SET status = ${status}
            WHERE tenant_id = ${env.tenantId}
              AND tenant_user_id = ${approver.tenantUserId}
              AND workflow_task_id = ${taskId}`;
        });

        return readCorrection(created.id, approver.token);
      };

      const live = await seat("pending");

      expect(live.status).toBe(200);
      expect(live.body.data!.reason).toBe(REASON);

      for (const status of ["reassigned", "skipped"]) {
        const gone = await seat(status);

        expect(gone.status).toBe(403);
        expect(JSON.stringify(gone.body)).not.toContain("SENTINEL");
      }

      const decided = await seat("decided");

      expect(decided.status).toBe(200);
      expect(decided.body.data!.reason).toBe(REASON);
    });

    test("the reason never leaves the correction's own row: not in audit, the workflow store, domain events or any response but the permitted ones", async () => {
      if (!handlerReady) return;
      const { approver, hr, worker } = await setup();
      const original = (await clock(worker.employmentId, {}, worker.token)).body
        .data!;
      const a = (
        await requestCorrection(
          {
            employmentId: worker.employmentId,
            kind: "replace",
            targetEventId: original.id
          },
          worker.token
        )
      ).body.data!;
      const b = (
        await requestCorrection(
          { employmentId: worker.employmentId },
          worker.token
        )
      ).body.data!;

      await decide(a.workflowInstanceId, approver.token);
      const settledResponse = await settle(a.id, hr.token);
      await withdraw(b.id, worker.token);

      const audit = (await admin()`
        SELECT action, severity, message, attributes::text AS attributes
        FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId} AND module_key = 'hr_workforce'
          AND action LIKE 'hr_workforce.attendance_correction.%'
        ORDER BY created_at, id
      `) as {
        action: string;
        severity: string;
        message: string;
        attributes: string;
      }[];

      expect(audit.map((r) => r.action)).toEqual([
        "hr_workforce.attendance_correction.requested",
        "hr_workforce.attendance_correction.requested",
        "hr_workforce.attendance_correction.settled",
        "hr_workforce.attendance_correction.withdrawn"
      ]);
      expect(audit.find((r) => r.action.endsWith("settled"))!.severity).toBe(
        "warning"
      );

      // Search EVERY table that could have captured it, by text.
      const haystacks = [
        (await admin()`SELECT to_jsonb(t)::text AS x FROM awcms_audit_events t WHERE tenant_id = ${env.tenantId}`) as {
          x: string;
        }[],
        (await admin()`SELECT to_jsonb(t)::text AS x FROM awcms_workflow_instances t WHERE tenant_id = ${env.tenantId}`) as {
          x: string;
        }[],
        (await admin()`SELECT to_jsonb(t)::text AS x FROM awcms_workflow_tasks t WHERE tenant_id = ${env.tenantId}`) as {
          x: string;
        }[],
        (await admin()`SELECT to_jsonb(t)::text AS x FROM awcms_workflow_decisions t WHERE tenant_id = ${env.tenantId}`) as {
          x: string;
        }[],
        (await admin()`SELECT to_jsonb(t)::text AS x FROM awcms_domain_events t WHERE tenant_id = ${env.tenantId}`) as {
          x: string;
        }[],
        (await admin()`SELECT to_jsonb(t)::text AS x FROM awcms_idempotency_keys t WHERE tenant_id = ${env.tenantId}`) as {
          x: string;
        }[]
      ];

      // No write response carries the reason, so even the idempotency store (which
      // keeps stored responses) holds none: it exists nowhere but the row itself.
      expect(
        haystacks.flat().filter((row) => row.x.includes("SENTINEL"))
      ).toEqual([]);
      const own = (await admin()`
        SELECT count(*)::int AS n FROM awcms_hr_attendance_corrections
        WHERE reason LIKE '%SENTINEL%'
      `) as { n: number }[];

      expect(own[0]!.n).toBe(2);
      expect(JSON.stringify(audit)).not.toContain("SENTINEL");
      expect(JSON.stringify(settledResponse.body)).not.toContain("SENTINEL");
    });
  });
});
