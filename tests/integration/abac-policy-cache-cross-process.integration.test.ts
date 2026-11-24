/**
 * Issue #1482 — a policy change made by ANOTHER process is honoured by this
 * process's very next authorization.
 *
 * ## Why one test process stands in for two, faithfully
 *
 * The policy cache is module state: one `Map` per process. Before #1482 the
 * ONLY thing that told a process its snapshot was stale was
 * `invalidatePolicyCache(tenantId)`, called by the endpoint that made the
 * change — in the process that served it. A second process never receives that
 * call; all it shares with the writer is the database.
 *
 * So "process A" here is the real writer functions (`insertAbacPolicy`,
 * `setAbacPolicyActive`, `updateAbacPolicy`, the flat `createPolicy` /
 * `updatePolicy`, an operator DELETE/TRUNCATE), each in its own committed
 * transaction and WITHOUT `invalidatePolicyCache` — exactly what process B
 * observes of a write made elsewhere. "Process B" is `authorizeInTransaction`
 * with this process's real singleton cache, primed before each write. If the
 * only channel were the in-process call, B would keep its stale snapshot; that
 * is the defect, and it is what the assertions below go red on when the
 * version comparison, the trigger, or a trigger event is removed.
 *
 * Every runtime read and write runs as the real least-privilege `awcms_app`
 * login (the file refuses to pass vacuously without it); fixtures are seeded
 * through the superuser channel; the operator writes run as the table OWNER.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test
} from "bun:test";

import {
  appRoleActivated,
  getAdminSql,
  getAppRoleSql,
  getOwnerSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { countQueries } from "./query-budget";
import { OWNER_GRANT_EXCLUDED_PERMISSION_KEYS } from "../../src/modules/_shared/owner-grant-exclusions";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  authorizeInTransaction,
  evaluateFieldAccessInTransaction
} from "../../src/modules/identity-access/application/access-guard";
import {
  insertAbacPolicy,
  setAbacPolicyActive,
  updateAbacPolicy
} from "../../src/modules/identity-access/application/abac-policy-directory";
import {
  createPolicy as createFlatPolicy,
  updatePolicy as updateFlatPolicy
} from "../../src/modules/identity-access/application/abac-admin";
import {
  loadActivePolicies,
  POLICY_CACHE_MAX_AGE_MS,
  readPolicyVersion,
  resetPolicyCache
} from "../../src/modules/identity-access/application/policy-cache";
import { validateAbacPolicyInput } from "../../src/modules/identity-access/domain/abac-policy";
import type { AbacPolicyValidated } from "../../src/modules/identity-access/domain/abac-policy";
import {
  generateSessionToken,
  hashSessionToken
} from "../../src/lib/auth/session-token";

const TENANT = "c1482c14-82c1-482c-8482-c1482c1482c1";
const OTHER_TENANT = "c1482c14-82c1-482c-8482-c1482c1482c2";

const GUARD = {
  moduleKey: "identity_access",
  activityCode: "access_control",
  action: "read"
} as const;

const ALWAYS = { allOf: [] };
const OWN_RESOURCE_ONLY = {
  attr: "resource.ownerTenantUserId",
  op: "eq",
  valueAttr: "subject.tenantUserId"
};

let tokenHash = "";
let ownerTenantUserId = "";

const ready = () => integrationEnabled && appRoleActivated;

async function seed(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'c1482', 'Cache 1482', 'active'),
           (${OTHER_TENANT}, 'c1482-other', 'Cache 1482 Other', 'active')
  `;

  const role = (await admin`
    INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
    VALUES (${TENANT}, 'owner', 'Owner', true)
    RETURNING id
  `) as { id: string }[];
  const roleId = role[0]!.id;

  await admin`
    INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
    SELECT ${TENANT}, ${roleId}, id FROM awcms_permissions
    WHERE (module_key || '.' || activity_code || '.' || action) NOT IN (
      SELECT jsonb_array_elements_text(${[...OWNER_GRANT_EXCLUDED_PERMISSION_KEYS]}::jsonb)
    )
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'owner')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities
      (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'owner-1482@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  const tenantUser = (await admin`
    INSERT INTO awcms_tenant_users (tenant_id, identity_id)
    VALUES (${TENANT}, ${identity[0]!.id})
    RETURNING id
  `) as { id: string }[];
  ownerTenantUserId = tenantUser[0]!.id;

  await admin`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id,
       granted_by_tenant_user_id)
    VALUES (${TENANT}, ${ownerTenantUserId}, ${roleId}, 'tenant', ${TENANT},
            ${ownerTenantUserId})
  `;

  const token = generateSessionToken();
  tokenHash = hashSessionToken(token);

  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${identity[0]!.id}, ${tokenHash}, now() + interval '1 hour')
  `;
}

/** Process B: one real authorization, as `awcms_app`, through the chokepoint. */
async function authorizeInB(): Promise<{
  allowed: boolean;
  queries: number;
}> {
  return withTenantOrThrow(getAppRoleSql(), TENANT, async (tx) => {
    const { result, queries } = await countQueries(tx, (counting) =>
      authorizeInTransaction(counting, TENANT, tokenHash, new Date(), GUARD)
    );

    return { allowed: result.allowed, queries };
  });
}

