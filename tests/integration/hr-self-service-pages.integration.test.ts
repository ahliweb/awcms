/**
 * The self-service, supervisor and HR screens' data loads against a real
 * PostgreSQL, through the SAME `loadAdminScreen` the pages use (Issue #952,
 * security audit H-1 and M-1) -- WORLD-2 of the harness.
 *
 *   * H-1: with a tenant ABAC `deny` on `attendance.read`, the API route
 *     answers 403 for `?mine=true`, and the screen's load must show NO events
 *     either (deny-overrides-allow holds for the page too); likewise for
 *     corrections and workforce metrics, per panel;
 *   * M-1: a supervisor's team load and an HR workforce load write
 *     `sensitive_read` audit rows (mode `reports` / `all`, ids and a count,
 *     never a time), and an employee's own load writes none;
 *   * L-2: the supervisor load reads direct reports only, from when each
 *     reporting line began, not the manager chain.
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
import { loadAdminScreen } from "../../src/lib/auth/admin-screen";
import type { SsrContext } from "../../src/lib/auth/ssr-session";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  loadMyMetrics,
  loadMyWork,
  loadTeam,
  loadWorkforce
} from "../../src/lib/hr-self-service-loaders";
import type { AccessRequest } from "../../src/modules/identity-access/domain/access-control";
import { recordSensitiveRead } from "../../src/modules/logging/application/sensitive-read-audit";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { resetPolicyCache } from "../../src/modules/identity-access/application/policy-cache";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as createPolicyRoute } from "../../src/pages/api/v1/access/policies/index";
import { POST as enablePolicy } from "../../src/pages/api/v1/access/policies/[id]/enable";
import { GET as listEventsRoute } from "../../src/pages/api/v1/hr-workforce/attendance-events/index";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";

type Env = { tenantId: string; token: string; ownerTenantUserId: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "cm-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "CM Co",
      tenantCode: "cm-co",
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
    VALUES (${tenantId}, 'person', ${`User ${tag}`})
    RETURNING id
  `) as { id: string }[];
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
  const token = `cm-${tag}-${Math.random().toString(36).slice(2)}`;

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

  return { token, tenantUserId: tenantUser[0]!.id };
}

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
    locals: { correlationId: "corr-api-951" }
  });
}

let employmentCounter = 0;

async function seedEmployment(tenantUserId: string | null): Promise<string> {
  employmentCounter += 1;
  const sql = admin();
  const profile = (await sql`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${env.tenantId}, 'person', ${`Employee ${employmentCounter}`})
    RETURNING id
  `) as { id: string }[];
  // Arbitrary logins here; the PS-14 link guard (#979) is bypassed for the insert.
  await sql`ALTER TABLE awcms_hr_employments DISABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  let found: { id: string }[];

  try {
    found = (await sql`
      INSERT INTO awcms_hr_employments
        (tenant_id, profile_id, employee_no, hired_on, tenant_user_id)
      VALUES (${env.tenantId}, ${profile[0]!.id}, ${`E-${employmentCounter}`},
              '2026-01-01', ${tenantUserId})
      RETURNING id
    `) as { id: string }[];
  } finally {
    await sql`ALTER TABLE awcms_hr_employments ENABLE TRIGGER awcms_hr_employments_link_guard_insert`;
  }

  return found[0]!.id;
}

/** Create a draft as the owner and publish it as the manager (maker / checker). */
async function addTerm(
  employment: string,
  managerEmployment: string | null
): Promise<void> {
  await admin()`
    INSERT INTO awcms_hr_employment_terms
      (tenant_id, employment_id, manager_employment_id, job_title,
       employment_type, status, effective_from)
    VALUES (${env.tenantId}, ${employment}, ${managerEmployment}, 'Clerk',
            'permanent', 'active', '2026-01-01')
  `;
}

const DAY_MS = 86_400_000;
const SELF = "hr_workforce.self_service.read";
const CREATE_GUARD: AccessRequest = {
  moduleKey: "hr_workforce",
  activityCode: "corrections",
  action: "create"
};
const READ_GUARD = (activityCode: string): AccessRequest => ({
  moduleKey: "hr_workforce",
  activityCode,
  action: "read"
});

