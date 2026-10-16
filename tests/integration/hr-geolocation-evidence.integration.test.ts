/**
 * Geolocation attendance evidence through the REAL route handlers against a real
 * PostgreSQL (Issue #970, ADR-0138) — WORLD-2 of the harness. One test per
 * required test of the ADR:
 *
 *   1. default off; enabling needs the dedicated permission (403) and a DPIA
 *      reference, a notice and a geofence (409); the tenant owner does NOT hold
 *      the permission by the blanket grant;
 *   2. NO coordinate anywhere: a distinctive sample value is searched for in
 *      every table of the database, the response and the console;
 *   3. an accuracy worse than the ceiling is `not_provided`, never `inside`; a
 *      declined / unacknowledged sample records the clock event normally;
 *   4. only `source = self` at clock_in / clock_out may carry a sample;
 *   5. the reader roster, and reads of another person's evidence are audited;
 *   7. disabling stops capture immediately (and the database refuses a stray
 *      insert); module disablement denies everything.
 * (6, retention and subject data, is `hr-geolocation-retention.integration.test.ts`.)
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
import { runOwnerPermissionBackfill } from "../../src/modules/identity-access/application/owner-permission-backfill-job";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as createEmployment } from "../../src/pages/api/v1/hr-workforce/employments/index";
import { PUT as assignAccount } from "../../src/pages/api/v1/hr-workforce/employments/[id]/account";
import { POST as recordEvent } from "../../src/pages/api/v1/hr-workforce/attendance-events/index";
import {
  GET as getSettings,
  PUT as putSettings
} from "../../src/pages/api/v1/hr-workforce/geolocation/settings";
import {
  GET as listGeofences,
  POST as createGeofence
} from "../../src/pages/api/v1/hr-workforce/geolocation/geofences/index";
import {
  DELETE as deleteGeofence,
  PUT as replaceGeofence
} from "../../src/pages/api/v1/hr-workforce/geolocation/geofences/[id]";
import { POST as restoreGeofence } from "../../src/pages/api/v1/hr-workforce/geolocation/geofences/[id]/restore";
import {
  GET as listNotices,
  POST as publishNotice
} from "../../src/pages/api/v1/hr-workforce/geolocation/notices";
import { GET as getNotice } from "../../src/pages/api/v1/hr-workforce/geolocation/notice";
import { POST as acknowledge } from "../../src/pages/api/v1/hr-workforce/geolocation/notice-acknowledgements";
import { GET as listEvidence } from "../../src/pages/api/v1/hr-workforce/geolocation/evidence";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";

// The work site (Monas, Jakarta). Its digits never overlap the sample's.
const SITE_LAT = -6.175392;
const SITE_LON = 106.827153;
const METRE = 1 / 111_195;

/** DISTINCTIVE: searched for in every table, response and console line. */
const SAMPLE = {
  latitude: -6.175391234567,
  longitude: 106.827152876543,
  accuracyMeters: 12.3456789
};
const SENTINELS = ["6.175391234567", "106.827152876543", "12.3456789"];

const CONFIGURE = "hr_workforce.geolocation_evidence.configure";
const EVIDENCE_READ = "hr_workforce.attendance_evidence.read";
const CLOCK = "hr_workforce.clock.create";

type Env = {
  tenantId: string;
  token: string;
  ownerTenantUserId: string;
  officeId: string;
};

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

