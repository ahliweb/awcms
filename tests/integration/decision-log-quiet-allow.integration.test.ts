/**
 * `authorizeInTransaction(..., { recordDecision: false })` may skip a repeated
 * ALLOW row and nothing else (#1363 audit, Low). A DENY is always logged, so a
 * quiet caller cannot hide a refusal from the decision ledger.
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
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import type { AccessRequest } from "../../src/modules/identity-access/domain/access-control";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";

const TENANT = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const GUARD: AccessRequest = {
  moduleKey: "blog_content",
  activityCode: "posts",
  action: "read"
};

let token = "";

async function seed(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'quiet-allow', 'Quiet Allow', 'active')
  `;
  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'nobody') RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'nobody@example.test', 'x') RETURNING id
  `) as { id: string }[];
  await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${identity[0]!.id})
  `;
  token = generateSessionToken();
  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '1 hour')
  `;
}

async function countRows(): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_abac_decision_logs
    WHERE tenant_id = ${TENANT}
  `) as { n: number }[];
  return rows[0]!.n;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("recordDecision: false never suppresses a deny", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seed();
  });

  test("a DENY with recordDecision:false is still logged", async () => {
    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      (tx) =>
        authorizeInTransaction(
          tx,
          TENANT,
          hashSessionToken(token),
          new Date(),
          GUARD,
          { recordDecision: false }
        ),
      { workClass: "interactive" }
    );

    expect(outcome.allowed).toBe(false);
    expect(await countRows()).toBe(1);
  });
});
