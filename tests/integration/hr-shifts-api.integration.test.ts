/**
 * The shift and availability HTTP surface, driven through the REAL route
 * handlers against a real PostgreSQL (Issue #946, ADR-0132) — WORLD-2 of the
 * harness.
 *
 * Proves what the unit and database tests cannot: every new permission BITES (a
 * user holding every hr_workforce permission except one is refused that action,
 * a user holding only that one succeeds); default-deny; the draft -> published
 * -> cancelled flow and who can see what; a template resolved across a daylight
 * saving change and then edited without moving the assignment; the overlap
 * refusal naming the other assignment; idempotent replay; employee-sees-own
 * showing PUBLISHED rows only; no audit row carrying a name, a number or a
 * reason; and the port's answer after a publish.
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
import { staffAvailabilityAdapter } from "../../src/modules/hr-workforce/application/staff-availability-adapter";
import { hrWorkforceModule } from "../../src/modules/hr-workforce/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as createEmployment } from "../../src/pages/api/v1/hr-workforce/employments/index";
import { PUT as assignAccount } from "../../src/pages/api/v1/hr-workforce/employments/[id]/account";
import {
  GET as listTemplates,
  POST as createTemplate
} from "../../src/pages/api/v1/hr-workforce/shift-templates/index";
import {
  DELETE as deleteTemplate,
  GET as getTemplate,
  PATCH as patchTemplate
} from "../../src/pages/api/v1/hr-workforce/shift-templates/[id]";
import {
  GET as listAssignments,
  POST as createAssignment
} from "../../src/pages/api/v1/hr-workforce/shift-assignments/index";
import { POST as publishAssignment } from "../../src/pages/api/v1/hr-workforce/shift-assignments/[id]/publish";
import { POST as cancelAssignment } from "../../src/pages/api/v1/hr-workforce/shift-assignments/[id]/cancel";

// Built at runtime: GitGuardian scans every committed literal.
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
  const loginIdentifier = "hr-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "HR Co",
      tenantCode: "hr-co",
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

/** A person (profile) with no login: the subject of an employment. */
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
  permissionKeys: readonly string[]
): Promise<{
  token: string;
  tenantUserId: string;
  profileId: string;
  identityId: string;
}> {
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
  const token = `hr-${tag}-${Math.random().toString(36).slice(2)}`;

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
    locals: { correlationId: "corr-api-946" }
  });
}

let numberCounter = 0;

