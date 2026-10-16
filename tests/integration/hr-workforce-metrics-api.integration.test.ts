/**
 * The workforce metrics HTTP surface, driven through the REAL route handlers
 * against a real PostgreSQL (Issue #953, `docs/awcms/workforce-metrics.md`) --
 * WORLD-2 of the harness.
 *
 * Proves who sees whose facts:
 *   * default-deny: no token is 401; a user holding neither permission is 403 on
 *     the list (no flag) and on the aggregate;
 *   * an employee (`?mine=true`, no permission) sees ONLY their own facts, and
 *     naming a colleague's employment id is 403 -- the same answer as for an id
 *     that does not exist, so a refusal reveals nothing;
 *   * a supervisor (`?reports=true`, no permission) sees ONLY direct reports --
 *     not a skip-level report, not a peer, not themselves unless they are their
 *     own manager; a login linked to nobody sees an empty list;
 *   * the two flags cannot be combined and an unlinked/other caller cannot widen
 *     the basis by passing a foreign `employmentId`;
 *   * HR (`workforce_metrics.read`) sees every employee;
 *   * the aggregate holder (`workforce_metrics.analyze`) sees per-office figures
 *     and NO individual row, a group under five contributors carries no number,
 *     and holding `analyze` does not open the individual list;
 *   * every answer is `Cache-Control: private, no-store`, carries the governance
 *     notice and has no score, rank, device, photo or location key anywhere.
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
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as createEmployment } from "../../src/pages/api/v1/hr-workforce/employments/index";
import { PUT as assignAccount } from "../../src/pages/api/v1/hr-workforce/employments/[id]/account";
import { GET as listEmployees } from "../../src/pages/api/v1/hr-workforce/workforce-metrics/employees";
import { GET as listGroups } from "../../src/pages/api/v1/hr-workforce/workforce-metrics/groups";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";

type Env = { tenantId: string; token: string; hqOfficeId: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

type Facts = Record<string, number | null>;
type EmployeesBody = {
  contractVersion: number;
  window: { from: string; to: string };
  governance: string;
  employees: { employmentId: string; employeeNo: string; facts: Facts }[];
  nextCursor: string | null;
};
type GroupsBody = {
  contractVersion: number;
  window: { from: string; to: string; bucket: string };
  governance: string;
  suppression: { minContributors: number };
  groups: {
    officeId?: string | null;
    suppressed: boolean;
    reason?: string;
    contributorsBand?: string;
    facts?: Facts;
  }[];
};

let env: Env;
let userCounter = 0;
let numberCounter = 0;

const admin = () => getHandlerAdminSql();

/** Three days ago at 00:00 UTC: inside the seven-day replay bound for every event below. */
const DAY = new Date();
DAY.setUTCHours(0, 0, 0, 0);
DAY.setUTCDate(DAY.getUTCDate() - 3);

const at = (hours: number, minutes = 0): string =>
  new Date(DAY.getTime() + (hours * 60 + minutes) * 60_000).toISOString();
const QUERY = `from=${at(0).replace(/\.000Z$/, "Z")}&to=${at(24).replace(/\.000Z$/, "Z")}`;

/** The most recent CLOSED ISO week (Monday 00:00Z to the next Monday): the only kind of window the aggregate accepts. */
const WEEK_START = new Date();
WEEK_START.setUTCHours(0, 0, 0, 0);
WEEK_START.setUTCDate(
  WEEK_START.getUTCDate() - ((WEEK_START.getUTCDay() + 6) % 7) - 7
);
const WEEK_END = new Date(WEEK_START.getTime() + 7 * 24 * 3_600_000);
const iso = (date: Date) => date.toISOString().replace(/\.000Z$/, "Z");
const GROUP_QUERY = `from=${iso(WEEK_START)}&to=${iso(WEEK_END)}`;
/** A Tuesday of that week: the day the aggregate tests put their shifts on. */
const WEEK_DAY = new Date(WEEK_START.getTime() + 24 * 3_600_000);

