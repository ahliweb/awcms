import { describe, expect, test } from "bun:test";

import { getModuleByKey, listModules } from "../src/modules";
import { newsPortalModule } from "../src/modules/news-portal/module";
import { NEWS_MEDIA_PERMISSIONS } from "../src/modules/news-portal/domain/news-media-permissions";

describe("news_portal module descriptor (ported from awcms-mini)", () => {
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
    // guard against an optional business module. blog_content/tenant_domain/
    // visitor_analytics stay prose/capability-only, not lifecycle edges.
    expect(newsPortalModule.dependencies).toEqual([
      "tenant_admin",
      "identity_access",
      "module_management",
      "logging"
    ]);
  });

  test("PROVIDES news_media, CONSUMES blog_content's public_content", () => {
    expect(newsPortalModule.capabilities?.provides).toEqual(["news_media"]);
    expect(newsPortalModule.capabilities?.consumes).toEqual([
      { capability: "public_content", providedBy: "blog_content" }
    ]);
  });

  test("declares api + navigation + the reconcile job; settings/health undeclared", () => {
    expect(newsPortalModule.settings).toBeUndefined();
    expect(newsPortalModule.health).toBeUndefined();

    expect(newsPortalModule.api).toEqual({
      openApiPath: "openapi/awcms-public-api.openapi.yaml",
      basePath: "/api/v1/media/news-images"
    });

    expect(newsPortalModule.jobs).toEqual([
      {
        command: "bun run news-media:reconcile",
        purpose:
          "Reconcile awcms_news_media_objects metadata against the real R2 bucket contents; clean up expired pending uploads and grace-period-expired orphans in bounded, race-safe batches (dry-run supported).",
        recommendedSchedule: "Daily via cron/systemd timer.",
        environmentNotes:
          'No-op when NEWS_MEDIA_R2_ENABLED is not "true". Requires real network egress to the Cloudflare R2 API in addition to PostgreSQL — not a pure database operation.',
        safeInOfflineLan: false
      }
    ]);

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

  test("every declared `media` activityCode permission reproduces exactly one NEWS_MEDIA_PERMISSIONS constant — no invented/duplicated/orphaned key", () => {
    const permissions = (newsPortalModule.permissions ?? []).filter(
      (p) => p.activityCode === "media"
    );
    const expectedKeys = new Set(Object.values(NEWS_MEDIA_PERMISSIONS));

    expect(permissions.length).toBe(expectedKeys.size);

    const declaredKeys = permissions.map(
      (p) => `news_portal.${p.activityCode}.${p.action}`
    );

    expect(new Set(declaredKeys)).toEqual(expectedKeys);
    expect(declaredKeys.length).toBe(new Set(declaredKeys).size);

    for (const permission of permissions) {
      expect(permission.description.length).toBeGreaterThan(0);
    }
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
