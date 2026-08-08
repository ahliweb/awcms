/**
 * Self-registration against a real database with real migrations and real RLS
 * (Wave 2 delta auth), under the harness's non-superuser world.
 *
 * The properties that only a database can prove:
 *
 * - the public submit path is enumeration-safe in its EFFECT, not just its
 *   wording — a taken address and a duplicate request leave the table exactly
 *   as they found it;
 * - approval materializes profile + identity + tenant_user exactly once, even
 *   when two reviewers race the same row;
 * - the created account cannot be signed into with anything, and is claimed
 *   through the ordinary password-reset link;
 * - rejection creates nothing;
 * - one tenant's queue is invisible to another.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test
} from "bun:test";

import { verifyPassword } from "../../src/lib/auth/password";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import type {
  AuthNotificationPort,
  AuthNotificationRequest
} from "../../src/modules/_shared/ports/auth-notification-port";
import {
  approveRegistrationRequest,
  listPendingRegistrations,
  rejectRegistrationRequest,
  submitRegistrationRequest
} from "../../src/modules/identity-access/application/self-registration";
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
const REVIEWER = "33333333-3333-3333-3333-333333333333";
const APPLICANT = "ada@example.com";
const NOW = new Date("2026-07-26T12:00:00.000Z");

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

/** A reviewer row, so `reviewed_by_tenant_user_id`'s FK is satisfiable. */
async function seedReviewer(tenantId: string): Promise<void> {
  const admin = getAdminSql();
  const profileId = crypto.randomUUID();
  const identityId = crypto.randomUUID();

  await admin`
    INSERT INTO awcms_profiles (id, tenant_id, profile_type, display_name, status)
    VALUES (${profileId}, ${tenantId}, 'person', 'Reviewer', 'active')
  `;
  await admin`
    INSERT INTO awcms_identities
      (id, tenant_id, profile_id, login_identifier, password_hash, status)
    VALUES (${identityId}, ${tenantId}, ${profileId}, ${`reviewer-${tenantId}@example.com`}, 'x', 'active')
  `;
  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id, status)
    VALUES (${REVIEWER}, ${tenantId}, ${identityId}, 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

function submit(
  tenantId: string,
  loginIdentifier = APPLICANT,
  displayName = "Ada Lovelace"
) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    submitRegistrationRequest(tx, tenantId, { loginIdentifier, displayName })
  );
}

function approve(
  tenantId: string,
  requestId: string,
  sent: Sent,
  roleIds: string[] = [],
  enqueued = true
) {
  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    approveRegistrationRequest(tx, tenantId, requestId, REVIEWER, NOW, {
      roleIds,
      notifications: stubPort(sent, enqueued),
      resetUrlBase: "https://awcms.test/reset-password",
      tokenTtlMinutes: 30
    })
  );
}

/**
 * A role row, seeded through the ADMIN channel so `is_system` can be set
 * directly — `role-admin.ts#createRole` hardcodes `false`, which is precisely
 * why the only system role a tenant ever has is the one
 * `platform-bootstrap.ts` seeds.
 */
async function seedRole(
  tenantId: string,
  roleCode: string,
  isSystem: boolean
): Promise<string> {
  const rows = (await getAdminSql()`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
    VALUES (${tenantId}, ${roleCode}, ${roleCode}, ${isSystem})
    RETURNING id
  `) as { id: string }[];

  return rows[0]!.id;
}

