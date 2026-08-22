/**
 * The delegated-access expiry sweep, and the privilege model that lets a
 * scheduled job perform it — ADR-0090, `sql/142`, finding A1 of the 17 August
 * 2026 audit round.
 *
 * The GATE (`resolveDelegatedGrantState` carrying `expires_at > now()`) landed
 * first and is proven in `tests/partner-delegated-access-e2e.test.ts`. This file
 * is about the CLEANUP behind it, and about the three things only a real
 * database can answer:
 *
 * 1. **`awcms_worker` can run the sweep and cannot do anything else with those
 *    tables.** The whole reason `sql/142` is a `SECURITY DEFINER` function
 *    rather than three GRANTs is that `UPDATE awcms_tenant_users` also writes
 *    `status = 'active'` and `UPDATE awcms_sessions` also writes
 *    `revoked_at = NULL`. Asserting the refusal is asserting that the privilege
 *    was never handed over — a source test cannot see a GRANT.
 * 2. **The sweep and the HUMAN revocation reach the same end state.** They are
 *    two implementations on purpose (`revokeDelegatedAccess` names the person
 *    who revoked; expiry names nobody), and two implementations drift. This is
 *    the anchor that notices, instead of a comment asking the next author to
 *    remember.
 * 3. **It is idempotent and bounded.** A second pass finds nothing, and a batch
 *    size a caller invents is clamped rather than obeyed.
 *
 * MUTATION PROOFS — run, not assumed, and one of them says something the
 * obvious version of this list would have got wrong:
 *
 * - Drop `AND expires_at <= now()` from the selection → "a grant that has NOT
 *   run out is left alone" goes RED.
 * - Delete the session UPDATE → "the sweep ends the engagement" and "expiry and
 *   HUMAN revocation reach the same end state" both go RED.
 * - Grant `awcms_worker` UPDATE on `awcms_tenant_users` → "the worker holds no
 *   direct write on the membership tables" goes RED, which is the state this
 *   design exists to avoid.
 * - **Dropping EITHER `AND id = …` or `AND principal_kind = 'delegated'` from
 *   the membership UPDATE changes nothing here, and that is the correct
 *   result.** The two are independent guards over the same row — the id selects
 *   it, the kind refuses to touch anybody else — so an ordinary member is
 *   protected twice over and only losing BOTH exposes them (which it does, and
 *   loudly: six of seven go red). Written down because the first version of
 *   this list claimed a single-predicate proof it does not have, and a false
 *   mutation-proof is worse than none: it reads as coverage.
 *
 * WORLD 1 (harness.ts) — this drives application functions and role-scoped
 * connections, not route handlers.
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
  assertRejected,
  getAdminSql,
  getRuntimeSql,
  getWorkerRoleSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase,
  workerRoleActivated
} from "./harness";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  expireDelegatedAccessGrants,
  revokeDelegatedAccess
} from "../../src/modules/identity-access/application/delegated-access-store";

const TENANT = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const PARTNER_TENANT = "d2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2";

type Seeded = {
  grantId: string;
  delegatedTenantUserId: string;
  delegatedIdentityId: string;
  ordinaryTenantUserId: string;
};

/**
 * One expired, redeemed grant plus an ORDINARY member of the same tenant.
 *
 * The ordinary member is not decoration: the membership UPDATE is the statement
 * with the widest blast radius in `sql/142`, and "it only touched the delegated
 * one" is not assertable without somebody else in the table to leave alone.
 */
