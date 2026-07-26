/**
 * Password recovery against a real PostgreSQL with real migrations and real RLS
 * (Wave 2 delta auth). Runs in the harness's EPHEMERAL world, so the connection
 * is a genuine non-superuser and `FORCE ROW LEVEL SECURITY` is observable
 * rather than merely declared.
 *
 * What is proved here that the pure tests cannot be:
 *
 * - the request path is eligibility-blind in its RESULT, not just in its
 *   response text — every ineligible case returns the identical value, and no
 *   token row is left behind to distinguish them;
 * - a token is single-use even when two redemptions race the same link;
 * - a completed reset revokes every session, including one that had been
 *   stepped up to `aal2`;
 * - an identity the tenant has taken off password login cannot recover a
 *   password, on EITHER path;
 * - the tenant policy is re-read at REDEMPTION time, so a policy change between
 *   issue and redemption is honoured;
 * - a token issued for one tenant is invisible to another.
 *
 * Delivery is injected as a stub port for most tests — that is what the
 * `auth_notification` capability is for — with one test driving the REAL email
 * adapter to prove the wiring, and one proving the no-template case reports
 * `delivery_unavailable` rather than pretending to have sent something.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { hashPassword, verifyPassword } from "../../src/lib/auth/password";
import { hashResetToken } from "../../src/lib/auth/reset-token";
import { withTenant } from "../../src/lib/database/tenant-context";
import type {
  AuthNotificationPort,
  AuthNotificationRequest
} from "../../src/modules/_shared/ports/auth-notification-port";
import { createEmailAuthNotificationAdapter } from "../../src/modules/email/application/auth-notification-port-adapter";
import {
  completePasswordReset,
  requestPasswordReset
} from "../../src/modules/identity-access/application/password-reset";
import {
  getAdminSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";

const suite = integrationEnabled ? describe : describe.skip;

const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const IDENTIFIER = "owner@example.com";
const NOW = new Date("2026-07-26T12:00:00.000Z");
const NEW_PASSWORD = "correct-horse-battery";

type Sent = AuthNotificationRequest[];

function stubPort(sent: Sent, enqueued = true): AuthNotificationPort {
  return {
    async enqueueAuthNotification(_tx, request) {
      sent.push(request);
      return { enqueued };
    }
  };
}

async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants
      (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${id}, ${code}, ${code}, ${code}, 'active', 'en', 'light')
    ON CONFLICT (id) DO NOTHING
  `;
}

/** Returns `{ identityId, tenantUserId }` for a fully active, password-login account. */
async function seedAccount(
  tenantId: string,
  loginIdentifier = IDENTIFIER
): Promise<{ identityId: string; tenantUserId: string }> {
  const admin = getAdminSql();
  const profileId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  const tenantUserId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name, status)
    VALUES (${profileId}, ${tenantId}, 'person', 'Account Owner', 'active')
  `;
  await admin`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (
      ${identityId}, ${tenantId}, ${profileId}, ${loginIdentifier},
      ${await hashPassword("original-password")}, 'active'
    )
  `;
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${tenantUserId}, ${tenantId}, ${identityId}, 'active')
  `;

  return { identityId, tenantUserId };
}

async function seedSession(
  tenantId: string,
  identityId: string,
  assuranceLevel: string
): Promise<string> {
  const id = crypto.randomUUID();

  await getAdminSql()`
    INSERT INTO awcms_sessions
      (id, tenant_id, identity_id, token_hash, expires_at, assurance_level)
    VALUES (
      ${id}, ${tenantId}, ${identityId}, ${crypto.randomUUID()},
      ${new Date(NOW.getTime() + 3_600_000)}, ${assuranceLevel}
    )
  `;

  return id;
}

async function setPasswordLoginDisabled(
  tenantId: string,
  breakGlassIdentityIds: string[] = []
): Promise<void> {
  // `sso_enabled` must go true alongside: the table's own CHECK requires at
  // least one login method (`password_login_enabled OR sso_enabled`), so
  // "password login off" is only expressible as "SSO on".
  // `${array}::jsonb` — the same binding shape `saveTenantAuthPolicy` uses;
  // `JSON.stringify` here would land a jsonb STRING scalar, not an array.
  await getAdminSql()`
    INSERT INTO awcms_tenant_auth_policies
      (tenant_id, password_login_enabled, sso_enabled, break_glass_identity_ids)
    VALUES (${tenantId}, false, true, ${breakGlassIdentityIds}::jsonb)
    ON CONFLICT (tenant_id) DO UPDATE
      SET password_login_enabled = false,
          sso_enabled = true,
          break_glass_identity_ids = EXCLUDED.break_glass_identity_ids
  `;
}

