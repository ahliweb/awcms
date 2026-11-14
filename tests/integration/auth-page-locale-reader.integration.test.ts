/**
 * The production reader behind the pre-session auth-page language
 * (`createTenantDefaultLocaleReader`, ADR-0095), run as the REAL least-
 * privilege `awcms_app` role against a migrated database.
 *
 * Unit tests substitute a fake reader, so none of them can see the filter, the
 * UUID guard, or whether the runtime role may still read the root table at all.
 * If `awcms_tenants` were ever given RLS or a narrower grant, the reader's
 * `catch` would turn the failure into `null` and the feature would die
 * silently; the "active tenant" case below is what goes red then.
 *
 * MUTATION PROOFS:
 * - Drop `AND status = 'active'` -> "a suspended tenant" goes RED.
 * - Drop the UUID guard -> "a non-UUID id" goes RED (the query would run).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  appRoleActivated,
  getAdminSql,
  getAppRoleSql,
  integrationEnabled,
  setupIntegrationDatabase,
  teardownIntegrationDatabase
} from "./harness";
import { createTenantDefaultLocaleReader } from "../../src/lib/i18n/auth-page-locale";

const ACTIVE = "c1c1c1c1-0000-4c1c-8c1c-c1c1c1c1c101";
const SUSPENDED = "c1c1c1c1-0000-4c1c-8c1c-c1c1c1c1c102";

const describeOrSkip = integrationEnabled ? describe : describe.skip;

describeOrSkip("readActiveTenantDefaultLocale as awcms_app", () => {
  beforeAll(async () => {
    await setupIntegrationDatabase();
    await getAdminSql()`
      INSERT INTO awcms_tenants (id, tenant_code, tenant_name, status, default_locale)
      VALUES (${ACTIVE}, 'locale-active', 'Locale Active', 'active', 'en'),
             (${SUSPENDED}, 'locale-suspended', 'Locale Suspended', 'suspended', 'en')
      ON CONFLICT (id) DO NOTHING
    `;
  });

  afterAll(async () => {
    await teardownIntegrationDatabase();
  });

  test("an active tenant yields its default locale", async () => {
    if (!appRoleActivated) return;
    const read = createTenantDefaultLocaleReader(getAppRoleSql);
    const who = (await getAppRoleSql()`SELECT current_user AS u`) as {
      u: string;
    }[];

    expect(who[0]?.u).toBe("awcms_app");
    expect(await read(ACTIVE)).toBe("en");
  });

  test("a suspended tenant contributes nothing", async () => {
    if (!appRoleActivated) return;
    const read = createTenantDefaultLocaleReader(getAppRoleSql);

    expect(await read(SUSPENDED)).toBeNull();
  });

  test("an unknown tenant contributes nothing", async () => {
    if (!appRoleActivated) return;
    const read = createTenantDefaultLocaleReader(getAppRoleSql);

    expect(await read("c1c1c1c1-0000-4c1c-8c1c-c1c1c1c1c1ff")).toBeNull();
  });

  test("a non-UUID id returns null WITHOUT querying", async () => {
    let queries = 0;
    const read = createTenantDefaultLocaleReader(() => {
      queries += 1;
      throw new Error("must not be called");
    });

    expect(await read("not-a-uuid")).toBeNull();
    expect(await read("' OR 1=1 --")).toBeNull();
    expect(queries).toBe(0);
  });
});
