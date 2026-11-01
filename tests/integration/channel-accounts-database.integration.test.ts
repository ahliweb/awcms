/**
 * `channel_accounts` against a real PostgreSQL (Issue #1140, ADR-0148) — WORLD 1
 * of the harness: the migrations ran as a demoted table owner and every call
 * below goes through the least-privilege runtime role, so RLS `FORCE` is
 * actually observed.
 *
 * Proves what the unit tests cannot:
 *
 *   * two tenants each bind several same-platform accounts, enumerate only their
 *     own, and cannot read, change or claim the other's (IDOR, cross-tenant
 *     claim of an external id, RLS `WITH CHECK`);
 *   * a credential is stored as ciphertext bound to tenant/row/purpose, never
 *     appears in a row or a view in plaintext, is erased on disconnect and
 *     revoke, and is re-encrypted by the rotation job;
 *   * the OAuth state is single-use and bound to tenant and person (wrong
 *     person, wrong tenant, expired, replayed and racing callbacks), and a
 *     refresh race has exactly one winner;
 *   * a revoked token / connection denies every capability on the next check;
 *   * the integrity triggers and CHECKs refuse what the application never does.
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

import {
  assertRejected,
  assertRejectedInSavepoint,
  createRuntimePool,
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  assignAccount,
  createAccount,
  deleteAccount,
  disconnectAccount,
  fetchAccountHealth,
  fetchAccountRecord,
  isAccountVisibleTo,
  listAccounts,
  recordAccountHealth,
  toPublicAccount,
  updateAccount,
  writeAccountCredential
} from "../../src/modules/channel-accounts/application/account-directory";
import {
  listAccountCapabilities,
  resolveCapability,
  setAccountCapability
} from "../../src/modules/channel-accounts/application/capability-directory";
import {
  acquireRefreshLease,
  activateConnectionGrant,
  completeOAuthCallback,
  completeRefresh,
  failConnectionGrant,
  failRefresh,
  fetchConnection,
  revokeConnection,
  startOAuthGrant,
  sweepExpiredOAuthStates
} from "../../src/modules/channel-accounts/application/connection-directory";
import {
  clearChannelOAuthAdaptersForTests,
  registerChannelOAuthAdapter
} from "../../src/modules/channel-accounts/application/oauth-adapter-registry";
import {
  countChannelSecretsByKeyId,
  rekeyChannelSecretsBatch,
  rekeyChannelSecretsForTenant
} from "../../src/modules/channel-accounts/application/secret-rekey";
import {
  createKeyRingSecretStore,
  resetSecretDecryptCounts,
  snapshotSecretDecryptCounts
} from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";

const T1 = "c1140000-0000-4000-8000-000000000001";
const T2 = "c1140000-0000-4000-8000-000000000002";
const U1 = "c1140000-0000-4000-8000-000000000101";
const U1B = "c1140000-0000-4000-8000-000000000102";
const U2 = "c1140000-0000-4000-8000-000000000201";
const CANARY = "CANARY-tok-9f3a7c1e5b2d4a60";
const CANARY_CODE = "CANARY-code-77c1d09ab3e44f12";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 3) % 251)
  ).toString("base64");
const K1 = bytes(7);
const K2 = bytes(13);

function ringOf(spec: string) {
  const ring = resolveChannelSecretsRing({
    CHANNEL_SECRETS_ENCRYPTION_KEYS: spec
  } as unknown as NodeJS.ProcessEnv);

  if (!ring.ok) throw new Error(ring.reason);

  return ring;
}

const RING = ringOf(`k1:${K1}`);
const ROTATED = ringOf(`k2:${K2},k1:${K1}`);
const store = createKeyRingSecretStore(() => RING);
const ENV = {
  APP_URL: "https://cms.example.test"
} as unknown as NodeJS.ProcessEnv;

const inTenant = <T>(tenantId: string, work: (tx: Bun.SQL) => Promise<T>) =>
  withTenantOrThrow(getRuntimeSql(), tenantId, (tx) => work(tx));

async function seedTenant(
  tenantId: string,
  code: string,
  users: [string, string][]
): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${code})
  `;

  for (const [userId, login] of users) {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenantId}, 'person', ${login}) RETURNING id
    `) as { id: string }[];
    const identity = (await admin`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenantId}, ${profile[0]!.id}, ${`${login}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];

    await admin`
      INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
      VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
    `;
  }
}

async function page(
  tenantId: string,
  actor: string,
  externalId: string,
  extra: Partial<Parameters<typeof createAccount>[3]> = {}
) {
  return inTenant(tenantId, (tx) =>
    createAccount(tx, tenantId, actor, {
      provider: "starsender",
      accountKind: "device",
      authMode: "device_key",
      externalId,
      displayName: `Device ${externalId}`,
      businessScope: null,
      connectionId: null,
      parentAccountId: null,
      ...extra
    })
  );
}

async function created(
  tenantId: string,
  actor: string,
  externalId: string,
  extra: Partial<Parameters<typeof createAccount>[3]> = {}
): Promise<string> {
  const result = await page(tenantId, actor, externalId, extra);

  if (result.outcome !== "created") {
    throw new Error(`fixture: ${JSON.stringify(result)}`);
  }

  return result.account.id;
}

/** A fake connector: the only provider-specific piece this module needs to START a flow. */
function registerFakeAdapter(supportsPkce = true) {
  registerChannelOAuthAdapter({
    provider: "facebook",
    supportsPkce,
    buildAuthorizationUrl: ({ state, codeChallenge, redirectUri, scopes }) => {
      const url = new URL("https://provider.example.test/authorize");

      url.searchParams.set("state", state);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("scope", scopes.join(" "));

      if (codeChallenge) {
        url.searchParams.set("code_challenge", codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
      }

      return url.toString();
    }
  });
}

async function startFlow(
  tenantId: string,
  actor: string,
  now = new Date()
): Promise<string> {
  const result = await inTenant(tenantId, (tx) =>
    startOAuthGrant(
      tx,
      store,
      tenantId,
      actor,
      {
        provider: "facebook",
        scopes: ["pages_show_list"],
        businessScope: null
      },
      now,
      ENV
    )
  );

  if (result.outcome !== "started") throw new Error(JSON.stringify(result));

  return new URL(result.authorizationUrl).searchParams.get("state")!;
}

function callback(
  tenantId: string,
  actor: string,
  stateParam: string,
  now = new Date(),
  code: string | null = CANARY_CODE
) {
  return inTenant(tenantId, (tx) =>
    completeOAuthCallback(
      tx,
      store,
      tenantId,
      actor,
      { stateParam, code, providerError: false },
      now,
      ENV
    )
  );
}

async function activeConnection(
  tenantId: string,
  actor: string
): Promise<string> {
  registerFakeAdapter();

  const state = await startFlow(tenantId, actor);
  const handed = await callback(tenantId, actor, state);

  if (handed.outcome !== "handed_off") throw new Error(JSON.stringify(handed));

  const activated = await inTenant(tenantId, (tx) =>
    activateConnectionGrant(
      tx,
      store,
      tenantId,
      handed.connectionId,
      {
        accessToken: CANARY,
        refreshToken: `${CANARY}-refresh`,
        expiresAt: new Date(Date.now() + 3600_000),
        refreshExpiresAt: null,
        grantedScopes: ["pages_show_list", "pages_manage_posts"]
      },
      new Date()
    )
  );

  expect(activated).toEqual({ outcome: "activated" });

  return handed.connectionId;
}

async function secretCount(tenantId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_channel_secrets WHERE tenant_id = ${tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("channel_accounts database behaviour (Issue #1140)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    clearChannelOAuthAdaptersForTests();
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    clearChannelOAuthAdaptersForTests();
    resetSecretDecryptCounts();
    await seedTenant(T1, "ca-one", [
      [U1, "u1"],
      [U1B, "u1b"]
    ]);
    await seedTenant(T2, "ca-two", [[U2, "u2"]]);
  });

  describe("tenancy", () => {
    test("two tenants each bind several same-platform accounts and enumerate only their own", async () => {
      for (const external of ["dev-a", "dev-b", "dev-c"]) {
        await created(T1, U1, external);
      }

      for (const external of ["dev-x", "dev-y"]) {
        await created(T2, U2, external);
      }

      const query = { provider: null, status: null, limit: 50, cursor: null };
      const one = await inTenant(T1, (tx) =>
        listAccounts(tx, T1, { tenantUserId: U1, bypass: false }, query)
      );
      const two = await inTenant(T2, (tx) =>
        listAccounts(tx, T2, { tenantUserId: U2, bypass: false }, query)
      );

      expect(one.ok && one.items.map((item) => item.externalId).sort()).toEqual(
        ["dev-a", "dev-b", "dev-c"]
      );
      expect(two.ok && two.items.map((item) => item.externalId).sort()).toEqual(
        ["dev-x", "dev-y"]
      );
    });

    test("a second tenant claiming a live external account is refused, with the same answer as a duplicate in the same tenant", async () => {
      await created(T1, U1, "shared-device");

      const other = await page(T2, U2, "shared-device");
      const same = await page(T1, U1, "shared-device");

      expect(other).toEqual({
        outcome: "refused",
        code: "ACCOUNT_ALREADY_REGISTERED"
      });
      expect(same).toEqual(other);

      // Nothing was created for the claimant.
      const rows = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_channel_accounts WHERE tenant_id = ${T2}
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(0);
    });

    test("the same external id is a different account on a different provider", async () => {
      await created(T1, U1, "12345");

      const other = await page(T2, U2, "12345", {
        provider: "telegram",
        accountKind: "bot",
        authMode: "bot_token"
      });

      expect(other.outcome).toBe("created");
    });

    test("a deleted account releases its external id for another tenant", async () => {
      const id = await created(T1, U1, "recyclable");

      expect(
        await inTenant(T1, (tx) => deleteAccount(tx, store, T1, U1, id))
      ).toEqual({ outcome: "deleted" });
      expect((await page(T2, U2, "recyclable")).outcome).toBe("created");
    });

    test("account enumeration and IDOR: another tenant's id reads, updates and deletes as not found", async () => {
      const id = await created(T1, U1, "private-dev");

      expect(
        await inTenant(T2, (tx) => fetchAccountRecord(tx, T2, id))
      ).toBeNull();
      expect(
        await inTenant(T2, (tx) =>
          updateAccount(tx, T2, U2, id, { displayName: "Hijack", status: null })
        )
      ).toEqual({ outcome: "not_found" });
      expect(
        await inTenant(T2, (tx) => deleteAccount(tx, store, T2, U2, id))
      ).toEqual({ outcome: "not_found" });
      expect(
        await inTenant(T2, (tx) =>
          writeAccountCredential(tx, store, T2, U2, id, CANARY)
        )
      ).toEqual({ outcome: "not_found" });
      expect(
        await inTenant(T2, (tx) => listAccountCapabilities(tx, T2, id))
      ).toBeNull();
      expect(
        await inTenant(T2, (tx) => resolveCapability(tx, T2, id, "reply"))
      ).toEqual({ allowed: false, code: "ACCOUNT_NOT_FOUND" });

      const stillThere = await inTenant(T1, (tx) =>
        fetchAccountRecord(tx, T1, id)
      );

      expect(stillThere?.displayName).toBe("Device private-dev");
    });

    test("RLS under the runtime role: raw reads see one tenant, and a write for another tenant is refused", async () => {
      await created(T1, U1, "rls-1");
      await created(T2, U2, "rls-2");

      const seen = await inTenant(T1, async (tx) => {
        const rows = (await tx`
          SELECT tenant_id FROM awcms_channel_accounts
        `) as { tenant_id: string }[];

        return rows.map((row) => row.tenant_id);
      });

      expect(seen).toEqual([T1]);

      await inTenant(T1, async (tx) => {
        await assertRejectedInSavepoint(
          tx as unknown as Bun.TransactionSQL,
          (sp) => sp`
            INSERT INTO awcms_channel_accounts
              (tenant_id, provider, account_kind, external_id, display_name, auth_mode)
            VALUES (${T2}, 'starsender', 'device', 'forged', 'Forged', 'device_key')
          `,
          "an account insert for another tenant"
        );
      });
    });

    test("every channel_accounts table has row-level security enabled AND forced", async () => {
      const rows = (await getAdminSql()`
        SELECT relname, relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname LIKE 'awcms_channel_%' AND relkind = 'r'
      `) as {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }[];

      expect(rows.length).toBe(8);

      for (const row of rows) {
        expect(row.relrowsecurity, row.relname).toBe(true);
        expect(row.relforcerowsecurity, row.relname).toBe(true);
      }
    });

    test("a cross-tenant parent, connection and secret reference are refused by the composite foreign keys", async () => {
      const foreign = await created(T2, U2, "foreign-parent");
      const admin = getAdminSql();

      const error = await assertRejected(
        admin`
          INSERT INTO awcms_channel_accounts
            (tenant_id, provider, account_kind, external_id, display_name,
             auth_mode, parent_account_id)
          VALUES (${T1}, 'starsender', 'device', 'child', 'Child',
                  'device_key', ${foreign})
        `,
        "a parent account of another tenant"
      );

      expect(error.message).toContain("foreign key");
    });
  });

  describe("account shape", () => {
    test("provider, kind and authentication mode must be a combination the matrix admits", async () => {
      for (const [provider, accountKind, authMode, code] of [
        ["ghost", "x", "api_token", "PROVIDER_UNKNOWN"],
        ["linkedin_member", "member", "oauth2", "PROVIDER_NOT_REGISTRABLE"],
        ["starsender", "page", "device_key", "ACCOUNT_KIND_INVALID"],
        ["mailketing", "esp_account", "oauth2", "AUTH_MODE_INVALID"]
      ] as const) {
        expect(
          await page(T1, U1, "shape", { provider, accountKind, authMode })
        ).toEqual({ outcome: "refused", code });
      }
    });

    test("a WABA phone number needs its WABA as parent; a phone number can have no phone number as parent", async () => {
      const phoneShape = {
        provider: "whatsapp_cloud",
        accountKind: "waba_phone_number",
        authMode: "api_token" as const
      };

      expect(await page(T1, U1, "pn-1", phoneShape)).toEqual({
        outcome: "refused",
        code: "PARENT_REQUIRED"
      });

      const waba = await created(T1, U1, "waba-1", {
        provider: "whatsapp_cloud",
        accountKind: "waba",
        authMode: "api_token"
      });
      const phone = await created(T1, U1, "pn-1", {
        ...phoneShape,
        parentAccountId: waba
      });

      expect(
        await page(T1, U1, "pn-2", { ...phoneShape, parentAccountId: phone })
      ).toEqual({ outcome: "refused", code: "PARENT_INVALID" });

      // Five phone numbers under one WABA are five accounts.
      for (const n of [2, 3, 4, 5]) {
        await created(T1, U1, `pn-${n}`, {
          ...phoneShape,
          parentAccountId: waba
        });
      }

      expect(
        await inTenant(T1, (tx) => deleteAccount(tx, store, T1, U1, waba))
      ).toEqual({ outcome: "refused", code: "HAS_CHILD_ACCOUNTS" });
    });

    test("an OAuth account needs a connection of its own provider; a token account may not claim one", async () => {
      registerFakeAdapter();

      const connection = await activeConnection(T1, U1);
      const facebookPage = {
        provider: "facebook",
        accountKind: "page",
        authMode: "oauth2" as const
      };

      expect(await page(T1, U1, "pg-1", facebookPage)).toEqual({
        outcome: "refused",
        code: "CONNECTION_REQUIRED"
      });
      expect(
        await page(T1, U1, "pg-1", {
          ...facebookPage,
          provider: "threads",
          accountKind: "profile",
          connectionId: connection
        })
      ).toEqual({ outcome: "refused", code: "CONNECTION_MISMATCH" });
      expect(await page(T1, U1, "pg-1", { connectionId: connection })).toEqual({
        outcome: "refused",
        code: "CONNECTION_MISMATCH"
      });

      // One connection exposes several pages: the token holder is not the account.
      for (const external of ["pg-1", "pg-2", "pg-3"]) {
        await created(T1, U1, external, {
          ...facebookPage,
          connectionId: connection
        });
      }

      // Another tenant cannot attach to it.
      expect(
        await page(T2, U2, "pg-9", {
          ...facebookPage,
          connectionId: connection
        })
      ).toEqual({ outcome: "refused", code: "CONNECTION_NOT_FOUND" });
    });
  });

  describe("credentials", () => {
    test("a credential is stored as ciphertext bound to its row, and is in no view", async () => {
      const id = await created(T1, U1, "secret-dev");
      const result = await inTenant(T1, (tx) =>
        writeAccountCredential(tx, store, T1, U1, id, CANARY)
      );

      expect(result).toEqual({
        outcome: "written",
        replaced: false,
        version: 1
      });

      const rows = (await getAdminSql()`
        SELECT s.id, s.purpose, s.ciphertext, s.key_id
        FROM awcms_channel_secrets s
        JOIN awcms_channel_accounts a ON a.tenant_id = s.tenant_id AND a.secret_id = s.id
        WHERE a.id = ${id}
      `) as {
        id: string;
        purpose: string;
        ciphertext: string;
        key_id: string;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.purpose).toBe("device_key");
      expect(rows[0]!.key_id).toBe("k1");
      expect(rows[0]!.ciphertext.startsWith("v2:k1:")).toBe(true);
      expect(rows[0]!.ciphertext).not.toContain(CANARY);

      // The canary is nowhere in the database: not in any column of any channel table.
      const everything = (await getAdminSql()`
        SELECT to_jsonb(a)::text AS row FROM awcms_channel_accounts a
        UNION ALL SELECT to_jsonb(s)::text FROM awcms_channel_secrets s
        UNION ALL SELECT to_jsonb(c)::text FROM awcms_channel_provider_connections c
      `) as { row: string }[];

      expect(everything.some((entry) => entry.row.includes(CANARY))).toBe(
        false
      );

      const account = await inTenant(T1, (tx) =>
        fetchAccountRecord(tx, T1, id)
      );

      expect(account?.hasCredential).toBe(true);
      expect(JSON.stringify(toPublicAccount(account!))).not.toContain(
        rows[0]!.id
      );
      expect(
        JSON.stringify(
          await inTenant(T1, (tx) =>
            listAccounts(
              tx,
              T1,
              { tenantUserId: U1, bypass: true },
              { provider: null, status: null, limit: 50, cursor: null }
            )
          )
        )
      ).not.toContain(rows[0]!.id);
    });

    test("the store decrypts for the owning tenant only, counts it, and refuses a swapped ciphertext", async () => {
      const a = await created(T1, U1, "swap-a");
      const b = await created(T1, U1, "swap-b");

      await inTenant(T1, (tx) =>
        writeAccountCredential(tx, store, T1, U1, a, CANARY)
      );
      await inTenant(T1, (tx) =>
        writeAccountCredential(tx, store, T1, U1, b, `${CANARY}-b`)
      );

      const refs = (await getAdminSql()`
        SELECT id AS account_id, secret_id FROM awcms_channel_accounts
        WHERE id IN (${a}, ${b})
      `) as { account_id: string; secret_id: string }[];
      const secretA = refs.find((r) => r.account_id === a)!.secret_id;
      const secretB = refs.find((r) => r.account_id === b)!.secret_id;

      expect(
        await inTenant(T1, (tx) =>
          store.resolve(tx, {
            tenantId: T1,
            secretId: secretA,
            purpose: "device_key"
          })
        )
      ).toBe(CANARY);
      expect(snapshotSecretDecryptCounts()).toEqual([
        { tenantId: T1, purpose: "device_key", count: 1 }
      ]);

      // Another tenant cannot see the row at all.
      await expect(
        inTenant(T2, (tx) =>
          store.resolve(tx, {
            tenantId: T2,
            secretId: secretA,
            purpose: "device_key"
          })
        )
      ).rejects.toMatchObject({ code: "SECRET_NOT_FOUND" });
      // The purpose is part of the lookup.
      await expect(
        inTenant(T1, (tx) =>
          store.resolve(tx, {
            tenantId: T1,
            secretId: secretA,
            purpose: "api_token"
          })
        )
      ).rejects.toMatchObject({ code: "SECRET_NOT_FOUND" });

      // A ciphertext copied onto another row fails authentication.
      await getAdminSql()`
        UPDATE awcms_channel_secrets
        SET ciphertext = (SELECT ciphertext FROM awcms_channel_secrets WHERE id = ${secretA})
        WHERE id = ${secretB}
      `;
      await expect(
        inTenant(T1, (tx) =>
          store.resolve(tx, {
            tenantId: T1,
            secretId: secretB,
            purpose: "device_key"
          })
        )
      ).rejects.toMatchObject({ code: "DECRYPT_FAILED" });
    });

    test("the database refuses a plaintext credential, a relabelled purpose and a version rollback", async () => {
      const id = await created(T1, U1, "check-dev");

      await inTenant(T1, (tx) =>
        writeAccountCredential(tx, store, T1, U1, id, CANARY)
      );

      const admin = getAdminSql();

      await assertRejected(
        admin`
          INSERT INTO awcms_channel_secrets (tenant_id, purpose, ciphertext, key_id)
          VALUES (${T1}, 'api_token', ${CANARY}, 'k1')
        `,
        "a plaintext credential"
      );
      await assertRejected(
        admin`UPDATE awcms_channel_secrets SET purpose = 'bot_token' WHERE tenant_id = ${T1}`,
        "a relabelled secret purpose"
      );
      await admin`UPDATE awcms_channel_secrets SET version = 3 WHERE tenant_id = ${T1}`;
      await assertRejected(
        admin`UPDATE awcms_channel_secrets SET version = 2 WHERE tenant_id = ${T1}`,
        "a secret version rollback"
      );
    });

    test("replacing keeps the reference and moves the version; an OAuth account has no credential of its own", async () => {
      const id = await created(T1, U1, "replace-dev");

      await inTenant(T1, (tx) =>
        writeAccountCredential(tx, store, T1, U1, id, CANARY)
      );

      expect(
        await inTenant(T1, (tx) =>
          writeAccountCredential(tx, store, T1, U1, id, `${CANARY}-2`)
        )
      ).toEqual({ outcome: "written", replaced: true, version: 2 });
      expect(await secretCount(T1)).toBe(1);

      registerFakeAdapter();

      const connection = await activeConnection(T1, U1);
      const oauth = await created(T1, U1, "pg-oauth", {
        provider: "facebook",
        accountKind: "page",
        authMode: "oauth2",
        connectionId: connection
      });

      expect(
        await inTenant(T1, (tx) =>
          writeAccountCredential(tx, store, T1, U1, oauth, CANARY)
        )
      ).toEqual({ outcome: "refused", code: "CREDENTIAL_NOT_APPLICABLE" });
    });

    test("disconnect erases the ciphertext, revokes the account, and a revoked account cannot be re-armed", async () => {
      const id = await created(T1, U1, "disc-dev");

      await inTenant(T1, (tx) =>
        writeAccountCredential(tx, store, T1, U1, id, CANARY)
      );
      expect(await secretCount(T1)).toBe(1);

      const result = await inTenant(T1, (tx) =>
        disconnectAccount(tx, store, T1, U1, id)
      );

      expect(result).toMatchObject({
        outcome: "disconnected",
        credentialErased: true,
        account: { status: "revoked", hasCredential: false }
      });
      expect(await secretCount(T1)).toBe(0);
      expect(
        await inTenant(T1, (tx) => disconnectAccount(tx, store, T1, U1, id))
      ).toEqual({ outcome: "refused", code: "ACCOUNT_STATE_INVALID" });
      expect(
        await inTenant(T1, (tx) =>
          writeAccountCredential(tx, store, T1, U1, id, CANARY)
        )
      ).toEqual({ outcome: "refused", code: "ACCOUNT_STATE_INVALID" });
      expect(await secretCount(T1)).toBe(0);
    });

    test("key rotation re-encrypts under the new first key, is idempotent, and fails closed without the old key", async () => {
      for (const external of ["rk-1", "rk-2", "rk-3"]) {
        const id = await created(T1, U1, external);

        await inTenant(T1, (tx) =>
          writeAccountCredential(tx, store, T1, U1, id, `${CANARY}-${external}`)
        );
      }

      const sql = getRuntimeSql();

      expect(await countChannelSecretsByKeyId(sql, T1)).toEqual({ k1: 3 });
      expect(
        await rekeyChannelSecretsBatch(sql, T1, ROTATED, { limit: 2 })
      ).toMatchObject({ converted: 2, failed: 0, complete: false });
      expect(await rekeyChannelSecretsForTenant(sql, T1, ROTATED)).toEqual({
        converted: 1,
        failed: 0,
        complete: true
      });
      expect(await countChannelSecretsByKeyId(sql, T1)).toEqual({ k2: 3 });
      expect(await rekeyChannelSecretsForTenant(sql, T1, ROTATED)).toEqual({
        converted: 0,
        failed: 0,
        complete: true
      });

      // Readable with the NEW key alone (the old key may now be retired).
      const newOnly = createKeyRingSecretStore(() => ringOf(`k2:${K2}`));
      const rows = (await getAdminSql()`
        SELECT secret_id FROM awcms_channel_accounts
        WHERE external_id = 'rk-1' AND tenant_id = ${T1}
      `) as { secret_id: string }[];

      expect(
        await inTenant(T1, (tx) =>
          newOnly.resolve(tx, {
            tenantId: T1,
            secretId: rows[0]!.secret_id,
            purpose: "device_key"
          })
        )
      ).toBe(`${CANARY}-rk-1`);

      // A restore without the ring fails closed: rows are counted, not converted.
      const stranger = ringOf(`k9:${bytes(17)}`);
      const second = await rekeyChannelSecretsBatch(sql, T1, stranger);

      expect(second.converted).toBe(0);
      expect(second.failed).toBe(3);
    });
  });

  describe("capability is fail-closed per account", () => {
    async function connectedPage() {
      registerFakeAdapter();

      const connection = await activeConnection(T1, U1);
      const id = await created(T1, U1, "cap-page", {
        provider: "facebook",
        accountKind: "page",
        authMode: "oauth2",
        connectionId: connection
      });

      return { id, connection };
    }

    const EVIDENCE = {
      state: "granted" as const,
      evidenceKind: "app_review_reference" as const,
      evidenceRef: "review-42"
    };

    test("a missing row is denied; recording evidence still does not enable a pending account", async () => {
      const { id } = await connectedPage();

      expect(
        await inTenant(T1, (tx) => resolveCapability(tx, T1, id, "publish"))
      ).toEqual({ allowed: false, code: "CAPABILITY_NOT_RECORDED" });

      const recorded = await inTenant(T1, (tx) =>
        setAccountCapability(tx, T1, U1, id, "publish", EVIDENCE)
      );

      expect(recorded.outcome).toBe("recorded");
      expect(
        await inTenant(T1, (tx) => resolveCapability(tx, T1, id, "publish"))
      ).toEqual({ allowed: false, code: "ACCOUNT_NOT_USABLE" });
    });

    test("a verified, connected account with granted evidence is allowed; other capabilities stay denied", async () => {
      const { id } = await connectedPage();

      await inTenant(T1, (tx) =>
        setAccountCapability(tx, T1, U1, id, "publish", EVIDENCE)
      );
      await inTenant(T1, (tx) =>
        recordAccountHealth(tx, T1, id, { state: "ok", reasonCode: null })
      );

      expect(
        await inTenant(T1, (tx) => resolveCapability(tx, T1, id, "publish"))
      ).toEqual({ allowed: true });
      expect(
        await inTenant(T1, (tx) => resolveCapability(tx, T1, id, "reply"))
      ).toEqual({ allowed: false, code: "CAPABILITY_NOT_RECORDED" });

      const all = await inTenant(T1, (tx) =>
        listAccountCapabilities(tx, T1, id)
      );

      expect(all).toHaveLength(9);
      expect(all!.filter((item) => item.effective.allowed)).toHaveLength(1);
    });

    test("an unsupported action is refused when recorded and when used, never degraded", async () => {
      const waba = await created(T1, U1, "waba-cap", {
        provider: "whatsapp_cloud",
        accountKind: "waba",
        authMode: "api_token"
      });
      const phone = await created(T1, U1, "pn-cap", {
        provider: "whatsapp_cloud",
        accountKind: "waba_phone_number",
        authMode: "api_token",
        parentAccountId: waba
      });

      // WhatsApp cannot publish.
      expect(
        await inTenant(T1, (tx) =>
          setAccountCapability(tx, T1, U1, phone, "publish", EVIDENCE)
        )
      ).toEqual({ outcome: "refused", code: "CAPABILITY_NOT_GRANTABLE" });
      // `leads` is unverified for Meta Cloud; a container never acts.
      expect(
        await inTenant(T1, (tx) =>
          setAccountCapability(tx, T1, U1, phone, "leads", EVIDENCE)
        )
      ).toEqual({ outcome: "refused", code: "PROVIDER_UNVERIFIED" });
      expect(
        await inTenant(T1, (tx) =>
          setAccountCapability(tx, T1, U1, waba, "reply", EVIDENCE)
        )
      ).toEqual({ outcome: "refused", code: "CAPABILITY_NOT_GRANTABLE" });
      // Recording a DENIAL is always allowed.
      expect(
        (
          await inTenant(T1, (tx) =>
            setAccountCapability(tx, T1, U1, phone, "publish", {
              state: "denied",
              evidenceKind: null,
              evidenceRef: null
            })
          )
        ).outcome
      ).toBe("recorded");
      expect(
        await inTenant(T1, (tx) => resolveCapability(tx, T1, phone, "publish"))
      ).toEqual({ allowed: false, code: "PROVIDER_NOT_OFFERED" });
    });

    test("a restricted cell needs contract or written evidence", async () => {
      const device = await created(T1, U1, "ss-cap");

      expect(
        await inTenant(T1, (tx) =>
          setAccountCapability(tx, T1, U1, device, "broadcast", EVIDENCE)
        )
      ).toEqual({ outcome: "refused", code: "PROVIDER_RESTRICTED" });
      expect(
        (
          await inTenant(T1, (tx) =>
            setAccountCapability(tx, T1, U1, device, "broadcast", {
              state: "granted",
              evidenceKind: "written_authorization",
              evidenceRef: "owner-ack-2026-10"
            })
          )
        ).outcome
      ).toBe("recorded");
    });

    test("the database requires evidence for a granted row", async () => {
      const { id } = await connectedPage();

      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_channel_account_capabilities
            (tenant_id, account_id, capability, state, matrix_version)
          VALUES (${T1}, ${id}, 'publish', 'granted', 1)
        `,
        "a granted capability without evidence"
      );
    });

    test("a degraded or disabled account, and a revoked connection, deny at once", async () => {
      const { id, connection } = await connectedPage();

      await inTenant(T1, (tx) =>
        setAccountCapability(tx, T1, U1, id, "publish", EVIDENCE)
      );
      await inTenant(T1, (tx) =>
        recordAccountHealth(tx, T1, id, { state: "ok", reasonCode: null })
      );
      expect(
        await inTenant(T1, (tx) => resolveCapability(tx, T1, id, "publish"))
      ).toEqual({ allowed: true });

      await inTenant(T1, (tx) =>
        recordAccountHealth(tx, T1, id, {
          state: "failing",
          reasonCode: "TOKEN_EXPIRED"
        })
      );
      expect(
        await inTenant(T1, (tx) => resolveCapability(tx, T1, id, "publish"))
      ).toEqual({ allowed: false, code: "ACCOUNT_NOT_USABLE" });

      // A stale success report cannot resurrect a disabled account.
      await inTenant(T1, (tx) =>
        updateAccount(tx, T1, U1, id, { displayName: null, status: "disabled" })
      );
      await inTenant(T1, (tx) =>
        recordAccountHealth(tx, T1, id, { state: "ok", reasonCode: null })
      );
      expect(
        (await inTenant(T1, (tx) => fetchAccountRecord(tx, T1, id)))?.status
      ).toBe("disabled");

      // Re-enabling returns to `pending`, not `connected`.
      await inTenant(T1, (tx) =>
        updateAccount(tx, T1, U1, id, { displayName: null, status: "pending" })
      );
      expect(
        (await inTenant(T1, (tx) => fetchAccountRecord(tx, T1, id)))?.status
      ).toBe("pending");
      await inTenant(T1, (tx) =>
        recordAccountHealth(tx, T1, id, { state: "ok", reasonCode: null })
      );
      expect(
        await inTenant(T1, (tx) => resolveCapability(tx, T1, id, "publish"))
      ).toEqual({ allowed: true });

      // The connection is revoked: the account is revoked with it, and denies.
      const revoked = await inTenant(T1, (tx) =>
        revokeConnection(tx, store, T1, connection)
      );

      expect(revoked).toEqual({ outcome: "revoked", accountsRevoked: 1 });
      expect(
        await inTenant(T1, (tx) => resolveCapability(tx, T1, id, "publish"))
      ).toEqual({ allowed: false, code: "ACCOUNT_NOT_USABLE" });
    });

    test("health is recorded as a fixed code per account and read back", async () => {
      const { id } = await connectedPage();

      await inTenant(T1, (tx) =>
        recordAccountHealth(tx, T1, id, {
          state: "degraded",
          reasonCode: "QUOTA_LOW",
          quotaRemaining: 5,
          quotaLimit: 100
        })
      );

      expect(
        await inTenant(T1, (tx) => fetchAccountHealth(tx, T1, id))
      ).toMatchObject({
        state: "degraded",
        reasonCode: "QUOTA_LOW",
        quotaRemaining: 5,
        quotaLimit: 100
      });
      expect(
        await inTenant(T2, (tx) => fetchAccountHealth(tx, T2, id))
      ).toBeNull();
    });
  });

  describe("OAuth state and callback", () => {
    test("start is refused for a provider without an installed connector, and never creates a row", async () => {
      const result = await inTenant(T1, (tx) =>
        startOAuthGrant(
          tx,
          store,
          T1,
          U1,
          { provider: "facebook", scopes: [], businessScope: null },
          new Date(),
          ENV
        )
      );

      expect(result).toEqual({
        outcome: "refused",
        code: "PROVIDER_ADAPTER_UNAVAILABLE"
      });

      const rows = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_channel_oauth_states
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(0);
    });

    test("the authorisation URL carries state, an S256 challenge and the fixed redirect; the state is stored only as a hash", async () => {
      registerFakeAdapter();

      const stateParam = await startFlow(T1, U1);
      const [tenantPart, token] = [
        stateParam.slice(0, 36),
        stateParam.slice(37)
      ];

      expect(tenantPart).toBe(T1);

      const rows = (await getAdminSql()`
        SELECT state_hash, pkce_secret_id, redirect_uri_hash FROM awcms_channel_oauth_states
      `) as {
        state_hash: string;
        pkce_secret_id: string | null;
        redirect_uri_hash: string;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]!.state_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(rows[0]!.state_hash).not.toContain(token);
      expect(rows[0]!.pkce_secret_id).not.toBeNull();
    });

    test("a provider without PKCE stores no verifier", async () => {
      registerFakeAdapter(false);
      await startFlow(T1, U1);

      const rows = (await getAdminSql()`
        SELECT pkce_secret_id FROM awcms_channel_oauth_states
      `) as { pkce_secret_id: string | null }[];

      expect(rows[0]!.pkce_secret_id).toBeNull();
    });

    test("a valid callback hands off a pending connection holding the code only as ciphertext", async () => {
      registerFakeAdapter();

      const state = await startFlow(T1, U1);
      const result = await callback(T1, U1, state);

      expect(result.outcome).toBe("handed_off");

      const connection = await inTenant(T1, (tx) =>
        fetchConnection(
          tx,
          T1,
          (result as { connectionId: string }).connectionId
        )
      );

      expect(connection).toMatchObject({
        grantState: "pending",
        awaitingExchange: true,
        hasAccessCredential: false
      });
      expect(JSON.stringify(connection)).not.toContain(CANARY_CODE);

      const everything = (await getAdminSql()`
        SELECT to_jsonb(s)::text AS row FROM awcms_channel_secrets s
        UNION ALL SELECT to_jsonb(c)::text FROM awcms_channel_provider_connections c
        UNION ALL SELECT to_jsonb(o)::text FROM awcms_channel_oauth_states o
      `) as { row: string }[];

      expect(everything.some((entry) => entry.row.includes(CANARY_CODE))).toBe(
        false
      );
    });

    test("replay, wrong person, wrong tenant, expired and forged states all answer STATE_INVALID", async () => {
      registerFakeAdapter();

      const state = await startFlow(T1, U1);

      // Another person of the SAME tenant cannot complete my flow.
      expect(await callback(T1, U1B, state)).toEqual({
        outcome: "refused",
        code: "STATE_INVALID"
      });
      // Another tenant cannot (the tenant in the state does not match).
      expect(await callback(T2, U2, state)).toEqual({
        outcome: "refused",
        code: "STATE_INVALID"
      });
      // The same token presented under another tenant's prefix is just a miss.
      expect(await callback(T2, U2, `${T2}.${state.slice(37)}`)).toEqual({
        outcome: "refused",
        code: "STATE_INVALID"
      });
      // Forged and malformed.
      for (const forged of [
        `${T1}.${"A".repeat(43)}`,
        "no-dot",
        `${T1}.`,
        ""
      ]) {
        expect(await callback(T1, U1, forged)).toEqual({
          outcome: "refused",
          code: "STATE_INVALID"
        });
      }

      // None of that consumed it: the rightful person still can, once.
      expect((await callback(T1, U1, state)).outcome).toBe("handed_off");
      expect(await callback(T1, U1, state)).toEqual({
        outcome: "refused",
        code: "STATE_INVALID"
      });
    });

    test("an expired state is refused", async () => {
      registerFakeAdapter();

      const start = new Date("2026-01-01T00:00:00Z");
      const state = await startFlow(T1, U1, start);

      expect(
        await callback(T1, U1, state, new Date("2026-01-01T00:11:00Z"))
      ).toEqual({ outcome: "refused", code: "STATE_INVALID" });
    });

    test("a callback for a different redirect URI than the flow started with is refused", async () => {
      registerFakeAdapter();

      const state = await startFlow(T1, U1);

      expect(
        await inTenant(T1, (tx) =>
          completeOAuthCallback(
            tx,
            store,
            T1,
            U1,
            { stateParam: state, code: CANARY_CODE, providerError: false },
            new Date(),
            {
              APP_URL: "https://evil.example.test"
            } as unknown as NodeJS.ProcessEnv
          )
        )
      ).toEqual({ outcome: "refused", code: "STATE_INVALID" });
    });

    test("racing callbacks on one state have exactly one winner", async () => {
      registerFakeAdapter();

      const state = await startFlow(T1, U1);
      const pool = createRuntimePool(8);

      try {
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            withTenantOrThrow(pool, T1, (tx) =>
              completeOAuthCallback(
                tx,
                store,
                T1,
                U1,
                { stateParam: state, code: CANARY_CODE, providerError: false },
                new Date(),
                ENV
              )
            )
          )
        );

        expect(results.filter((r) => r.outcome === "handed_off")).toHaveLength(
          1
        );
        expect(results.filter((r) => r.outcome === "refused")).toHaveLength(7);
      } finally {
        await pool.close({ timeout: 1 });
      }

      const rows = (await getAdminSql()`
        SELECT count(*)::int AS n FROM awcms_channel_provider_connections
      `) as { n: number }[];

      expect(rows[0]!.n).toBe(1);
    });

    test("a provider denial consumes the state, erases the verifier and creates no connection", async () => {
      registerFakeAdapter();

      const state = await startFlow(T1, U1);

      expect(
        await inTenant(T1, (tx) =>
          completeOAuthCallback(
            tx,
            store,
            T1,
            U1,
            { stateParam: state, code: null, providerError: true },
            new Date(),
            ENV
          )
        )
      ).toEqual({ outcome: "denied_by_provider" });
      expect(await secretCount(T1)).toBe(0);
      expect(await callback(T1, U1, state)).toEqual({
        outcome: "refused",
        code: "STATE_INVALID"
      });
    });

    test("a consumed state is frozen by the database", async () => {
      registerFakeAdapter();

      const state = await startFlow(T1, U1);

      await callback(T1, U1, state);
      await assertRejected(
        getAdminSql()`UPDATE awcms_channel_oauth_states SET consumed_at = NULL`,
        "un-consuming an OAuth state"
      );
      await assertRejected(
        getAdminSql()`UPDATE awcms_channel_oauth_states SET initiated_by = ${U1B}`,
        "re-binding an OAuth state to another person"
      );
    });

    test("the number of unconsumed states per person is capped", async () => {
      registerFakeAdapter();

      for (let n = 0; n < 10; n += 1) await startFlow(T1, U1);

      expect(
        await inTenant(T1, (tx) =>
          startOAuthGrant(
            tx,
            store,
            T1,
            U1,
            { provider: "facebook", scopes: [], businessScope: null },
            new Date(),
            ENV
          )
        )
      ).toEqual({ outcome: "refused", code: "TOO_MANY_PENDING" });
      // Another person of the tenant is not affected.
      await startFlow(T1, U1B);
    });

    test("the sweep removes expired states with their verifier and fails abandoned hand-offs", async () => {
      registerFakeAdapter();

      const old = new Date("2026-01-01T00:00:00Z");

      await startFlow(T1, U1, old);

      const handedState = await startFlow(T1, U1, old);

      await callback(T1, U1, handedState, new Date("2026-01-01T00:01:00Z"));
      expect(await secretCount(T1)).toBe(3);

      const swept = await inTenant(T1, (tx) =>
        sweepExpiredOAuthStates(tx, store, T1, new Date("2030-01-03T00:00:00Z"))
      );

      // The unreferenced state is deleted; the abandoned pending connection is failed.
      expect(swept).toEqual({ statesDeleted: 1, connectionsFailed: 1 });
      expect(await secretCount(T1)).toBe(0);

      const connections = (await getAdminSql()`
        SELECT grant_state, pending_code_secret_id FROM awcms_channel_provider_connections
      `) as { grant_state: string; pending_code_secret_id: string | null }[];

      expect(connections).toEqual([
        { grant_state: "failed", pending_code_secret_id: null }
      ]);
    });
  });

  describe("grant lifecycle, refresh and revocation", () => {
    test("activation stores the tokens as ciphertext and erases the hand-off secrets", async () => {
      const connection = await activeConnection(T1, U1);
      const view = await inTenant(T1, (tx) =>
        fetchConnection(tx, T1, connection)
      );

      expect(view).toMatchObject({
        grantState: "active",
        hasAccessCredential: true,
        awaitingExchange: false,
        grantedScopes: ["pages_manage_posts", "pages_show_list"]
      });
      // access + refresh only: the code and the verifier are gone.
      expect(await secretCount(T1)).toBe(2);
      expect(JSON.stringify(view)).not.toContain(CANARY);

      const purposes = (await getAdminSql()`
        SELECT purpose FROM awcms_channel_secrets ORDER BY purpose
      `) as { purpose: string }[];

      expect(purposes.map((p) => p.purpose)).toEqual([
        "provider_access_token",
        "provider_refresh_token"
      ]);
    });

    test("a refresh race has exactly one winner, and a stale lease cannot store tokens", async () => {
      const connection = await activeConnection(T1, U1);
      const pool = createRuntimePool(8);
      const now = new Date();

      try {
        const results = await Promise.all(
          Array.from({ length: 8 }, () =>
            withTenantOrThrow(pool, T1, (tx) =>
              acquireRefreshLease(tx, T1, connection, now)
            )
          )
        );
        const winners = results.filter((r) => r.acquired);

        expect(winners).toHaveLength(1);

        const lease = winners[0] as { acquired: true; leaseVersion: number };

        // A caller holding an older version is refused.
        expect(
          await inTenant(T1, (tx) =>
            completeRefresh(tx, store, T1, connection, lease.leaseVersion - 1, {
              accessToken: "stale-token-value",
              refreshToken: null,
              expiresAt: null
            })
          )
        ).toEqual({ outcome: "lease_lost" });
        expect(
          await inTenant(T1, (tx) =>
            completeRefresh(tx, store, T1, connection, lease.leaseVersion, {
              accessToken: `${CANARY}-new`,
              refreshToken: `${CANARY}-refresh-new`,
              expiresAt: new Date(Date.now() + 3600_000)
            })
          )
        ).toEqual({ outcome: "refreshed" });
        // Completed once: the lease cannot be reused.
        expect(
          await inTenant(T1, (tx) =>
            completeRefresh(tx, store, T1, connection, lease.leaseVersion, {
              accessToken: "again-token-value",
              refreshToken: null,
              expiresAt: null
            })
          )
        ).toEqual({ outcome: "lease_lost" });
        // Same secret rows, new versions: no ciphertext was added.
        expect(await secretCount(T1)).toBe(2);
        // The lease is free again.
        expect(
          (
            await inTenant(T1, (tx) =>
              acquireRefreshLease(tx, T1, connection, new Date())
            )
          ).acquired
        ).toBe(true);
      } finally {
        await pool.close({ timeout: 1 });
      }
    });

    test("a failed refresh backs off with a bounded delay; a permanent failure ends the grant and degrades its accounts", async () => {
      registerFakeAdapter();

      const connection = await activeConnection(T1, U1);
      const id = await created(T1, U1, "refresh-page", {
        provider: "facebook",
        accountKind: "page",
        authMode: "oauth2",
        connectionId: connection
      });

      await inTenant(T1, (tx) =>
        recordAccountHealth(tx, T1, id, { state: "ok", reasonCode: null })
      );

      const now = new Date("2026-06-01T00:00:00Z");
      const first = await inTenant(T1, (tx) =>
        acquireRefreshLease(tx, T1, connection, now)
      );
      const failed = await inTenant(T1, (tx) =>
        failRefresh(
          tx,
          T1,
          connection,
          (first as { leaseVersion: number }).leaseVersion,
          { permanent: false },
          now
        )
      );

      expect(failed).toEqual({ outcome: "backoff", retryAfterSeconds: 60 });
      // No retry storm: the lease is held through the backoff.
      expect(
        (
          await inTenant(T1, (tx) =>
            acquireRefreshLease(
              tx,
              T1,
              connection,
              new Date("2026-06-01T00:00:30Z")
            )
          )
        ).acquired
      ).toBe(false);

      const later = new Date("2026-06-01T00:02:00Z");
      const second = await inTenant(T1, (tx) =>
        acquireRefreshLease(tx, T1, connection, later)
      );

      expect(second.acquired).toBe(true);
      expect(
        await inTenant(T1, (tx) =>
          failRefresh(
            tx,
            T1,
            connection,
            (second as { leaseVersion: number }).leaseVersion,
            { permanent: true },
            later
          )
        )
      ).toEqual({ outcome: "expired" });
      expect(
        (await inTenant(T1, (tx) => fetchConnection(tx, T1, connection)))
          ?.grantState
      ).toBe("expired");
      expect(
        await inTenant(T1, (tx) => fetchAccountRecord(tx, T1, id))
      ).toMatchObject({
        status: "degraded",
        statusReason: "TOKEN_REFRESH_FAILED"
      });
      // An expired grant cannot take a refresh lease.
      expect(
        (
          await inTenant(T1, (tx) =>
            acquireRefreshLease(
              tx,
              T1,
              connection,
              new Date("2026-06-02T00:00:00Z")
            )
          )
        ).acquired
      ).toBe(false);
    });

    test("revoking clears and deletes every credential, and the database refuses to un-revoke", async () => {
      const connection = await activeConnection(T1, U1);

      expect(await secretCount(T1)).toBe(2);
      expect(
        await inTenant(T1, (tx) => revokeConnection(tx, store, T1, connection))
      ).toEqual({ outcome: "revoked", accountsRevoked: 0 });
      expect(await secretCount(T1)).toBe(0);

      const view = await inTenant(T1, (tx) =>
        fetchConnection(tx, T1, connection)
      );

      expect(view).toMatchObject({
        grantState: "revoked",
        hasAccessCredential: false
      });
      expect(
        await inTenant(T1, (tx) => revokeConnection(tx, store, T1, connection))
      ).toEqual({ outcome: "refused", code: "GRANT_STATE_INVALID" });
      await assertRejected(
        getAdminSql()`
          UPDATE awcms_channel_provider_connections SET grant_state = 'active'
          WHERE id = ${connection}
        `,
        "un-revoking a connection"
      );
      // A revoked token cannot be refreshed.
      expect(
        (
          await inTenant(T1, (tx) =>
            acquireRefreshLease(tx, T1, connection, new Date())
          )
        ).acquired
      ).toBe(false);
    });

    test("another tenant cannot revoke, activate or refresh a connection", async () => {
      const connection = await activeConnection(T1, U1);

      expect(
        await inTenant(T2, (tx) => revokeConnection(tx, store, T2, connection))
      ).toEqual({ outcome: "not_found" });
      expect(
        await inTenant(T2, (tx) => fetchConnection(tx, T2, connection))
      ).toBeNull();
      expect(
        (
          await inTenant(T2, (tx) =>
            acquireRefreshLease(tx, T2, connection, new Date())
          )
        ).acquired
      ).toBe(false);
      expect(
        await inTenant(T2, (tx) =>
          failConnectionGrant(tx, store, T2, connection)
        )
      ).toBe(false);
    });
  });

  describe("assignments", () => {
    test("an account with assignees is visible only to them and to the bypass holder", async () => {
      const id = await created(T1, U1, "assigned-dev");

      // Tenant-wide until the first assignment.
      expect(
        await inTenant(T1, (tx) => isAccountVisibleTo(tx, T1, id, U1B, false))
      ).toBe(true);

      expect(
        await inTenant(T1, (tx) =>
          assignAccount(tx, T1, U1, id, { tenantUserId: U1, kind: "owner" })
        )
      ).toMatchObject({ outcome: "assigned" });

      expect(
        await inTenant(T1, (tx) => isAccountVisibleTo(tx, T1, id, U1, false))
      ).toBe(true);
      expect(
        await inTenant(T1, (tx) => isAccountVisibleTo(tx, T1, id, U1B, false))
      ).toBe(false);
      expect(
        await inTenant(T1, (tx) => isAccountVisibleTo(tx, T1, id, U1B, true))
      ).toBe(true);

      const query = { provider: null, status: null, limit: 50, cursor: null };
      const hidden = await inTenant(T1, (tx) =>
        listAccounts(tx, T1, { tenantUserId: U1B, bypass: false }, query)
      );
      const shown = await inTenant(T1, (tx) =>
        listAccounts(tx, T1, { tenantUserId: U1, bypass: false }, query)
      );

      expect(hidden.ok && hidden.items).toHaveLength(0);
      expect(shown.ok && shown.items).toHaveLength(1);
    });

    test("a viewer sees but cannot operate; only an owner passes an owner gate", async () => {
      const id = await created(T1, U1, "kinds-dev");

      await inTenant(T1, (tx) =>
        assignAccount(tx, T1, U1, id, { tenantUserId: U1, kind: "owner" })
      );
      await inTenant(T1, (tx) =>
        assignAccount(tx, T1, U1, id, { tenantUserId: U1B, kind: "viewer" })
      );

      const check = (user: string, minimum: "viewer" | "operator" | "owner") =>
        inTenant(T1, (tx) =>
          isAccountVisibleTo(tx, T1, id, user, false, minimum)
        );

      expect(await check(U1B, "viewer")).toBe(true);
      expect(await check(U1B, "operator")).toBe(false);
      expect(await check(U1B, "owner")).toBe(false);
      expect(await check(U1, "owner")).toBe(true);
    });

    test("a person of another tenant cannot be assigned", async () => {
      const id = await created(T1, U1, "foreign-user");

      expect(
        await inTenant(T1, (tx) =>
          assignAccount(tx, T1, U1, id, { tenantUserId: U2, kind: "operator" })
        )
      ).toEqual({ outcome: "refused", code: "USER_NOT_FOUND" });
    });
  });

  describe("review hardening (ADR-0148 review M2, M4, M5)", () => {
    const facebookPage = {
      provider: "facebook",
      accountKind: "page",
      authMode: "oauth2" as const
    };

    test("an account cannot be bound to a connection whose grant is not active", async () => {
      const active = await activeConnection(T1, U1);

      // pending: the hand-off exists, the token exchange has not happened.
      registerFakeAdapter();

      const handed = await callback(T1, U1, await startFlow(T1, U1));

      if (handed.outcome !== "handed_off") throw new Error("fixture");

      expect(
        await page(T1, U1, "pg-pending", {
          ...facebookPage,
          connectionId: handed.connectionId
        })
      ).toEqual({ outcome: "refused", code: "CONNECTION_NOT_ACTIVE" });

      // failed
      await inTenant(T1, (tx) =>
        failConnectionGrant(tx, store, T1, handed.connectionId)
      );
      expect(
        await page(T1, U1, "pg-failed", {
          ...facebookPage,
          connectionId: handed.connectionId
        })
      ).toEqual({ outcome: "refused", code: "CONNECTION_NOT_ACTIVE" });

      // active works; once revoked it no longer does, and nothing was claimed.
      await created(T1, U1, "pg-live", {
        ...facebookPage,
        connectionId: active
      });
      await inTenant(T1, (tx) => revokeConnection(tx, store, T1, active));
      expect(
        await page(T1, U1, "pg-revoked", {
          ...facebookPage,
          connectionId: active
        })
      ).toEqual({ outcome: "refused", code: "CONNECTION_NOT_ACTIVE" });

      const claimed = (await getAdminSql()`
        SELECT external_id FROM awcms_channel_accounts
        WHERE external_id IN ('pg-pending', 'pg-failed', 'pg-revoked')
      `) as unknown[];

      expect(claimed).toHaveLength(0);
    });

    test("listAccounts applies the per-row business-scope decision and its cursor still walks the raw pages", async () => {
      const scopeA = crypto.randomUUID();
      const scopeB = crypto.randomUUID();
      const open = await created(T1, U1, "scope-open");
      const inA = await created(T1, U1, "scope-a", {
        businessScope: { type: "brand", id: scopeA }
      });

      await created(T1, U1, "scope-b", {
        businessScope: { type: "brand", id: scopeB }
      });

      const asked: string[] = [];
      const seen = async (limit: number, cursor: string | null) =>
        inTenant(T1, (tx) =>
          listAccounts(
            tx,
            T1,
            {
              tenantUserId: U1,
              bypass: true,
              scopeAllowed: async (scope) => {
                asked.push(scope.id);

                return scope.id === scopeA;
              }
            },
            { provider: null, status: null, limit, cursor }
          )
        );
      const all = await seen(10, null);

      expect(all.ok && all.items.map((item) => item.id).sort()).toEqual(
        [open, inA].sort()
      );
      // Decided once per distinct scope, never for the unscoped account.
      expect(asked.sort()).toEqual([scopeA, scopeB].sort());

      // Pages of one raw row: filtered pages are short, but nothing is skipped
      // or repeated.
      const collected: string[] = [];
      let cursor: string | null = null;

      for (let guard = 0; guard < 5; guard += 1) {
        const next = await seen(1, cursor);

        if (!next.ok) throw new Error("cursor");

        collected.push(...next.items.map((item) => item.id));
        cursor = next.nextCursor;

        if (!cursor) break;
      }

      expect(collected.sort()).toEqual([open, inA].sort());
    });

    test("a credential write racing a disconnect cannot land on the revoked account", async () => {
      const id = await created(T1, U1, "race-dev");
      const pool = createRuntimePool(4);
      let release!: () => void;
      let locked!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const lockedFirst = new Promise<void>((resolve) => (locked = resolve));

      try {
        const disconnecting = withTenantOrThrow(pool, T1, async (tx) => {
          const result = await disconnectAccount(tx, store, T1, U1, id);

          locked();
          await gate; // the row lock is held until this transaction commits

          return result;
        });

        await lockedFirst;

        const writing = withTenantOrThrow(pool, T1, (tx) =>
          writeAccountCredential(tx, store, T1, U1, id, CANARY)
        );
        const early = await Promise.race([
          writing.then(() => "done"),
          Bun.sleep(500).then(() => "blocked")
        ]);

        expect(early).toBe("blocked");

        release();

        const [disconnected, written] = await Promise.all([
          disconnecting,
          writing
        ]);

        expect(disconnected.outcome).toBe("disconnected");
        expect(written).toEqual({
          outcome: "refused",
          code: "ACCOUNT_STATE_INVALID"
        });
      } finally {
        release();
        await pool.close({ timeout: 1 });
      }

      expect(await secretCount(T1)).toBe(0);
      expect(
        (await inTenant(T1, (tx) => fetchAccountRecord(tx, T1, id)))?.secretId
      ).toBeNull();
    });

    test("a delete racing a credential write leaves no orphaned ciphertext", async () => {
      const id = await created(T1, U1, "race-del");
      const pool = createRuntimePool(4);
      let release!: () => void;
      let locked!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const lockedFirst = new Promise<void>((resolve) => (locked = resolve));

      try {
        const deleting = withTenantOrThrow(pool, T1, async (tx) => {
          const result = await deleteAccount(tx, store, T1, U1, id);

          locked();
          await gate;

          return result;
        });

        await lockedFirst;

        const writing = withTenantOrThrow(pool, T1, (tx) =>
          writeAccountCredential(tx, store, T1, U1, id, CANARY)
        );

        await Bun.sleep(300);
        release();

        const [deleted, written] = await Promise.all([deleting, writing]);

        expect(deleted.outcome).toBe("deleted");
        expect(written.outcome).toBe("not_found");
      } finally {
        release();
        await pool.close({ timeout: 1 });
      }

      expect(await secretCount(T1)).toBe(0);
    });
  });

  describe("integrity guards", () => {
    test("an account identity is immutable and a deleted account is terminal", async () => {
      const id = await created(T1, U1, "immutable-dev");
      const admin = getAdminSql();

      for (const [column, value] of [
        ["external_id", "other-id"],
        ["provider", "telegram"],
        ["account_kind", "bot"]
      ] as const) {
        await assertRejected(
          admin`UPDATE awcms_channel_accounts SET ${admin(column)} = ${value} WHERE id = ${id}`,
          `changing ${column}`
        );
      }

      await inTenant(T1, (tx) => deleteAccount(tx, store, T1, U1, id));
      await assertRejected(
        admin`UPDATE awcms_channel_accounts SET status = 'pending', deleted_at = NULL WHERE id = ${id}`,
        "restoring a deleted account"
      );
    });

    test("a webhook subscription from an unauthenticated provider cannot accept content events, and its token is immutable", async () => {
      const id = await created(T1, U1, "hook-dev");
      const admin = getAdminSql();
      const hash = `sha256:${"a".repeat(64)}`;

      await assertRejected(
        admin`
          INSERT INTO awcms_channel_webhook_subscriptions
            (tenant_id, account_id, provider, callback_token_hash,
             verification_mode, accepts_content_events)
          VALUES (${T1}, ${id}, 'starsender', ${hash}, 'unauthenticated', true)
        `,
        "content events from an unauthenticated provider"
      );

      await admin`
        INSERT INTO awcms_channel_webhook_subscriptions
          (tenant_id, account_id, provider, callback_token_hash, verification_mode)
        VALUES (${T1}, ${id}, 'starsender', ${hash}, 'unauthenticated')
      `;
      await assertRejected(
        admin`UPDATE awcms_channel_webhook_subscriptions SET callback_token_hash = ${`sha256:${"b".repeat(64)}`}`,
        "re-pointing a webhook callback token"
      );
      // The callback token is unique across tenants (a public route resolves by it).
      const other = await created(T2, U2, "hook-dev-2");

      await assertRejected(
        admin`
          INSERT INTO awcms_channel_webhook_subscriptions
            (tenant_id, account_id, provider, callback_token_hash, verification_mode)
          VALUES (${T2}, ${other}, 'starsender', ${hash}, 'secret_header')
        `,
        "a callback token shared across tenants"
      );
    });

    test("a business-scope pair is both or neither", async () => {
      await assertRejected(
        getAdminSql()`
          INSERT INTO awcms_channel_accounts
            (tenant_id, provider, account_kind, external_id, display_name,
             auth_mode, business_scope_type)
          VALUES (${T1}, 'starsender', 'device', 'half-scope', 'Half',
                  'device_key', 'brand')
        `,
        "a half business scope"
      );

      const id = await created(T1, U1, "scoped-dev", {
        businessScope: { type: "brand", id: crypto.randomUUID() }
      });
      const view = await inTenant(T1, (tx) => fetchAccountRecord(tx, T1, id));

      expect(view?.businessScope?.type).toBe("brand");
    });
  });
});