type Clocked = {
  id: string;
  kind: string;
  source: string;
  locationVerdict: string | null;
};
type Evidence = {
  id: string;
  eventId: string;
  employmentId: string;
  verdict: string;
  distanceBand: string | null;
  accuracyBand: string | null;
  geofenceId: string | null;
  ruleVersion: number;
  evaluatedAt: string;
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;
let numberCounter = 0;

const admin = () => getHandlerAdminSql();
/** A Bun.SQL query is lazy: wrap it so `expect(...).rejects` really runs it. */
const refused = (query: PromiseLike<unknown>): Promise<unknown> =>
  (async () => {
    await query;
  })();

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "geo-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Geo Co",
      tenantCode: "geo-co",
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
  const office = (await admin()`
    SELECT id FROM awcms_offices WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  return {
    tenantId,
    token: login.body.data.token,
    ownerTenantUserId: owner[0]!.id,
    officeId: office[0]!.id
  };
}

async function seedUser(
  label: string,
  permissionKeys: readonly string[],
  existingProfileId?: string
): Promise<{
  token: string;
  tenantUserId: string;
  profileId: string;
}> {
  userCounter += 1;
  const sql = admin();
  const tag = `${label}-${userCounter}`;
  const profile = existingProfileId
    ? [{ id: existingProfileId }]
    : ((await sql`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        VALUES (${env.tenantId}, 'person', ${`User ${tag}`})
        RETURNING id
      `) as { id: string }[]);
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${env.tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${env.tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  const token = `geo-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${env.tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours')
  `;

  if (permissionKeys.length > 0) {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${env.tenantId}, ${`role-${tag}`}, ${`Role ${tag}`})
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
        VALUES (${env.tenantId}, ${role[0]!.id}, ${permission[0].id})
      `;
    }

    await withTenantOrThrow(getHandlerDatabaseClient(), env.tenantId, (tx) =>
      grantRolePolicy(tx, env.tenantId, {
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
    profileId: profile[0]!.id
  };
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
    locals: { correlationId: "corr-api-970" }
  });
}

async function hire(tag: string, existingProfileId?: string): Promise<string> {
  const profileId =
    existingProfileId ??
    (
      (await admin()`
        INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
        VALUES (${env.tenantId}, 'person', ${`Person ${tag}`}) RETURNING id
      `) as { id: string }[]
    )[0]!.id;
  numberCounter += 1;
  const response = await call<{ id: string }>(createEmployment, {
    method: "POST",
    path: "/api/v1/hr-workforce/employments",
    body: {
      profileId,
      employeeNo: `G-${numberCounter}`,
      hiredOn: "2026-01-05",
      employmentType: "permanent",
      status: "active",
      jobTitle: "Barista",
      officeId: env.officeId
    }
  });
  expect(response.status).toBe(201);

  return response.body.data!.id;
}

async function employee(label: string, permissions: readonly string[]) {
  const user = await seedUser(label, permissions);
  const employmentId = await hire(label, user.profileId);
  const linked = await call(assignAccount, {
    method: "PUT",
    path: `/api/v1/hr-workforce/employments/${employmentId}/account`,
    params: { id: employmentId },
    body: { tenantUserId: user.tenantUserId }
  });
  expect(linked.status).toBe(200);

  return { ...user, employmentId };
}

function clock(
  employmentId: string,
  extra: Record<string, unknown>,
  token: string,
  key?: string
) {
  numberCounter += 1;

  return call<Clocked>(recordEvent, {
    method: "POST",
    path: "/api/v1/hr-workforce/attendance-events",
    body: {
      employmentId,
      kind: "clock_in",
      occurredAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      source: "self",
      clientEventKey: `ck-${numberCounter}-${crypto.randomUUID()}`,
      ...extra
    },
    token,
    idempotencyKey: key
  });
}

const aroundSite = (northMeters: number, accuracyMeters = 10) => ({
  latitude: SITE_LAT + northMeters * METRE,
  longitude: SITE_LON,
  accuracyMeters
});

/** The HR administrator who holds the dedicated permission. */
function configurer() {
  return seedUser("cfg", [CONFIGURE]);
}

async function addGeofence(token: string) {
  return call<{ id: string }>(createGeofence, {
    method: "POST",
    path: "/api/v1/hr-workforce/geolocation/geofences",
    token,
    body: {
      officeId: env.officeId,
      label: "Head office",
      shape: "circle",
      latitude: SITE_LAT,
      longitude: SITE_LON,
      radiusMeters: 100
    }
  });
}

async function addNotice(token: string) {
  return call<{ id: string; version: number }>(publishNotice, {
    method: "POST",
    path: "/api/v1/hr-workforce/geolocation/notices",
    token,
    body: {
      texts: {
        en: "We check once, at clock-in and clock-out, whether you are at the office. We keep only the result for 90 days. You may decline.",
        id: "Kami memeriksa sekali, saat absen masuk dan pulang, apakah Anda di kantor. Hanya hasilnya yang disimpan 90 hari. Anda boleh menolak."
      }
    }
  });
}

async function enable(token: string) {
  expect((await addGeofence(token)).status).toBe(201);
  const notice = await addNotice(token);
  expect(notice.status).toBe(201);

  const response = await call(putSettings, {
    method: "PUT",
    path: "/api/v1/hr-workforce/geolocation/settings",
    token,
    body: {
      enabled: true,
      dpiaReference: "DPIA-2026-007",
      dpiaRecordedOn: "2026-10-01",
      noticeId: notice.body.data!.id
    }
  });
  expect(response.status).toBe(200);

  return notice.body.data!.id;
}

async function acknowledgeNotice(
  employmentId: string,
  noticeId: string,
  token: string
) {
  return call(acknowledge, {
    method: "POST",
    path: "/api/v1/hr-workforce/geolocation/notice-acknowledgements",
    token,
    body: { employmentId, noticeId }
  });
}

async function evidenceRows() {
  return (await admin()`
    SELECT * FROM awcms_hr_attendance_location_evidence
    WHERE tenant_id = ${env.tenantId} ORDER BY evaluated_at
  `) as Record<string, unknown>[];
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("hr_workforce geolocation evidence (Issue #970, ADR-0138)", () => {
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

  test("1. OFF by default: a sample records nothing; enabling needs the dedicated permission, and a DPIA, a notice and a geofence", async () => {
    if (!handlerReady) return;
    const emp = await employee("emp", [CLOCK]);
    const hr = await configurer();

    // A fresh tenant: no settings row, switch off.
    const fresh = await call<{ enabled: boolean }>(getSettings, {
      path: "/api/v1/hr-workforce/geolocation/settings",
      token: hr.token
    });

    expect(fresh.status).toBe(200);
    expect(fresh.body.data!.enabled).toBe(false);
    expect(
      (await admin()`SELECT 1 FROM awcms_hr_geolocation_settings`).length
    ).toBe(0);

    // A clock with a sample: recorded normally, no evidence, no verdict.
    const clocked = await clock(
      emp.employmentId,
      { positionSample: SAMPLE },
      emp.token
    );

    expect(clocked.status).toBe(201);
    expect(clocked.body.data!.locationVerdict).toBeNull();
    expect(await evidenceRows()).toHaveLength(0);

    // The tenant OWNER holds attendance_evidence.read by the blanket grant but
    // NOT the configure permission: 403 on read and on enable.
    const ownerHolds = (await admin()`
      SELECT p.activity_code, p.action
      FROM awcms_role_permissions rp
      JOIN awcms_permissions p ON p.id = rp.permission_id
      JOIN awcms_roles r ON r.id = rp.role_id AND r.tenant_id = rp.tenant_id
      WHERE rp.tenant_id = ${env.tenantId} AND r.role_code = 'owner'
        AND p.module_key = 'hr_workforce'
        AND p.activity_code IN ('geolocation_evidence', 'attendance_evidence')
    `) as { activity_code: string; action: string }[];

    expect(ownerHolds).toEqual([
      { activity_code: "attendance_evidence", action: "read" }
    ]);

    const settingsUrl = "/api/v1/hr-workforce/geolocation/settings";
    const enableBody = {
      enabled: true,
      dpiaReference: "DPIA-1",
      dpiaRecordedOn: "2026-10-01"
    };

    expect(
      (
        await call(putSettings, {
          method: "PUT",
          path: settingsUrl,
          body: enableBody
        })
      ).status
    ).toBe(403);
    expect((await call(getSettings, { path: settingsUrl })).status).toBe(403);
    expect(
      (
        await call(putSettings, {
          method: "PUT",
          path: settingsUrl,
          body: enableBody,
          token: null
        })
      ).status
    ).toBe(401);

    // With the permission: each missing precondition is a named 409.
    const put = (body: unknown) =>
      call<unknown>(putSettings, {
        method: "PUT",
        path: settingsUrl,
        token: hr.token,
        body
      });

    const noDpia = await put({ enabled: true });

    expect(noDpia.status).toBe(409);
    expect(noDpia.body.error!.code).toBe("GEOLOCATION_DPIA_REQUIRED");

    const noNotice = await put({
      enabled: true,
      dpiaReference: "DPIA-1",
      dpiaRecordedOn: "2026-10-01"
    });

    expect(noNotice.status).toBe(409);
    expect(noNotice.body.error!.code).toBe("GEOLOCATION_NOTICE_REQUIRED");

    const notice = await addNotice(hr.token);
    const noFence = await put({
      enabled: true,
      dpiaReference: "DPIA-1",
      dpiaRecordedOn: "2026-10-01",
      noticeId: notice.body.data!.id
    });

    expect(noFence.status).toBe(409);
    expect(noFence.body.error!.code).toBe("GEOLOCATION_GEOFENCE_REQUIRED");

    const unknownNotice = await put({
      enabled: true,
      dpiaReference: "DPIA-1",
      dpiaRecordedOn: "2026-10-01",
      noticeId: crypto.randomUUID()
    });

    expect(unknownNotice.status).toBe(422);

    // Still off after every refusal.
    expect(
      (
        (await admin()`SELECT enabled FROM awcms_hr_geolocation_settings`) as {
          enabled: boolean;
        }[]
      ).filter((row) => row.enabled)
    ).toHaveLength(0);

    // The database refuses what the application would also refuse.
    await expect(
      refused(admin()`
        INSERT INTO awcms_hr_geolocation_settings
          (tenant_id, enabled, dpia_reference, dpia_recorded_on, notice_id)
        VALUES (${env.tenantId}, true, 'x', '2026-10-01', ${notice.body.data!.id})`)
    ).rejects.toThrow(/HR_GEO_NO_GEOFENCE/);
    await expect(
      refused(admin()`
        INSERT INTO awcms_hr_geolocation_settings (tenant_id, enabled)
        VALUES (${env.tenantId}, true)`)
    ).rejects.toThrow();

    // Enabling, finally: audited at CRITICAL with the actor and the before/after state.
    await enable(hr.token);
    const audit = (await admin()`
      SELECT severity, actor_tenant_user_id, attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId}
        AND action = 'hr_workforce.geolocation_evidence.enabled'
    `) as {
      severity: string;
      actor_tenant_user_id: string;
      attributes: { before: { enabled: boolean }; after: { enabled: boolean } };
    }[];

    expect(audit).toHaveLength(1);
    expect(audit[0]!.severity).toBe("critical");
    expect(audit[0]!.actor_tenant_user_id).toBe(hr.tenantUserId);
    expect(audit[0]!.attributes.before.enabled).toBe(false);
    expect(audit[0]!.attributes.after.enabled).toBe(true);
  });

  test("1b. configure routes are default-deny, idempotent, validated; geofences soft-delete and restore", async () => {
    if (!handlerReady) return;
    const hr = await configurer();
    const noRole = await seedUser("norole", []);
    const settingsOnly = await seedUser("settings", [
      "hr_workforce.settings.configure"
    ]);
    const base = "/api/v1/hr-workforce/geolocation";

    // 403 for a user with no role; 401 without a token.
    for (const handler of [listGeofences, listNotices]) {
      expect(
        (
          await call(handler, {
            path: `${base}/x`,
            token: noRole.token
          })
        ).status
      ).toBe(403);
    }

    expect((await addGeofence(noRole.token)).status).toBe(403);
    expect((await addNotice(noRole.token)).status).toBe(403);

    // Idempotency-Key is required, and a replay returns the stored response.
    const noKey = await call(createGeofence, {
      method: "POST",
      path: `${base}/geofences`,
      token: hr.token,
      idempotencyKey: null,
      body: {
        officeId: env.officeId,
        label: "x",
        shape: "circle",
        latitude: SITE_LAT,
        longitude: SITE_LON,
        radiusMeters: 100
      }
    });

    expect(noKey.status).toBe(400);
    expect(noKey.body.error!.code).toBe("IDEMPOTENCY_REQUIRED");

    const key = nextKey();
    const body = {
      officeId: env.officeId,
      label: "Dock",
      shape: "polygon",
      vertices: [
        [SITE_LAT + 50 * METRE, SITE_LON],
        [SITE_LAT - 50 * METRE, SITE_LON - 50 * METRE],
        [SITE_LAT - 50 * METRE, SITE_LON + 50 * METRE]
      ]
    };
    const first = await call<{ id: string }>(createGeofence, {
      method: "POST",
      path: `${base}/geofences`,
      token: hr.token,
      idempotencyKey: key,
      body
    });
    const replay = await call<{ id: string }>(createGeofence, {
      method: "POST",
      path: `${base}/geofences`,
      token: hr.token,
      idempotencyKey: key,
      body
    });

    expect(first.status).toBe(201);
    expect(replay.body.data!.id).toBe(first.body.data!.id);
    expect(
      (
        await admin()`SELECT 1 FROM awcms_hr_geofences WHERE tenant_id = ${env.tenantId}`
      ).length
    ).toBe(1);

    // Validation: a bad body names the field, never an echoed value.
    const bad = await call(createGeofence, {
      method: "POST",
      path: `${base}/geofences`,
      token: hr.token,
      body: { ...body, shape: "circle", radiusMeters: 5 }
    });

    expect(bad.status).toBe(400);
    expect(
      (
        await call(createGeofence, {
          method: "POST",
          path: `${base}/geofences`,
          token: hr.token,
          body: { ...body, officeId: crypto.randomUUID() }
        })
      ).status
    ).toBe(422);

    // Replace, soft delete, restore: all high-risk and audited with ids only.
    const id = first.body.data!.id;
    const replaced = await call<{ label: string }>(replaceGeofence, {
      method: "PUT",
      path: `${base}/geofences/${id}`,
      params: { id },
      token: hr.token,
      body: { ...body, label: "Dock 2" }
    });

    expect(replaced.status).toBe(200);
    expect(replaced.body.data!.label).toBe("Dock 2");

    const deleted = await call(deleteGeofence, {
      method: "DELETE",
      path: `${base}/geofences/${id}`,
      params: { id },
      token: hr.token
    });

    expect(deleted.status).toBe(200);
    expect(
      (
        await call<{ geofences: unknown[] }>(listGeofences, {
          path: `${base}/geofences`,
          token: hr.token
        })
      ).body.data!.geofences
    ).toHaveLength(0);
    expect(
      (
        await call<{ geofences: unknown[] }>(listGeofences, {
          path: `${base}/geofences`,
          query: "includeDeleted=true",
          token: hr.token
        })
      ).body.data!.geofences
    ).toHaveLength(1);
    expect(
      (
        await call(deleteGeofence, {
          method: "DELETE",
          path: `${base}/geofences/${id}`,
          params: { id },
          token: hr.token
        })
      ).status
    ).toBe(409);
    expect(
      (
        await call(restoreGeofence, {
          method: "POST",
          path: `${base}/geofences/${id}/restore`,
          params: { id },
          token: hr.token
        })
      ).status
    ).toBe(200);

    const audit = (await admin()`
      SELECT action, attributes::text AS attributes FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND action LIKE 'hr_workforce.geofence.%'
      ORDER BY created_at
    `) as { action: string; attributes: string }[];

    expect(audit.map((row) => row.action)).toEqual([
      "hr_workforce.geofence.created",
      "hr_workforce.geofence.updated",
      "hr_workforce.geofence.deleted",
      "hr_workforce.geofence.restored"
    ]);
    // Ids only: not one coordinate of the site rides into the audit trail.
    expect(audit.map((row) => row.attributes).join()).not.toContain("106.82");

    // Notices are append-only, numbered, and never edited.
    const n1 = await addNotice(hr.token);
    const n2 = await addNotice(hr.token);

    expect([n1.body.data!.version, n2.body.data!.version]).toEqual([1, 2]);
    expect(
      (
        await call<{ notices: { version: number }[] }>(listNotices, {
          path: `${base}/notices`,
          token: hr.token
        })
      ).body.data!.notices.map((n) => n.version)
    ).toEqual([2, 1]);
    expect(
      (
        await call(publishNotice, {
          method: "POST",
          path: `${base}/notices`,
          token: hr.token,
          body: { texts: { en: "" } }
        })
      ).status
    ).toBe(400);
    await expect(
      refused(
        admin()`UPDATE awcms_hr_geolocation_notices SET texts = '{"en":"x"}'::jsonb`
      )
    ).rejects.toThrow(/append-only/);

    // The ordinary settings.configure holder may SWITCH IT OFF, nothing else.
    const asSettings = (body: unknown) =>
      call(putSettings, {
        method: "PUT",
        path: `${base}/settings`,
        token: settingsOnly.token,
        body
      });

    expect((await asSettings({ enabled: false })).status).toBe(200);
    expect(
      (await asSettings({ enabled: false, accuracyCeilingMeters: 50 })).status
    ).toBe(403);
    expect(
      (
        await asSettings({
          enabled: true,
          dpiaReference: "D",
          dpiaRecordedOn: "2026-10-01",
          noticeId: n1.body.data!.id
        })
      ).status
    ).toBe(403);
    expect(
      (
        await call(getSettings, {
          path: `${base}/settings`,
          token: settingsOnly.token
        })
      ).status
    ).toBe(403);
  });

  test("2. NO coordinate anywhere: a distinctive sample is in no table, response, log line or audit row", async () => {
    if (!handlerReady) return;
    const hr = await configurer();
    const emp = await employee("emp", [CLOCK]);
    const noticeId = await enable(hr.token);

    expect(
      (await acknowledgeNotice(emp.employmentId, noticeId, emp.token)).status
    ).toBe(201);

    const captured: string[] = [];
    const original = { ...console };

    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      console[method] = (...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      };
    }

    let response;

    try {
      response = await clock(
        emp.employmentId,
        { positionSample: SAMPLE, officeId: env.officeId },
        emp.token
      );
      // A malformed sample's refusal must not echo it either.
      const refused = await clock(
        emp.employmentId,
        {
          positionSample: { ...SAMPLE, latitude: 91.987654321012 },
          officeId: env.officeId
        },
        emp.token
      );

      expect(refused.status).toBe(400);
      captured.push(JSON.stringify(refused.body));
    } finally {
      Object.assign(console, original);
    }

    expect(response.status).toBe(201);
    expect(response.body.data!.locationVerdict).toBe("inside");
    captured.push(JSON.stringify(response.body));

    for (const sentinel of SENTINELS) {
      expect(captured.join("\n")).not.toContain(sentinel);
    }
    expect(captured.join("\n")).not.toContain("91.987654321012");

    // Every table of the database, as text: no row anywhere holds the sample.
    const tables = (await admin()`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `) as { table_name: string }[];

    expect(tables.length).toBeGreaterThan(100);

    for (const { table_name } of tables) {
      for (const sentinel of [...SENTINELS, "91.987654321012"]) {
        const hits = (await admin().unsafe(
          `SELECT count(*)::int AS n FROM "${table_name}" t WHERE t::text LIKE $1`,
          [`%${sentinel}%`]
        )) as { n: number }[];

        expect({ table: table_name, sentinel, hits: hits[0]!.n }).toEqual({
          table: table_name,
          sentinel,
          hits: 0
        });
      }
    }

    // What IS stored: a verdict, two bands, the geofence, the rule version, the clock.
    const rows = await evidenceRows();

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "accuracy_band",
      "distance_band",
      "employment_id",
      "evaluated_at",
      "event_id",
      "geofence_id",
      "id",
      "rule_version",
      "tenant_id",
      "verdict"
    ]);
    expect(rows[0]).toMatchObject({
      verdict: "inside",
      distance_band: "within",
      accuracy_band: "lt_25m",
      rule_version: 1
    });
    // And the attendance event has no location column.
    const eventColumns = (await admin()`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'awcms_hr_attendance_events'
    `) as { column_name: string }[];

    expect(eventColumns.map((c) => c.column_name).join(" ")).not.toMatch(
      /latitude|longitude|coord|geo|accuracy|location/
    );
  });

  test("3. accuracy ceiling -> not_provided (never inside); declined, unacknowledged and out-of-fence cases", async () => {
    if (!handlerReady) return;
    const hr = await configurer();
    const emp = await employee("emp", [CLOCK]);
    const noticeId = await enable(hr.token);
    const verdict = async (extra: Record<string, unknown>) => {
      const response = await clock(
        emp.employmentId,
        { officeId: env.officeId, ...extra },
        emp.token
      );

      expect(response.status).toBe(201);

      return response.body.data!.locationVerdict;
    };

    // Not acknowledged yet: a perfect in-fence sample is NOT accepted.
    expect(await verdict({ positionSample: aroundSite(0) })).toBe(
      "not_provided"
    );

    const notice = await call<{
      enabled: boolean;
      notice: { id: string; texts: Record<string, string> } | null;
      acknowledged: boolean;
      accuracyCeilingMeters: number;
    }>(getNotice, {
      path: "/api/v1/hr-workforce/geolocation/notice",
      query: `employmentId=${emp.employmentId}`,
      token: emp.token
    });

    expect(notice.body.data).toMatchObject({
      enabled: true,
      acknowledged: false,
      accuracyCeilingMeters: 100
    });
    expect(notice.body.data!.notice!.id).toBe(noticeId);
    expect(Object.keys(notice.body.data!.notice!.texts).sort()).toEqual([
      "en",
      "id"
    ]);

    // Acknowledgement: own employment only, current version only, repeatable.
    const other = await employee("other", [CLOCK]);

    expect(
      (await acknowledgeNotice(emp.employmentId, noticeId, other.token)).status
    ).toBe(403);
    expect(
      (
        await acknowledgeNotice(
          emp.employmentId,
          crypto.randomUUID(),
          emp.token
        )
      ).status
    ).toBe(409);
    expect(
      (await acknowledgeNotice(emp.employmentId, noticeId, emp.token)).status
    ).toBe(201);
    expect(
      (await acknowledgeNotice(emp.employmentId, noticeId, emp.token)).status
    ).toBe(200);
    await expect(
      refused(admin()`
        INSERT INTO awcms_hr_geolocation_notice_acknowledgements
          (tenant_id, employment_id, notice_id, acknowledged_by)
        VALUES (${env.tenantId}, ${emp.employmentId}, ${noticeId}, ${other.tenantUserId})`)
    ).rejects.toThrow();

    // Acknowledged: now the sample counts.
    expect(await verdict({ positionSample: aroundSite(10, 10) })).toBe(
      "inside"
    );
    expect(await verdict({ positionSample: aroundSite(400, 10) })).toBe(
      "outside"
    );
    // Accuracy WORSE than the 100 m ceiling at the very centre: never inside.
    expect(await verdict({ positionSample: aroundSite(0, 400) })).toBe(
      "not_provided"
    );
    // Declined (null) and absent: the clock event is recorded normally.
    expect(await verdict({ positionSample: null })).toBe("not_provided");
    expect(await verdict({})).toBe("not_provided");

    const rows = await evidenceRows();

    expect(rows.map((r) => r.verdict)).toEqual([
      "not_provided",
      "inside",
      "outside",
      "not_provided",
      "not_provided",
      "not_provided"
    ]);
    // The too-coarse sample keeps a band (why) and no distance, no geofence.
    expect(rows[3]).toMatchObject({
      accuracy_band: "lt_500m",
      distance_band: null,
      geofence_id: null
    });
    expect(rows[2]).toMatchObject({ distance_band: "lt_1km" });
    expect(
      (
        await admin()`SELECT count(*)::int AS n FROM awcms_hr_attendance_events`
      )[0]!.n
    ).toBe(6);

    // A replay of the same clock event returns the original verdict, writes nothing.
    const key = "replay-key";
    const body = {
      employmentId: emp.employmentId,
      kind: "clock_out",
      occurredAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      source: "self",
      clientEventKey: "replay-1",
      positionSample: aroundSite(0),
      officeId: env.officeId
    };
    const first = await call<Clocked>(recordEvent, {
      method: "POST",
      path: "/api/v1/hr-workforce/attendance-events",
      body,
      token: emp.token,
      idempotencyKey: key
    });
    const again = await call<Clocked>(recordEvent, {
      method: "POST",
      path: "/api/v1/hr-workforce/attendance-events",
      body,
      token: emp.token,
      idempotencyKey: nextKey()
    });

    expect(first.body.data!.locationVerdict).toBe("inside");
    expect(again.status).toBe(200);
    expect(again.body.data!.locationVerdict).toBe("inside");
    expect(await evidenceRows()).toHaveLength(7);

    // The old terms-office fallback: no officeId on the event still finds the fence.
    const fallback = await clock(
      emp.employmentId,
      { positionSample: aroundSite(5) },
      emp.token
    );

    expect(fallback.body.data!.locationVerdict).toBe("inside");
  });

  test("4. only a self clock_in / clock_out may carry a sample; the database agrees", async () => {
    if (!handlerReady) return;
    const hr = await configurer();
    const emp = await employee("emp", [CLOCK]);
    const kiosk = await seedUser("kiosk", ["hr_workforce.attendance.create"]);
    const noticeId = await enable(hr.token);

    await acknowledgeNotice(emp.employmentId, noticeId, emp.token);
    const sample = { positionSample: aroundSite(0) };

    // Refused (400) by every other source and kind, writing no event.
    for (const source of ["kiosk", "import", "supervisor"]) {
      const refused = await clock(
        emp.employmentId,
        { source, ...sample },
        kiosk.token
      );

      expect(refused.status).toBe(400);
    }

    for (const kind of ["break_start", "break_end"]) {
      expect(
        (await clock(emp.employmentId, { kind, ...sample }, emp.token)).status
      ).toBe(400);
    }

    expect(
      (
        await admin()`SELECT count(*)::int AS n FROM awcms_hr_attendance_events`
      )[0]!.n
    ).toBe(0);

    // A kiosk / break / supervisor event WITHOUT a sample is recorded and gets no evidence.
    const kioskEvent = await clock(
      emp.employmentId,
      { source: "kiosk" },
      kiosk.token
    );
    const breakEvent = await clock(
      emp.employmentId,
      { kind: "break_start" },
      emp.token
    );

    expect(kioskEvent.status).toBe(201);
    expect(kioskEvent.body.data!.locationVerdict).toBeNull();
    expect(breakEvent.body.data!.locationVerdict).toBeNull();
    expect(await evidenceRows()).toHaveLength(0);

    // The database refuses an evidence row for either, even from a superuser session.
    for (const id of [kioskEvent.body.data!.id, breakEvent.body.data!.id]) {
      await expect(
        refused(admin()`
          INSERT INTO awcms_hr_attendance_location_evidence
            (tenant_id, event_id, employment_id, verdict, rule_version)
          VALUES (${env.tenantId}, ${id}, ${emp.employmentId}, 'not_provided', 1)`)
      ).rejects.toThrow(/HR_GEO_EVENT_NOT_ELIGIBLE/);
    }

    // One row per event at most.
    const selfEvent = await clock(emp.employmentId, sample, emp.token);

    expect(selfEvent.body.data!.locationVerdict).toBe("inside");
    await expect(
      refused(admin()`
        INSERT INTO awcms_hr_attendance_location_evidence
          (tenant_id, event_id, employment_id, verdict, rule_version)
        VALUES (${env.tenantId}, ${selfEvent.body.data!.id}, ${emp.employmentId},
                'not_provided', 1)`)
    ).rejects.toThrow(/one_per_event|duplicate key/);
  });

  test("5. the reader roster: own rows by grant, HR by permission (audited), everyone else 403", async () => {
    if (!handlerReady) return;
    const hr = await configurer();
    const alice = await employee("alice", [CLOCK]);
    const bob = await employee("bob", [CLOCK]);
    const noticeId = await enable(hr.token);

    await acknowledgeNotice(alice.employmentId, noticeId, alice.token);
    await acknowledgeNotice(bob.employmentId, noticeId, bob.token);
    await clock(
      alice.employmentId,
      { positionSample: aroundSite(0) },
      alice.token
    );
    await clock(
      bob.employmentId,
      { positionSample: aroundSite(600) },
      bob.token
    );

    const url = "/api/v1/hr-workforce/geolocation/evidence";
    const list = (query: string, token: string) =>
      call<{ evidence: Evidence[]; nextCursor: string | null }>(listEvidence, {
        path: url,
        query,
        token
      });

    // An employee: only their OWN rows, and only with ?mine=true.
    const mine = await list("mine=true", alice.token);

    expect(mine.status).toBe(200);
    expect(mine.body.data!.evidence).toHaveLength(1);
    expect(mine.body.data!.evidence[0]).toMatchObject({
      employmentId: alice.employmentId,
      verdict: "inside"
    });
    expect((await list("", alice.token)).status).toBe(403);
    expect(
      (await list(`mine=true&employmentId=${bob.employmentId}`, alice.token))
        .status
    ).toBe(403);

    // HR with attendance_evidence.read: everyone's, and each read is audited.
    const reader = await seedUser("reader", [EVIDENCE_READ]);
    const all = await list("", reader.token);

    expect(all.status).toBe(200);
    expect(all.body.data!.evidence.map((e) => e.verdict).sort()).toEqual([
      "inside",
      "outside"
    ]);
    expect(
      (await list(`employmentId=${bob.employmentId}`, reader.token)).body.data!
        .evidence
    ).toHaveLength(1);

    const audits = (await admin()`
      SELECT actor_tenant_user_id, attributes FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId}
        AND action = 'hr_workforce.location_evidence.read'
    `) as {
      actor_tenant_user_id: string;
      attributes: { returned: number; employmentId: string | null };
    }[];

    expect(audits).toHaveLength(2);
    expect(
      audits.every((a) => a.actor_tenant_user_id === reader.tenantUserId)
    ).toBe(true);
    expect(audits.map((a) => a.attributes.returned).sort()).toEqual([1, 2]);
    // A read of one's OWN rows leaves no such trace.
    expect(
      (
        await admin()`
        SELECT 1 FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId}
          AND action = 'hr_workforce.location_evidence.read'
          AND actor_tenant_user_id = ${alice.tenantUserId}`
      ).length
    ).toBe(0);

    // The rest of the roster has NO path in.
    const roster = {
      scheduler: await seedUser("scheduler", [
        "hr_workforce.shifts.read",
        "hr_workforce.shifts.create",
        "hr_workforce.shifts.publish",
        "hr_workforce.templates.read"
      ]),
      cashier: await seedUser("cashier", [CLOCK]),
      marketer: await seedUser("marketer", ["hr_workforce.settings.read"]),
      payrollOperator: await seedUser("payroll", [
        "hr_commission.accruals.read"
      ]),
      attendanceReader: await seedUser("attreader", [
        "hr_workforce.attendance.read",
        "hr_workforce.corrections.read"
      ]),
      configurer: hr
    };

    for (const [name, who] of Object.entries(roster)) {
      const response = await list("", who.token);

      expect({ name, status: response.status }).toEqual({ name, status: 403 });
    }

    expect((await list("", "")).status).toBe(401);

    // Evidence is in no list endpoint of attendance.
    const events = await call<{ events: Record<string, unknown>[] }>(
      (
        await import("../../src/pages/api/v1/hr-workforce/attendance-events/index")
      ).GET,
      {
        path: "/api/v1/hr-workforce/attendance-events",
        token: roster.attendanceReader.token
      }
    );

    expect(events.status).toBe(200);
    expect(JSON.stringify(events.body)).not.toMatch(/verdict|distanceBand/);
  });

  test("7. disabling stops capture at once (database-enforced); module disablement denies everything", async () => {
    if (!handlerReady) return;
    const hr = await configurer();
    const emp = await employee("emp", [CLOCK]);
    const noticeId = await enable(hr.token);

    await acknowledgeNotice(emp.employmentId, noticeId, emp.token);
    expect(
      (
        await clock(
          emp.employmentId,
          { positionSample: aroundSite(0) },
          emp.token
        )
      ).body.data!.locationVerdict
    ).toBe("inside");
    expect(await evidenceRows()).toHaveLength(1);

    // Disabling: no precondition, audited at critical, takes effect immediately.
    const off = await call<{ enabled: boolean }>(putSettings, {
      method: "PUT",
      path: "/api/v1/hr-workforce/geolocation/settings",
      token: hr.token,
      body: { enabled: false }
    });

    expect(off.status).toBe(200);
    expect(off.body.data!.enabled).toBe(false);
    expect(
      (
        await admin()`
        SELECT severity FROM awcms_audit_events
        WHERE tenant_id = ${env.tenantId}
          AND action = 'hr_workforce.geolocation_evidence.disabled'`
      )[0]!.severity
    ).toBe("critical");

    const after = await clock(
      emp.employmentId,
      { positionSample: aroundSite(0) },
      emp.token
    );

    expect(after.status).toBe(201);
    expect(after.body.data!.locationVerdict).toBeNull();
    expect(await evidenceRows()).toHaveLength(1);
    // The notice endpoint tells the client to stop asking.
    expect(
      (
        await call<{ enabled: boolean; notice: unknown }>(getNotice, {
          path: "/api/v1/hr-workforce/geolocation/notice",
          query: `employmentId=${emp.employmentId}`,
          token: emp.token
        })
      ).body.data
    ).toMatchObject({ enabled: false, notice: null });
    // An acknowledgement while off is refused.
    expect(
      (await acknowledgeNotice(emp.employmentId, noticeId, emp.token)).status
    ).toBe(409);

    // A stray insert is refused by the DATABASE while the switch is off.
    const events = (await admin()`
      SELECT id FROM awcms_hr_attendance_events
      WHERE tenant_id = ${env.tenantId} AND kind = 'clock_in' AND source = 'self'
        AND id NOT IN (SELECT event_id FROM awcms_hr_attendance_location_evidence)
      LIMIT 1`) as { id: string }[];

    await expect(
      refused(admin()`
        INSERT INTO awcms_hr_attendance_location_evidence
          (tenant_id, event_id, employment_id, verdict, rule_version)
        VALUES (${env.tenantId}, ${events[0]!.id}, ${emp.employmentId},
                'not_provided', 1)`)
    ).rejects.toThrow(/HR_GEO_DISABLED/);

    // Evidence is append-only: no UPDATE for anyone (privilege + trigger), and
    // DELETE only for the retention engine's role, never for the request role.
    await expect(
      refused(
        admin()`UPDATE awcms_hr_attendance_location_evidence SET verdict = 'inside'`
      )
    ).rejects.toThrow(/append-only/);

    const privileges = (await admin()`
      SELECT
        has_table_privilege('awcms_app', 'awcms_hr_attendance_location_evidence', 'UPDATE') AS app_update,
        has_table_privilege('awcms_app', 'awcms_hr_attendance_location_evidence', 'DELETE') AS app_delete,
        has_table_privilege('awcms_app', 'awcms_hr_attendance_location_evidence', 'TRUNCATE') AS app_truncate,
        has_table_privilege('awcms_worker', 'awcms_hr_attendance_location_evidence', 'UPDATE') AS worker_update,
        has_table_privilege('awcms_worker', 'awcms_hr_attendance_location_evidence', 'DELETE') AS worker_delete,
        has_table_privilege('awcms_worker', 'awcms_hr_attendance_location_evidence', 'SELECT') AS worker_select
    `) as Record<string, boolean>[];

    expect(privileges[0]).toEqual({
      app_update: false,
      app_delete: false,
      app_truncate: false,
      worker_update: false,
      worker_delete: true,
      worker_select: false // column-scoped SELECT only (id, tenant_id, evaluated_at)
    });

    // Existing evidence stays readable until retention removes it.
    const reader = await seedUser("reader", [EVIDENCE_READ]);
    const read = await call<{ evidence: Evidence[] }>(listEvidence, {
      path: "/api/v1/hr-workforce/geolocation/evidence",
      token: reader.token
    });

    expect(read.status).toBe(200);
    expect(read.body.data!.evidence).toHaveLength(1);

    // Module disablement denies everything, whatever the grants.
    await admin()`
      INSERT INTO awcms_modules (module_key, module_name)
      VALUES ('hr_workforce', 'HR Workforce')
      ON CONFLICT (module_key) DO NOTHING`;
    await admin()`
      INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
      VALUES (${env.tenantId}, 'hr_workforce', false)
      ON CONFLICT (tenant_id, module_key) DO UPDATE SET enabled = false`;

    for (const response of [
      await call(listEvidence, {
        path: "/api/v1/hr-workforce/geolocation/evidence",
        token: reader.token
      }),
      await call(getSettings, {
        path: "/api/v1/hr-workforce/geolocation/settings",
        token: hr.token
      }),
      await call(getNotice, {
        path: "/api/v1/hr-workforce/geolocation/notice",
        query: `employmentId=${emp.employmentId}`,
        token: emp.token
      })
    ]) {
      expect([403, 404]).toContain(response.status);
    }
  });

  test("8. geofence limits: shape, per-office cap with a revision/hash audit, the last fence while enabled, and the evidence guard's office check", async () => {
    if (!handlerReady) return;
    const hr = await configurer();
    const base = "/api/v1/hr-workforce/geolocation";
    const fence = (body: Record<string, unknown>) =>
      call<{ id: string; revision: number }>(createGeofence, {
        method: "POST",
        path: `${base}/geofences`,
        token: hr.token,
        body: {
          officeId: env.officeId,
          label: "Site",
          shape: "circle",
          latitude: SITE_LAT,
          longitude: SITE_LON,
          radiusMeters: 100,
          ...body
        }
      });

    // M-2: shape limits (400) and no echoed coordinate.
    expect((await fence({ radiusMeters: 49 })).status).toBe(400);
    const bowTie = await fence({
      shape: "polygon",
      latitude: undefined,
      longitude: undefined,
      radiusMeters: undefined,
      vertices: [
        [SITE_LAT, SITE_LON],
        [SITE_LAT + 100 * METRE, SITE_LON + 100 * METRE],
        [SITE_LAT + 100 * METRE, SITE_LON],
        [SITE_LAT, SITE_LON + 100 * METRE]
      ]
    });

    expect(bowTie.status).toBe(400);
    expect(JSON.stringify(bowTie.body)).not.toContain("106.82");

    // M-2: ten live fences per office; the eleventh is 409; a delete frees a slot.
    const ids: string[] = [];

    for (let i = 0; i < 10; i += 1) {
      const created = await fence({ label: `Site ${i}` });

      expect(created.status).toBe(201);
      ids.push(created.body.data!.id);
    }

    const eleventh = await fence({ label: "Site 11" });

    expect(eleventh.status).toBe(409);
    expect(eleventh.body.error!.code).toBe("GEOFENCE_OFFICE_LIMIT");
    await expect(
      refused(admin()`
        INSERT INTO awcms_hr_geofences
          (tenant_id, office_id, label, shape, center_latitude, center_longitude, radius_m)
        VALUES (${env.tenantId}, ${env.officeId}, 'x', 'circle', 1, 1, 100)`)
    ).rejects.toThrow(/HR_GEO_OFFICE_CAP/);
    expect(
      (
        await call(deleteGeofence, {
          method: "DELETE",
          path: `${base}/geofences/${ids[9]}`,
          params: { id: ids[9]! },
          token: hr.token
        })
      ).status
    ).toBe(200);
    expect((await fence({ label: "Site 11" })).status).toBe(201);

    // M-2: replace bumps the revision and the audit carries it with a geometry
    // fingerprint (and not one coordinate).
    const replaced = await call<{ revision: number }>(replaceGeofence, {
      method: "PUT",
      path: `${base}/geofences/${ids[0]}`,
      params: { id: ids[0]! },
      token: hr.token,
      body: {
        officeId: env.officeId,
        label: "Site 0",
        shape: "circle",
        latitude: SITE_LAT,
        longitude: SITE_LON,
        radiusMeters: 200
      }
    });

    expect(replaced.body.data!.revision).toBe(2);
    const audit = (await admin()`
      SELECT attributes FROM awcms_audit_events
      WHERE tenant_id = ${env.tenantId} AND action = 'hr_workforce.geofence.updated'
    `) as { attributes: { revision: number; geometryHash: string } }[];

    expect(audit[0]!.attributes.revision).toBe(2);
    expect(audit[0]!.attributes.geometryHash).toMatch(/^[0-9a-f]{16}$/);

    // L-1: with the switch ON the last live fence cannot be deleted; OFF it can.
    for (const id of [...ids.slice(1, 9)]) {
      await call(deleteGeofence, {
        method: "DELETE",
        path: `${base}/geofences/${id}`,
        params: { id },
        token: hr.token
      });
    }

    const live = (await admin()`
      SELECT id FROM awcms_hr_geofences
      WHERE tenant_id = ${env.tenantId} AND deleted_at IS NULL`) as {
      id: string;
    }[];
    const notice = await addNotice(hr.token);

    expect(
      (
        await call(putSettings, {
          method: "PUT",
          path: `${base}/settings`,
          token: hr.token,
          body: {
            enabled: true,
            dpiaReference: "DPIA-9",
            dpiaRecordedOn: "2026-10-01",
            noticeId: notice.body.data!.id
          }
        })
      ).status
    ).toBe(200);

    for (const row of live.slice(0, -1)) {
      expect(
        (
          await call(deleteGeofence, {
            method: "DELETE",
            path: `${base}/geofences/${row.id}`,
            params: { id: row.id },
            token: hr.token
          })
        ).status
      ).toBe(200);
    }

    const last = live[live.length - 1]!.id;
    const blocked = await call(deleteGeofence, {
      method: "DELETE",
      path: `${base}/geofences/${last}`,
      params: { id: last },
      token: hr.token
    });

    expect(blocked.status).toBe(409);
    expect(blocked.body.error!.code).toBe("GEOFENCE_LAST_WHILE_ENABLED");
    // The database says the same to a writer that skips the application.
    await expect(
      refused(admin()`
        UPDATE awcms_hr_geofences SET deleted_at = now() WHERE id = ${last}`)
    ).rejects.toThrow(/HR_GEO_LAST_FENCE/);

    // L-4: the guard refuses a verdict naming a fence of ANOTHER office or a deleted one.
    const emp = await employee("emp", [CLOCK]);
    const otherOffice = (await admin()`
      INSERT INTO awcms_offices (tenant_id, office_code, office_name)
      VALUES (${env.tenantId}, 'br', 'Branch') RETURNING id`) as {
      id: string;
    }[];
    const foreign = (await admin()`
      INSERT INTO awcms_hr_geofences
        (tenant_id, office_id, label, shape, center_latitude, center_longitude, radius_m)
      VALUES (${env.tenantId}, ${otherOffice[0]!.id}, 'Elsewhere', 'circle', 1, 1, 100)
      RETURNING id`) as { id: string }[];
    const event = await clock(
      emp.employmentId,
      { officeId: env.officeId },
      emp.token
    );
    const insertVerdict = (fenceId: string) =>
      refused(admin()`
        INSERT INTO awcms_hr_attendance_location_evidence
          (tenant_id, event_id, employment_id, verdict, distance_band,
           accuracy_band, geofence_id, rule_version)
        VALUES (${env.tenantId}, ${event.body.data!.id}, ${emp.employmentId},
                'outside', 'lt_250m', 'lt_25m', ${fenceId}, 1)`);

    await expect(insertVerdict(foreign[0]!.id)).rejects.toThrow(
      /HR_GEO_FENCE_MISMATCH/
    );
    await expect(insertVerdict(ids[1]!)).rejects.toThrow(
      /HR_GEO_FENCE_MISMATCH/
    );

    // Switching off first, the last fence may go.
    await call(putSettings, {
      method: "PUT",
      path: `${base}/settings`,
      token: hr.token,
      body: { enabled: false }
    });
    expect(
      (
        await call(deleteGeofence, {
          method: "DELETE",
          path: `${base}/geofences/${last}`,
          params: { id: last },
          token: hr.token
        })
      ).status
    ).toBe(200);
  });

  test("9. the owner never receives the configure permission: backfill, direct insert, and explicit assignment to another role", async () => {
    if (!handlerReady) return;
    const key = ["hr_workforce", "geolocation_evidence", "configure"];
    const permission = (await admin()`
      SELECT id FROM awcms_permissions
      WHERE module_key = ${key[0]!} AND activity_code = ${key[1]!} AND action = ${key[2]!}`) as {
      id: string;
    }[];
    const owner = (await admin()`
      SELECT id FROM awcms_roles
      WHERE tenant_id = ${env.tenantId} AND role_code = 'owner'`) as {
      id: string;
    }[];
    const holds = async () =>
      (
        (await admin()`
          SELECT 1 FROM awcms_role_permissions
          WHERE tenant_id = ${env.tenantId} AND role_id = ${owner[0]!.id}
            AND permission_id = ${permission[0]!.id}`) as unknown[]
      ).length;

    expect(await holds()).toBe(0);

    // The backfill grants a permission NEWER than the role. Make this one newer
    // than the owner role; with the filter removed the owner would receive it.
    await admin()`
      UPDATE awcms_permissions SET created_at = now() + interval '1 hour'
      WHERE id = ${permission[0]!.id}`;

    try {
      const result = await runOwnerPermissionBackfill(admin(), {
        commit: true,
        now: new Date(),
        tenantCode: "geo-co"
      });

      expect(result.tenants).toHaveLength(1);
      expect(result.tenants[0]!.granted).not.toContain(key.join("."));
      expect(result.tenants[0]!.skippedAsDeliberate).not.toContain(
        key.join(".")
      );
      expect(await holds()).toBe(0);
    } finally {
      await admin()`
        UPDATE awcms_permissions SET created_at = '2026-01-01'
        WHERE id = ${permission[0]!.id}`;
    }

    // The data-level wall: no writer can attach it to the system owner role.
    await expect(
      refused(admin()`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        VALUES (${env.tenantId}, ${owner[0]!.id}, ${permission[0]!.id})`)
    ).rejects.toThrow(/OWNER_GRANT_EXCLUDED/);
    expect(await holds()).toBe(0);

    // An explicit assignment to a DIFFERENT role works (the seeded fixtures do it).
    const hr = await configurer();

    expect(
      (
        await call(getSettings, {
          path: "/api/v1/hr-workforce/geolocation/settings",
          token: hr.token
        })
      ).status
    ).toBe(200);
  });
});
