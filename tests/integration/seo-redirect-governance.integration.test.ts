/**
 * Integration tests for `seo_distribution`'s REDIRECT-GOVERNANCE scope (ADR-0039,
 * migrations sql/060 + sql/061) against a real PostgreSQL under the
 * ephemeral-database harness. These prove exactly the claims a typecheck cannot:
 *
 *   1. All THREE redirect tables (`awcms_seo_redirects`,
 *      `awcms_seo_not_found_observations`, `awcms_seo_redirect_settings`) are
 *      `FORCE ROW LEVEL SECURITY`, tenant-isolated — proven under the non-superuser
 *      `awcms_app` LOGIN role: a direct SELECT with NO tenant context returns zero
 *      rows, and one tenant's context never sees another tenant's redirect rules.
 *   2. A created ACTIVE, same-tenant redirect actually RESOLVES end-to-end through
 *      `resolvePublicRedirect` (host server-derived from `awcms_tenant_domains` via
 *      the SECURITY DEFINER lookup, then the bounded chain resolver), emitting the
 *      normalized relative target.
 *   3. A cross-host / external target is REFUSED at RESOLVE time (defense in depth):
 *      a `verified_external` rule pointing off-origin — inserted directly to bypass
 *      write-time validation, simulating a host removed after the rule was written —
 *      never open-redirects; the frozen `assertSafeRedirectTarget` guard fails it
 *      CLOSED (passthrough, no `Location`).
 *   4. A privacy-minimized 404 observation records AND dedups: the same
 *      (path, referrer, locale, host) tuple upserts a single row with an
 *      incremented `hit_count`, never one row per hit.
 *
 * Skipped unless a real database is configured (see tests/integration/harness.ts).
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
  getAdminSql,
  getAppRoleSql,
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { withTenant } from "../../src/lib/database/tenant-context";
import { validateRedirectInput } from "../../src/modules/seo-distribution/domain/redirect-rule";
import {
  createRedirect,
  getRedirectById
} from "../../src/modules/seo-distribution/application/redirect-directory";
import { recordNotFoundObservation } from "../../src/modules/seo-distribution/application/not-found-directory";
import { resolvePublicRedirect } from "../../src/modules/seo-distribution/application/redirect-resolution-service";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-07-25T00:00:00.000Z");
const HOST_A = "example.com";

/** Host-based resolution mode — the same config the discovery routes use. */
const HOST_ENV = {
  PUBLIC_TENANT_RESOLUTION_MODE: "host_default"
} as NodeJS.ProcessEnv;

