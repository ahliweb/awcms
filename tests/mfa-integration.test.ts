/**
 * Real-PostgreSQL integration tests for MFA (Issue #184). These cannot be
 * written against a fake `Bun.SQL`: the guarantees under test — replay
 * prevention across CONCURRENT requests, single-use recovery consumption under
 * concurrency, RLS FORCE, and cross-tenant denial — are all properties of the
 * database engine, not of the application, so a stubbed driver would only prove
 * what the stub was told to say.
 *
 * Requires a throwaway database with `sql/` applied (`bun run db:migrate`).
 * Gated on `DATABASE_URL`, the same convention as
 * `office-directory-postgres.test.ts` / `workflow-approval-concurrency.test.ts`.
 * Runs in the dedicated legacy `bun test <files>` step, separate from the
 * `tests/integration/` harness suite (they collide in one process).
 *
 * MUTATION PROOF (repo security-readiness discipline): removing the replay CAS
 * predicate `AND last_used_step < ${matchedStep}` in
 * `consumeFactorCredential` makes "rejects a concurrent replay of one timestep"
 * go RED (both requests win). Removing the `tenant_id` predicate from
 * `findActiveMfaFactor` makes "cross-tenant read returns nothing" go RED.
 *
 * No `mock.module` anywhere — it mutates the live module namespace in place and
 * leaks into every file that runs afterwards in the same process.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { generateTotpCode, base32Decode } from "../src/lib/auth/totp";
import {
  adminResetMfa,
  createEnrollmentGrant,
  createMfaChallenge,
  disableMfa,
  findActiveMfaFactor,
  getMfaStatus,
  resolveEnrollAuth,
  startTotpEnrollment,
  verifyMfaChallenge,
  verifyStepUpFactor,
  verifyTotpEnrollment
} from "../src/modules/identity-access/application/mfa";

const DATABASE_URL =
  process.env.MFA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

const MFA_ENV = {
  ...process.env,
  AUTH_MFA_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 42).toString("base64")
} as NodeJS.ProcessEnv;

const CODE_OPTS = { periodSec: 30, digits: 6 };

describeOrSkip("MFA (real PostgreSQL)", () => {
  let sql: Bun.SQL;
  const createdTenantIds: string[] = [];

  beforeAll(() => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 6 });
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      await sql`DELETE FROM awcms_identity_mfa_recovery_codes WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_mfa_challenges WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_identity_mfa_factors WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_sessions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_identities WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_profiles WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_mfa_policies WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }
    await sql.close({ timeout: 5 });
  });

  async function createTenant(): Promise<string> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const rows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`mfa-${suffix}`}, ${"MFA test"})
      RETURNING id
    `) as { id: string }[];
    const tenantId = rows[0]!.id;
    createdTenantIds.push(tenantId);
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
    return tenantId;
  }

  async function createIdentity(tenantId: string): Promise<string> {
    const profileRows = (await sql`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenantId}, 'person', 'MFA User')
      RETURNING id
    `) as { id: string }[];
    const idRows = (await sql`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenantId}, ${profileRows[0]!.id}, ${`u-${Math.random().toString(36).slice(2)}`}, 'x')
      RETURNING id
    `) as { id: string }[];
    return idRows[0]!.id;
  }

  /** Runs `cb` in a transaction with the tenant GUC set (transaction-local). */
  function tx<T>(tenantId: string, cb: (t: Bun.SQL) => Promise<T>): Promise<T> {
    return sql.begin(async (t) => {
      await t`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return cb(t);
    }) as Promise<T>;
  }

  /** Enrolls + activates a TOTP factor, returning the raw secret buffer. */
  async function enrollActive(
    tenantId: string,
    identityId: string,
    enrollAt: Date
  ): Promise<Buffer> {
    const start = await tx(tenantId, (t) =>
      startTotpEnrollment(t, tenantId, identityId, "user", MFA_ENV, enrollAt)
    );
    if (!start.ok) throw new Error(`enroll start failed: ${start.code}`);
    const secret = base32Decode(start.secretBase32);
    const code = generateTotpCode(secret, enrollAt.getTime(), CODE_OPTS);
    const verify = await tx(tenantId, (t) =>
      verifyTotpEnrollment(t, tenantId, identityId, code, MFA_ENV, enrollAt)
    );
    if (!verify.ok) throw new Error(`enroll verify failed: ${verify.code}`);
    return secret;
  }

  test("enroll -> verify -> status -> disable", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const now = new Date("2026-07-19T10:00:00Z");
    await enrollActive(tenantId, identityId, now);

    const status = await tx(tenantId, (t) =>
      getMfaStatus(t, tenantId, identityId)
    );
    expect(status.enabled).toBe(true);
    expect(status.factorType).toBe("totp");

    const disabled = await tx(tenantId, (t) =>
      disableMfa(t, tenantId, identityId, new Date())
    );
    expect(disabled.ok).toBe(true);

    const after = await tx(tenantId, (t) =>
      getMfaStatus(t, tenantId, identityId)
    );
    expect(after.enabled).toBe(false);
  });

  test("rejects a replayed timestep code sequentially", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const enrollAt = new Date("2026-07-19T10:00:00Z");
    const secret = await enrollActive(tenantId, identityId, enrollAt);

    // A later timestep so it is strictly greater than the enrollment step.
    const verifyAt = new Date(enrollAt.getTime() + 120_000);
    const code = generateTotpCode(secret, verifyAt.getTime(), CODE_OPTS);

    const c1 = await tx(tenantId, (t) =>
      createMfaChallenge(t, tenantId, identityId, 300, verifyAt)
    );
    const first = await tx(tenantId, (t) =>
      verifyMfaChallenge(t, tenantId, c1.token, { code }, MFA_ENV, 5, verifyAt)
    );
    expect(first.ok).toBe(true);

    const c2 = await tx(tenantId, (t) =>
      createMfaChallenge(t, tenantId, identityId, 300, verifyAt)
    );
    const replay = await tx(tenantId, (t) =>
      verifyMfaChallenge(t, tenantId, c2.token, { code }, MFA_ENV, 5, verifyAt)
    );
    expect(replay.ok).toBe(false);
  });

  test("rejects a concurrent replay of one timestep (only one wins)", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const enrollAt = new Date("2026-07-19T10:00:00Z");
    const secret = await enrollActive(tenantId, identityId, enrollAt);

    const verifyAt = new Date(enrollAt.getTime() + 120_000);
    const code = generateTotpCode(secret, verifyAt.getTime(), CODE_OPTS);

    const c1 = await tx(tenantId, (t) =>
      createMfaChallenge(t, tenantId, identityId, 300, verifyAt)
    );
    const c2 = await tx(tenantId, (t) =>
      createMfaChallenge(t, tenantId, identityId, 300, verifyAt)
    );

    const [r1, r2] = await Promise.all([
      tx(tenantId, (t) =>
        verifyMfaChallenge(
          t,
          tenantId,
          c1.token,
          { code },
          MFA_ENV,
          5,
          verifyAt
        )
      ),
      tx(tenantId, (t) =>
        verifyMfaChallenge(
          t,
          tenantId,
          c2.token,
          { code },
          MFA_ENV,
          5,
          verifyAt
        )
      )
    ]);

    const wins = [r1, r2].filter((r) => r.ok).length;
    expect(wins).toBe(1);
  });

  test("recovery code is single-use even under concurrency", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const enrollAt = new Date("2026-07-19T10:00:00Z");

    // Re-enroll via the full path to capture the recovery codes.
    const start = await tx(tenantId, (t) =>
      startTotpEnrollment(t, tenantId, identityId, "user", MFA_ENV, enrollAt)
    );
    if (!start.ok) throw new Error("enroll start failed");
    const secret = base32Decode(start.secretBase32);
    const enrollCode = generateTotpCode(secret, enrollAt.getTime(), CODE_OPTS);
    const verify = await tx(tenantId, (t) =>
      verifyTotpEnrollment(
        t,
        tenantId,
        identityId,
        enrollCode,
        MFA_ENV,
        enrollAt
      )
    );
    if (!verify.ok) throw new Error("enroll verify failed");
    const recoveryCode = verify.recoveryCodes[0]!;

    const at = new Date(enrollAt.getTime() + 120_000);
    const c1 = await tx(tenantId, (t) =>
      createMfaChallenge(t, tenantId, identityId, 300, at)
    );
    const c2 = await tx(tenantId, (t) =>
      createMfaChallenge(t, tenantId, identityId, 300, at)
    );

    const [r1, r2] = await Promise.all([
      tx(tenantId, (t) =>
        verifyMfaChallenge(
          t,
          tenantId,
          c1.token,
          { recoveryCode },
          MFA_ENV,
          5,
          at
        )
      ),
      tx(tenantId, (t) =>
        verifyMfaChallenge(
          t,
          tenantId,
          c2.token,
          { recoveryCode },
          MFA_ENV,
          5,
          at
        )
      )
    ]);

    expect([r1, r2].filter((r) => r.ok).length).toBe(1);
  });

  test("step-up verifies a fresh code against the active factor", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const enrollAt = new Date("2026-07-19T10:00:00Z");
    const secret = await enrollActive(tenantId, identityId, enrollAt);

    const at = new Date(enrollAt.getTime() + 120_000);
    const code = generateTotpCode(secret, at.getTime(), CODE_OPTS);
    const result = await tx(tenantId, (t) =>
      verifyStepUpFactor(t, tenantId, identityId, { code }, MFA_ENV, at)
    );
    expect(result.ok).toBe(true);

    // No active factor -> distinguishable MFA_NOT_ACTIVE (authenticated caller).
    const otherIdentity = await createIdentity(tenantId);
    const none = await tx(tenantId, (t) =>
      verifyStepUpFactor(t, tenantId, otherIdentity, { code }, MFA_ENV, at)
    );
    expect(none).toEqual({ ok: false, code: "MFA_NOT_ACTIVE" });
  });

  test("admin reset disables the target factor and clears recovery codes", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    await enrollActive(tenantId, identityId, new Date("2026-07-19T10:00:00Z"));

    const result = await tx(tenantId, (t) =>
      adminResetMfa(t, tenantId, identityId, new Date())
    );
    expect(result).toEqual({ ok: true, hadFactor: true });

    const status = await tx(tenantId, (t) =>
      getMfaStatus(t, tenantId, identityId)
    );
    expect(status.enabled).toBe(false);

    const codes = (await sql`
      SELECT count(*)::int AS n FROM awcms_identity_mfa_recovery_codes
      WHERE tenant_id = ${tenantId} AND identity_id = ${identityId}
    `) as { n: number }[];
    expect(codes[0]!.n).toBe(0);

    const missing = await tx(tenantId, (t) =>
      adminResetMfa(
        t,
        tenantId,
        "00000000-0000-4000-8000-000000000000",
        new Date()
      )
    );
    expect(missing).toEqual({ ok: false, code: "MFA_TARGET_NOT_FOUND" });
  });

  test("challenge failures collapse to one code (no enumeration signal)", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const enrollAt = new Date("2026-07-19T10:00:00Z");
    await enrollActive(tenantId, identityId, enrollAt);
    const at = new Date(enrollAt.getTime() + 120_000);

    const unknown = await tx(tenantId, (t) =>
      verifyMfaChallenge(
        t,
        tenantId,
        "not-a-real-token",
        { code: "000000" },
        MFA_ENV,
        5,
        at
      )
    );
    const c = await tx(tenantId, (t) =>
      createMfaChallenge(t, tenantId, identityId, 300, at)
    );
    const wrongCode = await tx(tenantId, (t) =>
      verifyMfaChallenge(
        t,
        tenantId,
        c.token,
        { code: "000000" },
        MFA_ENV,
        5,
        at
      )
    );

    expect(unknown).toEqual({ ok: false, code: "MFA_CHALLENGE_INVALID" });
    expect(wrongCode).toEqual({ ok: false, code: "MFA_CHALLENGE_INVALID" });
  });

  test("new MFA tables have RLS ENABLE + FORCE", async () => {
    const rows = (await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN (
        'awcms_identity_mfa_factors',
        'awcms_identity_mfa_recovery_codes',
        'awcms_mfa_challenges',
        'awcms_tenant_mfa_policies'
      )
    `) as {
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }[];
    expect(rows.length).toBe(4);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  test("application scoping denies cross-tenant factor reads", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const identityA = await createIdentity(tenantA);
    await enrollActive(tenantA, identityA, new Date("2026-07-19T10:00:00Z"));

    // Tenant B cannot see tenant A's factor via the scoped lookup.
    const asB = await tx(tenantB, (t) =>
      findActiveMfaFactor(t, tenantB, identityA)
    );
    expect(asB).toBeNull();

    // Sanity: tenant A does see it.
    const asA = await tx(tenantA, (t) =>
      findActiveMfaFactor(t, tenantA, identityA)
    );
    expect(asA).not.toBeNull();
  });

  test("RLS FORCE denies cross-tenant reads for a non-superuser role", async () => {
    // Issue #184 F6 — HARD-FAIL, never vacuously green. Provision a
    // least-privilege login for awcms_app (NOLOGIN by default in sql/019). The
    // container harness user is a superuser, so this MUST succeed; if it throws
    // the test fails (it must not silently skip and pretend RLS was proven).
    // Ephemeral, randomly generated login password for this throwaway probe —
    // never a real credential (the role's LOGIN is disposable against the test
    // container). Generated at runtime so no static username/password pair sits
    // in source for secret scanners to flag.
    const password = `probe_${Math.random().toString(36).slice(2)}${Math.random()
      .toString(36)
      .slice(2)}`;
    await sql.unsafe(`ALTER ROLE awcms_app LOGIN PASSWORD '${password}'`);
    const url = new URL(DATABASE_URL!);
    url.username = "awcms_app";
    url.password = password;
    const appSql = new Bun.SQL(url.toString(), { max: 2 });

    try {
      const tenantA = await createTenant();
      const tenantB = await createTenant();
      const identityA = await createIdentity(tenantA);
      await enrollActive(tenantA, identityA, new Date("2026-07-19T10:00:00Z"));

      // Control on the control: as awcms_app scoped to tenant A, the row IS
      // visible — so an empty result for tenant B below cannot be a false
      // positive from an unrelated cause (RLS blanket-denying everything).
      const visibleToA = (await appSql.begin(async (t) => {
        await t`SELECT set_config('app.current_tenant_id', ${tenantA}, true)`;
        return t`SELECT id FROM awcms_identity_mfa_factors WHERE identity_id = ${identityA}`;
      })) as { id: string }[];
      expect(visibleToA.length).toBe(1);

      // As awcms_app (RLS FORCE applies — non-superuser), scoped to tenant B:
      // tenant A's row is invisible even to a raw SELECT with NO application
      // WHERE tenant_id clause. This is the strong RLS proof.
      const rows = (await appSql.begin(async (t) => {
        await t`SELECT set_config('app.current_tenant_id', ${tenantB}, true)`;
        return t`SELECT id FROM awcms_identity_mfa_factors WHERE identity_id = ${identityA}`;
      })) as { id: string }[];
      expect(rows.length).toBe(0);
    } finally {
      await appSql.close({ timeout: 2 });
      await sql.unsafe(`ALTER ROLE awcms_app NOLOGIN`).catch(() => {});
    }
  });

  test("F4: per-factor lockout after N failed step-up verifies; success resets", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const enrollAt = new Date("2026-07-19T10:00:00Z");
    const secret = await enrollActive(tenantId, identityId, enrollAt);
    const at = new Date(enrollAt.getTime() + 120_000);
    // AUTH_MFA_MAX_VERIFY_ATTEMPTS defaults to 5.
    const lockEnv = { ...MFA_ENV } as NodeJS.ProcessEnv;

    // 4 failed attempts: still MFA_INVALID_CODE (not yet locked).
    for (let i = 0; i < 4; i += 1) {
      const r = await tx(tenantId, (t) =>
        verifyStepUpFactor(
          t,
          tenantId,
          identityId,
          { code: "000000" },
          lockEnv,
          at
        )
      );
      expect(r).toEqual({ ok: false, code: "MFA_INVALID_CODE" });
    }

    // 5th failure trips the lock.
    const fifth = await tx(tenantId, (t) =>
      verifyStepUpFactor(
        t,
        tenantId,
        identityId,
        { code: "000000" },
        lockEnv,
        at
      )
    );
    expect(fifth).toEqual({ ok: false, code: "MFA_INVALID_CODE" });

    // Now even a VALID code is refused while locked.
    const validCode = generateTotpCode(secret, at.getTime(), CODE_OPTS);
    const whileLocked = await tx(tenantId, (t) =>
      verifyStepUpFactor(
        t,
        tenantId,
        identityId,
        { code: validCode },
        lockEnv,
        at
      )
    );
    expect(whileLocked).toEqual({ ok: false, code: "MFA_LOCKED" });

    // After the cooldown a valid (later-timestep) code succeeds and resets.
    const afterCooldown = new Date(at.getTime() + 16 * 60_000);
    const freshCode = generateTotpCode(
      secret,
      afterCooldown.getTime(),
      CODE_OPTS
    );
    const ok = await tx(tenantId, (t) =>
      verifyStepUpFactor(
        t,
        tenantId,
        identityId,
        { code: freshCode },
        lockEnv,
        afterCooldown
      )
    );
    expect(ok).toEqual({ ok: true });

    const row = (await sql`
      SELECT failed_verify_count, locked_until FROM awcms_identity_mfa_factors
      WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status = 'active'
    `) as { failed_verify_count: number; locked_until: Date | null }[];
    expect(row[0]!.failed_verify_count).toBe(0);
    expect(row[0]!.locked_until).toBeNull();
  });

  test("F4/HIGH-1: CONCURRENT wrong-code verifies still trip the lockout (counter is atomic, not lost-updated)", async () => {
    // The threat F4 targets: an attacker who knows the password mints many
    // challenges and rotates IPs, firing wrong-code verifies against ONE factor
    // in parallel. If the failed-verify counter were a read-modify-write over a
    // stale snapshot, the concurrent attempts would all read the same low count
    // and blind-SET ~1, so the factor would never reach the cap and online
    // second-factor brute force would stay unbounded. The counter must be
    // atomic + row-serialized so N concurrent failures reach the cap exactly.
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const enrollAt = new Date("2026-07-19T10:00:00Z");
    const secret = await enrollActive(tenantId, identityId, enrollAt);
    const at = new Date(enrollAt.getTime() + 120_000);

    // 6 simultaneous wrong-code step-up verifies (> the default cap of 5), each
    // in its own transaction — races the shared factor row directly.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        tx(tenantId, (t) =>
          verifyStepUpFactor(
            t,
            tenantId,
            identityId,
            { code: "000000" },
            MFA_ENV,
            at
          )
        )
      )
    );
    // Every attempt is denied (wrong code, or locked once the cap is hit).
    expect(results.every((r) => !r.ok)).toBe(true);

    // The factor MUST now be locked — a VALID code is refused with MFA_LOCKED.
    const validCode = generateTotpCode(secret, at.getTime(), CODE_OPTS);
    const whileLocked = await tx(tenantId, (t) =>
      verifyStepUpFactor(
        t,
        tenantId,
        identityId,
        { code: validCode },
        MFA_ENV,
        at
      )
    );
    expect(whileLocked).toEqual({ ok: false, code: "MFA_LOCKED" });

    const row = (await sql`
      SELECT locked_until FROM awcms_identity_mfa_factors
      WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status = 'active'
    `) as { locked_until: Date | null }[];
    expect(row[0]!.locked_until).not.toBeNull();
    expect(new Date(row[0]!.locked_until!).getTime()).toBeGreaterThan(
      at.getTime()
    );
  });

  test("F4: a locked factor collapses to MFA_CHALLENGE_INVALID on the login challenge", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const enrollAt = new Date("2026-07-19T10:00:00Z");
    await enrollActive(tenantId, identityId, enrollAt);
    const at = new Date(enrollAt.getTime() + 120_000);

    // Force the factor into a locked state directly.
    await sql`
      UPDATE awcms_identity_mfa_factors
      SET locked_until = ${new Date(at.getTime() + 60_000)}
      WHERE tenant_id = ${tenantId} AND identity_id = ${identityId} AND status = 'active'
    `;

    const c = await tx(tenantId, (t) =>
      createMfaChallenge(t, tenantId, identityId, 300, at)
    );
    const r = await tx(tenantId, (t) =>
      verifyMfaChallenge(
        t,
        tenantId,
        c.token,
        { code: "000000" },
        MFA_ENV,
        5,
        at
      )
    );
    expect(r).toEqual({ ok: false, code: "MFA_CHALLENGE_INVALID" });
  });

  test("F1: enrollment grant authorizes enroll and is single-use", async () => {
    const tenantId = await createTenant();
    const identityId = await createIdentity(tenantId);
    const now = new Date("2026-07-19T10:00:00Z");

    const grant = await tx(tenantId, (t) =>
      createEnrollmentGrant(t, tenantId, identityId, 300, now)
    );

    const auth = await tx(tenantId, (t) =>
      resolveEnrollAuth(t, tenantId, null, grant.token, now)
    );
    expect(auth).not.toBeNull();
    expect(auth!.identityId).toBe(identityId);
    expect(auth!.viaEnrollment).toBe(true);

    // A bogus token authorizes nothing.
    const none = await tx(tenantId, (t) =>
      resolveEnrollAuth(t, tenantId, null, "bogus-token", now)
    );
    expect(none).toBeNull();

    // Consuming the grant (as enroll/verify does) makes it unusable again.
    await tx(
      tenantId,
      (t) =>
        t`UPDATE awcms_mfa_challenges SET consumed_at = ${now} WHERE id = ${auth!.enrollmentChallengeId}`
    );
    const afterConsume = await tx(tenantId, (t) =>
      resolveEnrollAuth(t, tenantId, null, grant.token, now)
    );
    expect(afterConsume).toBeNull();
  });
});