async function seed(options: { expired: boolean }): Promise<Seeded> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'expiry-cus', 'Expiry Customer', 'active'),
           (${PARTNER_TENANT}, 'expiry-prt', 'Expiry Partner', 'active')
  `;

  const makePerson = async (label: string) => {
    const profile = (await admin`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', ${label})
      RETURNING id
    `) as { id: string }[];

    const identity = (await admin`
      INSERT INTO awcms_identities
        (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${TENANT}, ${profile[0]!.id}, ${`${label}@example.test`}, 'x')
      RETURNING id
    `) as { id: string }[];

    return identity[0]!.id;
  };

  const delegatedIdentityId = await makePerson("delegated");
  const approverIdentityId = await makePerson("approver");
  const ordinaryIdentityId = await makePerson("ordinary");

  const delegatedUser = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id, principal_kind)
    VALUES (${TENANT}, ${delegatedIdentityId}, 'delegated')
    RETURNING id
  `) as { id: string }[];

  const approver = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${approverIdentityId})
    RETURNING id
  `) as { id: string }[];

  const ordinary = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${ordinaryIdentityId})
    RETURNING id
  `) as { id: string }[];

  const role = (await admin`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
    VALUES (${TENANT}, 'support', 'Support', false)
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_partners
      (tenant_id, partner_tenant_id, partner_code, display_name)
    VALUES (${TENANT}, ${PARTNER_TENANT}, 'expiry-p', 'Expiry Partner')
  `;

  await admin`
    INSERT INTO awcms_partner_managed_tenants
      (tenant_id, partner_tenant_id, engaged_by_tenant_user_id)
    VALUES (${TENANT}, ${PARTNER_TENANT}, ${approver[0]!.id})
  `;

  // `sql/117` constrains the PAIR (`expires_at > created_at`, and within 31
  // days), so an expired row has to be aged at both ends. That the database
  // refuses any other arrangement is itself the ceiling being enforced where it
  // cannot be forgotten.
  const grant = options.expired
    ? ((await admin`
        INSERT INTO awcms_delegated_access_grants
          (tenant_id, partner_tenant_id, role_id, approved_by_tenant_user_id,
           purpose, access_code_hash, granted_tenant_user_id, redeemed_at,
           created_at, expires_at)
        VALUES (${TENANT}, ${PARTNER_TENANT}, ${role[0]!.id}, ${approver[0]!.id},
                'incident 4711', NULL, ${delegatedUser[0]!.id},
                now() - interval '20 days',
                now() - interval '40 days', now() - interval '10 days')
        RETURNING id
      `) as { id: string }[])
    : ((await admin`
        INSERT INTO awcms_delegated_access_grants
          (tenant_id, partner_tenant_id, role_id, approved_by_tenant_user_id,
           purpose, access_code_hash, granted_tenant_user_id, redeemed_at,
           created_at, expires_at)
        VALUES (${TENANT}, ${PARTNER_TENANT}, ${role[0]!.id}, ${approver[0]!.id},
                'incident 4711', NULL, ${delegatedUser[0]!.id},
                now() - interval '30 minutes',
                now() - interval '1 hour', now() + interval '7 days')
        RETURNING id
      `) as { id: string }[]);

  // A live session for each person, so "it revoked the right one" is a claim
  // with two candidates.
  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${delegatedIdentityId}, 'hash-delegated', now() + interval '8 hours'),
           (${TENANT}, ${ordinaryIdentityId}, 'hash-ordinary', now() + interval '8 hours')
  `;

  return {
    grantId: grant[0]!.id,
    delegatedTenantUserId: delegatedUser[0]!.id,
    delegatedIdentityId,
    ordinaryTenantUserId: ordinary[0]!.id
  };
}

type EndState = {
  grantRevoked: boolean;
  revokeReason: string | null;
  delegatedStatus: string;
  ordinaryStatus: string;
  delegatedLiveSessions: number;
  ordinaryLiveSessions: number;
};

async function readEndState(seeded: Seeded): Promise<EndState> {
  const admin = getAdminSql();

  const rows = (await admin`
    SELECT
      (SELECT revoked_at IS NOT NULL FROM awcms_delegated_access_grants
        WHERE id = ${seeded.grantId}) AS grant_revoked,
      (SELECT revoke_reason FROM awcms_delegated_access_grants
        WHERE id = ${seeded.grantId}) AS revoke_reason,
      (SELECT status FROM awcms_tenant_users
        WHERE id = ${seeded.delegatedTenantUserId}) AS delegated_status,
      (SELECT status FROM awcms_tenant_users
        WHERE id = ${seeded.ordinaryTenantUserId}) AS ordinary_status,
      (SELECT count(*)::int FROM awcms_sessions
        WHERE tenant_id = ${TENANT} AND token_hash = 'hash-delegated'
          AND revoked_at IS NULL) AS delegated_live,
      (SELECT count(*)::int FROM awcms_sessions
        WHERE tenant_id = ${TENANT} AND token_hash = 'hash-ordinary'
          AND revoked_at IS NULL) AS ordinary_live
  `) as {
    grant_revoked: boolean;
    revoke_reason: string | null;
    delegated_status: string;
    ordinary_status: string;
    delegated_live: number;
    ordinary_live: number;
  }[];

  const row = rows[0]!;

  return {
    grantRevoked: row.grant_revoked,
    revokeReason: row.revoke_reason,
    delegatedStatus: row.delegated_status,
    ordinaryStatus: row.ordinary_status,
    delegatedLiveSessions: row.delegated_live,
    ordinaryLiveSessions: row.ordinary_live
  };
}

/**
 * The sweep, run the way it really runs: as `awcms_worker`.
 *
 * NOT through `getRuntimeSql()` (which is `awcms_app`), and the difference is
 * the design rather than a detail — `sql/142` grants EXECUTE to the worker
 * ALONE. The request path has its own revocation and never needs this one, so
 * handing `awcms_app` the sweep as well would widen a privilege for a caller
 * that does not exist. Running these through `awcms_app` fails `42501`, which
 * is the first thing this file proved.
 */
async function sweep(limit?: number): Promise<{ expired: number }> {
  return withTenantOrThrow(
    getWorkerRoleSql(),
    TENANT,
    (tx) =>
      limit === undefined
        ? expireDelegatedAccessGrants(tx, TENANT)
        : expireDelegatedAccessGrants(tx, TENANT, limit),
    { workClass: "maintenance" }
  );
}

const suite = integrationEnabled ? describe : describe.skip;

suite("delegated-access expiry sweep (sql/142)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  test("the sweep ends the engagement, and names no human", async () => {
    if (!workerRoleActivated) return;
    const seeded = await seed({ expired: true });

    const before = await readEndState(seeded);
    // NON-VACUOUS: without this the assertions below would also pass against a
    // fixture that had already been swept by an earlier test.
    expect(before.grantRevoked).toBe(false);
    expect(before.delegatedStatus).toBe("active");
    expect(before.delegatedLiveSessions).toBe(1);

    const result = await sweep();

    expect(result.expired).toBe(1);

    const after = await readEndState(seeded);
    expect(after.grantRevoked).toBe(true);
    expect(after.revokeReason).toBe("expired");
    expect(after.delegatedStatus).toBe("inactive");
    expect(after.delegatedLiveSessions).toBe(0);

    // Expiry names nobody. `sql/117`'s CHECK allows it ("what is forbidden is
    // an actor without a time"), and it is what lets a customer tell an
    // engagement a human ended from one that simply ran out.
    const actor = (await getAdminSql()`
      SELECT revoked_by_tenant_user_id FROM awcms_delegated_access_grants
      WHERE id = ${seeded.grantId}
    `) as { revoked_by_tenant_user_id: string | null }[];

    expect(actor[0]!.revoked_by_tenant_user_id).toBeNull();
  });

  test("an ordinary member in the same tenant is untouched", async () => {
    if (!workerRoleActivated) return;
    const seeded = await seed({ expired: true });

    await sweep();

    const after = await readEndState(seeded);

    // The `principal_kind = 'delegated'` predicate, proven rather than read.
    expect(after.ordinaryStatus).toBe("active");
    expect(after.ordinaryLiveSessions).toBe(1);
  });

  test("a grant that has NOT run out is left alone", async () => {
    if (!workerRoleActivated) return;
    const seeded = await seed({ expired: false });

    const result = await sweep();

    expect(result.expired).toBe(0);

    const after = await readEndState(seeded);
    expect(after.grantRevoked).toBe(false);
    expect(after.delegatedStatus).toBe("active");
    expect(after.delegatedLiveSessions).toBe(1);
  });

  test("a second pass sweeps nothing — the sweep is re-runnable", async () => {
    if (!workerRoleActivated) return;
    await seed({ expired: true });

    const first = await sweep();
    const second = await sweep();

    expect(first.expired).toBe(1);
    expect(second.expired).toBe(0);
  });

  test("a batch size the caller invents is clamped, not obeyed", async () => {
    if (!workerRoleActivated) return;
    await seed({ expired: true });

    // 0 would sweep nothing forever; a huge number would turn a bounded pass
    // into a whole-table transaction. Both are clamped INSIDE the function, so
    // the bound does not depend on every caller remembering it.
    const result = await sweep(0);

    expect(result.expired).toBe(1);
  });

  test("expiry and HUMAN revocation reach the same end state", async () => {
    if (!workerRoleActivated) return;
    // Two implementations on purpose — one names the person who revoked, one
    // names nobody — and two implementations drift. This is what notices.
    const swept = await seed({ expired: true });

    await sweep();

    const sweptState = await readEndState(swept);

    await resetDatabase();

    const revoked = await seed({ expired: false });
    const approver = (await getAdminSql()`
      SELECT approved_by_tenant_user_id FROM awcms_delegated_access_grants
      WHERE id = ${revoked.grantId}
    `) as { approved_by_tenant_user_id: string }[];

    await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      (tx) =>
        revokeDelegatedAccess(
          tx,
          TENANT,
          revoked.grantId,
          approver[0]!.approved_by_tenant_user_id,
          "incident closed",
          new Date()
        ),
      { workClass: "interactive" }
    );

    const revokedState = await readEndState(revoked);

    // Everything except the REASON, which is the one thing that must differ.
    expect(revokedState.grantRevoked).toBe(sweptState.grantRevoked);
    expect(revokedState.delegatedStatus).toBe(sweptState.delegatedStatus);
    expect(revokedState.delegatedLiveSessions).toBe(
      sweptState.delegatedLiveSessions
    );
    expect(revokedState.ordinaryStatus).toBe(sweptState.ordinaryStatus);
    expect(revokedState.ordinaryLiveSessions).toBe(
      sweptState.ordinaryLiveSessions
    );

    expect(sweptState.revokeReason).toBe("expired");
    expect(revokedState.revokeReason).toBe("incident closed");
  });

  test("the worker holds no direct write on the membership tables", async () => {
    if (!workerRoleActivated) return;

    await seed({ expired: true });

    const worker = getWorkerRoleSql();

    // The privilege it DOES have — and the only one it needs.
    const swept = (await worker`
      SELECT awcms_expire_delegated_access_grants(${TENANT}, 200) AS n
    `) as { n: number }[];

    expect(Number(swept[0]!.n)).toBe(1);

    // And the two it must never have. `UPDATE awcms_tenant_users` also writes
    // `status = 'active'`; `UPDATE awcms_sessions` also writes
    // `revoked_at = NULL`. Both are escalations in the role whose whole point
    // is that it cannot escalate, which is why the sweep is a function.
    await assertRejected(
      worker`
        UPDATE awcms_tenant_users SET status = 'active'
        WHERE tenant_id = ${TENANT}
      `,
      "awcms_worker UPDATE on awcms_tenant_users"
    );

    await assertRejected(
      worker`
        UPDATE awcms_sessions SET revoked_at = NULL
        WHERE tenant_id = ${TENANT}
      `,
      "awcms_worker UPDATE on awcms_sessions"
    );
  });
});
