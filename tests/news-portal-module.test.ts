import { describe, expect, test } from "bun:test";

import { getModuleByKey, listModules } from "../src/modules";
import { newsPortalModule } from "../src/modules/news-portal/module";

describe("news_portal module descriptor (ported from awcms-mini; ADR-0036 media inversion)", () => {
  test("listModules() includes news_portal", () => {
    expect(listModules().some((m) => m.key === "news_portal")).toBe(true);
    expect(getModuleByKey("news_portal")).toBe(newsPortalModule);
  });

  test("descriptor shape", () => {
    expect(newsPortalModule.key).toBe("news_portal");
    expect(newsPortalModule.status).toBe("active");
    expect(newsPortalModule.type).toBe("domain");
    // `module_management`/`logging` are foundation modules (never disabled
    // per-tenant), so declaring them does not arm any reverse-dependency
    // guard against an optional business module. blog_content/media_library/
    // tenant_domain/visitor_analytics stay prose/capability-only, not
    // lifecycle edges.
    expect(newsPortalModule.dependencies).toEqual([
      "tenant_admin",
      "identity_access",
      "module_management",
      "logging"
    ]);
  });

  test("ADR-0036: provides NOTHING (news_media retired), CONSUMES public_content + media_library", () => {
    expect(newsPortalModule.capabilities?.provides).toBeUndefined();
    expect(newsPortalModule.capabilities?.consumes).toEqual([
      { capability: "public_content", providedBy: "blog_content" },
      { capability: "media_library", providedBy: "media_library" }
    ]);
  });

  test("ADR-0036: the media registry basePath + reconcile job MOVED to media_library — news_portal keeps only its own api surface, no jobs", () => {
    expect(newsPortalModule.settings).toBeUndefined();
    expect(newsPortalModule.health).toBeUndefined();
    // The reconcile job followed the table it reconciles into media_library.
    expect(newsPortalModule.jobs).toBeUndefined();

    expect(newsPortalModule.api).toEqual({
      openApiPath: "openapi/awcms-public-api.openapi.yaml",
      basePath: "/api/v1/news-portal"
    });

    expect(newsPortalModule.navigation).toEqual([
      {
        labelKey: "admin.layout.nav_news_portal_homepage_sections",
        path: "/admin/news-portal/homepage-sections",
        order: 80,
        requiredPermission: "news_portal.homepage_sections.read"
      },
      {
        labelKey: "admin.layout.nav_news_portal_ad_placements",
        path: "/admin/news-portal/ad-placements",
        order: 81,
        requiredPermission: "news_portal.ad_placements.read"
      }
    ]);

    expect(newsPortalModule.permissions).toBeDefined();
  });

  test("ADR-0036: no longer declares any `media` activityCode permission (moved to media_library)", () => {
    const mediaPermissions = (newsPortalModule.permissions ?? []).filter(
      (p) => p.activityCode === "media"
    );
    expect(mediaPermissions.length).toBe(0);
  });

  test("declares exactly the homepage_sections read/configure permission pair", () => {
    const permissions = (newsPortalModule.permissions ?? []).filter(
      (p) => p.activityCode === "homepage_sections"
    );

    expect(permissions.map((p) => p.action).sort()).toEqual([
      "configure",
      "read"
    ]);
  });

  test("declares exactly the ad_placements read/configure permission pair", () => {
    const permissions = (newsPortalModule.permissions ?? []).filter(
      (p) => p.activityCode === "ad_placements"
    );

    expect(permissions.map((p) => p.action).sort()).toEqual([
      "configure",
      "read"
    ]);
  });

  test("descriptor never declares a secret, token, or provider credential", () => {
    const serialized = JSON.stringify(newsPortalModule).toLowerCase();

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
