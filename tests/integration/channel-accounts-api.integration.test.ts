/**
 * The `/api/v1/channel-accounts/*` surface, driven through the REAL route
 * handlers against a real PostgreSQL (Issue #1140, ADR-0148) — WORLD 2 of the
 * harness.
 *
 * What this proves that the service-level suite cannot:
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every verb
 *     and writes nothing, and every guard BITES (a user holding every permission
 *     but one is refused that action);
 *   * the deployment switch answers 503 after authorization;
 *   * IDOR: an unknown id, another tenant's id and an unassigned account answer
 *     the same 404; a second tenant claiming an external id gets the same 409
 *     as a duplicate in its own tenant;
 *   * the credential endpoint: MFA enrolment required, step-up required for an
 *     enrolled holder, write-only, idempotent, and the canary never appears in a
 *     response, the audit log, the idempotency store or the database;
 *   * the OAuth start / callback fail closed.
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
import { linkIdentityToPrincipal } from "../../src/modules/identity-access/application/principal-store";
import { channelAccountsModule } from "../../src/modules/channel-accounts/module";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { GET as getProviders } from "../../src/pages/api/v1/channel-accounts/providers";
import {
  GET as listAccounts,
  POST as createAccount
} from "../../src/pages/api/v1/channel-accounts/accounts/index";
import {
  DELETE as deleteAccount,
  GET as getAccount,
  PATCH as patchAccount
} from "../../src/pages/api/v1/channel-accounts/accounts/[id]/index";
import { PUT as putCredential } from "../../src/pages/api/v1/channel-accounts/accounts/[id]/credential";
import { POST as disconnectAccount } from "../../src/pages/api/v1/channel-accounts/accounts/[id]/disconnect";
import { GET as getHealth } from "../../src/pages/api/v1/channel-accounts/accounts/[id]/health";
import { GET as listCapabilities } from "../../src/pages/api/v1/channel-accounts/accounts/[id]/capabilities/index";
import { PUT as putCapability } from "../../src/pages/api/v1/channel-accounts/accounts/[id]/capabilities/[capability]";
import {
  GET as listAssignments,
  POST as postAssignment
} from "../../src/pages/api/v1/channel-accounts/accounts/[id]/assignments/index";
import { GET as listConnections } from "../../src/pages/api/v1/channel-accounts/connections/index";
import { POST as createPolicyRoute } from "../../src/pages/api/v1/access/policies/index";
import { POST as enablePolicy } from "../../src/pages/api/v1/access/policies/[id]/enable";
import { rekeyChannelSecretsForTenant } from "../../src/modules/channel-accounts/application/secret-rekey";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { POST as revokeConnection } from "../../src/pages/api/v1/channel-accounts/connections/[id]/revoke";
import { POST as startOAuth } from "../../src/pages/api/v1/channel-accounts/connections/oauth/start";
import { GET as oauthCallback } from "../../src/pages/api/v1/channel-accounts/connections/oauth/callback";

// Built at runtime: GitGuardian scans every committed literal.
const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const CANARY = `CANARY-${randomBytes(10).toString("hex")}`;
const RING = `k1:${Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 9) % 251)
).toString("base64")}`;

type Env = { tenantId: string; token: string; ownerTenantUserId: string };

type Envelope<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

type Account = {
  id: string;
  status: string;
  hasCredential: boolean;
  externalId: string;
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;
const savedEnv: Record<string, string | undefined> = {};

function nextKey(): string {
  keyCounter += 1;

  return `idem-${keyCounter}-${crypto.randomUUID()}`;
}

const admin = () => getHandlerAdminSql();

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "ca-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "CA Co",
      tenantCode: "ca-co",
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

/** A person with exactly `permissionKeys`, an optional MFA factor and an aal1 or aal2 session. */
async function seedUser(
  tenantId: string,
  label: string,
  permissionKeys: readonly string[],
  options: { enrolled?: boolean; steppedUp?: boolean } = {}
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
  const token = `ca-${tag}-${Math.random().toString(36).slice(2)}`;

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

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       last_authenticated_at, stepped_up_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours',
            ${options.steppedUp ? "aal2" : "aal1"}, now(),
            ${options.steppedUp ? new Date() : null})
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
        reason: "channel accounts fixture"
      })
    );
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

const ALL_PERMISSIONS = (channelAccountsModule.permissions ?? []).map(
  (permission) =>
    `channel_accounts.${permission.activityCode}.${permission.action}`
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
    locals: { correlationId: "corr-api-1140" }
  });
}

const BASE = "/api/v1/channel-accounts";

function register(
  externalId: string,
  token?: string | null,
  extra: Record<string, unknown> = {},
  tenantId?: string
) {
  return call<Account>(createAccount, {
    method: "POST",
    path: `${BASE}/accounts`,
    token,
    tenantId,
    body: {
      provider: "starsender",
      accountKind: "device",
      authMode: "device_key",
      externalId,
      displayName: `Device ${externalId}`,
      ...extra
    }
  });
}

function credential(
  id: string,
  secret: string,
  token?: string | null,
  key?: string | null,
  extra: Record<string, unknown> = {}
) {
  return call<{ replaced: boolean; cipherVersion: number }>(putCredential, {
    method: "PUT",
    path: `${BASE}/accounts/${id}/credential`,
    params: { id },
    token,
    idempotencyKey: key,
    body: { secret, ...extra }
  });
}

