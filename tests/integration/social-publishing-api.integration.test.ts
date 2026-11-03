/**
 * The HTTP surface of `social_publishing`, driven through the REAL route
 * handlers against a real PostgreSQL (Issue #1145, ADR-0157) — WORLD 2 of the
 * harness.
 *
 * What this proves that the service-level suite cannot:
 *
 *   * default-deny: no token is 401, a user with no role is 403 on every route,
 *     and every guard BITES (a user holding every permission but one is refused
 *     that action), which also proves each guard names a permission the
 *     migration really seeded;
 *   * the deployment switch answers 503 only AFTER authorization (an
 *     unauthorised caller learns nothing about it);
 *   * the maker/checker rule, the idempotent replay and the key-reuse conflict;
 *   * another tenant's account is a uniform 422 and another tenant's
 *     publication a uniform 404;
 *   * schedule, cancel, retry and the rules and settings round trip, with the
 *     partial-failure facts visible per account;
 *   * no response, audit row, idempotency row or event ever carries a token.
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
import { createChannelAccountPortAdapter } from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import { grantRolePolicy } from "../../src/modules/identity-access/application/access-policy-writer";
import { dispatchSocialPublishQueue } from "../../src/modules/social-publishing/application/social-publish-dispatch";
import { socialPublishingModule } from "../../src/modules/social-publishing/module";
import {
  createSocialAdapterRegistry,
  registerSocialPublishAdapter,
  resetSocialPublishAdaptersForTests
} from "../../src/modules/social-publishing/infrastructure/social-adapter-registry";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as retryJob } from "../../src/pages/api/v1/social-publishing/jobs/[id]/retry";
import { GET as getPublication } from "../../src/pages/api/v1/social-publishing/publications/[id]/index";
import { POST as approvePublication } from "../../src/pages/api/v1/social-publishing/publications/[id]/approve";
import { POST as cancelPublication } from "../../src/pages/api/v1/social-publishing/publications/[id]/cancel";
import { POST as schedulePublication } from "../../src/pages/api/v1/social-publishing/publications/[id]/schedule";
import {
  GET as listPublications,
  POST as createPublication
} from "../../src/pages/api/v1/social-publishing/publications/index";
import { GET as listProviders } from "../../src/pages/api/v1/social-publishing/providers";
import { PATCH as patchRule } from "../../src/pages/api/v1/social-publishing/rules/[id]";
import {
  GET as listRules,
  POST as createRule
} from "../../src/pages/api/v1/social-publishing/rules/index";
import {
  GET as getSettings,
  PATCH as patchSettings
} from "../../src/pages/api/v1/social-publishing/settings";
import {
  FULL_CAPABILITIES,
  createFakeSocialAdapter
} from "../support/fake-social-publish-adapter";

const OWNER_PASSWORD = randomBytes(12).toString("hex") + "-Aa1!";
const BASE = "/api/v1/social-publishing";
const RING_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 251)
).toString("base64");
const OTHER_TENANT = "a1145000-0000-4000-8000-0000000000bb";

type Env = { tenantId: string; token: string };
type Envelope<T = any> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

let env: Env;
let keyCounter = 0;
let userCounter = 0;
let externalSeq = 7_000_000;
const savedEnv: Record<string, string | undefined> = {};
const admin = () => getHandlerAdminSql();
const fb = createFakeSocialAdapter("facebook", FULL_CAPABILITIES);
const li = createFakeSocialAdapter("linkedin", FULL_CAPABILITIES);

const nextKey = () => `idem-${(keyCounter += 1)}-${crypto.randomUUID()}`;

async function bootstrap(): Promise<Env> {
  const loginIdentifier = "sp-owner@example.com";
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "SP Co",
      tenantCode: "sp-co",
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

  return { tenantId, token: login.body.data.token };
}

/** A person with exactly `permissionKeys`. */
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
    VALUES (${tenantId}, 'person', ${`User ${tag}`}) RETURNING id
  `) as { id: string }[];
  const identity = (await sql`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${tag}@example.com`}, 'x') RETURNING id
  `) as { id: string }[];
  const tenantUser = (await sql`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const token = `sp-${tag}-${Math.random().toString(36).slice(2)}`;

  await sql`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level, last_authenticated_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '8 hours', 'aal1', now())
  `;

  if (permissionKeys.length > 0) {
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
        reason: "social publishing fixture"
      })
    );
  }

  return { token, tenantUserId: tenantUser[0]!.id };
}

const ALL_PERMISSIONS = (socialPublishingModule.permissions ?? []).map(
  (permission) =>
    `social_publishing.${permission.activityCode}.${permission.action}`
);
const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${RING_KEY}`
} as unknown as NodeJS.ProcessEnv);