type Person = { token: string; tenantUserId: string };

function ssrOf(person: Person): SsrContext {
  return {
    tenantId: env.tenantId,
    tenantUserId: person.tenantUserId,
    tokenHash: hashSessionToken(person.token)
  } as unknown as SsrContext;
}

/** Runs a loader exactly as a page does: entry gate `self_service.read`, then `load`. */
async function screen<T>(
  person: Person,
  load: (context: {
    tx: Bun.SQL;
    tenantUserId: string;
    can: Parameters<typeof loadMyWork>[0]["can"];
  }) => Promise<T>,
  authorize: AccessRequest = {
    moduleKey: "hr_workforce",
    activityCode: "self_service",
    action: "read"
  }
) {
  return loadAdminScreen<T>({
    ssr: ssrOf(person),
    workClass: "interactive",
    authorize,
    sql: getHandlerDatabaseClient(),
    load: ({ tx, auth, can }) =>
      load({ tx, tenantUserId: auth.context.tenantUserId, can }),
    onError: (error) => {
      throw error;
    }
  });
}

function common(context: {
  tx: Bun.SQL;
  tenantUserId: string;
  can: Parameters<typeof loadMyWork>[0]["can"];
}) {
  return {
    tx: context.tx,
    tenantId: env.tenantId,
    tenantUserId: context.tenantUserId,
    can: context.can,
    now: new Date(),
    correlationId: "corr-pages-952"
  };
}

const WINDOW = () => ({
  from: new Date(Date.now() - 7 * DAY_MS),
  to: new Date()
});

async function insertEvent(
  employment: string,
  kind: string,
  agoHours: number
): Promise<void> {
  const sql = admin();

  await sql`ALTER TABLE awcms_hr_attendance_events DISABLE TRIGGER USER`;

  try {
    await sql`
      INSERT INTO awcms_hr_attendance_events
        (tenant_id, employment_id, kind, occurred_at, source, client_event_key)
      VALUES (${env.tenantId}, ${employment}, ${kind},
              date_trunc('minute', now() - make_interval(hours => ${agoHours})),
              'self', ${`k-${kind}-${agoHours}-${crypto.randomUUID()}`})
    `;
  } finally {
    await sql`ALTER TABLE awcms_hr_attendance_events ENABLE TRIGGER USER`;
  }
}

/**
 * A pending correction for an employment, without the workflow chain: the
 * foreign key and the guard triggers are bypassed for the insert only.
 */
async function pendingCorrection(
  employment: string,
  requestedBy: string
): Promise<void> {
  await admin().begin(async (tx) => {
    await tx`SET LOCAL session_replication_role = replica`;
    await tx`
      INSERT INTO awcms_hr_attendance_corrections
        (tenant_id, employment_id, kind, proposed_kind, proposed_occurred_at,
         reason, workflow_instance_id, requested_by)
      VALUES (${env.tenantId}, ${employment}, 'add', 'clock_out',
              now() - interval '2 hours', 'forgot to clock',
              ${crypto.randomUUID()}, ${requestedBy})
    `;
  });
}

async function auditRows(
  tenantUserId: string
): Promise<{ kind: string; attributes: Record<string, unknown> }[]> {
  const rows = (await admin()`
    SELECT action AS kind, attributes
    FROM awcms_audit_events
    WHERE tenant_id = ${env.tenantId} AND actor_tenant_user_id = ${tenantUserId}
      AND action LIKE 'sensitive_read.%'
    ORDER BY created_at
  `) as { kind: string; attributes: Record<string, unknown> }[];

  return rows;
}