async function everythingPersisted(): Promise<string> {
  const rows = (await admin()`
    SELECT to_jsonb(t)::text AS row FROM awcms_channel_accounts t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_channel_secrets t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_channel_provider_connections t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_channel_oauth_states t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_audit_events t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_idempotency_keys t
  `) as { row: string }[];

  return rows.map((entry) => entry.row).join("\n");
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

suite("channel_accounts HTTP surface (Issue #1140)", () => {
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

  test("default-deny: no token is 401; a user with no role is 403 on every verb and writes nothing", async () => {
    if (!handlerReady) return;

    const noRole = await seedUser(env.tenantId, "norole", []);
    const created = (await register("deny-dev")).body.data!;
    const id = created.id;

    expect(
      (await call(listAccounts, { path: `${BASE}/accounts`, token: null }))
        .status
    ).toBe(401);

    const attempts = [
      call(getProviders, { path: `${BASE}/providers`, token: noRole.token }),
      call(listAccounts, { path: `${BASE}/accounts`, token: noRole.token }),
      register("denied-dev", noRole.token),
      call(getAccount, {
        path: `${BASE}/accounts/${id}`,
        params: { id },
        token: noRole.token
      }),
      call(patchAccount, {
        method: "PATCH",
        path: `${BASE}/accounts/${id}`,
        params: { id },
        token: noRole.token,
        body: { displayName: "Hacked" }
      }),
      call(deleteAccount, {
        method: "DELETE",
        path: `${BASE}/accounts/${id}`,
        params: { id },
        token: noRole.token
      }),
      credential(id, "device-key-value-1", noRole.token),
      call(disconnectAccount, {
        method: "POST",
        path: `${BASE}/accounts/${id}/disconnect`,
        params: { id },
        token: noRole.token
      }),
      call(getHealth, {
        path: `${BASE}/accounts/${id}/health`,
        params: { id },
        token: noRole.token
      }),
      call(listCapabilities, {
        path: `${BASE}/accounts/${id}/capabilities`,
        params: { id },
        token: noRole.token
      }),
      call(putCapability, {
        method: "PUT",
        path: `${BASE}/accounts/${id}/capabilities/reply`,
        params: { id, capability: "reply" },
        token: noRole.token,
        body: { state: "denied" }
      }),
      call(listAssignments, {
        path: `${BASE}/accounts/${id}/assignments`,
        params: { id },
        token: noRole.token
      }),
      call(postAssignment, {
        method: "POST",
        path: `${BASE}/accounts/${id}/assignments`,
        params: { id },
        token: noRole.token,
        body: { tenantUserId: noRole.tenantUserId, kind: "owner" }
      }),
      call(listConnections, {
        path: `${BASE}/connections`,
        token: noRole.token
      }),
      call(startOAuth, {
        method: "POST",
        path: `${BASE}/connections/oauth/start`,
        token: noRole.token,
        body: { provider: "facebook", scopes: [] }
      }),
      call(oauthCallback, {
        path: `${BASE}/connections/oauth/callback`,
        query: "state=x",
        token: noRole.token
      })
    ];

    for (const response of await Promise.all(attempts)) {
      expect(response.status).toBe(403);
    }

    const rows = (await admin()`
      SELECT count(*)::int AS n FROM awcms_channel_accounts
      WHERE tenant_id = ${env.tenantId}
    `) as { n: number }[];

    expect(rows[0]!.n).toBe(1);
  });

  describe("every guard bites (seeded AND enforced)", () => {
    const actions: [
      string,
      (id: string, token: string) => Promise<{ status: number }>
    ][] = [
      [
        "channel_accounts.accounts.read",
        (id, token) =>
          call(getAccount, {
            path: `${BASE}/accounts/${id}`,
            params: { id },
            token
          })
      ],
      [
        "channel_accounts.accounts.create",
        (_id, token) => register("guard-new", token)
      ],
      [
        "channel_accounts.accounts.revoke",
        (id, token) =>
          call(disconnectAccount, {
            method: "POST",
            path: `${BASE}/accounts/${id}/disconnect`,
            params: { id },
            token
          })
      ],
      [
        "channel_accounts.capabilities.configure",
        (id, token) =>
          call(putCapability, {
            method: "PUT",
            path: `${BASE}/accounts/${id}/capabilities/reply`,
            params: { id, capability: "reply" },
            token,
            body: { state: "denied" }
          })
      ],
      [
        "channel_accounts.assignments.assign",
        (id, token) =>
          call(postAssignment, {
            method: "POST",
            path: `${BASE}/accounts/${id}/assignments`,
            params: { id },
            token,
            body: { tenantUserId: crypto.randomUUID(), kind: "viewer" }
          })
      ]
    ];

    test("the table covers every permission but the credential one (tested below)", () => {
      expect(actions.map(([key]) => key).sort()).toEqual(
        ALL_PERMISSIONS.filter(
          (key) => key !== "channel_accounts.credentials.manage"
        ).sort()
      );
    });

    for (const [permission, run] of actions) {
      test(`${permission}: refused without it, allowed with only it`, async () => {
        if (!handlerReady) return;

        const id = (await register("guard-dev")).body.data!.id;
        const without = await seedUser(
          env.tenantId,
          "without",
          ALL_PERMISSIONS.filter((key) => key !== permission)
        );
        const only = await seedUser(env.tenantId, "only", [permission]);

        expect((await run(id, without.token)).status).toBe(403);
        // "Allowed" means: past authorization. The action itself may then be a
        // 4xx/2xx of its own, but never the authorization refusal.
        expect((await run(id, only.token)).status).not.toBe(403);
      });
    }
  });

  test("the deployment switch answers 503 after authorization, and nothing is written", async () => {
    if (!handlerReady) return;

    process.env.CHANNEL_ACCOUNTS_ENABLED = "false";

    const noRole = await seedUser(env.tenantId, "norole", []);
    const off = await register("off-dev");

    expect(off.status).toBe(503);
    expect(off.body.error?.code).toBe("CHANNEL_ACCOUNTS_DISABLED");
    // An unauthorised caller learns nothing about the switch.
    expect((await register("off-dev", noRole.token)).status).toBe(403);

    const rows = (await admin()`
      SELECT count(*)::int AS n FROM awcms_channel_accounts
    `) as { n: number }[];

    expect(rows[0]!.n).toBe(0);
  });

  test("the provider matrix is served, with LinkedIn member data barred and not registrable", async () => {
    if (!handlerReady) return;

    const response = await call<{
      matrixVersion: number;
      providers: {
        provider: string;
        registrable: boolean;
        capabilityCells: Record<string, string>;
      }[];
    }>(getProviders, { path: `${BASE}/providers` });

    expect(response.status).toBe(200);

    const member = response.body.data!.providers.find(
      (p) => p.provider === "linkedin_member"
    )!;

    expect(member.registrable).toBe(false);
    expect(member.capabilityCells.leads).toBe("barred");
  });

  describe("registration", () => {
    test("creates a pending account; a malformed or credential-shaped body is refused without echo", async () => {
      if (!handlerReady) return;

      const ok = await register("reg-dev");

      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({
        status: "pending",
        hasCredential: false
      });
      expect(JSON.stringify(ok.body)).not.toMatch(
        /secret_id|secretId|ciphertext/
      );

      const bad = await register("reg-dev-2", undefined, { token: CANARY });

      expect(bad.status).toBe(400);
      expect(JSON.stringify(bad.body)).not.toContain(CANARY);

      expect(
        (await register("reg-dev-3", undefined, { provider: "ghost" })).status
      ).toBe(422);
      expect(
        (
          await register("reg-dev-4", undefined, {
            provider: "linkedin_member",
            accountKind: "member",
            authMode: "oauth2"
          })
        ).body.error?.code
      ).toBe("PROVIDER_NOT_REGISTRABLE");
    });

    test("a duplicate external account is 409, and another tenant's claim gets the identical answer", async () => {
      if (!handlerReady) return;

      await register("claimed-dev");

      const same = await register("claimed-dev");

      // A second tenant with its own administrator.
      const sql = admin();
      const tenant2 = crypto.randomUUID();

      await sql`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${tenant2}, 'ca-two', 'CA Two')
      `;

      const admin2 = await seedUser(tenant2, "admin2", ALL_PERMISSIONS);
      const other = await register("claimed-dev", admin2.token, {}, tenant2);

      expect(same.status).toBe(409);
      expect(other.status).toBe(409);
      expect(other.body.error).toEqual(same.body.error);
      expect(other.body.error?.code).toBe("ACCOUNT_ALREADY_REGISTERED");

      // No account was created for the claimant, and it cannot list the original.
      const listed = await call<{ items: Account[] }>(listAccounts, {
        path: `${BASE}/accounts`,
        token: admin2.token,
        tenantId: tenant2
      });

      expect(listed.body.data!.items).toHaveLength(0);
    });

    test("an Idempotency-Key is required, replays the stored 201, and conflicts on a different request", async () => {
      if (!handlerReady) return;

      expect((await register("idem-dev", env.token)).status).toBe(201);

      const body = {
        provider: "starsender",
        accountKind: "device",
        authMode: "device_key",
        externalId: "idem-dev-2",
        displayName: "Idem 2"
      };
      const key = nextKey();
      const first = await call<Account>(createAccount, {
        method: "POST",
        path: `${BASE}/accounts`,
        body,
        idempotencyKey: key
      });
      const replay = await call<Account>(createAccount, {
        method: "POST",
        path: `${BASE}/accounts`,
        body,
        idempotencyKey: key
      });
      const conflict = await call(createAccount, {
        method: "POST",
        path: `${BASE}/accounts`,
        body: { ...body, displayName: "Different" },
        idempotencyKey: key
      });
      const missing = await call(createAccount, {
        method: "POST",
        path: `${BASE}/accounts`,
        body,
        idempotencyKey: null
      });

      expect(first.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body.data!.id).toBe(first.body.data!.id);
      expect(conflict.status).toBe(409);
      expect(conflict.body.error?.code).toBe("IDEMPOTENCY_CONFLICT");
      expect(missing.status).toBe(400);
      expect(missing.body.error?.code).toBe("IDEMPOTENCY_REQUIRED");
    });
  });

  describe("per-account access (IDOR, assignment and uniform 404)", () => {
    test("an unknown id, another tenant's id and an unassigned account are the same 404", async () => {
      if (!handlerReady) return;

      const id = (await register("idor-dev")).body.data!.id;
      const sql = admin();
      const tenant2 = crypto.randomUUID();

      await sql`
        INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
        VALUES (${tenant2}, 'ca-idor', 'CA Idor')
      `;

      const foreign = await seedUser(tenant2, "foreign", ALL_PERMISSIONS);
      const colleague = await seedUser(env.tenantId, "colleague", [
        "channel_accounts.accounts.read"
      ]);

      const read = (token: string, tenantId: string, target: string) =>
        call(getAccount, {
          path: `${BASE}/accounts/${target}`,
          params: { id: target },
          token,
          tenantId
        });

      const unknown = await read(env.token, env.tenantId, crypto.randomUUID());
      const foreignRead = await read(foreign.token, tenant2, id);

      expect(unknown.status).toBe(404);
      expect(foreignRead.status).toBe(404);
      expect(foreignRead.body).toEqual(unknown.body);

      // Tenant-wide until the first assignment: a reader sees it...
      expect((await read(colleague.token, env.tenantId, id)).status).toBe(200);

      // ...then only its assignee and the assignment manager do.
      const assigned = await call(postAssignment, {
        method: "POST",
        path: `${BASE}/accounts/${id}/assignments`,
        params: { id },
        body: { tenantUserId: env.ownerTenantUserId, kind: "owner" }
      });

      expect(assigned.status).toBe(200);

      const hidden = await read(colleague.token, env.tenantId, id);

      expect(hidden.status).toBe(404);
      expect(hidden.body).toEqual(unknown.body);
      expect((await read(env.token, env.tenantId, id)).status).toBe(200);

      const colleagueList = await call<{ items: Account[] }>(listAccounts, {
        path: `${BASE}/accounts`,
        token: colleague.token
      });

      expect(colleagueList.body.data!.items).toHaveLength(0);

      // A person of another tenant cannot be assigned.
      const crossTenant = await call(postAssignment, {
        method: "POST",
        path: `${BASE}/accounts/${id}/assignments`,
        params: { id },
        body: { tenantUserId: foreign.tenantUserId, kind: "viewer" }
      });

      expect(crossTenant.status).toBe(422);
    });

    test("a non-uuid id is a 400, never a query", async () => {
      if (!handlerReady) return;

      const response = await call(getAccount, {
        path: `${BASE}/accounts/not-a-uuid`,
        params: { id: "not-a-uuid" }
      });

      expect(response.status).toBe(400);
    });
  });

  describe("the credential endpoint", () => {
    async function holder(options: { enrolled: boolean; steppedUp: boolean }) {
      return seedUser(
        env.tenantId,
        "cred",
        [
          "channel_accounts.credentials.manage",
          "channel_accounts.accounts.read"
        ],
        options
      );
    }

    test("a holder with no MFA factor is refused at the chokepoint, and nothing is stored", async () => {
      if (!handlerReady) return;

      const id = (await register("cred-dev")).body.data!.id;
      const noFactor = await holder({ enrolled: false, steppedUp: false });
      const response = await credential(id, CANARY, noFactor.token);

      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain(CANARY);
      expect(await everythingPersisted()).not.toContain(CANARY);
    });

    test("an enrolled holder without a fresh step-up is refused; with one it is stored and never echoed", async () => {
      if (!handlerReady) return;

      const id = (await register("cred-dev")).body.data!.id;
      const stale = await holder({ enrolled: true, steppedUp: false });
      const fresh = await holder({ enrolled: true, steppedUp: true });

      const refused = await credential(id, CANARY, stale.token);

      expect(refused.status).toBe(403);
      expect(refused.body.error?.code).toBe("STEP_UP_REQUIRED");

      const key = nextKey();
      const written = await credential(id, CANARY, fresh.token, key);

      expect(written.status).toBe(200);
      expect(written.body.data).toEqual({ replaced: false, cipherVersion: 1 });
      expect(JSON.stringify(written.body)).not.toContain(CANARY);

      // Replay with the same key and body: the stored answer, not a second write.
      const replay = await credential(id, CANARY, fresh.token, key);

      expect(replay.status).toBe(200);
      expect(replay.body).toEqual(written.body);

      // The same key with a different credential is a conflict (and stores nothing).
      const conflict = await credential(id, `${CANARY}-2`, fresh.token, key);

      expect(conflict.status).toBe(409);
      expect(JSON.stringify(conflict.body)).not.toContain(CANARY);

      // Replacing is a new request: same reference, version 2.
      const replaced = await credential(id, `${CANARY}-3`, fresh.token);

      expect(replaced.body.data).toEqual({ replaced: true, cipherVersion: 2 });

      // The account says only that a credential exists.
      const view = await call<Account>(getAccount, {
        path: `${BASE}/accounts/${id}`,
        params: { id }
      });

      expect(view.body.data!.hasCredential).toBe(true);

      // The canary is nowhere: not in a response, a row, the audit log or the idempotency store.
      const persisted = await everythingPersisted();

      expect(persisted).not.toContain(CANARY);

      const audit = (await admin()`
        SELECT severity, action, attributes::text AS attributes
        FROM awcms_audit_events
        WHERE action = 'channel_accounts.credential.write'
        ORDER BY created_at
      `) as { severity: string; action: string; attributes: string }[];

      expect(audit.length).toBe(2);
      expect(audit.every((row) => row.severity === "warning")).toBe(true);
    });

    test("an unknown field, a short value and a missing key are refused without echoing the value", async () => {
      if (!handlerReady) return;

      const id = (await register("cred-dev")).body.data!.id;
      const fresh = await holder({ enrolled: true, steppedUp: true });
      const extra = await credential(id, CANARY, fresh.token, undefined, {
        token: CANARY
      });
      const short = await credential(id, "short", fresh.token);
      const noKey = await credential(id, CANARY, fresh.token, null);

      expect(extra.status).toBe(400);
      expect(short.status).toBe(400);
      expect(noKey.status).toBe(400);

      for (const response of [extra, short, noKey]) {
        expect(JSON.stringify(response.body)).not.toContain(CANARY);
      }
    });

    test("without a key ring the endpoint fails closed with 503 and writes nothing", async () => {
      if (!handlerReady) return;

      const id = (await register("cred-dev")).body.data!.id;
      const fresh = await holder({ enrolled: true, steppedUp: true });

      delete process.env.CHANNEL_SECRETS_ENCRYPTION_KEYS;

      const response = await credential(id, CANARY, fresh.token);

      expect(response.status).toBe(503);
      expect(response.body.error?.code).toBe("SECRET_STORE_UNAVAILABLE");

      const rows = (await admin()`
        SELECT count(*)::int AS n FROM awcms_channel_secrets
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(0);
    });

    test("an OAuth account has no credential of its own", async () => {
      if (!handlerReady) return;

      // Insert a connection + oauth account directly (the connector flow is covered elsewhere).
      const sql = admin();
      const connection = (await sql`
        INSERT INTO awcms_channel_provider_connections
          (tenant_id, provider, auth_mode, grant_state)
        VALUES (${env.tenantId}, 'facebook', 'oauth2', 'active') RETURNING id
      `) as { id: string }[];
      const account = (await sql`
        INSERT INTO awcms_channel_accounts
          (tenant_id, provider, account_kind, external_id, display_name,
           auth_mode, connection_id)
        VALUES (${env.tenantId}, 'facebook', 'page', 'pg-1', 'Page 1',
                'oauth2', ${connection[0]!.id}) RETURNING id
      `) as { id: string }[];
      const fresh = await holder({ enrolled: true, steppedUp: true });
      const response = await credential(account[0]!.id, CANARY, fresh.token);

      expect(response.status).toBe(409);
      expect(response.body.error?.code).toBe("CREDENTIAL_NOT_APPLICABLE");
    });
  });

  describe("lifecycle", () => {
    test("disconnect revokes the account and erases its credential; delete is terminal and releases the id", async () => {
      if (!handlerReady) return;

      const id = (await register("life-dev")).body.data!.id;
      const fresh = await seedUser(
        env.tenantId,
        "lifecred",
        ["channel_accounts.credentials.manage"],
        { enrolled: true, steppedUp: true }
      );

      await credential(id, CANARY, fresh.token);

      const secrets = async () =>
        (
          (await admin()`SELECT count(*)::int AS n FROM awcms_channel_secrets`) as {
            n: number;
          }[]
        )[0]!.n;

      expect(await secrets()).toBe(1);

      const disconnected = await call<{
        account: Account;
        credentialErased: boolean;
      }>(disconnectAccount, {
        method: "POST",
        path: `${BASE}/accounts/${id}/disconnect`,
        params: { id }
      });

      expect(disconnected.status).toBe(200);
      expect(disconnected.body.data!.account).toMatchObject({
        status: "revoked",
        hasCredential: false
      });
      expect(disconnected.body.data!.credentialErased).toBe(true);
      expect(await secrets()).toBe(0);

      const again = await call(disconnectAccount, {
        method: "POST",
        path: `${BASE}/accounts/${id}/disconnect`,
        params: { id }
      });

      expect(again.status).toBe(409);

      const deleted = await call(deleteAccount, {
        method: "DELETE",
        path: `${BASE}/accounts/${id}`,
        params: { id }
      });

      expect(deleted.status).toBe(200);
      expect(
        (
          await call(getAccount, {
            path: `${BASE}/accounts/${id}`,
            params: { id }
          })
        ).status
      ).toBe(404);
      // The id can be registered again.
      expect((await register("life-dev")).status).toBe(201);
    });

    test("a connected account cannot be deleted; high-risk actions are audited at warning without external ids", async () => {
      if (!handlerReady) return;

      const id = (await register("warn-dev")).body.data!.id;

      await admin()`
        UPDATE awcms_channel_accounts SET status = 'connected', connected_at = now()
        WHERE id = ${id}
      `;

      const refused = await call(deleteAccount, {
        method: "DELETE",
        path: `${BASE}/accounts/${id}`,
        params: { id }
      });

      expect(refused.status).toBe(409);

      await call(disconnectAccount, {
        method: "POST",
        path: `${BASE}/accounts/${id}/disconnect`,
        params: { id }
      });

      const audit = (await admin()`
        SELECT action, severity, attributes::text AS attributes, message
        FROM awcms_audit_events WHERE module_key = 'channel_accounts'
      `) as {
        action: string;
        severity: string;
        attributes: string | null;
        message: string;
      }[];
      const disconnect = audit.find(
        (row) => row.action === "channel_accounts.account.disconnect"
      )!;

      expect(disconnect.severity).toBe("warning");

      for (const row of audit) {
        expect(`${row.attributes} ${row.message}`).not.toContain("warn-dev");
      }
    });
  });

  describe("capabilities and health", () => {
    test("absent means denied; an unsupported action is refused at write time; evidence is required to grant", async () => {
      if (!handlerReady) return;

      const id = (await register("cap-dev")).body.data!.id;
      const list = await call<{
        capabilities: {
          capability: string;
          state: string;
          effective: { allowed: boolean; code?: string };
        }[];
      }>(listCapabilities, {
        path: `${BASE}/accounts/${id}/capabilities`,
        params: { id }
      });

      expect(list.status).toBe(200);
      expect(list.body.data!.capabilities).toHaveLength(9);
      expect(
        list.body.data!.capabilities.every(
          (item) => item.state === "absent" && !item.effective.allowed
        )
      ).toBe(true);

      const put = (capability: string, body: unknown) =>
        call(putCapability, {
          method: "PUT",
          path: `${BASE}/accounts/${id}/capabilities/${capability}`,
          params: { id, capability },
          body
        });
      const evidence = {
        state: "granted",
        evidenceKind: "app_review_reference",
        evidenceRef: "review-1"
      };

      // StarSender cannot publish; inbound is unverified; broadcast is restricted.
      expect((await put("publish", evidence)).body.error?.code).toBe(
        "CAPABILITY_NOT_GRANTABLE"
      );
      expect((await put("inbound", evidence)).body.error?.code).toBe(
        "PROVIDER_UNVERIFIED"
      );
      expect((await put("broadcast", evidence)).body.error?.code).toBe(
        "PROVIDER_RESTRICTED"
      );
      expect((await put("reply", { state: "granted" })).status).toBe(400);
      expect((await put("teleport", evidence)).status).toBe(400);
      expect((await put("reply", evidence)).status).toBe(200);

      // Recorded, but a pending account still cannot use it.
      const after = await call<{
        capabilities: {
          capability: string;
          effective: { allowed: boolean; code?: string };
        }[];
      }>(listCapabilities, {
        path: `${BASE}/accounts/${id}/capabilities`,
        params: { id }
      });
      const reply = after.body.data!.capabilities.find(
        (item) => item.capability === "reply"
      )!;

      expect(reply.effective).toEqual({
        allowed: false,
        code: "ACCOUNT_NOT_USABLE"
      });
    });

    test("health is read-only and null until a connector reports", async () => {
      if (!handlerReady) return;

      const id = (await register("health-dev")).body.data!.id;
      const response = await call<{
        status: string;
        health: unknown;
      }>(getHealth, {
        path: `${BASE}/accounts/${id}/health`,
        params: { id }
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        status: "pending",
        health: null
      });
    });
  });

  describe("OAuth", () => {
    test("start is refused for a provider whose connector is not installed", async () => {
      if (!handlerReady) return;

      const response = await call(startOAuth, {
        method: "POST",
        path: `${BASE}/connections/oauth/start`,
        body: { provider: "facebook", scopes: ["pages_show_list"] }
      });

      expect(response.status).toBe(422);
      expect(response.body.error?.code).toBe("PROVIDER_ADAPTER_UNAVAILABLE");
    });

    test("start refuses a client-supplied redirect URI", async () => {
      if (!handlerReady) return;

      const response = await call(startOAuth, {
        method: "POST",
        path: `${BASE}/connections/oauth/start`,
        body: {
          provider: "facebook",
          scopes: [],
          redirectUri: "https://evil.example"
        }
      });

      expect(response.status).toBe(400);
    });

    test("the callback answers one STATE_INVALID for a missing, forged or foreign state", async () => {
      if (!handlerReady) return;

      for (const query of [
        "",
        "state=",
        `state=${env.tenantId}.${"A".repeat(43)}`,
        `state=${crypto.randomUUID()}.${"A".repeat(43)}&code=${CANARY}`
      ]) {
        const response = await call(oauthCallback, {
          path: `${BASE}/connections/oauth/callback`,
          query
        });

        expect(response.status).toBe(400);
        expect(response.body.error?.code).toBe("STATE_INVALID");
        expect(JSON.stringify(response.body)).not.toContain(CANARY);
      }

      expect(await everythingPersisted()).not.toContain(CANARY);
    });

    test("connections list is empty and never contains a credential field", async () => {
      if (!handlerReady) return;

      const response = await call<unknown[]>(listConnections, {
        path: `${BASE}/connections`
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
    });
  });
  describe("business scope and connection authority (ADR-0148 review M1, M2, M3)", () => {
    const OPERATOR_KEYS = [
      "channel_accounts.accounts.read",
      "channel_accounts.accounts.create",
      "channel_accounts.accounts.revoke"
    ];

    async function seedOffice(code: string): Promise<string> {
      const rows = (await admin()`
        INSERT INTO awcms_offices (tenant_id, office_code, office_name)
        VALUES (${env.tenantId}, ${code}, ${`Office ${code}`})
        RETURNING id
      `) as { id: string }[];

      return rows[0]!.id;
    }

    /** Confines a person to an office, as an active business-scope assignment. */
    async function holdScope(tenantUserId: string, officeId: string) {
      await admin()`
        INSERT INTO awcms_business_scope_assignments
          (tenant_id, tenant_user_id, scope_type, scope_id,
           granted_by_tenant_user_id)
        VALUES (${env.tenantId}, ${tenantUserId}, 'office', ${officeId},
                ${env.ownerTenantUserId})
      `;
    }

    async function seedConnection(
      options: {
        state?: string;
        officeId?: string;
        connectedBy?: string;
      } = {}
    ): Promise<string> {
      const rows = (await admin()`
        INSERT INTO awcms_channel_provider_connections
          (tenant_id, provider, auth_mode, grant_state, connected_by,
           business_scope_type, business_scope_id)
        VALUES (${env.tenantId}, 'facebook', 'oauth2',
                ${options.state ?? "failed"}, ${options.connectedBy ?? null},
                ${options.officeId ? "office" : null},
                ${options.officeId ?? null})
        RETURNING id
      `) as { id: string }[];

      return rows[0]!.id;
    }

    async function seedBoundAccount(
      connectionId: string,
      externalId: string,
      scope: { officeId: string } | null = null
    ): Promise<string> {
      const rows = (await admin()`
        INSERT INTO awcms_channel_accounts
          (tenant_id, provider, account_kind, external_id, display_name,
           auth_mode, connection_id, business_scope_type, business_scope_id)
        VALUES (${env.tenantId}, 'facebook', 'page', ${externalId},
                ${`Page ${externalId}`}, 'oauth2', ${connectionId},
                ${scope ? "office" : null}, ${scope?.officeId ?? null})
        RETURNING id
      `) as { id: string }[];

      return rows[0]!.id;
    }

    function assign(accountId: string, tenantUserId: string, kind: string) {
      return call(postAssignment, {
        method: "POST",
        path: `${BASE}/accounts/${accountId}/assignments`,
        params: { id: accountId },
        body: { tenantUserId, kind }
      });
    }

    function revoke(connectionId: string, token: string) {
      return call<{ accountsRevoked: number }>(revokeConnection, {
        method: "POST",
        path: `${BASE}/connections/${connectionId}/revoke`,
        params: { id: connectionId },
        token
      });
    }

    const grantState = async (connectionId: string) =>
      (
        (await admin()`
          SELECT grant_state FROM awcms_channel_provider_connections
          WHERE id = ${connectionId}
        `) as { grant_state: string }[]
      )[0]!.grant_state;

    test("revoking a connection needs owner authority over EVERY account it holds, else the uniform 404", async () => {
      if (!handlerReady) return;

      const operator = await seedUser(env.tenantId, "op", OPERATOR_KEYS);
      const connection = await seedConnection();
      const mine = await seedBoundAccount(connection, "page-mine");
      const theirs = await seedBoundAccount(connection, "page-theirs");

      expect((await assign(mine, operator.tenantUserId, "owner")).status).toBe(
        200
      );
      expect(
        (await assign(theirs, env.ownerTenantUserId, "owner")).status
      ).toBe(200);

      const unknown = await revoke(crypto.randomUUID(), operator.token);
      const refused = await revoke(connection, operator.token);

      expect(refused.status).toBe(404);
      expect(refused.body).toEqual(unknown.body);
      expect(await grantState(connection)).toBe("failed");

      // Operator on the second account is not enough: revoking needs `owner`.
      expect(
        (await assign(theirs, operator.tenantUserId, "operator")).status
      ).toBe(200);
      expect((await revoke(connection, operator.token)).status).toBe(404);
      expect(await grantState(connection)).toBe("failed");

      expect(
        (await assign(theirs, operator.tenantUserId, "owner")).status
      ).toBe(200);

      const done = await revoke(connection, operator.token);

      expect(done.status).toBe(200);
      expect(done.body.data!.accountsRevoked).toBe(2);
      expect(await grantState(connection)).toBe("revoked");
    });

    test("a connection holding a scoped account needs that scope to be revoked", async () => {
      if (!handlerReady) return;

      const office = await seedOffice("rev-office");
      const operator = await seedUser(env.tenantId, "scoped-op", OPERATOR_KEYS);
      const connection = await seedConnection();

      await seedBoundAccount(connection, "page-scoped", { officeId: office });

      const without = await revoke(connection, operator.token);

      expect(without.status).toBe(404);
      expect(await grantState(connection)).toBe("failed");

      await holdScope(operator.tenantUserId, office);

      expect((await revoke(connection, operator.token)).status).toBe(200);
      expect(await grantState(connection)).toBe("revoked");
    });

    test("the connections list hides a connection whose every account the caller cannot see", async () => {
      if (!handlerReady) return;

      const office = await seedOffice("list-office");
      const operator = await seedUser(env.tenantId, "list-op", OPERATOR_KEYS);
      const visible = await seedConnection();
      const assignedAway = await seedConnection();
      const scopedAway = await seedConnection();
      const empty = await seedConnection();

      await seedBoundAccount(visible, "list-visible");

      const away = await seedBoundAccount(assignedAway, "list-away");

      await assign(away, env.ownerTenantUserId, "owner");
      await seedBoundAccount(scopedAway, "list-scoped", { officeId: office });

      const list = (token: string) =>
        call<{ id: string }[]>(listConnections, {
          path: `${BASE}/connections`,
          token
        });
      const ids = (await list(operator.token)).body.data!.map((c) => c.id);

      // `empty` has no account and was not started by this person: not theirs.
      expect(ids).toEqual([visible]);

      await holdScope(operator.tenantUserId, office);

      const withScope = (await list(operator.token)).body.data!.map(
        (c) => c.id
      );

      expect(withScope.sort()).toEqual([visible, scopedAway].sort());

      // The tenant administrator (unconfined, holds assignments.assign) is
      // break-glass over every connection of the tenant.
      const ownerIds = (await list(env.token)).body.data!.map((c) => c.id);

      expect(ownerIds.sort()).toEqual(
        [visible, assignedAway, scopedAway, empty].sort()
      );
    });

    test("the accounts list and GET /accounts/{id} agree on business scope", async () => {
      if (!handlerReady) return;

      const office = await seedOffice("acct-office");
      const operator = await seedUser(env.tenantId, "acct-op", OPERATOR_KEYS);
      const connection = await seedConnection();
      const open = await seedBoundAccount(connection, "acct-open");
      const scoped = await seedBoundAccount(connection, "acct-scoped", {
        officeId: office
      });

      const listed = async () =>
        (
          await call<{ items: Account[] }>(listAccounts, {
            path: `${BASE}/accounts`,
            token: operator.token
          })
        ).body.data!.items.map((item) => item.id);
      const read = async (id: string) =>
        (
          await call(getAccount, {
            path: `${BASE}/accounts/${id}`,
            params: { id },
            token: operator.token
          })
        ).status;

      expect(await listed()).toEqual([open]);
      expect(await read(scoped)).toBe(404);

      await holdScope(operator.tenantUserId, office);

      expect((await listed()).sort()).toEqual([open, scoped].sort());
      expect(await read(scoped)).toBe(200);
    });

    test("a business scope in a request is authorised and verified, never trusted", async () => {
      if (!handlerReady) return;

      const heldOffice = await seedOffice("held-office");
      const otherOffice = await seedOffice("other-office");
      const operator = await seedUser(env.tenantId, "mint-op", OPERATOR_KEYS);
      const create = (token: string, scope: unknown, external: string) =>
        register(external, token, { businessScope: scope });

      // Nobody holds a scope yet: the owner (unconfined) names one it does not
      // hold and is refused, and names none and is allowed (tenant-wide).
      expect(
        (await create(env.token, { type: "office", id: heldOffice }, "own-1"))
          .status
      ).toBe(403);
      expect((await register("own-2")).status).toBe(201);

      await holdScope(operator.tenantUserId, heldOffice);

      // Confined: another office is refused, so is omitting the scope.
      expect(
        (
          await create(
            operator.token,
            { type: "office", id: otherOffice },
            "op-1"
          )
        ).status
      ).toBe(403);
      expect((await register("op-2", operator.token)).status).toBe(403);

      // The held office resolves and is allowed.
      const minted = await create(
        operator.token,
        { type: "office", id: heldOffice },
        "op-3"
      );

      expect(minted.status).toBe(201);

      // A held assignment to a scope that does not exist is still refused.
      const ghost = crypto.randomUUID();

      await holdScope(operator.tenantUserId, ghost);

      const unresolved = await create(
        operator.token,
        { type: "office", id: ghost },
        "op-4"
      );

      expect(unresolved.status).toBe(422);
      expect(unresolved.body.error?.code).toBe("SCOPE_UNRESOLVED");

      // Nothing was written for the refusals.
      const written = (await admin()`
        SELECT external_id FROM awcms_channel_accounts
        WHERE external_id IN ('own-1', 'op-1', 'op-2', 'op-4')
      `) as unknown[];

      expect(written).toHaveLength(0);

      // OAuth start takes the same gate, before it reaches any provider.
      const start = (token: string, scope: unknown) =>
        call(startOAuth, {
          method: "POST",
          path: `${BASE}/connections/oauth/start`,
          token,
          body: { provider: "facebook", scopes: [], businessScope: scope }
        });

      expect(
        (await start(operator.token, { type: "office", id: otherOffice }))
          .status
      ).toBe(403);
      expect((await start(operator.token, null)).status).toBe(403);
      // Allowed through the gate, then refused for want of an installed connector.
      expect(
        (await start(operator.token, { type: "office", id: heldOffice })).status
      ).toBe(422);
    });
    const facebookPage = (
      externalId: string,
      connectionId: string,
      officeId: string | null
    ) => ({
      provider: "facebook",
      accountKind: "page",
      authMode: "oauth2",
      externalId,
      displayName: `Page ${externalId}`,
      connectionId,
      businessScope: officeId ? { type: "office", id: officeId } : null
    });
    const bind = (token: string, body: Record<string, unknown>) =>
      call<Account>(createAccount, {
        method: "POST",
        path: `${BASE}/accounts`,
        token,
        body
      });

    test("H1: an operator of scope A cannot bind an account to scope B's connection, and the revocation cannot be vetoed", async () => {
      if (!handlerReady) return;

      const officeA = await seedOffice("h1-a");
      const officeB = await seedOffice("h1-b");
      const opA = await seedUser(env.tenantId, "h1-a", OPERATOR_KEYS);
      const opB = await seedUser(env.tenantId, "h1-b", OPERATOR_KEYS);

      await holdScope(opA.tenantUserId, officeA);
      await holdScope(opB.tenantUserId, officeB);

      const connection = await seedConnection({
        state: "active",
        officeId: officeB,
        connectedBy: opB.tenantUserId
      });

      // The PoC: A binds an account of its own scope to B's grant.
      const hijack = await bind(
        opA.token,
        facebookPage("h1-hijack", connection, officeA)
      );

      expect(hijack.status).toBe(422);
      expect(hijack.body.error?.code).toBe("CONNECTION_NOT_FOUND");

      const written = (await admin()`
        SELECT 1 FROM awcms_channel_accounts WHERE external_id = 'h1-hijack'
      `) as unknown[];

      expect(written).toHaveLength(0);

      // B (who holds the connection's scope) can bind.
      const mine = await bind(
        opB.token,
        facebookPage("h1-mine", connection, officeB)
      );

      expect(mine.status).toBe(201);

      // Someone else is assigned the account: no veto over the revocation.
      await assign(mine.body.data!.id, env.ownerTenantUserId, "owner");

      expect((await revoke(connection, opA.token)).status).toBe(404);
      expect(await grantState(connection)).toBe("active");

      const done = await revoke(connection, opB.token);

      expect(done.status).toBe(200);
      expect(done.body.data!.accountsRevoked).toBe(1);

      // The tenant administrator can revoke a scoped connection too.
      const other = await seedConnection({
        state: "active",
        officeId: officeB,
        connectedBy: opB.tenantUserId
      });

      await seedBoundAccount(other, "h1-other", { officeId: officeB });
      expect((await revoke(other, env.token)).status).toBe(200);
    });

    test("L5: a connection with no account belongs to whoever started it and to the administrator", async () => {
      if (!handlerReady) return;

      const starter = await seedUser(env.tenantId, "l5-start", OPERATOR_KEYS);
      const stranger = await seedUser(env.tenantId, "l5-other", OPERATOR_KEYS);
      const connection = await seedConnection({
        connectedBy: starter.tenantUserId
      });
      const seen = async (token: string) =>
        (
          await call<{ id: string }[]>(listConnections, {
            path: `${BASE}/connections`,
            token
          })
        ).body.data!.map((c) => c.id);

      expect(await seen(starter.token)).toEqual([connection]);
      expect(await seen(stranger.token)).toEqual([]);
      expect(await seen(env.token)).toEqual([connection]);

      expect((await revoke(connection, stranger.token)).status).toBe(404);
      expect(await grantState(connection)).toBe("failed");
      expect((await revoke(connection, starter.token)).status).toBe(200);
    });

    test("M-a: an ABAC deny on assignments.assign closes the assignment-visibility bypass", async () => {
      if (!handlerReady) return;

      const manager = await seedUser(env.tenantId, "ma-mgr", [
        ...OPERATOR_KEYS,
        "channel_accounts.assignments.assign"
      ]);
      const connection = await seedConnection();
      const account = await seedBoundAccount(connection, "ma-account");

      await assign(account, env.ownerTenantUserId, "owner");

      const read = () =>
        call(getAccount, {
          path: `${BASE}/accounts/${account}`,
          params: { id: account },
          token: manager.token
        });

      // Holding assignments.assign sees through the assignment...
      expect((await read()).status).toBe(200);

      // ...until an ABAC policy denies that action: the raw grant no longer counts.
      const policy = await call<{ policy: { id: string } }>(createPolicyRoute, {
        method: "POST",
        path: "/api/v1/access/policies",
        body: {
          policyCode: "test.deny-channel-assign",
          effect: "deny",
          moduleKey: "channel_accounts",
          activityCode: "assignments",
          action: "assign",
          conditions: { allOf: [] }
        }
      });

      expect(policy.status).toBe(200);

      const enabled = await call(enablePolicy, {
        method: "POST",
        path: `/api/v1/access/policies/${policy.body.data!.policy.id}/enable`,
        params: { id: policy.body.data!.policy.id }
      });

      expect(enabled.status).toBe(200);
      expect((await read()).status).toBe(404);
    });

    /** The API refuses an assignment on a scoped account to someone outside the scope; the fixture writes it directly. */
    async function assignDirect(
      accountId: string,
      tenantUserId: string,
      kind: string
    ) {
      await admin()`
        INSERT INTO awcms_channel_account_assignments
          (tenant_id, account_id, tenant_user_id, kind)
        VALUES (${env.tenantId}, ${accountId}, ${tenantUserId}, ${kind})
      `;
    }

    test("#1215 M1/L1: holding one business scope does not take the administrator's break-glass away, and an unconfined one still has it", async () => {
      if (!handlerReady) return;

      const officeA = await seedOffice("m1-a");
      const officeB = await seedOffice("m1-b");
      const opB = await seedUser(env.tenantId, "m1-b", OPERATOR_KEYS);

      await holdScope(opB.tenantUserId, officeB);

      const connection = () =>
        seedConnection({
          state: "active",
          officeId: officeB,
          connectedBy: opB.tenantUserId
        });
      const unconfined = await connection();
      const guarded = await connection();
      const idsFor = async (token: string) =>
        (
          await call<{ id: string }[]>(listConnections, {
            path: `${BASE}/connections`,
            token
          })
        ).body.data!.map((c) => c.id);

      // Someone else owns the only account, so only break-glass can reach it.
      for (const id of [unconfined, guarded]) {
        const account = await seedBoundAccount(id, `m1-${id}`, {
          officeId: officeB
        });

        await assignDirect(account, opB.tenantUserId, "owner");
      }

      // L1, the "not confined" side: the owner holds no scope at all.
      expect((await idsFor(env.token)).sort()).toEqual(
        [unconfined, guarded].sort()
      );
      expect((await revoke(unconfined, env.token)).status).toBe(200);

      // M1: now the owner is given scope A (and nothing else). Scope B's
      // connection stays reachable: break-glass is decided by the chokepoint on
      // the tenant-level permission, not by the existence of a scope row.
      await holdScope(env.ownerTenantUserId, officeA);

      expect((await idsFor(env.token)).sort()).toEqual(
        [unconfined, guarded].sort()
      );
      expect((await revoke(guarded, env.token)).status).toBe(200);
      expect(await grantState(guarded)).toBe("revoked");
    });

    test("#1215 M2: a colleague of the same scope cannot borrow the token of a connection whose accounts are someone else's", async () => {
      if (!handlerReady) return;

      const office = await seedOffice("m2-office");
      const first = await seedUser(env.tenantId, "m2-first", OPERATOR_KEYS);
      const second = await seedUser(env.tenantId, "m2-second", OPERATOR_KEYS);

      await holdScope(first.tenantUserId, office);
      await holdScope(second.tenantUserId, office);

      const connection = await seedConnection({
        state: "active",
        officeId: office,
        connectedBy: first.tenantUserId
      });
      const bound = await seedBoundAccount(connection, "m2-bound", {
        officeId: office
      });

      await assignDirect(bound, first.tenantUserId, "owner");

      const withdrawn = (await admin()`
        SELECT count(*)::int AS n FROM awcms_channel_accounts
        WHERE connection_id = ${connection}
      `) as { n: number }[];

      // The second holder of the scope shares it, but is not an owner of the
      // account bound to the connection: refused like an unknown connection.
      const borrowed = await bind(
        second.token,
        facebookPage("m2-borrow", connection, office)
      );
      const unknown = await bind(
        second.token,
        facebookPage("m2-borrow", crypto.randomUUID(), office)
      );

      expect(borrowed.status).toBe(422);
      expect(borrowed.body).toEqual(unknown.body);

      const after = (await admin()`
        SELECT count(*)::int AS n FROM awcms_channel_accounts
        WHERE connection_id = ${connection}
      `) as { n: number }[];

      expect(after[0]!.n).toBe(withdrawn[0]!.n);

      // The owner of the bound account may extend its own connection; so may the
      // tenant administrator.
      expect(
        (await bind(first.token, facebookPage("m2-mine", connection, office)))
          .status
      ).toBe(201);
      expect(
        (await bind(env.token, facebookPage("m2-admin", connection, null)))
          .status
      ).toBe(201);
    });

    test("#1215 M3: one GET /connections writes a decision-log row count that does not grow with the connections", async () => {
      if (!handlerReady) return;

      const office = await seedOffice("m3-office");
      const operator = await seedUser(env.tenantId, "m3-op", OPERATOR_KEYS);

      await holdScope(operator.tenantUserId, office);

      const rowsWrittenByOneList = async () => {
        const count = async () =>
          (
            (await admin()`
              SELECT count(*)::int AS n FROM awcms_abac_decision_logs
              WHERE tenant_id = ${env.tenantId}
            `) as { n: number }[]
          )[0]!.n;
        const before = await count();
        const list = await call<{ id: string }[]>(listConnections, {
          path: `${BASE}/connections`,
          token: operator.token
        });

        expect(list.status).toBe(200);

        return {
          rows: (await count()) - before,
          listed: list.body.data!.length
        };
      };
      const addScopedConnections = async (howMany: number, tag: string) => {
        for (let i = 0; i < howMany; i += 1) {
          const id = await seedConnection({
            state: "active",
            officeId: office
          });

          await seedBoundAccount(id, `m3-${tag}-${i}`, { officeId: office });

          // Not visible through any account (none): reached only through the
          // per-connection break-glass check, the path that used to log per row.
          await seedConnection({ state: "active", officeId: office });
        }
      };

      await addScopedConnections(2, "few");

      const few = await rowsWrittenByOneList();

      await addScopedConnections(10, "many");

      const many = await rowsWrittenByOneList();

      expect(few.listed).toBe(4);
      expect(many.listed).toBe(24);
      expect(many.rows).toBe(few.rows);
      expect(many.rows).toBeLessThanOrEqual(6);
    });

    test("#1215 L2: a connection of another provider answers the same as one that does not exist", async () => {
      if (!handlerReady) return;

      const connection = await seedConnection({ state: "active" });
      const mismatched = await call<Account>(createAccount, {
        method: "POST",
        path: `${BASE}/accounts`,
        body: {
          provider: "instagram",
          accountKind: "professional_account",
          authMode: "oauth2",
          externalId: "l2-mismatch",
          displayName: "Page l2",
          connectionId: connection
        }
      });
      const unknown = await call<Account>(createAccount, {
        method: "POST",
        path: `${BASE}/accounts`,
        body: {
          provider: "instagram",
          accountKind: "professional_account",
          authMode: "oauth2",
          externalId: "l2-mismatch",
          displayName: "Page l2",
          connectionId: crypto.randomUUID()
        }
      });

      expect(mismatched.status).toBe(422);
      expect(mismatched.body).toEqual(unknown.body);
      expect(mismatched.body.error?.code).toBe("CONNECTION_NOT_FOUND");
    });

    test("M-b: a credential written under an upper-case tenant header rekeys under the canonical id", async () => {
      if (!handlerReady) return;

      const id = (await register("case-dev")).body.data!.id;
      const holder = await seedUser(
        env.tenantId,
        "case",
        ["channel_accounts.credentials.manage"],
        { enrolled: true, steppedUp: true }
      );
      const written = await call(putCredential, {
        method: "PUT",
        path: `${BASE}/accounts/${id}/credential`,
        params: { id },
        token: holder.token,
        tenantId: env.tenantId.toUpperCase(),
        body: { secret: CANARY }
      });

      expect(written.status).toBe(200);

      const rotated = resolveChannelSecretsRing({
        CHANNEL_SECRETS_ENCRYPTION_KEYS: `k2:${Buffer.from(
          Array.from({ length: 32 }, (_, i) => (i * 17 + 5) % 251)
        ).toString("base64")},${RING}`
      } as unknown as NodeJS.ProcessEnv);

      if (!rotated.ok) throw new Error(rotated.reason);

      expect(
        await rekeyChannelSecretsForTenant(
          getHandlerDatabaseClient(),
          env.tenantId,
          rotated
        )
      ).toEqual({ converted: 1, failed: 0, complete: true });
    });
  });
});
