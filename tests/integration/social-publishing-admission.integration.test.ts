/**
 * The admission conditions of `social_publishing` before the first connector
 * (Issue #1145, ADR-0157 section 6 and its audit residuals), against a real
 * PostgreSQL:
 *
 *   * `awcms_social_dispatch` (sql/358) can decrypt ONLY the access token of a
 *     live social account with a granted `publish` capability (M2), never a
 *     WhatsApp, email or refresh token, never another tenant's, and has no other
 *     privilege; `awcms_worker` still cannot see a social token (sql/328 intact);
 *   * retention (sql/357 + `purgeSocialPublishing`) removes whole, terminal,
 *     old publications and nothing else, honours a legal hold, and the database
 *     floor refuses the worker a younger or non-terminal row on its own;
 *   * `security:readiness` FAILS when either restrictive policy is dropped, and
 *     passes again once it is restored.
 *
 * Gated on `DATABASE_URL` (harness section Gating).
 */
import { readFileSync } from "node:fs";

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
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  reassertRuntimeRoleLogins,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { resetDatabaseCircuitBreakerForTests } from "../../src/lib/database/circuit-breaker";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import type { LegalHoldGuardPort } from "../../src/modules/_shared/ports/legal-hold-guard-port";
import { createChannelSenderCredentialAdapter } from "../../src/modules/channel-accounts/application/channel-sender-credential-adapter";
import { createKeyRingSecretStore } from "../../src/modules/channel-accounts/application/secret-store";
import { resolveChannelSecretsRing } from "../../src/modules/channel-accounts/domain/channel-accounts-config";
import { PROVIDER_MATRIX_VERSION } from "../../src/modules/channel-accounts/domain/provider-matrix";
import { purgeSocialPublishing } from "../../src/modules/social-publishing/application/social-publishing-retention-purge";
import { SOCIAL_PUBLISH_ATTEMPTS_LIFECYCLE_KEY } from "../../src/modules/social-publishing/domain/social-publishing-lifecycle";
import {
  SOCIAL_DISPATCH_PINNED_POLICIES,
  SOCIAL_RETENTION_FLOOR_POLICIES,
  checkWorkerSetupRoleGrants,
  pinPolicyExpression,
  probeSocialDispatchSecretVisibility
} from "../../scripts/security-readiness";

const TENANT_A = "a1145a00-0000-4000-8000-00000000000a";
const TENANT_B = "a1145a00-0000-4000-8000-00000000000b";
const SOCIAL_ROLE = "awcms_social_dispatch";

const bytes = (mul: number) =>
  Buffer.from(
    Array.from({ length: 32 }, (_, i) => (i * mul + 3) % 251)
  ).toString("base64");
