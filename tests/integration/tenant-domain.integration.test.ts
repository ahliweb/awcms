/**
 * Integration tests for the `tenant_domain` module (ported from awcms-micro
 * epic #555) against a real PostgreSQL under the WORLD-1 ephemeral-database
 * harness. Proves, with real DDL/RLS/constraints (not mocks):
 *
 *   - the directory CRUD + verify + set-primary flows through the module's own
 *     application services inside `withTenant`;
 *   - the GLOBAL (cross-tenant) case-insensitive unique index on
 *     `normalized_hostname` — a hostname can map to only one tenant, and a soft
 *     delete frees it for reuse;
 *   - at-most-one active primary per tenant, and the atomic unset-then-set swap;
 *   - FORCE ROW LEVEL SECURITY tenant isolation, proven under the non-superuser
 *     `awcms_app` role (a direct SELECT without tenant context returns zero
 *     rows), AND that the SECURITY DEFINER bootstrap function (migration 048)
 *     is the one sanctioned read path that resolves a hostname -> tenant BEFORE
 *     any tenant context exists, never exposing verification_token_hash.
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
  appRoleActivated,
  assertRejected,
  getAdminSql,
  getAppRoleSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import {
  createTenantDomain,
  fetchActiveTenantDomain,
  listTenantDomains,
  setPrimaryTenantDomain,
  softDeleteTenantDomain,
  updateTenantDomain,
  verifyTenantDomain
} from "../../src/modules/tenant-domain/application/tenant-domain-directory";
import { resolvePublicTenantByHost } from "../../src/lib/tenant/public-host-tenant-resolver";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TENANT_INACTIVE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function seedTenants(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT_A}, 'tenant-a', 'Tenant A', 'active'),
      (${TENANT_B}, 'tenant-b', 'Tenant B', 'active'),
      (${TENANT_INACTIVE}, 'tenant-x', 'Tenant X', 'inactive')
    ON CONFLICT (id) DO NOTHING
  `;
}

function createInput(hostname: string, method: string | null = null) {
  return {
    hostname,
    normalizedHostname: hostname.toLowerCase(),
    domainType: "custom_domain" as const,
    routeMode: "canonical" as const,
    verificationMethod: method as
      "dns_txt" | "dns_cname" | "file" | "manual" | null,
    verificationRecordName: null,
    verificationRecordValue: null,
    redirectToPrimary: false
  };
}

const suite = integrationEnabled ? describe : describe.skip;

suite("tenant_domain module (integration)", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });
  afterAll(async () => {
    await teardownIntegrationDatabase();
  });
  beforeEach(async () => {
    await resetDatabase();
    await seedTenants();
  });

  test("create -> fetch -> list, verification_token_hash never returned", async () => {
    const runtime = getRuntimeSql();
    const created = await withTenant(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("A.Example.com"))
    );
    expect(created.hostname).toBe("A.Example.com");
    expect(created.normalizedHostname).toBe("a.example.com");
    expect(created.status).toBe("pending_verification");
    expect(created).not.toHaveProperty("verificationTokenHash");

    const fetched = await withTenant(runtime, TENANT_A, (tx) =>
      fetchActiveTenantDomain(tx, TENANT_A, created.id)
    );
    expect(fetched?.id).toBe(created.id);

    const page = await withTenant(runtime, TENANT_A, (tx) =>
      listTenantDomains(tx, TENANT_A)
    );
    expect(page.domains).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  test("normalized_hostname is globally unique across tenants (case-insensitive)", async () => {
    const runtime = getRuntimeSql();
    await withTenant(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("shared.example.com"))
    );
    const error = await assertRejected(
      withTenant(runtime, TENANT_B, (tx) =>
        createTenantDomain(
          tx,
          TENANT_B,
          ACTOR,
          createInput("SHARED.example.com")
        )
      ),
      "a duplicate normalized hostname in another tenant"
    );
    expect(error.message).toContain(
      "awcms_tenant_domains_normalized_hostname_dedup"
    );
  });

  test("soft delete frees the normalized hostname for reuse (even by another tenant)", async () => {
    const runtime = getRuntimeSql();
    const created = await withTenant(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("reuse.example.com"))
    );
    const deleted = await withTenant(runtime, TENANT_A, (tx) =>
      softDeleteTenantDomain(tx, TENANT_A, ACTOR, created.id, "moved off")
    );
    expect(deleted).toBe(true);

    // A soft-deleted row no longer resolves through the directory.
    const gone = await withTenant(runtime, TENANT_A, (tx) =>
      fetchActiveTenantDomain(tx, TENANT_A, created.id)
    );
    expect(gone).toBeNull();

    // The hostname is now reusable by a different tenant.
    const recreated = await withTenant(runtime, TENANT_B, (tx) =>
      createTenantDomain(tx, TENANT_B, ACTOR, createInput("reuse.example.com"))
    );
    expect(recreated.tenantId).toBe(TENANT_B);
  });

  test("verify: needs a method, is idempotent at active, refuses suspended", async () => {
    const runtime = getRuntimeSql();
    const created = await withTenant(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("v.example.com"))
    );

    // No verification_method configured yet.
    const noMethod = await withTenant(runtime, TENANT_A, (tx) =>
      verifyTenantDomain(tx, TENANT_A, ACTOR, created.id)
    );
    expect(noMethod.outcome).toBe("missing_verification_method");

    // Configure a method, then verify -> active.
    await withTenant(runtime, TENANT_A, (tx) =>
      updateTenantDomain(tx, TENANT_A, ACTOR, created.id, {
        verificationMethod: "manual"
      })
    );
    const verified = await withTenant(runtime, TENANT_A, (tx) =>
      verifyTenantDomain(tx, TENANT_A, ACTOR, created.id)
    );
    expect(verified.outcome).toBe("verified");
    if (verified.outcome !== "verified") return;
    expect(verified.entry.status).toBe("active");

    // Idempotent at active.
    const again = await withTenant(runtime, TENANT_A, (tx) =>
      verifyTenantDomain(tx, TENANT_A, ACTOR, created.id)
    );
    expect(again.outcome).toBe("verified");

    // Suspended cannot be verified back to active.
    await withTenant(runtime, TENANT_A, (tx) =>
      updateTenantDomain(tx, TENANT_A, ACTOR, created.id, {
        status: "suspended"
      })
    );
    const suspended = await withTenant(runtime, TENANT_A, (tx) =>
      verifyTenantDomain(tx, TENANT_A, ACTOR, created.id)
    );
    expect(suspended.outcome).toBe("not_verifiable");
  });

  test("set-primary: only an active domain, at most one primary per tenant", async () => {
    const runtime = getRuntimeSql();
    const first = await withTenant(runtime, TENANT_A, (tx) =>
      createTenantDomain(
        tx,
        TENANT_A,
        ACTOR,
        createInput("one.example.com", "manual")
      )
    );
    const second = await withTenant(runtime, TENANT_A, (tx) =>
      createTenantDomain(
        tx,
        TENANT_A,
        ACTOR,
        createInput("two.example.com", "manual")
      )
    );

    // A pending domain cannot become primary.
    const notActive = await withTenant(runtime, TENANT_A, (tx) =>
      setPrimaryTenantDomain(tx, TENANT_A, ACTOR, first.id)
    );
    expect(notActive.outcome).toBe("not_active");

    // Verify both, set first primary, then switch to second — only one primary.
    await withTenant(runtime, TENANT_A, (tx) =>
      verifyTenantDomain(tx, TENANT_A, ACTOR, first.id)
    );
    await withTenant(runtime, TENANT_A, (tx) =>
      verifyTenantDomain(tx, TENANT_A, ACTOR, second.id)
    );
    const setFirst = await withTenant(runtime, TENANT_A, (tx) =>
      setPrimaryTenantDomain(tx, TENANT_A, ACTOR, first.id)
    );
    expect(setFirst.outcome).toBe("set");
    const setSecond = await withTenant(runtime, TENANT_A, (tx) =>
      setPrimaryTenantDomain(tx, TENANT_A, ACTOR, second.id)
    );
    expect(setSecond.outcome).toBe("set");

    const page = await withTenant(runtime, TENANT_A, (tx) =>
      listTenantDomains(tx, TENANT_A)
    );
    const primaries = page.domains.filter((d) => d.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id).toBe(second.id);
  });

  test("cross-tenant isolation: tenant A cannot read tenant B's domain by id", async () => {
    const runtime = getRuntimeSql();
    const bDomain = await withTenant(runtime, TENANT_B, (tx) =>
      createTenantDomain(tx, TENANT_B, ACTOR, createInput("b-only.example.com"))
    );
    const asA = await withTenant(runtime, TENANT_A, (tx) =>
      fetchActiveTenantDomain(tx, TENANT_A, bDomain.id)
    );
    expect(asA).toBeNull();
  });

  test("RLS: awcms_app cannot SELECT the table without tenant context, but the SECURITY DEFINER lookup resolves an active domain", async () => {
    if (!appRoleActivated) {
      // Without migration 019's awcms_app role the FORCE-RLS bypass proof is
      // not meaningful (owner-superuser bypasses RLS unconditionally).
      return;
    }

    const runtime = getRuntimeSql();
    // Create an active, verified domain for the active tenant A.
    const created = await withTenant(runtime, TENANT_A, (tx) =>
      createTenantDomain(
        tx,
        TENANT_A,
        ACTOR,
        createInput("live.example.com", "manual")
      )
    );
    await withTenant(runtime, TENANT_A, (tx) =>
      verifyTenantDomain(tx, TENANT_A, ACTOR, created.id)
    );

    const app = getAppRoleSql();

    // A direct SELECT with NO app.current_tenant_id set returns zero rows
    // (fail-closed default GUC + FORCE RLS).
    const direct = (await app`
      SELECT id FROM awcms_tenant_domains WHERE normalized_hostname = 'live.example.com'
    `) as { id: string }[];
    expect(direct).toHaveLength(0);

    // The SECURITY DEFINER lookup function IS the sanctioned bootstrap read.
    const resolved = await resolvePublicTenantByHost(app, "live.example.com");
    expect(resolved?.tenantId).toBe(TENANT_A);
    expect(resolved?.tenantCode).toBe("tenant-a");

    // The lookup never exposes a secret column.
    const lookupRows = (await app`
      SELECT * FROM awcms_resolve_tenant_domain_lookup('live.example.com')
    `) as Record<string, unknown>[];
    expect(lookupRows).toHaveLength(1);
    expect(lookupRows[0]).not.toHaveProperty("verification_token_hash");
    expect(lookupRows[0]).not.toHaveProperty("verification_record_value");
    expect(lookupRows[0]).not.toHaveProperty("hostname");
  });

  test("resolver does not resolve a non-active domain or an inactive tenant", async () => {
    if (!appRoleActivated) return;
    const runtime = getRuntimeSql();

    // Pending domain under an active tenant -> not resolved.
    await withTenant(runtime, TENANT_A, (tx) =>
      createTenantDomain(
        tx,
        TENANT_A,
        ACTOR,
        createInput("pending.example.com")
      )
    );
    // Active domain under an INACTIVE tenant -> not resolved.
    const onInactive = await withTenant(runtime, TENANT_INACTIVE, (tx) =>
      createTenantDomain(
        tx,
        TENANT_INACTIVE,
        ACTOR,
        createInput("inactive-tenant.example.com", "manual")
      )
    );
    await withTenant(runtime, TENANT_INACTIVE, (tx) =>
      verifyTenantDomain(tx, TENANT_INACTIVE, ACTOR, onInactive.id)
    );

    const app = getAppRoleSql();
    expect(
      await resolvePublicTenantByHost(app, "pending.example.com")
    ).toBeNull();
    expect(
      await resolvePublicTenantByHost(app, "inactive-tenant.example.com")
    ).toBeNull();
    expect(
      await resolvePublicTenantByHost(app, "never.example.com")
    ).toBeNull();
  });
});
