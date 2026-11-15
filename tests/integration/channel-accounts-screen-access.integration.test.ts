/**
 * What the channel-account DETAIL screen decides for a caller, against a real
 * PostgreSQL and the real `loadAdminScreen` chokepoint (Issue #1154, ADR-0148
 * UP-08).
 *
 * The page used to carry these decisions in its frontmatter, where only a
 * source-text test could reach them. They are application functions now
 * (`resolveAccountDetailAccess`, `resolveSenderScreen`), and this proves what a
 * text test cannot:
 *
 *   * IDOR parity: another tenant's id, an unknown id and an account assigned to
 *     somebody else are ONE answer (`visible: false`), not three;
 *   * the two account actions are decided by their OWN authority: a person who
 *     holds `credentials.manage` and not `accounts.revoke` keeps the credential
 *     form and gets no disconnect, and the reverse;
 *   * assignment kind matters: a `viewer` sees an account and may do neither;
 *   * business scope matters: an account bound to an office is invisible to a
 *     caller who does not hold it, visible to one who does;
 *   * "make default" is withheld for a pending account, for a caller confined to
 *     business scopes on a tenant-wide account, and for a caller who may not act
 *     as `operator`; and the queue counts are `null` (not zero) for a caller who
 *     may not read sender diagnostics.
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
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { linkIdentityToPrincipal } from "../../src/modules/identity-access/application/principal-store";
import {
  resolveAccountDetailAccess,
  type AccountDetailAccess
} from "../../src/modules/channel-accounts/application/account-screen-access";
import {
  resolveSenderScreen,
  type SenderScreen
} from "../../src/modules/whatsapp-delivery/application/whatsapp-sender-screen";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const RING = `k1:${Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 9) % 251)
).toString("base64")}`;

/** Stored where a login credential would be: not a hash anything verifies, so the fixture person can never log in. */
const UNUSABLE_LOGIN_MARKER = "fixture-no-login";

const READ = "channel_accounts.accounts.read";
const REVOKE = "channel_accounts.accounts.revoke";
const CREDENTIAL = "channel_accounts.credentials.manage";
const POLICY = "whatsapp_delivery.sender_policy.configure";
const SENDERS = "whatsapp_delivery.senders.read";

type Env = {
  tenantId: string;
  ownerSessionHash: string;
  ownerTenantUserId: string;
};

let env: Env;
let userCounter = 0;
let accountCounter = 0;
let handlerReady = false;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "scr-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Screen Co",
      tenantCode: "scr-co",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: loginIdentifier,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  const tenantId = setup.body.data.tenantId;
  const owner = (await admin()`
    SELECT tu.id, tu.identity_id
    FROM awcms_tenant_users tu
    WHERE tu.tenant_id = ${tenantId} LIMIT 1
  `) as { id: string; identity_id: string }[];

  return {
    tenantId,
    ownerSessionHash: await insertSession(tenantId, owner[0]!.identity_id),
    ownerTenantUserId: owner[0]!.id
  };
}

/**
 * Opens a live session for an identity and returns ONLY its stored hash, which
 * is all the screen under test needs (`ssr.tokenHash`). The opaque value that
 * hashes to it is generated, used and dropped in here: it is never returned, so
 * nothing a fixture hands back can flow into the hash function.
 */
async function insertSession(
  tenantId: string,
  identityId: string
): Promise<string> {
  const opaque = `sess-${randomBytes(18).toString("hex")}`;
  const stored = hashSessionToken(opaque);

  await admin()`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at)
    VALUES (${tenantId}, ${identityId}, ${stored},
            now() + interval '8 hours', 'aal1', now())
  `;

  return stored;
}

