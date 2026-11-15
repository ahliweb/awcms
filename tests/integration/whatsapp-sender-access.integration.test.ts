/**
 * `PUT /whatsapp/sender-policy` and `GET /whatsapp/senders` respect the
 * per-account assignments and business-scope confinement of `channel_accounts`
 * (Issue #1233 M1, finding of the independent audit of Issue #1230), through the
 * real routes against a real PostgreSQL with real sessions.
 *
 * A holder confined to brand A cannot set another brand's or the tenant-wide
 * default, cannot bind a sender they cannot see (another brand's, or one that is
 * assigned to somebody else), and `GET` returns only the senders and policies
 * they may see. An unconfined administrator (holds `assignments.assign`) keeps
 * the break-glass view. Default-deny throughout.
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
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { PUT as putPolicy } from "../../src/pages/api/v1/whatsapp/sender-policy";
import { GET as getSenders } from "../../src/pages/api/v1/whatsapp/senders";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const READ_KEYS = ["whatsapp_delivery.senders.read"];
const WRITE_KEYS = [
  "whatsapp_delivery.senders.read",
  "whatsapp_delivery.sender_policy.configure"
];

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
};
type SendersBody = {
  senders: { senderAccountId: string | null }[];
  policies: { defaultSenderAccountId: string | null }[];
};

let tenantId = "";
let ownerToken = "";
let ownerTenantUserId = "";
let userCounter = 0;
let keyCounter = 0;
let phone = 2_000_000_000_000;
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
      tenantCode: "wa-access",
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

/** A connected WhatsApp number that is approved for every capability. */
async function seedSender(
  officeId: string | null,
  // #1215 M-c: the number is open to the tenant unless a test is about
  // ASSIGNMENT, which only restricts an `assigned` account.
  accessMode: "assigned" | "tenant_wide" = "tenant_wide"
): Promise<string> {
  phone += 1;
  // Issue #1143: a Meta number sends only as part of a live WABA container.
  const waba = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status, access_mode)
    VALUES (${tenantId}, 'whatsapp_cloud', 'waba', ${`waba-${phone}`},
            'waba', 'api_token', 'connected', 'tenant_wide')
    RETURNING id
  `) as { id: string }[];
  const rows = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, business_scope_type, business_scope_id, provider,
       account_kind, external_id, display_name, auth_mode, status,
       parent_account_id, access_mode)
    VALUES (${tenantId}, ${officeId ? "office" : null}, ${officeId},
            'whatsapp_cloud', 'waba_phone_number', ${String(phone)},
            ${`n-${phone}`}, 'api_token', 'connected', ${waba[0]!.id},
            ${accessMode})
    RETURNING id
  `) as { id: string }[];

  for (const capability of ["dm", "reply", "broadcast"]) {
    await admin()`
      INSERT INTO awcms_channel_account_capabilities
        (tenant_id, account_id, capability, state, evidence_kind,
         evidence_ref, matrix_version, verified_at)
      VALUES (${tenantId}, ${rows[0]!.id}, ${capability}, 'granted',
              'app_review_reference', 'evidence-1', ${PROVIDER_MATRIX_VERSION},
              now())
    `;
  }

  return rows[0]!.id;
}

async function queueRow(senderId: string | null, officeId: string | null) {
  keyCounter += 1;
  await admin()`
    INSERT INTO awcms_whatsapp_messages
      (tenant_id, idempotency_key, template_key, purpose, recipient,
       recipient_hash, recipient_masked, body, status, sender_account_id,
       sender_selection, business_scope_type, business_scope_id)
    VALUES (${tenantId}, ${`seed-${keyCounter}`}, 'it1233.t', 'transactional',
            '+6281234567890', 'k1:x', '+*', 'x', 'queued', ${senderId},
            ${senderId ? "explicit" : "deployment"},
            ${officeId ? "office" : null}, ${officeId})
  `;
}

async function seedPolicy(officeId: string | null, senderId: string | null) {
  await admin()`
    INSERT INTO awcms_whatsapp_sender_policies
      (tenant_id, business_scope_type, business_scope_id,
       default_sender_account_id)
    VALUES (${tenantId}, ${officeId ? "office" : null}, ${officeId}, ${senderId})
  `;
}