const ring = resolveChannelSecretsRing({
  CHANNEL_SECRETS_ENCRYPTION_KEYS: `k1:${bytes(13)}`
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

const KIND: Record<string, string> = {
  facebook: "page",
  instagram: "professional_account",
  threads: "profile",
  tiktok: "creator_account",
  youtube: "channel",
  linkedin: "organization_page"
};

let externalSeq = 7_000_000;

const inTenant = <T>(
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
) => withTenantOrThrow(getRuntimeSql(), tenantId, fn);

/** A transaction that runs as `role` in `tenantId`, opened by the superuser. */
function asRole<T>(
  role: string,
  tenantId: string,
  fn: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return getAdminSql().begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE "${role}"`);
    await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;

    return fn(tx);
  });
}

async function putSecret(
  tenantId: string,
  purpose: string,
  plaintext: string
): Promise<string> {
  const ref = await inTenant(tenantId, (tx) =>
    store.put(tx, {
      tenantId,
      purpose: purpose as "provider_access_token",
      plaintext,
      createdBy: null
    })
  );

  return ref.secretId;
}

type SocialSeed = {
  provider?: string;
  status?: string;
  grantState?: string;
  capabilityState?: string | null;
};

type Seeded = {
  accountId: string;
  connectionId: string;
  secretId: string;
  token: string;
};

/** A social publishing account: an OAuth connection holding a real stored token, the account, its publish capability. */
async function seedSocial(
  tenantId: string,
  seed: SocialSeed = {}
): Promise<Seeded> {
  const admin = getAdminSql();
  const provider = seed.provider ?? "facebook";
  const externalId = String((externalSeq += 1));
  const token = `SOCIAL-${provider}-${externalId}-${tenantId.slice(-1)}`;
  const secretId = await putSecret(tenantId, "provider_access_token", token);
  const status = seed.status ?? "connected";
  const connection = (await admin`
    INSERT INTO awcms_channel_provider_connections
      (tenant_id, provider, auth_mode, grant_state, access_secret_id)
    VALUES (${tenantId}, ${provider}, 'oauth2', ${seed.grantState ?? "active"},
            ${secretId})
    RETURNING id
  `) as { id: string }[];
  const account = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status, connection_id, deleted_at)
    VALUES (${tenantId}, ${provider}, ${KIND[provider]!}, ${externalId},
            ${`n-${externalId}`}, 'oauth2', ${status}, ${connection[0]!.id},
            ${status === "deleted" ? new Date() : null})
    RETURNING id
  `) as { id: string }[];
  const capabilityState =
    seed.capabilityState === undefined ? "granted" : seed.capabilityState;

  if (capabilityState !== null) {
    const granted = capabilityState === "granted";

    await admin`
      INSERT INTO awcms_channel_account_capabilities
        (tenant_id, account_id, capability, state, evidence_kind,
         evidence_ref, matrix_version, verified_at)
      VALUES (${tenantId}, ${account[0]!.id}, 'publish', ${capabilityState},
              ${granted ? "app_review_reference" : null},
              ${granted ? "evidence-1" : null}, ${PROVIDER_MATRIX_VERSION},
              ${granted ? new Date() : null})
    `;
  }

  return {
    accountId: account[0]!.id,
    connectionId: connection[0]!.id,
    secretId,
    token
  };
}

/** A WhatsApp sender with its own api_token (the credential `whatsapp:dispatch` may read), and — adversarially — a granted `publish` row. */
async function seedWhatsapp(tenantId: string): Promise<Seeded> {
  const admin = getAdminSql();
  const externalId = String((externalSeq += 1));
  const token = `WA-${externalId}`;
  const secretId = await putSecret(tenantId, "api_token", token);
  const connectionSecret = await putSecret(
    tenantId,
    "provider_access_token",
    `WA-CONN-${externalId}`
  );
  const connection = (await admin`
    INSERT INTO awcms_channel_provider_connections
      (tenant_id, provider, auth_mode, grant_state, access_secret_id)
    VALUES (${tenantId}, 'whatsapp_cloud', 'oauth2', 'active', ${connectionSecret})
    RETURNING id
  `) as { id: string }[];
  const account = (await admin`
    INSERT INTO awcms_channel_accounts
      (tenant_id, provider, account_kind, external_id, display_name,
       auth_mode, status, secret_id, connection_id)
    VALUES (${tenantId}, 'whatsapp_cloud', 'waba_phone_number', ${externalId},
            'wa', 'api_token', 'connected', ${secretId}, ${connection[0]!.id})
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_channel_account_capabilities
      (tenant_id, account_id, capability, state, evidence_kind,
       evidence_ref, matrix_version, verified_at)
    VALUES (${tenantId}, ${account[0]!.id}, 'publish', 'granted',
            'app_review_reference', 'evidence-1', ${PROVIDER_MATRIX_VERSION},
            now())
  `;

  return {
    accountId: account[0]!.id,
    connectionId: connection[0]!.id,
    secretId: connectionSecret,
    token
  };
}

async function visibleSecretIds(
  role: string,
  tenantId: string
): Promise<string[]> {
  const rows = await asRole(role, tenantId, async (tx) => {
    return (await tx`
      SELECT id FROM awcms_channel_secrets ORDER BY id
    `) as { id: string }[];
  });

  return rows.map((row) => row.id);
}

async function expectPermissionDenied(
  promise: Promise<unknown>,
  what: string
): Promise<void> {
  let error: Error & { errno?: unknown };

  try {
    error = (await assertRejected(promise, what)) as typeof error;
  } finally {
    resetDatabaseCircuitBreakerForTests();
  }

  expect(String(error.errno), `${what}: ${error.message}`).toBe("42501");
}

async function seedTenants(): Promise<void> {
  for (const [id, code] of [
    [TENANT_A, "spa1145-a"],
    [TENANT_B, "spa1145-b"]
  ] as const) {
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (${id}, ${code}, ${code})
    `;
  }
}

const suite = integrationEnabled ? describe : describe.skip;

suite("social_publishing admission conditions against PostgreSQL", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenants();
  });

  describe("awcms_social_dispatch (sql/358)", () => {
    test("the role exists, cannot log in, is not superuser and does not bypass RLS", async () => {
      const rows = (await getAdminSql()`
        SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
        WHERE rolname = ${SOCIAL_ROLE}
      `) as {
        rolcanlogin: boolean;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }[];

      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        rolcanlogin: false,
        rolsuper: false,
        rolbypassrls: false
      });
    });

    test("it decrypts the token of a live social account with a granted publish capability, through the real credential adapter", async () => {
      const fb = await seedSocial(TENANT_A, { provider: "facebook" });
      const yt = await seedSocial(TENANT_A, { provider: "youtube" });

      for (const seeded of [fb, yt]) {
        const result = await asRole(SOCIAL_ROLE, TENANT_A, (tx) =>
          credentials.resolvePublishCredential(tx, {
            tenantId: TENANT_A,
            accountId: seeded.accountId
          })
        );

        expect(result).toEqual({ ok: true, credential: seeded.token });
      }
    });

    test("M2: only connected/degraded accounts, active/expired grants and a GRANTED publish capability are visible", async () => {
      const visible = [
        await seedSocial(TENANT_A, { status: "connected" }),
        await seedSocial(TENANT_A, { status: "degraded" }),
        await seedSocial(TENANT_A, { grantState: "expired" })
      ];
      const hidden = [
        await seedSocial(TENANT_A, { status: "revoked" }),
        await seedSocial(TENANT_A, { status: "disabled" }),
        await seedSocial(TENANT_A, { status: "pending" }),
        await seedSocial(TENANT_A, { status: "deleted" }),
        // (A `revoked` connection cannot reference a secret at all: sql/318's
        // `revoked_clears_secrets` CHECK. The policy refuses it regardless.)
        await seedSocial(TENANT_A, { grantState: "failed" }),
        await seedSocial(TENANT_A, { grantState: "pending" }),
        await seedSocial(TENANT_A, { capabilityState: null }),
        await seedSocial(TENANT_A, { capabilityState: "denied" }),
        await seedSocial(TENANT_A, { capabilityState: "pending_approval" })
      ];

      const ids = await visibleSecretIds(SOCIAL_ROLE, TENANT_A);

      expect(ids.sort()).toEqual(visible.map((s) => s.secretId).sort());

      for (const seeded of hidden) {
        expect(ids).not.toContain(seeded.secretId);
      }
    });

    test("a revocation leaves the role's view at once: the next read no longer sees the token", async () => {
      const fb = await seedSocial(TENANT_A);
      const ig = await seedSocial(TENANT_A, { provider: "instagram" });

      expect((await visibleSecretIds(SOCIAL_ROLE, TENANT_A)).sort()).toEqual(
        [fb.secretId, ig.secretId].sort()
      );

      // The account is revoked, and the other account's capability withdrawn.
      await getAdminSql()`
        UPDATE awcms_channel_accounts SET status = 'revoked'
        WHERE id = ${fb.accountId}
      `;
      await getAdminSql()`
        UPDATE awcms_channel_account_capabilities
        SET state = 'denied', evidence_kind = NULL, evidence_ref = NULL,
            verified_at = NULL
        WHERE account_id = ${ig.accountId}
      `;

      expect(await visibleSecretIds(SOCIAL_ROLE, TENANT_A)).toEqual([]);

      const result = await asRole(SOCIAL_ROLE, TENANT_A, (tx) =>
        credentials.resolvePublishCredential(tx, {
          tenantId: TENANT_A,
          accountId: fb.accountId
        })
      );

      expect(result.ok).toBe(false);
    });

    test("no cross-purpose read: WhatsApp (even with a publish row), email, refresh and bot secrets stay hidden", async () => {
      const wa = await seedWhatsapp(TENANT_A);
      const refresh = await putSecret(
        TENANT_A,
        "provider_refresh_token",
        "REFRESH-1"
      );
      const mail = await putSecret(TENANT_A, "api_token", "MAILKETING-1");
      const bot = await putSecret(TENANT_A, "bot_token", "BOT-1");
      const fb = await seedSocial(TENANT_A);

      const ids = await visibleSecretIds(SOCIAL_ROLE, TENANT_A);

      expect(ids).toEqual([fb.secretId]);

      for (const hidden of [wa.secretId, refresh, mail, bot]) {
        expect(ids).not.toContain(hidden);
      }

      // And the credential adapter, as the role, refuses the WhatsApp account
      // as a publisher before reading anything.
      const result = await asRole(SOCIAL_ROLE, TENANT_A, (tx) =>
        credentials.resolvePublishCredential(tx, {
          tenantId: TENANT_A,
          accountId: wa.accountId
        })
      );

      expect(result.ok).toBe(false);
    });

    test("no cross-tenant read: tenant A's context never sees tenant B's token", async () => {
      const a = await seedSocial(TENANT_A);
      const b = await seedSocial(TENANT_B);

      expect(await visibleSecretIds(SOCIAL_ROLE, TENANT_A)).toEqual([
        a.secretId
      ]);
      expect(await visibleSecretIds(SOCIAL_ROLE, TENANT_B)).toEqual([
        b.secretId
      ]);

      const result = await asRole(SOCIAL_ROLE, TENANT_A, (tx) =>
        credentials.resolvePublishCredential(tx, {
          tenantId: TENANT_A,
          accountId: b.accountId
        })
      );

      expect(result).toEqual({ ok: false, reason: "ACCOUNT_NOT_FOUND" });
    });

    test("it holds no other privilege: the social queue, WhatsApp tables, writes to the channel tables and unlisted columns are refused", async () => {
      await seedSocial(TENANT_A);

      // sql/373 (Issue #1146) grants the dispatcher's own columns of the social
      // queue, the tenant list and a narrow account update (bounded by RESTRICTIVE
      // policies, tested in social-publishing-facebook.integration.test.ts);
      // everything below stays refused outright.
      const probes: [string, string][] = [
        [
          "read the social queue's creator",
          "SELECT created_by FROM awcms_social_publish_jobs"
        ],
        [
          "insert a job",
          "INSERT INTO awcms_social_publish_jobs DEFAULT VALUES"
        ],
        ["delete a job", "DELETE FROM awcms_social_publish_jobs"],
        [
          "update a publication",
          "UPDATE awcms_social_publications SET state = 'cancelled'"
        ],
        ["read WhatsApp messages", "SELECT 1 FROM awcms_whatsapp_messages"],
        ["read tenant names", "SELECT tenant_name FROM awcms_tenants"],
        [
          "read a display name",
          "SELECT display_name FROM awcms_channel_accounts"
        ],
        [
          "read a refresh reference",
          "SELECT refresh_secret_id FROM awcms_channel_provider_connections"
        ],
        ["read the key id", "SELECT key_id FROM awcms_channel_secrets"],
        [
          "update a secret",
          "UPDATE awcms_channel_secrets SET ciphertext = ciphertext"
        ],
        ["delete a secret", "DELETE FROM awcms_channel_secrets"],
        [
          "update an account's connection",
          "UPDATE awcms_channel_accounts SET connection_id = connection_id"
        ],
        [
          "update a capability",
          "UPDATE awcms_channel_account_capabilities SET state = 'granted'"
        ]
      ];

      for (const [what, statement] of probes) {
        await expectPermissionDenied(
          asRole(SOCIAL_ROLE, TENANT_A, (tx) => tx.unsafe(statement)),
          what
        );
      }
    });

    test("the WhatsApp worker's view does not widen: awcms_worker still cannot see a social token (sql/328 intact)", async () => {
      const fb = await seedSocial(TENANT_A);
      const wa = await seedWhatsapp(TENANT_A);
      const ids = await visibleSecretIds("awcms_worker", TENANT_A);

      expect(ids).not.toContain(fb.secretId);
      // The WhatsApp connection token is still visible to the worker.
      expect(ids).toContain(wa.secretId);
    });

    test("L-6: the role sees only the accounts and connections of the six social providers", async () => {
      const fb = await seedSocial(TENANT_A);
      const wa = await seedWhatsapp(TENANT_A);
      const admin = getAdminSql();

      // A Mailketing sender and a Telegram bot, with their own connections.
      for (const [provider, kind, mode] of [
        ["mailketing", "esp_account", "api_token"],
        ["telegram", "bot", "bot_token"]
      ] as const) {
        const connection = (await admin`
          INSERT INTO awcms_channel_provider_connections
            (tenant_id, provider, auth_mode, grant_state)
          VALUES (${TENANT_A}, ${provider}, ${mode}, 'active')
          RETURNING id
        `) as { id: string }[];

        await admin`
          INSERT INTO awcms_channel_accounts
            (tenant_id, provider, account_kind, external_id, display_name,
             auth_mode, status, connection_id)
          VALUES (${TENANT_A}, ${provider}, ${kind},
                  ${String((externalSeq += 1))}, 'x', ${mode}, 'connected',
                  ${connection[0]!.id})
        `;
      }

      const seen = await asRole(SOCIAL_ROLE, TENANT_A, async (tx) => ({
        accounts: (
          (await tx`SELECT id, provider FROM awcms_channel_accounts`) as {
            id: string;
            provider: string;
          }[]
        ).map((row) => row.provider),
        connections: (
          (await tx`
            SELECT provider FROM awcms_channel_provider_connections
          `) as { provider: string }[]
        ).map((row) => row.provider)
      }));

      expect(seen.accounts).toEqual(["facebook"]);
      expect(seen.connections).toEqual(["facebook"]);
      expect(wa.accountId).not.toBe(fb.accountId);
    });

    test("L-5: a second account on the same connection WITHOUT its own publish capability is refused before any secret is read", async () => {
      const fb = await seedSocial(TENANT_A);
      const sibling = (await getAdminSql()`
        INSERT INTO awcms_channel_accounts
          (tenant_id, provider, account_kind, external_id, display_name,
           auth_mode, status, connection_id)
        VALUES (${TENANT_A}, 'facebook', 'page', ${String((externalSeq += 1))},
                'sibling', 'oauth2', 'connected', ${fb.connectionId})
        RETURNING id
      `) as { id: string }[];

      // The token IS visible to the role (the policy is keyed on the
      // connection, which a publish-granted account uses) ...
      expect(await visibleSecretIds(SOCIAL_ROLE, TENANT_A)).toEqual([
        fb.secretId
      ]);

      // ... but the adapter asks about THE requested account.
      const result = await asRole(SOCIAL_ROLE, TENANT_A, (tx) =>
        credentials.resolvePublishCredential(tx, {
          tenantId: TENANT_A,
          accountId: sibling[0]!.id
        })
      );

      expect(result).toEqual({ ok: false, reason: "CAPABILITY_DENIED" });
    });

    test("L10: a social account that would borrow its parent's connection is refused, not resolved through the parent", async () => {
      const parent = await seedSocial(TENANT_A, { capabilityState: null });
      // A child with NO connection of its own pointing at the parent. None of
      // the six providers has a container kind, so the adapter refuses it; the
      // policy (keyed on the account's own connection) would hide the parent's
      // token from the role in any case.
      const child = (await getAdminSql()`
        INSERT INTO awcms_channel_accounts
          (tenant_id, provider, account_kind, external_id, display_name,
           auth_mode, status, parent_account_id)
        VALUES (${TENANT_A}, 'facebook', 'page', ${String((externalSeq += 1))},
                'child', 'oauth2', 'connected', ${parent.accountId})
        RETURNING id
      `) as { id: string }[];

      await getAdminSql()`
        INSERT INTO awcms_channel_account_capabilities
          (tenant_id, account_id, capability, state, evidence_kind,
           evidence_ref, matrix_version, verified_at)
        VALUES (${TENANT_A}, ${child[0]!.id}, 'publish', 'granted',
                'app_review_reference', 'evidence-1', ${PROVIDER_MATRIX_VERSION},
                now())
      `;

      expect(await visibleSecretIds(SOCIAL_ROLE, TENANT_A)).toEqual([]);

      const result = await asRole(SOCIAL_ROLE, TENANT_A, (tx) =>
        credentials.resolvePublishCredential(tx, {
          tenantId: TENANT_A,
          accountId: child[0]!.id
        })
      );

      expect(result.ok).toBe(false);
    });
  });

  describe("retention of publication evidence (sql/357, purgeSocialPublishing)", () => {
    const DAY = 24 * 60 * 60 * 1000;
    const noHold: LegalHoldGuardPort = {
      isDescriptorHeld: async () => false
    };

    async function requireWorker(): Promise<Bun.SQL> {
      await reassertRuntimeRoleLogins();

      if (!workerRoleActivated) {
        throw new Error(
          "awcms_worker is not usable: the retention assertions cannot run, and a skipped assertion is not a pass."
        );
      }

      return getWorkerRoleSql();
    }

    let titleSeq = 0;

    /** A publication with one job per given status, back-dated `ageDays`. */
    async function seedPublication(input: {
      tenantId?: string;
      state?: string;
      jobStatuses: string[];
      ageDays: number;
    }): Promise<{ publicationId: string; jobIds: string[] }> {
      const tenantId = input.tenantId ?? TENANT_A;
      const admin = getAdminSql();
      const stamp = new Date(Date.now() - input.ageDays * DAY);
      const hash = (titleSeq += 1).toString(16).padStart(64, "0");
      const state = input.state ?? "ready";
      // Jobs can only be added to a live publication (insert guard), so a
      // cancelled one is created ready and cancelled after its jobs.
      const initial = state === "cancelled" ? "ready" : state;
      const publication = (await admin`
        INSERT INTO awcms_social_publications
          (tenant_id, source_kind, trigger_event, state, title, caption,
           content_hash, approval_required, created_at, updated_at,
           refusal_code)
        VALUES (${tenantId}, 'manual', 'manual_editor_action', ${initial},
                ${`Title ${titleSeq}`}, 'Caption.', ${hash}, false, ${stamp},
                ${stamp}, ${initial === "refused" ? "MEDIA_NOT_ELIGIBLE" : null})
        RETURNING id
      `) as { id: string }[];
      const jobIds: string[] = [];

      for (const status of input.jobStatuses) {
        const account = await seedSocial(tenantId);
        const key = crypto.randomUUID().replace(/-/g, "").padEnd(64, "0");
        const job = (await admin`
          INSERT INTO awcms_social_publish_jobs
            (tenant_id, publication_id, channel_account_id, provider,
             account_kind, variant, idempotency_key)
          VALUES (${tenantId}, ${publication[0]!.id}, ${account.accountId},
                  'facebook', 'page', 'text', ${key})
          RETURNING id
        `) as { id: string }[];
        const id = job[0]!.id;

        // Move the job to its status through the guard's legal path, then
        // back-date it (the guard watches the status, not updated_at).
        if (status === "published") {
          await admin`
            UPDATE awcms_social_publish_jobs
            SET status = 'publishing', attempt_count = 1 WHERE id = ${id}
          `;
          await admin`
            UPDATE awcms_social_publish_jobs
            SET status = 'published', published_at = ${stamp},
                external_post_id = ${`post-${titleSeq}`}
            WHERE id = ${id}
          `;
        } else if (status === "needs_reconciliation") {
          await admin`
            UPDATE awcms_social_publish_jobs
            SET status = 'publishing', attempt_count = 1 WHERE id = ${id}
          `;
          await admin`
            UPDATE awcms_social_publish_jobs
            SET status = 'needs_reconciliation' WHERE id = ${id}
          `;
        } else if (status !== "queued") {
          await admin`
            UPDATE awcms_social_publish_jobs SET status = ${status}
            WHERE id = ${id}
          `;
        }

        await admin`
          INSERT INTO awcms_social_publish_attempts
            (tenant_id, job_id, attempt_no, outcome, error_code, created_at)
          VALUES (${tenantId}, ${id}, 1, 'retryable', 'UPSTREAM_5XX', ${stamp})
        `;
        jobIds.push(id);
      }

      if (state === "cancelled") {
        await admin`
          UPDATE awcms_social_publications
          SET state = 'cancelled', cancelled_at = ${stamp}
          WHERE id = ${publication[0]!.id}
        `;
      }

      // `terminal_at` is written only by the sql/357 triggers, from the
      // database clock: a fixture can back-date it only with triggers off
      // (superuser, `session_replication_role = replica`), which is exactly
      // what no runtime role can do.
      await admin.begin(async (tx) => {
        await tx.unsafe("SET LOCAL session_replication_role = replica");
        await tx`
          UPDATE awcms_social_publish_jobs
          SET updated_at = ${stamp},
              terminal_at = CASE
                WHEN status IN ('published', 'failed', 'cancelled')
                  THEN ${stamp}::timestamptz
              END
          WHERE publication_id = ${publication[0]!.id}
        `;
        await tx`
          UPDATE awcms_social_publications
          SET updated_at = ${stamp},
              terminal_at = CASE
                WHEN state IN ('ready', 'cancelled', 'refused')
                  THEN ${stamp}::timestamptz
              END
          WHERE id = ${publication[0]!.id}
        `;
      });

      return { publicationId: publication[0]!.id, jobIds };
    }

    async function exists(table: string, id: string): Promise<boolean> {
      const rows = (await getAdminSql().unsafe(
        `SELECT 1 FROM ${table} WHERE id = $1`,
        [id]
      )) as unknown[];

      return rows.length > 0;
    }

    test("a whole terminal publication past the window is deleted (attempts, jobs, publication) and audited; young or open ones stay whole", async () => {
      const worker = await requireWorker();
      const old = await seedPublication({
        jobStatuses: ["published", "failed", "cancelled"],
        ageDays: 800
      });
      const oldCancelled = await seedPublication({
        state: "cancelled",
        jobStatuses: ["cancelled"],
        ageDays: 800
      });
      const oldRefused = await seedPublication({
        state: "refused",
        jobStatuses: [],
        ageDays: 800
      });
      const young = await seedPublication({
        jobStatuses: ["published"],
        ageDays: 100
      });
      const openJob = await seedPublication({
        jobStatuses: ["published", "queued"],
        ageDays: 800
      });
      const reconcile = await seedPublication({
        jobStatuses: ["needs_reconciliation"],
        ageDays: 800
      });
      const pending = await seedPublication({
        state: "pending_approval",
        jobStatuses: [],
        ageDays: 800
      });

      const result = await purgeSocialPublishing(worker, TENANT_A, noHold, {
        correlationId: "corr-retention"
      });

      expect(result).toEqual({
        purgedPublications: 3,
        purgedJobs: 4,
        purgedAttempts: 4,
        held: false
      });

      for (const gone of [old, oldCancelled, oldRefused]) {
        expect(
          await exists("awcms_social_publications", gone.publicationId)
        ).toBe(false);

        for (const job of gone.jobIds) {
          expect(await exists("awcms_social_publish_jobs", job)).toBe(false);
        }
      }

      for (const kept of [young, openJob, reconcile, pending]) {
        expect(
          await exists("awcms_social_publications", kept.publicationId)
        ).toBe(true);

        for (const job of kept.jobIds) {
          expect(await exists("awcms_social_publish_jobs", job)).toBe(true);
        }
      }

      const audit = (await getAdminSql()`
        SELECT action, attributes FROM awcms_audit_events
        WHERE tenant_id = ${TENANT_A} AND module_key = 'social_publishing'
          AND action = 'purge'
      `) as { action: string; attributes: Record<string, unknown> }[];

      expect(audit).toHaveLength(1);
      expect(audit[0]!.attributes.purgedPublications).toBe(3);
      expect(JSON.stringify(audit[0]!.attributes)).not.toContain("Caption");

      // A second pass finds nothing more.
      expect(
        await purgeSocialPublishing(worker, TENANT_A, noHold)
      ).toMatchObject({ purgedPublications: 0, purgedJobs: 0 });
    });

    test("the purge is per tenant: tenant B's old evidence is untouched by tenant A's pass", async () => {
      const worker = await requireWorker();
      const b = await seedPublication({
        tenantId: TENANT_B,
        jobStatuses: ["published"],
        ageDays: 800
      });

      await purgeSocialPublishing(worker, TENANT_A, noHold);

      expect(await exists("awcms_social_publications", b.publicationId)).toBe(
        true
      );
    });

    test("a legal hold on ANY of the three descriptors stops the whole purge", async () => {
      const worker = await requireWorker();
      const old = await seedPublication({
        jobStatuses: ["published"],
        ageDays: 800
      });
      const holdAttempts: LegalHoldGuardPort = {
        isDescriptorHeld: async (_tx, _tenant, key) =>
          key === SOCIAL_PUBLISH_ATTEMPTS_LIFECYCLE_KEY
      };

      const result = await purgeSocialPublishing(
        worker,
        TENANT_A,
        holdAttempts
      );

      expect(result).toEqual({
        purgedPublications: 0,
        purgedJobs: 0,
        purgedAttempts: 0,
        held: true
      });
      expect(await exists("awcms_social_publications", old.publicationId)).toBe(
        true
      );
    });

    test("the window is clamped: asking for 30 days still keeps a 100-day-old publication", async () => {
      const worker = await requireWorker();
      const young = await seedPublication({
        jobStatuses: ["published"],
        ageDays: 100
      });

      await purgeSocialPublishing(worker, TENANT_A, noHold, {
        retentionDays: 30
      });

      expect(
        await exists("awcms_social_publications", young.publicationId)
      ).toBe(true);
    });

    test("the database floor holds without the application: the worker deletes nothing young, non-terminal or with jobs left", async () => {
      await requireWorker();
      const young = await seedPublication({
        jobStatuses: ["published"],
        ageDays: 100
      });
      const open = await seedPublication({
        jobStatuses: ["queued"],
        ageDays: 800
      });
      const withJobs = await seedPublication({
        jobStatuses: ["published"],
        ageDays: 800
      });

      const deleted = await asRole("awcms_worker", TENANT_A, async (tx) => {
        const attempts = (await tx`
          DELETE FROM awcms_social_publish_attempts
          WHERE job_id = ANY(${tx.array([...young.jobIds, ...open.jobIds], "uuid")})
          RETURNING id
        `) as unknown[];
        const jobs = (await tx`
          DELETE FROM awcms_social_publish_jobs
          WHERE id = ANY(${tx.array([...young.jobIds, ...open.jobIds], "uuid")})
          RETURNING id
        `) as unknown[];
        const publications = (await tx`
          DELETE FROM awcms_social_publications
          WHERE id = ANY(${tx.array(
            [young.publicationId, open.publicationId, withJobs.publicationId],
            "uuid"
          )})
          RETURNING id
        `) as unknown[];

        return {
          attempts: attempts.length,
          jobs: jobs.length,
          publications: publications.length
        };
      });

      expect(deleted).toEqual({ attempts: 0, jobs: 0, publications: 0 });
    });

    test("the runtime role still cannot delete publication evidence", async () => {
      const old = await seedPublication({
        jobStatuses: ["published"],
        ageDays: 800
      });

      await expectPermissionDenied(
        inTenant(
          TENANT_A,
          (tx) =>
            tx`DELETE FROM awcms_social_publish_attempts WHERE job_id = ${old.jobIds[0]!}`
        ),
        "awcms_app DELETE attempts"
      );
    });

    test("M-2: moving updated_at (or terminal_at) back as the app or the worker does not make fresh evidence deletable", async () => {
      const worker = await requireWorker();
      const fresh = await seedPublication({
        jobStatuses: ["published", "failed"],
        ageDays: 0
      });
      const LONG_AGO = "2000-01-01T00:00:00Z";

      // The auditor's scenario: a compromised worker back-dates the jobs, a
      // compromised app back-dates the publication, then the worker deletes.
      await asRole(
        "awcms_worker",
        TENANT_A,
        (tx) =>
          tx`
          UPDATE awcms_social_publish_jobs
          SET updated_at = ${LONG_AGO}, terminal_at = ${LONG_AGO}
          WHERE publication_id = ${fresh.publicationId}
        `
      );
      await inTenant(
        TENANT_A,
        (tx) =>
          tx`
          UPDATE awcms_social_publications
          SET updated_at = ${LONG_AGO}, terminal_at = ${LONG_AGO}
          WHERE id = ${fresh.publicationId}
        `
      );

      const stamps = (await getAdminSql()`
        SELECT terminal_at FROM awcms_social_publish_jobs
        WHERE publication_id = ${fresh.publicationId}
        UNION ALL
        SELECT terminal_at FROM awcms_social_publications
        WHERE id = ${fresh.publicationId}
      `) as { terminal_at: Date }[];

      for (const row of stamps) {
        expect(new Date(row.terminal_at).getFullYear()).toBeGreaterThan(2000);
      }

      const deleted = await asRole("awcms_worker", TENANT_A, async (tx) => {
        const attempts = (await tx`
          DELETE FROM awcms_social_publish_attempts
          WHERE job_id = ANY(${tx.array(fresh.jobIds, "uuid")}) RETURNING id
        `) as unknown[];
        const jobs = (await tx`
          DELETE FROM awcms_social_publish_jobs
          WHERE publication_id = ${fresh.publicationId} RETURNING id
        `) as unknown[];
        const publications = (await tx`
          DELETE FROM awcms_social_publications
          WHERE id = ${fresh.publicationId} RETURNING id
        `) as unknown[];

        return [attempts.length, jobs.length, publications.length];
      });

      expect(deleted).toEqual([0, 0, 0]);
      expect(
        await purgeSocialPublishing(worker, TENANT_A, noHold, {
          now: new Date(Date.now() + 5000 * DAY)
        })
      ).toMatchObject({ purgedPublications: 0, purgedJobs: 0 });
      expect(
        await exists("awcms_social_publications", fresh.publicationId)
      ).toBe(true);
    });

    test("terminal_at follows the status: a retried job loses it, and its next terminal state is a fresh stamp", async () => {
      const old = await seedPublication({
        jobStatuses: ["failed"],
        ageDays: 800
      });
      const id = old.jobIds[0]!;

      await getAdminSql()`
        UPDATE awcms_social_publish_jobs SET status = 'queued' WHERE id = ${id}
      `;

      const queued = (await getAdminSql()`
        SELECT terminal_at FROM awcms_social_publish_jobs WHERE id = ${id}
      `) as { terminal_at: Date | null }[];

      expect(queued[0]!.terminal_at).toBeNull();

      await getAdminSql()`
        UPDATE awcms_social_publish_jobs SET status = 'failed' WHERE id = ${id}
      `;

      const failed = (await getAdminSql()`
        SELECT terminal_at FROM awcms_social_publish_jobs WHERE id = ${id}
      `) as { terminal_at: Date }[];

      expect(
        Date.now() - new Date(failed[0]!.terminal_at).getTime()
      ).toBeLessThan(60_000);
    });
  });

  describe("security:readiness pins both boundaries exactly (M-1, M-3 of the #1261 audit)", () => {
    /** The `CREATE POLICY <name> ... );` statement of `name` in a migration file. */
    function policyStatement(file: string, name: string): string {
      const text = readFileSync(file, "utf8");
      const from = text.indexOf(`CREATE POLICY ${name}\n`);
      const to = text.indexOf("\n  );", from);

      if (from < 0 || to < 0) throw new Error(`no CREATE POLICY ${name}`);

      return text.slice(from, to + "\n  );".length);
    }

    /** Replace `name` on `table` by `mutated`, run readiness, restore it, and return both verdicts. */
    async function withPolicy(
      table: string,
      name: string,
      original: string,
      mutated: string
    ): Promise<{ status: string; evidence: string; restored: string }> {
      expect(mutated).not.toBe(original);

      const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

      try {
        await admin.unsafe(`DROP POLICY ${name} ON ${table}`);

        let result;

        try {
          await admin.unsafe(mutated);
          result = await checkWorkerSetupRoleGrants();
        } finally {
          await admin.unsafe(`DROP POLICY IF EXISTS ${name} ON ${table}`);
          await admin.unsafe(original);
        }

        return {
          status: result.status,
          evidence: result.evidence,
          restored: (await checkWorkerSetupRoleGrants()).status
        };
      } finally {
        await admin.close({ timeout: 1 });
      }
    }

    const SECRETS_FILE = "sql/358_awcms_social_dispatch_credential_role.sql";
    const SECRETS_POLICY = "awcms_channel_secrets_social_dispatch_publish";
    const FLOOR_FILE = "sql/357_awcms_social_publishing_retention.sql";

    test("readiness passes on the migrated database, and its probe really ran", async () => {
      const result = await checkWorkerSetupRoleGrants();

      expect(result.status, result.evidence).toBe("pass");
      expect(
        (await probeSocialDispatchSecretVisibility(getAdminSql())).ran
      ).toBe(true);
    });

    test("the pinned expressions are the ones the migrations create", async () => {
      for (const pin of [
        ...SOCIAL_DISPATCH_PINNED_POLICIES,
        ...SOCIAL_RETENTION_FLOOR_POLICIES
      ]) {
        expect(await pinPolicyExpression(getAdminSql(), pin)).toBeNull();
      }
    });

    test("dropping the secret policy FAILS, restoring it passes", async () => {
      const original = policyStatement(SECRETS_FILE, SECRETS_POLICY);
      const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

      try {
        await admin.unsafe(
          `DROP POLICY ${SECRETS_POLICY} ON awcms_channel_secrets`
        );

        let result;

        try {
          result = await checkWorkerSetupRoleGrants();
        } finally {
          await admin.unsafe(original);
        }

        expect(result.status).toBe("fail");
        expect(result.evidence).toContain(SECRETS_POLICY);
        expect((await checkWorkerSetupRoleGrants()).status).toBe("pass");
      } finally {
        await admin.close({ timeout: 1 });
      }
    });

    // The four widenings the auditor ran against the LIKE pin, each of which
    // used to PASS. Every one must now fail (exact pin) and the probe must see
    // more than the one legitimate secret.
    const secretMutations: [string, (sql: string) => string][] = [
      [
        "the correlation to the secret row removed",
        (s) =>
          s.replace("AND c.access_secret_id = awcms_channel_secrets.id\n", "\n")
      ],
      [
        "`true OR` in front of the purpose",
        (s) =>
          s.replace(
            "purpose = 'provider_access_token'",
            "true OR purpose = 'provider_access_token'"
          )
      ],
      [
        "`k.state <> 'granted'`",
        (s) => s.replace("k.state = 'granted'", "k.state <> 'granted'")
      ],
      [
        "an inverted status list",
        (s) =>
          s.replace(
            "a.status IN ('connected', 'degraded')",
            "a.status NOT IN ('disconnected')"
          )
      ],
      [
        "a WhatsApp provider added",
        (s) =>
          s.replace(
            "'facebook', 'instagram'",
            "'whatsapp_cloud', 'facebook', 'instagram'"
          )
      ]
    ];

    for (const [label, mutate] of secretMutations) {
      test(`the secret policy with ${label} FAILS readiness (pin and probe)`, async () => {
        const original = policyStatement(SECRETS_FILE, SECRETS_POLICY);
        const mutated = mutate(original);
        const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });
        let probe: Awaited<
          ReturnType<typeof probeSocialDispatchSecretVisibility>
        >;

        const outcome = await withPolicy(
          "awcms_channel_secrets",
          SECRETS_POLICY,
          original,
          mutated
        );

        expect(outcome.status, label).toBe("fail");
        expect(outcome.evidence).toContain(SECRETS_POLICY);
        expect(outcome.restored, `${label} restored`).toBe("pass");

        // The behavioural probe, on its own, also sees the widening.
        try {
          await admin.unsafe(
            `DROP POLICY ${SECRETS_POLICY} ON awcms_channel_secrets`
          );
          await admin.unsafe(mutated);
          probe = await probeSocialDispatchSecretVisibility(admin);
        } finally {
          await admin.unsafe(
            `DROP POLICY IF EXISTS ${SECRETS_POLICY} ON awcms_channel_secrets`
          );
          await admin.unsafe(original);
          await admin.close({ timeout: 1 });
        }

        expect(probe.ran).toBe(true);

        if (label === "a WhatsApp provider added") {
          // Defence in depth: the account and connection policies (L-6) still
          // hide every WhatsApp row from the role, so the widened secret policy
          // finds nothing extra to admit. The exact pin above is what catches
          // it; the probe correctly reports no exposure.
          expect(probe.finding).toBeUndefined();
          return;
        }

        expect(probe.finding, `${label}: the probe must see it`).toContain(
          "awcms_social_dispatch saw"
        );
      });
    }

    test("the account and connection provider policies are pinned too (a WhatsApp provider added FAILS)", async () => {
      for (const [table, name] of [
        [
          "awcms_channel_accounts",
          "awcms_channel_accounts_social_dispatch_providers"
        ],
        [
          "awcms_channel_provider_connections",
          "awcms_channel_provider_connections_social_dispatch_providers"
        ]
      ] as const) {
        const original = policyStatement(SECRETS_FILE, name);
        const outcome = await withPolicy(
          table,
          name,
          original,
          original.replace("'facebook',", "'whatsapp_cloud', 'facebook',")
        );

        expect(outcome.status, name).toBe("fail");
        expect(outcome.evidence).toContain(name);
        expect(outcome.restored).toBe("pass");
      }
    });

    const floorMutations: [string, string, string, (s: string) => string][] = [
      [
        "awcms_social_publish_jobs",
        "awcms_social_publish_jobs_worker_retention_floor",
        "`OR true`",
        (s) =>
          s.replace(
            "AND terminal_at < now() - interval '365 days'",
            "AND terminal_at < now() - interval '365 days' OR true"
          )
      ],
      [
        "awcms_social_publish_jobs",
        "awcms_social_publish_jobs_worker_retention_floor",
        "the comparison reversed",
        (s) =>
          s.replace(
            "terminal_at < now() - interval '365 days'",
            "terminal_at > now() - interval '365 days'"
          )
      ],
      [
        "awcms_social_publish_jobs",
        "awcms_social_publish_jobs_worker_retention_floor",
        "the status condition removed",
        (s) =>
          s.replace(
            "status IN ('published', 'failed', 'cancelled')\n    AND ",
            ""
          )
      ],
      [
        "awcms_social_publications",
        "awcms_social_publications_worker_retention_floor",
        "the floor moved back onto updated_at",
        (s) => s.replace("AND terminal_at < now()", "AND updated_at < now()")
      ],
      [
        "awcms_social_publish_attempts",
        "awcms_social_publish_attempts_worker_retention_floor",
        "the job condition removed",
        (s) =>
          s.replace(
            "created_at < now() - interval '365 days'\n    AND EXISTS",
            "created_at < now() - interval '365 days'\n    OR EXISTS"
          )
      ]
    ];

    for (const [table, name, label, mutate] of floorMutations) {
      test(`${name} with ${label} FAILS readiness`, async () => {
        const original = policyStatement(FLOOR_FILE, name);
        const outcome = await withPolicy(
          table,
          name,
          original,
          mutate(original)
        );

        expect(outcome.status, label).toBe("fail");
        expect(outcome.evidence).toContain(name);
        expect(outcome.restored).toBe("pass");
      });
    }

    test("a disabled terminal_at trigger FAILS readiness (the floor's stamp could be forged)", async () => {
      const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

      try {
        await admin.unsafe(
          "ALTER TABLE awcms_social_publish_jobs DISABLE TRIGGER awcms_social_publish_jobs_terminal_stamp"
        );

        let result;

        try {
          result = await checkWorkerSetupRoleGrants();
        } finally {
          await admin.unsafe(
            "ALTER TABLE awcms_social_publish_jobs ENABLE TRIGGER awcms_social_publish_jobs_terminal_stamp"
          );
        }

        expect(result.status).toBe("fail");
        expect(result.evidence).toContain(
          "awcms_social_publish_jobs_terminal_stamp"
        );
        expect((await checkWorkerSetupRoleGrants()).status).toBe("pass");
      } finally {
        await admin.close({ timeout: 1 });
      }
    });

    test("readiness FAILS when the social dispatch role gains a table-level privilege", async () => {
      const admin = new Bun.SQL(process.env.DATABASE_URL!, { max: 1 });

      try {
        await admin.unsafe(
          "GRANT SELECT ON awcms_whatsapp_messages TO awcms_social_dispatch"
        );

        let result;

        try {
          result = await checkWorkerSetupRoleGrants();
        } finally {
          await admin.unsafe(
            "REVOKE SELECT ON awcms_whatsapp_messages FROM awcms_social_dispatch"
          );
        }

        expect(result.status).toBe("fail");
        expect(result.evidence).toContain("awcms_social_dispatch");
        expect((await checkWorkerSetupRoleGrants()).status).toBe("pass");
      } finally {
        await admin.close({ timeout: 1 });
      }
    });
  });
});