if (!ring.ok) throw new Error(ring.reason);

const store = createKeyRingSecretStore(() => ring);

/** A connected publishing account with a stored token and a granted `publish` capability. */
async function seedAccount(
  tenantId: string,
  provider: "facebook" | "linkedin" = "facebook"
): Promise<{ id: string; token: string }> {
  const kind = provider === "facebook" ? "page" : "organization_page";
  const externalId = String((externalSeq += 1));
  const token = `API-TOKEN-${provider}-${externalId}`;
  const secret = await withTenantOrThrow(
    getHandlerDatabaseClient(),
    tenantId,
    (tx) =>
      store.put(tx, {
        tenantId,
        purpose: "provider_access_token",
        plaintext: token,
        createdBy: null
      })
  );
  const connection = (await admin()`
    INSERT INTO awcms_channel_provider_connections
      (tenant_id, provider, auth_mode, grant_state, access_secret_id)
    VALUES (${tenantId}, ${provider}, 'oauth2', 'active', ${secret.secretId})
    RETURNING id
  `) as { id: string }[];
  const account = (await admin()`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status, connection_id)
    VALUES (${tenantId}, ${provider}, ${kind}, ${externalId}, ${`n-${externalId}`},
            'oauth2', 'connected', ${connection[0]!.id})
    RETURNING id
  `) as { id: string }[];

  await admin()`
    INSERT INTO awcms_channel_account_capabilities
      (tenant_id, account_id, capability, state, evidence_kind, evidence_ref,
       matrix_version, verified_at)
    VALUES (${tenantId}, ${account[0]!.id}, 'publish', 'granted',
            'app_review_reference', 'evidence-1', ${PROVIDER_MATRIX_VERSION}, now())
  `;

  return { id: account[0]!.id, token };
}

function call<T = any>(
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
    locals: { correlationId: "corr-api-1145" }
  });
}

const createBody = (
  accountIds: string[],
  over: Record<string, unknown> = {}
) => ({
  title: "Headline",
  caption: "A caption for the world.",
  linkUrl: "https://cms.example/blog/sp-co/headline",
  accountIds,
  ...over
});

const publish = (
  accountIds: string[],
  over: Record<string, unknown> = {},
  token?: string | null,
  key?: string | null
) =>
  call(createPublication, {
    method: "POST",
    path: `${BASE}/publications`,
    body: createBody(accountIds, over),
    token,
    idempotencyKey: key
  });

async function persistedText(): Promise<string> {
  const rows = (await admin()`
    SELECT to_jsonb(t)::text AS row FROM awcms_social_publications t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_social_publish_jobs t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_social_publish_attempts t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_audit_events t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_idempotency_keys t
    UNION ALL SELECT to_jsonb(t)::text FROM awcms_domain_events t
  `) as { row: string }[];

  return rows.map((entry) => entry.row).join("\n");
}

const suite = integrationEnabled ? describe : describe.skip;
let handlerReady = false;

function dispatchAsApp(tenantId: string, minutes = 0) {
  const instant = new Date(Date.now() + minutes * 60_000 + 1000);

  return dispatchSocialPublishQueue(getHandlerDatabaseClient(), tenantId, {
    publishers: createChannelAccountPortAdapter({
      env: process.env as NodeJS.ProcessEnv
    }),
    credentials: createChannelSenderCredentialAdapter({
      store,
      env: process.env as NodeJS.ProcessEnv
    }),
    registry: createSocialAdapterRegistry([fb, li]),
    env: process.env as NodeJS.ProcessEnv,
    clock: () => instant
  });
}

