import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { getModuleByKey, listModules } from "../src/modules";
import { blogContentModule } from "../src/modules/blog-content/module";
import { MODULE_PRESETS } from "../src/modules/module-management/domain/module-presets";

/**
 * ADR-0044 merged `news_portal` into `blog_content`.
 *
 * This file replaces `news-portal-module.test.ts`, which asserted the retired
 * descriptor's shape. It exists to enforce the ONE promise the ADR makes that a
 * typecheck cannot see: the merge is a UNION, never a reduction. Deleting a
 * module while quietly dropping one of its features is trivially easy and every
 * gate stays green — the endpoints simply stop being reachable and nothing says
 * so.
 *
 * So each surviving feature is pinned to something observable: a registry
 * entry, a declared permission, a claimed route prefix, a file on disk, or a
 * migration statement.
 */
describe("ADR-0044 — news_portal merged into blog_content", () => {
  test("the module is retired: gone from the registry and from disk", () => {
    expect(listModules().some((m) => m.key === "news_portal")).toBe(false);
    expect(getModuleByKey("news_portal")).toBeUndefined();
    expect(existsSync("src/modules/news-portal")).toBe(false);
  });

  test("every absorbed source file landed under blog-content", () => {
    for (const path of [
      "src/modules/blog-content/domain/ad-placement-policy.ts",
      "src/modules/blog-content/domain/ad-placement-rotation.ts",
      "src/modules/blog-content/domain/homepage-section-policy.ts",
      "src/modules/blog-content/domain/news-portal-preset-readiness.ts",
      "src/modules/blog-content/application/ad-placement-directory.ts",
      "src/modules/blog-content/application/ad-placement-reference-validation.ts",
      "src/modules/blog-content/application/homepage-section-directory.ts",
      "src/modules/blog-content/application/homepage-section-reference-validation.ts"
    ]) {
      expect(existsSync(path)).toBe(true);
    }
  });

  test("blog_content declares the absorbed homepage_sections and ad_placements permission pairs", () => {
    for (const activityCode of ["homepage_sections", "ad_placements"]) {
      const actions = (blogContentModule.permissions ?? [])
        .filter((p) => p.activityCode === activityCode)
        .map((p) => p.action)
        .sort();

      expect(actions).toEqual(["configure", "read"]);
    }
  });

  test("the permission migration inserts, repoints, and only THEN deletes", () => {
    // These permissions were already seeded under `news_portal` (sql/044,
    // sql/045), so this migration is a MOVE, and a move that deletes before it
    // repoints revokes the capability from every tenant that held it — with
    // every gate still green, because nothing in this repo grants permissions
    // at test time. Statement ORDER is the correctness property, so assert the
    // order, not just the presence of each statement.
    const sql = readFileSync(
      "sql/076_awcms_blog_content_absorbs_news_portal_permissions.sql",
      "utf8"
    );

    for (const activityCode of ["homepage_sections", "ad_placements"]) {
      for (const action of ["read", "configure"]) {
        expect(sql).toContain(
          `('blog_content', '${activityCode}', '${action}'`
        );
      }
    }

    const insertNewCatalog = sql.indexOf("INSERT INTO awcms_permissions");
    const repointGrants = sql.indexOf("INSERT INTO awcms_role_permissions");
    const deleteOldGrants = sql.indexOf("DELETE FROM awcms_role_permissions");
    const deleteOldCatalog = sql.indexOf("DELETE FROM awcms_permissions");

    expect(insertNewCatalog).toBeGreaterThan(-1);
    expect(repointGrants).toBeGreaterThan(insertNewCatalog);
    expect(deleteOldGrants).toBeGreaterThan(repointGrants);
    expect(deleteOldCatalog).toBeGreaterThan(deleteOldGrants);
  });

  test("blog_content claims the /api/v1/news-portal route prefix it inherited", () => {
    // ADR-0044 §6 keeps the paths and moves only ownership. `api.routes` is
    // what attributes a route file to a module (Issue #256), so an unclaimed
    // prefix would leave eight live endpoints owned by nobody.
    expect(blogContentModule.api?.routes).toContain("/api/v1/news-portal");
  });

  test("media_library is a NON-optional capability now that the FK-holding ad placements live here", () => {
    const entry = (blogContentModule.capabilities?.consumes ?? []).find(
      (c) => c.capability === "media_library"
    );

    expect(entry).toBeDefined();
    expect(entry?.providedBy).toBe("media_library");
    expect(entry?.optional ?? false).toBe(false);
  });

  test("blog_content still provides public_content and seo_facts", () => {
    // `public_content` existed so `news_portal` could compose posts, and that
    // consumer is gone — but `seo_distribution` and future consumers still read
    // it, so retiring the capability alongside the module would break them.
    expect(blogContentModule.capabilities?.provides).toEqual([
      "public_content",
      "seo_facts"
    ]);
  });

  test("the `news_portal` PRESET survives and no longer names the retired module key", () => {
    // A preset names an intent, not a module. Keeping the name costs nothing;
    // leaving the dead key in its list would make `computeModulePresetPlan`
    // report an `unknownModuleKey` on every apply.
    const preset = MODULE_PRESETS.find((p) => p.name === "news_portal");

    expect(preset).toBeDefined();
    expect(preset?.enabledModuleKeys).not.toContain("news_portal");
    expect(preset?.enabledModuleKeys).toContain("blog_content");
    expect(preset?.enabledModuleKeys).toContain("media_library");
  });

  test("no preset anywhere still names the retired module", () => {
    for (const preset of MODULE_PRESETS) {
      expect(preset.enabledModuleKeys).not.toContain("news_portal");
    }
  });

  test("the inert tenant-state table and its helper are gone together", () => {
    // Dropping the table while leaving a helper that queries it, or vice versa,
    // is the failure mode worth pinning: either half alone still compiles.
    expect(
      existsSync(
        "src/modules/blog-content/application/news-portal-tenant-state.ts"
      )
    ).toBe(false);

    const drop = readFileSync(
      "sql/077_awcms_drop_inert_news_portal_tenant_state.sql",
      "utf8"
    );
    expect(drop).toContain(
      "DROP TABLE IF EXISTS awcms_news_portal_tenant_state"
    );
  });

  test("table names were NOT renamed by the merge (ADR-0044 §3, ADR-0036 precedent)", () => {
    // The cheapest way for a later change to undo this decision is a
    // well-meaning rename migration. Pin the names the code still queries.
    expect(
      readFileSync(
        "src/modules/blog-content/application/homepage-section-directory.ts",
        "utf8"
      )
    ).toContain("awcms_news_portal_homepage_sections");

    expect(
      readFileSync(
        "src/modules/blog-content/application/ad-placement-directory.ts",
        "utf8"
      )
    ).toContain("awcms_news_portal_ad_placements");
  });

  test("descriptor never declares a secret, token, or provider credential", () => {
    const serialized = JSON.stringify(blogContentModule).toLowerCase();

    for (const forbidden of [
      "password",
      "secret",
      "credential",
      "apikey",
      "api_key"
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
