/**
 * `requiresMfaEnrolment` against a real PostgreSQL (ADR-0141, finding PS-13).
 *
 * The permission under test is a TEST-ONLY FIXTURE (`mfa_fixture.payout.*`), not
 * a shipped module's: no base module flags one yet, and the gate must be proven
 * before the first real user (`hr_payroll`, #957) depends on it. It is injected
 * through the `mfaRequiredKeys` option — the same seam `sodRules` uses — so the
 * REAL `authorizeInTransaction` runs end to end, with real grants, real
 * sessions, real factors and a real decision log.
 *
 * ## What is proved, both directions
 *
 * - An unenrolled holder is REFUSED, with a code and a message that say how to
 *   fix it, and the refusal is ONE decision-log row (not an allow followed by a
 *   contradicting deny).
 * - An enrolled holder is ALLOWED, and the module's own conditional step-up
 *   composes on top of it: a stale session is asked for a step-up, a fresh one
 *   is not. That is the pair ADR-0141 §4 requires — conditional, never
 *   unconditional — and the enrolled/unenrolled split is the condition.
 * - Nobody is locked out: the unenrolled holder is still ALLOWED on every
 *   unflagged permission, and the enrolment routes sit outside the chokepoint,
 *   so the way to un-refuse yourself cannot itself be refused.
 * - Not an oracle: a caller who lacks the permission gets plain
 *   `ACCESS_DENIED`, never the enrolment hint.
 * - Freshness: disabling the factor takes effect on the very next decision, even
 *   through an authorization read cache.
 * - A machine credential is refused even when its linked account is an enrolled
 *   person, because nobody presented a factor.
 * - The readiness listing finds exactly the unenrolled holders, from every
 *   grant source, and not those who cannot use the permission anyway.
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
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import { createAuthorizationReadCache } from "../../src/modules/identity-access/application/authorization-read-cache";
import { issueMachineCredential } from "../../src/modules/identity-access/application/machine-credential-directory";
import { requireStepUp } from "../../src/modules/identity-access/application/mfa-session-assurance";
import { getMfaStatus } from "../../src/modules/identity-access/application/mfa";
import { reportMfaRequiredPermissionHolders } from "../../src/modules/identity-access/application/mfa-required-holders";
import { linkIdentityToPrincipal } from "../../src/modules/identity-access/application/principal-store";
import { disableLiveFactors } from "../../src/modules/identity-access/application/principal-mfa-store";
import type { AccessRequest } from "../../src/modules/identity-access/domain/access-control";
import { MFA_ENROLMENT_REQUIRED_POLICY } from "../../src/modules/identity-access/domain/mfa-required-permissions";

const TENANT = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";
const OTHER_TENANT = "e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2";

const FIXTURE_MODULE = "mfa_fixture";

/** The flagged permissions. `read` is flagged on purpose — see the machine test. */
const APPROVE: AccessRequest = {
  moduleKey: FIXTURE_MODULE,
  activityCode: "payout",
  action: "approve"
};
const READ: AccessRequest = {
  moduleKey: FIXTURE_MODULE,
  activityCode: "payout",
  action: "read"
};
/** Held by the same people, NOT flagged. */
const ROUTINE: AccessRequest = {
  moduleKey: FIXTURE_MODULE,
  activityCode: "note",
  action: "update"
};

const KEY_APPROVE = "mfa_fixture.payout.approve";
const KEY_READ = "mfa_fixture.payout.read";
const FLAGGED = new Set([KEY_APPROVE, KEY_READ]);

const FIXTURE_PERMISSIONS: [string, string][] = [
  ["payout", "approve"],
  ["payout", "read"],
  ["note", "update"]
];

type Member = {
  tenantUserId: string;
  identityId: string;
  principalId: string;
  token: string;
};

const admin = () => getAdminSql();