async function assignmentCount(tenantId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_access_assignments
    WHERE tenant_id = ${tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

async function rowCount(tenantId: string): Promise<number> {
  const rows = (await getAdminSql()`
    SELECT count(*)::int AS n FROM awcms_registration_requests WHERE tenant_id = ${tenantId}
  `) as { n: number }[];

  return rows[0]!.n;
}

suite("self-registration integration (Wave 2 delta auth)", () => {
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
    await seedReviewer(TENANT_A);
  }, 30000);

  test("records a pending request and nothing else", async () => {
    const result = await submit(TENANT_A);

    expect(result.outcome).toBe("created");
    expect(result.requestId).toBeDefined();

    // No account exists yet — this is the property the whole design rests on.
    const identities = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_identities
      WHERE tenant_id = ${TENANT_A} AND login_identifier = ${APPLICANT}
    `) as { n: number }[];
    expect(identities[0]!.n).toBe(0);
  });

  test("a second submit while one is pending changes nothing", async () => {
    await submit(TENANT_A);
    const second = await submit(TENANT_A);

    expect(second.outcome).toBe("duplicate_pending");
    expect(second.requestId).toBeUndefined();
    expect(await rowCount(TENANT_A)).toBe(1);
  });

  test("an address that already has an account is refused, silently", async () => {
    const sent: Sent = [];
    const first = await submit(TENANT_A);
    await approve(TENANT_A, first.requestId!, sent);

    const second = await submit(TENANT_A);

    expect(second.outcome).toBe("identifier_taken");
    // Still exactly the one (now approved) row — no second request was written.
    expect(await rowCount(TENANT_A)).toBe(1);
  });

  test("the queue masks the address", async () => {
    await submit(TENANT_A);

    const queue = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      listPendingRegistrations(tx, TENANT_A)
    );

    expect(queue).toHaveLength(1);
    expect(queue[0]!.displayName).toBe("Ada Lovelace");
    expect(queue[0]!.loginIdentifierMasked).not.toBe(APPLICANT);
    expect(queue[0]!.loginIdentifierMasked).toContain("@example.com");
  });

  test("approval creates an active account that cannot be signed into yet", async () => {
    const sent: Sent = [];
    const request = await submit(TENANT_A);

    const result = await approve(TENANT_A, request.requestId!, sent);

    expect(result.outcome).toBe("approved");
    expect(result.outcome === "approved" && result.delivery).toBe("queued");

    const rows = (await getAdminSql()`
      SELECT i.password_hash, i.status AS identity_status, tu.status AS membership_status
      FROM awcms_identities i
      JOIN awcms_tenant_users tu ON tu.identity_id = i.id
      WHERE i.tenant_id = ${TENANT_A} AND i.login_identifier = ${APPLICANT}
    `) as {
      password_hash: string;
      identity_status: string;
      membership_status: string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.identity_status).toBe("active");
    expect(rows[0]!.membership_status).toBe("active");

    // The credential is unusable by construction — nothing the applicant
    // submitted, and nothing a shared placeholder either.
    for (const guess of ["", "password", "hunter2", APPLICANT]) {
      expect(await verifyPassword(guess, rows[0]!.password_hash)).toBe(false);
    }

    // The way in is the emailed reset link, issued in the same transaction.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.templateKey).toBe("auth.password_reset");
    expect(sent[0]!.variables.resetUrl).toContain(
      "https://awcms.test/reset-password"
    );

    const tokens = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_password_reset_tokens WHERE tenant_id = ${TENANT_A}
    `) as { n: number }[];
    expect(tokens[0]!.n).toBe(1);
  });

  test("approval reports delivery it could not make", async () => {
    // The account exists but nobody can claim it. The admin screen shows this;
    // a silent "approved" would be a lie about a usable account.
    const sent: Sent = [];
    const request = await submit(TENANT_A);

    const result = await approve(TENANT_A, request.requestId!, sent, [], false);

    expect(result.outcome === "approved" && result.delivery).toBe(
      "unavailable"
    );
  });

  test("two reviewers approving the same row produce exactly one account", async () => {
    const request = await submit(TENANT_A);
    const sentA: Sent = [];
    const sentB: Sent = [];

    const [first, second] = await Promise.all([
      approve(TENANT_A, request.requestId!, sentA),
      approve(TENANT_A, request.requestId!, sentB)
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(["approved", "not_found"]);

    const identities = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_identities
      WHERE tenant_id = ${TENANT_A} AND login_identifier = ${APPLICANT}
    `) as { n: number }[];
    expect(identities[0]!.n).toBe(1);
  });

  test("an unknown role is refused wholesale, creating nothing", async () => {
    const sent: Sent = [];
    const request = await submit(TENANT_A);

    const result = await approve(TENANT_A, request.requestId!, sent, [
      "44444444-4444-4444-4444-444444444444"
    ]);

    expect(result.outcome).toBe("unknown_role");

    const identities = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_identities
      WHERE tenant_id = ${TENANT_A} AND login_identifier = ${APPLICANT}
    `) as { n: number }[];
    expect(identities[0]!.n).toBe(0);
    expect(sent).toEqual([]);
  });

  test("a system role is refused, and the approval writes nothing at all", async () => {
    // The original defect: `approveRegistrationRequest` validated `roleIds`
    // with `deleted_at IS NULL` alone, so a principal holding only
    // `registration_requests.{read,approve}` could approve with
    // `roleIds: [<owner>]` and mint an account carrying the tenant's ENTIRE
    // permission catalogue — the one thing that permission was separated from
    // `access_control.assign` in order not to do. Drop `is_system` from the
    // filter in `self-registration.ts` and this test fails on the first
    // assertion, with an `awcms_access_assignments` row to prove it.
    const sent: Sent = [];
    const roleId = await seedRole(TENANT_A, "owner", true);
    const request = await submit(TENANT_A);

    const result = await approve(TENANT_A, request.requestId!, sent, [roleId]);

    expect(result.outcome).toBe("system_role");
    expect(result.outcome === "system_role" && result.roleCodes).toEqual([
      "owner"
    ]);

    // Refused BEFORE any write — this function returns from inside the tenant
    // transaction, and a returned 4xx COMMITs, so "no rows" is the assertion
    // that matters rather than "rolled back".
    expect(await assignmentCount(TENANT_A)).toBe(0);

    const identities = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_identities
      WHERE tenant_id = ${TENANT_A} AND login_identifier = ${APPLICANT}
    `) as { n: number }[];
    expect(identities[0]!.n).toBe(0);
    expect(sent).toEqual([]);

    // Still claimable: a refused approval must leave the request reviewable.
    const rows = (await getAdminSql()`
      SELECT status FROM awcms_registration_requests
      WHERE tenant_id = ${TENANT_A} AND id = ${request.requestId!}
    `) as { status: string }[];
    expect(rows[0]!.status).toBe("pending");
  });

  test("an ordinary role is still granted, and the result names it", async () => {
    // The other half of the same rule: refusing system roles must not turn
    // into refusing roles. Without this, `AND is_system = false` could be
    // written as a filter that drops every row and the suite above would still
    // be green.
    const sent: Sent = [];
    const roleId = await seedRole(TENANT_A, "editor", false);
    const request = await submit(TENANT_A);

    const result = await approve(TENANT_A, request.requestId!, sent, [roleId]);

    expect(result.outcome).toBe("approved");
    expect(result.outcome === "approved" && result.grantedRoleCodes).toEqual([
      "editor"
    ]);
    expect(await assignmentCount(TENANT_A)).toBe(1);
  });

  test("rejection creates nothing and closes the queue entry", async () => {
    const request = await submit(TENANT_A);

    const result = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      rejectRegistrationRequest(tx, TENANT_A, request.requestId!, REVIEWER, NOW)
    );

    expect(result.outcome).toBe("rejected");

    const identities = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_identities
      WHERE tenant_id = ${TENANT_A} AND login_identifier = ${APPLICANT}
    `) as { n: number }[];
    expect(identities[0]!.n).toBe(0);

    const queue = await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      listPendingRegistrations(tx, TENANT_A)
    );
    expect(queue).toEqual([]);
  });

  test("a rejected applicant can apply again", async () => {
    // The partial unique index covers PENDING rows only, and this is why.
    const first = await submit(TENANT_A);
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      rejectRegistrationRequest(tx, TENANT_A, first.requestId!, REVIEWER, NOW)
    );

    const second = await submit(TENANT_A);

    expect(second.outcome).toBe("created");
    expect(await rowCount(TENANT_A)).toBe(2);
  });

  test("approving an already-reviewed request is a no-op", async () => {
    const sent: Sent = [];
    const request = await submit(TENANT_A);
    await withTenantOrThrow(getRuntimeSql(), TENANT_A, (tx) =>
      rejectRegistrationRequest(tx, TENANT_A, request.requestId!, REVIEWER, NOW)
    );

    expect((await approve(TENANT_A, request.requestId!, sent)).outcome).toBe(
      "not_found"
    );
    expect(sent).toEqual([]);
  });

  test("one tenant's queue is invisible to another", async () => {
    const request = await submit(TENANT_A);
    const sent: Sent = [];

    expect(
      await withTenantOrThrow(getRuntimeSql(), TENANT_B, (tx) =>
        listPendingRegistrations(tx, TENANT_B)
      )
    ).toEqual([]);

    // RLS confines the lookup: tenant B cannot approve tenant A's applicant
    // even holding the id.
    expect((await approve(TENANT_B, request.requestId!, sent)).outcome).toBe(
      "not_found"
    );
  });

  test("an inactive tenant accepts nothing", async () => {
    await getAdminSql()`UPDATE awcms_tenants SET status = 'inactive' WHERE id = ${TENANT_A}`;

    expect((await submit(TENANT_A)).outcome).toBe("tenant_inactive");
    expect(await rowCount(TENANT_A)).toBe(0);
  });
});