/** Process A: one committed write, as `awcms_app`, never touching B's cache. */
async function writeInA<T>(
  work: (tx: Bun.TransactionSQL) => Promise<T>
): Promise<T> {
  return withTenantOrThrow(getAppRoleSql(), TENANT, work);
}

function dsl(input: Record<string, unknown>): AbacPolicyValidated {
  const validation = validateAbacPolicyInput({
    moduleKey: GUARD.moduleKey,
    activityCode: GUARD.activityCode,
    action: GUARD.action,
    ...input
  });

  if (!validation.valid) {
    throw new Error(`fixture policy invalid: ${validation.errors.join("; ")}`);
  }

  return validation.value;
}

async function versionNow(): Promise<string> {
  return withTenantOrThrow(getAppRoleSql(), TENANT, (tx) =>
    readPolicyVersion(tx, TENANT)
  );
}

describe("ABAC policy cache across processes (Issue #1482)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    if (!integrationEnabled) return;
    await resetDatabase();
    resetPolicyCache();
    await seed();
  });

  afterEach(() => {
    setSystemTime();
  });

  test("runs as the real awcms_app login, or not at all", () => {
    if (!integrationEnabled) return;
    expect(appRoleActivated).toBe(true);
  });

  test("a deny created by A denies B's next authorization", async () => {
    if (!ready()) return;

    // B primes its cache with the empty policy set and allows.
    expect((await authorizeInB()).allowed).toBe(true);
    expect((await authorizeInB()).allowed).toBe(true);

    await writeInA((tx) =>
      insertAbacPolicy(
        tx,
        TENANT,
        dsl({ policyCode: "t1482.deny", effect: "deny", conditions: ALWAYS }),
        true
      )
    );

    expect((await authorizeInB()).allowed).toBe(false);
  });

  test("disabling and re-enabling a deny in A flips B both ways", async () => {
    if (!ready()) return;

    const deny = await writeInA((tx) =>
      insertAbacPolicy(
        tx,
        TENANT,
        dsl({ policyCode: "t1482.deny", effect: "deny", conditions: ALWAYS }),
        true
      )
    );
    expect((await authorizeInB()).allowed).toBe(false);

    await writeInA((tx) => setAbacPolicyActive(tx, TENANT, deny.id, false));
    expect((await authorizeInB()).allowed).toBe(true);

    await writeInA((tx) => setAbacPolicyActive(tx, TENANT, deny.id, true));
    expect((await authorizeInB()).allowed).toBe(false);
  });

  test("disabling the satisfied allow in A leaves B with only the unsatisfied one — deny", async () => {
    if (!ready()) return;

    const satisfied = await writeInA((tx) =>
      insertAbacPolicy(
        tx,
        TENANT,
        dsl({
          policyCode: "t1482.allow-any",
          effect: "allow",
          conditions: ALWAYS
        }),
        true
      )
    );
    await writeInA((tx) =>
      insertAbacPolicy(
        tx,
        TENANT,
        dsl({
          policyCode: "t1482.allow-own",
          effect: "allow",
          conditions: OWN_RESOURCE_ONLY
        }),
        true
      )
    );
    expect((await authorizeInB()).allowed).toBe(true);

    await writeInA((tx) =>
      setAbacPolicyActive(tx, TENANT, satisfied.id, false)
    );
    expect((await authorizeInB()).allowed).toBe(false);
  });

  test("narrowing an allow's condition in A (DSL update) denies B", async () => {
    if (!ready()) return;

    const allow = await writeInA((tx) =>
      insertAbacPolicy(
        tx,
        TENANT,
        dsl({ policyCode: "t1482.allow", effect: "allow", conditions: ALWAYS }),
        true
      )
    );
    expect((await authorizeInB()).allowed).toBe(true);

    await writeInA((tx) =>
      updateAbacPolicy(
        tx,
        TENANT,
        allow.id,
        dsl({
          policyCode: "t1482.allow",
          effect: "allow",
          conditions: OWN_RESOURCE_ONLY
        })
      )
    );
    expect((await authorizeInB()).allowed).toBe(false);
  });

  test("the flat #171 writers move the version too (no writer is exempt)", async () => {
    if (!ready()) return;

    const before = await versionNow();
    const flat = await writeInA((tx) =>
      createFlatPolicy(tx, TENANT, ownerTenantUserId, {
        policyCode: "t1482.flat",
        effect: "deny",
        description: null
      })
    );
    const afterCreate = await versionNow();
    expect(afterCreate).not.toBe(before);

    await writeInA((tx) =>
      updateFlatPolicy(tx, TENANT, ownerTenantUserId, flat.id, {
        isActive: false
      })
    );
    expect(await versionNow()).not.toBe(afterCreate);

    // Flat rows are inert (ADR-0033 §3): the decision does not change.
    expect((await authorizeInB()).allowed).toBe(true);
  });

  test("an operator DELETE and a TRUNCATE (table owner) are seen by B", async () => {
    if (!ready()) return;

    await writeInA((tx) =>
      insertAbacPolicy(
        tx,
        TENANT,
        dsl({ policyCode: "t1482.deny", effect: "deny", conditions: ALWAYS }),
        true
      )
    );
    expect((await authorizeInB()).allowed).toBe(false);

    await getOwnerSql().begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM awcms_abac_policies WHERE tenant_id = ${TENANT}`;
    });
    expect((await authorizeInB()).allowed).toBe(true);

    await writeInA((tx) =>
      insertAbacPolicy(
        tx,
        TENANT,
        dsl({ policyCode: "t1482.deny", effect: "deny", conditions: ALWAYS }),
        true
      )
    );
    expect((await authorizeInB()).allowed).toBe(false);

    await getOwnerSql()`TRUNCATE awcms_abac_policies`;
    expect((await authorizeInB()).allowed).toBe(true);
  });

  test("the version check adds no round trip to the chokepoint, and a hit reads no policies", async () => {
    if (!ready()) return;

    await writeInA((tx) =>
      insertAbacPolicy(
        tx,
        TENANT,
        dsl({ policyCode: "t1482.allow", effect: "allow", conditions: ALWAYS }),
        true
      )
    );

    // Miss: the policies are read once. Hit: they are not read at all, and the
    // version rode on the principal query. Budget pinned EXACTLY: the same
    // counts as before #1482 (measured on main 6ab60abc: 9 on a hit, 10 on a miss).
    const miss = await authorizeInB();
    const hit = await authorizeInB();

    expect(miss.allowed).toBe(true);
    expect(hit.allowed).toBe(true);
    expect(hit.queries).toBe(9);
    expect(miss.queries).toBe(hit.queries + 1);
  });

  test("a caller without an observed version pays one indexed read on a hit", async () => {
    if (!ready()) return;

    const run = () =>
      withTenantOrThrow(getAppRoleSql(), TENANT, (tx) =>
        countQueries(tx, (counting) => loadActivePolicies(counting, TENANT))
      );

    expect((await run()).queries).toBe(2);
    expect((await run()).queries).toBe(1);
  });

  test("awcms_app can read only its own tenant's version and can write none", async () => {
    if (!ready()) return;

    await writeInA((tx) =>
      insertAbacPolicy(
        tx,
        TENANT,
        dsl({ policyCode: "t1482.deny", effect: "deny", conditions: ALWAYS }),
        true
      )
    );
    await withTenantOrThrow(getAppRoleSql(), OTHER_TENANT, (tx) =>
      insertAbacPolicy(
        tx,
        OTHER_TENANT,
        dsl({ policyCode: "t1482.deny", effect: "deny", conditions: ALWAYS }),
        true
      )
    );

    const visible = await withTenantOrThrow(
      getAppRoleSql(),
      TENANT,
      (tx) => tx`SELECT tenant_id FROM awcms_abac_policy_versions`
    );
    expect(visible.map((row: { tenant_id: string }) => row.tenant_id)).toEqual([
      TENANT
    ]);

    const refused = async (
      statement: (tx: Bun.TransactionSQL) => Promise<unknown>
    ): Promise<string> => {
      try {
        await getAppRoleSql().begin(async (tx) => {
          await tx`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;
          await statement(tx);
        });
        return "accepted";
      } catch (error) {
        return String((error as { errno?: unknown }).errno ?? error);
      }
    };

    // 42501 insufficient_privilege, for every way of moving a version.
    expect(
      await refused(
        (tx) =>
          tx`UPDATE awcms_abac_policy_versions SET policy_version = 1 WHERE tenant_id = ${TENANT}`
      )
    ).toBe("42501");
    expect(
      await refused(
        (tx) =>
          tx`INSERT INTO awcms_abac_policy_versions (tenant_id, policy_version) VALUES (${TENANT}, 1)`
      )
    ).toBe("42501");
    expect(
      await refused(
        (tx) =>
          tx`DELETE FROM awcms_abac_policy_versions WHERE tenant_id = ${TENANT}`
      )
    ).toBe("42501");
    expect(
      await refused((tx) => tx`SELECT nextval('awcms_abac_policy_version_seq')`)
    ).toBe("42501");
  });
  test("a change the version cannot see (a restore reissuing a version) is bounded by the cache's age", async () => {
    if (!ready()) return;

    // B caches the empty policy set at the current version.
    expect((await authorizeInB()).allowed).toBe(true);

    // The M1 shape of a logical restore / PITR: a deny appears while the
    // tenant's version reads exactly what B cached. Reproduced by writing the
    // row with ordinary triggers off (replica mode), so the version row is
    // left untouched — the equality check is blind to it by construction.
    await getAdminSql().begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        INSERT INTO awcms_abac_policies
          (tenant_id, policy_code, effect, module_key, activity_code, action,
           dsl_version, priority, conditions, is_active, is_dsl_managed)
        VALUES (${TENANT}, 't1482.restored-deny', 'deny', ${GUARD.moduleKey},
                ${GUARD.activityCode}, ${GUARD.action}, 1, 100,
                ${ALWAYS}::jsonb, true, true)
      `;
    });

    // Within the bound B still serves its snapshot: this is the residual the
    // restore runbook (deploy/backup/README.md step 6) closes outright.
    expect((await authorizeInB()).allowed).toBe(true);

    // Past the bound the snapshot is reloaded whatever the version says.
    setSystemTime(new Date(Date.now() + POLICY_CACHE_MAX_AGE_MS + 1000));
    expect((await authorizeInB()).allowed).toBe(false);
  });

  test("an entry from the future (clock stepped back) is not served", async () => {
    if (!ready()) return;

    const real = Date.now();

    setSystemTime(new Date(real + 60_000));
    expect((await authorizeInB()).allowed).toBe(true);

    await getAdminSql().begin(async (tx) => {
      await tx`SET LOCAL session_replication_role = replica`;
      await tx`
        INSERT INTO awcms_abac_policies
          (tenant_id, policy_code, effect, module_key, activity_code, action,
           dsl_version, priority, conditions, is_active, is_dsl_managed)
        VALUES (${TENANT}, 't1482.restored-deny', 'deny', ${GUARD.moduleKey},
                ${GUARD.activityCode}, ${GUARD.action}, 1, 100,
                ${ALWAYS}::jsonb, true, true)
      `;
    });

    setSystemTime(new Date(real));
    expect((await authorizeInB()).allowed).toBe(false);
  });

  test("a field-access follow-up in the same transaction costs no query when handed the version", async () => {
    if (!ready()) return;

    const run = (passVersion: boolean) =>
      withTenantOrThrow(getAppRoleSql(), TENANT, async (tx) => {
        const auth = await authorizeInTransaction(
          tx,
          TENANT,
          tokenHash,
          new Date(),
          GUARD
        );

        if (!auth.allowed) throw new Error("fixture owner must be allowed");
        expect(auth.abacPolicyVersion).toBeDefined();

        return countQueries(tx, (counting) =>
          evaluateFieldAccessInTransaction(
            counting,
            TENANT,
            auth.context,
            auth.grantedPermissionKeys,
            {
              moduleKey: "visitor_analytics",
              activityCode: "raw_detail",
              action: "read"
            },
            new Date(),
            passVersion ? auth.abacPolicyVersion : undefined
          )
        );
      });

    await run(true); // warm the cache
    const handed = await run(true);
    const unhanded = await run(false);

    expect(handed.result).toBe(true);
    expect(handed.queries).toBe(0);
    expect(unhanded.queries).toBe(1);
  });
});