async function permissionId(activity: string, action: string) {
  const rows = (await admin()`
    SELECT id FROM awcms_permissions
    WHERE module_key = ${FIXTURE_MODULE}
      AND activity_code = ${activity} AND action = ${action}
  `) as { id: string }[];
  return rows[0]!.id;
}

async function seedTenant(id: string, code: string) {
  await admin()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${id}, ${code}, ${code}, 'active')
  `;
}

async function seedRole(
  tenantId: string,
  code: string,
  perms: [string, string][]
): Promise<string> {
  const rows = (await admin()`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name)
    VALUES (${tenantId}, ${code}, ${code}) RETURNING id
  `) as { id: string }[];
  const roleId = rows[0]!.id;

  for (const [activity, action] of perms) {
    await admin()`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      VALUES (${tenantId}, ${roleId}, ${await permissionId(activity, action)})
    `;
  }

  return roleId;
}

async function grantRole(
  tenantId: string,
  tenantUserId: string,
  roleId: string
) {
  await admin()`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id,
       granted_by_tenant_user_id)
    VALUES (${tenantId}, ${tenantUserId}, ${roleId}, 'tenant', ${tenantId},
            ${tenantUserId})
  `;
}

async function seedMember(
  tenantId: string,
  label: string,
  options: {
    roleId?: string;
    factor?: "active" | "pending";
    aal2?: boolean;
  } = {}
): Promise<Member> {
  const profile = (await admin()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${tenantId}, 'person', ${label}) RETURNING id
  `) as { id: string }[];
  const loginIdentifier = `${label}@example.test`;
  const identity = (await admin()`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${tenantId}, ${profile[0]!.id}, ${loginIdentifier}, 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await admin()`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${tenantId}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];

  // Linked, as the real identity writers do (ADR-0085): an unlinked identity
  // cannot hold a factor, which would make "unenrolled" true for the wrong reason.
  const principalId = await linkIdentityToPrincipal(
    admin(),
    identity[0]!.id,
    loginIdentifier
  );

  if (options.roleId) {
    await grantRole(tenantId, tenantUser[0]!.id, options.roleId);
  }

  if (options.factor === "active") {
    await admin()`
      INSERT INTO awcms_principal_mfa_factors
        (principal_id, factor_type, secret_ciphertext, status, last_used_step,
         activated_at)
      VALUES (${principalId}, 'totp', 'ciphertext-not-read', 'active', -1, now())
    `;
  } else if (options.factor === "pending") {
    await admin()`
      INSERT INTO awcms_principal_mfa_factors
        (principal_id, factor_type, secret_ciphertext, status, last_used_step)
      VALUES (${principalId}, 'totp', 'ciphertext-not-read', 'pending', -1)
    `;
  }

  const token = generateSessionToken();

  await admin()`
    INSERT INTO awcms_sessions
      (tenant_id, identity_id, token_hash, expires_at, assurance_level,
       stepped_up_at)
    VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '1 hour',
            ${options.aal2 ? "aal2" : "aal1"},
            ${options.aal2 ? new Date() : null})
  `;

  return {
    tenantUserId: tenantUser[0]!.id,
    identityId: identity[0]!.id,
    principalId,
    token
  };
}

async function authorize(
  member: Pick<Member, "token">,
  guard: AccessRequest,
  options: {
    mfaRequiredKeys?: ReadonlySet<string>;
    readCache?: ReturnType<typeof createAuthorizationReadCache>;
    tenantId?: string;
  } = {}
) {
  const tenantId = options.tenantId ?? TENANT;

  return withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
    authorizeInTransaction(
      tx,
      tenantId,
      hashSessionToken(member.token),
      new Date(),
      guard,
      {
        mfaRequiredKeys: options.mfaRequiredKeys ?? FLAGGED,
        readCache: options.readCache
      }
    )
  );
}

async function refusalOf(
  member: Pick<Member, "token">,
  guard: AccessRequest = APPROVE
) {
  const result = await authorize(member, guard);

  if (result.allowed) throw new Error("expected a refusal, got an allow");

  const body = (await result.denied.json()) as {
    error: { code: string; message: string; details?: { reason?: string } };
  };

  return { status: result.denied.status, body };
}

