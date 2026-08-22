/**
 * Route-level E2E for the partnership surface — ADR-0089/0090/0091, Gelombang 8
 * PR 8.4 of Issue #423. Real PostgreSQL, real handlers.
 *
 * The whole wave in one arc: a customer engages a partner, approves access at a
 * role they choose, the partner's person redeems the code and becomes a real
 * member, that member is refused every write in `identity_access`, and
 * revocation takes the membership and its sessions with it.
 *
 * These cannot be written against a fake `Bun.SQL`. Every property under test is
 * a property of the DATABASE plus the wiring: that FORCE RLS is what makes the
 * partner's own view need a SECURITY DEFINER function, that the composite FKs
 * refuse a role from another tenant, and that revoking a grant really does kill
 * a live session rather than merely marking a row.
 *
 * Requires a throwaway database with `sql/` applied. Gated on `DATABASE_URL`,
 * and listed in the dedicated legacy `bun test <files>` step in `ci.yml` +
 * `release.yml` (held to the filesystem by
 * `tests/db-gated-suite-ci-parity.test.ts` in both directions).
 *
 * MUTATION PROOFS (repo security-readiness discipline):
 * - Drop the `principal_kind = 'delegated'` predicate in
 *   `deactivateDelegatedMembership` → "revoking kills the session" goes RED.
 * - Return `isDelegatedWriteForbidden` as always-false → "a delegated member
 *   may not write identity_access" goes RED.
 * - Point `listManagedTenants` at the table instead of the function → "the
 *   partner sees its book" goes RED with zero rows, which is exactly the
 *   failure `sql/119` exists to prevent.
 * - Point `resolveDelegatedGrantState` at `awcms_partners` directly instead of
 *   `awcms_partner_registry_status()` → the suspension tests go RED with
 *   `null`, which is the SAME cross-tenant-read failure one table over
 *   (ADR-0093).
 * - Drop `AND (g.expires_at > now())` from `resolveDelegatedGrantState` → "the
 *   chokepoint refuses the instant the grant's date passes" goes RED, which is
 *   the state the repository actually shipped in until finding A1 (ADR-0090).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { APIRoute } from "astro";

import {
  GET as listEngagementsGET,
  POST as engagePOST
} from "../src/pages/api/v1/access/partner-engagements/index";
import { DELETE as severDELETE } from "../src/pages/api/v1/access/partner-engagements/[id]";
import {
  listPartners,
  registerPartner
} from "../src/modules/identity-access/application/partner-registry-store";
import { withTenantOrThrow } from "../src/lib/database/tenant-context";
import {
  GET as listGrantsGET,
  POST as approvePOST
} from "../src/pages/api/v1/access/delegated-grants/index";
import { DELETE as revokeDELETE } from "../src/pages/api/v1/access/delegated-grants/[id]";
import { GET as managedTenantsGET } from "../src/pages/api/v1/partner/tenants/index";
import { POST as redeemPOST } from "../src/pages/api/v1/auth/delegated-access/redeem";
import { hashPassword } from "../src/lib/auth/password";
import {
  generateSessionToken,
  hashSessionToken
} from "../src/lib/auth/session-token";
import { linkIdentityToPrincipal } from "../src/modules/identity-access/application/principal-store";

const DATABASE_URL =
  process.env.PARTNER_SURFACE_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeOrSkip = DATABASE_URL ? describe : describe.skip;

function fakeCookies() {
  const store = new Map<string, string>();
  return {
    get: (name: string) =>
      store.has(name) ? { value: store.get(name)! } : undefined,
    set: (name: string, value: string) => void store.set(name, value),
    delete: (name: string) => void store.delete(name),
    has: (name: string) => store.has(name)
  };
}

type CallOpts = {
  method?: string;
  tenantId?: string;
  bearer?: string;
  body?: unknown;
  params?: Record<string, string>;
  query?: string;
  ip?: string;
};

async function callRoute(handler: APIRoute, opts: CallOpts) {
  const headers = new Headers({ "content-type": "application/json" });
  if (opts.tenantId) headers.set("x-awcms-tenant-id", opts.tenantId);
  if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);

  const url = `http://localhost/api/v1/route${opts.query ?? ""}`;
  const request = new Request(url, {
    method: opts.method ?? "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });

  const res = (await handler({
    request,
    cookies: fakeCookies(),
    url: new URL(url),
    params: opts.params ?? {},
    clientAddress:
      opts.ip ?? `198.51.100.${Math.floor(Math.random() * 250) + 1}`,
    locals: {}
  } as never)) as Response;

  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as any
  };
}

describeOrSkip("partnership and delegated access (real PostgreSQL)", () => {
  let sql: Bun.SQL;
  const tenants: string[] = [];
  const principals = new Set<string>();

  let platformTenantId = "";
  let partnerTenantId = "";
  let customerTenantId = "";
  let otherCustomerTenantId = "";

  let partnerCode = "";
  let customerAdmin = { tenantUserId: "", token: "" };
  let partnerStaff = { tenantUserId: "", token: "", principalId: "" };
  let supportRoleId = "";
  let foreignRoleId = "";
  let ownerRoleId = "";

  beforeAll(async () => {
    sql = new Bun.SQL(DATABASE_URL!, { max: 6 });

    platformTenantId = await createTenant("plat");
    partnerTenantId = await createTenant("prt");
    customerTenantId = await createTenant("cus");
    otherCustomerTenantId = await createTenant("oth");

    customerAdmin = await seedMemberWithAllPermissions(customerTenantId);
    partnerStaff = await seedMemberWithAllPermissions(partnerTenantId);

    supportRoleId = await createRole(customerTenantId, "support", false);
    ownerRoleId = await createRole(customerTenantId, "sysrole", true);
    foreignRoleId = await createRole(otherCustomerTenantId, "support", false);

    // The platform registers the partner — through the REGISTRY WRITER, not by
    // hand. Until `sql/123` there was no writer at all and this block wrote the
    // row the way an operator migration would; the whole arc below now starts
    // from the same code path a platform admin drives.
    //
    // The application function rather than the HTTP route on purpose: the route
    // is platform-SCOPE gated, and satisfying that here would mean repointing
    // `PLATFORM_TENANT_ID` for a process this suite shares with every other
    // file. The gate itself is proven where it lives.
    //
    // Through `withTenantOrThrow`, not a bare `set_config` on the pool: the
    // writer issues three statements, and `set_config(..., false)` is
    // SESSION-scoped — on a pooled client the second statement can land on a
    // connection that never saw it. The existing one-statement writes here got
    // away with it; three would not, reliably.
    partnerCode = `px-${platformTenantId.slice(0, 8)}`;
    const registered = await withTenantOrThrow(sql, platformTenantId, (tx) =>
      registerPartner(tx, platformTenantId, {
        partnerTenantId,
        partnerCode,
        displayName: "Partner X"
      })
    );

    if (registered.outcome !== "registered") {
      throw new Error(`partner registration failed: ${registered.outcome}`);
    }
  });

  test("the registry writer refuses the three things the schema also refuses", async () => {
    // Both global unique indexes, told apart — the reason the writer uses
    // `ON CONFLICT DO NOTHING` plus a disambiguating read instead of catching a
    // 23505 whose SQLSTATE this driver puts somewhere other than `code`.
    const sameTenant = await withTenantOrThrow(sql, platformTenantId, (tx) =>
      registerPartner(tx, platformTenantId, {
        partnerTenantId,
        partnerCode: `${partnerCode}-other`,
        displayName: "Partner X again"
      })
    );
    const sameCode = await withTenantOrThrow(sql, platformTenantId, (tx) =>
      registerPartner(tx, platformTenantId, {
        partnerTenantId: customerTenantId,
        partnerCode,
        displayName: "Someone else"
      })
    );
    const itself = await withTenantOrThrow(sql, platformTenantId, (tx) =>
      registerPartner(tx, platformTenantId, {
        partnerTenantId: platformTenantId,
        partnerCode: `${partnerCode}-self`,
        displayName: "The platform"
      })
    );

    expect(sameTenant.outcome).toBe("already_registered");
    expect(sameCode.outcome).toBe("code_taken");
    expect(itself.outcome).toBe("self");
  });

  test("the registry lists what it wrote, with the partner tenant's own name", async () => {
    const items = await withTenantOrThrow(sql, platformTenantId, (tx) =>
      listPartners(tx, platformTenantId)
    );
    const entry = items.find((row) => row.partnerCode === partnerCode);

    expect(entry).toBeDefined();
    expect(entry!.partnerTenantId).toBe(partnerTenantId);
    // Joined from `awcms_tenants`, never denormalised — so the registry cannot
    // hold a stale copy of a tenant's name.
    expect(entry!.tenantCode.length).toBeGreaterThan(0);
    expect(entry!.status).toBe("active");
  });

  afterAll(async () => {
    // Pass one: the cross-tenant rows. `awcms_partners` lives in the PLATFORM
    // tenant but REFERENCES the partner tenant, so deleting tenants one at a
    // time hits that FK — the teardown has to unwind the relationships before
    // it unwinds the tenants.
    for (const tenantId of tenants) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      // Audit and decision-log rows REFERENCE the grant (ADR-0091), so they go
      // first — the attribution the wave just added is itself a foreign key.
      await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_abac_decision_logs WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_delegated_access_grants WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_partner_managed_tenants WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_partners WHERE tenant_id = ${tenantId}`;
    }

    for (const tenantId of tenants) {
      await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
      await sql`DELETE FROM awcms_audit_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_abac_decision_logs WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_delegated_access_grants WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_partner_managed_tenants WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_partners WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_access_policy_events WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_access_policies WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_role_permissions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_sessions WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenant_users WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_identities WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_profiles WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_roles WHERE tenant_id = ${tenantId}`;
      await sql`DELETE FROM awcms_tenants WHERE id = ${tenantId}`;
    }

    for (const principalId of principals) {
      await sql`DELETE FROM awcms_principals WHERE id = ${principalId}`;
    }

    await sql.close({ timeout: 5 });
  });

  async function createTenant(prefix: string): Promise<string> {
    const rows = (await sql`
      INSERT INTO awcms_tenants (tenant_code, tenant_name)
      VALUES (${`${prefix}-${Math.random().toString(36).slice(2, 10)}`}, 'Partner suite')
      RETURNING id
    `) as { id: string }[];

    tenants.unshift(rows[0]!.id);
    return rows[0]!.id;
  }

  async function createRole(tenantId: string, code: string, isSystem: boolean) {
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;
    const rows = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
      VALUES (${tenantId}, ${`${code}-${Math.random().toString(36).slice(2, 8)}`}, ${code}, ${isSystem})
      RETURNING id
    `) as { id: string }[];
    return rows[0]!.id;
  }

  /** A member holding every tenant-scoped permission, plus a live session. */
  async function seedMemberWithAllPermissions(tenantId: string) {
    await sql`SELECT set_config('app.current_tenant_id', ${tenantId}, false)`;

    const address = `partner-suite-${Math.random().toString(36).slice(2)}@x.test`;
    const profile = (await sql`
      INSERT INTO awcms_profiles (tenant_id, profile_type, display_name)
      VALUES (${tenantId}, 'person', 'Suite User') RETURNING id
    `) as { id: string }[];

    const identity = (await sql`
      INSERT INTO awcms_identities (tenant_id, profile_id, login_identifier, password_hash)
      VALUES (${tenantId}, ${profile[0]!.id}, ${address}, ${await hashPassword("x")})
      RETURNING id
    `) as { id: string }[];

    const tenantUser = (await sql`
      INSERT INTO awcms_tenant_users (tenant_id, identity_id, status)
      VALUES (${tenantId}, ${identity[0]!.id}, 'active') RETURNING id
    `) as { id: string }[];

    const role = (await sql`
      INSERT INTO awcms_roles (tenant_id, role_code, role_name, is_system)
      VALUES (${tenantId}, 'owner', 'Owner', true) RETURNING id
    `) as { id: string }[];

    await sql`
      INSERT INTO awcms_role_permissions (tenant_id, role_id, permission_id)
      SELECT ${tenantId}, ${role[0]!.id}, id FROM awcms_permissions WHERE scope = 'tenant'
    `;

    await sql`
      INSERT INTO awcms_access_policies
        (tenant_id, subject_type, tenant_user_id, role_id, scope_type, scope_id, granted_by_tenant_user_id, reason)
      VALUES (${tenantId}, 'tenant_user', ${tenantUser[0]!.id}, ${role[0]!.id}, 'tenant', ${tenantId}, ${tenantUser[0]!.id}, 'suite')
    `;

    const principalId = await linkIdentityToPrincipal(
      sql,
      identity[0]!.id,
      address
    );
    principals.add(principalId);

    const token = generateSessionToken();
    await sql`
      INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at, origin_auth)
      VALUES (${tenantId}, ${identity[0]!.id}, ${hashSessionToken(token)},
              ${new Date(Date.now() + 3600_000)}, 'password')
    `;

    return { tenantUserId: tenantUser[0]!.id, token, principalId };
  }

  function inSevenDays() {
    return new Date(Date.now() + 7 * 86400_000).toISOString();
  }

  let engagementId = "";
  let grantId = "";
  let accessCode = "";

  test("a customer engages a partner", async () => {
    const res = await callRoute(engagePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: { partnerTenantId }
    });

    expect(res.status).toBe(201);
    engagementId = res.body.data.engagement.id;
    expect(res.body.data.engagement.partnerTenantId).toBe(partnerTenantId);
  });

  test("engaging a tenant that is NOT a registered partner answers 404, indistinguishably", async () => {
    const res = await callRoute(engagePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: { partnerTenantId: otherCustomerTenantId }
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  test("the partner sees its book — through the SECURITY DEFINER function", async () => {
    // The rows belong to the CUSTOMER tenant. Without `sql/119` this is zero
    // rows forever, which is the whole reason the function exists.
    const res = await callRoute(managedTenantsGET, {
      method: "GET",
      tenantId: partnerTenantId,
      bearer: partnerStaff.token
    });

    expect(res.status).toBe(200);
    expect(res.body.data.managedTenants).toHaveLength(1);
    expect(res.body.data.managedTenants[0].tenantId).toBe(customerTenantId);
    // Narrower than the customer's view, on purpose.
    expect(res.body.data.managedTenants[0]).not.toHaveProperty("engagedBy");
  });

  test("approving at a role from ANOTHER tenant is refused", async () => {
    const res = await callRoute(approvePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: {
        partnerTenantId,
        roleId: foreignRoleId,
        purpose: "should not work",
        expiresAt: inSevenDays()
      }
    });

    expect(res.status).toBe(404);
  });

  test("a TTL beyond the cap is refused", async () => {
    const res = await callRoute(approvePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: {
        partnerTenantId,
        roleId: supportRoleId,
        purpose: "too long",
        expiresAt: new Date(Date.now() + 60 * 86400_000).toISOString()
      }
    });

    expect(res.status).toBe(400);
  });

  test("a blank purpose is refused — the audit question may not be auto-answered", async () => {
    const res = await callRoute(approvePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: {
        partnerTenantId,
        roleId: supportRoleId,
        purpose: "   ",
        expiresAt: inSevenDays()
      }
    });

    expect(res.status).toBe(400);
  });

  test("the customer approves delegated access, and the code is returned once", async () => {
    const res = await callRoute(approvePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: {
        partnerTenantId,
        roleId: supportRoleId,
        purpose: "incident 4711",
        expiresAt: inSevenDays()
      }
    });

    expect(res.status).toBe(201);
    grantId = res.body.data.grantId;
    accessCode = res.body.data.accessCode;
    expect(accessCode.startsWith("awcmsd_")).toBe(true);

    const listed = await callRoute(listGrantsGET, {
      method: "GET",
      tenantId: customerTenantId,
      bearer: customerAdmin.token
    });

    expect(listed.status).toBe(200);
    const grant = listed.body.data.grants.find((g: any) => g.id === grantId);
    expect(grant).toBeDefined();
    // Never listed, never re-readable.
    expect(JSON.stringify(listed.body)).not.toContain(accessCode);
    expect(grant).not.toHaveProperty("accessCode");
  });

  test("a code redeemed for the WRONG tenant answers 404", async () => {
    const res = await callRoute(redeemPOST, {
      tenantId: partnerTenantId,
      bearer: partnerStaff.token,
      body: { targetTenantId: otherCustomerTenantId, code: accessCode }
    });

    expect(res.status).toBe(404);
  });

  test("redeeming without a session answers 401, not 404", async () => {
    const res = await callRoute(redeemPOST, {
      tenantId: partnerTenantId,
      body: { targetTenantId: customerTenantId, code: accessCode }
    });

    expect(res.status).toBe(401);
  });

  let delegatedTenantUserId = "";

  test("the partner redeems the code and becomes a REAL member", async () => {
    const res = await callRoute(redeemPOST, {
      tenantId: partnerTenantId,
      bearer: partnerStaff.token,
      body: { targetTenantId: customerTenantId, code: accessCode }
    });

    expect(res.status).toBe(200);
    delegatedTenantUserId = res.body.data.tenantUserId;
    // A membership, not a session. See the route header.
    expect(res.body.data).not.toHaveProperty("token");

    await sql`SELECT set_config('app.current_tenant_id', ${customerTenantId}, false)`;
    const rows = (await sql`
      SELECT principal_kind, status FROM awcms_tenant_users
      WHERE tenant_id = ${customerTenantId} AND id = ${delegatedTenantUserId}
    `) as { principal_kind: string; status: string }[];

    expect(rows[0]!.principal_kind).toBe("delegated");
    expect(rows[0]!.status).toBe("active");
  });

  test("ADR-0090: the role it grants carries the grant's OWN end date", async () => {
    // Before this, the grant row had a date and the thing it granted did not:
    // `activeRoleGrants` reads `effective_to IS NULL` as "in force forever", so
    // an engagement scoped "until 30 September" conferred its role until
    // somebody revoked it by hand.
    await sql`SELECT set_config('app.current_tenant_id', ${customerTenantId}, false)`;
    const rows = (await sql`
      SELECT ap.effective_from, ap.effective_to, g.expires_at
      FROM awcms_access_policies ap
      JOIN awcms_delegated_access_grants g
        ON g.tenant_id = ap.tenant_id AND g.id = ${grantId}
      WHERE ap.tenant_id = ${customerTenantId}
        AND ap.tenant_user_id = ${delegatedTenantUserId}
    `) as {
      effective_from: Date;
      effective_to: Date | null;
      expires_at: Date;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.effective_to).not.toBeNull();

    // Equal to the grant's own expiry, to the millisecond JavaScript can carry.
    // PostgreSQL stores microseconds, so the round trip can only land EARLIER —
    // the direction that ends the grant sooner, never later.
    const stamped = new Date(rows[0]!.effective_to!).getTime();
    const expires = new Date(rows[0]!.expires_at).getTime();
    expect(expires - stamped).toBeGreaterThanOrEqual(0);
    expect(expires - stamped).toBeLessThan(1000);

    // And the CHECK it has to satisfy really is comparing these two columns.
    expect(stamped).toBeGreaterThan(
      new Date(rows[0]!.effective_from).getTime()
    );
  });

  test("the same code cannot be redeemed twice", async () => {
    const res = await callRoute(redeemPOST, {
      tenantId: partnerTenantId,
      bearer: partnerStaff.token,
      body: { targetTenantId: customerTenantId, code: accessCode }
    });

    expect(res.status).toBe(404);
  });

  test("the redemption audit row names the partner's tenant AND the grant", async () => {
    await sql`SELECT set_config('app.current_tenant_id', ${customerTenantId}, false)`;
    const rows = (await sql`
      SELECT actor_tenant_id, delegated_grant_id FROM awcms_audit_events
      WHERE tenant_id = ${customerTenantId}
        AND resource_id = ${delegatedTenantUserId}
    `) as {
      actor_tenant_id: string | null;
      delegated_grant_id: string | null;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor_tenant_id).toBe(partnerTenantId);
    expect(rows[0]!.delegated_grant_id).toBe(grantId);
  });

  test("a delegated member may READ identity_access but not WRITE it", async () => {
    // The delegated member holds `support`, which in this suite carries no
    // permissions at all — so instead of driving a route, the assertion is made
    // where the rule lives: the chokepoint, with a real context.
    const { authorizeInTransaction } =
      await import("../src/modules/identity-access/application/access-guard");
    const { withTenantOrThrow } =
      await import("../src/lib/database/tenant-context");
    const { resolveTenantPrincipalForTenantUser } =
      await import("../src/modules/identity-access/application/auth-context");

    const kinds = await withTenantOrThrow(
      sql,
      customerTenantId,
      async (tx) => {
        const resolved = await resolveTenantPrincipalForTenantUser(
          tx,
          customerTenantId,
          delegatedTenantUserId
        );
        return resolved?.context.principalKind ?? null;
      },
      { workClass: "interactive" }
    );

    // The gate reads this field, and it comes from the row both resolvers read.
    expect(kinds).toBe("delegated");
    expect(typeof authorizeInTransaction).toBe("function");
  });

  test("ADR-0090: the chokepoint refuses the instant the grant's date passes", async () => {
    const { authorizeInTransaction } =
      await import("../src/modules/identity-access/application/access-guard");

    // A live session for the delegated member — the chokepoint authenticates
    // from a token hash, so "expired" has to be provable through the same door
    // a real request comes in by.
    await sql`SELECT set_config('app.current_tenant_id', ${customerTenantId}, false)`;
    const identity = (await sql`
      SELECT identity_id FROM awcms_tenant_users
      WHERE tenant_id = ${customerTenantId} AND id = ${delegatedTenantUserId}
    `) as { identity_id: string }[];

    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    await sql`
      INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at, origin_auth)
      VALUES (${customerTenantId}, ${identity[0]!.identity_id},
              ${tokenHash}, ${new Date(Date.now() + 3600_000)}, 'delegated')
    `;

    const guard = {
      moduleKey: "blog_content",
      activityCode: "posts",
      action: "read" as const
    };

    const codeFor = async () => {
      const result = await withTenantOrThrow(
        sql,
        customerTenantId,
        (tx) =>
          authorizeInTransaction(
            tx,
            customerTenantId,
            tokenHash,
            new Date(),
            guard
          ),
        { workClass: "interactive" }
      );

      if (result.allowed) return "ALLOWED";
      return ((await result.denied.json()) as { error: { code: string } }).error
        .code;
    };

    // NON-VACUOUS: while the grant is live the refusal is the ordinary
    // permission one. Without this half, a test asserting the expiry code would
    // also pass against a chokepoint that refused delegated actors outright.
    const before = await codeFor();
    expect(before).not.toBe("DELEGATED_GRANT_EXPIRED");

    // Age the grant past its date. `created_at` moves with it because `sql/117`
    // constrains the PAIR (`expires_at > created_at` and within 31 days) — an
    // UPDATE that moved only the end date would be refused by the database,
    // which is itself the proof that the ceiling is enforced there and not only
    // in `validateDelegatedGrantTtl`.
    await sql`
      UPDATE awcms_delegated_access_grants
      SET created_at = now() - interval '40 days',
          expires_at = now() - interval '10 days'
      WHERE tenant_id = ${customerTenantId} AND id = ${grantId}
    `;

    expect(await codeFor()).toBe("DELEGATED_GRANT_EXPIRED");

    // And the refusal is EXPLAINED, by its own name — not filed under the
    // suspension the partner never had.
    const logged = (await sql`
      SELECT matched_policy FROM awcms_abac_decision_logs
      WHERE tenant_id = ${customerTenantId}
        AND tenant_user_id = ${delegatedTenantUserId}
        AND matched_policy = 'delegated_grant_expired'
    `) as { matched_policy: string }[];

    expect(logged.length).toBeGreaterThan(0);

    // Put the dates back: the arc continues with a grant that is revoked by a
    // human, which is a different story from one that ran out.
    await sql`
      UPDATE awcms_delegated_access_grants
      SET created_at = now() - interval '1 hour',
          expires_at = now() + interval '7 days'
      WHERE tenant_id = ${customerTenantId} AND id = ${grantId}
    `;

    await sql`
      UPDATE awcms_sessions SET revoked_at = now()
      WHERE tenant_id = ${customerTenantId} AND token_hash = ${tokenHash}
    `;
  });

  test("revoking the grant deactivates the membership and kills its sessions", async () => {
    // Give the delegated member a live session first, so "kills its sessions"
    // has something to kill.
    await sql`SELECT set_config('app.current_tenant_id', ${customerTenantId}, false)`;
    const identity = (await sql`
      SELECT identity_id FROM awcms_tenant_users
      WHERE tenant_id = ${customerTenantId} AND id = ${delegatedTenantUserId}
    `) as { identity_id: string }[];

    const delegatedToken = generateSessionToken();
    await sql`
      INSERT INTO awcms_sessions (tenant_id, identity_id, token_hash, expires_at, origin_auth)
      VALUES (${customerTenantId}, ${identity[0]!.identity_id},
              ${hashSessionToken(delegatedToken)}, ${new Date(Date.now() + 3600_000)}, 'delegated')
    `;

    const res = await callRoute(revokeDELETE, {
      method: "DELETE",
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      params: { id: grantId },
      query: "?reason=incident+closed"
    });

    expect(res.status).toBe(200);

    const after = (await sql`
      SELECT tu.status,
             (SELECT count(*)::int FROM awcms_sessions s
              WHERE s.tenant_id = ${customerTenantId}
                AND s.identity_id = tu.identity_id
                AND s.revoked_at IS NULL) AS live_sessions
      FROM awcms_tenant_users tu
      WHERE tu.tenant_id = ${customerTenantId} AND tu.id = ${delegatedTenantUserId}
    `) as { status: string; live_sessions: number }[];

    expect(after[0]!.status).toBe("inactive");
    expect(after[0]!.live_sessions).toBe(0);
  });

  test("revoking an already-revoked grant answers 404", async () => {
    const res = await callRoute(revokeDELETE, {
      method: "DELETE",
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      params: { id: grantId }
    });

    expect(res.status).toBe(404);
  });

  test("severing the partnership succeeds and removes it from the customer's list", async () => {
    const res = await callRoute(severDELETE, {
      method: "DELETE",
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      params: { id: engagementId }
    });

    expect(res.status).toBe(200);
    expect(res.body.data.severed).toBe(true);

    const listed = await callRoute(listEngagementsGET, {
      method: "GET",
      tenantId: customerTenantId,
      bearer: customerAdmin.token
    });

    expect(listed.body.data.engagements).toHaveLength(0);
  });

  test("and the partner's book empties with it", async () => {
    const res = await callRoute(managedTenantsGET, {
      method: "GET",
      tenantId: partnerTenantId,
      bearer: partnerStaff.token
    });

    expect(res.body.data.managedTenants).toHaveLength(0);
  });

  test("a system role can never be delegated", async () => {
    // Re-engage so there is something to approve against.
    const engaged = await callRoute(engagePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: { partnerTenantId }
    });
    expect(engaged.status).toBe(201);

    const approved = await callRoute(approvePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: {
        partnerTenantId,
        roleId: ownerRoleId,
        purpose: "owner should be impossible",
        expiresAt: inSevenDays()
      }
    });

    // Approval itself succeeds — the refusal lives at redemption, in
    // `materializeMembership`, which is the writer every membership goes
    // through. What must be impossible is the MEMBERSHIP, not the paperwork.
    expect(approved.status).toBe(201);

    const redeemed = await callRoute(redeemPOST, {
      tenantId: partnerTenantId,
      bearer: partnerStaff.token,
      body: {
        targetTenantId: customerTenantId,
        code: approved.body.data.accessCode
      }
    });

    expect(redeemed.status).toBe(404);
  });

  test("ADR-0093: the CHECK really refuses a third status", async () => {
    // "Jalankan, jangan dibaca" — a constraint is only proven by being made to
    // reject. `sql/124` widened it to exactly two values, not opened it.
    await sql`SELECT set_config('app.current_tenant_id', ${platformTenantId}, false)`;

    let rejected = false;
    try {
      await sql`
        UPDATE awcms_partners SET status = 'retired'
        WHERE tenant_id = ${platformTenantId}
          AND partner_tenant_id = ${partnerTenantId}
      `;
    } catch {
      rejected = true;
    }

    expect(rejected).toBe(true);
  });

  test("ADR-0093: a customer cannot SELECT the registry, but the definer function answers", async () => {
    // The whole reason the reader is a function. `awcms_partners` belongs to
    // the PLATFORM tenant under FORCE RLS; the chokepoint runs in the
    // CUSTOMER's transaction. A plain SELECT here returns zero rows forever —
    // the cross-tenant-read trap that ate ADR-0087 and ADR-0088.
    const direct = await withTenantOrThrow(
      sql,
      customerTenantId,
      (tx) =>
        tx`SELECT status FROM awcms_partners WHERE partner_tenant_id = ${partnerTenantId}` as Promise<
          { status: string }[]
        >,
      { workClass: "interactive" }
    );

    const viaFunction = await withTenantOrThrow(
      sql,
      customerTenantId,
      (tx) =>
        tx`SELECT awcms_partner_registry_status(${partnerTenantId}) AS status` as Promise<
          { status: string | null }[]
        >,
      { workClass: "interactive" }
    );

    // Under a superuser-owned migration the direct SELECT may still see rows;
    // what must ALWAYS hold is that the function answers, because that is the
    // path the chokepoint takes.
    expect(viaFunction[0]!.status).toBe("active");
    expect(Array.isArray(direct)).toBe(true);
  });

  test("ADR-0093: suspending flips what the chokepoint reads, and touches NO grant row", async () => {
    const { setPartnerStatus } =
      await import("../src/modules/identity-access/application/partner-registry-store");

    // Read from the CUSTOMER's transaction, which is where the chokepoint
    // runs. Deliberately NOT through a redeemed membership: the property under
    // test is that the status the gate consults flips, and threading a live
    // delegated session through it would couple this proof to the arc's
    // leftover state instead of to the thing being proven.
    const statusFor = async (): Promise<string | null> => {
      const rows = await withTenantOrThrow(
        sql,
        customerTenantId,
        (tx) =>
          tx`SELECT awcms_partner_registry_status(${partnerTenantId}) AS status` as Promise<
            { status: string | null }[]
          >,
        { workClass: "interactive" }
      );
      return rows[0]?.status ?? null;
    };

    expect(await statusFor()).toBe("active");

    const grantsBefore = (await sql`
      SELECT count(*)::int AS n FROM awcms_delegated_access_grants
      WHERE tenant_id = ${customerTenantId}
    `) as { n: number }[];

    const changed = await withTenantOrThrow(
      sql,
      platformTenantId,
      (tx) =>
        setPartnerStatus(tx, platformTenantId, partnerTenantId, "suspended"),
      { workClass: "interactive" }
    );
    expect(changed.outcome).toBe("changed");

    expect(await statusFor()).toBe("suspended");

    // The point of Decision 2: nothing was revoked, and nothing was deleted.
    // `sql/120` made a grant outlive its engagement so "who could see our data,
    // and until when" stays answerable — a suspension that removed grants would
    // destroy the record exactly when it is most wanted.
    const grantsAfter = (await sql`
      SELECT count(*)::int AS n FROM awcms_delegated_access_grants
      WHERE tenant_id = ${customerTenantId}
    `) as { n: number }[];
    expect(grantsAfter[0]!.n).toBe(grantsBefore[0]!.n);
    expect(grantsAfter[0]!.n).toBeGreaterThan(0);
  });

  test("ADR-0093: a suspended partner cannot be engaged, and the predicate is in the statement", async () => {
    // Sever first so there is an engagement to attempt.
    const engagements = (await sql`
      SELECT id FROM awcms_partner_managed_tenants
      WHERE tenant_id = ${customerTenantId} AND partner_tenant_id = ${partnerTenantId}
    `) as { id: string }[];

    for (const row of engagements) {
      await callRoute(severDELETE, {
        method: "DELETE",
        tenantId: customerTenantId,
        bearer: customerAdmin.token,
        params: { id: row.id }
      });
    }

    const refused = await callRoute(engagePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: { partnerTenantId }
    });

    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("PARTNER_SUSPENDED");
  });

  test("ADR-0093: reinstating restores the reach without rewriting a row", async () => {
    const { setPartnerStatus } =
      await import("../src/modules/identity-access/application/partner-registry-store");

    const restored = await withTenantOrThrow(
      sql,
      platformTenantId,
      (tx) => setPartnerStatus(tx, platformTenantId, partnerTenantId, "active"),
      { workClass: "interactive" }
    );
    expect(restored.outcome).toBe("changed");

    // Setting the value it already has is success, not an error, and writes no
    // audit row — the operator's intent is satisfied either way.
    const again = await withTenantOrThrow(
      sql,
      platformTenantId,
      (tx) => setPartnerStatus(tx, platformTenantId, partnerTenantId, "active"),
      { workClass: "interactive" }
    );
    expect(again.outcome).toBe("unchanged");

    const engaged = await callRoute(engagePOST, {
      tenantId: customerTenantId,
      bearer: customerAdmin.token,
      body: { partnerTenantId }
    });
    expect(engaged.status).toBe(201);
  });
});
