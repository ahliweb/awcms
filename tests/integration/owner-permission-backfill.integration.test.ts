/**
 * `identity-access:permissions:backfill` against a real PostgreSQL under the
 * WORLD-1 ephemeral-database harness.
 *
 * What these prove, none of which a unit test can:
 *
 *   1. Dry-run really writes NOTHING — the default mode is safe on production.
 *   2. `--commit` grants exactly the post-dated permissions and audits it.
 *   3. A second commit run is a no-op (idempotent), not a duplicate-key failure.
 *   4. A deliberately removed OLDER permission survives the backfill.
 *   5. Only the `owner` system role is touched; custom roles are never widened.
 *   6. The real 403 this exists to fix actually disappears afterwards, checked
 *      through `authorizeInTransaction` rather than by reading the join table.
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
import { hashSessionToken } from "../../src/lib/auth/session-token";
import { authorizeInTransaction } from "../../src/modules/identity-access/application/access-guard";
import { runOwnerPermissionBackfill } from "../../src/modules/identity-access/application/owner-permission-backfill-job";
import { resetPolicyCache } from "../../src/modules/identity-access/application/policy-cache";

const TENANT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OWNER_USER = "e0000000-0000-4000-8000-000000000001";
const OWNER_ROLE = "e0000000-0000-4000-8000-0000000000a1";
const CUSTOM_ROLE = "e0000000-0000-4000-8000-0000000000a2";

const SESSION_TOKEN = "backfill-owner-session";

/** Stamped BEFORE the role: an original grant, so removing it is deliberate. */
const OLD_PERMISSION = {
  module: "blog_content",
  activity: "posts",
  action: "read"
} as const;

/** Stamped AFTER the role: exactly what a later permission-seed migration adds. */
const NEW_PERMISSION = {
  module: "identity_access",
  activity: "machine_credentials",
  action: "read"
} as const;

const OLD_KEY = `${OLD_PERMISSION.module}.${OLD_PERMISSION.activity}.${OLD_PERMISSION.action}`;
const NEW_KEY = `${NEW_PERMISSION.module}.${NEW_PERMISSION.activity}.${NEW_PERMISSION.action}`;

/**
 * The anchor is derived from the DATABASE, not from the clock. The catalog
 * these tests run against is the real one — ~206 permissions stamped `now()`
 * by the migrations, which run in `beforeAll`, i.e. AFTER this module is
 * loaded. A `new Date()` captured up here therefore sits BEFORE every catalog
 * row, and the rule would (correctly) offer to grant all 206 — faithful for a
 * genuinely old tenant, but it drowns the one distinction these tests pin.
 *
 * Anchoring the role just after the newest catalog row puts the entire real
 * catalog on the "older than the role" side, leaving exactly one post-dated
 * permission in view. Both permissions used below are REAL catalog rows
 * (`sql/035`-era and `sql/083`), not invented ones.
 */
let roleCreatedAt = new Date();

let ownerIdentity = "";
let oldPermissionId = "";
let newPermissionId = "";

async function seedFixtures(): Promise<void> {
  const admin = getAdminSql();

  await admin`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT}, 'backfill-tenant', 'Backfill Tenant')
  `;

  const profile = (await admin`
    INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
    VALUES (${TENANT}, 'person', 'Owner')
    RETURNING id
  `) as { id: string }[];
  const identity = (await admin`
    INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
    VALUES (${TENANT}, ${profile[0]!.id}, 'owner@example.test', 'x')
    RETURNING id
  `) as { id: string }[];
  ownerIdentity = identity[0]!.id;

  await admin`
    INSERT INTO awcms_tenant_users (id, tenant_id, identity_id)
    VALUES (${OWNER_USER}, ${TENANT}, ${ownerIdentity})
  `;

  const anchorRows = (await admin`
    SELECT max(created_at) AS newest FROM awcms_permissions
  `) as { newest: Date }[];
  roleCreatedAt = new Date(new Date(anchorRows[0]!.newest).getTime() + 1000);

  await admin`
    INSERT INTO awcms_roles (id, tenant_id, role_code, role_name, is_system, created_at)
    VALUES (${OWNER_ROLE}, ${TENANT}, 'owner', 'Owner', true, ${roleCreatedAt}),
           (${CUSTOM_ROLE}, ${TENANT}, 'editor', 'Editor', false, ${roleCreatedAt})
  `;

  // Post-date ONE real catalog row so it stands for "a permission a later
  // migration added": everything else in the catalog now predates the role.
  const newRows = (await admin`
    UPDATE awcms_permissions
    SET created_at = ${new Date(roleCreatedAt.getTime() + 1000)}
    WHERE module_key = ${NEW_PERMISSION.module}
      AND activity_code = ${NEW_PERMISSION.activity}
      AND action = ${NEW_PERMISSION.action}
    RETURNING id
  `) as { id: string }[];
  newPermissionId = newRows[0]!.id;

  const oldRows = (await admin`
    SELECT id FROM awcms_permissions
    WHERE module_key = ${OLD_PERMISSION.module}
      AND activity_code = ${OLD_PERMISSION.activity}
      AND action = ${OLD_PERMISSION.action}
  `) as { id: string }[];
  oldPermissionId = oldRows[0]!.id;

  // The tenant's owner holds NEITHER: the old one was removed on purpose, the
  // new one never existed when this tenant was created. That is precisely the
  // pair the rule has to tell apart.
  await admin`
    INSERT INTO awcms_access_policies
      (tenant_id, tenant_user_id, role_id, scope_type, scope_id, granted_by_tenant_user_id)
    VALUES (${TENANT}, ${OWNER_USER}, ${OWNER_ROLE}, 'tenant', ${TENANT}, ${OWNER_USER})
  `;

  await admin`
    INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at)
    VALUES (${TENANT}, ${ownerIdentity}, ${hashSessionToken(SESSION_TOKEN)}, now() + interval '1 hour')
  `;
}

