import { describe, expect, test } from "bun:test";

import { getModuleByKey, listModules } from "../src/modules";
import { mediaLibraryModule } from "../src/modules/media-library/module";
import {
  MEDIA_PERMISSION_ACTIVITY_CODE,
  MEDIA_PERMISSIONS,
  MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE
} from "../src/modules/media-library/domain/media-permissions";

/**
 * ADR-0036 moved the media registry — and its 9 permissions — out of
 * `news_portal` and into this module, and added the 2 enforcement permissions.
 * These tests pin the half of that move a typecheck cannot see: a permission KEY
 * is a string, so nothing but an assertion stops it drifting back, being
 * duplicated, or being invented. The mirror-image assertion ("news_portal
 * declares NO media permission") lives in `news-portal-module.test.ts`.
 */
describe("media_library module descriptor (ADR-0036)", () => {
  test("listModules() includes media_library", () => {
    expect(listModules().some((m) => m.key === "media_library")).toBe(true);
    expect(getModuleByKey("media_library")).toBe(mediaLibraryModule);
  });

  test("is an active System Foundation module that owns the media registry", () => {
    expect(mediaLibraryModule.key).toBe("media_library");
    expect(mediaLibraryModule.status).toBe("active");
    expect(mediaLibraryModule.type).toBe("system");
    expect(mediaLibraryModule.isCore).toBe(false);
  });

  test("never depends on the modules that consume it — the inversion ADR-0036 exists to make", () => {
    for (const consumer of ["news_portal", "blog_content"]) {
      expect(mediaLibraryModule.dependencies).not.toContain(consumer);
    }
    expect(mediaLibraryModule.dependencies).toEqual([
      "tenant_admin",
      "identity_access"
    ]);
  });

  test("provides `media_library` and consumes nothing", () => {
    expect(mediaLibraryModule.capabilities?.provides).toEqual([
      "media_library"
    ]);
    expect(mediaLibraryModule.capabilities?.consumes ?? []).toEqual([]);
  });

  test("owns the media upload basePath that moved off news_portal", () => {
    expect(mediaLibraryModule.api).toEqual({
      openApiPath: "openapi/awcms-public-api.openapi.yaml",
      basePath: "/api/v1/media/news-images"
    });
  });

  test("owns the news-media:reconcile job that moved off news_portal (command name kept, ADR-0036 §3)", () => {
    expect(mediaLibraryModule.jobs).toHaveLength(1);
    expect(mediaLibraryModule.jobs?.[0]?.command).toBe(
      "bun run news-media:reconcile"
    );
    expect(mediaLibraryModule.jobs?.[0]?.safeInOfflineLan).toBe(false);
  });

  test("declares exactly the 9 media + 2 enforcement permissions, each reproducing a constant", () => {
    const mediaPermissions = (mediaLibraryModule.permissions ?? []).filter(
      (p) => p.activityCode === MEDIA_PERMISSION_ACTIVITY_CODE
    );
    const declaredKeys = mediaPermissions.map(
      (p) => `media_library.${p.activityCode}.${p.action}`
    );
    expect(new Set(declaredKeys)).toEqual(
      new Set(Object.values(MEDIA_PERMISSIONS))
    );

    const enforcementPermissions = (
      mediaLibraryModule.permissions ?? []
    ).filter(
      (p) => p.activityCode === MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE
    );
    expect(enforcementPermissions.map((p) => p.action).sort()).toEqual([
      "enable",
      "read"
    ]);

    for (const permission of mediaLibraryModule.permissions ?? []) {
      expect(permission.description.length).toBeGreaterThan(0);
    }
  });

  test("descriptor never declares a secret, token, or provider credential", () => {
    const serialized = JSON.stringify(mediaLibraryModule).toLowerCase();
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
