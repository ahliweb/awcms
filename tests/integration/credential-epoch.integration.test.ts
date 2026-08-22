/**
 * Finding A5 of the 17 August 2026 audit round — a password reset changed the
 * credential in EVERY tenant but revoked sessions in only ONE.
 *
 * Against a real PostgreSQL under the ephemeral harness, because the whole
 * finding lives in a boundary that only a real database has: `awcms_sessions` is
 * `FORCE ROW LEVEL SECURITY`, so the reason `revokeAllSessionsForIdentity`
 * cannot reach tenant B is not a missing line of code — it is that the
 * transaction physically cannot see those rows. A test with a fake `Bun.SQL`
 * would let the revoke "work" and prove nothing.
 *
 * ## The order these tests are written in is the argument
 *
 * The first one establishes the shared human: one principal, two tenants, one
 * password. The second is the finding itself — reset in A, and B's session is
 * refused. The third is the guard against fixing it by over-reaching: the
 * revocation must still NOT have crossed the boundary, because a fix that
 * quietly gained the power to write into another tenant would be a much larger
 * change than the bug.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { hashPassword } from "../../src/lib/auth/password";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { resolveActiveSession } from "../../src/modules/identity-access/application/session-lookup";
import { setPrincipalCredentialForIdentity } from "../../src/modules/identity-access/application/principal-store";
import { revokeAllSessionsForIdentity } from "../../src/modules/identity-access/application/session-revocation";
import { listOwnSessions } from "../../src/modules/identity-access/application/session-directory";
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
const EMAIL = "shared@example.com";
const NOW = new Date("2026-08-22T12:00:00.000Z");

type Account = { identityId: string; tokenHash: string };

async function seedTenant(id: string, code: string): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants
      (id, tenant_code, tenant_name, legal_name, status, default_locale, default_theme)
    VALUES (${id}, ${code}, ${code}, ${code}, 'active', 'en', 'light')
    ON CONFLICT (id) DO NOTHING
  `;
}

/**
 * One human in one tenant, linked to a shared principal, holding one live
 * session — stamped with the principal's epoch exactly as `login.ts` and
 * `createSessionWithAssurance` do.
 */