async function count(table: string): Promise<number> {
  const rows = (await admin()`
    SELECT count(*)::int AS n FROM ${admin().unsafe(table)}
    WHERE tenant_id = ${env.tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

type Template = {
  id: string;
  code: string;
  localStart: string;
  durationMinutes: number;
  timeZone: string;
};

type Assignment = {
  id: string;
  employmentId: string;
  kind: string;
  status: string;
  startsAt: string;
  endsAt: string;
  breakStartsAt: string | null;
  breakEndsAt: string | null;
  timeZone: string;
  templateId: string | null;
  timeOffKind: string | null;
};

const TEMPLATE_BODY = {
  code: "NIGHT",
  name: "Night",
  localStart: "22:00",
  durationMinutes: 480,
  breakOffsetMinutes: 240,
  breakMinutes: 30,
  timeZone: "America/New_York"
};

function newTemplate(body: Record<string, unknown> = {}, token?: string) {
  return call<Template>(createTemplate, {
    method: "POST",
    path: "/api/v1/hr-workforce/shift-templates",
    body: { ...TEMPLATE_BODY, ...body },
    token
  });
}

function newAssignment(
  body: Record<string, unknown>,
  token?: string,
  key?: string | null
) {
  return call<Assignment>(createAssignment, {
    method: "POST",
    path: "/api/v1/hr-workforce/shift-assignments",
    body,
    token,
    idempotencyKey: key
  });
}

function act(
  handler: typeof publishAssignment,
  verb: "publish" | "cancel",
  id: string,
  token?: string,
  key?: string | null
) {
  return call<Assignment>(handler, {
    method: "POST",
    path: `/api/v1/hr-workforce/shift-assignments/${id}/${verb}`,
    params: { id },
    token,
    idempotencyKey: key
  });
}

function explicit(
  employmentId: string,
  from: string,
  to: string,
  extra: Record<string, unknown> = {}
) {
  return {
    employmentId,
    kind: "work",
    startsAt: from,
    endsAt: to,
    timeZone: "Asia/Jakarta",
    ...extra
  };
}

async function hire(tag: string, existingProfileId?: string): Promise<string> {
  const profileId = existingProfileId ?? (await seedProfile(env.tenantId, tag));
  numberCounter += 1;
  const response = await call<{ id: string }>(createEmployment, {
    method: "POST",
    path: "/api/v1/hr-workforce/employments",
    body: {
      profileId,
      employeeNo: `S-${numberCounter}`,
      hiredOn: "2026-01-05",
      employmentType: "permanent",
      status: "active",
      jobTitle: "Barista"
    }
  });
  expect(response.status).toBe(201);

  return response.body.data!.id;
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("hr_workforce shifts HTTP surface (Issue #946)", () => {
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
    const employment = await hire("deny");
    const template = (await newTemplate()).body.data!;
    const draft = (
      await newAssignment(
        explicit(employment, "2026-10-12T01:00:00Z", "2026-10-12T05:00:00Z")
      )
    ).body.data!;
    const before = await count("awcms_hr_shift_assignments");

    expect(
      (
        await call(listTemplates, {
          path: "/api/v1/hr-workforce/shift-templates",
          token: null
        })
      ).status
    ).toBe(401);

    const attempts = [
      call(listTemplates, {
        path: "/api/v1/hr-workforce/shift-templates",
        token: noRole.token
      }),
      newTemplate({ code: "X2" }, noRole.token),
      call(getTemplate, {
        path: `/api/v1/hr-workforce/shift-templates/${template.id}`,
        params: { id: template.id },
        token: noRole.token
      }),
      call(patchTemplate, {
        method: "PATCH",
        path: `/api/v1/hr-workforce/shift-templates/${template.id}`,
        params: { id: template.id },
        body: { name: "x" },
        token: noRole.token
      }),
      call(deleteTemplate, {
        method: "DELETE",
        path: `/api/v1/hr-workforce/shift-templates/${template.id}`,
        params: { id: template.id },
        token: noRole.token
      }),
      call(listAssignments, {
        path: "/api/v1/hr-workforce/shift-assignments",
        token: noRole.token
      }),
      newAssignment(
        explicit(employment, "2026-10-14T01:00:00Z", "2026-10-14T05:00:00Z"),
        noRole.token
      ),
      act(publishAssignment, "publish", draft.id, noRole.token),
      act(cancelAssignment, "cancel", draft.id, noRole.token)
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    expect(await count("awcms_hr_shift_assignments")).toBe(before);
    expect((await getTemplateRow(template.id)).deleted_at).toBeNull();
    expect((await getAssignmentRow(draft.id)).status).toBe("draft");
  });

  test("every shift permission BITES: all-but-one is refused, only-that-one succeeds", async () => {
    if (!handlerReady) return;
    const employment = await hire("bite");
    const template = (await newTemplate()).body.data!;
    const draft = (
      await newAssignment(
        explicit(employment, "2026-10-12T01:00:00Z", "2026-10-12T05:00:00Z")
      )
    ).body.data!;
    let n = 0;
    const unique = () => {
      n += 1;
      return n;
    };
    // Each case is built so a call by an AUTHORISED user succeeds (2xx).
    const cases: [string, (token: string) => Promise<{ status: number }>][] = [
      [
        "hr_workforce.templates.read",
        (token) =>
          call(listTemplates, {
            path: "/api/v1/hr-workforce/shift-templates",
            token
          })
      ],
      [
        "hr_workforce.templates.create",
        (token) => newTemplate({ code: `T${unique()}` }, token)
      ],
      [
        "hr_workforce.templates.update",
        (token) =>
          call(patchTemplate, {
            method: "PATCH",
            path: `/api/v1/hr-workforce/shift-templates/${template.id}`,
            params: { id: template.id },
            body: { name: `n${unique()}` },
            token
          })
      ],
      [
        "hr_workforce.templates.delete",
        async (token) => {
          const fresh = (await newTemplate({ code: `D${unique()}` })).body
            .data!;

          return call(deleteTemplate, {
            method: "DELETE",
            path: `/api/v1/hr-workforce/shift-templates/${fresh.id}`,
            params: { id: fresh.id },
            token
          });
        }
      ],
      [
        "hr_workforce.shifts.read",
        (token) =>
          call(listAssignments, {
            path: "/api/v1/hr-workforce/shift-assignments",
            token
          })
      ],
      [
        "hr_workforce.shifts.create",
        (token) =>
          newAssignment(
            explicit(
              employment,
              `2026-11-${String(10 + unique()).padStart(2, "0")}T01:00:00Z`,
              `2026-11-${String(10 + n).padStart(2, "0")}T05:00:00Z`
            ),
            token
          )
      ],
      [
        "hr_workforce.shifts.publish",
        (token) => act(publishAssignment, "publish", draft.id, token)
      ],
      [
        "hr_workforce.shifts.cancel",
        async (token) => {
          const fresh = (
            await newAssignment(
              explicit(
                employment,
                `2027-01-${String(10 + unique()).padStart(2, "0")}T01:00:00Z`,
                `2027-01-${String(10 + n).padStart(2, "0")}T05:00:00Z`
              )
            )
          ).body.data!;

          return act(cancelAssignment, "cancel", fresh.id, token);
        }
      ]
    ];

    for (const [key, run] of cases) {
      const others = ALL_HR_PERMISSIONS.filter(
        (permission) => permission !== key
      );
      const without = await seedUser(env.tenantId, "without", others);
      const only = await seedUser(env.tenantId, "only", [key]);

      expect((await run(without.token)).status).toBe(403);
      const allowed = (await run(only.token)).status;

      expect([200, 201]).toContain(allowed);
    }
  });

  test("a template resolved across spring-forward, then edited: the assignment keeps its instants", async () => {
    if (!handlerReady) return;
    const employment = await hire("dst");
    const template = (await newTemplate()).body.data!;
    const created = await newAssignment({
      employmentId: employment,
      kind: "work",
      templateId: template.id,
      localDate: "2026-03-07"
    });

    expect(created.status).toBe(201);
    const assignment = created.body.data!;

    expect(assignment).toMatchObject({
      status: "draft",
      timeZone: "America/New_York",
      templateId: template.id,
      startsAt: "2026-03-08T03:00:00.000Z",
      endsAt: "2026-03-08T11:00:00.000Z",
      breakStartsAt: "2026-03-08T07:00:00.000Z",
      breakEndsAt: "2026-03-08T07:30:00.000Z"
    });

    const edit = await call<Template>(patchTemplate, {
      method: "PATCH",
      path: `/api/v1/hr-workforce/shift-templates/${template.id}`,
      params: { id: template.id },
      body: {
        localStart: "06:00",
        durationMinutes: 600,
        breakOffsetMinutes: null,
        breakMinutes: null
      }
    });

    expect(edit.status).toBe(200);

    const row = await getAssignmentRow(assignment.id);

    expect(new Date(row.starts_at).toISOString()).toBe(
      "2026-03-08T03:00:00.000Z"
    );
    expect(new Date(row.ends_at).toISOString()).toBe(
      "2026-03-08T11:00:00.000Z"
    );
  });

  test("draft -> published -> cancelled: visibility to the port and to lists", async () => {
    if (!handlerReady) return;
    const employment = await hire("flow");
    const draft = (
      await newAssignment(
        explicit(employment, "2026-10-12T01:00:00Z", "2026-10-12T09:00:00Z")
      )
    ).body.data!;
    const ask = () =>
      withTenantOrThrow(getHandlerDatabaseClient(), env.tenantId, (tx) =>
        staffAvailabilityAdapter.getAvailability(tx, {
          staffRefs: [employment],
          fromUtc: "2026-10-12T00:00:00Z",
          toUtc: "2026-10-13T00:00:00Z"
        })
      );

    expect((await ask()).staff[0]!.intervals).toEqual([]);

    const published = await act(publishAssignment, "publish", draft.id);

    expect(published.status).toBe(200);
    expect(published.body.data!.status).toBe("published");
    expect((await ask()).staff[0]!.intervals).toEqual([
      {
        startUtc: "2026-10-12T01:00:00.000Z",
        endUtc: "2026-10-12T09:00:00.000Z"
      }
    ]);

    const again = await act(publishAssignment, "publish", draft.id);

    expect(again.status).toBe(409);
    expect(again.body.error?.code).toBe("SHIFT_NOT_DRAFT");

    const cancelled = await act(cancelAssignment, "cancel", draft.id);

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data!.status).toBe("cancelled");
    expect((await ask()).staff[0]!.intervals).toEqual([]);
    expect(
      (await act(cancelAssignment, "cancel", draft.id)).body.error?.code
    ).toBe("SHIFT_ALREADY_CANCELLED");
    expect(
      (await act(publishAssignment, "publish", draft.id)).body.error?.code
    ).toBe("SHIFT_NOT_DRAFT");

    const listed = await call<{ assignments: Assignment[] }>(listAssignments, {
      path: "/api/v1/hr-workforce/shift-assignments",
      query: `employmentId=${employment}&status=cancelled`
    });

    expect(listed.body.data!.assignments.map((a) => a.id)).toEqual([draft.id]);
  });

  test("overlap: 409 SHIFT_CONFLICT names the other assignment; touching is fine; cancel frees the slot", async () => {
    if (!handlerReady) return;
    const employment = await hire("overlap");
    const first = (
      await newAssignment(
        explicit(employment, "2026-10-12T01:00:00Z", "2026-10-12T09:00:00Z")
      )
    ).body.data!;
    const clash = await newAssignment(
      explicit(employment, "2026-10-12T08:00:00Z", "2026-10-12T16:00:00Z")
    );

    expect(clash.status).toBe(409);
    expect(clash.body.error?.code).toBe("SHIFT_CONFLICT");
    expect(clash.body.error?.details).toEqual({
      conflictingAssignmentId: first.id
    });

    const timeOff = await newAssignment({
      employmentId: employment,
      kind: "time_off",
      timeOffKind: "leave",
      startsAt: "2026-10-11T00:00:00Z",
      endsAt: "2026-10-13T00:00:00Z",
      timeZone: "Asia/Jakarta"
    });

    expect(timeOff.body.error?.code).toBe("SHIFT_CONFLICT");
    expect(
      (
        await newAssignment(
          explicit(employment, "2026-10-12T09:00:00Z", "2026-10-12T17:00:00Z")
        )
      ).status
    ).toBe(201);

    await act(cancelAssignment, "cancel", first.id);
    expect(
      (
        await newAssignment(
          explicit(employment, "2026-10-12T08:00:00Z", "2026-10-12T09:00:00Z")
        )
      ).status
    ).toBe(201);
  });

  test("concurrent identical creates through the API: one draft, the rest are 409", async () => {
    if (!handlerReady) return;
    const employment = await hire("race");
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        newAssignment(
          explicit(employment, "2026-10-20T01:00:00Z", "2026-10-20T09:00:00Z")
        )
      )
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await count("awcms_hr_shift_assignments")).toBe(1);
  });

  test("idempotency: a replay returns the stored answer; another body under the same key is 409; a missing key is 400", async () => {
    if (!handlerReady) return;
    const employment = await hire("idem");
    const body = explicit(
      employment,
      "2026-10-12T01:00:00Z",
      "2026-10-12T09:00:00Z"
    );
    const first = await newAssignment(body, undefined, "fixed-key-1");
    const replay = await newAssignment(body, undefined, "fixed-key-1");

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.data!.id).toBe(first.body.data!.id);
    expect(await count("awcms_hr_shift_assignments")).toBe(1);
    expect(
      (
        await newAssignment(
          { ...body, endsAt: "2026-10-12T10:00:00Z" },
          undefined,
          "fixed-key-1"
        )
      ).body.error?.code
    ).toBe("IDEMPOTENCY_CONFLICT");

    for (const status of [
      (await newAssignment(body, undefined, null)).status,
      (
        await call(createTemplate, {
          method: "POST",
          path: "/api/v1/hr-workforce/shift-templates",
          body: { ...TEMPLATE_BODY, code: "NOKEY2" },
          idempotencyKey: null
        })
      ).status,
      (
        await act(
          publishAssignment,
          "publish",
          first.body.data!.id,
          undefined,
          null
        )
      ).status,
      (
        await act(
          cancelAssignment,
          "cancel",
          first.body.data!.id,
          undefined,
          null
        )
      ).status
    ]) {
      expect(status).toBe(400);
    }

    const published = await act(
      publishAssignment,
      "publish",
      first.body.data!.id,
      undefined,
      "pub-key"
    );
    const publishedAgain = await act(
      publishAssignment,
      "publish",
      first.body.data!.id,
      undefined,
      "pub-key"
    );

    expect(published.status).toBe(200);
    expect(publishedAgain.status).toBe(200);
    expect(await countAudit("hr_workforce.shift.published")).toBe(1);
  });

  test("validation and references: no reason field, unknown zone, other tenant's employment, deleted template", async () => {
    if (!handlerReady) return;
    const employment = await hire("refs");
    const base = explicit(
      employment,
      "2026-10-12T01:00:00Z",
      "2026-10-12T05:00:00Z"
    );

    for (const bad of [
      { ...base, reason: "flu" },
      { ...base, kind: "time_off", timeOffKind: "leave", reason: "chemo" },
      { ...base, timeZone: "Mars/Olympus" },
      { ...base, startsAt: "2026-10-12T01:00:00+07:00" }
    ]) {
      expect((await newAssignment(bad)).status).toBe(400);
    }

    const otherTenant = (await admin()`
      INSERT INTO awcms_tenants (tenant_code, tenant_name) VALUES ('other-co', 'Other') RETURNING id
    `) as { id: string }[];
    const otherProfile = await seedProfile(otherTenant[0]!.id, "foreign");
    const foreign = (await admin()`
      INSERT INTO awcms_hr_employments (tenant_id, profile_id, employee_no, hired_on)
      VALUES (${otherTenant[0]!.id}, ${otherProfile}, 'F-1', '2026-01-01') RETURNING id
    `) as { id: string }[];

    const crossTenant = await newAssignment({
      ...base,
      employmentId: foreign[0]!.id
    });

    expect(crossTenant.status).toBe(422);
    expect(crossTenant.body.error?.code).toBe("EMPLOYMENT_NOT_FOUND");

    const template = (await newTemplate()).body.data!;
    const deleted = await call(deleteTemplate, {
      method: "DELETE",
      path: `/api/v1/hr-workforce/shift-templates/${template.id}`,
      params: { id: template.id }
    });

    expect(deleted.status).toBe(200);
    expect(
      (
        await newAssignment({
          employmentId: employment,
          kind: "work",
          templateId: template.id,
          localDate: "2026-10-12"
        })
      ).body.error?.code
    ).toBe("TEMPLATE_NOT_FOUND");
    // The code is free again.
    expect((await newTemplate()).status).toBe(201);
    expect((await newTemplate()).body.error?.code).toBe(
      "TEMPLATE_CODE_CONFLICT"
    );
  });

  test("employee sees own: ?mine=true lists the caller's PUBLISHED schedule only; everything else is 403", async () => {
    if (!handlerReady) return;
    const employee = await seedUser(env.tenantId, "employee", []);
    // The employment is the PERSON of the login (#979: the link must match).
    const mine = await hire("mine", employee.profileId);
    const theirs = await hire("theirs");

    expect(
      (
        await call(assignAccount, {
          method: "PUT",
          path: `/api/v1/hr-workforce/employments/${mine}/account`,
          params: { id: mine },
          body: { tenantUserId: employee.tenantUserId }
        })
      ).status
    ).toBe(200);

    const published = (
      await newAssignment(
        explicit(mine, "2026-10-12T01:00:00Z", "2026-10-12T09:00:00Z")
      )
    ).body.data!;
    await act(publishAssignment, "publish", published.id);
    await newAssignment(
      explicit(mine, "2026-10-13T01:00:00Z", "2026-10-13T09:00:00Z")
    );
    const cancelled = (
      await newAssignment(
        explicit(mine, "2026-10-14T01:00:00Z", "2026-10-14T09:00:00Z")
      )
    ).body.data!;
    await act(cancelAssignment, "cancel", cancelled.id);
    const other = (
      await newAssignment(
        explicit(theirs, "2026-10-12T01:00:00Z", "2026-10-12T09:00:00Z")
      )
    ).body.data!;
    await act(publishAssignment, "publish", other.id);

    const own = await call<{ assignments: Assignment[] }>(listAssignments, {
      path: "/api/v1/hr-workforce/shift-assignments",
      query: "mine=true",
      token: employee.token
    });

    expect(own.status).toBe(200);
    expect(own.body.data!.assignments.map((a) => a.id)).toEqual([published.id]);

    for (const response of [
      await call(listAssignments, {
        path: "/api/v1/hr-workforce/shift-assignments",
        token: employee.token
      }),
      await call(listAssignments, {
        path: "/api/v1/hr-workforce/shift-assignments",
        query: `employmentId=${theirs}`,
        token: employee.token
      }),
      await newAssignment(
        explicit(mine, "2026-10-20T01:00:00Z", "2026-10-20T09:00:00Z"),
        employee.token
      ),
      await act(cancelAssignment, "cancel", published.id, employee.token),
      await act(publishAssignment, "publish", published.id, employee.token)
    ]) {
      expect(response.status).toBe(403);
    }

    // A person with no linked employment gets an EMPTY own schedule, not another's.
    const stranger = await seedUser(env.tenantId, "stranger", []);
    const none = await call<{ assignments: Assignment[] }>(listAssignments, {
      path: "/api/v1/hr-workforce/shift-assignments",
      query: "mine=true",
      token: stranger.token
    });

    expect(none.body.data!.assignments).toEqual([]);
  });

  test("audit: high-risk shift actions are recorded without a name, a number, a title or a reason", async () => {
    if (!handlerReady) return;
    const employment = await hire("audit");
    const draft = (
      await newAssignment({
        employmentId: employment,
        kind: "time_off",
        timeOffKind: "leave",
        startsAt: "2026-10-12T01:00:00Z",
        endsAt: "2026-10-13T01:00:00Z",
        timeZone: "Asia/Jakarta"
      })
    ).body.data!;
    const template = (await newTemplate({ code: "AUD" })).body.data!;

    await act(publishAssignment, "publish", draft.id);
    await act(cancelAssignment, "cancel", draft.id);
    await call(deleteTemplate, {
      method: "DELETE",
      path: `/api/v1/hr-workforce/shift-templates/${template.id}`,
      params: { id: template.id }
    });

    const rows = (await admin()`
      SELECT action, severity, attributes::text AS attributes, message
      FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND module_key = 'hr_workforce'
        AND (action LIKE 'hr_workforce.shift%')
      ORDER BY created_at, id
    `) as {
      action: string;
      severity: string;
      attributes: string;
      message: string;
    }[];

    expect(rows.map((r) => r.action)).toEqual([
      "hr_workforce.shift.created",
      "hr_workforce.shift_template.created",
      "hr_workforce.shift.published",
      "hr_workforce.shift.cancelled",
      "hr_workforce.shift_template.deleted"
    ]);
    expect(rows.find((r) => r.action.endsWith("cancelled"))!.severity).toBe(
      "warning"
    );

    const text = JSON.stringify(rows);

    expect(text).not.toMatch(/Barista|S-\d|Person|leave|Night|AUD|@example/);
  });

  test("a create-only caller gets SHIFT_CONFLICT without the other assignment's id; a reader gets it", async () => {
    if (!handlerReady) return;
    const employment = await hire("enum");
    const first = (
      await newAssignment(
        explicit(employment, "2026-10-12T01:00:00Z", "2026-10-12T09:00:00Z")
      )
    ).body.data!;
    const creator = await seedUser(env.tenantId, "creator", [
      "hr_workforce.shifts.create"
    ]);
    const reader = await seedUser(env.tenantId, "creader", [
      "hr_workforce.shifts.create",
      "hr_workforce.shifts.read"
    ]);
    const clash = explicit(
      employment,
      "2026-10-12T08:00:00Z",
      "2026-10-12T16:00:00Z"
    );
    const blind = await newAssignment(clash, creator.token);
    const sighted = await newAssignment(clash, reader.token);

    expect(blind.status).toBe(409);
    expect(blind.body.error?.code).toBe("SHIFT_CONFLICT");
    expect(JSON.stringify(blind.body)).not.toContain(first.id);
    expect(sighted.body.error?.details).toEqual({
      conflictingAssignmentId: first.id
    });
  });

  test("the module declares every permission the surface enforces, and they are seeded", async () => {
    if (!handlerReady) return;
    const declared = (hrWorkforceModule.permissions ?? []).map(
      (p) => `hr_workforce.${p.activityCode}.${p.action}`
    );
    const seeded = (await admin()`
      SELECT activity_code || '.' || action AS key FROM awcms_permissions
      WHERE module_key = 'hr_workforce'
    `) as { key: string }[];

    expect(seeded.map((r) => `hr_workforce.${r.key}`).sort()).toEqual(
      [...declared].sort()
    );
    expect(declared).toContain("hr_workforce.shifts.publish");
    expect(declared).not.toContain("hr_workforce.shifts.update");
  });
});

async function getAssignmentRow(id: string) {
  const rows = (await admin()`
    SELECT status, starts_at, ends_at FROM awcms_hr_shift_assignments WHERE id = ${id}
  `) as { status: string; starts_at: Date; ends_at: Date }[];

  return rows[0]!;
}

async function getTemplateRow(id: string) {
  const rows = (await admin()`
    SELECT deleted_at FROM awcms_hr_shift_templates WHERE id = ${id}
  `) as { deleted_at: Date | null }[];

  return rows[0]!;
}

async function countAudit(action: string): Promise<number> {
  const rows = (await admin()`
    SELECT count(*)::int AS n FROM awcms_audit_events
    WHERE tenant_id = ${env.tenantId} AND action = ${action}
  `) as { n: number }[];

  return rows[0]!.n;
}
