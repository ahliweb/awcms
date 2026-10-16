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
import { POST as passwordChangePOST } from "../src/pages/api/v1/auth/password/change";
import { POST as switchPOST } from "../src/pages/api/v1/auth/session/switch";
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
import { seedDefaultEmailTemplates } from "../src/modules/email/application/email-template-directory";
import { DEFAULT_EMAIL_TEMPLATES } from "../src/modules/email/domain/email-default-templates";
import {
  linkIdentityToPrincipal,
  setPrincipalCredential
} from "../src/modules/identity-access/application/principal-store";
import { completePasswordReset } from "../src/modules/identity-access/application/password-reset";
import {
  generateResetToken,
  hashResetToken
} from "../src/lib/auth/reset-token";
import { restampOwnSessionAfterCredentialChange } from "../src/modules/identity-access/application/session-directory";
import { resolveActiveSession } from "../src/modules/identity-access/application/session-lookup";
import { PENDING_ENROLLMENT_MAX_FAILURES } from "../src/modules/identity-access/application/mfa";

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
    // ADR-0087 — the factor rows are GLOBAL, so a tenant delete no longer takes
    // them with it. Gathered per tenant, deleted after the loop: one principal
    // can be shared by identities in more than one of these tenants.
    const principalIds = new Set<string>();

    for (const tenantId of createdTenantIds) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;

      const principals = (await sql`
        SELECT DISTINCT principal_id FROM awcms_identities
        WHERE tenant_id = ${tenantId} AND principal_id IS NOT NULL
      `) as { principal_id: string }[];

      for (const row of principals) principalIds.add(row.principal_id);

      await sql`DELETE FROM awcms_identity_mfa_recovery_codes WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_mfa_challenges WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_identity_mfa_factors WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_sessions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_email_messages WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_email_templates WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_password_reset_tokens WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_abac_decision_logs WHERE tenant_id = ${tenantId}`;
      // ADR-0078 — bootstrap's owner grant lands in `awcms_access_policies`,
      // whose composite FK to `awcms_roles` blocks the role delete below unless
      // the grant goes first. Its event table references the policy, so it leads.
      await sql`DELETE FROM awcms_access_policy_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_access_policies WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_role_permissions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_roles WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_mfa_policies WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_users WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_identities WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_profiles WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }

    for (const principalId of principalIds) {
      await sql`DELETE FROM awcms_principal_mfa_recovery_codes WHERE principal_id = ${principalId}`;
      await sql`DELETE FROM awcms_principal_mfa_factors WHERE principal_id = ${principalId}`;
      await sql`DELETE FROM awcms_principals WHERE id = ${principalId}`;
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

  async function seedUser(
    tenantId: string,
    sharedLoginIdentifier?: string
  ): Promise<{
    identityId: string;
    tenantUserId: string;
    loginIdentifier: string;
  }> {
    const loginIdentifier =
      sharedLoginIdentifier ?? `user-${Math.random().toString(36).slice(2)}`;
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

    // Linked, because the four real identity writers link (ADR-0085/0086) and
    // since ADR-0087 an unlinked identity cannot hold a factor at all. A helper
    // that skipped it would seed an account shape production never creates.
    await linkIdentityToPrincipal(sql, identity[0]!.id, loginIdentifier);

    return {
      identityId: identity[0]!.id,
      tenantUserId: tu[0]!.id,
      loginIdentifier
    };
  }

  /** The human behind an identity — what every MFA row hangs from since sql/114. */
  /**
   * Forges the pre-ADR-0086 state "an identity never linked to a principal".
   * `sql/310` makes `awcms_identities.principal_id` link-once, so a linked
   * identity can no longer be unlinked by an ordinary UPDATE (unlink then relink
   * is a repoint). The fixture bypasses the trigger deliberately with
   * `session_replication_role = replica`, for this one statement in this one
   * transaction, as production code never can.
   */
  async function forgeUnlinkedIdentity(
    tenantId: string,
    identityId: string
  ): Promise<void> {
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL session_replication_role = replica");
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      await tx`UPDATE awcms_identities SET principal_id = NULL WHERE id = ${identityId}`;
    });
  }

  async function principalOf(identityId: string): Promise<string> {
    const rows = (await sql`
      SELECT principal_id FROM awcms_identities WHERE id = ${identityId}
    `) as { principal_id: string | null }[];

    const principalId = rows[0]?.principal_id;
    if (!principalId) throw new Error("identity has no principal");

    return principalId;
  }

  async function seedActiveFactor(
    identityId: string,
    secret: Buffer
  ): Promise<string> {
    const rows = (await sql`
      INSERT INTO awcms_principal_mfa_factors
        (principal_id, factor_type, secret_ciphertext, status, last_used_step, activated_at)
      VALUES (${await principalOf(identityId)}, 'totp', ${encryptMfaSecret(secret, ENC_KEY)}, 'active', -1, now())
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
      INSERT INTO awcms_access_policies
        (tenant_id, tenant_user_id, role_id, scope_type, scope_id)
      VALUES (${tenantId}, ${tenantUserId}, ${role[0]!.id}, 'tenant', ${tenantId})
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

  // ---- #1004 (audit F-3 of #977): a SESSION alone cannot enrol a factor ----
  //
  // MUTATION PROOF: delete the `reauthenticateForEnrollment` call in
  // `enroll/start.ts` -> a bearer of nothing but a session starts enrolment ->
  // the "session-only attacker" test is RED.

  async function sessionFor(
    tenantId: string,
    user: { loginIdentifier: string }
  ): Promise<string> {
    const login = await callRoute(loginPOST, {
      tenantId,
      ip: nextIp(),
      body: { loginIdentifier: user.loginIdentifier, password: PASSWORD }
    });
    expect(login.status).toBe(200);
    return login.body.data.token as string;
  }

  async function pendingFactorCount(identityId: string): Promise<number> {
    const rows = (await sql`
      SELECT count(*)::int AS n FROM awcms_principal_mfa_factors
      WHERE principal_id = ${await principalOf(identityId)} AND status = 'pending'
    `) as { n: number }[];
    return rows[0]!.n;
  }

  test("#1004: a session-only attacker cannot start enrolment; the password re-authenticates", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const token = await sessionFor(tenantId, user);
    const bearer = { authorization: `Bearer ${token}` };

    // No password: refused, nothing created.
    const bare = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer
    });
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe("PASSWORD_REQUIRED");
    expect(await pendingFactorCount(user.identityId)).toBe(0);

    // Wrong password: refused, nothing created, audited.
    const wrong = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: "not the password" }
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(await pendingFactorCount(user.identityId)).toBe(0);
    const audits = (await sql`
      SELECT count(*)::int AS n FROM awcms_audit_events
      WHERE tenant_id = ${tenantId} AND action = 'mfa_enroll_reauth_failed'
    `) as { n: number }[];
    expect(audits[0]!.n).toBe(2);

    // Correct password: enrolment starts.
    const ok = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: PASSWORD }
    });
    expect(ok.status).toBe(200);
    expect(typeof ok.body.data.secret).toBe("string");
    expect(await pendingFactorCount(user.identityId)).toBe(1);
  });

  test("#1004: an existing factor cannot be replaced or added to through enroll/start", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const factorId = await seedActiveFactor(
      user.identityId,
      generateTotpSecret()
    );
    // With a factor, login stops at the challenge; mint a session directly.
    const sessionToken = await mintSession(tenantId, user.identityId, "local");

    // Even with the correct password: 409, the factor is untouched.
    const res = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: { authorization: `Bearer ${sessionToken}` },
      body: { currentPassword: PASSWORD }
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MFA_ALREADY_ACTIVE");
    const rows = (await sql`
      SELECT status FROM awcms_principal_mfa_factors WHERE id = ${factorId}
    `) as { status: string }[];
    expect(rows[0]!.status).toBe("active");
  });

  async function mintSession(
    tenantId: string,
    identityId: string,
    origin: "local" | "sso",
    lastAuthenticatedAt: Date = new Date()
  ): Promise<string> {
    // "local" is the password login method; the stored value is 'password'.
    const originAuth = origin === "sso" ? "sso" : "password";
    const token = `t1004-${crypto.randomUUID()}`;
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
    await sql`
      INSERT INTO awcms_sessions
        (tenant_id, identity_id, token_hash, expires_at, assurance_level,
         last_authenticated_at, origin_auth, credential_epoch)
      VALUES (${tenantId}, ${identityId}, ${hashSessionToken(token)},
        now() + interval '1 hour', 'aal1', ${lastAuthenticatedAt}, ${originAuth},
        ${await currentEpoch(identityId)})
    `;
    return token;
  }

  /** Like mintSession, but tolerates an identity with no principal (epoch 0). */
  async function mintSessionRaw(
    tenantId: string,
    identityId: string,
    origin: "local" | "sso"
  ): Promise<string> {
    // "local" is the password login method; the stored value is 'password'.
    const originAuth = origin === "sso" ? "sso" : "password";
    const token = `t1004-${crypto.randomUUID()}`;
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
    await sql`
      INSERT INTO awcms_sessions
        (tenant_id, identity_id, token_hash, expires_at, assurance_level,
         last_authenticated_at, origin_auth, credential_epoch)
      VALUES (${tenantId}, ${identityId}, ${hashSessionToken(token)},
        now() + interval '1 hour', 'aal1', now(), ${originAuth}, 0)
    `;
    return token;
  }

  async function currentEpoch(identityId: string): Promise<number> {
    const rows = (await sql`
      SELECT p.credential_epoch FROM awcms_principals p
      JOIN awcms_identities i ON i.principal_id = p.id WHERE i.id = ${identityId}
    `) as { credential_epoch: number }[];
    return rows[0]!.credential_epoch;
  }

  test("#1004: an SSO session re-authenticates by freshness only", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);

    const stale = await mintSession(
      tenantId,
      user.identityId,
      "sso",
      new Date(Date.now() - 3_600_000)
    );
    // Stale SSO session, password not presented -> falls to the password rule.
    const refused = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: { authorization: `Bearer ${stale}` }
    });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("PASSWORD_REQUIRED");

    const fresh = await mintSession(tenantId, user.identityId, "sso");
    const allowed = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: { authorization: `Bearer ${fresh}` }
    });
    expect(allowed.status).toBe(200);
  });

  test("#1004: completing enrolment writes a critical audit event and queues a notice to the owner", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    await seedDefaultEmailTemplates(
      sql,
      tenantId,
      user.tenantUserId,
      DEFAULT_EMAIL_TEMPLATES
    );
    const token = await sessionFor(tenantId, user);
    const bearer = { authorization: `Bearer ${token}` };

    const start = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: PASSWORD }
    });
    expect(start.status).toBe(200);
    const secret = base32Decode(start.body.data.secret as string);
    const verify = await callRoute(enrollVerifyPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer,
      body: { code: generateTotpCode(secret, Date.now(), CODE_OPTS) }
    });
    expect(verify.status).toBe(200);

    const audit = (await sql`
      SELECT severity, attributes FROM awcms_audit_events
      WHERE tenant_id = ${tenantId} AND action = 'mfa_enrolled'
    `) as { severity: string; attributes: Record<string, unknown> }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]!.severity).toBe("critical");
    expect(audit[0]!.attributes.via).toBe("session");
    expect(audit[0]!.attributes.notified).toBe(true);

    const mail = (await sql`
      SELECT count(*)::int AS n FROM awcms_email_messages
      WHERE tenant_id = ${tenantId} AND template_key = 'system.security_notice'
    `) as { n: number }[];
    expect(mail[0]!.n).toBe(1);
  });

  // ---- #1004 follow-ups from the security review of 938caa88 ----

  const OTHER_PASSWORD = "a completely different passphrase 42";

  /** Same person in two tenants, then the password changed THROUGH tenant A. */
  async function twoTenantsPasswordChangedInA() {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const loginIdentifier = `shared-${Math.random().toString(36).slice(2)}`;
    const userA = await seedUser(tenantA, loginIdentifier);
    const userB = await seedUser(tenantB, loginIdentifier);
    const principalId = await principalOf(userA.identityId);
    // What `password-change` does: the PRINCIPAL credential and tenant A's own
    // copy change; tenant B's identity row keeps the stale hash.
    const newHash = await hashPassword(OTHER_PASSWORD);
    await sql`SELECT set_config('app.current_tenant_id', ${tenantA}, false)`;
    await sql`UPDATE awcms_identities SET password_hash = ${newHash} WHERE id = ${userA.identityId}`;
    await setPrincipalCredential(sql, principalId, newHash);
    return { tenantA, tenantB, userA, userB, principalId };
  }

  test("#1004 H1: re-authentication uses the CURRENT credential, not a tenant's stale hash", async () => {
    const { tenantB, userB } = await twoTenantsPasswordChangedInA();
    const token = await mintSession(tenantB, userB.identityId, "local");
    const bearer = { authorization: `Bearer ${token}` };

    // The password this tenant's own row still carries is no longer the password.
    const old = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: PASSWORD }
    });
    expect(old.status).toBe(400);
    expect(old.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(await pendingFactorCount(userB.identityId)).toBe(0);

    const current = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: OTHER_PASSWORD }
    });
    expect(current.status).toBe(200);
  });

  test("#1004 M1: wrong passwords count toward the principal lockout, and a locked person is refused", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const principalId = await principalOf(user.identityId);
    const token = await mintSession(tenantId, user.identityId, "local");
    const bearer = { authorization: `Bearer ${token}` };

    await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: "wrong" }
    });
    const rows = (await sql`
      SELECT failed_login_count FROM awcms_principals WHERE id = ${principalId}
    `) as { failed_login_count: number }[];
    expect(rows[0]!.failed_login_count).toBe(1);

    await sql`UPDATE awcms_principals SET locked_until = now() + interval '10 minutes' WHERE id = ${principalId}`;
    const locked = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: PASSWORD }
    });
    expect(locked.status).toBe(429);
    expect(await pendingFactorCount(user.identityId)).toBe(0);
  });

  test("#1004 M1: a per-session bucket bounds guesses whatever the source address", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const token = await mintSession(tenantId, user.identityId, "local");
    const bearer = { authorization: `Bearer ${token}` };
    // Reset the lockout each time so only the bucket can be what stops us.
    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      await sql`UPDATE awcms_principals SET failed_login_count = 0, locked_until = NULL WHERE id = ${await principalOf(user.identityId)}`;
      const res = await callRoute(enrollStartPOST, {
        tenantId,
        ip: nextIp(),
        headers: bearer,
        body: { currentPassword: "wrong" }
      });
      last = res.status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  test("#1004 H2: a fresh SSO session does not enrol a principal-global factor for a person who works in another tenant", async () => {
    const { tenantB, userB } = await twoTenantsPasswordChangedInA();
    const sso = await mintSession(tenantB, userB.identityId, "sso");
    const bearer = { authorization: `Bearer ${sso}` };

    const bare = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: bearer
    });
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe("PASSWORD_REQUIRED");
    expect(await pendingFactorCount(userB.identityId)).toBe(0);

    const withPassword = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: OTHER_PASSWORD }
    });
    expect(withPassword.status).toBe(200);
  });

  async function startedEnrolment(
    tenantId: string,
    user: { identityId: string }
  ) {
    const token = await mintSession(tenantId, user.identityId, "local");
    const bearer = { authorization: `Bearer ${token}` };
    const start = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: PASSWORD }
    });
    expect(start.status).toBe(200);
    const secret = base32Decode(start.body.data.secret as string);
    return { token, bearer, secret };
  }

  function verifyCall(
    tenantId: string,
    bearer: Record<string, string>,
    code: string
  ) {
    return callRoute(enrollVerifyPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer,
      body: { code }
    });
  }

  test("#1004 H3: another session of the same person cannot confirm an enrolment it did not start", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const { bearer, secret } = await startedEnrolment(tenantId, user);
    const other = {
      authorization: `Bearer ${await mintSession(tenantId, user.identityId, "local")}`
    };
    const code = generateTotpCode(secret, Date.now(), CODE_OPTS);

    const stolen = await verifyCall(tenantId, other, code);
    expect(stolen.status).toBe(404);

    const owner = await verifyCall(tenantId, bearer, code);
    expect(owner.status).toBe(200);
  });

  test("#1004 H3: a pending enrolment expires by the database clock and is replaced by the next start", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const { bearer, secret } = await startedEnrolment(tenantId, user);
    await sql`UPDATE awcms_principal_mfa_factors SET created_at = now() - interval '11 minutes' WHERE principal_id = ${await principalOf(user.identityId)} AND status = 'pending'`;

    const expired = await verifyCall(
      tenantId,
      bearer,
      generateTotpCode(secret, Date.now(), CODE_OPTS)
    );
    expect(expired.status).toBe(404);

    const restart = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: bearer,
      body: { currentPassword: PASSWORD }
    });
    expect(restart.status).toBe(200);
    const fresh = base32Decode(restart.body.data.secret as string);
    const ok = await verifyCall(
      tenantId,
      bearer,
      generateTotpCode(fresh, Date.now(), CODE_OPTS)
    );
    expect(ok.status).toBe(200);
  });

  test("#1004 H3: a pending factor from before the binding column cannot be confirmed", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const { bearer, secret } = await startedEnrolment(tenantId, user);
    await sql`UPDATE awcms_principal_mfa_factors SET enrollment_binding_hash = NULL WHERE principal_id = ${await principalOf(user.identityId)} AND status = 'pending'`;

    const res = await verifyCall(
      tenantId,
      bearer,
      generateTotpCode(secret, Date.now(), CODE_OPTS)
    );
    expect(res.status).toBe(404);
  });

  test("#1004 H3: wrong codes destroy the pending secret at the cap", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const { bearer, secret } = await startedEnrolment(tenantId, user);
    const good = generateTotpCode(secret, Date.now(), CODE_OPTS);
    const wrong = good === "000000" ? "111111" : "000000";

    for (let i = 1; i < PENDING_ENROLLMENT_MAX_FAILURES; i += 1) {
      const res = await verifyCall(tenantId, bearer, wrong);
      expect(res.status).toBe(400);
    }
    const last = await verifyCall(tenantId, bearer, wrong);
    expect(last.status).toBe(429);
    expect(last.body.error.code).toBe("MFA_ENROLLMENT_EXHAUSTED");
    expect(await pendingFactorCount(user.identityId)).toBe(0);

    // The right code for the destroyed secret no longer works.
    const after = await verifyCall(tenantId, bearer, good);
    expect(after.status).toBe(404);
  });

  test("#1004 H3: enroll/verify is rate limited per session", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const token = await mintSession(tenantId, user.identityId, "local");
    const bearer = { authorization: `Bearer ${token}` };
    let last = 0;
    for (let i = 0; i < 40; i += 1) {
      last = (await verifyCall(tenantId, bearer, "123456")).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  // ---- #1004 re-audit: H-A (switch-minted grant), M-A (raceable cap) ----

  async function switchIntoRequiredTenant() {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const loginIdentifier = `sw-${Math.random().toString(36).slice(2)}`;
    const userA = await seedUser(tenantA, loginIdentifier);
    const userB = await seedUser(tenantB, loginIdentifier);
    await sql`
      INSERT INTO awcms_tenant_mfa_policies (tenant_id, enforcement_level)
      VALUES (${tenantB}, 'required_for_all')
    `;
    // The attacker holds nothing but a (stolen) password-origin session in A.
    const stolen = await mintSession(tenantA, userA.identityId, "local");
    const switched = await callRoute(switchPOST, {
      tenantId: tenantA,
      ip: nextIp(),
      headers: { authorization: `Bearer ${stolen}` },
      body: { tenantId: tenantB }
    });

    return { tenantB, userB, switched };
  }

  test("#1004 H-A: a grant minted by a tenant SWITCH must re-authenticate; a login grant still does not", async () => {
    const { tenantB, userB, switched } = await switchIntoRequiredTenant();
    expect(switched.status).toBe(401);
    expect(switched.body.error.code).toBe("MFA_ENROLLMENT_REQUIRED");
    const grant = switched.body.error.details.mfaEnrollmentToken as string;
    const origin = (await sql`
      SELECT enrollment_origin FROM awcms_mfa_challenges
      WHERE tenant_id = ${tenantB} AND purpose = 'enrollment'
    `) as { enrollment_origin: string }[];
    expect(origin[0]!.enrollment_origin).toBe("switch");

    // No password: refused, nothing created.
    const bare = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: { "x-awcms-mfa-enrollment-token": grant }
    });
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe("PASSWORD_REQUIRED");
    expect(await pendingFactorCount(userB.identityId)).toBe(0);

    const wrong = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: { "x-awcms-mfa-enrollment-token": grant },
      body: { currentPassword: "nope" }
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");

    const ok = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: { "x-awcms-mfa-enrollment-token": grant },
      body: { currentPassword: PASSWORD }
    });
    expect(ok.status).toBe(200);
  });

  test("#1004 H-A: a grant minted by a PASSWORD LOGIN still skips re-authentication", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    await sql`
      INSERT INTO awcms_tenant_mfa_policies (tenant_id, enforcement_level)
      VALUES (${tenantId}, 'required_for_all')
    `;
    const login = await callRoute(loginPOST, {
      tenantId,
      ip: nextIp(),
      body: { loginIdentifier: user.loginIdentifier, password: PASSWORD }
    });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe("MFA_ENROLLMENT_REQUIRED");
    const origin = (await sql`
      SELECT enrollment_origin FROM awcms_mfa_challenges
      WHERE tenant_id = ${tenantId} AND purpose = 'enrollment'
    `) as { enrollment_origin: string }[];
    expect(origin[0]!.enrollment_origin).toBe("login");

    const start = await callRoute(enrollStartPOST, {
      tenantId,
      ip: nextIp(),
      headers: {
        "x-awcms-mfa-enrollment-token": login.body.error.details
          .mfaEnrollmentToken as string
      }
    });
    expect(start.status).toBe(200);
  });

  test("#1004 H-A: a pre-sql/262 grant (NULL origin) is treated as a switch grant", async () => {
    const { tenantB, userB, switched } = await switchIntoRequiredTenant();
    const grant = switched.body.error.details.mfaEnrollmentToken as string;
    await sql`UPDATE awcms_mfa_challenges SET enrollment_origin = NULL WHERE tenant_id = ${tenantB} AND purpose = 'enrollment'`;

    const bare = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: { "x-awcms-mfa-enrollment-token": grant }
    });
    expect(bare.status).toBe(400);
    expect(await pendingFactorCount(userB.identityId)).toBe(0);
  });

  test("#1004 M-A: thirty parallel wrong codes evaluate at most five", async () => {
    const prior = process.env.AUTH_MFA_RATE_LIMIT_MAX;
    process.env.AUTH_MFA_RATE_LIMIT_MAX = "1000";
    try {
      const tenantId = await createTenant();
      const user = await seedUser(tenantId);
      const { bearer, secret } = await startedEnrolment(tenantId, user);
      const good = generateTotpCode(secret, Date.now(), CODE_OPTS);
      const wrong = good === "000000" ? "111111" : "000000";

      const results = await Promise.all(
        Array.from({ length: 30 }, () => verifyCall(tenantId, bearer, wrong))
      );
      const codes = results.map((r) => r.body?.error?.code as string);
      const evaluatedAsWrong = codes.filter(
        (c) => c === "MFA_INVALID_CODE"
      ).length;
      const exhausted = codes.filter(
        (c) => c === "MFA_ENROLLMENT_EXHAUSTED"
      ).length;

      // Evaluated = answered "wrong code" (cap-1 of them) + the one that hit
      // the cap. Anything above PENDING_ENROLLMENT_MAX_FAILURES means guesses
      // beyond the cap were tested.
      expect(evaluatedAsWrong).toBeLessThanOrEqual(
        PENDING_ENROLLMENT_MAX_FAILURES - 1
      );
      expect(evaluatedAsWrong + Math.min(exhausted, 1)).toBeLessThanOrEqual(
        PENDING_ENROLLMENT_MAX_FAILURES
      );
      expect(await pendingFactorCount(user.identityId)).toBe(0);
    } finally {
      if (prior === undefined) delete process.env.AUTH_MFA_RATE_LIMIT_MAX;
      else process.env.AUTH_MFA_RATE_LIMIT_MAX = prior;
    }
  });

  test("#1004 L2: an UNLINKED identity fails closed for the SSO exemption and is verified like login does", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const loginIdentifier = `unl-${Math.random().toString(36).slice(2)}`;
    const userA = await seedUser(tenantA, loginIdentifier);
    const newHash = await hashPassword(OTHER_PASSWORD);
    await setPrincipalCredential(
      sql,
      await principalOf(userA.identityId),
      newHash
    );

    // Tenant B's identity for the same address was never linked to the principal.
    const userB = await seedUser(tenantB, loginIdentifier);
    await sql`SELECT set_config('app.current_tenant_id', ${tenantB}, false)`;
    await forgeUnlinkedIdentity(tenantB, userB.identityId);

    const sso = await mintSessionRaw(tenantB, userB.identityId, "sso");
    const bare = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: { authorization: `Bearer ${sso}` }
    });
    expect(bare.status).toBe(400);
    expect(bare.body.error.code).toBe("PASSWORD_REQUIRED");

    // The credential is the person's CURRENT one (found by address, as login does).
    const stale = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: { authorization: `Bearer ${sso}` },
      body: { currentPassword: PASSWORD }
    });
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe("INVALID_CREDENTIALS");
    const current = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: { authorization: `Bearer ${sso}` },
      body: { currentPassword: OTHER_PASSWORD }
    });
    expect(current.status).toBe(200);
  });

  // ---- #1035: password change verifies the CURRENT credential ----

  const NEW_PASSWORD = "brand new passphrase for alice 99";

  function changeCall(
    tenantId: string,
    token: string,
    currentPassword: string,
    newPassword: string = NEW_PASSWORD
  ) {
    return callRoute(passwordChangePOST, {
      tenantId,
      ip: nextIp(),
      headers: { authorization: `Bearer ${token}` },
      body: { currentPassword, newPassword }
    });
  }

  async function alicePair() {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const loginIdentifier = `alice-${Math.random().toString(36).slice(2)}`;
    const userA = await seedUser(tenantA, loginIdentifier);
    const userB = await seedUser(tenantB, loginIdentifier);
    return { tenantA, tenantB, userA, userB, loginIdentifier };
  }

  test("#1035: after Alice changes her password in tenant A, her OLD password is dead in tenant B", async () => {
    const { tenantA, tenantB, userA, userB, loginIdentifier } =
      await alicePair();
    const sessionA = await mintSession(tenantA, userA.identityId, "local");

    const changed = await changeCall(tenantA, sessionA, PASSWORD);
    expect(changed.status).toBe(200);

    // The attacker's tenant-B session (minted after the change; the epoch bump
    // ended the ones from before) holds her OLD password.
    const attackerB = await mintSession(tenantB, userB.identityId, "local");
    const takeover = await changeCall(
      tenantB,
      attackerB,
      PASSWORD,
      "attacker chosen passphrase 1"
    );
    expect(takeover.status).toBe(400);
    expect(takeover.body.error.code).toBe("INVALID_CREDENTIALS");

    // And no other current-password check accepts it either (enrolment).
    const enrol = await callRoute(enrollStartPOST, {
      tenantId: tenantB,
      ip: nextIp(),
      headers: { authorization: `Bearer ${attackerB}` },
      body: { currentPassword: PASSWORD }
    });
    expect(enrol.status).toBe(400);
    expect(enrol.body.error.code).toBe("INVALID_CREDENTIALS");

    // The NEW password logs in in BOTH tenants, the old one in neither.
    for (const tenantId of [tenantA, tenantB]) {
      const fresh = await callRoute(loginPOST, {
        tenantId,
        ip: nextIp(),
        body: { loginIdentifier, password: NEW_PASSWORD }
      });
      expect(fresh.status).toBe(200);
      const stale = await callRoute(loginPOST, {
        tenantId,
        ip: nextIp(),
        body: { loginIdentifier, password: PASSWORD }
      });
      expect(stale.status).toBe(401);
    }
  });

  test("#1035: the caller keeps working after a change, and a change in B with the NEW password succeeds", async () => {
    const { tenantA, tenantB, userA, userB } = await alicePair();
    const sessionA = await mintSession(tenantA, userA.identityId, "local");
    expect((await changeCall(tenantA, sessionA, PASSWORD)).status).toBe(200);

    // Her own session survived the epoch bump (it proved the old password).
    const stillMine = await callRoute(enrollStartPOST, {
      tenantId: tenantA,
      ip: nextIp(),
      headers: { authorization: `Bearer ${sessionA}` },
      body: { currentPassword: NEW_PASSWORD }
    });
    expect(stillMine.status).toBe(200);

    const sessionB = await mintSession(tenantB, userB.identityId, "local");
    const second = await changeCall(
      tenantB,
      sessionB,
      NEW_PASSWORD,
      "yet another passphrase 77"
    );
    expect(second.status).toBe(200);
  });

  test("#1035: wrong current passwords count toward the principal lockout", async () => {
    const prior = process.env.AUTH_LOGIN_MAX_ATTEMPTS;
    process.env.AUTH_LOGIN_MAX_ATTEMPTS = "3";
    try {
      const { tenantB, userB } = await alicePair();
      const principalId = await principalOf(userB.identityId);
      const session = await mintSession(tenantB, userB.identityId, "local");

      for (let i = 0; i < 3; i += 1) {
        const wrong = await changeCall(tenantB, session, "not the password");
        expect(wrong.status).toBe(400);
      }
      const rows = (await sql`
        SELECT failed_login_count, locked_until FROM awcms_principals WHERE id = ${principalId}
      `) as { failed_login_count: number; locked_until: Date | null }[];
      expect(rows[0]!.failed_login_count).toBe(3);
      expect(rows[0]!.locked_until).not.toBeNull();

      // Locked: even the right password is refused, and nothing changed.
      const locked = await changeCall(tenantB, session, PASSWORD);
      expect(locked.status).toBe(429);
    } finally {
      if (prior === undefined) delete process.env.AUTH_LOGIN_MAX_ATTEMPTS;
      else process.env.AUTH_LOGIN_MAX_ATTEMPTS = prior;
    }
  });

  test("#1035: the audit trail records the change and the refusal with no secrets", async () => {
    const { tenantA, userA } = await alicePair();
    const session = await mintSession(tenantA, userA.identityId, "local");

    expect((await changeCall(tenantA, session, "wrong guess 123")).status).toBe(
      400
    );
    expect((await changeCall(tenantA, session, PASSWORD)).status).toBe(200);

    const rows = (await sql`
      SELECT action, severity, message, attributes::text AS attributes
      FROM awcms_audit_events
      WHERE tenant_id = ${tenantA}
        AND action IN ('password_changed', 'password_change_failed')
    `) as {
      action: string;
      severity: string;
      message: string;
      attributes: string;
    }[];

    expect(rows.map((row) => row.action).sort()).toEqual([
      "password_change_failed",
      "password_changed"
    ]);
    for (const row of rows) {
      const blob = `${row.message} ${row.attributes}`;
      for (const secret of [
        PASSWORD,
        NEW_PASSWORD,
        "wrong guess 123",
        "$argon2"
      ]) {
        expect(blob).not.toContain(secret);
      }
    }
  });

  test("#1035 follow-up: a reset on an UNLINKED identity still replaces the principal credential everywhere", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const loginIdentifier = `reset-${Math.random().toString(36).slice(2)}`;
    const userA = await seedUser(tenantA, loginIdentifier);
    const userB = await seedUser(tenantB, loginIdentifier);
    const principalId = await principalOf(userA.identityId);
    // The person's live credential is the PRINCIPAL's (the leaked password).
    await setPrincipalCredential(
      sql,
      principalId,
      await hashPassword(PASSWORD)
    );

    // Tenant B's identity was never linked (the missed-writer case).
    await sql`SELECT set_config('app.current_tenant_id', ${tenantB}, false)`;
    await forgeUnlinkedIdentity(tenantB, userB.identityId);
    const oldSessionA = await mintSession(tenantA, userA.identityId, "local");
    const oldSessionB = await mintSessionRaw(
      tenantB,
      userB.identityId,
      "local"
    );

    const rawToken = generateResetToken();
    await sql`
      INSERT INTO awcms_password_reset_tokens (tenant_id, identity_id, token_hash, expires_at)
      VALUES (${tenantB}, ${userB.identityId}, ${hashResetToken(rawToken)}, now() + interval '30 minutes')
    `;
    const reset = await completePasswordReset(
      sql,
      tenantB,
      rawToken,
      NEW_PASSWORD,
      new Date()
    );
    expect(reset.outcome).toBe("success");

    // The identity is now linked, so its sessions join the epoch check.
    const linked =
      (await sql`SELECT principal_id FROM awcms_identities WHERE id = ${userB.identityId}`) as {
        principal_id: string | null;
      }[];
    expect(linked[0]!.principal_id).toBe(principalId);

    for (const tenantId of [tenantA, tenantB]) {
      const fresh = await callRoute(loginPOST, {
        tenantId,
        ip: nextIp(),
        body: { loginIdentifier, password: NEW_PASSWORD }
      });
      expect(fresh.status).toBe(200);
      const stale = await callRoute(loginPOST, {
        tenantId,
        ip: nextIp(),
        body: { loginIdentifier, password: PASSWORD }
      });
      expect(stale.status).toBe(401);
    }

    // Sessions from before the reset are dead in both tenants.
    expect(
      await resolveActiveSession(
        sql,
        tenantA,
        hashSessionToken(oldSessionA),
        new Date()
      )
    ).toBeNull();
    await sql`SELECT set_config('app.current_tenant_id', ${tenantB}, false)`;
    expect(
      await resolveActiveSession(
        sql,
        tenantB,
        hashSessionToken(oldSessionB),
        new Date()
      )
    ).toBeNull();
  });

  test("#1035 L1: re-stamping the caller's session resurrects no other session of the same identity", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    const principalId = await principalOf(user.identityId);
    const mine = await mintSession(tenantId, user.identityId, "local");
    const thiefs = await mintSession(tenantId, user.identityId, "local");

    // The credential changes: both sessions are now behind the new epoch.
    await setPrincipalCredential(
      sql,
      principalId,
      await hashPassword(NEW_PASSWORD)
    );
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
    await restampOwnSessionAfterCredentialChange(
      sql,
      tenantId,
      user.identityId,
      hashSessionToken(mine)
    );

    expect(
      await resolveActiveSession(
        sql,
        tenantId,
        hashSessionToken(mine),
        new Date()
      )
    ).not.toBeNull();
    expect(
      await resolveActiveSession(
        sql,
        tenantId,
        hashSessionToken(thiefs),
        new Date()
      )
    ).toBeNull();
  });

  test("F7: login -> MFA -> stale step-up blocks admin action -> step-up -> action succeeds", async () => {
    const tenantId = await createTenant();
    const admin = await seedUser(tenantId);
    const secret = generateTotpSecret();
    await seedActiveFactor(admin.identityId, secret);
    await grantPermission(tenantId, admin.tenantUserId, "mfa_admin", "reset");
    // Seed a recovery code for step-up (not timestep-bound, avoids collision).
    const adminPrincipal = await principalOf(admin.identityId);
    const factorRows = (await sql`
      SELECT id FROM awcms_principal_mfa_factors
      WHERE principal_id = ${adminPrincipal}
    `) as { id: string }[];
    await sql`
      INSERT INTO awcms_principal_mfa_recovery_codes (principal_id, factor_id, code_hash)
      VALUES (${adminPrincipal}, ${factorRows[0]!.id}, ${hashRecoveryCode("RECOVERY1")})
    `;

    // A target user with MFA to be reset.
    const target = await seedUser(tenantId);
    await seedActiveFactor(target.identityId, generateTotpSecret());

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
      SELECT status, disabled_by_tenant_id FROM awcms_principal_mfa_factors
      WHERE principal_id = ${await principalOf(target.identityId)}
    `) as { status: string; disabled_by_tenant_id: string | null }[];
    expect(status[0]!.status).toBe("disabled");
    expect(status[0]!.disabled_by_tenant_id).toBe(tenantId);

    // ADR-0087's disclosure, asserted through the ROUTE rather than the module:
    // the reach must be recorded, and the audit row is where it is recorded. The
    // ADR makes that a condition of the reach being permitted at all, so a route
    // that dropped the attribute would be a route doing something it is not
    // allowed to do — invisibly, since the reset itself would still work.
    const audit = (await sql`
      SELECT attributes FROM awcms_audit_events
      WHERE tenant_id = ${tenantId} AND action = 'mfa_admin_reset'
    `) as { attributes: Record<string, unknown> }[];
    expect(audit).toHaveLength(1);
    expect(audit[0]!.attributes.crossTenantReach).toBe(true);
    expect(audit[0]!.attributes.hadFactor).toBe(true);
    // What it must NOT carry: the tenants reached. That list is a cross-tenant
    // membership oracle, and the ADR refuses to build it.
    expect(JSON.stringify(audit[0]!.attributes)).not.toContain("reachedTenant");
  });

  test("F9: MFA enrollment is not an enumeration oracle (wrong password vs unknown identifier are identical)", async () => {
    const tenantId = await createTenant();
    const user = await seedUser(tenantId);
    await seedActiveFactor(user.identityId, generateTotpSecret());

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
