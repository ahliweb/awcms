/**
 * Catch-and-continue inside a transaction is explicit, against a real
 * PostgreSQL (Issue #1099).
 *
 * ## The contract this file pins
 *
 * A statement that is EXPECTED to fail (a unique or foreign-key violation that
 * the code maps to a clean 409 / 404) runs inside `tx.savepoint(...)`. Two
 * consequences, and both are asserted here:
 *
 * 1. The mapped outcome is returned AND the surrounding transaction still
 *    commits. Up to Bun 1.4.2 a swallowed failure degraded the COMMIT to a
 *    ROLLBACK silently; Bun 1.4.3 throws `ERR_POSTGRES_COMMIT_ROLLED_BACK`
 *    instead, which turned every such 409 into a 500. A test that only checks
 *    "got a DuplicateXError" would pass on both and prove nothing about the
 *    commit, so each case runs through the REAL `withTenantOrThrow` and then
 *    reads the database back.
 *
 * 2. A sibling write made in the same transaction BEFORE the failed statement
 *    is committed. That is the documented behaviour change from the degraded
 *    rollback (it is how the ABAC decision-log row of an allowed-but-conflicting
 *    request now survives, exactly as it does for every other 4xx), and the
 *    test makes it a stated fact rather than an accident. The failed statement's
 *    own writes are NOT committed.
 *
 * Gated on `DATABASE_URL` (harness §Gating).
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
  createPolicy,
  DuplicatePolicyCodeError
} from "../../src/modules/identity-access/application/abac-admin";
import {
  DuplicateRoleCodeError,
  DuplicateRolePermissionError,
  PermissionNotFoundError,
  createRole,
  grantPermissionToRole
} from "../../src/modules/identity-access/application/role-admin";
import {
  DuplicateAssignmentError,
  assignRoleToGroup
} from "../../src/modules/identity-access/application/user-admin";
import {
  DuplicateOfficeCodeError,
  createOffice,
  restoreOffice
} from "../../src/modules/tenant-admin/application/office-directory";
import {
  DuplicateIdentifierError,
  addIdentifierToProfile
} from "../../src/modules/profile-identity/application/identifier-directory";
import { setPrimaryTenantDomain } from "../../src/modules/tenant-domain/application/tenant-domain-directory";
import {
  DuplicateGroupCodeError,
  createUserGroup
} from "../../src/modules/identity-access/application/user-group-admin";

const TENANT = "f1099111-1111-4111-8111-111111111111";
const ACTOR = "f1099000-0000-4000-8000-000000000001";
const MISSING_PERMISSION = "f1099000-0000-4000-8000-0000000000ff";

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'savepoint-tenant', 'Savepoint Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Savepoint actor')
    RETURNING id
  `) as { id: string }[];

  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'savepoint-actor@example.test', 'x')
    RETURNING id
  `) as { id: string }[];

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${ACTOR}, ${TENANT}, ${identity[0]!.id})
  `;
}

async function groupCodes(): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT group_code FROM awcms_user_groups WHERE tenant_id = ${TENANT}
    ORDER BY group_code
  `) as { group_code: string }[];

  return rows.map((row) => row.group_code);
}

const suite = integrationEnabled ? describe : describe.skip;

suite("a swallowed database failure runs in a savepoint (Issue #1099)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedFixtures();
  });

  test("a duplicate group code is a clean outcome, the transaction commits, and the sibling write survives", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createUserGroup(tx, TENANT, ACTOR, {
        groupCode: "existing",
        groupName: "Existing",
        description: null
      })
    );

    // Must resolve: before the fix the commit threw on Bun >= 1.4.3.
    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        await createUserGroup(tx, TENANT, ACTOR, {
          groupCode: "sibling",
          groupName: "Sibling",
          description: null
        });

        try {
          await createUserGroup(tx, TENANT, ACTOR, {
            groupCode: "existing",
            groupName: "Duplicate",
            description: null
          });
          return "created" as const;
        } catch (error) {
          if (error instanceof DuplicateGroupCodeError) {
            return "duplicate" as const;
          }
          throw error;
        }
      }
    );

    expect(outcome).toBe("duplicate");
    // The sibling committed; the duplicate did not add a second `existing`.
    expect(await groupCodes()).toEqual(["existing", "sibling"]);
  });

  test("a duplicate role code leaves the transaction valid for further writes in it", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createRole(tx, TENANT, ACTOR, { roleCode: "editor", roleName: "Editor" })
    );

    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        try {
          await createRole(tx, TENANT, ACTOR, {
            roleCode: "editor",
            roleName: "Editor again"
          });
          return "created" as const;
        } catch (error) {
          if (!(error instanceof DuplicateRoleCodeError)) {
            throw error;
          }
        }

        // The transaction is NOT aborted: a further statement and write succeed.
        // On the degraded path this INSERT failed with 25P02.
        await createRole(tx, TENANT, ACTOR, {
          roleCode: "after-duplicate",
          roleName: "After the duplicate"
        });

        return "duplicate-then-continued" as const;
      }
    );

    expect(outcome).toBe("duplicate-then-continued");

    const codes = (await getAdminSql()`
      SELECT role_code FROM awcms_roles
      WHERE tenant_id = ${TENANT} AND role_code IN ('editor', 'after-duplicate')
      ORDER BY role_code
    `) as { role_code: string }[];

    expect(codes.map((row) => row.role_code)).toEqual([
      "after-duplicate",
      "editor"
    ]);
  });

  test("a foreign-key refusal maps to its domain error and the transaction still commits", async () => {
    const roleId = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) =>
        (
          await createRole(tx, TENANT, ACTOR, {
            roleCode: "fk-target",
            roleName: "FK target"
          })
        ).id
    );

    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        try {
          await grantPermissionToRole(
            tx,
            TENANT,
            ACTOR,
            roleId,
            MISSING_PERMISSION
          );
          return "granted" as const;
        } catch (error) {
          if (error instanceof PermissionNotFoundError) {
            return "permission_not_found" as const;
          }
          throw error;
        }
      }
    );

    expect(outcome).toBe("permission_not_found");
  });

  // -------------------------------------------------------------------------
  // The route-shaped contract (audit M1). Each case is exactly what a route
  // does: open the real tenant transaction, call the application function, map
  // the domain error it raises to a plain outcome, and RETURN — so the COMMIT
  // happens on whatever state the callee left behind. Under Bun >= 1.4.3 an
  // unguarded failed statement inside the callee makes that commit throw
  // ERR_POSTGRES_COMMIT_ROLLED_BACK; each case fails on the pre-fix code.
  // -------------------------------------------------------------------------

  const OFFICE = {
    officeCode: "HQ",
    officeName: "Head office",
    officeType: "branch",
    parentOfficeId: null
  } as const;

  test("createOffice: a duplicate office code maps to its domain error and commits", async () => {
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createOffice(tx, TENANT, ACTOR, OFFICE)
    );

    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        try {
          await createOffice(tx, TENANT, ACTOR, OFFICE);
          return "created";
        } catch (error) {
          if (error instanceof DuplicateOfficeCodeError) return "duplicate";
          throw error;
        }
      }
    );

    expect(outcome).toBe("duplicate");
  });

  test("restoreOffice: restoring into a taken code maps to its domain error and commits", async () => {
    const first = await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createOffice(tx, TENANT, ACTOR, OFFICE)
    );

    await getAdminSql()`
      UPDATE awcms_offices SET deleted_at = now() WHERE id = ${first.id}
    `;
    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createOffice(tx, TENANT, ACTOR, OFFICE)
    );

    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        try {
          await restoreOffice(tx, TENANT, ACTOR, first.id);
          return "restored";
        } catch (error) {
          if (error instanceof DuplicateOfficeCodeError) return "duplicate";
          throw error;
        }
      }
    );

    expect(outcome).toBe("duplicate");
  });

  test("createPolicy: a duplicate policy code maps to its domain error and commits", async () => {
    const input = {
      policyCode: "deny-all-probe",
      effect: "deny",
      description: null
    } as const;

    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      createPolicy(tx, TENANT, ACTOR, input)
    );

    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        try {
          await createPolicy(tx, TENANT, ACTOR, input);
          return "created";
        } catch (error) {
          if (error instanceof DuplicatePolicyCodeError) return "duplicate";
          throw error;
        }
      }
    );

    expect(outcome).toBe("duplicate");
  });

  test("addIdentifierToProfile: a duplicate identifier maps to its domain error and commits", async () => {
    const profile = (await getAdminSql()`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${TENANT}, 'person', 'Identifier owner')
      RETURNING id
    `) as { id: string }[];
    const input = {
      identifierType: "email",
      value: "dup@example.test",
      isPrimary: false
    } as const;

    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      addIdentifierToProfile(tx, TENANT, ACTOR, profile[0]!.id, input)
    );

    const outcome = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        try {
          await addIdentifierToProfile(
            tx,
            TENANT,
            ACTOR,
            profile[0]!.id,
            input
          );
          return "added";
        } catch (error) {
          if (error instanceof DuplicateIdentifierError) return "duplicate";
          throw error;
        }
      }
    );

    expect(outcome).toBe("duplicate");
  });

  test("grantPermissionToRole: 23505 (already granted) and 23503 (no such permission) both map and commit", async () => {
    const roleId = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) =>
        (
          await createRole(tx, TENANT, ACTOR, {
            roleCode: "grants",
            roleName: "Grants"
          })
        ).id
    );
    const permission = (await getAdminSql()`
      SELECT id FROM awcms_permissions WHERE scope <> 'platform' LIMIT 1
    `) as { id: string }[];

    await withTenantOrThrow(getRuntimeSql(), TENANT, (tx) =>
      grantPermissionToRole(tx, TENANT, ACTOR, roleId, permission[0]!.id)
    );

    const outcomes = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        const results: string[] = [];

        for (const permissionId of [permission[0]!.id, MISSING_PERMISSION]) {
          try {
            await grantPermissionToRole(
              tx,
              TENANT,
              ACTOR,
              roleId,
              permissionId
            );
            results.push("granted");
          } catch (error) {
            if (error instanceof DuplicateRolePermissionError) {
              results.push("duplicate");
            } else if (error instanceof PermissionNotFoundError) {
              results.push("not_found");
            } else {
              throw error;
            }
          }
        }

        return results;
      }
    );

    // BOTH failures happen in ONE transaction: the second statement only works
    // because the first failure was rolled back to its savepoint.
    expect(outcomes).toEqual(["duplicate", "not_found"]);
  });

  /**
   * Two transactions racing on one unique index. B's pre-check cannot see A's
   * uncommitted row, so B reaches the guarded statement, blocks on A, and loses
   * with a REAL 23505 once A commits — the only deterministic way to drive the
   * savepoint of `assignRoleToGroup` / `setPrimaryTenantDomain`.
   */
  async function race<A, B>(
    first: (tx: Bun.TransactionSQL) => Promise<A>,
    second: (tx: Bun.TransactionSQL) => Promise<B>
  ): Promise<{ a: A; b: B }> {
    let release!: () => void;
    let held!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstDone = new Promise<void>((resolve) => {
      held = resolve;
    });

    const a = withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
      const value = await first(tx);
      held();
      await gate;
      return value;
    });

    await firstDone;

    const b = withTenantOrThrow(getRuntimeSql(), TENANT, second);

    await new Promise((resolve) => setTimeout(resolve, 500));
    release();

    return { a: await a, b: await b };
  }

  test("assignRoleToGroup: losing the race at the unique index maps to its domain error and commits", async () => {
    const { groupId, roleId } = await withTenantOrThrow(
      getRuntimeSql(),
      TENANT,
      async (tx) => {
        const group = await createUserGroup(tx, TENANT, ACTOR, {
          groupCode: "racers",
          groupName: "Racers",
          description: null
        });
        const role = await createRole(tx, TENANT, ACTOR, {
          roleCode: "raced",
          roleName: "Raced"
        });

        return { groupId: group.id, roleId: role.id };
      }
    );

    const { a, b } = await race(
      (tx) => assignRoleToGroup(tx, TENANT, ACTOR, groupId, roleId),
      async (tx) => {
        try {
          await assignRoleToGroup(tx, TENANT, ACTOR, groupId, roleId);
          return "assigned";
        } catch (error) {
          if (error instanceof DuplicateAssignmentError) return "duplicate";
          throw error;
        }
      }
    );

    expect(a.roleId).toBe(roleId);
    expect(b).toBe("duplicate");
  });

  test("setPrimaryTenantDomain: losing the primary race returns `conflict`, commits, and leaves the winner primary", async () => {
    const admin = getAdminSql();
    const ids: string[] = [];

    for (const [index, primary] of [true, false, false].entries()) {
      const rows = (await admin`
        INSERT INTO awcms_tenant_domains
          (tenant_id, hostname, normalized_hostname, domain_type, status, is_primary)
        VALUES (${TENANT}, ${`d${index}.example.test`}, ${`d${index}.example.test`},
                'custom_domain', 'active', ${primary})
        RETURNING id
      `) as { id: string }[];

      ids.push(rows[0]!.id);
    }

    const { a, b } = await race(
      (tx) => setPrimaryTenantDomain(tx, TENANT, ACTOR, ids[1]!),
      (tx) => setPrimaryTenantDomain(tx, TENANT, ACTOR, ids[2]!)
    );

    expect(a.outcome).toBe("set");
    expect(b.outcome).toBe("conflict");

    const primaries = (await admin`
      SELECT id FROM awcms_tenant_domains
      WHERE tenant_id = ${TENANT} AND is_primary
    `) as { id: string }[];

    // Exactly one primary, and it is the winner: the loser's coupled
    // demote+promote pair rolled back together.
    expect(primaries.map((row) => row.id)).toEqual([ids[1]!]);
  });
});
