/**
 * Route-level E2E tests for the MFA login flow (Issue #184, F1 / F7 / F9).
 * These drive the ACTUAL Astro route handlers (login, mfa/totp/verify,
 * enroll/start+verify, step-up, admin/reset) against real PostgreSQL — the only
 * way to prove the wiring (enrollment enforcement, step-up gating, and the
 * no-enumeration property) rather than the application functions in isolation.
 *
 * Requires a throwaway database with `sql/` applied. Gated on `DATABASE_URL`,
 * the legacy convention. Runs in the dedicated legacy `bun test <files>` step,
 * separate from the `tests/integration/` harness suite.
 *
 * MUTATION PROOFS (repo security-readiness discipline):
 * - F1: delete the `MFA_ENROLLMENT_REQUIRED` branch in `login.ts` -> the
 *   required-but-unenrolled user receives a full session -> "F1" test RED.
 * - F3/step-up: delete `requireStepUp` in `admin/reset.ts` -> the stale-session
 *   admin reset succeeds without step-up -> "F7" test RED.
 *
 * Factors are seeded DIRECTLY (known secret, `last_used_step = -1`) so a real
 * wall-clock TOTP is always strictly greater than the last used step — this
 * avoids the timestep-collision flakiness of enrolling and verifying within the
 * same 30s window. Step-up uses a seeded recovery code (not timestep-bound).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { APIRoute } from "astro";

import { POST as loginPOST } from "../src/pages/api/v1/auth/login";
import { POST as challengeVerifyPOST } from "../src/pages/api/v1/auth/mfa/totp/verify";
import { POST as enrollStartPOST } from "../src/pages/api/v1/auth/mfa/totp/enroll/start";
import { POST as enrollVerifyPOST } from "../src/pages/api/v1/auth/mfa/totp/enroll/verify";
import { POST as stepUpPOST } from "../src/pages/api/v1/auth/mfa/step-up";
import { POST as adminResetPOST } from "../src/pages/api/v1/auth/mfa/admin/reset";
import { hashPassword } from "../src/lib/auth/password";
import { hashSessionToken } from "../src/lib/auth/session-token";
import {
  base32Decode,
  generateTotpCode,
  generateTotpSecret
} from "../src/lib/auth/totp";
import { encryptMfaSecret } from "../src/lib/auth/mfa-secret-crypto";
import { hashRecoveryCode } from "../src/lib/auth/mfa-recovery-code";

const DATABASE_URL =
  process.env.MFA_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

const ENC_KEY = Buffer.alloc(32, 42);
const CODE_OPTS = { periodSec: 30, digits: 6 };
const PASSWORD = "correct horse battery staple";

/** Minimal AstroCookies stub — routes only use `.get(name)?.value` and `.set`. */
function fakeCookies() {
  const store = new Map<string, string>();
  return {
    store,
    get(name: string) {
      return store.has(name) ? { value: store.get(name)! } : undefined;
    },
    set(name: string, value: string) {
      store.set(name, value);
    },
    delete(name: string) {
      store.delete(name);
    },
    has(name: string) {
      return store.has(name);
    }
  };
}

type CallOpts = {
  tenantId: string;
  ip: string;
  body?: unknown;
  headers?: Record<string, string>;
  cookies?: ReturnType<typeof fakeCookies>;
};

