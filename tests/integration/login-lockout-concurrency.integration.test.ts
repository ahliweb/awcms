/**
 * The login lockout counter, under concurrency (Issue #483).
 *
 * ## Why this file has to exist at all
 *
 * Every lockout test in this repo before it was a DOMAIN test:
 * `tests/login-policy.test.ts` and `tests/login-env-parsing.test.ts` call
 * `evaluateLoginAttempt` directly and assert what it returns. Not one raised
 * `awcms_identities.failed_login_count` through the real route. So the suite was
 * green over a counter that two concurrent requests could hold at one — the
 * pure function was always right, and the route threw its answer away by
 * writing an absolute value computed from a separately-read row.
 *
 * That is the shape this file is built around: the assertion is about what
 * PostgreSQL ends up holding after K requests that OVERLAP, which is the one
 * thing no pure test can see.
 *
 * WORLD 2 (see harness.ts) — real handlers resolve `getDatabaseClient()`
 * internally, so this runs against the migrated `DATABASE_URL` database and
 * seeds/reads through a superuser connection to that same database.
 *
 * Skipped unless `DATABASE_URL` is set and carries the migrated schema.
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
  createCookieJar,
  ensureHandlerDatabaseReady,
  getHandlerAdminSql,
  integrationEnabled,
  invoke,
  resetHandlerDatabase,
  teardownHandlerDatabase
} from "./harness";
import { POST as setupInitialize } from "../../src/pages/api/v1/setup/initialize";
import { POST as authLogin } from "../../src/pages/api/v1/auth/login";

const OWNER_PASSWORD = "integration-test-owner-password";
const WRONG_PASSWORD = "not-the-owner-password";
const LOGIN_IDENTIFIER = "owner@example.com";

/**
 * The default (`AUTH_LOGIN_MAX_ATTEMPTS`). Four parallel failures is one below
 * it ON PURPOSE: the concurrency claim is then tested without the lock firing
 * and short-circuiting anything, so a failure here can only mean lost updates.
 */
const MAX_FAILED_ATTEMPTS = 5;
const PARALLEL_ATTEMPTS = 4;

let ready = false;
const suite = integrationEnabled ? describe : describe.skip;

async function bootstrapTenant(): Promise<string> {
  const setup = await invoke<{ data: { tenantId: string } }>(setupInitialize, {
    method: "POST",
    path: "/api/v1/setup/initialize",
    headers: { "content-type": "application/json" },
    body: {
      tenantName: "Acme",
      tenantCode: "acme",
      officeCode: "hq",
      officeName: "HQ",
      ownerLoginIdentifier: LOGIN_IDENTIFIER,
      ownerPassword: OWNER_PASSWORD,
      ownerDisplayName: "Owner"
    }
  });

  expect(setup.status).toBe(200);

  return setup.body.data.tenantId;
}

function failedLogin(tenantId: string) {
  return invoke(authLogin, {
    method: "POST",
    path: "/api/v1/auth/login",
    headers: {
      "content-type": "application/json",
      "x-awcms-tenant-id": tenantId
    },
    body: { loginIdentifier: LOGIN_IDENTIFIER, password: WRONG_PASSWORD },
    cookies: createCookieJar()
  });
}

async function readLockoutRow(
  tenantId: string
): Promise<{ failed_login_count: number; locked_until: Date | null }> {
  const rows = (await getHandlerAdminSql()`
    SELECT failed_login_count, locked_until
    FROM awcms_identities
    WHERE tenant_id = ${tenantId} AND login_identifier = ${LOGIN_IDENTIFIER}
  `) as { failed_login_count: number; locked_until: Date | null }[];

  expect(rows).toHaveLength(1);

  return rows[0]!;
}

suite("login lockout counts every failure, including concurrent ones", () => {
  beforeAll(async () => {
    ready = await ensureHandlerDatabaseReady();
  });

  beforeEach(async () => {
    if (!ready) return;
    await resetHandlerDatabase();
  });

  afterAll(async () => {
    if (!integrationEnabled) return;
    await teardownHandlerDatabase();
  });

  test("K failures fired in PARALLEL leave the counter at K", async () => {
    if (!ready) return;

    const tenantId = await bootstrapTenant();

    // Fired together, not awaited one at a time. Under the read-modify-write
    // this replaced, they all read the same value and all wrote the same
    // value+1 — K attempts for the price of one, and the account never locks
    // as long as the attacker keeps them overlapping.
    const responses = await Promise.all(
      Array.from({ length: PARALLEL_ATTEMPTS }, () => failedLogin(tenantId))
    );

    for (const response of responses) {
      expect(response.status).toBe(401);
    }

    const row = await readLockoutRow(tenantId);

    expect(row.failed_login_count).toBe(PARALLEL_ATTEMPTS);
    // One below the cap, so nothing should be locked yet — this is what makes
    // the count above unambiguous rather than a side effect of a lock.
    expect(row.locked_until).toBeNull();
  });

  test("the failure that reaches the cap sets locked_until, and the next login is refused", async () => {
    if (!ready) return;

    const tenantId = await bootstrapTenant();

    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      expect((await failedLogin(tenantId)).status).toBe(401);
    }

    const row = await readLockoutRow(tenantId);

    expect(row.failed_login_count).toBe(MAX_FAILED_ATTEMPTS);
    expect(row.locked_until).toBeInstanceOf(Date);

    // And the lock is real: the CORRECT password is now refused too. Without
    // this, a `locked_until` column could be set and ignored.
    const correct = await invoke(authLogin, {
      method: "POST",
      path: "/api/v1/auth/login",
      headers: {
        "content-type": "application/json",
        "x-awcms-tenant-id": tenantId
      },
      body: { loginIdentifier: LOGIN_IDENTIFIER, password: OWNER_PASSWORD },
      cookies: createCookieJar()
    });

    expect(correct.status).toBe(401);
  });

  test("a successful login clears the counter it had been accumulating", async () => {
    if (!ready) return;

    const tenantId = await bootstrapTenant();

    await Promise.all(
      Array.from({ length: PARALLEL_ATTEMPTS }, () => failedLogin(tenantId))
    );
    expect((await readLockoutRow(tenantId)).failed_login_count).toBe(
      PARALLEL_ATTEMPTS
    );

    const success = await invoke(authLogin, {
      method: "POST",
      path: "/api/v1/auth/login",
      headers: {
        "content-type": "application/json",
        "x-awcms-tenant-id": tenantId
      },
      body: { loginIdentifier: LOGIN_IDENTIFIER, password: OWNER_PASSWORD },
      cookies: createCookieJar()
    });

    expect(success.status).toBe(200);
    // The reset is what makes "keep counting past the lock" safe here, and it
    // is the one behaviour that differs from `mfa.ts` (which zeroes its counter
    // AT the lock instead).
    expect((await readLockoutRow(tenantId)).failed_login_count).toBe(0);
  });
});
