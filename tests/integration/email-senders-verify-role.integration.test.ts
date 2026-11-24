/**
 * The dedicated database role of `email:senders:verify` and the advisory DNS
 * evidence, against a real PostgreSQL (Issue #1479, ADR-0162 O1, owner
 * decisions K19.1 and K19.2).
 *
 * Every assertion about the role LOGS IN AS `awcms_email_senders_verify` (a real
 * LOGIN, not `SET ROLE` from a superuser: the guard trigger and the
 * `assertConnectedAs...` check read the session). Abuse is attempted, and the
 * rows are then re-read through the ADMIN connection to prove nothing moved.
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
import {
  assertConnectedAsEmailSendersVerifyRole,
  EMAIL_SENDERS_VERIFY_ROLE_NAME
} from "../../src/lib/database/email-senders-verify-client";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { recordAccountHealth } from "../../src/modules/channel-accounts/application/account-directory";
import { emailAccountDirectoryAdapter } from "../../src/modules/channel-accounts/application/channel-account-port-adapter";
import { createChannelSenderCredentialAdapter } from "../../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { newEmailSenderDnsDeps } from "../../src/modules/email/application/email-sender-dns-evidence";
import { verifyEmailSendersForTenant } from "../../src/modules/email/application/email-sender-verify";
import type { TxtLookup } from "../../src/modules/email/domain/email-sender-dns";
import type { MailketingV2AccountProbe } from "../../src/modules/email/infrastructure/mailketing-v2-provider";

const ROLE = EMAIL_SENDERS_VERIFY_ROLE_NAME;
const ROLE_PASSWORD = "integration_email_senders_verify_password";
const TENANT_A = "c1479000-0000-4000-8000-00000000000a";
const TENANT_B = "c1479000-0000-4000-8000-00000000000b";

const SECRET_KEY = Buffer.from(
  Array.from({ length: 32 }, (_, i) => (i * 11 + 3) % 251)
).toString("base64");
const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${SECRET_KEY}`
} as unknown as NodeJS.ProcessEnv);

if (!ring.ok) throw new Error(ring.reason);

const store = createKeyRingSecretStore(() => ring);
const CA_ENV = {
  CHANNEL_ACCOUNTS_ENABLED: "true"
} as unknown as NodeJS.ProcessEnv;
const credentials = createChannelSenderCredentialAdapter({
  store,
  env: CA_ENV
});

let roleSql: Bun.SQL | undefined;
const asRole = () => roleSql!;
const admin = () => getAdminSql();

type World = {
  espToken: string;
  esp: string;
  espSecret: string;
  sender: string;
  senderAddress: string;
  sender2: string;
  revokedEsp: string;
  revokedSecret: string;
  wrongPurposeEsp: string;
  wrongPurposeSecret: string;
  whatsapp: string;
  whatsappSecret: string;
  telegram: string;
  telegramSecret: string;
  social: string;
  socialSecret: string;
  otherTenantEsp: string;
  otherTenantSecret: string;
  otherTenantSender: string;
  degradedSender: string;
  senderSecret: string;
  otherEsp: string;
  otherEspSecret: string;
};

async function seedTenant(id: string, code: string) {
  await admin()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${id}, ${code}, ${code}, 'active')
  `;
}

async function rawSecret(tenantId: string, purpose: string): Promise<string> {
  return (
    (await admin()`
      INSERT INTO awcms_channel_secrets (tenant_id, purpose, ciphertext, key_id)
      VALUES (${tenantId}, ${purpose}, 'v2:probe:aa:bb:cc', 'probe')
      RETURNING id
    `) as { id: string }[]
  )[0]!.id;
}

async function account(
  tenantId: string,
  provider: string,
  kind: string,
  authMode: string,
  status: string,
  secretId: string | null,
  externalId = `ext-${crypto.randomUUID()}`,
  parent: string | null = null
): Promise<string> {
  return (
    (await admin()`
      INSERT INTO awcms_channel_accounts
        (tenant_id, provider, account_kind, external_id, display_name,
         auth_mode, status, secret_id, parent_account_id)
      VALUES (${tenantId}, ${provider}, ${kind}, ${externalId}, 'fixture',
              ${authMode}, ${status}, ${secretId}, ${parent})
      RETURNING id
    `) as { id: string }[]
  )[0]!.id;
}

async function seedWorld(): Promise<World> {
  await seedTenant(TENANT_A, "t1479-a");
  await seedTenant(TENANT_B, "t1479-b");

  const espToken = "CANARY-1479-live-esp-token";
  const ref = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
    store.put(tx, {
      tenantId: TENANT_A,
      purpose: "api_token",
      plaintext: espToken,
      createdBy: null
    })
  );
  const esp = await account(
    TENANT_A,
    "mailketing",
    "esp_account",
    "api_token",
    "connected",
    ref.secretId,
    "mk-a"
  );

  await admin()`
    UPDATE awcms_channel_accounts SET connected_at = now() - interval '2 days'
    WHERE id = ${esp}
  `;
  const senderAddress = "News@Brand-A.Example";
  const sender = await account(
    TENANT_A,
    "mailketing",
    "sender_identity",
    "api_token",
    "pending",
    null,
    senderAddress.toLowerCase(),
    esp
  );
  const sender2 = await account(
    TENANT_A,
    "mailketing",
    "sender_identity",
    "api_token",
    "pending",
    null,
    "ops@other-domain.example",
    esp
  );
  const degradedSender = await account(
    TENANT_A,
    "mailketing",
    "sender_identity",
    "api_token",
    "degraded",
    null,
    "old@brand-a.example",
    esp
  );
  // A secret that a sender identity points at (it should hold none, ADR-0151).
  const senderSecret = await rawSecret(TENANT_A, "api_token");

  await admin()`
    UPDATE awcms_channel_accounts SET secret_id = ${senderSecret}
    WHERE id = ${degradedSender}
  `;

  // Another provider that happens to use the same KIND and auth mode.
  const otherEspSecret = await rawSecret(TENANT_A, "api_token");
  const otherEsp = await account(
    TENANT_A,
    "sendgrid",
    "esp_account",
    "api_token",
    "connected",
    otherEspSecret,
    "sg-a"
  );
  const revokedSecret = await rawSecret(TENANT_A, "api_token");
  const revokedEsp = await account(
    TENANT_A,
    "mailketing",
    "esp_account",
    "api_token",
    "revoked",
    revokedSecret,
    "mk-revoked"
  );
  const wrongPurposeSecret = await rawSecret(TENANT_A, "provider_access_token");
  const wrongPurposeEsp = await account(
    TENANT_A,
    "mailketing",
    "esp_account",
    "api_token",
    "connected",
    wrongPurposeSecret,
    "mk-wrong-purpose"
  );
  const whatsappSecret = await rawSecret(TENANT_A, "api_token");
  const whatsapp = await account(
    TENANT_A,
    "whatsapp_cloud",
    "phone_number",
    "api_token",
    "connected",
    whatsappSecret
  );
  const telegramSecret = await rawSecret(TENANT_A, "bot_token");
  const telegram = await account(
    TENANT_A,
    "telegram",
    "bot",
    "bot_token",
    "connected",
    telegramSecret
  );
  const socialSecret = await rawSecret(TENANT_A, "provider_access_token");
  const social = await account(
    TENANT_A,
    "facebook",
    "page",
    "oauth2",
    "connected",
    socialSecret
  );
  const otherTenantSecret = await rawSecret(TENANT_B, "api_token");
  const otherTenantEsp = await account(
    TENANT_B,
    "mailketing",
    "esp_account",
    "api_token",
    "connected",
    otherTenantSecret,
    "mk-b"
  );
  const otherTenantSender = await account(
    TENANT_B,
    "mailketing",
    "sender_identity",
    "api_token",
    "pending",
    null,
    "news@brand-b.example",
    otherTenantEsp
  );

  return {
    espToken,
    esp,
    espSecret: ref.secretId,
    sender,
    senderAddress,
    sender2,
    revokedEsp,
    revokedSecret,
    wrongPurposeEsp,
    wrongPurposeSecret,
    whatsapp,
    whatsappSecret,
    telegram,
    telegramSecret,
    social,
    socialSecret,
    otherTenantEsp,
    otherTenantSecret,
    otherTenantSender,
    degradedSender,
    senderSecret,
    otherEsp,
    otherEspSecret
  };
}

/** Runs `fn` as the role in `tenantId`'s transaction. */
const asRoleIn = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) =>
  withTenantOrThrow(asRole(), tenantId, fn, { workClass: "background_sync" });

