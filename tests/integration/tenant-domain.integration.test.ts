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
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import {
  createTenantDomain,
  fetchActiveTenantDomain,
  listTenantDomains,
  setPrimaryTenantDomain,
  softDeleteTenantDomain,
  updateTenantDomain,
  beginTenantDomainVerification,
  completeTenantDomainVerification
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

function createInput(hostname: string) {
  return {
    hostname,
    normalizedHostname: hostname.toLowerCase(),
    domainType: "custom_domain" as const,
    routeMode: "canonical" as const,
    redirectToPrimary: false
  };
}

/**
 * The two-phase verification of ADR-0106, with the DNS half assumed to have
 * passed. The lookup itself is a pure function of the resolver's answer and is
 * covered by `tests/tenant-domain-dns-verification.test.ts` — what these
 * integration tests are for is the two transactions either side of it, which
 * is the part that needs a real database.
 */
async function activateByVerification(
  runtime: Bun.SQL,
  tenantId: string,
  domainId: string,
  passed = true
) {
  const begun = await withTenantOrThrow(runtime, tenantId, (tx) =>
    beginTenantDomainVerification(tx, tenantId, ACTOR, domainId)
  );

  if (begun.outcome !== "challenge_ready") {
    return begun;
  }

  return withTenantOrThrow(runtime, tenantId, (tx) =>
    completeTenantDomainVerification(
      tx,
      tenantId,
      ACTOR,
      domainId,
      begun.recordValue,
      passed
    )
  );
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
    const created = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("A.Example.com"))
    );
    expect(created.hostname).toBe("A.Example.com");
    expect(created.normalizedHostname).toBe("a.example.com");
    expect(created.status).toBe("pending_verification");
    expect(created).not.toHaveProperty("verificationTokenHash");

    const fetched = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchActiveTenantDomain(tx, TENANT_A, created.id)
    );
    expect(fetched?.id).toBe(created.id);

    const page = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      listTenantDomains(tx, TENANT_A)
    );
    expect(page.domains).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  test("normalized_hostname is globally unique across tenants (case-insensitive)", async () => {
    const runtime = getRuntimeSql();
    await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("shared.example.com"))
    );
    const error = await assertRejected(
      withTenantOrThrow(runtime, TENANT_B, (tx) =>
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
    const created = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("reuse.example.com"))
    );
    const deleted = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      softDeleteTenantDomain(tx, TENANT_A, ACTOR, created.id, "moved off")
    );
    expect(deleted).toBe(true);

    // A soft-deleted row no longer resolves through the directory.
    const gone = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchActiveTenantDomain(tx, TENANT_A, created.id)
    );
    expect(gone).toBeNull();

    // The hostname is now reusable by a different tenant.
    const recreated = await withTenantOrThrow(runtime, TENANT_B, (tx) =>
      createTenantDomain(tx, TENANT_B, ACTOR, createInput("reuse.example.com"))
    );
    expect(recreated.tenantId).toBe(TENANT_B);
  });

  test("verify: creation mints a challenge, a proof activates, a miss records failed", async () => {
    const runtime = getRuntimeSql();
    const created = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("v.example.com"))
    );

    // ADR-0106: the challenge exists from the moment the row does, so the old
    // `missing_verification_method` state is unreachable for new rows.
    expect(created.verificationMethod).toBe("dns_txt");
    expect(created.verificationRecordName).toBe("_awcms-verify.v.example.com");
    expect(created.verificationRecordValue).toStartWith(
      "awcms-site-verification="
    );

    // A check that did NOT find the record records `failed` — distinguishable
    // from "nobody has looked yet", and it leaves `failed` reachable.
    const missed = await activateByVerification(
      runtime,
      TENANT_A,
      created.id,
      false
    );
    expect(missed.outcome).toBe("not_verified");
    if (missed.outcome !== "not_verified") return;
    expect(missed.entry.status).toBe("failed");
    expect(missed.entry.lastCheckedAt).not.toBeNull();
    expect(missed.entry.verifiedAt).toBeNull();

    // `failed` is re-verifiable — it describes a moment, not a sentence.
    const verified = await activateByVerification(
      runtime,
      TENANT_A,
      created.id
    );
    expect(verified.outcome).toBe("verified");
    if (verified.outcome !== "verified") return;
    expect(verified.entry.status).toBe("active");
    expect(verified.entry.verifiedAt).not.toBeNull();

    // Idempotent at active, and short-circuited before any lookup.
    const again = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      beginTenantDomainVerification(tx, TENANT_A, ACTOR, created.id)
    );
    expect(again.outcome).toBe("already_active");

    // Suspended cannot be verified back to active.
    await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      updateTenantDomain(tx, TENANT_A, ACTOR, created.id, {
        status: "suspended"
      })
    );
    const suspended = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      beginTenantDomainVerification(tx, TENANT_A, ACTOR, created.id)
    );
    expect(suspended.outcome).toBe("not_verifiable");
  });

  test("verify: a proof of a superseded challenge cannot be cashed in", async () => {
    // The reason phase 3 carries the proven value into its WHERE clause. The
    // row is unlocked between the two transactions; a challenge re-issued (or
    // a row suspended) in that window must not be activated by a proof of the
    // value it used to have.
    const runtime = getRuntimeSql();
    const created = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("race.example.com"))
    );

    const stale = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      completeTenantDomainVerification(
        tx,
        TENANT_A,
        ACTOR,
        created.id,
        "awcms-site-verification=a-value-this-row-never-had",
        true
      )
    );

    expect(stale.outcome).toBe("stale");

    const unchanged = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      fetchActiveTenantDomain(tx, TENANT_A, created.id)
    );
    expect(unchanged?.status).toBe("pending_verification");
  });

  test("verify: a row created before ADR-0106 is issued a challenge, not activated", async () => {
    // Pre-ADR rows carry `verification_method = NULL` and no challenge. There
    // is no backfill migration: the challenge is minted on first verify, and
    // the caller is told to publish it rather than having a record invented one
    // millisecond ago looked up.
    const runtime = getRuntimeSql();
    const created = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("legacy.example.com"))
    );

    // Reproduce the old shape directly — the API can no longer produce it.
    await withTenantOrThrow(
      runtime,
      TENANT_A,
      (tx) =>
        tx`
        UPDATE awcms_tenant_domains
        SET verification_method = NULL,
            verification_record_name = NULL,
            verification_record_value = NULL
        WHERE tenant_id = ${TENANT_A} AND id = ${created.id}
      `
    );

    const issued = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      beginTenantDomainVerification(tx, TENANT_A, ACTOR, created.id)
    );

    expect(issued.outcome).toBe("challenge_issued");
    if (issued.outcome !== "challenge_issued") return;
    expect(issued.entry.status).toBe("pending_verification");
    expect(issued.entry.verificationMethod).toBe("dns_txt");
    expect(issued.entry.verificationRecordValue).toStartWith(
      "awcms-site-verification="
    );

    // Second call finds the challenge already there and asks for a lookup.
    const ready = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      beginTenantDomainVerification(tx, TENANT_A, ACTOR, created.id)
    );
    expect(ready.outcome).toBe("challenge_ready");
    if (ready.outcome !== "challenge_ready") return;
    expect(ready.recordValue).toBe(issued.entry.verificationRecordValue!);
  });

  test("set-primary: only an active domain, at most one primary per tenant", async () => {
    const runtime = getRuntimeSql();
    const first = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("one.example.com"))
    );
    const second = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("two.example.com"))
    );

    // A pending domain cannot become primary.
    const notActive = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      setPrimaryTenantDomain(tx, TENANT_A, ACTOR, first.id)
    );
    expect(notActive.outcome).toBe("not_active");

    // Verify both, set first primary, then switch to second — only one primary.
    await activateByVerification(runtime, TENANT_A, first.id);
    await activateByVerification(runtime, TENANT_A, second.id);
    const setFirst = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      setPrimaryTenantDomain(tx, TENANT_A, ACTOR, first.id)
    );
    expect(setFirst.outcome).toBe("set");
    const setSecond = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      setPrimaryTenantDomain(tx, TENANT_A, ACTOR, second.id)
    );
    expect(setSecond.outcome).toBe("set");

    const page = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      listTenantDomains(tx, TENANT_A)
    );
    const primaries = page.domains.filter((d) => d.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id).toBe(second.id);
  });

  test("cross-tenant isolation: tenant A cannot read tenant B's domain by id", async () => {
    const runtime = getRuntimeSql();
    const bDomain = await withTenantOrThrow(runtime, TENANT_B, (tx) =>
      createTenantDomain(tx, TENANT_B, ACTOR, createInput("b-only.example.com"))
    );
    const asA = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
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
    const created = await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(tx, TENANT_A, ACTOR, createInput("live.example.com"))
    );
    await activateByVerification(runtime, TENANT_A, created.id);

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
    await withTenantOrThrow(runtime, TENANT_A, (tx) =>
      createTenantDomain(
        tx,
        TENANT_A,
        ACTOR,
        createInput("pending.example.com")
      )
    );
    // Active domain under an INACTIVE tenant -> not resolved.
    const onInactive = await withTenantOrThrow(runtime, TENANT_INACTIVE, (tx) =>
      createTenantDomain(
        tx,
        TENANT_INACTIVE,
        ACTOR,
        createInput("inactive-tenant.example.com")
      )
    );
    await activateByVerification(runtime, TENANT_INACTIVE, onInactive.id);

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
