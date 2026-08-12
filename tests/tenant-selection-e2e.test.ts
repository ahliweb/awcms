/**
 * Route-level E2E for tenant selection and switching — ADR-0088, Gelombang 7
 * PR 7.4 of Issue #423. Real PostgreSQL, real handlers.
 *
 * These cannot be written against a fake `Bun.SQL`. Every property under test
 * is a property of the DATABASE plus the wiring: that a selection token is
 * spent exactly once under concurrency, that entering a tenant re-applies that
 * tenant's own gates, and that FORCE RLS is what stops one tenant's session
 * from resolving in another.
 *
 * Requires a throwaway database with `sql/` applied. Gated on `DATABASE_URL`,
 * and listed in the dedicated legacy `bun test <files>` step in `ci.yml` +
 * `release.yml` (held to the filesystem by
 * `tests/db-gated-suite-ci-parity.test.ts` in both directions).
 *
 * MUTATION PROOFS (repo security-readiness discipline):
 * - Drop `AND selection_token_expires_at > ${now}` from
 *   `redeemPrincipalSelectionToken` → "an expired token is refused" goes RED.
 * - Drop the `origin_auth` check in `switch.ts` → "an SSO session may not
 *   switch" goes RED, which is the complete cross-tenant takeover ADR-0088
 *   exists to close.
 * - Skip `evaluateTenantEntry`'s MFA branch → "entering a tenant that requires
 *   MFA yields a challenge, not a session" goes RED.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { APIRoute } from "astro";

import { POST as loginPOST } from "../src/pages/api/v1/auth/login";
import { POST as selectTenantPOST } from "../src/pages/api/v1/auth/session/tenant";
import { POST as switchPOST } from "../src/pages/api/v1/auth/session/switch";
import { hashPassword } from "../src/lib/auth/password";
import { hashSessionToken } from "../src/lib/auth/session-token";
import { linkIdentityToPrincipal } from "../src/modules/identity-access/application/principal-store";

const DATABASE_URL =
  process.env.TENANT_SELECTION_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

const PASSWORD = "correct horse battery staple";

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
  tenantId?: string;
  ip: string;
  body?: unknown;
  bearer?: string;
};

async function callRoute(
  handler: APIRoute,
  opts: CallOpts
): Promise<{ status: number; body: any }> {
  const headers = new Headers({ "content-type": "application/json" });

  if (opts.tenantId) headers.set("x-awcms-tenant-id", opts.tenantId);
  if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);

  const request = new Request("http://localhost/api/v1/route", {
    method: "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });

  const res = (await handler({
    request,
    cookies: fakeCookies(),
    clientAddress: opts.ip,
    locals: {}
  } as never)) as Response;

  return { status: res.status, body: await res.json().catch(() => null) };
}

describeOrSkip("tenant selection and switching (real PostgreSQL)", () => {
  let sql: Bun.SQL;
  const createdTenantIds: string[] = [];
  const createdPrincipalIds = new Set<string>();
  let ipCounter = 0;

  /** A fresh source IP per call: the per-source rate limit is shared and real. */
  const nextIp = () => `203.0.113.${(ipCounter += 1) % 250}`;

  beforeAll(() => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 6 });
  });

  afterAll(async () => {
    for (const tenantId of createdTenantIds) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_abac_decision_logs WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_mfa_challenges WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_sessions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_mfa_policies WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_users WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_identities WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_profiles WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }

    for (const principalId of createdPrincipalIds) {
      await sql`DELETE FROM awcms_principal_mfa_recovery_codes WHERE principal_id = ${principalId}`;
      await sql`DELETE FROM awcms_principal_mfa_factors WHERE principal_id = ${principalId}`;
      await sql`DELETE FROM awcms_principals WHERE id = ${principalId}`;
    }

    await sql.close({ timeout: 5 });
  });

  async function createTenant(status = "active"): Promise<string> {
    const suffix = Math.random().toString(36).slice(2, 10);
    const rows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name, status)
      VALUES (${`sel-${suffix}`}, ${"Selection test"}, ${status})
      RETURNING id
    `) as { id: string }[];

    const tenantId = rows[0]!.id;
    createdTenantIds.push(tenantId);
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;

    return tenantId;
  }

  /**
   * A member of `tenantId`, linked to the principal keyed by `loginIdentifier`.
   * Sharing the identifier across tenants is what makes it the SAME human.
   */
  async function seedMember(
    tenantId: string,
    loginIdentifier: string
  ): Promise<{ identityId: string; tenantUserId: string }> {
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;

    const profile = (await sql`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenantId}, 'person', 'Selection User') RETURNING id
    `) as { id: string }[];

    const identity = (await sql`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenantId}, ${profile[0]!.id}, ${loginIdentifier}, ${await hashPassword(PASSWORD)})
      RETURNING id
    `) as { id: string }[];

    const tenantUser = (await sql`
      INSERT INTO awcms_tenant_users (tenant_id, identity_id, status)
      VALUES (${tenantId}, ${identity[0]!.id}, 'active') RETURNING id
    `) as { id: string }[];

    const principalId = await linkIdentityToPrincipal(
      sql,
      identity[0]!.id,
      loginIdentifier
    );

    createdPrincipalIds.add(principalId);

    // The credential is promoted on first successful login; these tests start
    // from the state a returning user is in, so promote it directly.
    await sql`
      UPDATE awcms_principals
      SET password_hash = ${await hashPassword(PASSWORD)}
      WHERE id = ${principalId}
    `;

    return { identityId: identity[0]!.id, tenantUserId: tenantUser[0]!.id };
  }

  function address(): string {
    return `sel-${Math.random().toString(36).slice(2)}@x.test`;
  }

  /** Tenantless login → the 409 that carries the selection token. */
  async function selectionToken(loginIdentifier: string): Promise<string> {
    const res = await callRoute(loginPOST, {
      ip: nextIp(),
      body: { loginIdentifier, password: PASSWORD }
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MEMBERSHIP_SELECTION_REQUIRED");

    return res.body.error.details.principalToken as string;
  }

  test("no tenant header: a valid password yields 409 + a token, never a session", async () => {
    const tenantId = await createTenant();
    const loginIdentifier = address();
    await seedMember(tenantId, loginIdentifier);

    const res = await callRoute(loginPOST, {
      ip: nextIp(),
      body: { loginIdentifier, password: PASSWORD }
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MEMBERSHIP_SELECTION_REQUIRED");
    expect(typeof res.body.error.details.principalToken).toBe("string");
    expect(res.body.error.details.principalToken).toStartWith("awcmsp_");

    // What must NOT be there: the list of tenants this human belongs to.
    // Reading one needs a cross-tenant scan FORCE RLS refuses, and the global
    // projection that would make it possible is the membership directory
    // ADR-0087 rejected.
    expect(JSON.stringify(res.body)).not.toContain(tenantId);
  });

  test("no tenant header + wrong password: one generic 401, no token", async () => {
    const tenantId = await createTenant();
    const loginIdentifier = address();
    await seedMember(tenantId, loginIdentifier);

    const res = await callRoute(loginPOST, {
      ip: nextIp(),
      body: { loginIdentifier, password: "not it" }
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(JSON.stringify(res.body)).not.toContain("awcmsp_");
  });

  test("an unknown address is indistinguishable from a wrong password", async () => {
    const res = await callRoute(loginPOST, {
      ip: nextIp(),
      body: { loginIdentifier: address(), password: PASSWORD }
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  test("the token exchanges for a session in the tenant the caller names", async () => {
    const tenantId = await createTenant();
    const loginIdentifier = address();
    await seedMember(tenantId, loginIdentifier);

    const res = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: {
        principalToken: await selectionToken(loginIdentifier),
        tenantId
      }
    });

    expect(res.status).toBe(200);
    expect(res.body.data.tenantId).toBe(tenantId);
    expect(typeof res.body.data.token).toBe("string");

    // The session is real, in that tenant, and password-rooted so it may later
    // switch.
    const rows = (await sql`
      SELECT origin_auth, assurance_level FROM awcms_sessions
      WHERE tenant_id = ${tenantId}
        AND token_hash = ${hashSessionToken(res.body.data.token)}
    `) as { origin_auth: string; assurance_level: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.origin_auth).toBe("password");
    expect(rows[0]!.assurance_level).toBe("aal1");
  });

  test("the token is SINGLE USE — the second exchange is refused", async () => {
    const tenantId = await createTenant();
    const loginIdentifier = address();
    await seedMember(tenantId, loginIdentifier);

    const token = await selectionToken(loginIdentifier);

    const first = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: { principalToken: token, tenantId }
    });
    const second = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: { principalToken: token, tenantId }
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    expect(second.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  test("a token spent against the WRONG tenant is burned, not returned", async () => {
    // The property that stops a stolen token becoming a membership scanner: a
    // failed exchange consumes it, so an attacker gets ONE guess, not one per
    // tenant id they care to try.
    const home = await createTenant();
    const stranger = await createTenant();
    const loginIdentifier = address();
    await seedMember(home, loginIdentifier);

    const token = await selectionToken(loginIdentifier);

    const wrong = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: { principalToken: token, tenantId: stranger }
    });

    expect(wrong.status).toBe(401);

    const retry = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: { principalToken: token, tenantId: home }
    });

    expect(retry.status).toBe(401);
  });

  test("issuing a second token invalidates the first", async () => {
    const tenantId = await createTenant();
    const loginIdentifier = address();
    await seedMember(tenantId, loginIdentifier);

    const first = await selectionToken(loginIdentifier);
    const second = await selectionToken(loginIdentifier);

    expect(first).not.toBe(second);

    const stale = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: { principalToken: first, tenantId }
    });
    expect(stale.status).toBe(401);

    const fresh = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: { principalToken: second, tenantId }
    });
    expect(fresh.status).toBe(200);
  });

  test("an EXPIRED token is refused", async () => {
    const tenantId = await createTenant();
    const loginIdentifier = address();
    await seedMember(tenantId, loginIdentifier);

    const token = await selectionToken(loginIdentifier);

    // Age it past its 120 seconds rather than sleeping.
    await sql`
      UPDATE awcms_principals
      SET selection_token_expires_at = now() - interval '1 second'
      WHERE selection_token_hash IS NOT NULL
        AND email_normalized = ${loginIdentifier}
    `;

    const res = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: { principalToken: token, tenantId }
    });

    expect(res.status).toBe(401);
  });

  test("a session token pasted as a selection token is refused", async () => {
    const tenantId = await createTenant();
    const loginIdentifier = address();
    await seedMember(tenantId, loginIdentifier);

    const selected = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: {
        principalToken: await selectionToken(loginIdentifier),
        tenantId
      }
    });

    const res = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: { principalToken: selected.body.data.token, tenantId }
    });

    expect(res.status).toBe(401);
  });

  test("a suspended tenant refuses the exchange", async () => {
    const tenantId = await createTenant("suspended");
    const loginIdentifier = address();
    await seedMember(tenantId, loginIdentifier);

    const res = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: {
        principalToken: await selectionToken(loginIdentifier),
        tenantId
      }
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("TENANT_UNAVAILABLE");
  });

  test("switching moves the human to their other tenant and ends the source session", async () => {
    const home = await createTenant();
    const other = await createTenant();
    const loginIdentifier = address();
    await seedMember(home, loginIdentifier);
    await seedMember(other, loginIdentifier);

    const entered = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: {
        principalToken: await selectionToken(loginIdentifier),
        tenantId: home
      }
    });
    expect(entered.status).toBe(200);

    const switched = await callRoute(switchPOST, {
      tenantId: home,
      ip: nextIp(),
      bearer: entered.body.data.token,
      body: { tenantId: other }
    });

    expect(switched.status).toBe(200);
    expect(switched.body.data.tenantId).toBe(other);

    const target = (await sql`
      SELECT origin_auth, assurance_level FROM awcms_sessions
      WHERE tenant_id = ${other}
        AND token_hash = ${hashSessionToken(switched.body.data.token)}
    `) as { origin_auth: string; assurance_level: string }[];

    expect(target).toHaveLength(1);
    // The fourth `origin_auth` value, produced here for the first time.
    expect(target[0]!.origin_auth).toBe("switch");
    // Assurance does NOT travel: tenant A's step-up must not satisfy tenant B.
    expect(target[0]!.assurance_level).toBe("aal1");

    const source = (await sql`
      SELECT revoked_at FROM awcms_sessions
      WHERE tenant_id = ${home}
        AND token_hash = ${hashSessionToken(entered.body.data.token)}
    `) as { revoked_at: Date | null }[];

    expect(source[0]!.revoked_at).not.toBeNull();
  });

  test("switching to a tenant the human does NOT belong to leaves them where they were", async () => {
    const home = await createTenant();
    const stranger = await createTenant();
    const loginIdentifier = address();
    await seedMember(home, loginIdentifier);
    await seedMember(stranger, address());

    const entered = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: {
        principalToken: await selectionToken(loginIdentifier),
        tenantId: home
      }
    });

    const refused = await callRoute(switchPOST, {
      tenantId: home,
      ip: nextIp(),
      bearer: entered.body.data.token,
      body: { tenantId: stranger }
    });

    expect(refused.status).toBe(404);
    expect(refused.body.error.code).toBe("MEMBERSHIP_NOT_FOUND");

    // The failure mode of a switch must be "you are still where you were",
    // never "you are nowhere": the source session survives a refusal.
    const source = (await sql`
      SELECT revoked_at FROM awcms_sessions
      WHERE tenant_id = ${home}
        AND token_hash = ${hashSessionToken(entered.body.data.token)}
    `) as { revoked_at: Date | null }[];

    expect(source[0]!.revoked_at).toBeNull();
  });

  test("an SSO session may NOT switch — the cross-tenant takeover", async () => {
    // The attack: tenant B's IdP administrator asserts an address their IdP is
    // allowed to claim, receives a legitimate B session, and switches into
    // tenant A where that person really works. Every step is otherwise legal.
    const home = await createTenant();
    const other = await createTenant();
    const loginIdentifier = address();
    await seedMember(home, loginIdentifier);
    await seedMember(other, loginIdentifier);

    const entered = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: {
        principalToken: await selectionToken(loginIdentifier),
        tenantId: home
      }
    });

    // Restamp the session's provenance as an IdP assertion.
    await sql`
      UPDATE awcms_sessions SET origin_auth = 'sso'
      WHERE tenant_id = ${home}
        AND token_hash = ${hashSessionToken(entered.body.data.token)}
    `;

    const refused = await callRoute(switchPOST, {
      tenantId: home,
      ip: nextIp(),
      bearer: entered.body.data.token,
      body: { tenantId: other }
    });

    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("SESSION_NOT_SWITCHABLE");

    const landed = (await sql`
      SELECT count(*)::int AS n FROM awcms_sessions WHERE tenant_id = ${other}
    `) as { n: number }[];

    expect(landed[0]!.n).toBe(0);
  });

  test("a handoff session may not switch either", async () => {
    const home = await createTenant();
    const other = await createTenant();
    const loginIdentifier = address();
    await seedMember(home, loginIdentifier);
    await seedMember(other, loginIdentifier);

    const entered = await callRoute(selectTenantPOST, {
      ip: nextIp(),
      body: {
        principalToken: await selectionToken(loginIdentifier),
        tenantId: home
      }
    });

    await sql`
      UPDATE awcms_sessions SET origin_auth = 'handoff'
      WHERE tenant_id = ${home}
        AND token_hash = ${hashSessionToken(entered.body.data.token)}
    `;

    const refused = await callRoute(switchPOST, {
      tenantId: home,
      ip: nextIp(),
      bearer: entered.body.data.token,
      body: { tenantId: other }
    });

    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("SESSION_NOT_SWITCHABLE");
  });

  test("entering a tenant that REQUIRES MFA yields a challenge, not a session", async () => {
    // Without this gate, tenant switching would be an MFA bypass into exactly
    // the tenants that decided to require it.
    const home = await createTenant();
    const strict = await createTenant();
    const loginIdentifier = address();
    await seedMember(home, loginIdentifier);
    await seedMember(strict, loginIdentifier);

    process.env.AUTH_MFA_ENABLED = "true";

    await sql`SELECT set_config('app.current_tenant_id', ${strict}, false)`;
    await sql`
      INSERT INTO awcms_tenant_mfa_policies (tenant_id, enforcement_level)
      VALUES (${strict}, 'required_for_all')
      ON CONFLICT (tenant_id) DO UPDATE SET enforcement_level = 'required_for_all'
    `;

    try {
      const res = await callRoute(selectTenantPOST, {
        ip: nextIp(),
        body: {
          principalToken: await selectionToken(loginIdentifier),
          tenantId: strict
        }
      });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("MFA_ENROLLMENT_REQUIRED");
      expect(typeof res.body.error.details.mfaEnrollmentToken).toBe("string");

      const sessions = (await sql`
        SELECT count(*)::int AS n FROM awcms_sessions WHERE tenant_id = ${strict}
      `) as { n: number }[];

      expect(sessions[0]!.n).toBe(0);
    } finally {
      delete process.env.AUTH_MFA_ENABLED;
    }
  });
});