/**
 * One abuse attempt in a savepoint: it must either throw (a WITH CHECK, a guard
 * or a missing privilege) or affect no row (a USING policy hides it).
 */
async function expectRefused(
  tenantId: string,
  run: (sp: Bun.SQL) => Promise<unknown[]>,
  label = ""
): Promise<void> {
  await asRoleIn(tenantId, async (tx) => {
    let rows: unknown[] | null = null;

    try {
      rows = await tx.savepoint((sp) => run(sp));
    } catch {
      return;
    }

    if (rows.length > 0) {
      throw new Error(`NOT REFUSED: ${label} ${run.toString().slice(0, 300)}`);
    }
  });
}

const accountRow = async (id: string) =>
  (
    (await admin()`
      SELECT status, status_reason, version, connected_at, updated_at
      FROM awcms_channel_accounts WHERE id = ${id}
    `) as {
      status: string;
      status_reason: string | null;
      version: number;
      connected_at: Date | null;
      updated_at: Date;
    }[]
  )[0]!;

const healthRow = async (id: string) =>
  (
    (await admin()`
      SELECT state, reason_code, quota_remaining, token_expires_at, quota_limit
      FROM awcms_channel_account_health WHERE account_id = ${id}
    `) as {
      state: string;
      reason_code: string | null;
      quota_remaining: string | null;
      token_expires_at: Date | null;
      quota_limit: string | null;
    }[]
  )[0];