function put(
  token: string,
  body: {
    businessScope: { type: string; id: string } | null;
    sender: string | null;
  }
) {
  keyCounter += 1;

  return invoke<Envelope>(putPolicy, {
    method: "PUT",
    path: "/api/v1/whatsapp/sender-policy",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId,
      authorization: `Bearer ${token}`,
      "idempotency-key": `it1233-${keyCounter}-${crypto.randomUUID()}`
    },
    body: {
      businessScope: body.businessScope,
      defaultSenderAccountId: body.sender
    },
    locals: { correlationId: "corr-it1233" }
  });
}

function get(token: string) {
  return invoke<Envelope<SendersBody>>(getSenders, {
    path: "/api/v1/whatsapp/senders",
    headers: {
      "x-awcms-tenant-id": tenantId,
      authorization: `Bearer ${token}`
    },
    locals: { correlationId: "corr-it1233" }
  });
}

async function policyCount(): Promise<number> {
  return (
    (await admin()`SELECT count(*)::int AS n FROM awcms_whatsapp_sender_policies`) as {
      n: number;
    }[]
  )[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite(
  "whatsapp sender routes respect channel_accounts access (#1233 M1)",
  () => {
    beforeAll(async () => {
      for (const name of ["CHANNEL_ACCOUNTS_ENABLED", "WHATSAPP_ENABLED"]) {
        savedEnv[name] = process.env[name];
      }

      process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
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
      process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
      await resetHandlerDatabase();
      await bootstrap();
    });

    test("PUT: a caller confined to office A cannot set another office's default, the tenant-wide default, or bind a sender they cannot see", async () => {
      const officeA = await seedOffice("office-a");
      const officeB = await seedOffice("office-b");
      const operator = await seedUser("opa", WRITE_KEYS);

      await holdScope(operator.tenantUserId, officeA);

      const senderA = await seedSender(officeA);
      const senderB = await seedSender(officeB);
      const tenantWide = await seedSender(null);
      const assignedAway = await seedSender(null, "assigned");

      await admin()`
      INSERT INTO awcms_channel_account_assignments
        (tenant_id, account_id, tenant_user_id, kind)
      VALUES (${tenantId}, ${assignedAway}, ${ownerTenantUserId}, 'owner')
    `;

      const scopeA = { type: "office", id: officeA };
      const scopeB = { type: "office", id: officeB };

      // Another office's scope: refused for access, before anything is written.
      for (const [scope, sender] of [
        [scopeB, senderB],
        [scopeB, senderA],
        [scopeB, null]
      ] as const) {
        const response = await put(operator.token, {
          businessScope: scope,
          sender
        });

        expect(response.status).toBe(403);
        expect(response.body.error?.code).toBe("ACCESS_DENIED");
      }

      // Tenant-wide: a confined caller may not mint the default of everyone else.
      for (const sender of [tenantWide, null]) {
        const response = await put(operator.token, {
          businessScope: null,
          sender
        });

        expect(response.status).toBe(403);
        expect(response.body.error?.code).toBe("ACCESS_DENIED");
      }

      // Their own scope, but a sender they cannot see: ONE answer for a sender of
      // another office, one assigned to somebody else and one that does not exist.
      for (const sender of [
        senderB,
        assignedAway,
        "ffffffff-ffff-4fff-8fff-ffffffffffff"
      ]) {
        const response = await put(operator.token, {
          businessScope: scopeA,
          sender
        });

        expect(response.status).toBe(422);
        expect(response.body.error?.code).toBe("SENDER_UNAVAILABLE");
      }

      expect(await policyCount()).toBe(0);

      // What they may do: their own scope, a sender they can see.
      expect(
        (await put(operator.token, { businessScope: scopeA, sender: senderA }))
          .status
      ).toBe(200);
      expect(
        (
          await put(operator.token, {
            businessScope: scopeA,
            sender: tenantWide
          })
        ).status
      ).toBe(200);
      expect(await policyCount()).toBe(1);
    });

    test("PUT: a caller without the permission is 403 and writes nothing; an unconfined administrator may set the tenant-wide default", async () => {
      const sender = await seedSender(null);
      const readOnly = await seedUser("ro", READ_KEYS);

      expect(
        (await put(readOnly.token, { businessScope: null, sender })).status
      ).toBe(403);
      expect(await policyCount()).toBe(0);

      expect(
        (await put(ownerToken, { businessScope: null, sender })).status
      ).toBe(200);
      expect(await policyCount()).toBe(1);
    });

    test("PUT: an assigned sender may be bound by its operator, not by a mere viewer", async () => {
      const officeA = await seedOffice("office-a2");
      const viewer = await seedUser("viewer", WRITE_KEYS);
      const operator = await seedUser("operator", WRITE_KEYS);

      await holdScope(viewer.tenantUserId, officeA);
      await holdScope(operator.tenantUserId, officeA);

      const sender = await seedSender(officeA, "assigned");

      for (const [who, kind] of [
        [viewer, "viewer"],
        [operator, "operator"]
      ] as const) {
        await admin()`
        INSERT INTO awcms_channel_account_assignments
          (tenant_id, account_id, tenant_user_id, kind)
        VALUES (${tenantId}, ${sender}, ${who.tenantUserId}, ${kind})
      `;
      }

      const scope = { type: "office", id: officeA };

      expect(
        (await put(viewer.token, { businessScope: scope, sender })).status
      ).toBe(422);
      expect(
        (await put(operator.token, { businessScope: scope, sender })).status
      ).toBe(200);
    });

    test("GET: a confined caller sees only the senders and policies of their scope; the administrator has the assignment break-glass but needs a scope to see its senders", async () => {
      const officeA = await seedOffice("office-a3");
      const officeB = await seedOffice("office-b3");
      const operator = await seedUser("geta", READ_KEYS);

      await holdScope(operator.tenantUserId, officeA);

      const senderA = await seedSender(officeA);
      const senderB = await seedSender(officeB);
      const assignedAway = await seedSender(null, "assigned");

      await admin()`
      INSERT INTO awcms_channel_account_assignments
        (tenant_id, account_id, tenant_user_id, kind)
      VALUES (${tenantId}, ${assignedAway}, ${ownerTenantUserId}, 'owner')
    `;

      await queueRow(senderA, officeA);
      await queueRow(senderB, officeB);
      await queueRow(assignedAway, null);
      await queueRow(null, null);
      await seedPolicy(null, assignedAway);
      await seedPolicy(officeA, senderA);
      await seedPolicy(officeB, senderB);

      const confined = await get(operator.token);

      expect(confined.status).toBe(200);
      expect(confined.body.data!.senders.map((s) => s.senderAccountId)).toEqual(
        [senderA]
      );
      expect(
        confined.body.data!.policies.map((p) => p.defaultSenderAccountId)
      ).toEqual([senderA]);
      // Nothing of the other scopes leaks anywhere in the body.
      for (const hidden of [senderB, assignedAway]) {
        expect(JSON.stringify(confined.body)).not.toContain(hidden);
      }

      // The administrator (unconfined, holds `assignments.assign` tenant-wide) has the
      // break-glass over ASSIGNMENTS: the sender assigned to somebody else is
      // visible. Business scope is a separate rule of `channel_accounts` that the
      // bypass does not lift (a scoped account needs the scope itself; the same
      // reason `GET /channel-accounts/accounts` shows an unscoped holder only the
      // tenant-wide accounts), so the brand-scoped senders and policies stay out
      // until the administrator holds those scopes.
      const all = await get(ownerToken);

      expect(all.status).toBe(200);
      expect(
        all.body.data!.senders.map((s) => s.senderAccountId).sort()
      ).toEqual([null, assignedAway].sort());
      expect(
        all.body.data!.policies.map((p) => p.defaultSenderAccountId)
      ).toEqual([assignedAway]);

      // Holding the scopes brings them in (and, being scope-confined from then on,
      // the administrator loses the tenant-wide deployment lane and policy).
      await holdScope(ownerTenantUserId, officeA);
      await holdScope(ownerTenantUserId, officeB);

      const scoped = await get(ownerToken);

      expect(
        scoped.body.data!.senders.map((s) => s.senderAccountId).sort()
      ).toEqual([senderA, senderB, assignedAway].sort());
      expect(scoped.body.data!.policies).toHaveLength(2);
    });

    test("GET: no token is 401 and a user with no role is 403", async () => {
      const noRole = await seedUser("norole", []);

      expect(
        (
          await invoke(getSenders, {
            path: "/api/v1/whatsapp/senders",
            headers: { "x-awcms-tenant-id": tenantId }
          })
        ).status
      ).toBe(401);
      expect((await get(noRole.token)).status).toBe(403);
    });
  }
);