async function callRoute(
  handler: APIRoute,
  opts: CallOpts
): Promise<{
  status: number;
  body: any;
  cookies: ReturnType<typeof fakeCookies>;
}> {
  const headers = new Headers({
    "content-type": "application/json",
    "x-awcms-tenant-id": opts.tenantId,
    ...(opts.headers ?? {})
  });
  const request = new Request("http://localhost/api/v1/route", {
    method: "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const cookies = opts.cookies ?? fakeCookies();
  const res = (await handler({
    request,
    cookies,
    clientAddress: opts.ip,
    locals: {}
  } as never)) as Response;
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookies };
}

describeOrSkip("MFA login flow (real PostgreSQL, route-level)", () => {
  let sql: Bun.SQL;
  const createdTenantIds: string[] = [];
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 6 });
    for (const k of [
      "AUTH_MFA_ENABLED",
      "AUTH_MFA_SECRET_ENCRYPTION_KEY",
      "AUTH_MFA_STEPUP_TTL_SEC"
    ]) {
      savedEnv[k] = process.env[k];
    }
    process.env.AUTH_MFA_ENABLED = "true";
    process.env.AUTH_MFA_SECRET_ENCRYPTION_KEY = ENC_KEY.toString("base64");
    process.env.AUTH_MFA_STEPUP_TTL_SEC = "300";
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const tenantId of createdTenantIds) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      await sql`DELETE FROM awcms_identity_mfa_recovery_codes WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_mfa_challenges WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_identity_mfa_factors WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_sessions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_abac_decision_logs WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_access_assignments WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_role_permissions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_roles WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_mfa_policies WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_users WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_identities WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_profiles WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }
    await sql.close({ timeout: 5 });
  });

  async function createTenant(): Promise<string> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const rows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`mfae-${suffix}`}, ${"MFA e2e"})
      RETURNING id
    `) as { id: string }[];
    const tenantId = rows[0]!.id;
    createdTenantIds.push(tenantId);
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
    return tenantId;
  }

  async function seedUser(tenantId: string): Promise<{
    identityId: string;
    tenantUserId: string;
    loginIdentifier: string;
  }> {
    const loginIdentifier = `user-${Math.random().toString(36).slice(2)}`;
    const profile = (await sql`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenantId}, 'person', 'E2E User') RETURNING id
    `) as { id: string }[];
    const passwordHash = await hashPassword(PASSWORD);
    const identity = (await sql`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenantId}, ${profile[0]!.id}, ${loginIdentifier}, ${passwordHash})
      RETURNING id
    `) as { id: string }[];
    const tu = (await sql`
      INSERT INTO awcms_tenant_users (tenant_id, identity_id, status)
      VALUES (${tenantId}, ${identity[0]!.id}, 'active') RETURNING id
    `) as { id: string }[];
    return {
      identityId: identity[0]!.id,
      tenantUserId: tu[0]!.id,
      loginIdentifier
    };
  }

  async function seedActiveFactor(
    tenantId: string,
    identityId: string,
    secret: Buffer
  ): Promise<string> {
    const rows = (await sql`
      INSERT INTO awcms_identity_mfa_factors
        (tenant_id, identity_id, factor_type, secret_ciphertext, status, last_used_step, activated_at)
      VALUES (${tenantId}, ${identityId}, 'totp', ${encryptMfaSecret(secret, ENC_KEY)}, 'active', -1, now())
      RETURNING id
    `) as { id: string }[];
    return rows[0]!.id;
  }

  async function grantPermission(
    tenantId: string,
    tenantUserId: string,
    activityCode: string,
    action: string
  ): Promise<void> {
    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${tenantId}, ${`r-${Math.random().toString(36).slice(2, 8)}`}, 'E2E Role')
      RETURNING id
    `) as { id: string }[];
    const perm = (await sql`
      SELECT id FROM awcms_permissions
      WHERE module_key = 'identity_access' AND activity_code = ${activityCode} AND action = ${action}
    `) as { id: string }[];
    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${tenantId}, ${role[0]!.id}, ${perm[0]!.id})
    `;
    await sql`
      INSERT INTO awcms_access_assignments (tenant_id, tenant_user_id, role_id)
      VALUES (${tenantId}, ${tenantUserId}, ${role[0]!.id})
    `;
  }

  let ipCounter = 0;
  const nextIp = () =>
    `10.9.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

  test("F1: required_for_all + no factor -> enrollment-scoped grant, no session, then self-enroll completes login", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    await sql`
      INSERT INTO awcms_tenant_mfa_policies (tenant_id, enforcement_level)
      VALUES (${tenantId}, 'required_for_all')
    `;

    // Login: password valid, but policy requires MFA and the user has no factor.
    const login = await callRoute(loginPOST, {
      tenantId,
      ip: nextIp(),
      body: { loginIdentifier: user.loginIdentifier, password: PASSWORD }
    });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe("MFA_ENROLLMENT_REQUIRED");
    const enrollmentToken = login.body.error.details
      .mfaEnrollmentToken as string;
    expect(typeof enrollmentToken).toBe("string");
    // Crucially: NO full session was issued.
    expect(login.cookies.has("awcms_session")).toBe(false);

    // The enrollment grant authorizes enroll/start.
    const start = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: { "x-awcms-mfa-enrollment-token": enrollmentToken }
    });
    expect(start.status).toBe(200);
    const secret = base32Decode(start.body.data.secret as string);

    // enroll/verify with the grant completes enrollment AND mints the aal2 session.
    const code = generateTotpCode(secret, Date.now(), CODE_OPTS);
    const verify = await callRoute(enrollVerifyPOST, {
      tenantId,
      ip: nextIp(),
      headers: { "x-awcms-mfa-enrollment-token": enrollmentToken },
      body: { code }
    });
    expect(verify.status).toBe(200);
    expect(verify.body.data.assuranceLevel).toBe("aal2");
    expect(typeof verify.body.data.token).toBe("string");
    expect(verify.cookies.has("awcms_session")).toBe(true);

    // A subsequent login now stops at the ordinary MFA challenge (factor exists).
    const login2 = await callRoute(loginPOST, {
      tenantId,
      ip: nextIp(),
      body: { loginIdentifier: user.loginIdentifier, password: PASSWORD }
    });
    expect(login2.status).toBe(401);
    expect(login2.body.error.code).toBe("MFA_REQUIRED");
    expect(typeof login2.body.error.details.mfaChallengeToken).toBe("string");
  });

  test("F7: login -> MFA -> stale step-up blocks admin action -> step-up -> action succeeds", async () => {
    const tenantId = await createTenant();
    const admin = await seedUser(tenantId);
    const secret = generateTotpSecret();
    await seedActiveFactor(tenantId, admin.identityId, secret);
    await grantPermission(tenantId, admin.tenantUserId, "mfa_admin", "reset");
    // Seed a recovery code for step-up (not timestep-bound, avoids collision).
    const factorRows = (await sql`
      SELECT id FROM awcms_identity_mfa_factors
      WHERE tenant_id = ${tenantId} AND identity_id = ${admin.identityId}
    `) as { id: string }[];
    await sql`
      INSERT INTO awcms_identity_mfa_recovery_codes (tenant_id, identity_id, factor_id, code_hash)
      VALUES (${tenantId}, ${admin.identityId}, ${factorRows[0]!.id}, ${hashRecoveryCode("RECOVERY1")})
    `;

    // A target user with MFA to be reset.
    const target = await seedUser(tenantId);
    await seedActiveFactor(tenantId, target.identityId, generateTotpSecret());

    // 1. Admin logs in with password -> MFA challenge.
    const login = await callRoute(loginPOST, {
      tenantId,
      ip: nextIp(),
      body: { loginIdentifier: admin.loginIdentifier, password: PASSWORD }
    });
    expect(login.body.error.code).toBe("MFA_REQUIRED");
    const challengeToken = login.body.error.details.mfaChallengeToken as string;

    // 2. Complete MFA -> aal2 session.
    const cookies = fakeCookies();
    const challenge = await callRoute(challengeVerifyPOST, {
      tenantId,
      ip: nextIp(),
      cookies,
      body: {
        mfaChallengeToken: challengeToken,
        code: generateTotpCode(secret, Date.now(), CODE_OPTS)
      }
    });
    expect(challenge.status).toBe(200);
    const sessionToken = challenge.body.data.token as string;

    // 3. Age the step-up so it is stale (simulates time passing past the TTL).
    await sql`
      UPDATE awcms_sessions SET stepped_up_at = ${new Date(Date.now() - 3600_000)}
      WHERE tenant_id = ${tenantId} AND token_hash = ${hashSessionToken(sessionToken)}
    `;

    // 4. Admin action is blocked: stale step-up.
    const blocked = await callRoute(adminResetPOST, {
      tenantId,
      ip: nextIp(),
      cookies,
      body: { identityId: target.identityId, reason: "user lost device" }
    });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("STEP_UP_REQUIRED");

    // 5. Step up with a recovery code (refreshes the aal2 stamp in place).
    const stepUp = await callRoute(stepUpPOST, {
      tenantId,
      ip: nextIp(),
      cookies,
      body: { recoveryCode: "RECOVERY1" }
    });
    expect(stepUp.status).toBe(200);
    expect(stepUp.body.data.assuranceLevel).toBe("aal2");

    // 6. Admin action now succeeds.
    const reset = await callRoute(adminResetPOST, {
      tenantId,
      ip: nextIp(),
      cookies,
      body: { identityId: target.identityId, reason: "user lost device" }
    });
    expect(reset.status).toBe(200);
    expect(reset.body.data.reset).toBe(true);

    const status = (await sql`
      SELECT status FROM awcms_identity_mfa_factors
      WHERE tenant_id = ${tenantId} AND identity_id = ${target.identityId}
    `) as { status: string }[];
    expect(status[0]!.status).toBe("disabled");
  });

  test("F9: MFA enrollment is not an enumeration oracle (wrong password vs unknown identifier are identical)", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    await seedActiveFactor(tenantId, user.identityId, generateTotpSecret());

    // Known identity WITH an active factor, WRONG password.
    const knownWrong = await callRoute(loginPOST, {
      tenantId,
      ip: nextIp(),
      body: {
        loginIdentifier: user.loginIdentifier,
        password: "wrong-password"
      }
    });

    // Unknown identifier entirely.
    const unknown = await callRoute(loginPOST, {
      tenantId,
      ip: nextIp(),
      body: { loginIdentifier: "does-not-exist", password: "wrong-password" }
    });

    // Byte-identical status/code/message: the presence of an MFA factor is
    // never observable without the correct password. Neither leaks MFA_REQUIRED.
    expect(knownWrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(knownWrong.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(unknown.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(knownWrong.body.error.message).toBe(unknown.body.error.message);
    expect(knownWrong.body.error.code).not.toBe("MFA_REQUIRED");

    // Timing note: the dominant cost (argon2id) is equalized by
    // `verifyPasswordOrDummy` for both paths, and the MFA branch executes only
    // AFTER a valid password — so it cannot add a pre-authentication timing
    // signal. A wall-clock assertion here would be flaky; the response
    // equivalence above is the robust, deterministic proof.
  });
});