const suite = integrationEnabled ? describe : describe.skip;

suite("the email:senders:verify database role against PostgreSQL", () => {
  let w: World;

  beforeAll(async () => {
    await setupIntegrationDatabase();

    const database = (
      (await admin()`SELECT current_database() AS name`) as { name: string }[]
    )[0]!.name;
    const url = new URL(process.env.DATABASE_URL!);

    url.username = ROLE;
    url.password = ROLE_PASSWORD;
    url.pathname = `/${database}`;

    await admin().unsafe(
      `ALTER ROLE ${ROLE} LOGIN PASSWORD '${ROLE_PASSWORD}'`
    );
    roleSql = new Bun.SQL(url.toString(), { max: 2 });
  });

  afterAll(async () => {
    await roleSql?.close({ timeout: 1 });
    roleSql = undefined;
    // Back to the shipped state (sql/460: NOLOGIN, passwordless).
    await getAdminSql().unsafe(`ALTER ROLE ${ROLE} NOLOGIN PASSWORD NULL`);
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    w = await seedWorld();
  });

  test("the connection IS awcms_email_senders_verify, and a superuser connection is refused", async () => {
    await assertConnectedAsEmailSendersVerifyRole(asRole());

    let refused = false;

    try {
      await assertConnectedAsEmailSendersVerifyRole(admin());
    } catch {
      refused = true;
    }

    expect(refused).toBe(true);
  });

  describe("what it can READ", () => {
    test("of the channel secrets exactly the live Mailketing ESP api_token, nothing of another kind, purpose, state or tenant", async () => {
      const seen = await asRoleIn(TENANT_A, async (tx) =>
        (
          (await tx`SELECT id FROM awcms_channel_secrets`) as { id: string }[]
        ).map((row) => row.id)
      );

      expect(seen).toEqual([w.espSecret]);

      for (const hidden of [
        w.revokedSecret,
        w.senderSecret,
        w.otherEspSecret,
        w.wrongPurposeSecret,
        w.whatsappSecret,
        w.telegramSecret,
        w.socialSecret,
        w.otherTenantSecret
      ]) {
        expect(seen).not.toContain(hidden);
      }
    });

    test("it cannot reach a hidden secret by id, by ciphertext or by joining", async () => {
      await asRoleIn(TENANT_A, async (tx) => {
        for (const id of [w.whatsappSecret, w.telegramSecret, w.socialSecret]) {
          expect(
            await tx`SELECT ciphertext FROM awcms_channel_secrets WHERE id = ${id}`
          ).toHaveLength(0);
        }

        expect(
          await tx`
            SELECT s.id FROM awcms_channel_secrets s
            JOIN awcms_channel_accounts a ON a.secret_id = s.id
            WHERE a.provider <> 'mailketing'
          `
        ).toHaveLength(0);
      });
    });

    test("it sees only Mailketing accounts, and only its own tenant's under the tenant setting", async () => {
      const rows = await asRoleIn(
        TENANT_A,
        (tx) =>
          tx`SELECT id, provider, tenant_id FROM awcms_channel_accounts` as Promise<
            { id: string; provider: string; tenant_id: string }[]
          >
      );

      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.provider))).toEqual(
        new Set(["mailketing"])
      );
      expect(new Set(rows.map((row) => row.tenant_id))).toEqual(
        new Set([TENANT_A])
      );
      expect(rows.map((row) => row.id)).not.toContain(w.otherTenantEsp);
      expect(rows.map((row) => row.id)).not.toContain(w.whatsapp);
    });

    test("it can read no other table (no privilege at all)", async () => {
      for (const table of [
        "awcms_identities",
        "awcms_tenant_users",
        "awcms_audit_events",
        "awcms_email_messages",
        "awcms_channel_provider_connections"
      ]) {
        let refused = false;

        try {
          await asRole().unsafe(`SELECT 1 FROM ${table} LIMIT 1`);
        } catch {
          refused = true;
        }

        expect(refused).toBe(true);
      }
    });
  });

  describe("what it can WRITE: accounts", () => {
    test("the legitimate transitions work and are stamped exactly", async () => {
      await asRoleIn(TENANT_A, async (tx) => {
        await recordAccountHealth(tx, TENANT_A, w.sender, {
          state: "ok",
          reasonCode: null
        });
        await recordAccountHealth(tx, TENANT_A, w.esp, {
          state: "degraded",
          reasonCode: "CREDIT_DEPLETED",
          quotaRemaining: 0
        });
      });

      const sender = await accountRow(w.sender);
      const esp = await accountRow(w.esp);

      expect(sender.status).toBe("connected");
      expect(sender.status_reason).toBeNull();
      expect(sender.connected_at).not.toBeNull();
      expect(esp.status).toBe("degraded");
      expect(esp.status_reason).toBe("CREDIT_DEPLETED");
      expect((await healthRow(w.esp))?.quota_remaining).toBe("0");
    });

    test("ABUSE: it cannot revoke, disable, delete, re-enable or re-point an account", async () => {
      const before = {
        esp: await accountRow(w.esp),
        revoked: await accountRow(w.revokedEsp),
        wrong: await accountRow(w.wrongPurposeEsp)
      };

      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'revoked', status_reason = NULL WHERE id = ${w.esp} RETURNING id`
      );
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'disabled', status_reason = NULL WHERE id = ${w.esp} RETURNING id`
      );
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'deleted' WHERE id = ${w.esp} RETURNING id`
      );
      // Re-enabling a revoked account would put its token back in the role's view.
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'connected', status_reason = NULL, version = version + 1, updated_at = now() WHERE id = ${w.revokedEsp} RETURNING id`
      );
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET secret_id = ${w.whatsappSecret} WHERE id = ${w.esp} RETURNING id`
      );
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET provider = 'whatsapp_cloud' WHERE id = ${w.esp} RETURNING id`
      );
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET secret_id = ${w.espSecret} WHERE id = ${w.wrongPurposeEsp} RETURNING id`
      );

      expect(await accountRow(w.esp)).toEqual(before.esp);
      expect(await accountRow(w.revokedEsp)).toEqual(before.revoked);
      expect(await accountRow(w.wrongPurposeEsp)).toEqual(before.wrong);
    });

    test("ABUSE: it cannot touch a WhatsApp, Telegram, social or other-tenant account", async () => {
      const ids = [w.whatsapp, w.telegram, w.social, w.otherEsp];
      const before = await Promise.all(ids.map((id) => accountRow(id)));
      const otherBefore = await accountRow(w.otherTenantSender);

      for (const id of ids) {
        await expectRefused(
          TENANT_A,
          (sp) =>
            sp`UPDATE awcms_channel_accounts SET status = 'degraded', status_reason = 'CREDIT_DEPLETED', version = version + 1, updated_at = now() WHERE id = ${id} RETURNING id`
        );
      }
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'connected', status_reason = NULL, version = version + 1, updated_at = now(), connected_at = now() WHERE id = ${w.otherTenantSender} RETURNING id`
      );

      expect(await Promise.all(ids.map((id) => accountRow(id)))).toEqual(
        before
      );
      expect(await accountRow(w.otherTenantSender)).toEqual(otherBefore);
    });

    test("ABUSE (values): a status or reason the job never writes is refused", async () => {
      const before = await accountRow(w.esp);

      // A free-text reason, an unlisted code, a reason on `connected`, none on `degraded`.
      for (const set of [
        "status = 'degraded', status_reason = 'anything the role likes'",
        "status = 'degraded', status_reason = 'CREDENTIAL_REVOKED'",
        "status = 'degraded', status_reason = NULL",
        "status = 'degraded', status_reason = 'CREDIT_DEPLETED' || ' '"
      ]) {
        await expectRefused(TENANT_A, (sp) =>
          sp.unsafe(
            `UPDATE awcms_channel_accounts SET ${set}, version = version + 1, updated_at = now() WHERE id = '${w.esp}' RETURNING id`
          )
        );
      }
      await expectRefused(TENANT_A, (sp) =>
        sp.unsafe(
          `UPDATE awcms_channel_accounts SET status = 'connected', status_reason = 'CREDIT_DEPLETED', connected_at = now(), version = version + 1, updated_at = now() WHERE id = '${w.sender}' RETURNING id`
        )
      );

      expect(await accountRow(w.esp)).toEqual(before);
    });

    test("ABUSE (transitions and counters): a jump, a rewound version, a forged stamp are refused by the guard trigger", async () => {
      const connected = await accountRow(w.esp);

      // connected -> connected is not a transition the job makes.
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'connected', status_reason = NULL, version = version + 1, updated_at = now() WHERE id = ${w.esp} RETURNING id`
      );
      // degraded -> degraded (re-labelling a reason) is not either.
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'degraded', status_reason = 'SENDER_UNVERIFIED', version = version + 1, updated_at = now() WHERE id = ${w.degradedSender} RETURNING id`
      );
      // A wrong version.
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'degraded', status_reason = 'CREDIT_DEPLETED', version = version + 50, updated_at = now() WHERE id = ${w.esp} RETURNING id`
      );
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'degraded', status_reason = 'CREDIT_DEPLETED', version = version, updated_at = now() WHERE id = ${w.esp} RETURNING id`
      );
      // A forged updated_at.
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'degraded', status_reason = 'CREDIT_DEPLETED', version = version + 1, updated_at = now() - interval '1 day' WHERE id = ${w.esp} RETURNING id`
      );
      // A forged connected_at on a verification.
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'connected', status_reason = NULL, connected_at = now() - interval '30 days', version = version + 1, updated_at = now() WHERE id = ${w.sender} RETURNING id`
      );
      // connected_at moved on a degrade.
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_accounts SET status = 'degraded', status_reason = 'CREDIT_DEPLETED', connected_at = NULL, version = version + 1, updated_at = now() WHERE id = ${w.esp} RETURNING id`
      );

      expect(await accountRow(w.esp)).toEqual(connected);
      expect((await accountRow(w.sender)).status).toBe("pending");
    });

    test("it cannot widen the secret view by changing what a row is (no column grant, no insert, no delete)", async () => {
      for (const statement of [
        `UPDATE awcms_channel_accounts SET deleted_at = NULL WHERE id = '${w.revokedEsp}'`,
        `UPDATE awcms_channel_accounts SET account_kind = 'esp_account' WHERE id = '${w.sender}'`,
        `UPDATE awcms_channel_accounts SET auth_mode = 'api_token' WHERE id = '${w.sender}'`,
        `INSERT INTO awcms_channel_accounts (tenant_id, provider, account_kind, external_id, display_name, auth_mode, status) VALUES ('${TENANT_A}', 'mailketing', 'esp_account', 'forged', 'x', 'api_token', 'connected')`,
        `DELETE FROM awcms_channel_accounts WHERE id = '${w.esp}'`,
        `UPDATE awcms_channel_secrets SET ciphertext = 'v2:x:aa:bb:cc' WHERE id = '${w.espSecret}'`,
        `DELETE FROM awcms_channel_secrets WHERE id = '${w.espSecret}'`,
        `INSERT INTO awcms_channel_secrets (tenant_id, purpose, ciphertext, key_id) VALUES ('${TENANT_A}', 'api_token', 'v2:probe:aa:bb:cc', 'probe')`
      ]) {
        let refused = false;

        try {
          await asRoleIn(TENANT_A, (tx) => tx.unsafe(statement));
        } catch {
          refused = true;
        }

        expect(refused).toBe(true);
      }

      expect((await accountRow(w.revokedEsp)).status).toBe("revoked");
    });
  });

  describe("what it can WRITE: health", () => {
    test("the legitimate reports are recorded", async () => {
      await asRoleIn(TENANT_A, async (tx) => {
        await recordAccountHealth(tx, TENANT_A, w.esp, {
          state: "ok",
          reasonCode: null,
          quotaRemaining: 500
        });
        await recordAccountHealth(tx, TENANT_A, w.sender, {
          state: "unknown",
          reasonCode: "SENDER_STATUS_AMBIGUOUS"
        });
      });

      expect((await healthRow(w.esp))?.quota_remaining).toBe("500");
      expect((await healthRow(w.sender))?.reason_code).toBe(
        "SENDER_STATUS_AMBIGUOUS"
      );
    });

    test("ABUSE: another provider's or tenant's account, a revoked one, a free-text reason, a token expiry, a quota limit, a balance on a sender", async () => {
      // No RETURNING: only the WITH CHECK may refuse an INSERT here, not the
      // read-back of the row (which the USING policy would hide anyway).
      const insert = async (
        tenantId: string,
        accountId: string,
        state: string,
        reason: string | null,
        extra = "NULL, NULL, NULL"
      ) => {
        try {
          await asRoleIn(tenantId, (tx) =>
            tx.unsafe(
              `INSERT INTO awcms_channel_account_health (tenant_id, account_id, state, reason_code, token_expires_at, quota_remaining, quota_limit) VALUES ('${tenantId}', '${accountId}', '${state}', ${reason === null ? "NULL" : `'${reason}'`}, ${extra})`
            )
          );
        } catch {
          // Refused by the database: the expectation.
        }
      };

      await insert(TENANT_A, w.whatsapp, "failing", "CREDENTIAL_REJECTED");
      await insert(TENANT_A, w.telegram, "ok", null);
      await insert(TENANT_A, w.social, "failing", "CREDENTIAL_REJECTED");
      await insert(TENANT_A, w.otherEsp, "ok", null);
      await insert(TENANT_A, w.revokedEsp, "ok", null);
      await insert(TENANT_A, w.otherTenantEsp, "ok", null);

      const hidden = (await admin()`
        SELECT account_id FROM awcms_channel_account_health
      `) as { account_id: string }[];

      expect(hidden).toHaveLength(0);

      // The same live ESP account, five different bad values: none lands.
      await insert(TENANT_A, w.esp, "failing", "WHATEVER_THE_ROLE_LIKES");
      await insert(TENANT_A, w.esp, "ok", "CREDIT_DEPLETED");
      await insert(
        TENANT_A,
        w.esp,
        "ok",
        null,
        "now() + interval '1 year', NULL, NULL"
      );
      await insert(TENANT_A, w.esp, "ok", null, "NULL, NULL, 10");
      await insert(TENANT_A, w.esp, "ok", null, "NULL, -5, NULL");
      await insert(TENANT_A, w.sender, "ok", null, "NULL, 100, NULL");
      // The ESP-only codes are not a sender's, and the other way round.
      await insert(TENANT_A, w.sender, "degraded", "CREDIT_DEPLETED");
      await insert(TENANT_A, w.esp, "degraded", "SENDER_UNVERIFIED");

      expect(
        (await admin()`SELECT account_id FROM awcms_channel_account_health`) as unknown[]
      ).toHaveLength(0);
    });

    test("ABUSE: an UPDATE of an existing row cannot bend it, and another module's row cannot be read or changed", async () => {
      await admin()`
        INSERT INTO awcms_channel_account_health (tenant_id, account_id, state)
        VALUES (${TENANT_A}, ${w.whatsapp}, 'ok'), (${TENANT_A}, ${w.esp}, 'ok')
      `;
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_account_health SET state = 'failing', reason_code = 'CREDENTIAL_REJECTED' WHERE account_id = ${w.whatsapp} RETURNING account_id`
      );
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_account_health SET reason_code = 'ANYTHING' WHERE account_id = ${w.esp} RETURNING account_id`
      );
      await expectRefused(
        TENANT_A,
        (sp) =>
          sp`UPDATE awcms_channel_account_health SET token_expires_at = now() WHERE account_id = ${w.esp} RETURNING account_id`
      );
      expect(
        await asRoleIn(
          TENANT_A,
          (tx) =>
            tx`SELECT account_id FROM awcms_channel_account_health WHERE account_id = ${w.whatsapp}`
        )
      ).toHaveLength(0);

      expect((await healthRow(w.whatsapp))?.state).toBe("ok");
      expect((await healthRow(w.esp))?.reason_code).toBeNull();
    });
  });

  describe("what it can WRITE: DNS evidence", () => {
    const evidence = (
      accountId: string,
      domain: string,
      spf = "present",
      dmarc = "present",
      policy: string | null = "none"
    ) =>
      `INSERT INTO awcms_email_sender_dns_evidence (tenant_id, account_id, domain, spf_state, dkim_state, dmarc_state, dmarc_policy, checked_at) VALUES ('${TENANT_A}', '${accountId}', '${domain}', '${spf}', 'not_checked', '${dmarc}', ${policy === null ? "NULL" : `'${policy}'`}, now())`;
    // No RETURNING: only the WITH CHECK may refuse the INSERT, not the read-back.
    const tryInsert = async (statement: string) => {
      try {
        await asRoleIn(TENANT_A, (tx) => tx.unsafe(statement));
      } catch {
        // Refused by the database: the expectation.
      }
    };

    test("a sender's own domain is accepted (case-folded address), and an upsert refreshes the date", async () => {
      await asRoleIn(TENANT_A, async (tx) => {
        await tx.unsafe(evidence(w.sender, "brand-a.example"));
        await tx.unsafe(
          `${evidence(w.sender, "brand-a.example", "absent", "absent", null)} ON CONFLICT (tenant_id, account_id) DO UPDATE SET spf_state = EXCLUDED.spf_state, dmarc_state = EXCLUDED.dmarc_state, dmarc_policy = EXCLUDED.dmarc_policy, checked_at = EXCLUDED.checked_at, updated_at = now()`
        );
      });

      const row = (
        (await admin()`SELECT spf_state, dmarc_state FROM awcms_email_sender_dns_evidence WHERE account_id = ${w.sender}`) as {
          spf_state: string;
          dmarc_state: string;
        }[]
      )[0];

      expect(row).toEqual({ spf_state: "absent", dmarc_state: "absent" });
    });

    test("ABUSE: another domain, an ESP account, another provider's account, another tenant's sender, a revoked one, an unlisted state, a stray policy", async () => {
      await asRoleIn(TENANT_A, async () => undefined);
      await tryInsert(evidence(w.sender, "someone-elses.example"));
      await tryInsert(evidence(w.esp, "brand-a.example"));
      await tryInsert(evidence(w.whatsapp, "brand-a.example"));
      await tryInsert(evidence(w.otherEsp, "brand-a.example"));
      await tryInsert(evidence(w.otherTenantSender, "brand-b.example"));
      await tryInsert(evidence(w.sender, "brand-a.example", "it is fine"));
      await tryInsert(
        evidence(w.sender, "brand-a.example", "present", "absent", "reject")
      );

      expect(
        (
          (await admin()`SELECT count(*)::int AS n FROM awcms_email_sender_dns_evidence`) as {
            n: number;
          }[]
        )[0]!.n
      ).toBe(0);

      // A revoked sender is not one the job lists: no evidence for it either.
      const revokedSender = await account(
        TENANT_A,
        "mailketing",
        "sender_identity",
        "api_token",
        "revoked",
        null,
        "gone@brand-a.example",
        w.esp
      );

      await tryInsert(evidence(revokedSender, "brand-a.example"));

      expect(
        (
          (await admin()`SELECT count(*)::int AS n FROM awcms_email_sender_dns_evidence`) as {
            n: number;
          }[]
        )[0]!.n
      ).toBe(0);
    });
  });

  describe("the job as that role, end to end", () => {
    const resolverFor =
      (answers: Record<string, TxtLookup>) =>
      async (name: string): Promise<TxtLookup> =>
        answers[name] ?? { outcome: "absent" };

    const probe = (verified: string[]): MailketingV2AccountProbe => ({
      readCredits: async () => ({ ok: true, value: 5000 }),
      listVerifiedSenders: async () => ({
        ok: true,
        value: { verified: new Set(verified), ambiguous: new Set() }
      })
    });

    const run = (
      dns: ReturnType<typeof newEmailSenderDnsDeps> | undefined,
      verified: string[]
    ) =>
      verifyEmailSendersForTenant(asRole(), TENANT_A, {
        directory: emailAccountDirectoryAdapter,
        credentials,
        recordHealth: (tx, tenantId, accountId, input) =>
          recordAccountHealth(tx, tenantId, accountId, input),
        env: { EMAIL_SEND_TIMEOUT_MS: "1000" } as unknown as NodeJS.ProcessEnv,
        buildProbe: (token) => {
          expect(token).toBe(w.espToken);

          return probe(verified);
        },
        dns
      });

    test("verifies through the role: the provider's verdict decides, DNS evidence is recorded beside it", async () => {
      const dns = newEmailSenderDnsDeps(
        resolverFor({
          "brand-a.example": {
            outcome: "records",
            records: [["v=spf1 include:_spf.example -all"]]
          },
          "_dmarc.brand-a.example": {
            outcome: "records",
            records: [["v=DMARC1; p=quarantine"]]
          }
        }),
        []
      );
      const summary = await run(dns, [w.senderAddress.toLowerCase()]);

      expect(summary.accountsProbed).toBe(1);
      expect(summary.sendersVerified).toBe(1);
      expect(summary.sendersUnverified).toBe(2);
      expect(summary.dnsChecked).toBe(3);
      expect((await accountRow(w.sender)).status).toBe("connected");
      // A pending sender the provider does not list stays pending (only a
      // connected one is degraded); its health row says why.
      expect((await accountRow(w.sender2)).status).toBe("pending");
      expect((await healthRow(w.sender2))?.reason_code).toBe(
        "SENDER_UNVERIFIED"
      );
      expect((await healthRow(w.esp))?.quota_remaining).toBe("5000");

      const rows = (await admin()`
        SELECT account_id, domain, spf_state, dkim_state, dmarc_state, dmarc_policy, checked_at
        FROM awcms_email_sender_dns_evidence ORDER BY domain
      `) as {
        account_id: string;
        domain: string;
        spf_state: string;
        dkim_state: string;
        dmarc_state: string;
        dmarc_policy: string | null;
        checked_at: Date;
      }[];
      const brand = rows.find((row) => row.account_id === w.sender)!;

      expect(brand).toMatchObject({
        domain: "brand-a.example",
        spf_state: "present",
        dkim_state: "not_checked",
        dmarc_state: "present",
        dmarc_policy: "quarantine"
      });
      expect(brand.checked_at).toBeInstanceOf(Date);
      expect(rows.find((row) => row.account_id === w.sender2)?.domain).toBe(
        "other-domain.example"
      );
    });

    test("ADVISORY: a failing, missing or erroring DNS answer never changes a sender's status", async () => {
      const address = w.senderAddress.toLowerCase();

      for (const dns of [
        newEmailSenderDnsDeps(resolverFor({}), []),
        newEmailSenderDnsDeps(
          resolverFor({
            "brand-a.example": {
              outcome: "records",
              records: [["v=spf1 -all"], ["v=spf1 +all"]]
            },
            "_dmarc.brand-a.example": {
              outcome: "records",
              records: [["v=DMARC1; p=bogus"]]
            }
          }),
          []
        ),
        newEmailSenderDnsDeps(async () => {
          throw new Error("resolver exploded");
        }, [])
      ]) {
        await resetStatuses();
        const summary = await run(dns, [address]);

        expect(summary.sendersVerified).toBe(1);
        expect((await accountRow(w.sender)).status).toBe("connected");
        expect((await healthRow(w.sender))?.state).toBe("ok");
        expect((await accountRow(w.sender2)).status).toBe("pending");
      }
    });

    async function resetStatuses() {
      await admin()`
        UPDATE awcms_channel_accounts
        SET status = 'pending', status_reason = NULL, connected_at = NULL
        WHERE id IN (${w.sender}, ${w.sender2})
      `;
    }

    test("a resolver that could not tell writes nothing, and the last evidence stands with its date", async () => {
      const first = newEmailSenderDnsDeps(
        resolverFor({
          "brand-a.example": {
            outcome: "records",
            records: [["v=spf1 -all"]]
          }
        }),
        []
      );

      await run(first, [w.senderAddress.toLowerCase()]);

      const dated = (await admin()`
        SELECT checked_at, spf_state FROM awcms_email_sender_dns_evidence WHERE account_id = ${w.sender}
      `) as { checked_at: Date; spf_state: string }[];

      await resetStatuses();

      const summary = await run(
        newEmailSenderDnsDeps(async () => ({ outcome: "unavailable" }), []),
        [w.senderAddress.toLowerCase()]
      );
      const after = (await admin()`
        SELECT checked_at, spf_state FROM awcms_email_sender_dns_evidence WHERE account_id = ${w.sender}
      `) as { checked_at: Date; spf_state: string }[];

      expect(summary.dnsLearntNothing).toBe(3);
      expect(summary.dnsChecked).toBe(0);
      expect(after[0]).toEqual(dated[0]!);
      expect(after[0]!.spf_state).toBe("present");
    });

    test("per-sender isolation: one domain's lookup that throws does not stop the other sender's evidence", async () => {
      const dns = newEmailSenderDnsDeps(async (name) => {
        if (name.endsWith("other-domain.example")) {
          throw new Error("boom");
        }

        return { outcome: "absent" };
      }, []);
      const summary = await run(dns, [w.senderAddress.toLowerCase()]);

      expect(summary.dnsFailed).toBe(1);
      expect(summary.dnsChecked).toBe(2);
      expect(summary.sendersVerified).toBe(1);
      expect(
        (
          (await admin()`SELECT account_id FROM awcms_email_sender_dns_evidence`) as {
            account_id: string;
          }[]
        ).map((row) => row.account_id)
      ).not.toContain(w.sender2);
    });

    test("DKIM is looked up only for configured selectors, never invented", async () => {
      const asked: string[] = [];
      const dns = newEmailSenderDnsDeps(
        async (name) => {
          asked.push(name);

          return name === "s1._domainkey.brand-a.example"
            ? {
                outcome: "records",
                records: [
                  ["v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQ"]
                ]
              }
            : { outcome: "absent" };
        },
        ["s1", "s2"]
      );

      await run(dns, [w.senderAddress.toLowerCase()]);

      expect(asked).toContain("s1._domainkey.brand-a.example");
      expect(asked).toContain("s2._domainkey.brand-a.example");
      expect(
        (
          (await admin()`SELECT dkim_state FROM awcms_email_sender_dns_evidence WHERE account_id = ${w.sender}`) as {
            dkim_state: string;
          }[]
        )[0]!.dkim_state
      ).toBe("present");
    });

    test("with the evidence off, no query is made at all", async () => {
      const summary = await run(undefined, [w.senderAddress.toLowerCase()]);

      expect(summary.dnsChecked + summary.dnsFailed + summary.dnsSkipped).toBe(
        0
      );
      expect(
        (
          (await admin()`SELECT count(*)::int AS n FROM awcms_email_sender_dns_evidence`) as {
            n: number;
          }[]
        )[0]!.n
      ).toBe(0);
    });
  });
});