async function seedTenants(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES
      (${TENANT_A}, 'tenant-a', 'Tenant A', 'active'),
      (${TENANT_B}, 'tenant-b', 'Tenant B', 'active')
    ON CONFLICT (id) DO NOTHING
  `;
}

async function seedPrimaryDomain(
  tx: Bun.SQL,
  tenantId: string,
  host: string
): Promise<void> {
  await tx`
    INSERT INTO awcms_tenant_domains
      (tenant_id, hostname, normalized_hostname, domain_type, status, is_primary)
    VALUES (${tenantId}, ${host}, ${host.toLowerCase()}, 'custom_domain', 'active', true)
  `;
}

/** Build a validated same-tenant relative redirect input (write path). */
function relativeRedirectInput(sourcePath: string, target: string) {
  const validation = validateRedirectInput(
    { sourcePath, target },
    { allowedHosts: [] }
  );
  if (!validation.ok) {
    throw new Error(
      `fixture input invalid: ${JSON.stringify(validation.errors)}`
    );
  }
  return validation.value;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("seo_distribution redirect governance (ADR-0039, integration)", () => {
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

  test("RLS FORCE: awcms_app cannot read any of the 3 redirect tables without tenant context, and never across tenants", async () => {
    if (!appRoleActivated) {
      // Without the awcms_app LOGIN role the FORCE-RLS proof is not meaningful
      // (the owner/superuser bypasses RLS unconditionally).
      return;
    }
    const runtime = getRuntimeSql();

    // Seed one live rule + settings + a 404 observation for tenant A.
    await withTenant(runtime, TENANT_A, async (tx) => {
      await createRedirect(
        tx,
        TENANT_A,
        ACTOR,
        relativeRedirectInput("/old", "/new")
      );
      await tx`
        INSERT INTO awcms_seo_redirect_settings (tenant_id, url_change_auto_policy)
        VALUES (${TENANT_A}, 'propose')
      `;
      await recordNotFoundObservation(tx, TENANT_A, {
        normalizedPath: "/missing",
        referrerDomain: null,
        locale: null,
        domainHost: HOST_A,
        at: NOW
      });
    });

    const app = getAppRoleSql();
    for (const table of [
      "awcms_seo_redirects",
      "awcms_seo_not_found_observations",
      "awcms_seo_redirect_settings"
    ]) {
      // Fail-closed: no app.current_tenant_id set -> zero rows on every table.
      const noContext = (await app.unsafe(
        `SELECT tenant_id FROM ${table}`
      )) as { tenant_id: string }[];
      expect(noContext).toHaveLength(0);
    }

    // Tenant B's context sees none of tenant A's redirect rules.
    const asB = await withTenant(app, TENANT_B, async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS n FROM awcms_seo_redirects
      `) as { n: number }[];
      return rows[0]!.n;
    });
    expect(asB).toBe(0);

    // Tenant A's own context DOES see its rule.
    const asA = await withTenant(app, TENANT_A, async (tx) => {
      const rows = (await tx`
        SELECT count(*)::int AS n FROM awcms_seo_redirects
      `) as { n: number }[];
      return rows[0]!.n;
    });
    expect(asA).toBe(1);
  });

  test("a created active same-tenant redirect resolves via resolvePublicRedirect (host server-derived)", async () => {
    if (!appRoleActivated) {
      // resolvePublicTenantFromRequest reaches the SECURITY DEFINER host lookup
      // whose EXECUTE is granted to awcms_app; not meaningful without it.
      return;
    }
    const runtime = getRuntimeSql();

    await withTenant(runtime, TENANT_A, async (tx) => {
      await seedPrimaryDomain(tx, TENANT_A, HOST_A);
      await createRedirect(
        tx,
        TENANT_A,
        ACTOR,
        relativeRedirectInput("/old-page", "/new-page")
      );
    });

    const request = new Request(`https://${HOST_A}/old-page`, {
      headers: { host: HOST_A }
    });
    const resolution = await resolvePublicRedirect(
      runtime,
      request,
      { pathname: "/old-page", search: "", locale: null, now: NOW },
      HOST_ENV
    );

    expect(resolution.kind).toBe("redirect");
    if (resolution.kind === "redirect") {
      expect(resolution.location).toBe("/new-page");
      expect(resolution.status).toBe(301);
    }
  });

  test("an off-origin verified_external target is REFUSED at resolve time (open-redirect guard, fail-closed passthrough)", async () => {
    if (!appRoleActivated) {
      return;
    }
    const runtime = getRuntimeSql();

    await withTenant(runtime, TENANT_A, async (tx) => {
      await seedPrimaryDomain(tx, TENANT_A, HOST_A);
      // Insert a malicious rule DIRECTLY, bypassing write-time validation — this is
      // the "host removed / rule tampered after write" case the resolve-time
      // re-validation exists for. The DB shape CHECK permits an https:// target;
      // the frozen guard, not the DB, is the open-redirect defense.
      await tx`
        INSERT INTO awcms_seo_redirects
          (tenant_id, source_path, normalized_source_path, target_type, target,
           status_code, state, created_by, updated_by)
        VALUES (
          ${TENANT_A}, '/leave', '/leave', 'verified_external',
          'https://evil.example/pwn', 301, 'active', ${ACTOR}, ${ACTOR}
        )
      `;
    });

    const request = new Request(`https://${HOST_A}/leave`, {
      headers: { host: HOST_A }
    });
    const resolution = await resolvePublicRedirect(
      runtime,
      request,
      { pathname: "/leave", search: "", locale: null, now: NOW },
      HOST_ENV
    );

    // The chain resolver would fold this to a terminal external redirect, but the
    // final assertSafeRedirectTarget(evil.example not in allowedHosts) throws and
    // the service degrades to passthrough — NEVER an open redirect.
    expect(resolution.kind).toBe("passthrough");
    if (resolution.kind === "redirect") {
      throw new Error(
        `open-redirect leaked: emitted Location ${resolution.location}`
      );
    }
  });

  test("404 observation records once and dedups (aggregate upsert, hit_count increments)", async () => {
    const runtime = getRuntimeSql();

    const capture = {
      normalizedPath: "/gone",
      referrerDomain: "referrer.example",
      locale: null,
      domainHost: HOST_A
    };

    await withTenant(runtime, TENANT_A, async (tx) => {
      await recordNotFoundObservation(tx, TENANT_A, { ...capture, at: NOW });
      await recordNotFoundObservation(tx, TENANT_A, {
        ...capture,
        at: new Date(NOW.getTime() + 60_000)
      });
    });

    const rows = await withTenant(runtime, TENANT_A, async (tx) => {
      return (await tx`
        SELECT normalized_path, hit_count::int AS hit_count
        FROM awcms_seo_not_found_observations
        WHERE tenant_id = ${TENANT_A}
      `) as { normalized_path: string; hit_count: number }[];
    });

    // One row for the repeated tuple, hit_count bumped to 2 — never one row per hit.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.normalized_path).toBe("/gone");
    expect(rows[0]!.hit_count).toBe(2);
  });

  test("a redirect created for tenant A is not readable by getRedirectById under tenant B's context", async () => {
    const runtime = getRuntimeSql();

    const created = await withTenant(runtime, TENANT_A, (tx) =>
      createRedirect(tx, TENANT_A, ACTOR, relativeRedirectInput("/a", "/b"))
    );

    const seenByB = await withTenant(runtime, TENANT_B, (tx) =>
      getRedirectById(tx, TENANT_B, created.id)
    );
    expect(seenByB).toBeNull();

    const seenByA = await withTenant(runtime, TENANT_A, (tx) =>
      getRedirectById(tx, TENANT_A, created.id)
    );
    expect(seenByA?.normalizedSourcePath).toBe("/a");
  });
});
