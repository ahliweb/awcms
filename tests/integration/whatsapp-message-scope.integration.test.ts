/**
 * `POST /whatsapp/messages/{id}/cancel` and `GET /whatsapp/diagnostics` confine
 * the message ROWS by the caller's business scope (Issue #1265), through the real
 * routes against a real PostgreSQL with real sessions.
 *
 * A holder confined to brand A cannot cancel brand B's queued message nor an
 * unscoped one (the SAME 409 an unknown id gets, and the row is untouched), and
 * diagnostics shows only rows (counts, messages, attempts) of the brands they
 * hold. An unconfined holder is unchanged.
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
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { GET as getDiagnostics } from "../../src/pages/api/v1/whatsapp/diagnostics";
import { POST as cancelMessage } from "../../src/pages/api/v1/whatsapp/messages/[id]/cancel";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const KEYS = [
  "whatsapp_delivery.messages.read",
  "whatsapp_delivery.messages.cancel"
];

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};
type DiagnosticsBody = {
  summary: {
    countsByStatus: Record<string, number>;
    suppressions: number | null;
    grantedConsents: number | null;
  };
  messages: { id: string }[];
  attempts: { messageId: string }[];
};

let tenantId = "";
let ownerTenantUserId = "";
let userCounter = 0;
let keyCounter = 0;
const savedEnv: Record<string, string | undefined> = {};

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "wa-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "WA Access Co",
      tenantCode: "wa-cancel-scope",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);
  tenantId = setup.body.data.tenantId;

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
  expect(login.body.data.token).toBeTruthy();

  const owner = (await admin()`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  ownerTenantUserId = owner[0]!.id;
}

async function seedUser(
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
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `wa-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

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
      reason: "whatsapp sender access fixture"
    })
  );

  return { token, tenantUserId: tenantUser[0]!.id };
}

async function seedOffice(code: string): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name)
    VALUES (${tenantId}, ${code}, ${`Office ${code}`}) RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

/** Confines a person to an office (an active business-scope assignment). */
async function holdScope(tenantUserId: string, officeId: string) {
  await admin()`
    INSERT INTO awcms_business_scope_assignments
      (tenant_id, tenant_user_id, scope_type, scope_id,
       granted_by_tenant_user_id)
    VALUES (${tenantId}, ${tenantUserId}, 'office', ${officeId},
            ${ownerTenantUserId})
  `;
}

async function queueRow(
  officeId: string | null,
  status = "queued"
): Promise<string> {
  keyCounter += 1;
  const rows = (await admin()`
    INSERT INTO awcms_whatsapp_messages
      (tenant_id, idempotency_key, template_key, purpose, recipient,
       recipient_hash, recipient_masked, body, status,
       sender_selection, business_scope_type, business_scope_id)
    VALUES (${tenantId}, ${`seed-${keyCounter}`}, 'it1265.t', 'transactional',
            '+6281234567890', 'k1:x', '+*', 'x', ${status},
            'deployment', ${officeId ? "office" : null}, ${officeId})
    RETURNING id
  `) as { id: string }[];

  await admin()`
    INSERT INTO awcms_whatsapp_delivery_attempts
      (tenant_id, message_id, attempt_no, outcome, provider_name)
    VALUES (${tenantId}, ${rows[0]!.id}, 1, 'failure', 'it')
  `;

  return rows[0]!.id;
}

async function statusOf(id: string): Promise<string> {
  return (
    (await admin()`SELECT status FROM awcms_whatsapp_messages WHERE id = ${id}`) as {
      status: string;
    }[]
  )[0]!.status;
}

function cancel(token: string, id: string) {
  return invoke<Envelope>(cancelMessage, {
    method: "POST",
    path: `/api/v1/whatsapp/messages/${id}/cancel`,
    headers: {
      "x-awcms-tenant-id": tenantId,
      authorization: `Bearer ${token}`
    },
    params: { id },
    locals: { correlationId: "corr-it1265" }
  });
}

