/**
 * `requiresMfaEnrolment` through the PRODUCTION registry path (ADR-0141, audit
 * findings F-1, F-2, F-5).
 *
 * `mfa-required-permissions.integration.test.ts` drives the gate through the
 * `mfaRequiredKeys` test seam. That proves the gate, and cannot prove the
 * thing production depends on: that a flag declared in a module DESCRIPTOR
 * reaches the chokepoint. A mutation making `isMfaRequiredPermissionKey` always
 * `false` leaves every seam-based test green, because the seam supplies the keys
 * itself. So everything here declares the flag on a fixture module PUSHED INTO
 * THE REAL MODULE LIST, resets the memoised set, and passes no seam at all.
 *
 * It also pins what the audit found around the edges:
 *
 * - F-1: a machine credential bound to an enrolled person must not pass a
 *   flagged FIELD gate. The field function reads machine-ness from the
 *   authorised context, so the three analytics callers need no argument.
 * - F-2b: when the enrolment read itself fails, the request fails closed — the
 *   promise rejects, nothing is allowed, and no `allow` decision row exists.
 * - F-5: the seam is additive. Passing an empty set cannot switch enforcement
 *   off.
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
import {
  authorizeInTransaction,
  evaluateFieldAccessInTransaction
} from "../../src/modules/identity-access/application/access-guard";
import { issueMachineCredential } from "../../src/modules/identity-access/application/machine-credential-directory";
import { linkIdentityToPrincipal } from "../../src/modules/identity-access/application/principal-store";
import type { AccessRequest } from "../../src/modules/identity-access/domain/access-control";
import { resetMfaRequiredPermissionCacheForTests } from "../../src/modules/identity-access/domain/mfa-required-permissions";
import { modules } from "../../src/modules/index";
import type { ModuleDescriptor } from "../../src/modules/_shared/module-contract";

const TENANT = "e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3";
const MODULE = "mfa_registry_fixture";

/** Flagged (via the descriptor below). */
const FLAGGED_READ: AccessRequest = {
  moduleKey: MODULE,
  activityCode: "payout",
  action: "read"
};
/** Not flagged: the "main" permission of a route whose FIELD is the flagged one. */
const ROUTE_READ: AccessRequest = {
  moduleKey: MODULE,
  activityCode: "note",
  action: "read"
};

const PERMISSIONS: [string, string][] = [
  ["payout", "read"],
  ["note", "read"]
];

const FIXTURE_MODULE = {
  key: MODULE,
  name: "MFA registry fixture",
  type: "domain",
  status: "active",
  permissions: [
    {
      activityCode: "payout",
      action: "read",
      description: "flagged by descriptor",
      requiresMfaEnrolment: true
    },
    { activityCode: "note", action: "read", description: "not flagged" }
  ]
} as unknown as ModuleDescriptor;

const admin = () => getAdminSql();

function registerFixtureModule() {
  modules.push(FIXTURE_MODULE);
  resetMfaRequiredPermissionCacheForTests();
}

function unregisterFixtureModule() {
  const index = modules.indexOf(FIXTURE_MODULE);
  if (index !== -1) modules.splice(index, 1);
  resetMfaRequiredPermissionCacheForTests();
}

async function permissionId(activity: string, action: string) {
  const rows = (await admin()`
    SELECT id FROM awcms_permissions
    WHERE module_key = ${MODULE} AND activity_code = ${activity} AND action = ${action}
  `) as { id: string }[];
  return rows[0]!.id;
}

async function seedMember(
  label: string,
  roleId: string,
  withFactor: boolean
): Promise<{ tenantUserId: string; token: string }> {
  const profile = (await admin()`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', ${label}) RETURNING id
  `) as { id: string }[];
  const login = `${label}@example.test`;
  const identity = (await admin()`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, ${login}, 'x') RETURNING id
  `) as { id: string }[];
  const tenantUser = (await admin()`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${identity[0]!.id}) RETURNING id
  `) as { id: string }[];
  const principalId = await linkIdentityToPrincipal(
    admin(),
    identity[0]!.id,
    login
  );

  await admin()`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id,
       granted_by_tenant_user_id)
    VALUES (${TENANT}, ${tenantUser[0]!.id}, ${roleId}, 'tenant', ${TENANT},
            ${tenantUser[0]!.id})
  `;

  if (withFactor) {
    await admin()`
      INSERT INTO awcms_principal_mfa_factors
        (principal_id, factor_type, secret_ciphertext, status, last_used_step,
         activated_at)
      VALUES (${principalId}, 'totp', 'ciphertext-not-read', 'active', -1, now())
    `;
  }

  const token = generateSessionToken();

  await admin()`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${identity[0]!.id}, ${hashSessionToken(token)},
            now() + interval '1 hour')
  `;

  return { tenantUserId: tenantUser[0]!.id, token };
}