async function decisionRows(tenantUserId: string, action: string) {
  return (await admin()`
    SELECT decision, matched_policy FROM awcms_abac_decision_logs
    WHERE tenant_id = ${TENANT} AND tenant_user_id = ${tenantUserId}
      AND module_key = ${FIXTURE_MODULE} AND action = ${action}
    ORDER BY created_at
  `) as { decision: string; matched_policy: string | null }[];
}

let approverRole = "";

const suite = integrationEnabled ? describe : describe.skip;

suite("permissions that require an enrolled MFA factor (ADR-0141)", () => {
  let savedMfaEnabled: string | undefined;

  beforeAll(async () => {
    savedMfaEnabled = process.env.AUTH_MFA_ENABLED;
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    if (savedMfaEnabled === undefined) delete process.env.AUTH_MFA_ENABLED;
    else process.env.AUTH_MFA_ENABLED = savedMfaEnabled;
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    process.env.AUTH_MFA_ENABLED = "true";
    await resetDatabase();

    for (const [activity, action] of FIXTURE_PERMISSIONS) {
      await admin()`
        INSERT INTO awcms_permissions
          (module_key, activity_code, action, description)
        VALUES (${FIXTURE_MODULE}, ${activity}, ${action},
                ${`${FIXTURE_MODULE}.${activity}.${action} (fixture)`})
        ON CONFLICT (module_key, activity_code, action) DO NOTHING
      `;
    }

    await seedTenant(TENANT, "mfa-gate");
    await seedTenant(OTHER_TENANT, "mfa-gate-other");
    approverRole = await seedRole(TENANT, "approver", FIXTURE_PERMISSIONS);
  });

  // ---- refusal ------------------------------------------------------------

  test("an unenrolled holder is refused with an actionable error", async () => {
    const holder = await seedMember(TENANT, "holder", { roleId: approverRole });

    const { status, body } = await refusalOf(holder);

    expect(status).toBe(403);
    expect(body.error.code).toBe("MFA_ENROLMENT_REQUIRED");
    expect(body.error.details?.reason).toBe("not_enrolled");
    // Actionable: it says WHERE, so the refusal is a way forward and not a wall.
    expect(body.error.message).toContain("/admin/account");
    // The wire shape names no permission key and no identifier.
    expect(JSON.stringify(body)).not.toContain(KEY_APPROVE);
    expect(JSON.stringify(body)).not.toContain(holder.tenantUserId);
  });

  test("the refusal is ONE decision-log row, not an allow followed by a deny", async () => {
    const holder = await seedMember(TENANT, "holder", { roleId: approverRole });

    await refusalOf(holder);

    const rows = await decisionRows(holder.tenantUserId, "approve");

    expect(rows).toEqual([
      { decision: "deny", matched_policy: MFA_ENROLMENT_REQUIRED_POLICY }
    ]);
  });

  test("a PENDING factor does not count — only a confirmed one does", async () => {
    const holder = await seedMember(TENANT, "holder", {
      roleId: approverRole,
      factor: "pending"
    });

    expect(
      (await getMfaStatus(getAdminSql(), TENANT, holder.identityId)).enabled
    ).toBe(false);
    expect((await refusalOf(holder)).body.error.code).toBe(
      "MFA_ENROLMENT_REQUIRED"
    );
  });

  // ---- allowed, and step-up composes -------------------------------------

  test("an enrolled holder is allowed", async () => {
    const holder = await seedMember(TENANT, "holder", {
      roleId: approverRole,
      factor: "active"
    });

    const result = await authorize(holder, APPROVE);

    expect(result.allowed).toBe(true);
    expect(await decisionRows(holder.tenantUserId, "approve")).toEqual([
      { decision: "allow", matched_policy: "role_permission" }
    ]);
  });

  test("enrolled holder + the module's conditional step-up: stale session asked, fresh session not", async () => {
    const stale = await seedMember(TENANT, "stale", {
      roleId: approverRole,
      factor: "active",
      aal2: false
    });
    const fresh = await seedMember(TENANT, "fresh", {
      roleId: approverRole,
      factor: "active",
      aal2: true
    });

    // The enrolment gate lets both through...
    expect((await authorize(stale, APPROVE)).allowed).toBe(true);
    expect((await authorize(fresh, APPROVE)).allowed).toBe(true);

    // ...and the module then applies step-up exactly as ADR-0137 §4 specifies:
    // required because the principal HAS a factor (`getMfaStatus`). Here that
    // condition is guaranteed by the gate above, which is the whole point —
    // the conditional can no longer be skipped by simply not enrolling.
    const stepUp = (member: Member) =>
      withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
        const status = await getMfaStatus(tx, TENANT, member.identityId);
        if (!status.enabled) return "not_applicable" as const;
        const gate = await requireStepUp(
          tx,
          TENANT,
          hashSessionToken(member.token),
          new Date()
        );
        return gate.ok ? ("ok" as const) : ("step_up_required" as const);
      });

    expect(await stepUp(stale)).toBe("step_up_required");
    expect(await stepUp(fresh)).toBe("ok");
  });

  // ---- not a lockout ------------------------------------------------------

  test("an unenrolled holder keeps every UNFLAGGED permission — the gate is not a lockout", async () => {
    const holder = await seedMember(TENANT, "holder", { roleId: approverRole });

    expect((await authorize(holder, ROUTINE)).allowed).toBe(true);
    expect((await authorize(holder, APPROVE)).allowed).toBe(false);
  });

  test("with nothing flagged the chokepoint behaves exactly as before", async () => {
    const holder = await seedMember(TENANT, "holder", { roleId: approverRole });

    expect(
      (await authorize(holder, APPROVE, { mfaRequiredKeys: new Set() })).allowed
    ).toBe(true);
  });

  test("the enrolment routes sit OUTSIDE the chokepoint, so the way out cannot be refused", async () => {
    // A source-level proof, paired with an existence assertion so it cannot pass
    // vacuously: if these files moved, the existence check fails first.
    for (const route of ["start", "verify"]) {
      const path = `src/pages/api/v1/auth/mfa/totp/enroll/${route}.ts`;
      const source = await Bun.file(path).text();

      expect(source).toContain("resolveEnrollAuth");
      expect(source).not.toContain("authorizeInTransaction");
    }
  });

  // ---- bootstrap ----------------------------------------------------------

  test("bootstrap: a tenant whose only holder is unenrolled is refused only until that holder enrols", async () => {
    // The owner holds the flagged permission and has no factor — the state of
    // every tenant the day a module that flags permissions is enabled for it.
    const owner = await seedMember(TENANT, "owner", { roleId: approverRole });

    expect((await refusalOf(owner)).body.error.code).toBe(
      "MFA_ENROLMENT_REQUIRED"
    );
    // Everything else still works, so the owner can reach /admin/account.
    expect((await authorize(owner, ROUTINE)).allowed).toBe(true);

    // Enrolment (a confirmed factor on the owner's principal)...
    await admin()`
      INSERT INTO awcms_principal_mfa_factors
        (principal_id, factor_type, secret_ciphertext, status, last_used_step,
         activated_at)
      VALUES (${owner.principalId}, 'totp', 'ciphertext-not-read', 'active', -1, now())
    `;

    // ...and the very next request is served. No restart, no admin action, no
    // policy change anywhere.
    expect((await authorize(owner, APPROVE)).allowed).toBe(true);
  });

  // ---- not an oracle ------------------------------------------------------

  test("a caller who lacks the permission gets ACCESS_DENIED, never the enrolment hint", async () => {
    const outsider = await seedMember(TENANT, "outsider"); // no role at all

    const { body } = await refusalOf(outsider);

    expect(body.error.code).toBe("ACCESS_DENIED");
    expect(body.error.details).toBeUndefined();
    expect(body.error.message).not.toContain("multi-factor");
  });

  // ---- freshness ----------------------------------------------------------

  test("losing the factor takes effect on the very next decision, cache or no cache", async () => {
    const holder = await seedMember(TENANT, "holder", {
      roleId: approverRole,
      factor: "active"
    });
    const readCache = createAuthorizationReadCache();

    const first = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        const before = await authorizeInTransaction(
          tx,
          TENANT,
          hashSessionToken(holder.token),
          new Date(),
          APPROVE,
          { mfaRequiredKeys: FLAGGED, readCache }
        );

        // The factor goes away mid-transaction (a self-service disable or an
        // administrative reset). The cache memoises principal-scoped inputs; the
        // enrolment fact must not be one of them.
        await disableLiveFactors(tx, holder.principalId, new Date(), null);

        const after = await authorizeInTransaction(
          tx,
          TENANT,
          hashSessionToken(holder.token),
          new Date(),
          APPROVE,
          { mfaRequiredKeys: FLAGGED, readCache }
        );

        return { before: before.allowed, after: after.allowed };
      }
    );

    expect(first).toEqual({ before: true, after: false });
  });

  // ---- deployment without enrolment --------------------------------------

  test("with AUTH_MFA_ENABLED off nobody can enrol, and the refusal says so instead of pointing at a screen that cannot help", async () => {
    process.env.AUTH_MFA_ENABLED = "false";
    const holder = await seedMember(TENANT, "holder", { roleId: approverRole });

    const { body } = await refusalOf(holder);

    expect(body.error.code).toBe("MFA_ENROLMENT_REQUIRED");
    expect(body.error.details?.reason).toBe("enrolment_unavailable");
    expect(body.error.message).not.toContain("/admin/account");
    expect(body.error.message).toContain("administrator");
  });

  // ---- machine credentials ------------------------------------------------

  test("a machine credential is refused even when its linked account is an enrolled person", async () => {
    const person = await seedMember(TENANT, "person", {
      roleId: approverRole,
      factor: "active"
    });

    const issued = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      issueMachineCredential(
        tx,
        TENANT,
        person.tenantUserId,
        {
          name: "feed",
          tenantUserId: person.tenantUserId,
          allowedPermissionKeys: [KEY_READ],
          allowedWriteActions: [],
          allowedIpCidrs: [],
          expiresAt: new Date(Date.now() + 60 * 60 * 1000)
        },
        new Date()
      )
    );

    if (issued.outcome !== "issued") {
      throw new Error(`credential fixture failed: ${issued.outcome}`);
    }

    // The same account, presenting its session: allowed, it has a factor.
    expect((await authorize(person, READ)).allowed).toBe(true);

    // Presenting the credential: nobody presented a factor.
    const viaCredential = await refusalOf({ token: issued.token }, READ);

    expect(viaCredential.body.error.code).toBe("MFA_ENROLMENT_REQUIRED");
    expect(viaCredential.body.error.details?.reason).toBe("machine_credential");
  });

  // ---- readiness listing --------------------------------------------------

  describe("readiness: who holds a flagged permission and has no factor", () => {
    const report = (tenantId = TENANT) =>
      withTenantOrThrow(getRuntimeSql(), tenantId, (tx) =>
        reportMfaRequiredPermissionHolders(tx, tenantId, new Date(), {
          requiredKeys: FLAGGED
        })
      );

    test("lists exactly the unenrolled holders and counts the enrolled ones", async () => {
      const bare = await seedMember(TENANT, "bare", { roleId: approverRole });
      await seedMember(TENANT, "enrolled", {
        roleId: approverRole,
        factor: "active"
      });
      await seedMember(TENANT, "pending", {
        roleId: approverRole,
        factor: "pending"
      });
      // Holds only an UNFLAGGED permission — not a holder at all.
      const noteRole = await seedRole(TENANT, "noter", [["note", "update"]]);
      await seedMember(TENANT, "noter", { roleId: noteRole });
      // Holds nothing.
      await seedMember(TENANT, "nobody");

      const result = await report();

      expect(result.holderCount).toBe(3);
      expect(result.unenrolled.length).toBe(2);
      expect(result.unenrolled.map((holder) => holder.tenantUserId)).toContain(
        bare.tenantUserId
      );
      // Keys only: no name, no address.
      expect(JSON.stringify(result)).not.toContain("@example.test");
      expect(result.unenrolled[0]!.permissionKeys).toEqual([
        KEY_APPROVE,
        KEY_READ
      ]);
    });

    test("finds a holder who got the role through a GROUP — the same grant source the chokepoint uses", async () => {
      const viaGroup = await seedMember(TENANT, "grouped");

      const group = (await admin()`
        INSERT INTO awcms_user_groups (tenant_id, group_code, group_name)
        VALUES (${TENANT}, 'approvers', 'Approvers') RETURNING id
      `) as { id: string }[];
      await admin()`
        INSERT INTO awcms_user_group_members (tenant_id, user_group_id, tenant_user_id)
        VALUES (${TENANT}, ${group[0]!.id}, ${viaGroup.tenantUserId})
      `;
      await admin()`
        INSERT INTO awcms_access_policies
          (tenant_id, subject_type, user_group_id, role_id, scope_type, scope_id)
        VALUES (${TENANT}, 'user_group', ${group[0]!.id}, ${approverRole}, 'tenant', ${TENANT})
      `;

      const result = await report();

      expect(result.unenrolled.map((holder) => holder.tenantUserId)).toEqual([
        viaGroup.tenantUserId
      ]);
      // And the chokepoint agrees: the listing predicts the refusal.
      expect((await refusalOf(viaGroup)).body.error.code).toBe(
        "MFA_ENROLMENT_REQUIRED"
      );
    });

    test("does not list a deactivated person or a soft-deleted role's holder", async () => {
      const inactive = await seedMember(TENANT, "inactive", {
        roleId: approverRole
      });
      await admin()`
        UPDATE awcms_tenant_users SET status = 'inactive'
        WHERE id = ${inactive.tenantUserId}
      `;

      const deletedRole = await seedRole(TENANT, "gone", FIXTURE_PERMISSIONS);
      await seedMember(TENANT, "orphaned", { roleId: deletedRole });
      await admin()`
        UPDATE awcms_roles SET deleted_at = now() WHERE id = ${deletedRole}
      `;

      expect((await report()).unenrolled).toEqual([]);
    });

    test("does not list holders of a module the tenant has turned off", async () => {
      await admin()`
        INSERT INTO awcms_modules (module_key, module_name)
        VALUES (${FIXTURE_MODULE}, 'Fixture')
        ON CONFLICT (module_key) DO NOTHING
      `;
      await seedMember(TENANT, "holder", { roleId: approverRole });

      expect((await report()).unenrolled.length).toBe(1);

      await admin()`
        INSERT INTO awcms_tenant_modules (tenant_id, module_key, enabled)
        VALUES (${TENANT}, ${FIXTURE_MODULE}, false)
      `;

      // The chokepoint refuses MODULE_DISABLED before enrolment is ever asked
      // about, so the holder is not a finding.
      const result = await report();
      expect(result.unenrolled).toEqual([]);
      expect(result.activeKeyCount).toBe(0);
    });

    test("is tenant-scoped: another tenant's holders never appear", async () => {
      const otherRole = await seedRole(
        OTHER_TENANT,
        "approver",
        FIXTURE_PERMISSIONS
      );
      await seedMember(OTHER_TENANT, "elsewhere", { roleId: otherRole });
      await seedMember(TENANT, "here", {
        roleId: approverRole,
        factor: "active"
      });

      expect((await report()).unenrolled).toEqual([]);
      expect((await report(OTHER_TENANT)).unenrolled.length).toBe(1);
    });
  });
});
