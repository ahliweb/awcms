/**
 * What the request pays BEFORE the page's first query — finding B5 of the
 * 17 August 2026 round.
 *
 * ## The finding is about a measurement, not only about a cost
 *
 * `docs/awcms/standar-performa-dan-keamanan.md` lists "queries per hot read
 * request ≤ 3" as **measured**, citing
 * `query-budget.integration.test.ts` and `query-budget-admin.integration.test.ts`.
 * Both of those hand a counting `tx` to a directory function. The middleware
 * runs BEFORE any of that — it resolves the tenant from the host, opens its own
 * tenant transaction and asks `seo_distribution` whether the path redirects —
 * and none of it was inside anything either suite could count. The excess was
 * not merely unmeasured; it was structurally invisible to the gate that claimed
 * to enforce the ceiling.
 *
 * This file counts that prefix, through `countPoolQueries`, which wraps the
 * POOL and the transaction opened on it. `src/middleware.ts` itself cannot be
 * imported (it pulls in the `astro:middleware` virtual module), so the subject
 * is `resolvePublicRedirect` — the one call the middleware makes on the public
 * path, taking the same `sql`, `request` and options.
 *
 * ## The numbers are EXACT, and they are floors
 *
 * Exact, following `query-budget-admin.integration.test.ts`: a ceiling with
 * slack hides the difference between "this improved" and "this regressed into
 * the slack". Floors, because `BEGIN` and `COMMIT` are real round trips that
 * `sql.begin` issues itself and no Proxy can see — so the true count is these
 * numbers plus two. Saying so is the point of the finding.
 *
 * If one of these numbers changes, that is a real change in what every public
 * request costs: update it deliberately, with the reason, rather than nudging
 * it to green.
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
  getRuntimeSql,
  integrationEnabled,
  resetDatabase,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { countPoolQueries } from "./query-budget";
import { withTenantOrThrow } from "../../src/lib/database/tenant-context";
import { createRedirect } from "../../src/modules/seo-distribution/application/redirect-directory";
import { resolvePublicRedirect } from "../../src/modules/seo-distribution/application/redirect-resolution-service";
import { validateRedirectInput } from "../../src/modules/seo-distribution/domain/redirect-rule";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HOST = "example.com";
const NOW = new Date("2026-08-22T00:00:00.000Z");

/** Host-based resolution — the mode a deployment with a custom domain runs. */
const HOST_ENV = {
  PUBLIC_TENANT_RESOLUTION_MODE: "host_default"
} as NodeJS.ProcessEnv;

/**
 * Comfortably more rules than any budget below. A rule count that cannot change
 * the query count is the whole claim; a one-rule fixture would prove nothing,
 * exactly as a one-row fixture proves nothing about an N+1.
 */
const SEEDED_RULES = 40;

function request(path: string): Request {
  return new Request(`https://${HOST}${path}`, { headers: { host: HOST } });
}

function options(pathname: string) {
  return { pathname, search: "", locale: null, now: NOW };
}

async function seedTenant(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status)
    VALUES (${TENANT}, 'budget', 'Budget Tenant', 'active')
  `;
}

async function seedPrimaryDomain(): Promise<void> {
  await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
    await tx`
      INSERT INTO awcms_tenant_domains
        (tenant_id, hostname, normalized_hostname, domain_type, status, is_primary)
      VALUES (${TENANT}, ${HOST}, ${HOST}, 'custom_domain', 'active', true)
    `;
  });
}

async function seedRules(count: number): Promise<void> {
  await withTenantOrThrow(getRuntimeSql(), TENANT, async (tx) => {
    for (let index = 0; index < count; index += 1) {
      const validation = validateRedirectInput(
        { sourcePath: `/legacy-${index}`, target: `/current-${index}` },
        { allowedHosts: [] }
      );

      if (!validation.ok) {
        throw new Error(`fixture rule ${index} invalid`);
      }

      await createRedirect(tx, TENANT, ACTOR, validation.value);
    }
  });
}

const suite = integrationEnabled ? describe : describe.skip;

suite("query budget — what the middleware spends before the page runs", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    await seedTenant();
  });

  test("a public path with NO redirect rule costs 5 statements", async () => {
    if (!appRoleActivated) {
      // Tenant resolution goes through the SECURITY DEFINER host lookup whose
      // EXECUTE is granted to `awcms_app`; the count is not meaningful without
      // the least-privilege role in play.
      return;
    }

    await seedPrimaryDomain();

    const { result, queries } = await countPoolQueries(getRuntimeSql(), (sql) =>
      resolvePublicRedirect(sql, request("/about"), options("/about"), HOST_ENV)
    );

    // Assert the OUTCOME too. A resolution that skipped — disabled module,
    // unresolved tenant — would issue fewer queries and pass a budget while
    // proving nothing about the path the finding is about.
    expect(result.kind).toBe("passthrough");

    // host lookup, SET LOCAL, tenant module entry, tenant domains, rule lookup.
    // The domain read used to be TWO — `resolveTenantAllowedHosts` and
    // `resolveTenantPrimaryHost` asked the same table under the same filter.
    expect(queries).toBe(5);
  });

  test("the cost does not grow with the number of rules the tenant has", async () => {
    if (!appRoleActivated) {
      return;
    }

    await seedPrimaryDomain();
    await seedRules(SEEDED_RULES);

    const { result, queries } = await countPoolQueries(getRuntimeSql(), (sql) =>
      resolvePublicRedirect(sql, request("/about"), options("/about"), HOST_ENV)
    );

    expect(result.kind).toBe("passthrough");
    expect(queries).toBe(5);
  });

  test("a request that DOES redirect costs 7", async () => {
    if (!appRoleActivated) {
      return;
    }

    await seedPrimaryDomain();
    await seedRules(SEEDED_RULES);

    const { result, queries } = await countPoolQueries(getRuntimeSql(), (sql) =>
      resolvePublicRedirect(
        sql,
        request("/legacy-0"),
        options("/legacy-0"),
        HOST_ENV
      )
    );

    expect(result).toMatchObject({ kind: "redirect", location: "/current-0" });

    // The five above, plus the chain's second lookup (which is what proves the
    // target is terminal) and the best-effort hit projection.
    expect(queries).toBe(7);
  });

  test("a path outside the redirect vocabulary costs NOTHING", async () => {
    if (!appRoleActivated) {
      return;
    }

    await seedPrimaryDomain();

    // `isRedirectEligiblePath` is applied in the middleware composition root,
    // not here, so this asserts the other half: an ineligible path never even
    // reaches this service. What it pins is that the service does no work of
    // its own before deciding the retired-`/news` strategy does not apply —
    // the strategy that DOES resolve a tenant from the host runs second.
    const { queries } = await countPoolQueries(getRuntimeSql(), (sql) =>
      resolvePublicRedirect(
        sql,
        new Request(`https://${HOST}/about`, { headers: {} }),
        options("/about"),
        {
          PUBLIC_TENANT_RESOLUTION_MODE: "tenant_code_legacy"
        } as NodeJS.ProcessEnv
      )
    );

    expect(queries).toBe(0);
  });
});