async function issueCredential(boundTo: string): Promise<string> {
  const issued = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    issueMachineCredential(
      tx,
      TENANT,
      boundTo,
      {
        name: "export-job",
        tenantUserId: boundTo,
        allowedPermissionKeys: [`${MODULE}.payout.read`, `${MODULE}.note.read`],
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

  return issued.token;
}

async function authorize(
  token: string,
  guard: AccessRequest,
  options: { mfaRequiredKeys?: ReadonlySet<string> } = {}
) {
  return withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
    authorizeInTransaction(
      tx,
      TENANT,
      hashSessionToken(token),
      new Date(),
      guard,
      options
    )
  );
}

/** Exactly what `analytics/events.ts` does: main guard, then the field gate with `auth.context`. */
async function asARouteDoes(token: string) {
  return withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
    const auth = await authorizeInTransaction(
      tx,
      TENANT,
      hashSessionToken(token),
      new Date(),
      ROUTE_READ
    );

    if (!auth.allowed) return { main: false, field: null };

    return {
      main: true,
      field: await evaluateFieldAccessInTransaction(
        tx,
        TENANT,
        auth.context,
        auth.grantedPermissionKeys,
        FLAGGED_READ,
        new Date()
      )
    };
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("requiresMfaEnrolment through the production registry (ADR-0141)", () => {
  let savedMfaEnabled: string | undefined;
  let roleId = "";

  beforeAll(async () => {
    savedMfaEnabled = process.env.AUTH_MFA_ENABLED;
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    unregisterFixtureModule();
    if (savedMfaEnabled === undefined) delete process.env.AUTH_MFA_ENABLED;
    else process.env.AUTH_MFA_ENABLED = savedMfaEnabled;
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    process.env.AUTH_MFA_ENABLED = "true";
    await resetDatabase();

    for (const [activity, action] of PERMISSIONS) {
      await admin()`
        INSERT INTO awcms_permissions (module_key, activity_code, action, description)
        VALUES (${MODULE}, ${activity}, ${action}, 'fixture')
        ON CONFLICT (module_key, activity_code, action) DO NOTHING
      `;
    }

    await admin()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
      VALUES (${TENANT}, 'mfa-registry', 'mfa-registry', 'active')
    `;

    const role = (await admin()`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name)
      VALUES (${TENANT}, 'holder', 'holder') RETURNING id
    `) as { id: string }[];
    roleId = role[0]!.id;

    for (const [activity, action] of PERMISSIONS) {
      await admin()`
        INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
        VALUES (${TENANT}, ${roleId}, ${await permissionId(activity, action)})
      `;
    }

    registerFixtureModule();
  });

  afterEach(() => {
    unregisterFixtureModule();
  });

  // ---- F-2(a): the descriptor reaches the chokepoint ----------------------

  test("a flag declared in a DESCRIPTOR refuses an unenrolled holder with no seam supplied", async () => {
    const holder = await seedMember("holder", roleId, false);

    const result = await authorize(holder.token, FLAGGED_READ);

    expect(result.allowed).toBe(false);
    if (result.allowed) throw new Error("unreachable");
    expect(result.code).toBe("MFA_ENROLMENT_REQUIRED");
    expect(result.denied.status).toBe(403);
  });

  test("the same descriptor lets an enrolled holder through, and leaves an unflagged key alone", async () => {
    const enrolled = await seedMember("enrolled", roleId, true);
    const bare = await seedMember("bare", roleId, false);

    expect((await authorize(enrolled.token, FLAGGED_READ)).allowed).toBe(true);
    expect((await authorize(bare.token, ROUTE_READ)).allowed).toBe(true);
  });

  test("withdrawing the descriptor withdraws the requirement — the registry is the only source", async () => {
    const bare = await seedMember("bare", roleId, false);

    expect((await authorize(bare.token, FLAGGED_READ)).allowed).toBe(false);

    unregisterFixtureModule();

    // Not a statement that this is desirable, only that nothing but the
    // descriptor decides: no table, no cached row, no leftover state.
    expect((await authorize(bare.token, FLAGGED_READ)).allowed).toBe(true);
  });

  // ---- F-5: the seam is additive -----------------------------------------

  test("an injected empty set cannot narrow what the registry flags", async () => {
    const bare = await seedMember("bare", roleId, false);

    const result = await authorize(bare.token, FLAGGED_READ, {
      mfaRequiredKeys: new Set()
    });

    expect(result.allowed).toBe(false);
  });

  test("an injected set adds a key the registry does not flag", async () => {
    const bare = await seedMember("bare", roleId, false);

    expect((await authorize(bare.token, ROUTE_READ)).allowed).toBe(true);
    expect(
      (
        await authorize(bare.token, ROUTE_READ, {
          mfaRequiredKeys: new Set([`${MODULE}.note.read`])
        })
      ).allowed
    ).toBe(false);
  });

  // ---- F-2(b): fail closed -----------------------------------------------

  test("when the enrolment read throws, the request fails closed: it rejects, and no allow row exists", async () => {
    const holder = await seedMember("holder", roleId, true);
    const statements: string[] = [];

    // A proxy over the transaction that throws on the factor read only. Every
    // other statement runs for real, so the failure is isolated to the one read
    // the gate depends on.
    const failing = (tx: Bun.SQL): Bun.SQL =>
      new Proxy(tx, {
        apply(target, _this, args) {
          const strings = args[0];

          if (Array.isArray(strings) && "raw" in strings) {
            const text = (strings as string[]).join("?");
            statements.push(text);

            if (/FROM awcms_principal_mfa_factors/.test(text)) {
              throw new Error("injected: factor read failed");
            }
          }

          return Reflect.apply(target, target, args);
        },
        get(target, property) {
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }) as Bun.SQL;

    let rejected: Error | null = null;
    let allowed: boolean | null = null;

    try {
      const result = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
        authorizeInTransaction(
          failing(tx),
          TENANT,
          hashSessionToken(holder.token),
          new Date(),
          FLAGGED_READ
        )
      );
      allowed = result.allowed;
    } catch (error) {
      rejected = error as Error;
    }

    // The proxy actually intercepted the read — otherwise "rejected" below
    // would be a statement about a different failure.
    expect(
      statements.some((text) => /awcms_principal_mfa_factors/.test(text))
    ).toBe(true);
    expect(rejected?.message).toContain("injected: factor read failed");
    expect(allowed).toBeNull();

    const rows = (await admin()`
      SELECT decision FROM awcms_abac_decision_logs
      WHERE tenant_user_id = ${holder.tenantUserId}
        AND module_key = ${MODULE} AND activity_code = 'payout'
    `) as { decision: string }[];

    // The transaction rolled back with the error, and in particular no `allow`
    // row describes a request that was never served.
    expect(rows.filter((row) => row.decision === "allow")).toEqual([]);
  });

  // ---- F-1 / F-2(c): the field gate --------------------------------------

  test("FIELD: a session — enrolled sees the flagged field, unenrolled does not, main route allowed for both", async () => {
    const enrolled = await seedMember("enrolled", roleId, true);
    const bare = await seedMember("bare", roleId, false);

    expect(await asARouteDoes(enrolled.token)).toEqual({
      main: true,
      field: true
    });
    expect(await asARouteDoes(bare.token)).toEqual({
      main: true,
      field: false
    });
  });

  test("FIELD (F-1): a machine credential bound to an ENROLLED person does not see the flagged field", async () => {
    const enrolled = await seedMember("enrolled", roleId, true);
    const credential = await issueCredential(enrolled.tenantUserId);

    // The route is written exactly as the three analytics callers are, with no
    // machine argument: machine-ness must come from the authorised context.
    expect(await asARouteDoes(credential)).toEqual({
      main: true,
      field: false
    });
    // The same person's SESSION, for contrast — the credential is what differs.
    expect(await asARouteDoes(enrolled.token)).toEqual({
      main: true,
      field: true
    });
  });

  test("FIELD: the authorised context carries machine-ness; a session context does not", async () => {
    const enrolled = await seedMember("enrolled", roleId, true);
    const credential = await issueCredential(enrolled.tenantUserId);

    const viaCredential = await authorize(credential, ROUTE_READ);
    const viaSession = await authorize(enrolled.token, ROUTE_READ);

    if (!viaCredential.allowed || !viaSession.allowed) {
      throw new Error("expected both to be allowed on the unflagged key");
    }

    expect(viaCredential.context.viaMachineCredential).toBe(true);
    expect(viaSession.context.viaMachineCredential).toBeUndefined();
  });

  test("FIELD: an unflagged field is untouched for a credential — the check is per key", async () => {
    const enrolled = await seedMember("enrolled", roleId, true);
    const credential = await issueCredential(enrolled.tenantUserId);

    const result = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        const auth = await authorizeInTransaction(
          tx,
          TENANT,
          hashSessionToken(credential),
          new Date(),
          ROUTE_READ
        );

        if (!auth.allowed) throw new Error("expected allow");

        return evaluateFieldAccessInTransaction(
          tx,
          TENANT,
          auth.context,
          auth.grantedPermissionKeys,
          ROUTE_READ,
          new Date()
        );
      }
    );

    expect(result).toBe(true);
  });
});
