/**
 * Finding A2 of the 17 August 2026 audit round — ADR-0073 suspension now reaches
 * the self-service and client-credential route factories.
 *
 * The chokepoint refused a suspended tenant, and `ssr-session.ts` refused one an
 * admin screen. Neither is on the path of `defineSelfServiceTenantRoute` or
 * `defineClientCredentialTenantRoute`, so a suspended tenant's LIVE session
 * could still write its profile, rewrite its credential, and — through the
 * handoff pair — mint NEW sessions for as long as it liked. The foothold
 * outlived the TTL suspension exists to drain.
 *
 * ## Why this needs a real database rather than a mock
 *
 * The refusal reads `awcms_tenants.status` inside the route's own transaction.
 * A mocked `Bun.SQL` would return whatever the test told it to, which is the
 * same thing as asserting the code the test just read. The two failure
 * directions that matter here — a suspended tenant still being served, and an
 * ACTIVE tenant being refused by an over-eager gate — are both invisible to it.
 *
 * MUTATION PROOFS:
 * - Delete the `refuseIfTenantSuspended` call from the self-service factory →
 *   "a suspended tenant cannot rewrite its profile" goes RED.
 * - Make `allowedWhileTenantSuspended` default to allowing (drop the `if` and
 *   always return `undefined`) → the same test goes RED.
 * - Remove `allowedWhileTenantSuspended` from `sessions/index.ts` → "a suspended
 *   tenant can still see and end its own sessions" goes RED, which is the
 *   over-eager direction a fail-closed default makes easy to ship.
 *
 * WORLD 2 (harness.ts) — real route handlers reach for `getDatabaseClient()`
 * internally, so this runs against the migrated `DATABASE_URL` database.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import {
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { PATCH as profilePATCH } from "../../src/pages/api/v1/auth/profile";
import { GET as sessionsGET } from "../../src/pages/api/v1/auth/sessions/index";
import { POST as revokeAllPOST } from "../../src/pages/api/v1/auth/sessions/revoke-all";
import { POST as handoffIssuePOST } from "../../src/pages/api/v1/auth/session-handoff/issue";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";

const TENANT = "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2";
const PROFILE = "a2a2a2a2-0000-4a2a-8a2a-a2a2a2a2a201";
const IDENTITY = "a2a2a2a2-0000-4a2a-8a2a-a2a2a2a2a202";
const TENANT_USER = "a2a2a2a2-0000-4a2a-8a2a-a2a2a2a2a203";

let handlerReady = false;
let sessionToken = "";

async function seed(): Promise<void> {
  const sql = getHandlerAdminSql();

  await sql`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'a2-suspend', 'Suspension A2', 'active')
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name)
    VALUES (${PROFILE}, ${TENANT}, 'person', 'A2 Person')
  `;

  await sql`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${IDENTITY}, ${TENANT}, ${PROFILE}, 'a2@example.test',
            'not-a-real-hash', 'active')
  `;

  await sql`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${TENANT_USER}, ${TENANT}, ${IDENTITY}, 'active')
  `;

  sessionToken = generateSessionToken();

  await sql`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${IDENTITY}, ${hashSessionToken(sessionToken)},
            now() + interval '1 hour')
  `;
}

async function setTenantStatus(status: string): Promise<void> {
  await getHandlerAdminSql()`
    UPDATE awcms_tenants SET status = ${status} WHERE id = ${TENANT}
  `;
}

function authHeaders(): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-awcms-tenant-id": TENANT,
    authorization: `Bearer ${sessionToken}`
  };
}

const describeOrSkip = integrationEnabled ? describe : describe.skip;

describeOrSkip("ADR-0073 reaches the factories that have no chokepoint", () => {
  beforeAll(async () => {
    handlerReady = await ensureHandlerDatabaseReady();
  });

  afterAll(async () => {
    if (handlerReady) await teardownHandlerDatabase();
  });

  beforeEach(async () => {
    if (!handlerReady) return;
    await resetHandlerDatabase();
    await seed();
  });

  afterEach(async () => {
    if (handlerReady) await resetHandlerDatabase();
  });

  test("an ACTIVE tenant is served — the gate is not simply refusing everything", async () => {
    if (!handlerReady) return;
    // NON-VACUOUS. Without this, every assertion below would also pass against
    // a factory that refused unconditionally, which is the failure direction a
    // fail-closed default makes easiest to ship.
    const res = await invoke(profilePATCH, {
      method: "PATCH",
      path: "/api/v1/auth/profile",
      headers: authHeaders(),
      body: { displayName: "Renamed While Active" }
    });

    expect(res.status).not.toBe(403);
  });

  test("a suspended tenant cannot rewrite its profile", async () => {
    if (!handlerReady) return;
    await setTenantStatus("suspended");

    const res = await invoke<{ error: { code: string } }>(profilePATCH, {
      method: "PATCH",
      path: "/api/v1/auth/profile",
      headers: authHeaders(),
      body: { displayName: "Renamed While Suspended" }
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("TENANT_SUSPENDED");

    // And the write really did not happen. A 403 returned from INSIDE
    // `withTenant` is a COMMIT, not a rollback, so "it answered 403" and "it
    // changed nothing" are different claims in this codebase.
    const rows = (await getHandlerAdminSql()`
      SELECT display_name FROM awcms_profiles WHERE id = ${PROFILE}
    `) as { display_name: string }[];

    expect(rows[0]!.display_name).toBe("A2 Person");
  });

  test("a suspended tenant cannot mint a new session through the handoff", async () => {
    if (!handlerReady) return;
    // The loop this finding is really about: a session that would have expired
    // renews itself indefinitely, so suspension never drains anything.
    await setTenantStatus("suspended");

    const res = await invoke<{ error: { code: string } }>(handoffIssuePOST, {
      method: "POST",
      path: "/api/v1/auth/session-handoff/issue",
      headers: authHeaders(),
      body: { clientKey: "bff", redirectUri: "https://example.test/cb" }
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("TENANT_SUSPENDED");
  });

  test("`inactive` stops service too, not only `suspended`", async () => {
    if (!handlerReady) return;
    await setTenantStatus("inactive");

    const res = await invoke<{ error: { code: string } }>(profilePATCH, {
      method: "PATCH",
      path: "/api/v1/auth/profile",
      headers: authHeaders(),
      body: { displayName: "Renamed While Inactive" }
    });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("TENANT_SUSPENDED");
  });

  test("a suspended tenant can still SEE and END its own sessions", async () => {
    if (!handlerReady) return;
    await setTenantStatus("suspended");

    const listed = await invoke(sessionsGET, {
      method: "GET",
      path: "/api/v1/auth/sessions",
      headers: authHeaders()
    });

    expect(listed.status).toBe(200);

    // Sign-out only ever removes access. A suspension that protects a stolen
    // session is the opposite of what suspension is for.
    const revoked = await invoke(revokeAllPOST, {
      method: "POST",
      path: "/api/v1/auth/sessions/revoke-all",
      headers: authHeaders(),
      body: {}
    });

    expect(revoked.status).toBe(200);
  });
});
