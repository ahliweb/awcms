/**
 * `POST/GET /whatsapp/consents` and `POST /whatsapp/consents/{id}/withdraw`
 * against the business-scope rules of `channel_accounts` (Issue #1231 M4 and the
 * independent audit of PR #1258: M-1, L-1, L-2), through the real routes with
 * real sessions against a real PostgreSQL.
 *
 * - Recording a brand's opt-in needs that brand (403 otherwise); a caller
 *   confined to brands cannot record the tenant-level (unscoped) opt-in.
 * - A consent's `businessScopes` show only the brands the caller holds, in the
 *   list AND in the grant response.
 * - Withdrawal is tenant-wide and NOT scope-confined (owner decision), and its
 *   permission decision is written to the decision log.
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
import {
  GET as listConsentsRoute,
  POST as grantConsentRoute
} from "../../src/pages/api/v1/whatsapp/consents/index";
import { POST as withdrawConsentRoute } from "../../src/pages/api/v1/whatsapp/consents/[id]/withdraw";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const KEYS = [
  "whatsapp_delivery.consents.read",
  "whatsapp_delivery.consents.create",
  "whatsapp_delivery.consents.withdraw"
];
const PHONE = "+6281234567890";
const HASH_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 13 + 5) % 251)
).toString("base64");

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};
type Consent = {
  id: string;
  status: string;
  businessScopes: { type: string; id: string }[];
  unscopedGranted: boolean | null;
};

let tenantId = "";
let ownerToken = "";
let ownerTenantUserId = "";
let userCounter = 0;
const savedEnv: Record<string, string | undefined> = {};

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<void> {
  const loginIdentifier = "wa-consent-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "WA Consent Co",
      tenantCode: "wa-consent",
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
  ownerToken = login.body.data.token;

  const owner = (await admin()`
    SELECT id FROM awcms_tenant_users WHERE tenant_id = ${tenantId} LIMIT 1
  `) as { id: string }[];

  ownerTenantUserId = owner[0]!.id;
}

async function seedUser(
  label: string
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
  const token = `wac-${tag}-${Math.random().toString(36).slice(2)}`;

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

  for (const key of KEYS) {
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
      reason: "whatsapp consent access fixture"
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

async function holdScope(tenantUserId: string, officeId: string) {
  await admin()`
    INSERT INTO awcms_business_scope_assignments
      (tenant_id, tenant_user_id, scope_type, scope_id,
       granted_by_tenant_user_id)
    VALUES (${tenantId}, ${tenantUserId}, 'office', ${officeId},
            ${ownerTenantUserId})
  `;
}

function grant(
  token: string,
  businessScope: { type: string; id: string } | null
) {
  return invoke<Envelope<Consent>>(grantConsentRoute, {
    method: "POST",
    path: "/api/v1/whatsapp/consents",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId,
      authorization: `Bearer ${token}`
    },
    body: { phone: PHONE, source: "form", businessScope },
    locals: { correlationId: "corr-it1231" }
  });
}

function list(token: string) {
  return invoke<Envelope<{ entries: Consent[] }>>(listConsentsRoute, {
    path: "/api/v1/whatsapp/consents",
    headers: {
      "x-awcms-tenant-id": tenantId,
      authorization: `Bearer ${token}`
    },
    locals: { correlationId: "corr-it1231" }
  });
}

function withdraw(token: string, consentId: string) {
  return invoke<Envelope<Consent>>(withdrawConsentRoute, {
    method: "POST",
    path: `/api/v1/whatsapp/consents/${consentId}/withdraw`,
    params: { id: consentId },
    headers: {
      "x-awcms-tenant-id": tenantId,
      authorization: `Bearer ${token}`
    },
    locals: { correlationId: "corr-it1231" }
  });
}

async function consentRows(): Promise<number> {
  return (
    (await admin()`SELECT count(*)::int AS n FROM awcms_whatsapp_consents`) as {
      n: number;
    }[]
  )[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("whatsapp consent routes and business scope (#1231 M4)", () => {
  beforeAll(async () => {
    for (const name of [
      "CHANNEL_ACCOUNTS_ENABLED",
      "WHATSAPP_RECIPIENT_HASH_KEYS"
    ]) {
      savedEnv[name] = process.env[name];
    }

    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    process.env.WHATSAPP_RECIPIENT_HASH_KEYS = `k1:${HASH_KEY}`;
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

  test("a caller confined to office A cannot record office B's opt-in or the tenant-level one, and nothing is written", async () => {
    const officeA = await seedOffice("c-a");
    const officeB = await seedOffice("c-b");
    const operator = await seedUser("ca");

    await holdScope(operator.tenantUserId, officeA);

    for (const scope of [{ type: "office", id: officeB }, null]) {
      const response = await grant(operator.token, scope);

      expect(response.status).toBe(403);
      expect(response.body.error?.code).toBe("ACCESS_DENIED");
    }

    expect(await consentRows()).toBe(0);

    const allowed = await grant(operator.token, {
      type: "office",
      id: officeA
    });

    expect(allowed.status).toBe(200);
    expect(allowed.body.data!.businessScopes.map((s) => s.id)).toEqual([
      officeA
    ]);
    expect(allowed.body.data!.unscopedGranted).toBe(false);
  });

  test("an unknown or foreign office is refused before anything is written", async () => {
    const operator = await seedUser("cu");

    expect(
      (
        await grant(operator.token, {
          type: "office",
          id: "c1231000-0000-4000-8000-0000000000ee"
        })
      ).status
    ).toBe(403);
    expect(
      (
        await grant(operator.token, {
          type: "brand",
          id: "c1231000-0000-4000-8000-0000000000ee"
        })
      ).status
    ).toBe(403);
    expect(await consentRows()).toBe(0);
  });

  test("audit L-1: the list and the grant response show only the brands the caller holds", async () => {
    const officeA = await seedOffice("l-a");
    const officeB = await seedOffice("l-b");
    const operator = await seedUser("la");

    await holdScope(operator.tenantUserId, officeA);
    await holdScope(ownerTenantUserId, officeA);
    await holdScope(ownerTenantUserId, officeB);

    expect(
      (await grant(ownerToken, { type: "office", id: officeB })).status
    ).toBe(200);

    // The confined caller records office A on the same person's row: the
    // response must not reveal office B.
    const mine = await grant(operator.token, { type: "office", id: officeA });

    expect(mine.status).toBe(200);
    expect(mine.body.data!.businessScopes.map((s) => s.id)).toEqual([officeA]);
    expect(JSON.stringify(mine.body)).not.toContain(officeB);

    const confined = await list(operator.token);

    expect(confined.status).toBe(200);
    expect(confined.body.data!.entries).toHaveLength(1);
    expect(
      confined.body.data!.entries[0]!.businessScopes.map((s) => s.id)
    ).toEqual([officeA]);
    expect(JSON.stringify(confined.body)).not.toContain(officeB);

    const all = await list(ownerToken);

    expect(
      all.body.data!.entries[0]!.businessScopes.map((s) => s.id).sort()
    ).toEqual([officeA, officeB].sort());
  });

  test("audit L-2: withdrawal is tenant-wide and not scope-confined, and its decision is logged", async () => {
    const officeA = await seedOffice("w-a");
    const officeB = await seedOffice("w-b");
    const operator = await seedUser("wa");

    await holdScope(operator.tenantUserId, officeA);
    await holdScope(ownerTenantUserId, officeB);

    const granted = await grant(ownerToken, { type: "office", id: officeB });

    expect(granted.status).toBe(200);

    // Confined to office A, withdrawing an opt-in that covers only office B.
    const response = await withdraw(operator.token, granted.body.data!.id);

    expect(response.status).toBe(200);
    expect(response.body.data!.status).toBe("withdrawn");
    expect(response.body.data!.businessScopes).toEqual([]);

    const decisions = (await admin()`
      SELECT decision FROM awcms_abac_decision_logs
      WHERE tenant_id = ${tenantId}
        AND tenant_user_id = ${operator.tenantUserId}
        AND module_key = 'whatsapp_delivery'
        AND activity_code = 'consents' AND action = 'withdraw'
    `) as { decision: string }[];

    expect(decisions.map((d) => d.decision)).toContain("allow");
  });
});