function diagnostics(token: string) {
  return invoke<Envelope<DiagnosticsBody>>(getDiagnostics, {
    path: "/api/v1/whatsapp/diagnostics",
    headers: {
      "x-awcms-tenant-id": tenantId,
      authorization: `Bearer ${token}`
    },
    locals: { correlationId: "corr-it1265" }
  });
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite(
  "whatsapp message cancel and diagnostics are scope-confined (#1265)",
  () => {
    beforeAll(async () => {
      savedEnv.WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED;
      handlerReady = await ensureHandlerDatabaseReady();
    });

    afterAll(async () => {
      for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }

      await teardownHandlerDatabase();
    });

    beforeEach(async () => {
      expect(handlerReady, "the handler database must be available").toBe(true);
      await resetHandlerDatabase();
      await bootstrap();
    });

    test("cancel: a caller confined to brand A cannot cancel brand B's or an unscoped message, with the same answer as an unknown id", async () => {
      const officeA = await seedOffice("office-a");
      const officeB = await seedOffice("office-b");
      const operator = await seedUser("opa", KEYS);

      await holdScope(operator.tenantUserId, officeA);

      const own = await queueRow(officeA);
      const other = await queueRow(officeB);
      const unscoped = await queueRow(null);
      const unknown = "ffffffff-ffff-4fff-8fff-ffffffffffff";
      const answers: string[] = [];

      for (const id of [other, unscoped, unknown]) {
        const response = await cancel(operator.token, id);

        expect(response.status).toBe(409);
        answers.push(JSON.stringify(response.body));
      }

      expect(new Set(answers).size).toBe(1);
      expect(await statusOf(other)).toBe("queued");
      expect(await statusOf(unscoped)).toBe("queued");

      expect((await cancel(operator.token, own)).status).toBe(200);
      expect(await statusOf(own)).toBe("cancelled");
    });

    test("cancel: an unconfined caller may still cancel any brand's and unscoped messages", async () => {
      const officeB = await seedOffice("office-b");
      const admin1 = await seedUser("adm", KEYS);
      const other = await queueRow(officeB);
      const unscoped = await queueRow(null);

      expect((await cancel(admin1.token, other)).status).toBe(200);
      expect((await cancel(admin1.token, unscoped)).status).toBe(200);
      expect(await statusOf(other)).toBe("cancelled");
      expect(await statusOf(unscoped)).toBe("cancelled");
    });

    test("diagnostics: a confined caller sees only its own brand's rows; unscoped rows and tenant-wide totals are hidden", async () => {
      const officeA = await seedOffice("office-a");
      const officeB = await seedOffice("office-b");
      const operator = await seedUser("opa", KEYS);
      const unconfined = await seedUser("adm", KEYS);

      await holdScope(operator.tenantUserId, officeA);

      const own = await queueRow(officeA);
      const other = await queueRow(officeB);
      const unscoped = await queueRow(null);

      const confined = await diagnostics(operator.token);

      expect(confined.status).toBe(200);
      expect(confined.body.data!.messages.map((m) => m.id)).toEqual([own]);
      expect(confined.body.data!.attempts.map((a) => a.messageId)).toEqual([
        own
      ]);
      expect(confined.body.data!.summary.countsByStatus.queued).toBe(1);
      expect(confined.body.data!.summary.suppressions).toBeNull();
      expect(confined.body.data!.summary.grantedConsents).toBeNull();

      const all = await diagnostics(unconfined.token);

      expect(all.body.data!.messages.map((m) => m.id).sort()).toEqual(
        [own, other, unscoped].sort()
      );
      expect(all.body.data!.attempts).toHaveLength(3);
      expect(all.body.data!.summary.countsByStatus.queued).toBe(3);
      expect(all.body.data!.summary.suppressions).toBe(0);
    });
  }
);