/** A person with exactly `permissionKeys` and, optionally, an enrolled TOTP factor. */
async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[],
  options: { enrolled?: boolean } = {}
): Promise<{ sessionHash: string; tenantUserId: string }> {
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
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, ${UNUSABLE_LOGIN_MARKER})
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];

  if (options.enrolled) {
    const principalId = await linkIdentityToPrincipal(
      sql,
      identity[0]!.id,
      `${tag}@example.com`
    );

    await sql`
      INSERT INTO awcms_principal_mfa_factors
        (principal_id, factor_type, secret_ciphertext, status, last_used_step,
         activated_at)
      VALUES (${principalId}, 'totp', 'ciphertext-not-read', 'active', -1, now())
    `;
  }

  const sessionHash = await insertSession(tenantId, identity[0]!.id);

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

    if (!permission[0])
      throw new Error(`fixture: ${key} is not in the catalogue`);

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
      reason: "screen access fixture"
    })
  );

  return { sessionHash, tenantUserId: tenantUser[0]!.id };
}

async function seedOffice(code: string): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_offices (tenant_id, office_code, office_name)
    VALUES (${env.tenantId}, ${code}, ${`Office ${code}`})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function holdScope(tenantUserId: string, officeId: string) {
  await admin()`
    INSERT INTO awcms_business_scope_assignments
      (tenant_id, tenant_user_id, scope_type, scope_id, granted_by_tenant_user_id)
    VALUES (${env.tenantId}, ${tenantUserId}, 'office', ${officeId},
            ${env.ownerTenantUserId})
  `;
}

async function seedDevice(
  options: {
    status?: string;
    officeId?: string;
    accessMode?: "assigned" | "tenant_wide";
  } = {}
): Promise<string> {
  accountCounter += 1;
  const rows = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name, auth_mode,
       status, business_scope_type, business_scope_id, access_mode)
    VALUES (${env.tenantId}, 'starsender', 'device', ${`DEV-${accountCounter}`},
            ${`Device ${accountCounter}`}, 'device_key',
            ${options.status ?? "pending"},
            ${options.officeId ? "office" : null}, ${options.officeId ?? null},
            ${options.accessMode ?? "tenant_wide"})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function seedWhatsappNumber(status: string): Promise<string> {
  accountCounter += 1;
  const sql = admin();
  const waba = (await sql`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name, auth_mode, status, access_mode)
    VALUES (${env.tenantId}, 'whatsapp_cloud', 'waba', ${`9${accountCounter}00`},
            ${`WABA ${accountCounter}`}, 'api_token', 'connected', 'tenant_wide')
    RETURNING id
  `) as { id: string }[];
  const phone = (await sql`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name, auth_mode,
       parent_account_id, status, access_mode)
    VALUES (${env.tenantId}, 'whatsapp_cloud', 'waba_phone_number',
            ${`62811${accountCounter}000`}, ${`Number ${accountCounter}`},
            'api_token', ${waba[0]!.id}, ${status}, 'tenant_wide')
    RETURNING id
  `) as { id: string }[];

  return phone[0]!.id;
}

async function assign(accountId: string, tenantUserId: string, kind: string) {
  await admin()`
    INSERT INTO awcms_channel_account_assignments
      (tenant_id, account_id, tenant_user_id, kind, created_by)
    VALUES (${env.tenantId}, ${accountId}, ${tenantUserId}, ${kind},
            ${env.ownerTenantUserId})
  `;
}

/** Runs ONE screen the way `[id].astro` does: the real chokepoint, one transaction. */
async function screenFor<T>(
  sessionHash: string,
  tenantId: string,
  decide: (input: {
    context: Parameters<typeof resolveAccountDetailAccess>[0];
    can: Parameters<typeof resolveAccountDetailAccess>[2];
  }) => Promise<T>
): Promise<T | "denied" | "error"> {
  const outcome = await loadAdminScreen({
    ssr: {
      tenantId,
      tokenHash: sessionHash
    } as unknown as SsrContext,
    sql: getHandlerDatabaseClient(),
    workClass: "interactive",
    authorize: {
      moduleKey: "channel_accounts",
      activityCode: "accounts",
      action: "read"
    },
    load: async ({ tx, auth, can }) =>
      decide({
        context: {
          tx,
          tenantId,
          tokenHash: sessionHash,
          auth,
          now: new Date(),
          request: new Request("http://localhost/admin/channel-accounts"),
          clientAddress: "127.0.0.1"
        },
        can
      }),
    onError: () => {}
  });

  return outcome.state === "allowed" ? outcome.data : outcome.state;
}

