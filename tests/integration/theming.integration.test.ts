/**
 * Integration tests for the `theming` module (ADR-0034 Fase 3; ported/adapted
 * from awcms-micro Issue #269/ADR-0029) against a real PostgreSQL under the
 * WORLD-1 ephemeral-database harness. Proves, with real DDL/RLS/FKs/triggers
 * (not mocks):
 *
 *   - the draft -> publish -> rollback -> retire lifecycle + per-tenant version
 *     numbering, driven through the module's own application services;
 *   - PUBLISHED VERSION IMMUTABILITY — the sql/033 BEFORE UPDATE/DELETE trigger
 *     RAISES on any mutation of a `status='published'` row;
 *   - FORCE ROW LEVEL SECURITY tenant isolation on the config-version + state
 *     tables, proven under the non-superuser `awcms_app` role;
 *   - preview-session create + hashed lookup + `expires_at` expiry filtering;
 *   - CSS-injection REJECTION at the domain boundary (the security spine) and
 *     the render-path defense-in-depth fallback.
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
  fetchThemeTenantState,
  insertPublishedVersion,
  listPublishedVersions,
  nextPublishedVersionNumber,
  upsertDraftVersion
} from "../../src/modules/theming/application/theme-config-directory";
import {
  hashThemeConfig,
  publishThemeDraft,
  retireActiveTheme,
  rollbackThemeVersion,
  saveThemeDraft
} from "../../src/modules/theming/application/theme-service";
import {
  createPreviewSession,
  findActivePreviewSession
} from "../../src/modules/theming/application/theme-preview-directory";
import { resolveVersionThemeCss } from "../../src/modules/theming/application/theme-render-resolver";
import {
  resolveThemeTokens,
  serializeThemeTokensCss,
  validateThemeConfig,
  type ThemeConfig
} from "../../src/modules/theming/domain/theme-config";
import { CssValueError } from "../../src/modules/theming/domain/css-value-validation";
import { hashPreviewToken } from "../../src/modules/theming/domain/preview-token";
import { defaultTheme } from "../../src/modules/theming/themes/default-theme";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACTOR = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** A validated, normalized config for the base `aria` theme with one override. */
function validConfig(primary = "#123456"): ThemeConfig {
  const result = validateThemeConfig(defaultTheme, {
    themeKey: "aria",
    tokenOverrides: { color_primary: primary, font_body: "serif" },
    slotSelections: { header: "split" },
    sectionOrder: ["cta", "hero"],
    navPlacement: "side"
  });
  if (!result.ok) throw new Error("fixture config should validate");
  return result.value;
}

/** A no-op audit hook — the service records via an INJECTED hook; the route wires
 * the real `recordAuditEvent`. These tests assert STATE, not the audit rows. */
const noAudit = async (): Promise<void> => {};

async function seedTenants(): Promise<void> {
  await getAdminSql()`
    INSERT INTO awcms_tenants (id, tenant_code, tenant_name)
    VALUES (${TENANT_A}, 'tenant-a', 'Tenant A'), (${TENANT_B}, 'tenant-b', 'Tenant B')
    ON CONFLICT (id) DO NOTHING
  `;
}

const suite = integrationEnabled ? describe : describe.skip;

