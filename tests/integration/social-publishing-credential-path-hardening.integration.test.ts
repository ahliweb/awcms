/**
 * The #1145 credential-path security review (third admission condition of
 * #1145), fixed by sql/426 + sql/427 and the code around them. Each finding is
 * proven on a REAL login as the dedicated role, exactly as the job connects:
 *
 *   * HIGH: as `awcms_social_dispatch`, `UPDATE ... version = 2147483647` (and
 *     every other direct account/health write) is refused; the only write is
 *     the fixed-body definer `awcms_social_report_credential_rejected`, which
 *     moves `version` by one per real `connected -> degraded` step; after the
 *     role tries to sabotage the account, the app role still disconnects it and
 *     revokes its connection (the ciphertext is gone);
 *   * MEDIUM-1 + L3: the role no longer sees the token of a degraded account,
 *     an expired grant or a provider without an admitted connector;
 *   * MEDIUM-2: a membership of the dedicated role (in `awcms_app`, NOINHERIT +
 *     SET) is refused at job start AND by readiness, for both dedicated roles;
 *     an unlisted member of the role is a readiness finding;
 *   * MEDIUM-4: disconnecting (or deleting) the last live account on an OAuth
 *     connection revokes the connection and deletes its token ciphertexts; a
 *     connection still serving another account keeps its grant;
 *   * L1: no token-shaped text reaches `last_error`, `error_message` or an audit
 *     row written as the role;
 *   * L2: the dedupe-flag guard is pinned exactly (a hollowed body FAILS).
 *
 * Every readiness pin added here is also mutated: the widened policy, the
 * re-granted column, the hollowed function or trigger each FAIL readiness and
 * pass again once restored.
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
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { assertConnectedAsSocialDispatchRole } from "../../src/lib/database/social-publishing-dispatch-client";
import { assertConnectedAsDispatchRole as assertConnectedAsTelegramRole } from "../../src/lib/database/telegram-engagement-dispatch-client";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  deleteAccount,
  disconnectAccount
} from "../../src/modules/channel-accounts/application/account-directory";
import { createChannelAccountPortAdapter } from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { revokeConnection } from "../../src/modules/channel-accounts/application/connection-directory";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import {
  SOCIAL_DISPATCH_DEFINER_FUNCTIONS,
  checkTelegramEngagementDispatchRole,
  checkWorkerSetupRoleGrants,
  probeSocialDispatchSecretVisibility,
  probeSocialDispatchWriteBoundary
} from "../../scripts/security-readiness";

const TENANT_A = "a1145c00-0000-4000-8000-00000000000a";
const TENANT_B = "a1145c00-0000-4000-8000-00000000000b";
const ACTOR = "a1145c00-0000-4000-8000-0000000000ff";
const ROLE = "awcms_social_dispatch";
const ROLE_PASSWORD = "t1145c-fixture-password";
const TELEGRAM_ROLE = "awcms_telegram_engagement_dispatch";
const TELEGRAM_PASSWORD = "t1145c-telegram-fixture-password";
const REPORT_FILE =
  "sql/426_awcms_social_dispatch_credential_report_function.sql";
const BOUNDS_FILE =
  "sql/427_awcms_social_dispatch_secret_view_and_value_bounds.sql";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 7) % 251)
  ).toString("base64");
const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${bytes(19)}`
} as unknown as NodeJS.ProcessEnv);

if (!ring.ok) throw new Error(ring.reason);

const store = createKeyRingSecretStore(() => ring);
const publishers = createChannelAccountPortAdapter({
  env: {
    CHANNEL_ACCOUNTS_ENABLED: "true",
    SOCIAL_PUBLISHING_ENABLED: "true",
    SOCIAL_PUBLISHING_FACEBOOK_ENABLED: "true"
  } as unknown as NodeJS.ProcessEnv
});

let roleLogin: Bun.SQL | undefined;
let telegramLogin: Bun.SQL | undefined;

function loginUrl(user: string, password: string, database: string): string {
  const url = new URL(process.env.DATABASE_URL!);

  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;

  return url.toString();
}

const asApp = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(getRuntimeSql(), tenantId, fn);

const asRole = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(roleLogin!, tenantId, fn);

/** The SQLSTATE a statement fails with, or `null` when it succeeded. */
async function sqlState(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();

    return null;
  } catch (error) {
    return String((error as { errno?: unknown }).errno ?? "error");
  } finally {
    resetDatabaseCircuitBreakerForTests();
  }
}

let externalSeq = 8_100_000;

type Page = {
  accountId: string;
  connectionId: string;
  accessSecretId: string;
  refreshSecretId: string;
};