function detailFor(
  sessionHash: string,
  accountId: string,
  tenantId = env.tenantId
) {
  return screenFor<AccountDetailAccess>(
    sessionHash,
    tenantId,
    ({ context, can }) =>
      resolveAccountDetailAccess(context, accountId, can, {})
  );
}

function senderFor(sessionHash: string, accountId: string, status: string) {
  return screenFor<SenderScreen>(
    sessionHash,
    env.tenantId,
    async ({ context, can }) =>
      resolveSenderScreen(
        context,
        {
          id: accountId,
          provider: "whatsapp_cloud",
          status,
          businessScope: null
        },
        (guard) => can({ ...guard })
      )
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("channel-account screen access decisions (Issue #1154)", () => {
  beforeAll(async () => {
    for (const name of [
      "CHANNEL_ACCOUNTS_ENABLED",
      "CHANNEL_SECRETS_ENCRYPTION_KEYS"
    ]) {
      savedEnv[name] = process.env[name];
    }

    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    process.env.CHANNEL_SECRETS_ENCRYPTION_KEYS = RING;
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
    if (!handlerReady) return;
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    process.env.CHANNEL_SECRETS_ENCRYPTION_KEYS = RING;
    await resetHandlerDatabase();
    env = await bootstrap();
  });

  test("another tenant's id, an unknown id and an unassigned account are ONE answer", async () => {
    if (!handlerReady) return;

    // `assigned` is the default (#1215 M-c); this fixture spells it out.
    const id = await seedDevice({ accessMode: "assigned" });
    const tenant2 = crypto.randomUUID();

    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${tenant2}, 'scr-two', 'Screen Two')
    `;

    const foreign = await seedUser(tenant2, "foreign", [READ, REVOKE]);
    const colleague = await seedUser(env.tenantId, "colleague", [READ]);

    const unknown = await detailFor(env.ownerSessionHash, crypto.randomUUID());
    const crossTenant = await detailFor(foreign.sessionHash, id, tenant2);

    expect(unknown).toEqual({ visible: false });
    expect(crossTenant).toEqual(unknown);

    // An `assigned` account nobody is assigned to is administrators-only: a
    // reader who is not an assignee gets the ONE answer...
    expect(await detailFor(colleague.sessionHash, id)).toEqual(unknown);
    expect(await detailFor(env.ownerSessionHash, id)).toMatchObject({
      visible: true
    });

    // ...until she is assigned, and the others still do not see it.
    await assign(id, env.ownerTenantUserId, "owner");
    await assign(id, colleague.tenantUserId, "viewer");

    expect(await detailFor(colleague.sessionHash, id)).toMatchObject({
      visible: true
    });

    const stranger = await seedUser(env.tenantId, "stranger", [READ]);

    expect(await detailFor(stranger.sessionHash, id)).toEqual(unknown);
  });

  test("credentials.manage without accounts.revoke keeps the credential form, and the reverse", async () => {
    if (!handlerReady) return;

    const id = await seedDevice();
    const credentialOnly = await seedUser(
      env.tenantId,
      "cred-only",
      [READ, CREDENTIAL],
      { enrolled: true }
    );
    const revokeOnly = await seedUser(env.tenantId, "revoke-only", [
      READ,
      REVOKE
    ]);

    expect(await detailFor(credentialOnly.sessionHash, id)).toMatchObject({
      visible: true,
      canReplaceCredential: true,
      canDisconnect: false,
      credentialFormWithheld: false
    });
    expect(await detailFor(revokeOnly.sessionHash, id)).toMatchObject({
      visible: true,
      canReplaceCredential: false,
      canDisconnect: true
    });
  });

  test("a holder of credentials.manage with no enrolled factor gets the explanation, not the form", async () => {
    if (!handlerReady) return;

    const id = await seedDevice();
    const unenrolled = await seedUser(env.tenantId, "no-mfa", [
      READ,
      CREDENTIAL
    ]);

    expect(await detailFor(unenrolled.sessionHash, id)).toMatchObject({
      visible: true,
      canReplaceCredential: false,
      credentialFormWithheld: true
    });
    // Without the key there is nothing to explain.
    const keyless = await seedUser(env.tenantId, "keyless", [READ]);

    expect(await detailFor(keyless.sessionHash, id)).toMatchObject({
      credentialFormWithheld: false
    });
  });

  test("the form is not offered for a disconnected account or an OAuth account", async () => {
    if (!handlerReady) return;

    const revoked = await seedDevice({ status: "revoked" });
    const enrolled = await seedUser(
      env.tenantId,
      "cred-rev",
      [READ, CREDENTIAL, REVOKE],
      { enrolled: true }
    );

    expect(await detailFor(enrolled.sessionHash, revoked)).toMatchObject({
      canReplaceCredential: false,
      canDisconnect: false
    });
  });

  test("assignment kind matters: a viewer sees the account and may do neither action", async () => {
    if (!handlerReady) return;

    const id = await seedDevice({ accessMode: "assigned" });
    const person = await seedUser(
      env.tenantId,
      "assigned",
      [READ, REVOKE, CREDENTIAL],
      { enrolled: true }
    );

    await assign(id, person.tenantUserId, "viewer");

    expect(await detailFor(person.sessionHash, id)).toMatchObject({
      visible: true,
      canDisconnect: false,
      canReplaceCredential: false
    });

    await admin()`
      UPDATE awcms_channel_account_assignments SET kind = 'owner'
      WHERE tenant_id = ${env.tenantId} AND account_id = ${id}
    `;

    expect(await detailFor(person.sessionHash, id)).toMatchObject({
      visible: true,
      canDisconnect: true,
      canReplaceCredential: true
    });
  });

  test("business scope: invisible to a caller who does not hold it, visible to one who does", async () => {
    if (!handlerReady) return;

    const mine = await seedOffice("mine");
    const theirs = await seedOffice("theirs");
    const scoped = await seedDevice({ officeId: theirs });
    const person = await seedUser(env.tenantId, "confined", [READ, REVOKE]);

    await holdScope(person.tenantUserId, mine);

    expect(await detailFor(person.sessionHash, scoped)).toEqual({
      visible: false
    });

    await holdScope(person.tenantUserId, theirs);

    expect(await detailFor(person.sessionHash, scoped)).toMatchObject({
      visible: true
    });
  });

  test("make default is withheld for a pending account, and the queue is null without senders.read", async () => {
    if (!handlerReady) return;

    const pending = await seedWhatsappNumber("pending");
    const connected = await seedWhatsappNumber("connected");
    const configurer = await seedUser(env.tenantId, "policy", [READ, POLICY]);
    const reader = await seedUser(env.tenantId, "senders", [READ, SENDERS]);

    expect(
      await senderFor(configurer.sessionHash, pending, "pending")
    ).toMatchObject({
      canMakeDefault: false
    });

    const asConfigurer = await senderFor(
      configurer.sessionHash,
      connected,
      "connected"
    );

    expect(asConfigurer).toMatchObject({
      canConfigure: true,
      canMakeDefault: true,
      waiting: null,
      sending: null
    });

    // Reading diagnostics gives real counts (zero here, because it is known),
    // and no action.
    expect(
      await senderFor(reader.sessionHash, connected, "connected")
    ).toMatchObject({
      canMakeDefault: false,
      isDefault: false,
      waiting: 0,
      sending: 0
    });
  });

  test("a caller confined to business scopes cannot make a tenant-wide account the default, nor learn it is one", async () => {
    if (!handlerReady) return;

    const connected = await seedWhatsappNumber("connected");
    const office = await seedOffice("sender-office");
    const confined = await seedUser(env.tenantId, "sender-confined", [
      READ,
      POLICY,
      SENDERS
    ]);

    await holdScope(confined.tenantUserId, office);

    expect(
      await senderFor(confined.sessionHash, connected, "connected")
    ).toMatchObject({ canMakeDefault: false, isDefault: null });
  });
});