async function grantedPermissionIds(roleId: string): Promise<string[]> {
  const rows = (await getAdminSql()`
    SELECT permission_id FROM awcms_role_permissions
    WHERE tenant_id = ${TENANT} AND role_id = ${roleId}
  `) as { permission_id: string }[];

  return rows.map((row) => row.permission_id);
}

const suite = integrationEnabled ? describe : describe.skip;

suite("owner permission backfill", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    resetPolicyCache();
    await seedFixtures();
  });

  test("dry-run writes nothing and still reports both buckets", async () => {
    const result = await runOwnerPermissionBackfill(getRuntimeSql(), {
      commit: false,
      now: new Date()
    });

    const tenant = result.tenants.find((t) => t.tenantId === TENANT);
    expect(tenant?.granted).toEqual([NEW_KEY]);
    // The rest of the real catalog predates this role, so it lands in the
    // "presumed deliberate" bucket alongside the one we removed on purpose.
    expect(tenant?.skippedAsDeliberate).toContain(OLD_KEY);
    expect(tenant?.skippedAsDeliberate).not.toContain(NEW_KEY);

    expect(await grantedPermissionIds(OWNER_ROLE)).toEqual([]);
  });

  test("--commit grants only the post-dated permission and audits it", async () => {
    await runOwnerPermissionBackfill(getRuntimeSql(), {
      commit: true,
      now: new Date()
    });

    const granted = await grantedPermissionIds(OWNER_ROLE);
    expect(granted).toEqual([newPermissionId]);
    expect(granted).not.toContain(oldPermissionId);

    const audits = (await getAdminSql()`
      SELECT action, attributes FROM awcms_audit_events
      WHERE tenant_id = ${TENANT} AND action = 'owner_role.permissions_backfilled'
    `) as { action: string; attributes: Record<string, unknown> }[];

    expect(audits).toHaveLength(1);
    expect(audits[0]?.attributes.grantedPermissionKeys).toEqual([NEW_KEY]);
  });

  test("a second commit run is a no-op, not a duplicate-key failure", async () => {
    await runOwnerPermissionBackfill(getRuntimeSql(), {
      commit: true,
      now: new Date()
    });
    const second = await runOwnerPermissionBackfill(getRuntimeSql(), {
      commit: true,
      now: new Date()
    });

    expect(second.totalGranted).toBe(0);
    expect(await grantedPermissionIds(OWNER_ROLE)).toEqual([newPermissionId]);

    const audits = (await getAdminSql()`
      SELECT count(*)::int AS n FROM awcms_audit_events
      WHERE tenant_id = ${TENANT} AND action = 'owner_role.permissions_backfilled'
    `) as { n: number }[];

    // No grants means no audit entry: a maintenance log that fires on every
    // no-op run trains its reader to ignore it.
    expect(audits[0]?.n).toBe(1);
  });

  test("custom roles are never widened", async () => {
    await runOwnerPermissionBackfill(getRuntimeSql(), {
      commit: true,
      now: new Date()
    });

    expect(await grantedPermissionIds(CUSTOM_ROLE)).toEqual([]);
  });

  test("the 403 it exists to fix really disappears", async () => {
    const guard = {
      moduleKey: NEW_PERMISSION.module,
      activityCode: NEW_PERMISSION.activity,
      action: NEW_PERMISSION.action
    } as const;
    const runtime = getRuntimeSql();

    const before = await withTenantOrThrow(runtime, TENANT, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT,
        hashSessionToken(SESSION_TOKEN),
        new Date(),
        guard
      )
    );
    expect(before.allowed).toBe(false);
    if (!before.allowed) expect(before.denied.status).toBe(403);

    await runOwnerPermissionBackfill(runtime, {
      commit: true,
      now: new Date()
    });

    const after = await withTenantOrThrow(runtime, TENANT, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT,
        hashSessionToken(SESSION_TOKEN),
        new Date(),
        guard
      )
    );
    expect(after.allowed).toBe(true);

    // …and the deliberately removed one is STILL denied afterwards.
    const stillDenied = await withTenantOrThrow(runtime, TENANT, (tx) =>
      authorizeInTransaction(
        tx,
        TENANT,
        hashSessionToken(SESSION_TOKEN),
        new Date(),
        {
          moduleKey: OLD_PERMISSION.module,
          activityCode: OLD_PERMISSION.activity,
          action: OLD_PERMISSION.action
        }
      )
    );
    expect(stillDenied.allowed).toBe(false);
  });

  test("--tenant limits the pass to one tenant", async () => {
    const admin = getAdminSql();
    await admin`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
      VALUES (gen_random_uuid(), 'other-tenant', 'Other Tenant')
    `;

    const result = await runOwnerPermissionBackfill(getRuntimeSql(), {
      commit: false,
      now: new Date(),
      tenantCode: "backfill-tenant"
    });

    expect(result.tenants).toHaveLength(1);
    expect(result.tenants[0]?.tenantCode).toBe("backfill-tenant");
  });
});