async function seedMembership(
  tenantId: string,
  principalId: string
): Promise<Account> {
  const admin = getAdminSql();
  const profileId = crypto.randomUUID();
  const identityId = crypto.randomUUID();
  await admin`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name, status)
    VALUES (${profileId}, ${tenantId}, 'person', 'Shared Human', 'active')
  `;
  await admin`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status, principal_id)
    VALUES (
      ${identityId}, ${tenantId}, ${profileId}, ${EMAIL},
      ${await hashPassword("original-password")}, 'active', ${principalId}
    )
  `;
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${crypto.randomUUID()}, ${tenantId}, ${identityId}, 'active')
  `;
  return { identityId, tokenHash: await mintSession(tenantId, identityId) };
}

/**
 * Mints a session the way production does — the epoch comes from the principal
 * BEHIND the identity, resolved at insert time, which is exactly what
 * `currentCredentialEpoch` emits at the two real INSERT sites. Copying the
 * subquery rather than passing a number is deliberate: a test that hard-codes
 * the epoch it expects cannot notice the fragment resolving to the wrong one.
 */
async function mintSession(
  tenantId: string,
  identityId: string
): Promise<string> {
  const tokenHash = crypto.randomUUID();

  await getAdminSql()`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, credential_epoch)
    VALUES (
      ${tenantId}, ${identityId}, ${tokenHash},
      ${new Date(NOW.getTime() + 3_600_000)},
      (SELECT COALESCE(p.credential_epoch, 0)
       FROM awcms_identities i
       LEFT JOIN awcms_principals p ON p.id = i.principal_id
       WHERE i.id = ${identityId} AND i.tenant_id = ${tenantId})
    )
  `;

  return tokenHash;
}

async function seedSharedHuman(): Promise<{
  principalId: string;
  a: Account;
  b: Account;
}> {
  const principalId = crypto.randomUUID();

  await getAdminSql()`
    INSERT INTO awcms_principals (id, email_normalized, password_hash)
    VALUES (${principalId}, ${EMAIL}, ${await hashPassword("original-password")})
  `;

  return {
    principalId,
    a: await seedMembership(TENANT_A, principalId),
    b: await seedMembership(TENANT_B, principalId)
  };
}

function resolve(tenantId: string, tokenHash: string) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    resolveActiveSession(tx, tenantId, tokenHash, NOW)
  );
}

/** Exactly what `completePasswordReset` does to the credential, and nothing else. */
function changeCredentialIn(tenantId: string, identityId: string) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    await setPrincipalCredentialForIdentity(
      tx,
      identityId,
      await hashPassword("brand-new-password")
    );
    await revokeAllSessionsForIdentity(tx, tenantId, identityId, NOW);
  });
}

suite("a credential change reaches every tenant's sessions (A5)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant(TENANT_A, "tenant-a");
    await seedTenant(TENANT_B, "tenant-b");
  });

  test("both tenants' sessions are live to begin with", async () => {
    // NON-VACUOUS baseline. Without it every assertion below could pass because
    // the seed is broken rather than because the epoch works.
    const { a, b } = await seedSharedHuman();

    expect(await resolve(TENANT_A, a.tokenHash)).not.toBeNull();
    expect(await resolve(TENANT_B, b.tokenHash)).not.toBeNull();
  });

  test("resetting in tenant A kills the session in tenant B", async () => {
    // The finding, exactly. Before sql/144 this session stayed valid: the
    // password it was minted under no longer opened any door, and it kept
    // opening this one.
    const { a, b } = await seedSharedHuman();

    await changeCredentialIn(TENANT_A, a.identityId);

    expect(await resolve(TENANT_B, b.tokenHash)).toBeNull();
    // And the tenant the reset happened in, which always worked — via
    // `revoked_at` there rather than the epoch, and it must keep working.
    expect(await resolve(TENANT_A, a.tokenHash)).toBeNull();
  });

  test("the revocation still did NOT cross the tenant boundary", async () => {
    // The guard against fixing this the wrong way. Tenant B's row must be
    // refused because it is BEHIND, not because tenant A reached in and wrote
    // to it — a fix that gained cross-tenant write power would be a far bigger
    // change than the bug, and this is the assertion that tells the two apart.
    const { a, b } = await seedSharedHuman();

    await changeCredentialIn(TENANT_A, a.identityId);

    const rows = (await getAdminSql()`
      SELECT revoked_at, credential_epoch
      FROM awcms_sessions WHERE token_hash = ${b.tokenHash}
    `) as { revoked_at: Date | null; credential_epoch: number | null }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.revoked_at).toBeNull();
    expect(rows[0]!.credential_epoch).toBe(0);

    const principal = (await getAdminSql()`
      SELECT credential_epoch FROM awcms_principals WHERE email_normalized = ${EMAIL}
    `) as { credential_epoch: number }[];

    expect(principal[0]!.credential_epoch).toBe(1);
  });

  test("a session minted AFTER the reset is live again", async () => {
    // The epoch must be a moving line, not a kill switch. If a bump made every
    // future session stale too, the account could never sign in again — a
    // failure mode that would look exactly like a working fix in any test that
    // only checks the old session is gone.
    const { a, b } = await seedSharedHuman();

    await changeCredentialIn(TENANT_A, a.identityId);
    expect(await resolve(TENANT_B, b.tokenHash)).toBeNull();

    // Same identity, new session — the sign-in that follows the reset.
    const fresh = await mintSession(TENANT_B, b.identityId);

    expect(await resolve(TENANT_B, fresh)).not.toBeNull();
  });

  test("a session minted BEFORE sql/144 — stamp NULL — dies on the first reset", async () => {
    // The migration's own claim, and the reason the session column is nullable
    // rather than `NOT NULL DEFAULT 0`: rows that predate it carry no stamp, and
    // reading NULL as 0 is what puts them behind the moment any epoch is bumped.
    //
    // Without this test, dropping the `COALESCE` on the session side passes
    // everything else in this file — every other session here is stamped
    // explicitly, so NULL never occurs and `NULL > 0` never gets to be NULL.
    const { a, b } = await seedSharedHuman();

    await getAdminSql()`
      UPDATE awcms_sessions SET credential_epoch = NULL
      WHERE token_hash = ${b.tokenHash}
    `;

    // Still live: nothing has changed the credential yet.
    expect(await resolve(TENANT_B, b.tokenHash)).not.toBeNull();

    await changeCredentialIn(TENANT_A, a.identityId);

    expect(await resolve(TENANT_B, b.tokenHash)).toBeNull();
  });

  test("an identity with NO principal is unaffected", async () => {
    // The link is nullable by design (sql/112). Such an identity has no global
    // credential to be behind, and its tenant-scoped revocation remains its
    // whole guarantee — unchanged, not weakened and not accidentally broken.
    const admin = getAdminSql();
    const profileId = crypto.randomUUID();
    const identityId = crypto.randomUUID();
    const tokenHash = crypto.randomUUID();

    await admin`
      INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name, status)
      VALUES (${profileId}, ${TENANT_A}, 'person', 'Unlinked', 'active')
    `;
    await admin`
      INSERT INTO awcms_identities
        (id, tenant_id, profile_id, login_identifier, password_hash, status)
      VALUES (
        ${identityId}, ${TENANT_A}, ${profileId}, 'unlinked@example.com',
        ${await hashPassword("original-password")}, 'active'
      )
    `;
    await admin`
      INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
      VALUES (${TENANT_A}, ${identityId}, ${tokenHash},
              ${new Date(NOW.getTime() + 3_600_000)})
    `;

    expect(await resolve(TENANT_A, tokenHash)).not.toBeNull();
  });

  test("a stale session disappears from the OWN-SESSIONS listing too", async () => {
    // Every live-session reader, not just the authenticating one. A listing
    // that still showed tenant B's dead session would invite its owner to
    // "revoke" access that was already gone.
    const { a, b } = await seedSharedHuman();

    const before = await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
      listOwnSessions(tx, TENANT_B, b.tokenHash, NOW)
    );
    expect(before).not.toBeNull();
    expect(before!.length).toBe(1);

    await changeCredentialIn(TENANT_A, a.identityId);

    // `null` rather than an empty list: `resolveCallerIdentity` uses the same
    // fragment, so the caller's own token no longer identifies anybody.
    const after = await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
      listOwnSessions(tx, TENANT_B, b.tokenHash, NOW)
    );
    expect(after).toBeNull();
  });
});