function request(
  tenantId: string,
  loginIdentifier: string,
  notifications: AuthNotificationPort,
  now: Date = NOW
) {
  return withTenant(getRuntimeSql(), tenantId, (tx) =>
    requestPasswordReset(tx, tenantId, loginIdentifier, now, {
      tokenTtlMinutes: 30,
      resetUrlBase: "https://awcms.test/reset-password",
      notifications
    })
  );
}

function complete(tenantId: string, token: string, now: Date = NOW) {
  return withTenant(getRuntimeSql(), tenantId, (tx) =>
    completePasswordReset(tx, tenantId, token, NEW_PASSWORD, now)
  );
}

/** The raw token out of the link the port was asked to deliver. */
function tokenFrom(sent: Sent): string {
  const url = new URL(sent.at(-1)!.variables.resetUrl!);
  return url.searchParams.get("token")!;
}

async function countTokens(tenantId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_password_reset_tokens WHERE tenant_id = ${tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

suite("password reset integration (Wave 2 delta auth)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  }, 120000);

  afterAll(async () => {
    await teardownIntegrationDatabase();
  }, 60000);

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "tenant-a");
    await seedTenant(TENANT_B, "tenant-b");
  }, 30000);

  test("issues a single-use token and delivers a link carrying it", async () => {
    await seedAccount(TENANT_A);
    const sent: Sent = [];

    const result = await request(TENANT_A, IDENTIFIER, stubPort(sent));

    expect(result.outcome).toBe("enqueued");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.templateKey).toBe("auth.password_reset");
    expect(sent[0]!.variables.expiresInMinutes).toBe("30");

    // The raw token is in the link and NOWHERE in the database.
    const raw = tokenFrom(sent);
    const rows = (await getAdminSql()`
      SELECT token_hash, used_at FROM awcms_password_reset_tokens WHERE tenant_id = ${TENANT_A}
    `) as { token_hash: string; used_at: Date | null }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).toBe(hashResetToken(raw));
    expect(rows[0]!.token_hash).not.toContain(raw);
    expect(rows[0]!.used_at).toBeNull();
  });

  test.each([
    ["an unknown identifier", "nobody@example.com"],
    ["a non-mailable identifier", "not-an-address"]
  ])(
    "%s is ineligible, and leaves no token behind",
    async (_label, identifier) => {
      await seedAccount(TENANT_A);
      const sent: Sent = [];

      const result = await request(TENANT_A, identifier, stubPort(sent));

      expect(result).toEqual({ outcome: "ineligible" });
      expect(sent).toEqual([]);
      expect(await countTokens(TENANT_A)).toBe(0);
    }
  );

  test.each([
    ["identity", "awcms_identities"],
    ["tenant user", "awcms_tenant_users"]
  ])("an inactive %s is ineligible", async (_label, table) => {
    const { identityId } = await seedAccount(TENANT_A);
    const admin = getAdminSql();

    if (table === "awcms_identities") {
      await admin`UPDATE awcms_identities SET status = 'inactive' WHERE id = ${identityId}`;
    } else {
      await admin`UPDATE awcms_tenant_users SET status = 'inactive' WHERE identity_id = ${identityId}`;
    }

    const sent: Sent = [];
    expect(await request(TENANT_A, IDENTIFIER, stubPort(sent))).toEqual({
      outcome: "ineligible"
    });
    expect(sent).toEqual([]);
  });

  test("every ineligible case is indistinguishable from every other", async () => {
    // The endpoint's enumeration guarantee is only as good as this: the service
    // must return ONE value, not one-per-reason. A `reason` field added here
    // "just for the audit log" would be the leak, because the endpoint would
    // then have something to branch on.
    await seedAccount(TENANT_A);
    const sent: Sent = [];

    const unknown = await request(
      TENANT_A,
      "nobody@example.com",
      stubPort(sent)
    );
    const unmailable = await request(
      TENANT_A,
      "not-an-address",
      stubPort(sent)
    );
    const wrongTenant = await request(TENANT_B, IDENTIFIER, stubPort(sent));

    expect(unknown).toEqual(unmailable);
    expect(unknown).toEqual(wrongTenant);
    expect(Object.keys(unknown)).toEqual(["outcome"]);
  });

  test("a second request supersedes the first link", async () => {
    await seedAccount(TENANT_A);
    const sent: Sent = [];

    await request(TENANT_A, IDENTIFIER, stubPort(sent));
    const first = tokenFrom(sent);

    await request(
      TENANT_A,
      IDENTIFIER,
      stubPort(sent),
      new Date(NOW.getTime() + 1000)
    );
    const second = tokenFrom(sent);

    expect(second).not.toBe(first);
    expect(await complete(TENANT_A, first)).toEqual({
      outcome: "invalid",
      reason: "already_used"
    });
    expect((await complete(TENANT_A, second)).outcome).toBe("success");
  });

  test("completing replaces the password, clears lockout, burns the token", async () => {
    const { identityId } = await seedAccount(TENANT_A);
    const admin = getAdminSql();
    await admin`
      UPDATE awcms_identities
      SET failed_login_count = 4, locked_until = ${new Date(NOW.getTime() + 600_000)}
      WHERE id = ${identityId}
    `;

    const sent: Sent = [];
    await request(TENANT_A, IDENTIFIER, stubPort(sent));

    expect(await complete(TENANT_A, tokenFrom(sent))).toEqual({
      outcome: "success",
      identityId
    });

    const rows = (await admin`
      SELECT password_hash, failed_login_count, locked_until FROM awcms_identities WHERE id = ${identityId}
    `) as {
      password_hash: string;
      failed_login_count: number;
      locked_until: Date | null;
    }[];

    expect(await verifyPassword(NEW_PASSWORD, rows[0]!.password_hash)).toBe(
      true
    );
    expect(rows[0]!.failed_login_count).toBe(0);
    expect(rows[0]!.locked_until).toBeNull();

    const used = (await admin`
      SELECT used_at FROM awcms_password_reset_tokens WHERE tenant_id = ${TENANT_A}
    `) as { used_at: Date | null }[];
    expect(used[0]!.used_at).not.toBeNull();
  });

  test("a token is single-use", async () => {
    await seedAccount(TENANT_A);
    const sent: Sent = [];
    await request(TENANT_A, IDENTIFIER, stubPort(sent));
    const raw = tokenFrom(sent);

    expect((await complete(TENANT_A, raw)).outcome).toBe("success");
    expect(await complete(TENANT_A, raw)).toEqual({
      outcome: "invalid",
      reason: "already_used"
    });
  });

  test("two concurrent redemptions of the same link: exactly one wins", async () => {
    // The row lock, not the read, is what makes this true — two transactions
    // that both read `used_at IS NULL` before either writes would both succeed.
    await seedAccount(TENANT_A);
    const sent: Sent = [];
    await request(TENANT_A, IDENTIFIER, stubPort(sent));
    const raw = tokenFrom(sent);

    const [first, second] = await Promise.all([
      complete(TENANT_A, raw),
      complete(TENANT_A, raw)
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["invalid", "success"]);
  });

  test("an expired token is rejected", async () => {
    await seedAccount(TENANT_A);
    const sent: Sent = [];
    await request(TENANT_A, IDENTIFIER, stubPort(sent));

    expect(
      await complete(
        TENANT_A,
        tokenFrom(sent),
        new Date(NOW.getTime() + 31 * 60_000)
      )
    ).toEqual({ outcome: "invalid", reason: "expired" });
  });

  test("an unknown token is rejected as not_found", async () => {
    await seedAccount(TENANT_A);

    expect(await complete(TENANT_A, "never-issued")).toEqual({
      outcome: "invalid",
      reason: "not_found"
    });
  });

  test("completing revokes every session, aal2 included", async () => {
    const { identityId } = await seedAccount(TENANT_A);
    const aal1 = await seedSession(TENANT_A, identityId, "aal1");
    const aal2 = await seedSession(TENANT_A, identityId, "aal2");

    const sent: Sent = [];
    await request(TENANT_A, IDENTIFIER, stubPort(sent));
    await complete(TENANT_A, tokenFrom(sent));

    const rows = (await getAdminSql()`
      SELECT id, revoked_at FROM awcms_sessions WHERE identity_id = ${identityId}
    `) as { id: string; revoked_at: Date | null }[];

    expect(rows).toHaveLength(2);
    for (const id of [aal1, aal2]) {
      expect(rows.find((row) => row.id === id)!.revoked_at).not.toBeNull();
    }
  });

  test("another identity's sessions are untouched", async () => {
    const { identityId } = await seedAccount(TENANT_A);
    const other = await seedAccount(TENANT_A, "other@example.com");
    const otherSession = await seedSession(TENANT_A, other.identityId, "aal1");
    await seedSession(TENANT_A, identityId, "aal1");

    const sent: Sent = [];
    await request(TENANT_A, IDENTIFIER, stubPort(sent));
    await complete(TENANT_A, tokenFrom(sent));

    const rows = (await getAdminSql()`
      SELECT revoked_at FROM awcms_sessions WHERE id = ${otherSession}
    `) as { revoked_at: Date | null }[];

    expect(rows[0]!.revoked_at).toBeNull();
  });

  test("an SSO-only identity cannot request a reset", async () => {
    await seedAccount(TENANT_A);
    await setPasswordLoginDisabled(TENANT_A);

    const sent: Sent = [];
    expect(await request(TENANT_A, IDENTIFIER, stubPort(sent))).toEqual({
      outcome: "ineligible"
    });
    expect(await countTokens(TENANT_A)).toBe(0);
  });

  test("a break-glass identity still can, even with password login off", async () => {
    const { identityId } = await seedAccount(TENANT_A);
    await setPasswordLoginDisabled(TENANT_A, [identityId]);

    const sent: Sent = [];
    expect((await request(TENANT_A, IDENTIFIER, stubPort(sent))).outcome).toBe(
      "enqueued"
    );
  });

  test("disabling password login AFTER issue invalidates the outstanding link", async () => {
    // The policy is re-read at redemption, not trusted from issue time — a live
    // link must not survive the tenant turning password login off.
    await seedAccount(TENANT_A);
    const sent: Sent = [];
    await request(TENANT_A, IDENTIFIER, stubPort(sent));

    await setPasswordLoginDisabled(TENANT_A);

    expect(await complete(TENANT_A, tokenFrom(sent))).toEqual({
      outcome: "invalid",
      reason: "not_found"
    });
  });

  test("deactivating the identity after issue invalidates the link", async () => {
    const { identityId } = await seedAccount(TENANT_A);
    const sent: Sent = [];
    await request(TENANT_A, IDENTIFIER, stubPort(sent));

    await getAdminSql()`UPDATE awcms_identities SET status = 'inactive' WHERE id = ${identityId}`;

    expect(await complete(TENANT_A, tokenFrom(sent))).toEqual({
      outcome: "invalid",
      reason: "not_found"
    });
  });

  test("a token issued for one tenant is invisible to another", async () => {
    await seedAccount(TENANT_A);
    await seedAccount(TENANT_B);

    const sent: Sent = [];
    await request(TENANT_A, IDENTIFIER, stubPort(sent));
    const raw = tokenFrom(sent);

    // RLS confines the lookup even though the hash is globally unique.
    expect(await complete(TENANT_B, raw)).toEqual({
      outcome: "invalid",
      reason: "not_found"
    });
    expect((await complete(TENANT_A, raw)).outcome).toBe("success");
  });

  test("the real email adapter queues one high-priority message", async () => {
    const { identityId } = await seedAccount(TENANT_A);
    const admin = getAdminSql();

    await admin`
      INSERT INTO awcms_email_templates
        (tenant_id, template_key, name, subject_template, text_body_template,
         is_active, created_by, updated_by)
      VALUES (
        ${TENANT_A}, 'auth.password_reset', 'Password reset',
        ${JSON.stringify({ en: "Reset your password" })}::jsonb,
        ${JSON.stringify({ en: "Hello {{userName}}, open {{resetUrl}} within {{expiresInMinutes}} minutes." })}::jsonb,
        true, ${identityId}, ${identityId}
      )
    `;

    const result = await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
      requestPasswordReset(tx, TENANT_A, IDENTIFIER, NOW, {
        tokenTtlMinutes: 30,
        resetUrlBase: "https://awcms.test/reset-password",
        notifications: createEmailAuthNotificationAdapter()
      })
    );

    expect(result.outcome).toBe("enqueued");

    const rows = (await admin`
      SELECT category, template_key, to_address, to_address_masked, priority, status
      FROM awcms_email_messages WHERE tenant_id = ${TENANT_A}
    `) as {
      category: string;
      template_key: string;
      to_address: string;
      to_address_masked: string;
      priority: string;
      status: string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.category).toBe("auth.password_reset");
    expect(rows[0]!.to_address).toBe(IDENTIFIER);
    expect(rows[0]!.to_address_masked).not.toBe(IDENTIFIER);
    expect(rows[0]!.priority).toBe("high");
    expect(rows[0]!.status).toBe("queued");
  });

  test("a tenant with no template reports delivery_unavailable, not success", async () => {
    // The token is still issued (the account WAS eligible) — but the caller is
    // told nothing, and the operator gets a distinct outcome to act on.
    await seedAccount(TENANT_A);

    const result = await withTenant(getRuntimeSql(), TENANT_A, (tx) =>
      requestPasswordReset(tx, TENANT_A, IDENTIFIER, NOW, {
        tokenTtlMinutes: 30,
        resetUrlBase: "https://awcms.test/reset-password",
        notifications: createEmailAuthNotificationAdapter()
      })
    );

    expect(result.outcome).toBe("delivery_unavailable");
    expect(result.identityId).toBeDefined();
  });
});
