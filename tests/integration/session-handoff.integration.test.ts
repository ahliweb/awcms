/**
 * BFF session handoff (ADR-0050) against a real PostgreSQL.
 *
 * Four properties that only a real database can show:
 *
 * 1. **A code is spent exactly ONCE, under concurrency.** The claim is a
 *    guarded `UPDATE … WHERE redeemed_at IS NULL`; the read-then-write version
 *    it replaces lets two simultaneous redemptions both succeed, and a
 *    single-use credential that can be used twice is not single-use. Two
 *    concurrent redeems on separate connections is the only way to see this.
 * 2. **The ≤60s TTL is enforced by the DATABASE.** The CHECK is the backstop
 *    for the TypeScript constant; a test that only used the constant would
 *    prove nothing about a row written by anything else.
 * 3. **Redemption mints a session at the assurance the login reached**, never
 *    above it — an aal1 login must not launder into an aal2 session.
 * 4. **RLS holds.** Another tenant's code is not redeemable, and the handoff is
 *    a credential-issuing path, so this is worth asserting rather than assuming.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { hashSessionToken } from "../../src/lib/auth/session-token";
import {
  hashBffClientSecret,
  hashHandoffCode
} from "../../src/modules/identity-access/domain/session-handoff";
import {
  authenticateBffClient,
  issueHandoffCode,
  redeemHandoffCode
} from "../../src/modules/identity-access/application/session-handoff-directory";

const TENANT_A = "c1111111-1111-4111-8111-111111111111";
const TENANT_B = "c2222222-2222-4222-8222-222222222222";
const USER_A = "c1000000-0000-4000-8000-000000000001";
const USER_B = "c2000000-0000-4000-8000-000000000001";

const CLIENT_KEY = "awcms-astro";
const CLIENT_SECRET = "s3cret-value-for-the-test-only";
const REDIRECT_URI = "https://portal.example.test/internal/callback";

type Seeded = { identityId: string; sessionId: string; clientId: string };
const seeded: Record<string, Seeded> = {};

async function seedTenant(
  tenantId: string,
  code: string,
  userId: string
): Promise<Seeded> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${tenantId}, ${code}, ${code})
  `;
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', 'Operator')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${`${code}@example.test`}, 'x')
    RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${userId}, ${tenantId}, ${identity[0]!.id})
  `;

  const session = (await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at, assurance_level)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(`token-${code}`)},
            now() + interval '1 hour', 'aal1')
    RETURNING id
  `) as { id: string }[];

  const client = (await admin`
    INSERT INTO awcms_bff_clients (tenant_id, client_key, name, secret_hash, redirect_uris)
    VALUES (${tenantId}, ${CLIENT_KEY}, 'Portal', ${hashBffClientSecret(CLIENT_SECRET)},
            ARRAY[${REDIRECT_URI}]::text[])
    RETURNING id
  `) as { id: string }[];

  return {
    identityId: identity[0]!.id,
    sessionId: session[0]!.id,
    clientId: client[0]!.id
  };
}

async function issue(
  tenantId: string,
  userId: string,
  assurance: "aal1" | "aal2" = "aal1"
): Promise<string> {
  const result = await withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    issueHandoffCode(tx, tenantId, {
      clientKey: CLIENT_KEY,
      requestedRedirectUri: REDIRECT_URI,
      identityId: seeded[tenantId]!.identityId,
      sessionId: seeded[tenantId]!.sessionId,
      assuranceLevel: assurance,
      actorTenantUserId: userId,
      now: new Date()
    })
  );

  expect(result.ok).toBe(true);
  return result.ok ? result.code : "";
}

async function redeem(tenantId: string, code: string) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, async (tx) => {
    const client = await authenticateBffClient(
      tx,
      tenantId,
      CLIENT_KEY,
      CLIENT_SECRET
    );
    expect(client).not.toBeNull();

    return redeemHandoffCode(tx, tenantId, {
      code,
      client: client!,
      redirectUri: REDIRECT_URI,
      sessionTtlMinutes: 60,
      now: new Date()
    });
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("BFF session handoff", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    seeded[TENANT_A] = await seedTenant(TENANT_A, "handoff-a", USER_A);
    seeded[TENANT_B] = await seedTenant(TENANT_B, "handoff-b", USER_B);
  });

  test("a code mints exactly one session and the token really works", async () => {
    const code = await issue(TENANT_A, USER_A);
    const result = await redeem(TENANT_A, code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The returned token must resolve to a live session for the right identity
    // — a token that does not is a silent failure the caller cannot see.
    const rows = (await getAdminSql()`
      SELECT identity_id, assurance_level, revoked_at
      FROM awcms_sessions
      WHERE tenant_id = ${TENANT_A} AND token_hash = ${hashSessionToken(result.token)}
    `) as {
      identity_id: string;
      assurance_level: string;
      revoked_at: Date | null;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.identity_id).toBe(seeded[TENANT_A]!.identityId);
    expect(rows[0]!.revoked_at).toBeNull();
  });

  test("TWO CONCURRENT redemptions: exactly one wins", async () => {
    const code = await issue(TENANT_A, USER_A);

    // Separate transactions on separate connections — the only arrangement in
    // which the read-then-write version of this claim fails. `Promise.all` is
    // correct HERE precisely because these are different connections; inside
    // one transaction it would desync the connection instead.
    const [first, second] = await Promise.all([
      redeem(TENANT_A, code),
      redeem(TENANT_A, code)
    ]);

    const winners = [first, second].filter((r) => r.ok);
    expect(winners).toHaveLength(1);

    const loser = [first, second].find((r) => !r.ok);
    expect(loser && !loser.ok && loser.reason).toBe("already_redeemed");

    // And exactly one session exists, not two.
    const sessions = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_sessions
      WHERE tenant_id = ${TENANT_A} AND assurance_level = 'aal1'
    `) as { n: number }[];
    // One seeded by the fixture, one minted by the winner.
    expect(sessions[0]!.n).toBe(2);
  });

  test("a code is refused the second time, sequentially too", async () => {
    const code = await issue(TENANT_A, USER_A);

    expect((await redeem(TENANT_A, code)).ok).toBe(true);

    const again = await redeem(TENANT_A, code);
    expect(again.ok).toBe(false);
    expect(!again.ok && again.reason).toBe("already_redeemed");
  });

  test("the spent row is KEPT, so a replay is answered from evidence", async () => {
    const code = await issue(TENANT_A, USER_A);
    await redeem(TENANT_A, code);

    const rows = (await getAdminSql()`
      SELECT redeemed_at FROM awcms_session_handoff_codes
      WHERE tenant_id = ${TENANT_A} AND code_hash = ${hashHandoffCode(code)}
    `) as { redeemed_at: Date | null }[];

    // Deleting the row would make "already redeemed" and "never existed"
    // indistinguishable — and that difference is what an incident needs.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.redeemed_at).not.toBeNull();
  });

  test("an expired code is refused, and the database refuses to store a long-lived one", async () => {
    const admin = getAdminSql();

    // Expired by construction, written directly because the application layer
    // will not mint one.
    await admin`
      INSERT INTO awcms_session_handoff_codes
        (tenant_id, client_id, code_hash, identity_id, assurance_level,
         redirect_uri, issued_by_session_id, created_at, expires_at)
      VALUES (${TENANT_A}, ${seeded[TENANT_A]!.clientId},
              ${hashHandoffCode("expired-code")}, ${seeded[TENANT_A]!.identityId},
              'aal1', ${REDIRECT_URI}, ${seeded[TENANT_A]!.sessionId},
              now() - interval '5 minutes', now() - interval '4 minutes')
    `;

    const result = await redeem(TENANT_A, "expired-code");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("expired");

    // ADR-0050 §2's ≤60s bound is a CHECK, not just a constant in TypeScript.
    let rejected = false;
    try {
      await admin`
        INSERT INTO awcms_session_handoff_codes
          (tenant_id, client_id, code_hash, identity_id, assurance_level,
           redirect_uri, issued_by_session_id, expires_at)
        VALUES (${TENANT_A}, ${seeded[TENANT_A]!.clientId},
                ${hashHandoffCode("too-long")}, ${seeded[TENANT_A]!.identityId},
                'aal1', ${REDIRECT_URI}, ${seeded[TENANT_A]!.sessionId},
                now() + interval '1 hour')
      `;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  test("the minted session inherits the login's assurance, never more", async () => {
    const aal2Code = await issue(TENANT_A, USER_A, "aal2");
    const result = await redeem(TENANT_A, aal2Code);

    expect(result.ok).toBe(true);
    expect(result.ok && result.assuranceLevel).toBe("aal2");

    const rows = (await getAdminSql()`
      SELECT assurance_level, stepped_up_at FROM awcms_sessions
      WHERE tenant_id = ${TENANT_A}
        AND token_hash = ${hashSessionToken(result.ok ? result.token : "")}
    `) as { assurance_level: string; stepped_up_at: Date | null }[];

    expect(rows[0]!.assurance_level).toBe("aal2");
    expect(rows[0]!.stepped_up_at).not.toBeNull();
  });

  test("a wrong client secret authenticates nothing", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
      expect(
        await authenticateBffClient(tx, TENANT_A, CLIENT_KEY, "wrong")
      ).toBeNull();
      // An unknown key and a wrong secret answer the same `null`, so the caller
      // cannot use this to learn which client keys are registered.
      expect(
        await authenticateBffClient(
          tx,
          TENANT_A,
          "no-such-client",
          CLIENT_SECRET
        )
      ).toBeNull();
    });
  });

  test("a disabled client can neither issue nor redeem", async () => {
    const code = await issue(TENANT_A, USER_A);

    await getAdminSql()`
      UPDATE awcms_bff_clients SET disabled_at = now()
      WHERE tenant_id = ${TENANT_A}
    `;

    await withTenantOrThrow(getRuntimeSql(), TENANT_A, async (tx) => {
      // Disabling must stop an already-issued code being spent, not only stop
      // new ones being minted — otherwise turning a client off leaves a
      // 60-second window in which it still works.
      expect(
        await authenticateBffClient(tx, TENANT_A, CLIENT_KEY, CLIENT_SECRET)
      ).toBeNull();

      const issued = await issueHandoffCode(tx, TENANT_A, {
        clientKey: CLIENT_KEY,
        requestedRedirectUri: REDIRECT_URI,
        identityId: seeded[TENANT_A]!.identityId,
        sessionId: seeded[TENANT_A]!.sessionId,
        assuranceLevel: "aal1",
        actorTenantUserId: USER_A,
        now: new Date()
      });
      expect(issued.ok).toBe(false);
    });

    expect(code.length).toBeGreaterThan(0);
  });

  test("a non-allow-listed redirect_uri is refused and writes nothing", async () => {
    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      issueHandoffCode(tx, TENANT_A, {
        clientKey: CLIENT_KEY,
        requestedRedirectUri: "https://evil.test/internal/callback",
        identityId: seeded[TENANT_A]!.identityId,
        sessionId: seeded[TENANT_A]!.sessionId,
        assuranceLevel: "aal1",
        actorTenantUserId: USER_A,
        now: new Date()
      })
    );

    expect(result.ok).toBe(false);

    // Validated BEFORE the write: a code that exists for a URI nobody approved
    // is the failure this ordering prevents.
    const rows = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_session_handoff_codes
      WHERE tenant_id = ${TENANT_A}
    `) as { n: number }[];
    expect(rows[0]!.n).toBe(0);
  });

  test("tenant B cannot redeem tenant A's code", async () => {
    const code = await issue(TENANT_A, USER_A);
    const result = await redeem(TENANT_B, code);

    // Under RLS the row is not visible at all, so this is `unknown_code` — the
    // same answer a genuinely unknown code gets, which is what it should be.
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("unknown_code");

    // And tenant A's code is still spendable: the cross-tenant attempt must not
    // have consumed it.
    expect((await redeem(TENANT_A, code)).ok).toBe(true);
  });
});