/** Fixture statements a superuser maintenance session makes (guards off). */
async function maintenance(fn: (tx: Bun.TransactionSQL) => Promise<unknown>) {
  await admin().begin(async (tx) => {
    await tx.unsafe("SET LOCAL session_replication_role = replica");
    await fn(tx);
  });
}

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "wm-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Metrics Co",
      tenantCode: "wm-co",
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

  const office = (await admin()`
    SELECT id FROM awcms_offices WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  return {
    tenantId,
    token: login.body.data.token,
    hqOfficeId: office[0]!.id
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
): Promise<{ token: string; tenantUserId: string; profileId: string }> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profileId =
    existingProfileId ?? (await seedProfile(tenantId, `user-${tag}`));
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profileId}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  const token = `wm-${tag}-${Math.random().toString(36).slice(2)}`;

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

  return { token, tenantUserId: tenantUser[0]!.id, profileId };
}

function call<T = unknown>(
  handler: Parameters<typeof invoke>[0],
  options: { path: string; query?: string; token?: string | null }
) {
  const token = options.token === undefined ? env.token : options.token;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-awcms-tenant-id": env.tenantId
  };

  if (token) headers.authorization = `Bearer ${token}`;

  return invoke<Envelope<T>>(handler, {
    path: options.query ? `${options.path}?${options.query}` : options.path,
    headers,
    locals: { correlationId: "corr-api-953" }
  });
}

function employees(query: string, token?: string | null) {
  return call<EmployeesBody>(listEmployees, {
    path: "/api/v1/hr-workforce/workforce-metrics/employees",
    query: `${QUERY}${query ? `&${query}` : ""}`,
    token
  });
}

function groups(query = QUERY, token?: string | null) {
  return call<GroupsBody>(listGroups, {
    path: "/api/v1/hr-workforce/workforce-metrics/groups",
    query,
    token
  });
}

async function hire(
  tag: string,
  options: {
    managerId?: string;
    officeId?: string;
    profileId?: string;
  } = {}
): Promise<string> {
  const profileId =
    options.profileId ?? (await seedProfile(env.tenantId, `emp-${tag}`));
  numberCounter += 1;
  const response = await invoke<Envelope<{ id: string }>>(createEmployment, {
    method: "POST",
    path: "/api/v1/hr-workforce/employments",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": env.tenantId,
      authorization: `Bearer ${env.token}`,
      "idempotency-key": `hire-${numberCounter}-${crypto.randomUUID()}`
    },
    body: {
      profileId,
      employeeNo: `M-${numberCounter}`,
      hiredOn: "2026-01-05",
      employmentType: "permanent",
      status: "active",
      ...(options.managerId ? { managerEmploymentId: options.managerId } : {}),
      ...(options.officeId ? { officeId: options.officeId } : {})
    }
  });
  expect(response.status).toBe(201);

  return response.body.data!.id;
}

async function link(employmentId: string, tenantUserId: string) {
  const response = await invoke<Envelope>(assignAccount, {
    method: "PUT",
    path: `/api/v1/hr-workforce/employments/${employmentId}/account`,
    params: { id: employmentId },
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": env.tenantId,
      authorization: `Bearer ${env.token}`,
      "idempotency-key": `link-${numberCounter}-${crypto.randomUUID()}`
    },
    body: { tenantUserId }
  });
  expect(response.status).toBe(200);
}

/** An employee WITH a login (no permission): the viewer of their own facts. */
async function employee(
  label: string,
  options: { managerId?: string; officeId?: string } = {}
) {
  const user = await seedUser(env.tenantId, label, []);
  const employmentId = await hire(label, {
    ...options,
    profileId: user.profileId
  });

  await link(employmentId, user.tenantUserId);

  return { ...user, employmentId };
}

/**
 * One published work shift, with a punctual clock-in and clock-out, on `day`
 * (default: three days ago). Events are written with the guards off so the day
 * can be older than the seven-day replay bound.
 */
async function workedDay(
  employmentId: string,
  options: { late?: boolean; day?: Date; hours?: number } = {}
) {
  const sql = admin();
  const day = options.day ?? DAY;
  const hours = options.hours ?? 8;
  const hm = (h: number, m = 0) =>
    new Date(day.getTime() + (h * 60 + m) * 60_000).toISOString();
  const shiftRow = (await sql`
    INSERT INTO awcms_hr_shift_assignments
      (tenant_id, employment_id, kind, starts_at, ends_at, time_zone)
    VALUES (${env.tenantId}, ${employmentId}, 'work', ${hm(8)}::timestamptz,
            ${hm(8 + hours)}::timestamptz, 'Asia/Jakarta')
    RETURNING id
  `) as { id: string }[];

  await sql`
    UPDATE awcms_hr_shift_assignments
    SET status = 'published', published_at = now()
    WHERE id = ${shiftRow[0]!.id}
  `;
  numberCounter += 1;
  const key = numberCounter;
  await maintenance(
    (tx) => tx`
      INSERT INTO awcms_hr_attendance_events
        (tenant_id, employment_id, kind, occurred_at, source, client_event_key)
      VALUES
        (${env.tenantId}, ${employmentId}, 'clock_in',
         ${options.late ? hm(8, 30) : hm(8)}::timestamptz, 'kiosk',
         ${`in-${key}-${crypto.randomUUID()}`}),
        (${env.tenantId}, ${employmentId}, 'clock_out',
         ${hm(8 + hours)}::timestamptz, 'kiosk',
         ${`out-${key}-${crypto.randomUUID()}`})
    `
  );
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("hr_workforce workforce metrics HTTP surface (Issue #953)", () => {
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

  test("default-deny: no token is 401; a user holding neither permission is 403 on the list and the aggregate", async () => {
    if (!handlerReady) return;
    const nobody = await seedUser(env.tenantId, "nobody", []);

    expect((await employees("", null)).status).toBe(401);
    expect((await groups(QUERY, null)).status).toBe(401);
    expect((await employees("", nobody.token)).status).toBe(403);
    expect((await groups(QUERY, nobody.token)).status).toBe(403);
  });

  test("an employee sees ONLY their own facts; a colleague's employment id is 403, same as one that does not exist", async () => {
    if (!handlerReady) return;
    const alice = await employee("alice");
    const bob = await employee("bob");

    await workedDay(alice.employmentId, { late: true });
    await workedDay(bob.employmentId);

    const own = await employees("mine=true", alice.token);

    expect(own.status).toBe(200);
    expect(own.body.data!.employees.map((row) => row.employmentId)).toEqual([
      alice.employmentId
    ]);
    expect(own.body.data!.employees[0]!.facts).toMatchObject({
      scheduledShifts: 1,
      attendedShifts: 1,
      lateArrivals: 1,
      workedMinutes: 7 * 60 + 30
    });

    const colleague = await employees(
      `mine=true&employmentId=${bob.employmentId}`,
      alice.token
    );
    const missing = await employees(
      `mine=true&employmentId=${crypto.randomUUID()}`,
      alice.token
    );

    expect(colleague.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(colleague.body.error!.code).toBe(missing.body.error!.code);
    expect(JSON.stringify(colleague.body)).not.toContain("workedMinutes");

    // Without a flag and without the permission there is no way in at all.
    expect((await employees("", alice.token)).status).toBe(403);
    expect(
      (await employees(`employmentId=${bob.employmentId}`, alice.token)).status
    ).toBe(403);
  });

  test("a supervisor sees ONLY direct reports: not a skip-level, a peer, or an outsider", async () => {
    if (!handlerReady) return;
    const boss = await employee("boss");
    const lead = await employee("lead", { managerId: boss.employmentId });
    const peer = await employee("peer", { managerId: boss.employmentId });
    const skip = await employee("skip", { managerId: lead.employmentId });
    const outsider = await employee("outsider");

    for (const person of [boss, lead, peer, skip, outsider]) {
      await workedDay(person.employmentId);
    }

    const ids = async (query: string, token: string) =>
      ((await employees(query, token)).body.data?.employees ?? [])
        .map((row) => row.employmentId)
        .sort();

    expect(await ids("reports=true", boss.token)).toEqual(
      [lead.employmentId, peer.employmentId].sort()
    );
    // The lead's only direct report is `skip`; boss's whole chain is NOT used.
    expect(await ids("reports=true", lead.token)).toEqual([skip.employmentId]);
    // The skip-level person, a peer and an outsider are refused by id.
    for (const target of [skip, outsider, boss]) {
      expect(
        (
          await employees(
            `reports=true&employmentId=${target.employmentId}`,
            boss.token
          )
        ).status
      ).toBe(403);
    }
    // Someone with no reports sees an empty list, not an error and not others.
    expect(await ids("reports=true", skip.token)).toEqual([]);
    // Holding no permission, a supervisor still cannot read the general list.
    expect((await employees("", boss.token)).status).toBe(403);
  });

  test("a login linked to no employment sees an empty list; mine and reports cannot be combined", async () => {
    if (!handlerReady) return;
    const unlinked = await seedUser(env.tenantId, "unlinked", []);
    const someone = await employee("someone");

    await workedDay(someone.employmentId);

    for (const flag of ["mine=true", "reports=true"]) {
      const response = await employees(flag, unlinked.token);

      expect(response.status).toBe(200);
      expect(response.body.data!.employees).toEqual([]);
    }

    // Malformed input is judged AFTER entitlement: a caller who is entitled to
    // nothing gets the same 403 whatever they send, so a refusal does not
    // become a probe. An entitled caller (HR) gets the 400.
    const hr = await seedUser(env.tenantId, "hr0", [
      "hr_workforce.workforce_metrics.read"
    ]);

    expect(
      (await employees("mine=true&reports=true", someone.token)).status
    ).toBe(403);
    expect((await employees("mine=true&reports=true", hr.token)).status).toBe(
      400
    );
    expect((await employees("mine=maybe", hr.token)).status).toBe(400);
  });

  test("HR (workforce_metrics.read) sees every employee", async () => {
    if (!handlerReady) return;
    const hr = await seedUser(env.tenantId, "hr", [
      "hr_workforce.workforce_metrics.read"
    ]);
    const a = await employee("a");
    const b = await employee("b");

    await workedDay(a.employmentId);
    await workedDay(b.employmentId);

    const all = await employees("", hr.token);

    expect(all.status).toBe(200);
    expect(
      all.body.data!.employees.map((row) => row.employmentId).sort()
    ).toEqual([a.employmentId, b.employmentId].sort());

    // M3 (Issue #1083): the all-employee read leaves ONE sensitive-read audit
    // row naming the employments and the count, never a figure.
    const rows = (await admin()`
      SELECT actor_tenant_user_id, severity, attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId}
        AND action = 'sensitive_read.workforce_metrics'
    `) as {
      actor_tenant_user_id: string;
      severity: string;
      attributes: Record<string, unknown> | string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_tenant_user_id).toBe(hr.tenantUserId);

    const attributes =
      typeof rows[0]!.attributes === "string"
        ? JSON.parse(rows[0]!.attributes)
        : rows[0]!.attributes;

    expect((attributes.resourceIds as string[]).sort()).toEqual(
      [a.employmentId, b.employmentId].sort()
    );
    expect(attributes.callItemCount).toBe(2);
    expect(JSON.stringify(rows[0])).not.toContain("workedMinutes");

    // A second read in the window is coalesced: still one audit row.
    await employees("", hr.token);
    expect(
      (
        (await admin()`
          SELECT count(*)::int AS count FROM awcms_audit_events
          WHERE tenant_id = ${env.tenantId}
            AND action = 'sensitive_read.workforce_metrics'
        `) as { count: number }[]
      )[0]!.count
    ).toBe(1);
  });

  test("an employee's OWN read is not recorded; a supervisor's reports read is, with mode reports (M-2)", async () => {
    if (!handlerReady) return;
    const boss = await employee("sra-boss");

    await workedDay(boss.employmentId);
    expect((await employees("mine=true", boss.token)).status).toBe(200);

    const rowsOf = async () =>
      (await admin()`
        SELECT attributes FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId}
          AND action = 'sensitive_read.workforce_metrics'
      `) as { attributes: Record<string, unknown> | string }[];

    expect(await rowsOf()).toHaveLength(0);
    expect((await employees("reports=true", boss.token)).status).toBe(200);

    const rows = await rowsOf();

    expect(rows).toHaveLength(1);

    const attributes =
      typeof rows[0]!.attributes === "string"
        ? JSON.parse(rows[0]!.attributes)
        : rows[0]!.attributes;

    expect(attributes.mode).toBe("reports");
  });

  test("L-1: an .analyze-only aggregate read is recorded as the analyze permission, not read", async () => {
    if (!handlerReady) return;
    const analyst = await seedUser(env.tenantId, "analyst-l1", [
      "hr_workforce.workforce_metrics.analyze"
    ]);

    await workedDay(await hire("l1", { officeId: env.hqOfficeId }), {
      day: WEEK_DAY
    });
    expect((await groups(GROUP_QUERY, analyst.token)).status).toBe(200);

    const rows = (await admin()`
      SELECT action, attributes FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND action LIKE 'sensitive_read.workforce_metrics%'
    `) as { action: string; attributes: Record<string, unknown> | string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("sensitive_read.workforce_metrics_aggregate");

    const attributes =
      typeof rows[0]!.attributes === "string"
        ? JSON.parse(rows[0]!.attributes)
        : rows[0]!.attributes;

    expect(attributes.permission).toBe(
      "hr_workforce.workforce_metrics.analyze"
    );
  });

  test("the aggregate read is audited under the same kind with a group count and no ids", async () => {
    if (!handlerReady) return;
    const hr = await seedUser(env.tenantId, "hr-agg", [
      "hr_workforce.workforce_metrics.read"
    ]);

    await workedDay(await hire("agg", { officeId: env.hqOfficeId }), {
      day: WEEK_DAY
    });
    expect((await groups(GROUP_QUERY, hr.token)).status).toBe(200);

    const rows = (await admin()`
      SELECT attributes FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId}
        AND action = 'sensitive_read.workforce_metrics'
    `) as { attributes: Record<string, unknown> | string }[];

    expect(rows).toHaveLength(1);

    const attributes =
      typeof rows[0]!.attributes === "string"
        ? JSON.parse(rows[0]!.attributes)
        : rows[0]!.attributes;

    expect(attributes.resourceIds).toEqual([]);
    expect(attributes.callItemCount).toBe(1);
  });

  test("the aggregate holder sees per-office figures and NO individual; a group under five carries no number", async () => {
    if (!handlerReady) return;
    const analyst = await seedUser(env.tenantId, "analyst", [
      "hr_workforce.workforce_metrics.analyze"
    ]);
    const second = (await admin()`
      INSERT INTO awcms_offices (tenant_id, office_code, office_name)
      VALUES (${env.tenantId}, 'branch', 'Branch') RETURNING id
    `) as { id: string }[];

    for (let index = 0; index < 5; index += 1) {
      await workedDay(await hire(`hq-${index}`, { officeId: env.hqOfficeId }), {
        day: WEEK_DAY
      });
    }
    for (let index = 0; index < 4; index += 1) {
      await workedDay(await hire(`br-${index}`, { officeId: second[0]!.id }), {
        day: WEEK_DAY
      });
    }

    const response = await groups(GROUP_QUERY, analyst.token);

    expect(response.status).toBe(200);
    expect(response.body.data!.suppression.minContributors).toBe(5);

    const hq = response.body.data!.groups.find(
      (group) => group.officeId === env.hqOfficeId
    )!;
    const withheld = response.body.data!.groups.filter(
      (group) => group.suppressed
    );

    expect(hq.suppressed).toBe(false);
    expect(hq.contributorsBand).toBe("5-9");
    expect(JSON.stringify(hq)).not.toContain('"contributors"');
    expect(hq.facts).toMatchObject({
      scheduledShifts: 5,
      attendedShifts: 5,
      coverageRatio: 1,
      workedMinutes: 5 * 8 * 60
    });
    // L2 (Issue #1083): a withheld group does not name its office, and the
    // shown groups come first.
    expect(withheld).toEqual([{ suppressed: true, reason: "small_group" }]);
    expect(JSON.stringify(response.body)).not.toContain(second[0]!.id);
    expect(response.body.data!.groups[0]!.suppressed).toBe(false);
    // No individual row anywhere in the answer, and holding `analyze` does not
    // open the individual list.
    expect(JSON.stringify(response.body)).not.toContain("employmentId");
    expect(JSON.stringify(response.body)).not.toContain("employeeNo");
    expect((await employees("", analyst.token)).status).toBe(403);
  });

  test("H1: only whole closed ISO weeks are aggregate windows; misaligned windows are 400 and a repeat read cannot differ", async () => {
    if (!handlerReady) return;
    const analyst = await seedUser(env.tenantId, "analyst2", [
      "hr_workforce.workforce_metrics.analyze"
    ]);

    for (let index = 0; index < 5; index += 1) {
      await workedDay(await hire(`w-${index}`, { officeId: env.hqOfficeId }), {
        day: WEEK_DAY
      });
    }

    const week = await groups(GROUP_QUERY, analyst.token);
    const sub = (from: Date, to: Date) =>
      groups(`from=${iso(from)}&to=${iso(to)}`, analyst.token);
    const hour = 3_600_000;

    expect(week.status).toBe(200);
    expect(week.body.data!.window).toMatchObject({ bucket: "iso_week" });

    // The differencing attack needs windows that differ by a tail slice. Every
    // one of them is refused: a day short, a second short, a Tuesday start, a
    // shifted week, a fortnight, a single day.
    for (const [from, to] of [
      [WEEK_START, new Date(WEEK_END.getTime() - 24 * hour)],
      [WEEK_START, new Date(WEEK_END.getTime() - 1000)],
      [
        new Date(WEEK_START.getTime() + 24 * hour),
        new Date(WEEK_END.getTime() + 24 * hour)
      ],
      [
        new Date(WEEK_START.getTime() + hour),
        new Date(WEEK_END.getTime() + hour)
      ],
      [WEEK_START, new Date(WEEK_END.getTime() + 7 * 24 * hour)],
      [WEEK_START, new Date(WEEK_START.getTime() + 24 * hour)],
      // A whole calendar month: month minus the weeks inside it is the attack.
      [
        new Date(
          Date.UTC(WEEK_START.getUTCFullYear(), WEEK_START.getUTCMonth(), 1)
        ),
        new Date(
          Date.UTC(WEEK_START.getUTCFullYear(), WEEK_START.getUTCMonth() + 1, 1)
        )
      ]
    ] as const) {
      expect((await sub(from, to)).status).toBe(400);
    }

    // A bucket still in progress is refused as well: its sums grow with the clock.
    const thisWeek = new Date(WEEK_END);
    expect(
      (await sub(thisWeek, new Date(thisWeek.getTime() + 7 * 24 * hour))).status
    ).toBe(400);

    // Add a sixth contributor AFTER the first read: the same bucket now changes,
    // but only by a whole person's whole bucket, and the band does not move.
    await workedDay(await hire("w-victim", { officeId: env.hqOfficeId }), {
      day: WEEK_DAY
    });
    const after = await groups(GROUP_QUERY, analyst.token);
    const hq = (r: typeof week) =>
      r.body.data!.groups.find((g) => g.officeId === env.hqOfficeId)!;

    expect(hq(after).contributorsBand).toBe(hq(week).contributorsBand);
  });

  test("H2: planted short shifts do not lift a group over the threshold, and are not summed", async () => {
    if (!handlerReady) return;
    const analyst = await seedUser(env.tenantId, "analyst3", [
      "hr_workforce.workforce_metrics.analyze"
    ]);

    await workedDay(await hire("real", { officeId: env.hqOfficeId }), {
      day: WEEK_DAY
    });
    for (let index = 0; index < 6; index += 1) {
      const planted = await hire(`plant-${index}`, {
        officeId: env.hqOfficeId
      });
      const start = new Date(WEEK_DAY.getTime() + 8 * 3_600_000);
      const end = new Date(start.getTime() + 15 * 60_000);

      await maintenance(async (tx) => {
        await tx`
          INSERT INTO awcms_hr_shift_assignments
            (tenant_id, employment_id, kind, starts_at, ends_at, time_zone,
             status, published_at)
          VALUES (${env.tenantId}, ${planted}, 'work', ${start.toISOString()}::timestamptz,
                  ${end.toISOString()}::timestamptz, 'UTC', 'published', now())`;
        await tx`
          INSERT INTO awcms_hr_attendance_events
            (tenant_id, employment_id, kind, occurred_at, source, client_event_key)
          VALUES
            (${env.tenantId}, ${planted}, 'clock_in', ${start.toISOString()}::timestamptz,
             'kiosk', ${`pin-${index}-${crypto.randomUUID()}`}),
            (${env.tenantId}, ${planted}, 'clock_out', ${end.toISOString()}::timestamptz,
             'kiosk', ${`pout-${index}-${crypto.randomUUID()}`})`;
      });
    }

    const response = await groups(GROUP_QUERY, analyst.token);

    expect(response.body.data!.groups).toEqual([
      { suppressed: true, reason: "small_group" }
    ]);
  });

  test("L1: a supervisor's scope follows the live reporting line", async () => {
    if (!handlerReady) return;
    const boss = await employee("lboss");
    const other = await employee("lother");
    const report = await employee("lreport", { managerId: boss.employmentId });
    const second = await employee("lsecond", { managerId: boss.employmentId });

    await workedDay(report.employmentId);
    await workedDay(second.employmentId);

    const ids = async () =>
      ((await employees("reports=true", boss.token)).body.data?.employees ?? [])
        .map((row) => row.employmentId)
        .sort();

    expect(await ids()).toEqual(
      [report.employmentId, second.employmentId].sort()
    );

    // The facts begin when the reporting line did: move that start to
    // tomorrow-ish and the earlier days are no longer the supervisor's to see.
    const factsOf = async (employmentId: string) =>
      (await employees("reports=true", boss.token)).body.data!.employees.find(
        (row) => row.employmentId === employmentId
      )!.facts;

    expect((await factsOf(report.employmentId)).workedMinutes).toBe(480);
    await maintenance(
      (tx) => tx`
        UPDATE awcms_hr_employment_terms
        SET effective_from = ${iso(new Date(DAY.getTime() + 24 * 3_600_000)).slice(0, 10)}::date
        WHERE tenant_id = ${env.tenantId} AND employment_id = ${report.employmentId}
          AND effective_to IS NULL`
    );
    expect((await factsOf(report.employmentId)).workedMinutes).toBe(0);
    expect((await factsOf(second.employmentId)).workedMinutes).toBe(480);

    // A report re-assigned to someone else is outside the scope: 403 by id.
    await maintenance(
      (tx) => tx`
        UPDATE awcms_hr_employment_terms SET manager_employment_id = ${other.employmentId}
        WHERE tenant_id = ${env.tenantId} AND employment_id = ${report.employmentId}
          AND effective_to IS NULL`
    );
    expect(
      (
        await employees(
          `reports=true&employmentId=${report.employmentId}`,
          boss.token
        )
      ).status
    ).toBe(403);
    expect(await ids()).toEqual([second.employmentId]);

    // A forged cursor or filter cannot reach outside the scope.
    const forged = await employees(
      `reports=true&cursor=${report.employmentId}`,
      boss.token
    );
    expect(forged.status).toBe(200);
    expect(
      forged.body.data!.employees.every(
        (row) => row.employmentId === second.employmentId
      )
    ).toBe(true);
    const mineForged = await employees(
      `mine=true&cursor=00000000-0000-4000-8000-000000000000`,
      boss.token
    );
    expect(
      mineForged.body.data!.employees.every(
        (row) => row.employmentId === boss.employmentId
      )
    ).toBe(true);

    // A soft-deleted report drops out.
    await maintenance(
      (tx) => tx`UPDATE awcms_hr_employments SET deleted_at = now()
                 WHERE id = ${second.employmentId}`
    );
    expect(await ids()).toEqual([]);
  });

  test("L1: a terminated manager sees nobody", async () => {
    if (!handlerReady) return;
    const boss = await employee("tboss");
    const report = await employee("treport", { managerId: boss.employmentId });

    await workedDay(report.employmentId);
    expect(
      (await employees("reports=true", boss.token)).body.data!.employees
    ).toHaveLength(1);

    await maintenance(
      (tx) => tx`UPDATE awcms_hr_employments SET terminated_on = '2026-02-01'
                 WHERE id = ${boss.employmentId}`
    );

    const response = await employees("reports=true", boss.token);

    expect(response.status).toBe(200);
    expect(response.body.data!.employees).toEqual([]);
  });

  test("the holder of read alone may also read the aggregate (still suppressed)", async () => {
    if (!handlerReady) return;
    const hr = await seedUser(env.tenantId, "hr2", [
      "hr_workforce.workforce_metrics.read"
    ]);

    await workedDay(await hire("solo", { officeId: env.hqOfficeId }), {
      day: WEEK_DAY
    });

    const response = await groups(GROUP_QUERY, hr.token);

    expect(response.status).toBe(200);
    expect(response.body.data!.groups).toEqual([
      { suppressed: true, reason: "small_group" }
    ]);
  });

  test("another tenant's data is never visible, even to a holder of the permission", async () => {
    if (!handlerReady) return;
    const hr = await seedUser(env.tenantId, "hr3", [
      "hr_workforce.workforce_metrics.read"
    ]);
    const other = (await admin()`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES ('wm-other', 'Other Co') RETURNING id
    `) as { id: string }[];
    const profile = await seedProfile(other[0]!.id, "foreign");

    await withTenantOrThrow(
      getHandlerDatabaseClient(),
      other[0]!.id,
      (tx) =>
        tx`INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
         VALUES (${other[0]!.id}, ${profile}, 'F-1', '2026-01-01')`
    );

    const response = await employees("", hr.token);

    expect(response.status).toBe(200);
    expect(response.body.data!.employees).toEqual([]);
  });

  test("windows are validated before any read; answers are never cached and carry the governance notice", async () => {
    if (!handlerReady) return;
    const hr = await seedUser(env.tenantId, "hr4", [
      "hr_workforce.workforce_metrics.read"
    ]);

    const noWindow = await call<EmployeesBody>(listEmployees, {
      path: "/api/v1/hr-workforce/workforce-metrics/employees",
      token: hr.token
    });
    const tooLong = await call<EmployeesBody>(listEmployees, {
      path: "/api/v1/hr-workforce/workforce-metrics/employees",
      query: "from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z",
      token: hr.token
    });
    const badCursor = await employees("cursor=nope", hr.token);

    expect(noWindow.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(badCursor.status).toBe(400);

    const ok = await invoke<Envelope<EmployeesBody>>(listEmployees, {
      path: `/api/v1/hr-workforce/workforce-metrics/employees?${QUERY}`,
      headers: {
        "x-awcms-tenant-id": env.tenantId,
        authorization: `Bearer ${hr.token}`
      },
      locals: { correlationId: "corr-api-953" }
    });

    expect(ok.status).toBe(200);
    expect(ok.response.headers.get("cache-control")).toBe("private, no-store");
    expect(ok.body.data!.contractVersion).toBe(1);
    expect(ok.body.data!.governance).toContain("governance review");
  });

  test("no answer carries a score, rank, device, photo or location key", async () => {
    if (!handlerReady) return;
    const hr = await seedUser(env.tenantId, "hr5", [
      "hr_workforce.workforce_metrics.read"
    ]);
    const emp = await employee("scored");

    await workedDay(emp.employmentId);

    const keys = (value: unknown): string[] =>
      value && typeof value === "object"
        ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
        : [];
    const found = [
      ...keys((await employees("", hr.token)).body),
      ...keys((await groups(GROUP_QUERY, hr.token)).body)
    ].map((key) => key.toLowerCase());

    for (const forbidden of [
      "score",
      "rank",
      "rating",
      "grade",
      "risk",
      "photo",
      "biometric",
      "device",
      "latitude",
      "longitude",
      "location",
      "ip"
    ]) {
      expect(found.filter((key) => key === forbidden)).toEqual([]);
    }
  });
});