async function denyPermission(activity: string, action: string) {
  const owner = {
    "content-type": "application/json",
    "x-awcms-tenant-id": env.tenantId,
    authorization: `Bearer ${env.token}`
  };
  const created = await invoke<{ data: { policy: { id: string } } }>(
    createPolicyRoute,
    {
      method: "POST",
      path: "/api/v1/access/policies",
      headers: owner,
      body: {
        policyCode: `test.deny-${activity}-${action}`,
        effect: "deny",
        moduleKey: "hr_workforce",
        activityCode: activity,
        action,
        conditions: { allOf: [] }
      }
    }
  );

  expect(created.status).toBe(200);

  const id = created.body.data.policy.id;
  const enabled = await invoke(enablePolicy, {
    method: "POST",
    path: `/api/v1/access/policies/${id}/enable`,
    headers: owner,
    params: { id }
  });

  expect(enabled.status).toBe(200);
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite(
  "hr self-service screens: authorisation and read audit (Issue #952)",
  () => {
    let boss: Person;
    let staff: Person;
    let bossEmployment = "";
    let staffEmployment = "";
    let outsider: Person;
    let outsiderEmployment = "";

    beforeAll(async () => {
      handlerReady = await ensureHandlerDatabaseReady();
    });

    afterAll(async () => {
      await teardownHandlerDatabase();
    });

    beforeEach(async () => {
      if (!handlerReady) return;
      await resetHandlerDatabase();
      resetPolicyCache();
      env = await bootstrap();
      boss = await seedUser(env.tenantId, "boss", [SELF]);
      staff = await seedUser(env.tenantId, "staff", [SELF]);
      outsider = await seedUser(env.tenantId, "outsider", [SELF]);
      bossEmployment = await seedEmployment(boss.tenantUserId);
      staffEmployment = await seedEmployment(staff.tenantUserId);
      outsiderEmployment = await seedEmployment(outsider.tenantUserId);
      await addTerm(bossEmployment, null);
      await addTerm(staffEmployment, bossEmployment);
      await addTerm(outsiderEmployment, null);
      await insertEvent(staffEmployment, "clock_in", 30);
      await insertEvent(staffEmployment, "clock_out", 22);
      await insertEvent(outsiderEmployment, "clock_in", 30);
      await pendingCorrection(staffEmployment, staff.tenantUserId);
    });

    test("the baseline: an employee sees their own events and nobody else's, and writes no audit row", async () => {
      if (!handlerReady) return;
      const result = await screen(staff, (c) =>
        loadMyWork({
          ...common(c),
          shiftsTo: new Date(Date.now() + 14 * DAY_MS),
          eventsFrom: new Date(Date.now() - 14 * DAY_MS),
          requestGuard: CREATE_GUARD
        })
      );

      expect(result.state).toBe("allowed");

      if (result.state !== "allowed") return;

      expect(result.data.events.map((e) => e.employmentId)).toEqual([
        staffEmployment,
        staffEmployment
      ]);
      expect(result.data.partial).toBe(false);
      expect(await auditRows(staff.tenantUserId)).toEqual([]);
    });

    test("H-1: an ABAC deny on attendance.read hides the events on the page exactly as it 403s the API", async () => {
      if (!handlerReady) return;
      await denyPermission("attendance", "read");

      const api = await call(listEventsRoute, {
        path: "/api/v1/hr-workforce/attendance-events",
        query: "mine=true",
        token: staff.token
      });

      expect(api.status).toBe(403);

      const result = await screen(staff, (c) =>
        loadMyWork({
          ...common(c),
          shiftsTo: new Date(Date.now() + 14 * DAY_MS),
          eventsFrom: new Date(Date.now() - 14 * DAY_MS),
          requestGuard: CREATE_GUARD
        })
      );

      expect(result.state).toBe("allowed");

      if (result.state !== "allowed") return;

      expect(result.data.events).toEqual([]);
      expect(result.data.partial).toBe(true);
      // Only the denied panel is withheld.
      expect(result.data.employments).toHaveLength(1);
    });

    test("H-1: an ABAC deny on corrections.read and on workforce_metrics.read withholds those panels", async () => {
      if (!handlerReady) return;
      await denyPermission("corrections", "read");
      await denyPermission("workforce_metrics", "read");

      const work = await screen(staff, (c) =>
        loadMyWork({
          ...common(c),
          shiftsTo: new Date(Date.now() + 14 * DAY_MS),
          eventsFrom: new Date(Date.now() - 14 * DAY_MS),
          requestGuard: CREATE_GUARD
        })
      );
      const metrics = await screen(staff, (c) =>
        loadMyMetrics({ ...common(c), range: WINDOW() })
      );
      const team = await screen(boss, (c) =>
        loadTeam({ ...common(c), range: WINDOW() })
      );

      expect(work.state === "allowed" && work.data.partial).toBe(true);
      expect(work.state === "allowed" && work.data.corrections).toEqual([]);
      expect(work.state === "allowed" && work.data.events.length).toBe(2);
      expect(metrics.state === "allowed" && metrics.data).toEqual({
        employees: [],
        withheld: true
      });
      expect(team.state === "allowed" && team.data.employees).toEqual([]);
      expect(team.state === "allowed" && team.data.corrections).toEqual([]);
      expect(team.state === "allowed" && team.data.withheld).toBe(true);
      // The attendance panel was not denied, so the supervisor still sees it.
      expect(team.state === "allowed" && team.data.events.length).toBe(2);
    });

    test("M-1 and L-2: the supervisor sees direct reports only and the read is audited with mode reports", async () => {
      if (!handlerReady) return;
      const result = await screen(boss, (c) =>
        loadTeam({ ...common(c), range: WINDOW() })
      );

      expect(result.state).toBe("allowed");

      if (result.state !== "allowed") return;

      expect(result.data.employees.map((e) => e.employmentId)).toEqual([
        staffEmployment
      ]);
      expect(
        result.data.events.every((e) => e.employmentId === staffEmployment)
      ).toBe(true);
      expect(result.data.events).toHaveLength(2);
      // The unrelated employee's event is not in what the supervisor was handed.
      expect(
        result.data.events.some((e) => e.employmentId === outsiderEmployment)
      ).toBe(false);

      const rows = await auditRows(boss.tenantUserId);
      const kinds = rows.map((row) => row.kind);

      // ALL THREE panels record their own read, so stripping any one fails here.
      expect(result.data.corrections).toHaveLength(1);
      expect(kinds).toContain("sensitive_read.attendance_events");
      expect(kinds).toContain("sensitive_read.workforce_metrics");
      expect(kinds).toContain("sensitive_read.attendance_corrections");
      expect(JSON.stringify(rows)).toContain("reports");
      expect(JSON.stringify(rows)).not.toContain("clock_in");
    });

    test("L-2: events from before the reporting line began are not returned", async () => {
      if (!handlerReady) return;
      // The reporting line began today; an event from before is not the boss's to read.
      await admin()`ALTER TABLE awcms_hr_employment_terms DISABLE TRIGGER USER`;
      await admin()`
      UPDATE awcms_hr_employment_terms SET effective_from = CURRENT_DATE
      WHERE tenant_id = ${env.tenantId} AND employment_id = ${staffEmployment}
    `;
      await admin()`ALTER TABLE awcms_hr_employment_terms ENABLE TRIGGER USER`;
      await insertEvent(staffEmployment, "clock_in", 0);

      const result = await screen(boss, (c) =>
        loadTeam({ ...common(c), range: WINDOW() })
      );

      expect(
        result.state === "allowed" && result.data.events.length
      ).toBeLessThan(3);
      expect(
        result.state === "allowed" &&
          result.data.events.every(
            (e) =>
              new Date(e.occurredAt).getTime() >=
              new Date(
                new Date().toISOString().slice(0, 10) + "T00:00:00Z"
              ).getTime()
          )
      ).toBe(true);
    });

    test("M-1: an HR workforce load is audited in mode all; an employee's own load is not", async () => {
      if (!handlerReady) return;
      const hr = await seedUser(env.tenantId, "hr", [
        "hr_workforce.employments.read",
        "hr_workforce.attendance.read",
        "hr_workforce.corrections.read"
      ]);
      const result = await screen(
        hr,
        (c) =>
          loadWorkforce({
            ...common(c),
            eventsFrom: new Date(Date.now() - 7 * DAY_MS),
            // Mirrors the recorder of src/pages/admin/hr/workforce.astro (the page
            // contract test pins its literal permissions and mode).
            recordRead: (read) =>
              recordSensitiveRead(c.tx, {
                mode: "all",
                tenantId: env.tenantId,
                actorTenantUserId: c.tenantUserId,
                permission: read.permission,
                itemCount: read.itemCount,
                resourceIds: [...new Set(read.employmentIds)]
              }).then(() => undefined),
            guards: {
              corrections: READ_GUARD("corrections"),
              attendance: READ_GUARD("attendance")
            }
          }),
        {
          moduleKey: "hr_workforce",
          activityCode: "employments",
          action: "read"
        }
      );

      expect(result.state).toBe("allowed");

      if (result.state !== "allowed") return;

      expect(result.data.events).toHaveLength(3);
      expect(result.data.employments.length).toBe(3);

      const rows = await auditRows(hr.tenantUserId);

      // BOTH HR panels record their own read, through the page's recorder path.
      expect(result.data.corrections).toHaveLength(1);
      expect(rows.map((row) => row.kind)).toContain(
        "sensitive_read.attendance_events"
      );
      expect(rows.map((row) => row.kind)).toContain(
        "sensitive_read.attendance_corrections"
      );
      expect(JSON.stringify(rows)).toContain('"all"');

      // An employee's own load of the same screens writes nothing.
      await screen(staff, (c) =>
        loadMyMetrics({ ...common(c), range: WINDOW() })
      );
      expect(await auditRows(staff.tenantUserId)).toEqual([]);
    });

    test("M-1 is fail-closed: if the audit cannot be written the load shows nothing", async () => {
      if (!handlerReady) return;
      await admin()`
      ALTER TABLE awcms_audit_events ADD CONSTRAINT w952_block CHECK (action NOT LIKE 'sensitive_read.%') NOT VALID
    `;

      try {
        await expect(
          screen(boss, (c) => loadTeam({ ...common(c), range: WINDOW() }))
        ).rejects.toThrow();
      } finally {
        await admin()`ALTER TABLE awcms_audit_events DROP CONSTRAINT w952_block`;
      }
    });

    test("N-1: a screen's can() cannot widen a write or high-risk action by ownership", async () => {
      if (!handlerReady) return;
      const grant = { granted: true, reason: "owner of the record" };

      for (const guard of [
        {
          moduleKey: "identity_access",
          activityCode: "roles",
          action: "assign"
        },
        {
          moduleKey: "hr_workforce",
          activityCode: "employments",
          action: "update"
        },
        {
          moduleKey: "hr_workforce",
          activityCode: "corrections",
          action: "approve"
        }
      ] as const) {
        // A user holding ONLY the self-service key is refused, loudly.
        await expect(
          screen(staff, (c) => c.can(guard, { ownershipGrant: grant }))
        ).rejects.toThrow(/may only widen a `read` guard/);
        // Without the grant the plain answer is a quiet deny.
        const plain = await screen(staff, (c) => c.can(guard));

        expect(plain.state === "allowed" && plain.data).toBe(false);
      }

      // A read guard with a grant is still honoured for that user ...
      const read = await screen(staff, (c) =>
        c.can(
          {
            moduleKey: "hr_workforce",
            activityCode: "attendance",
            action: "read"
          },
          { ownershipGrant: grant }
        )
      );

      expect(read.state === "allowed" && read.data).toBe(true);

      // ... and an ABAC deny still wins over it.
      await denyPermission("attendance", "read");

      const denied = await screen(staff, (c) =>
        c.can(
          {
            moduleKey: "hr_workforce",
            activityCode: "attendance",
            action: "read"
          },
          { ownershipGrant: grant }
        )
      );

      expect(denied.state === "allowed" && denied.data).toBe(false);
    });

    test("N-3: a supervisor with no reports writes no audit row", async () => {
      if (!handlerReady) return;
      const result = await screen(outsider, (c) =>
        loadTeam({ ...common(c), range: WINDOW() })
      );

      expect(result.state === "allowed" && result.data.employees).toEqual([]);
      expect(await auditRows(outsider.tenantUserId)).toEqual([]);
    });
  }
);