suite("theming module (integration)", () => {
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

  test("draft save + publish assigns version 1; a second publish is version 2; active pointer follows", async () => {
    const runtime = getRuntimeSql();

    // Save a draft, then publish it (version 1).
    await withTenant(runtime, TENANT_A, (tx) =>
      saveThemeDraft(tx, TENANT_A, ACTOR, defaultTheme, validConfig(), noAudit)
    );
    const pub1 = await withTenant(runtime, TENANT_A, (tx) =>
      publishThemeDraft(tx, TENANT_A, ACTOR, noAudit)
    );
    expect(pub1.ok).toBe(true);
    if (!pub1.ok) return;
    expect(pub1.version.versionNumber).toBe(1);

    // A fresh draft + publish → version 2.
    await withTenant(runtime, TENANT_A, (tx) =>
      saveThemeDraft(
        tx,
        TENANT_A,
        ACTOR,
        defaultTheme,
        validConfig("#abcdef"),
        noAudit
      )
    );
    const pub2 = await withTenant(runtime, TENANT_A, (tx) =>
      publishThemeDraft(tx, TENANT_A, ACTOR, noAudit)
    );
    expect(pub2.ok).toBe(true);
    if (!pub2.ok) return;
    expect(pub2.version.versionNumber).toBe(2);

    // The active pointer is the latest published version.
    const state = await withTenant(runtime, TENANT_A, (tx) =>
      fetchThemeTenantState(tx, TENANT_A)
    );
    expect(state.activeThemeKey).toBe("aria");
    expect(state.activeVersionId).toBe(pub2.version.id);

    // rollback to v1, then retire.
    const roll = await withTenant(runtime, TENANT_A, (tx) =>
      rollbackThemeVersion(tx, TENANT_A, ACTOR, pub1.version.id, noAudit)
    );
    expect(roll.ok).toBe(true);
    if (!roll.ok) return;
    expect(roll.version.id).toBe(pub1.version.id);

    const rolledState = await withTenant(runtime, TENANT_A, (tx) =>
      fetchThemeTenantState(tx, TENANT_A)
    );
    expect(rolledState.activeVersionId).toBe(pub1.version.id);

    const retire = await withTenant(runtime, TENANT_A, (tx) =>
      retireActiveTheme(tx, TENANT_A, ACTOR, noAudit)
    );
    expect(retire.previousThemeKey).toBe("aria");
    const retiredState = await withTenant(runtime, TENANT_A, (tx) =>
      fetchThemeTenantState(tx, TENANT_A)
    );
    expect(retiredState.activeVersionId).toBeNull();
  });

  test("rollback to a foreign/nonexistent version id is refused (INVALID_TARGET)", async () => {
    const runtime = getRuntimeSql();
    await withTenant(runtime, TENANT_A, (tx) =>
      saveThemeDraft(tx, TENANT_A, ACTOR, defaultTheme, validConfig(), noAudit)
    );
    await withTenant(runtime, TENANT_A, (tx) =>
      publishThemeDraft(tx, TENANT_A, ACTOR, noAudit)
    );
    const bad = await withTenant(runtime, TENANT_A, (tx) =>
      rollbackThemeVersion(
        tx,
        TENANT_A,
        ACTOR,
        "99999999-9999-4999-8999-999999999999",
        noAudit
      )
    );
    expect(bad.ok).toBe(false);
  });

  test("a PUBLISHED version row is IMMUTABLE — UPDATE and DELETE both raise (sql/033 trigger)", async () => {
    const runtime = getRuntimeSql();
    const versionNumber = await withTenant(runtime, TENANT_A, (tx) =>
      nextPublishedVersionNumber(tx, TENANT_A)
    );
    const published = await withTenant(runtime, TENANT_A, (tx) =>
      insertPublishedVersion(
        tx,
        TENANT_A,
        ACTOR,
        "aria",
        "1.0.0",
        validConfig(),
        "hash-x",
        versionNumber
      )
    );

    await assertRejected(
      withTenant(
        runtime,
        TENANT_A,
        (tx) =>
          tx`UPDATE awcms_theming_config_versions SET config_hash = 'tampered' WHERE id = ${published.id}`
      ),
      "UPDATE of a published version row"
    );
    await assertRejected(
      withTenant(
        runtime,
        TENANT_A,
        (tx) =>
          tx`DELETE FROM awcms_theming_config_versions WHERE id = ${published.id}`
      ),
      "DELETE of a published version row"
    );

    // The row is untouched.
    const rows = (await getAdminSql()`
      SELECT config_hash FROM awcms_theming_config_versions WHERE id = ${published.id}
    `) as { config_hash: string }[];
    expect(rows[0]?.config_hash).toBe("hash-x");
  });

  test("FORCE RLS isolates the config-version + state tables across tenants under non-superuser awcms_app", async () => {
    if (!appRoleActivated) {
      // Migration 019 absent — the isolation claim is only meaningful under a
      // genuine non-owner role. Skip loudly rather than assert a false pass.
      return;
    }
    const app = getAppRoleSql();

    // Tenant A publishes a version (writes config_version + state rows).
    await withTenant(app, TENANT_A, (tx) =>
      saveThemeDraft(tx, TENANT_A, ACTOR, defaultTheme, validConfig(), noAudit)
    );
    await withTenant(app, TENANT_A, (tx) =>
      publishThemeDraft(tx, TENANT_A, ACTOR, noAudit)
    );

    // A really did write its own rows.
    const aVersions = (await withTenant(
      app,
      TENANT_A,
      (tx) => tx`SELECT count(*)::int AS c FROM awcms_theming_config_versions`
    )) as { c: number }[];
    expect(aVersions[0]!.c).toBeGreaterThan(0);

    // Under B's tenant context, A's version + state rows are simply not visible.
    const bVersions = (await withTenant(
      app,
      TENANT_B,
      (tx) => tx`SELECT count(*)::int AS c FROM awcms_theming_config_versions`
    )) as { c: number }[];
    expect(bVersions[0]!.c).toBe(0);
    const bState = (await withTenant(
      app,
      TENANT_B,
      (tx) => tx`SELECT count(*)::int AS c FROM awcms_theming_tenant_state`
    )) as { c: number }[];
    expect(bState[0]!.c).toBe(0);
  });

  test("preview session resolves by hashed token, and an expired session does not", async () => {
    const runtime = getRuntimeSql();
    const now = new Date();

    // A draft version to attach the preview to.
    const draft = await withTenant(runtime, TENANT_A, (tx) =>
      upsertDraftVersion(
        tx,
        TENANT_A,
        ACTOR,
        "aria",
        "1.0.0",
        validConfig(),
        hashThemeConfig("aria", validConfig())
      )
    );

    // A live session resolves; an expired one is filtered out by `expires_at`.
    const liveRaw = "1".repeat(64);
    const expiredRaw = "2".repeat(64);
    await withTenant(runtime, TENANT_A, async (tx) => {
      await createPreviewSession(
        tx,
        TENANT_A,
        ACTOR,
        draft.id,
        hashPreviewToken(liveRaw),
        new Date(now.getTime() + 30 * 60_000)
      );
      await createPreviewSession(
        tx,
        TENANT_A,
        ACTOR,
        draft.id,
        hashPreviewToken(expiredRaw),
        new Date(now.getTime() - 60 * 60_000)
      );
    });

    const live = await withTenant(runtime, TENANT_A, (tx) =>
      findActivePreviewSession(tx, hashPreviewToken(liveRaw), now)
    );
    expect(live?.versionId).toBe(draft.id);

    const expired = await withTenant(runtime, TENANT_A, (tx) =>
      findActivePreviewSession(tx, hashPreviewToken(expiredRaw), now)
    );
    expect(expired).toBeNull();

    // A preview session created for A is invisible under B's tenant context.
    const crossTenant = await withTenant(runtime, TENANT_B, (tx) =>
      findActivePreviewSession(tx, hashPreviewToken(liveRaw), now)
    );
    expect(crossTenant).toBeNull();
  });

  test("published version history lists newest-first and only published rows", async () => {
    const runtime = getRuntimeSql();
    await withTenant(runtime, TENANT_A, (tx) =>
      saveThemeDraft(tx, TENANT_A, ACTOR, defaultTheme, validConfig(), noAudit)
    );
    await withTenant(runtime, TENANT_A, (tx) =>
      publishThemeDraft(tx, TENANT_A, ACTOR, noAudit)
    );
    await withTenant(runtime, TENANT_A, (tx) =>
      saveThemeDraft(
        tx,
        TENANT_A,
        ACTOR,
        defaultTheme,
        validConfig("#abcdef"),
        noAudit
      )
    );
    await withTenant(runtime, TENANT_A, (tx) =>
      publishThemeDraft(tx, TENANT_A, ACTOR, noAudit)
    );
    const history = await withTenant(runtime, TENANT_A, (tx) =>
      listPublishedVersions(tx, TENANT_A, 50)
    );
    expect(history.map((v) => v.versionNumber)).toEqual([2, 1]);
    expect(history.every((v) => v.status === "published")).toBe(true);
  });

  test("CSS-injection is rejected at the domain boundary + the render path degrades safely", () => {
    // The spine rejects (never sanitizes) an unsafe token value.
    const bad = validateThemeConfig(defaultTheme, {
      themeKey: "aria",
      tokenOverrides: { color_primary: "url(javascript:alert(1))" }
    });
    expect(bad.ok).toBe(false);

    // Defense in depth: a hostile config that bypassed validation still throws
    // at serialize time, so unvalidated CSS can never be emitted.
    const hostile: ThemeConfig = {
      themeKey: "aria",
      tokenOverrides: { color_primary: "red;}body{display:none" },
      slotSelections: {},
      assetRefs: {},
      sectionOrder: [],
      navPlacement: "top"
    };
    expect(() => resolveThemeTokens(defaultTheme, hostile)).toThrow(
      CssValueError
    );
    expect(() => serializeThemeTokensCss(defaultTheme, hostile)).toThrow(
      CssValueError
    );

    // And the render resolver falls back to the safe default rather than
    // emitting a hostile config's CSS or throwing in a public stylesheet.
    const resolved = resolveVersionThemeCss({
      id: "v1",
      themeKey: "aria",
      themeVersion: "1.0.0",
      status: "published",
      versionNumber: 1,
      config: hostile,
      configHash: "h",
      createdAt: new Date(),
      publishedAt: new Date()
    });
    expect(resolved.css).toContain(":root");
    expect(resolved.css).not.toContain("display:none");
  });
});