suite("social_publishing HTTP surface (Issue #1145)", () => {
  beforeAll(async () => {
    for (const name of [
      "SOCIAL_PUBLISHING_ENABLED",
      "CHANNEL_ACCOUNTS_ENABLED",
      "CHANNEL_SECRETS_ENCRYPTION_KEYS"
    ]) {
      savedEnv[name] = process.env[name];
    }

    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    resetSocialPublishAdaptersForTests();

    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }

    await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;

    process.env.SOCIAL_PUBLISHING_ENABLED = "true";
    process.env.CHANNEL_ACCOUNTS_ENABLED = "true";
    process.env.CHANNEL_SECRETS_ENCRYPTION_KEYS = `k1:${RING_KEY}`;
    resetSocialPublishAdaptersForTests();
    registerSocialPublishAdapter(fb);
    registerSocialPublishAdapter(li);
    fb.calls.length = 0;
    li.calls.length = 0;
    await resetHandlerDatabase();
    env = await bootstrap();
  });

  const ROUTES: {
    name: string;
    permission: string;
    request: () => Promise<{ status: number; body: Envelope }>;
  }[] = [
    {
      name: "list publications",
      permission: "social_publishing.publications.read",
      request: () => call(listPublications, { path: `${BASE}/publications` })
    },
    {
      name: "get publication",
      permission: "social_publishing.publications.read",
      request: () =>
        call(getPublication, {
          path: `${BASE}/publications/${crypto.randomUUID()}`,
          params: { id: crypto.randomUUID() }
        })
    },
    {
      name: "list providers",
      permission: "social_publishing.publications.read",
      request: () => call(listProviders, { path: `${BASE}/providers` })
    },
    {
      name: "create publication",
      permission: "social_publishing.publications.publish",
      request: () => publish([crypto.randomUUID()])
    },
    {
      name: "approve",
      permission: "social_publishing.publications.approve",
      request: () =>
        call(approvePublication, {
          method: "POST",
          path: `${BASE}/publications/x/approve`,
          params: { id: crypto.randomUUID() }
        })
    },
    {
      name: "cancel",
      permission: "social_publishing.publications.cancel",
      request: () =>
        call(cancelPublication, {
          method: "POST",
          path: `${BASE}/publications/x/cancel`,
          params: { id: crypto.randomUUID() }
        })
    },
    {
      name: "schedule",
      permission: "social_publishing.publications.schedule",
      request: () =>
        call(schedulePublication, {
          method: "POST",
          path: `${BASE}/publications/x/schedule`,
          params: { id: crypto.randomUUID() },
          body: { notBefore: null }
        })
    },
    {
      name: "retry a job",
      permission: "social_publishing.jobs.retry",
      request: () =>
        call(retryJob, {
          method: "POST",
          path: `${BASE}/jobs/x/retry`,
          params: { id: crypto.randomUUID() }
        })
    },
    {
      name: "list rules",
      permission: "social_publishing.rules.read",
      request: () => call(listRules, { path: `${BASE}/rules` })
    },
    {
      name: "create rule",
      permission: "social_publishing.rules.configure",
      request: () =>
        call(createRule, {
          method: "POST",
          path: `${BASE}/rules`,
          body: { trigger: "post_published", accountId: crypto.randomUUID() }
        })
    },
    {
      name: "patch rule",
      permission: "social_publishing.rules.configure",
      request: () =>
        call(patchRule, {
          method: "PATCH",
          path: `${BASE}/rules/x`,
          params: { id: crypto.randomUUID() },
          body: { enabled: false }
        })
    },
    {
      name: "get settings",
      permission: "social_publishing.rules.read",
      request: () => call(getSettings, { path: `${BASE}/settings` })
    },
    {
      name: "patch settings",
      permission: "social_publishing.settings.configure",
      request: () =>
        call(patchSettings, {
          method: "PATCH",
          path: `${BASE}/settings`,
          body: { approvalRequired: true }
        })
    }
  ];

  test("every route is default-deny: no token is 401 and a user with no role is 403", async () => {
    const nobody = await seedUser(env.tenantId, "nobody", []);

    for (const route of ROUTES) {
      const original = env.token;

      env.token = "";
      const anonymous = await route.request();

      expect(anonymous.status, `${route.name} anonymous`).toBe(401);

      env.token = nobody.token;
      const denied = await route.request();

      expect(denied.status, `${route.name} no role`).toBe(403);
      env.token = original;
    }
  });

  test("every guard BITES: holding every permission but one is refused that action, and each permission is seeded", async () => {
    for (const route of ROUTES) {
      const others = ALL_PERMISSIONS.filter(
        (permission) => permission !== route.permission
      );
      const user = await seedUser(
        env.tenantId,
        `bite-${route.name.replace(/\W/g, "")}`,
        others
      );
      const original = env.token;

      env.token = user.token;
      const refused = await route.request();

      expect(refused.status, `${route.name} without ${route.permission}`).toBe(
        403
      );
      env.token = original;
    }

    // The owner holds the whole catalogue: the same requests are NOT refused
    // for lack of permission (they answer 4xx for their own reasons).
    for (const route of ROUTES) {
      const allowed = await route.request();

      expect(allowed.status, route.name).not.toBe(403);
      expect(allowed.status, route.name).not.toBe(401);
    }
  });

  test("the deployment switch answers 503 only AFTER authorization", async () => {
    const nobody = await seedUser(env.tenantId, "nobody", []);

    process.env.SOCIAL_PUBLISHING_ENABLED = "false";

    const original = env.token;

    for (const route of ROUTES) {
      env.token = original;
      expect((await route.request()).status, `${route.name} owner`).toBe(503);
      env.token = nobody.token;
      expect((await route.request()).status, `${route.name} nobody`).toBe(403);
    }

    env.token = original;
  });

  test("create, approve (maker and checker), dispatch, and a replay returns the stored response", async () => {
    const a = await seedAccount(env.tenantId, "facebook");
    const b = await seedAccount(env.tenantId, "linkedin");
    const key = nextKey();
    const created = await publish([a.id, b.id], {}, undefined, key);

    expect(created.status).toBe(201);
    expect(created.body.data.publication.state).toBe("pending_approval");
    expect(created.body.data.publication.status).toBe("pending_approval");
    expect(created.body.data.jobs).toHaveLength(2);
    expect(
      created.body.data.accounts.map(
        (account: { outcome: string }) => account.outcome
      )
    ).toEqual(["queued", "queued"]);

    const publicationId = created.body.data.publication.id as string;

    // The same key and request: the stored response, nothing new.
    const replay = await publish([a.id, b.id], {}, undefined, key);

    expect(replay.status).toBe(201);
    expect(replay.body.data.publication.id).toBe(publicationId);

    // The same key with another request is a conflict.
    const conflict = await publish(
      [a.id, b.id],
      { caption: "different" },
      undefined,
      key
    );

    expect(conflict.status).toBe(409);
    expect(conflict.body.error?.code).toBe("IDEMPOTENCY_CONFLICT");

    // Nothing is claimable before approval.
    expect((await dispatchAsApp(env.tenantId)).claimed).toBe(0);

    // The creator cannot approve their own manual publication.
    const self = await call(approvePublication, {
      method: "POST",
      path: `${BASE}/publications/${publicationId}/approve`,
      params: { id: publicationId }
    });

    expect(self.status).toBe(403);
    expect(self.body.error?.code).toBe("SELF_APPROVAL_FORBIDDEN");

    const checker = await seedUser(env.tenantId, "checker", [
      "social_publishing.publications.approve"
    ]);
    const approved = await call(approvePublication, {
      method: "POST",
      path: `${BASE}/publications/${publicationId}/approve`,
      params: { id: publicationId },
      token: checker.token
    });

    expect(approved.status).toBe(200);
    expect(approved.body.data.publication.state).toBe("ready");

    const again = await call(approvePublication, {
      method: "POST",
      path: `${BASE}/publications/${publicationId}/approve`,
      params: { id: publicationId },
      token: checker.token
    });

    expect(again.body.data.alreadyApproved).toBe(true);

    const run = await dispatchAsApp(env.tenantId);

    expect(run).toMatchObject({ claimed: 2, published: 2 });

    const detail = await call(getPublication, {
      path: `${BASE}/publications/${publicationId}`,
      params: { id: publicationId }
    });

    expect(detail.body.data.publication.status).toBe("published");
    expect(
      detail.body.data.jobs.every(
        (job: { status: string; externalPostId: string | null }) =>
          job.status === "published" && job.externalPostId !== null
      )
    ).toBe(true);

    // Each account was published with its own credential, and no token is
    // anywhere in what was stored or returned.
    expect(fb.calls[0]!.credential).toBe(a.token);
    expect(li.calls[0]!.credential).toBe(b.token);

    const text =
      (await persistedText()) + JSON.stringify([created.body, detail.body]);

    expect(text).not.toContain(a.token);
    expect(text).not.toContain(b.token);
  });

  test("another tenant's account is a uniform 422; an unknown or foreign publication a uniform 404", async () => {
    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${OTHER_TENANT}, 'sp-other', 'sp-other')
    `;

    const foreign = await seedAccount(OTHER_TENANT, "facebook");
    const own = await seedAccount(env.tenantId, "facebook");
    const mixed = await publish([own.id, foreign.id]);
    const unknown = await publish([own.id, crypto.randomUUID()]);

    expect(mixed.status).toBe(422);
    expect(unknown.status).toBe(422);
    expect(mixed.body.error?.code).toBe("ACCOUNT_NOT_USABLE");
    expect(unknown.body.error?.code).toBe("ACCOUNT_NOT_USABLE");
    expect(mixed.body.error?.message).toBe(unknown.body.error?.message);

    // Nothing was created by either refusal.
    const count = (await admin()`
      SELECT count(*)::int AS n FROM awcms_social_publications
    `) as { n: number }[];

    expect(count[0]!.n).toBe(0);

    // A publication of another tenant.
    const otherPub = (await admin()`
      INSERT INTO awcms_social_publications
        (tenant_id, source_kind, trigger_event, state, title, caption,
         content_hash, approval_required)
      VALUES (${OTHER_TENANT}, 'manual', 'manual_editor_action', 'ready', 'T', 'C',
              ${"a".repeat(64)}, false)
      RETURNING id
    `) as { id: string }[];

    for (const id of [otherPub[0]!.id, crypto.randomUUID()]) {
      const detail = await call(getPublication, {
        path: `${BASE}/publications/${id}`,
        params: { id }
      });
      const cancel = await call(cancelPublication, {
        method: "POST",
        path: `${BASE}/publications/${id}/cancel`,
        params: { id }
      });

      expect(detail.status).toBe(404);
      expect(cancel.status).toBe(404);
    }
  });

  test("refusals per account are returned with a code, and a request in which every account is refused records nothing", async () => {
    const good = await seedAccount(env.tenantId, "facebook");
    const bad = await seedAccount(env.tenantId, "linkedin");

    await admin()`UPDATE awcms_channel_accounts SET status = 'disabled' WHERE id = ${bad.id}`;

    const partial = await publish([good.id, bad.id]);

    expect(partial.status).toBe(201);
    expect(partial.body.data.accounts).toContainEqual(
      expect.objectContaining({
        accountId: bad.id,
        outcome: "refused",
        reason: "ACCOUNT_DISABLED"
      })
    );
    expect(partial.body.data.jobs).toHaveLength(1);

    const none = await publish([bad.id]);

    expect(none.status).toBe(422);
    expect(none.body.error?.code).toBe("NO_ELIGIBLE_ACCOUNT");
    expect(none.body.error?.details).toEqual([
      expect.objectContaining({ accountId: bad.id, outcome: "refused" })
    ]);

    // Credential-shaped and provider-shaped input is refused loudly.
    for (const field of ["token", "provider", "accessToken", "pageId"]) {
      const response = await publish([good.id], { [field]: "x" });

      expect(response.status, field).toBe(400);
    }
  });

  test("schedule, cancel and retry: only unsent work moves, and the per-account facts are visible", async () => {
    const x = await seedAccount(env.tenantId, "facebook");
    const y = await seedAccount(env.tenantId, "linkedin");

    await call(patchSettings, {
      method: "PATCH",
      path: `${BASE}/settings`,
      body: { approvalRequired: false }
    });

    li.setBehavior(() => ({ outcome: "rejected", errorCode: "POLICY_BLOCK" }));

    const created = await publish([x.id, y.id]);
    const id = created.body.data.publication.id as string;

    expect(created.body.data.publication.state).toBe("ready");

    // Schedule moves it while nothing was dispatched.
    const future = new Date(Date.now() + 3600_000).toISOString();
    const scheduled = await call(schedulePublication, {
      method: "POST",
      path: `${BASE}/publications/${id}/schedule`,
      params: { id },
      body: { notBefore: future }
    });

    expect(scheduled.status).toBe(200);
    expect((await dispatchAsApp(env.tenantId)).claimed).toBe(0);

    const cleared = await call(schedulePublication, {
      method: "POST",
      path: `${BASE}/publications/${id}/schedule`,
      params: { id },
      body: { notBefore: null }
    });

    expect(cleared.status).toBe(200);
    expect(
      (
        await call(schedulePublication, {
          method: "POST",
          path: `${BASE}/publications/${id}/schedule`,
          params: { id },
          body: { notBefore: "2020-01-01T00:00:00Z" }
        })
      ).status
    ).toBe(400);

    await dispatchAsApp(env.tenantId);

    const detail = await call(getPublication, {
      path: `${BASE}/publications/${id}`,
      params: { id }
    });
    const jobs = new Map<string, { id: string; status: string }>(
      detail.body.data.jobs.map(
        (job: { accountId: string; id: string; status: string }) => [
          job.accountId,
          job
        ]
      )
    );

    expect(jobs.get(x.id)!.status).toBe("published");
    expect(jobs.get(y.id)!.status).toBe("failed");
    expect(detail.body.data.publication.status).toBe("partially_published");

    // It has started: the schedule can no longer move.
    const late = await call(schedulePublication, {
      method: "POST",
      path: `${BASE}/publications/${id}/schedule`,
      params: { id },
      body: { notBefore: future }
    });

    expect(late.status).toBe(409);
    expect(late.body.error?.code).toBe("ALREADY_DISPATCHED");

    // A published job can never be retried; the failed one can.
    const publishedRetry = await call(retryJob, {
      method: "POST",
      path: `${BASE}/jobs/${jobs.get(x.id)!.id}/retry`,
      params: { id: jobs.get(x.id)!.id }
    });

    expect(publishedRetry.status).toBe(409);
    expect(publishedRetry.body.error?.code).toBe("JOB_ALREADY_PUBLISHED");

    li.setBehavior(() => ({
      outcome: "published",
      externalPostId: "fixed",
      externalPostUrl: "https://linkedin.example/p/fixed"
    }));

    const retried = await call(retryJob, {
      method: "POST",
      path: `${BASE}/jobs/${jobs.get(y.id)!.id}/retry`,
      params: { id: jobs.get(y.id)!.id }
    });

    expect(retried.status).toBe(200);
    await dispatchAsApp(env.tenantId, 30);
    expect(fb.calls).toHaveLength(1);

    // Cancelling now stops nothing (all sent) and reports what was out.
    const cancelled = await call(cancelPublication, {
      method: "POST",
      path: `${BASE}/publications/${id}/cancel`,
      params: { id },
      body: { reason: "late" }
    });

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({
      jobsCancelled: 0,
      jobsAlreadyPublished: 2,
      alreadyCancelled: false
    });

    const second = await call(cancelPublication, {
      method: "POST",
      path: `${BASE}/publications/${id}/cancel`,
      params: { id }
    });

    expect(second.body.data.alreadyCancelled).toBe(true);
  });

  test("rules and settings round trip; a rule needs a usable account; a disabled rule is listed, not deleted", async () => {
    const account = await seedAccount(env.tenantId, "facebook");
    const defaults = await call(getSettings, { path: `${BASE}/settings` });

    expect(defaults.body.data).toMatchObject({
      autoPublishEnabled: false,
      approvalRequired: true
    });

    const created = await call(createRule, {
      method: "POST",
      path: `${BASE}/rules`,
      body: { trigger: "post_published", accountId: account.id }
    });

    expect(created.status).toBe(201);

    const duplicate = await call(createRule, {
      method: "POST",
      path: `${BASE}/rules`,
      body: { trigger: "post_published", accountId: account.id }
    });

    // Re-adding re-enables the same row.
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.data.id).toBe(created.body.data.id);

    const nonsense = await call(createRule, {
      method: "POST",
      path: `${BASE}/rules`,
      body: { trigger: "post_published", accountId: crypto.randomUUID() }
    });

    expect(nonsense.status).toBe(422);

    const disabled = await call(patchRule, {
      method: "PATCH",
      path: `${BASE}/rules/${created.body.data.id}`,
      params: { id: created.body.data.id },
      body: { enabled: false }
    });

    expect(disabled.body.data.enabled).toBe(false);

    const listed = await call(listRules, { path: `${BASE}/rules` });

    expect(listed.body.data.items).toHaveLength(1);
    expect(listed.body.data.items[0].enabled).toBe(false);

    const settings = await call(patchSettings, {
      method: "PATCH",
      path: `${BASE}/settings`,
      body: { autoPublishEnabled: true }
    });

    expect(settings.body.data).toMatchObject({
      autoPublishEnabled: true,
      approvalRequired: true
    });
    expect(
      (
        await call(patchSettings, {
          method: "PATCH",
          path: `${BASE}/settings`,
          body: {}
        })
      ).status
    ).toBe(400);

    const audit = (await admin()`
      SELECT action, severity FROM awcms_audit_events
      WHERE module_key = 'social_publishing' ORDER BY created_at
    `) as { action: string; severity: string }[];

    expect(audit.map((row) => row.action)).toContain(
      "social_publishing.settings.configure"
    );
    expect(audit.map((row) => row.action)).toContain(
      "social_publishing.rule.configure"
    );
    expect(
      audit
        .filter((row) => row.action.endsWith(".configure"))
        .every((row) => row.severity === "warning")
    ).toBe(true);
  });

  test("the providers list is the adapter registry, empty when none is registered", async () => {
    const withAdapters = await call(listProviders, {
      path: `${BASE}/providers`
    });

    expect(
      withAdapters.body.data.items.map(
        (item: { provider: string }) => item.provider
      )
    ).toEqual(["facebook", "linkedin"]);

    resetSocialPublishAdaptersForTests();

    const none = await call(listProviders, { path: `${BASE}/providers` });

    expect(none.body.data.items).toEqual([]);

    // With no adapter a provider cannot publish: the account is refused.
    const account = await seedAccount(env.tenantId, "facebook");
    const refused = await publish([account.id]);

    expect(refused.status).toBe(422);
    expect(refused.body.error?.details).toEqual([
      expect.objectContaining({ reason: "PROVIDER_ADAPTER_UNAVAILABLE" })
    ]);
  });

  test("the list is keyset-paginated and rejects a bad cursor", async () => {
    const account = await seedAccount(env.tenantId, "facebook");

    for (let n = 0; n < 3; n += 1) {
      await publish([account.id], { caption: `Row ${n}` });
    }

    const first = await call(listPublications, {
      path: `${BASE}/publications`,
      query: "limit=2"
    });

    expect(first.body.data.items).toHaveLength(2);
    expect(first.body.data.nextCursor).not.toBeNull();

    const second = await call(listPublications, {
      path: `${BASE}/publications`,
      query: `limit=2&cursor=${first.body.data.nextCursor}`
    });

    expect(second.body.data.items).toHaveLength(1);
    expect(
      (
        await call(listPublications, {
          path: `${BASE}/publications`,
          query: "cursor=garbage"
        })
      ).status
    ).toBe(400);
    expect(
      (
        await call(listPublications, {
          path: `${BASE}/publications`,
          query: "limit=500"
        })
      ).status
    ).toBe(400);
  });
});