async function seedPage(
  tenantId: string,
  seed: {
    provider?: string;
    kind?: string;
    status?: string;
    grantState?: string;
    connectionId?: string;
  } = {}
): Promise<Page> {
  const admin = getAdminSql();
  const provider = seed.provider ?? "facebook";
  let connectionId = seed.connectionId;
  let accessSecretId = "";
  let refreshSecretId = "";

  if (!connectionId) {
    const access = await asApp(tenantId, (tx) =>
      store.put(tx, {
        tenantId,
        purpose: "provider_access_token",
        plaintext: `EAAG-${(externalSeq += 1)}`,
        createdBy: null
      })
    );
    const refresh = await asApp(tenantId, (tx) =>
      store.put(tx, {
        tenantId,
        purpose: "provider_refresh_token",
        plaintext: `REFRESH-${externalSeq}`,
        createdBy: null
      })
    );
    const connection = (await admin`
      INSERT INTO awcms_channel_provider_connections
        (tenant_id, provider, auth_mode, grant_state, access_secret_id,
         refresh_secret_id)
      VALUES (${tenantId}, ${provider}, 'oauth2', ${seed.grantState ?? "active"},
              ${access.secretId}, ${refresh.secretId})
      RETURNING id
    `) as { id: string }[];

    connectionId = connection[0]!.id;
    accessSecretId = access.secretId;
    refreshSecretId = refresh.secretId;
  }

  const account = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status, connection_id)
    VALUES (${tenantId}, ${provider}, ${seed.kind ?? "page"},
            ${String((externalSeq += 1))}, 'Page', 'oauth2',
            ${seed.status ?? "connected"}, ${connectionId})
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_channel_account_capabilities
      (tenant_id, account_id, capability, state, evidence_kind, evidence_ref,
       matrix_version, verified_at)
    VALUES (${tenantId}, ${account[0]!.id}, 'publish', 'granted',
            'app_review_reference', 'fixture', ${PROVIDER_MATRIX_VERSION}, now())
  `;

  return {
    accountId: account[0]!.id,
    connectionId,
    accessSecretId,
    refreshSecretId
  };
}

async function secretExists(id: string): Promise<boolean> {
  const rows = (await getAdminSql()`
    SELECT 1 FROM awcms_channel_secrets WHERE id = ${id}
  `) as unknown[];

  return rows.length === 1;
}

/** Run `mutate` on the readiness database, read readiness, restore with `restore`, and read it again. */
async function readinessAround(
  mutate: string,
  restore: string,
  check: () => Promise<{
    status: string;
    evidence: string;
  }> = checkWorkerSetupRoleGrants
): Promise<{ broken: { status: string; evidence: string }; restored: string }> {
  const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

  try {
    let broken: { status: string; evidence: string };

    await admin.unsafe(mutate);

    try {
      broken = await check();
    } finally {
      await admin.unsafe(restore);
    }

    return { broken, restored: (await check()).status };
  } finally {
    await admin.close({ timeout: 1 });
  }
}

/** The `CREATE POLICY <name> ... );` statement of `name` in `file`. */
async function policyStatement(file: string, name: string): Promise<string> {
  const text = await Bun.file(file).text();
  const from = text.indexOf(`CREATE POLICY ${name}\n`);
  const to = text.indexOf("\n  );", from);

  if (from < 0 || to < 0)
    throw new Error(`no CREATE POLICY ${name} in ${file}`);

  return text.slice(from, to + "\n  );".length);
}

async function seedTenants(): Promise<void> {
  for (const [id, code] of [
    [TENANT_A, "cph1145-a"],
    [TENANT_B, "cph1145-b"]
  ] as const) {
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }

  // The operator who disconnects (a real tenant user: `updated_by` is a FK).
  const admin = getAdminSql();
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT_A}, 'person', 'operator') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT_A}, ${profile[0]!.id}, 'operator-1145@example.test', 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${ACTOR}, ${TENANT_A}, ${identity[0]!.id})
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("the #1145 credential-path review fixes against PostgreSQL", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();

    const admin = getAdminSql();
    const database = (
      (await admin`SELECT current_database() AS name`) as { name: string }[]
    )[0]!.name;

    await admin.unsafe(`ALTER ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASSWORD}'`);
    await admin.unsafe(
      `ALTER ROLE ${TELEGRAM_ROLE} LOGIN PASSWORD '${TELEGRAM_PASSWORD}'`
    );
    roleLogin = new Bun.SQL(loginUrl(ROLE, ROLE_PASSWORD, database), {
      max: 2
    });
    telegramLogin = new Bun.SQL(
      loginUrl(TELEGRAM_ROLE, TELEGRAM_PASSWORD, database),
      { max: 1 }
    );
  });

  afterAll(async () => {
    await roleLogin?.close({ timeout: 1 });
    await telegramLogin?.close({ timeout: 1 });
    roleLogin = undefined;
    telegramLogin = undefined;
    // Back to the shipped state: NOLOGIN, passwordless.
    await getAdminSql().unsafe(`ALTER ROLE ${ROLE} NOLOGIN PASSWORD NULL`);
    await getAdminSql().unsafe(
      `ALTER ROLE ${TELEGRAM_ROLE} NOLOGIN PASSWORD NULL`
    );
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenants();
  });

  describe("HIGH: the role cannot make an account un-revocable", () => {
    test("as the role, every direct account and health write is refused, version = 2147483647 included", async () => {
      const page = await seedPage(TENANT_A);
      const statements = [
        (tx) =>
          tx`UPDATE awcms_channel_accounts SET status = 'degraded', version = 2147483647 WHERE id = ${page.accountId}`,
        (tx) =>
          tx`UPDATE awcms_channel_accounts SET version = 2147483647 WHERE id = ${page.accountId}`,
        (tx) =>
          tx`UPDATE awcms_channel_accounts SET status_reason = 'EAAG-x' WHERE id = ${page.accountId}`,
        (tx) => tx`SELECT version FROM awcms_channel_accounts`,
        (tx) =>
          tx`INSERT INTO awcms_channel_account_health (tenant_id, account_id, state, reason_code, checked_at) VALUES (${TENANT_A}, ${page.accountId}, 'failing', 'X', now() - interval '9 years')`,
        (tx) => tx`SELECT checked_at FROM awcms_channel_account_health`
      ] as ((tx: Bun.TransactionSQL) => Promise<unknown>)[];

      for (const statement of statements) {
        expect(await sqlState(() => asRole(TENANT_A, statement))).toBe("42501");
      }

      const row = (await getAdminSql()`
        SELECT status, version FROM awcms_channel_accounts WHERE id = ${page.accountId}
      `) as { status: string; version: number }[];

      expect(row[0]).toEqual({ status: "connected", version: 1 });
    });

    test("the definer report moves version by one per real transition, whatever the role repeats", async () => {
      const page = await seedPage(TENANT_A);
      const report = () =>
        asRole(TENANT_A, (tx) =>
          publishers.reportPublishCredentialRejected(tx, {
            tenantId: TENANT_A,
            accountId: page.accountId
          })
        );

      expect(await report()).toEqual({ recorded: true });

      for (let i = 0; i < 25; i += 1) {
        expect(await report()).toEqual({ recorded: false });
      }

      const row = (await getAdminSql()`
        SELECT a.status, a.status_reason, a.version, h.state, h.reason_code,
               h.checked_at > now() - interval '1 minute' AS fresh
        FROM awcms_channel_accounts a
        JOIN awcms_channel_account_health h
          ON h.tenant_id = a.tenant_id AND h.account_id = a.id
        WHERE a.id = ${page.accountId}
      `) as Record<string, unknown>[];

      expect(row[0]).toEqual({
        status: "degraded",
        status_reason: "PUBLISH_CREDENTIAL_REJECTED",
        version: 2,
        state: "failing",
        reason_code: "PUBLISH_CREDENTIAL_REJECTED",
        fresh: true
      });
    });

    test("the definer refuses another tenant, and leaves WhatsApp, Instagram and deleted accounts alone", async () => {
      const page = await seedPage(TENANT_A);
      const whatsapp = await seedPage(TENANT_A, {
        provider: "whatsapp_cloud",
        kind: "waba_phone_number"
      });
      const instagram = await seedPage(TENANT_A, {
        provider: "instagram",
        kind: "professional_account"
      });
      const call = (tenantArg: string, accountId: string) =>
        asRole(
          TENANT_A,
          async (tx) =>
            (
              (await tx`
                SELECT awcms_social_report_credential_rejected(
                  ${tenantArg}::uuid, ${accountId}::uuid
                ) AS code
              `) as { code: string }[]
            )[0]!.code
        );

      expect(await sqlState(() => call(TENANT_B, page.accountId))).toBe(
        "42501"
      );
      expect(await call(TENANT_A, whatsapp.accountId)).toBe("NOT_A_PUBLISHER");
      expect(await call(TENANT_A, instagram.accountId)).toBe("NOT_A_PUBLISHER");

      const untouched = (await getAdminSql()`
        SELECT status FROM awcms_channel_accounts
        WHERE id IN (${page.accountId}, ${whatsapp.accountId}, ${instagram.accountId})
      `) as { status: string }[];

      expect(untouched.map((row) => row.status)).toEqual([
        "connected",
        "connected",
        "connected"
      ]);
      // And nobody but the dispatcher may call it: the app role is refused.
      expect(
        await sqlState(() =>
          asApp(
            TENANT_A,
            (tx) =>
              tx`SELECT awcms_social_report_credential_rejected(${TENANT_A}::uuid, ${page.accountId}::uuid)`
          )
        )
      ).toBe("42501");
    });

    test("after the role tries every sabotage it has, the app role still disconnects the account and revokes the connection, ciphertext included", async () => {
      const page = await seedPage(TENANT_A);
      const sibling = await seedPage(TENANT_A, {
        connectionId: page.connectionId
      });

      // Everything the role could try (refused or bounded).
      await sqlState(() =>
        asRole(
          TENANT_A,
          (tx) =>
            tx`UPDATE awcms_channel_accounts SET status = 'degraded', version = 2147483647 WHERE id = ${page.accountId}`
        )
      );
      for (let i = 0; i < 5; i += 1) {
        await asRole(TENANT_A, (tx) =>
          publishers.reportPublishCredentialRejected(tx, {
            tenantId: TENANT_A,
            accountId: page.accountId
          })
        );
      }

      const disconnected = await asApp(TENANT_A, (tx) =>
        disconnectAccount(tx, store, TENANT_A, ACTOR, page.accountId)
      );

      expect(disconnected).toMatchObject({
        outcome: "disconnected",
        connectionRevoked: false
      });

      const revoked = await asApp(TENANT_A, (tx) =>
        revokeConnection(tx, store, TENANT_A, page.connectionId)
      );

      expect(revoked).toEqual({ outcome: "revoked", accountsRevoked: 1 });
      expect(await secretExists(page.accessSecretId)).toBe(false);
      expect(await secretExists(page.refreshSecretId)).toBe(false);
      expect(sibling.accountId).not.toBe(page.accountId);
    });
  });

  describe("MEDIUM-1 + L3: the secret view is what the adapter decrypts", () => {
    test("as the role, only the connected Facebook Page on an active grant is visible", async () => {
      const live = await seedPage(TENANT_A);
      const degraded = await seedPage(TENANT_A, { status: "degraded" });
      const expired = await seedPage(TENANT_A, { grantState: "expired" });
      const instagram = await seedPage(TENANT_A, {
        provider: "instagram",
        kind: "professional_account"
      });
      const youtube = await seedPage(TENANT_A, {
        provider: "youtube",
        kind: "channel"
      });
      const visible = await asRole(TENANT_A, async (tx) =>
        (
          (await tx`SELECT id FROM awcms_channel_secrets`) as { id: string }[]
        ).map((row) => row.id)
      );

      expect(visible).toEqual([live.accessSecretId]);

      for (const hidden of [degraded, expired, instagram, youtube]) {
        expect(visible).not.toContain(hidden.accessSecretId);
      }
    });

    const widenings: [string, (s: string) => string][] = [
      [
        "a degraded account admitted",
        (s) =>
          s.replace(
            "a.status = 'connected'",
            "a.status IN ('connected', 'degraded')"
          )
      ],
      [
        "an expired grant admitted",
        (s) =>
          s.replace(
            "c.grant_state = 'active'",
            "c.grant_state IN ('active', 'expired')"
          )
      ],
      [
        "Instagram admitted (no connector)",
        (s) =>
          s.replace(
            "c.provider = 'facebook'",
            "c.provider IN ('facebook', 'instagram')"
          )
      ]
    ];

    for (const [label, widen] of widenings) {
      test(`the secret policy with ${label} FAILS readiness, by the pin AND the probe`, async () => {
        const name = "awcms_channel_secrets_social_dispatch_publish";
        const original = await policyStatement(BOUNDS_FILE, name);
        const mutated = widen(original);

        expect(mutated).not.toBe(original);

        const outcome = await readinessAround(
          `DROP POLICY ${name} ON awcms_channel_secrets; ${mutated}`,
          `DROP POLICY IF EXISTS ${name} ON awcms_channel_secrets; ${original}`
        );

        expect(outcome.broken.status, label).toBe("fail");
        expect(outcome.broken.evidence).toContain(name);
        expect(outcome.restored).toBe("pass");

        // The probe on its own sees the widening too.
        const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });
        let finding: string | undefined;

        try {
          await admin.unsafe(
            `DROP POLICY ${name} ON awcms_channel_secrets; ${mutated}`
          );
          finding = (await probeSocialDispatchSecretVisibility(admin)).finding;
        } finally {
          await admin.unsafe(
            `DROP POLICY IF EXISTS ${name} ON awcms_channel_secrets; ${original}`
          );
          await admin.close({ timeout: 1 });
        }

        expect(finding, label).toContain("awcms_social_dispatch saw");
      });
    }
  });

  describe("MEDIUM-2: the dedicated roles are members of nothing", () => {
    test("a NOINHERIT + SET membership in awcms_app is refused at start and by readiness, for the social role", async () => {
      await assertConnectedAsSocialDispatchRole(roleLogin!);

      const admin = getAdminSql();
      let startMessage = "";
      let readiness: { status: string; evidence: string } | undefined;

      await admin.unsafe(
        `GRANT awcms_app TO ${ROLE} WITH INHERIT FALSE, SET TRUE`
      );

      try {
        try {
          await assertConnectedAsSocialDispatchRole(roleLogin!);
        } catch (error) {
          startMessage = (error as Error).message;
        }
        readiness = await checkWorkerSetupRoleGrants();
      } finally {
        await admin.unsafe(`REVOKE awcms_app FROM ${ROLE}`);
      }

      expect(startMessage).toContain("a member of awcms_app");
      expect(readiness?.status).toBe("fail");
      expect(readiness?.evidence).toContain(
        "awcms_social_dispatch is a member of awcms_app"
      );
      expect((await checkWorkerSetupRoleGrants()).status).toBe("pass");
      await assertConnectedAsSocialDispatchRole(roleLogin!);
    });

    test("the same membership of the Telegram dispatcher's role is refused at start and by its readiness check", async () => {
      await assertConnectedAsTelegramRole(telegramLogin!);

      const admin = getAdminSql();
      let startMessage = "";
      let readiness: { status: string; evidence: string } | undefined;

      await admin.unsafe(
        `GRANT awcms_app TO ${TELEGRAM_ROLE} WITH INHERIT FALSE, SET TRUE`
      );

      try {
        try {
          await assertConnectedAsTelegramRole(telegramLogin!);
        } catch (error) {
          startMessage = (error as Error).message;
        }
        readiness = await checkTelegramEngagementDispatchRole();
      } finally {
        await admin.unsafe(`REVOKE awcms_app FROM ${TELEGRAM_ROLE}`);
      }

      expect(startMessage).toContain("a member of awcms_app");
      expect(readiness?.status).toBe("fail");
      expect(readiness?.evidence).toContain(
        `${TELEGRAM_ROLE} is a member of awcms_app`
      );
      expect((await checkTelegramEngagementDispatchRole()).status).toBe("pass");
    });

    test("awcms_worker as a member of the social role is a readiness finding, even when listed", async () => {
      const previous = process.env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS;

      process.env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS = "awcms_worker";

      try {
        const outcome = await readinessAround(
          `GRANT ${ROLE} TO awcms_worker WITH INHERIT TRUE, SET TRUE`,
          `REVOKE ${ROLE} FROM awcms_worker`
        );

        expect(outcome.broken.status).toBe("fail");
        expect(outcome.broken.evidence).toContain(
          `awcms_worker is a member of ${ROLE} with SET and INHERIT`
        );
        expect(outcome.restored).toBe("pass");
      } finally {
        if (previous === undefined) {
          delete process.env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS;
        } else {
          process.env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS = previous;
        }
      }
    });

    test("a readiness login listed in SECURITY_READINESS_DEDICATED_ROLE_MEMBERS may be a SET member; unlisted it is a finding", async () => {
      const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });
      const prober = "awcms_t1145_readiness_probe";
      const previous = process.env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS;

      try {
        await admin.unsafe(`DROP ROLE IF EXISTS ${prober}`);
        await admin.unsafe(`CREATE ROLE ${prober} NOLOGIN`);
        await admin.unsafe(
          `GRANT ${ROLE} TO ${prober} WITH INHERIT FALSE, SET TRUE`
        );

        delete process.env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS;

        const unlisted = await checkWorkerSetupRoleGrants();

        process.env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS = prober;

        const listed = await checkWorkerSetupRoleGrants();

        expect(unlisted.status).toBe("fail");
        expect(unlisted.evidence).toContain(
          `${prober} is a member of ${ROLE} with SET`
        );
        expect(listed.status, listed.evidence).toBe("pass");
      } finally {
        if (previous === undefined) {
          delete process.env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS;
        } else {
          process.env.SECURITY_READINESS_DEDICATED_ROLE_MEMBERS = previous;
        }
        await admin.unsafe(`DROP ROLE IF EXISTS ${prober}`);
        await admin.close({ timeout: 1 });
      }
    });
  });

  describe("MEDIUM-4: taking the last account out of service revokes its connection", () => {
    test("disconnecting the last live account on an OAuth connection deletes the connection's token ciphertexts", async () => {
      const page = await seedPage(TENANT_A);
      const result = await asApp(TENANT_A, (tx) =>
        disconnectAccount(tx, store, TENANT_A, ACTOR, page.accountId)
      );

      expect(result).toMatchObject({
        outcome: "disconnected",
        credentialErased: true,
        connectionRevoked: true
      });
      expect(await secretExists(page.accessSecretId)).toBe(false);
      expect(await secretExists(page.refreshSecretId)).toBe(false);

      const connection = (await getAdminSql()`
        SELECT grant_state, access_secret_id, refresh_secret_id
        FROM awcms_channel_provider_connections WHERE id = ${page.connectionId}
      `) as Record<string, unknown>[];

      expect(connection[0]).toEqual({
        grant_state: "revoked",
        access_secret_id: null,
        refresh_secret_id: null
      });
    });

    test("a connection still serving another live account keeps its grant; the second disconnect revokes it", async () => {
      const first = await seedPage(TENANT_A);
      const second = await seedPage(TENANT_A, {
        connectionId: first.connectionId,
        status: "disabled"
      });
      const one = await asApp(TENANT_A, (tx) =>
        disconnectAccount(tx, store, TENANT_A, ACTOR, first.accountId)
      );

      expect(one).toMatchObject({ connectionRevoked: false });
      expect(await secretExists(first.accessSecretId)).toBe(true);

      const two = await asApp(TENANT_A, (tx) =>
        disconnectAccount(tx, store, TENANT_A, ACTOR, second.accountId)
      );

      expect(two).toMatchObject({ connectionRevoked: true });
      expect(await secretExists(first.accessSecretId)).toBe(false);
    });

    test("deleting a revoked account left on a live connection (the S4 leftover) revokes the orphaned grant", async () => {
      const page = await seedPage(TENANT_A, { status: "revoked" });

      expect(await secretExists(page.accessSecretId)).toBe(true);

      const result = await asApp(TENANT_A, (tx) =>
        deleteAccount(tx, store, TENANT_A, ACTOR, page.accountId)
      );

      expect(result).toEqual({ outcome: "deleted", connectionRevoked: true });
      expect(await secretExists(page.accessSecretId)).toBe(false);
      expect(await secretExists(page.refreshSecretId)).toBe(false);
    });

    test("two sibling disconnects racing still revoke the connection exactly once (the connection lock serialises them)", async () => {
      // Several rounds: without the lock the two transactions each see the
      // other's account as live and NEITHER revokes, but only when they
      // interleave, so one round alone could pass by luck.
      for (let round = 0; round < 6; round += 1) {
        const first = await seedPage(TENANT_A);
        const second = await seedPage(TENANT_A, {
          connectionId: first.connectionId
        });
        const results = await Promise.all(
          [first, second].map((page) =>
            asApp(TENANT_A, (tx) =>
              disconnectAccount(tx, store, TENANT_A, ACTOR, page.accountId)
            )
          )
        );

        expect(
          results.filter(
            (result) =>
              result.outcome === "disconnected" && result.connectionRevoked
          ),
          `round ${round}`
        ).toHaveLength(1);
        expect(await secretExists(first.accessSecretId), `round ${round}`).toBe(
          false
        );
      }
    });
  });

  describe("L1: the role writes no free text", () => {
    test("a token in last_error, error_message or an audit row is refused as the role; the vocabulary passes", async () => {
      const page = await seedPage(TENANT_A);
      const admin = getAdminSql();
      const publication = (
        (await admin`
          INSERT INTO awcms_social_publications
            (tenant_id, source_kind, trigger_event, state, title, caption,
             content_hash, approval_required)
          VALUES (${TENANT_A}, 'manual', 'manual_editor_action', 'ready', 't',
                  'c', ${"0".repeat(64)}, false)
          RETURNING id
        `) as { id: string }[]
      )[0]!.id;
      const job = (
        (await admin`
          INSERT INTO awcms_social_publish_jobs
            (tenant_id, publication_id, channel_account_id, provider,
             account_kind, variant, idempotency_key)
          VALUES (${TENANT_A}, ${publication}, ${page.accountId}, 'facebook',
                  'page', 'text', ${"a".repeat(64)})
          RETURNING id
        `) as { id: string }[]
      )[0]!.id;
      const audit =
        (row: Record<string, unknown>) => (tx: Bun.TransactionSQL) =>
          tx`
          INSERT INTO awcms_audit_events
            (tenant_id, module_key, action, resource_type, resource_id,
             severity, message, attributes)
          SELECT e.tenant_id, e.module_key, e.action, e.resource_type,
                 e.resource_id, e.severity, e.message, e.attributes
          FROM jsonb_to_record(${{
            tenant_id: TENANT_A,
            module_key: "social_publishing",
            action: "social_publishing.job.failed",
            resource_type: "social_publish_job",
            resource_id: job,
            severity: "warning",
            message: "A social publish job failed.",
            attributes: { failureCode: "NEEDS_REAUTH", accountDegraded: true },
            ...row
          }}::jsonb) AS e (
            tenant_id uuid, module_key text, action text, resource_type text,
            resource_id text, severity text, message text, attributes jsonb
          )
        `;

      const refused: [string, (tx: Bun.TransactionSQL) => Promise<unknown>][] =
        [
          [
            "last_error token",
            (tx) =>
              tx`UPDATE awcms_social_publish_jobs SET last_error = 'EAAG-plaintext' WHERE id = ${job}`
          ],
          [
            "error_message token",
            (tx) =>
              tx`INSERT INTO awcms_social_publish_attempts (tenant_id, job_id, attempt_no, outcome, error_code, error_message) VALUES (${TENANT_A}, ${job}, 1, 'retryable', 'X_CODE', 'EAAG-plaintext')`
          ],
          [
            "audit token attribute",
            audit({ attributes: { token: "EAAG-plaintext" } })
          ],
          [
            "audit token in a known key",
            audit({ attributes: { failureCode: "EAAG-plaintext" } })
          ],
          ["audit free message", audit({ message: "EAAG-plaintext" })],
          [
            "audit long attempt number",
            audit({ attributes: { attemptNo: 12345678901234567890 } })
          ]
        ];

      for (const [what, statement] of refused) {
        expect(await sqlState(() => asRole(TENANT_A, statement)), what).toBe(
          "42501"
        );
      }

      // Positive controls: the dispatcher's own values still pass.
      await asRole(
        TENANT_A,
        (tx) =>
          tx`UPDATE awcms_social_publish_jobs SET last_error = 'The provider did not answer in time.' WHERE id = ${job}`
      );
      await asRole(
        TENANT_A,
        (tx) =>
          tx`INSERT INTO awcms_social_publish_attempts (tenant_id, job_id, attempt_no, outcome, error_code, error_message) VALUES (${TENANT_A}, ${job}, 1, 'retryable', 'PROVIDER_TIMEOUT', 'The provider did not answer in time.')`
      );
      await asRole(TENANT_A, audit({}));

      const stored = (await admin`
        SELECT count(*)::int AS n FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND module_key = 'social_publishing'
      `) as { n: number }[];

      expect(stored[0]!.n).toBe(1);
    });
  });

  describe("readiness pins every new control exactly (mutations FAIL, restore passes)", () => {
    test("readiness and both probes pass on the migrated database", async () => {
      const result = await checkWorkerSetupRoleGrants();

      expect(result.status, result.evidence).toBe("pass");
      expect(result.evidence).not.toContain("WARNING");
      expect(await probeSocialDispatchWriteBoundary(getAdminSql())).toEqual({
        ran: true
      });
    });

    const pinned = SOCIAL_DISPATCH_DEFINER_FUNCTIONS[0]!;
    const mutations: [string, string, string][] = [
      [
        "UPDATE (version) re-granted to the role (HIGH)",
        `GRANT UPDATE (version) ON awcms_channel_accounts TO ${ROLE}`,
        `REVOKE UPDATE (version) ON awcms_channel_accounts FROM ${ROLE}`
      ],
      [
        "a health INSERT re-granted to the role (HIGH)",
        `GRANT INSERT (tenant_id, account_id, state, reason_code, checked_at) ON awcms_channel_account_health TO ${ROLE}`,
        `REVOKE INSERT (tenant_id, account_id, state, reason_code, checked_at) ON awcms_channel_account_health FROM ${ROLE}`
      ],
      [
        "EXECUTE on the definer granted to PUBLIC (HIGH)",
        `GRANT EXECUTE ON FUNCTION ${pinned.signature} TO PUBLIC`,
        `REVOKE EXECUTE ON FUNCTION ${pinned.signature} FROM PUBLIC`
      ],
      [
        "the owner role given a table-level UPDATE (HIGH)",
        "GRANT UPDATE ON awcms_channel_accounts TO awcms_social_credential_report",
        // A table-level REVOKE also revokes the column grants: put them back.
        "REVOKE UPDATE ON awcms_channel_accounts FROM awcms_social_credential_report; GRANT UPDATE (status, status_reason, updated_at, version) ON awcms_channel_accounts TO awcms_social_credential_report"
      ],
      [
        "the dedupe guard disabled (L2)",
        "ALTER TABLE awcms_social_publish_jobs DISABLE TRIGGER awcms_social_publish_jobs_dedupe_flag_guard",
        "ALTER TABLE awcms_social_publish_jobs ENABLE TRIGGER awcms_social_publish_jobs_dedupe_flag_guard"
      ]
    ];

    for (const [label, mutate, restore] of mutations) {
      test(`readiness FAILS with ${label}`, async () => {
        const outcome = await readinessAround(mutate, restore);

        expect(outcome.broken.status, label).toBe("fail");
        expect(outcome.restored, `${label} restored`).toBe("pass");
      });
    }

    test("a hollowed definer body (no `status = 'connected'` test, a chosen version) FAILS readiness, by the pin and by the probe", async () => {
      const original = await Bun.file(REPORT_FILE).text();
      const from = original.indexOf(
        "CREATE OR REPLACE FUNCTION awcms_social_report_credential_rejected("
      );
      const to = original.indexOf("$function$;", from) + "$function$;".length;
      const create = original.slice(from, to);
      const hollowed = create
        .replace(
          "  IF v_status IS DISTINCT FROM 'connected' THEN\n    RETURN 'UNCHANGED';\n  END IF;\n",
          ""
        )
        .replace("version = version + 1", "version = 2147483647");

      expect(hollowed).not.toBe(create);

      const outcome = await readinessAround(hollowed, create);

      expect(outcome.broken.status).toBe("fail");
      expect(outcome.broken.evidence).toContain(
        "its body is no longer the reviewed one"
      );
      expect(outcome.broken.evidence).toContain("write boundary");
      expect(outcome.restored).toBe("pass");
    });

    test("a hollowed dedupe guard body FAILS readiness (L2: it was probe-only before)", async () => {
      const original = await Bun.file(
        "sql/373_awcms_social_dispatch_runtime_grants.sql"
      ).text();
      const from = original.indexOf(
        "CREATE OR REPLACE FUNCTION awcms_social_publish_jobs_dedupe_flag_guard()"
      );
      const to = original.indexOf("$function$;", from) + "$function$;".length;
      const create = original.slice(from, to);
      const hollowed = create.replace(
        "current_user = 'awcms_social_dispatch'",
        "current_user = 'nobody_at_all'"
      );

      expect(hollowed).not.toBe(create);

      const outcome = await readinessAround(hollowed, create);

      expect(outcome.broken.status).toBe("fail");
      expect(outcome.broken.evidence).toContain(
        "awcms_social_publish_jobs_dedupe_flag_guard"
      );
      expect(outcome.restored).toBe("pass");
    });

    const valueMutations: [string, string, string, (s: string) => string][] = [
      [
        "awcms_social_publish_jobs",
        "awcms_social_publish_jobs_social_dispatch_update",
        "last_error unbounded",
        (s) =>
          s.replace(
            "last_error IS NULL\n      OR last_error IN (",
            "true OR last_error IN ("
          )
      ],
      [
        "awcms_social_publish_attempts",
        "awcms_social_publish_attempts_social_dispatch_insert",
        "error_message unbounded",
        (s) =>
          s.replace(
            "error_message IS NULL\n",
            "true OR error_message IS NULL\n"
          )
      ],
      [
        "awcms_audit_events",
        "awcms_audit_events_social_dispatch_insert",
        "any attribute key admitted",
        (s) =>
          s.replace(
            "        'failureCode', 'accountDegraded'\n",
            "        'failureCode', 'accountDegraded', 'token'\n"
          )
      ],
      [
        "awcms_audit_events",
        "awcms_audit_events_social_dispatch_insert",
        "a free message admitted",
        (s) =>
          s.replace(
            "    AND message IN (",
            "    AND message IS NOT NULL OR message IN ("
          )
      ]
    ];

    for (const [table, name, label, widen] of valueMutations) {
      test(`${name} with ${label} FAILS readiness (L1)`, async () => {
        const original = await policyStatement(BOUNDS_FILE, name);
        const mutated = widen(original);

        expect(mutated).not.toBe(original);

        const outcome = await readinessAround(
          `DROP POLICY ${name} ON ${table}; ${mutated}`,
          `DROP POLICY IF EXISTS ${name} ON ${table}; ${original}`
        );

        expect(outcome.broken.status, label).toBe("fail");
        expect(outcome.broken.evidence).toContain(name);
        expect(outcome.restored).toBe("pass");
      });
    }
  });
});
