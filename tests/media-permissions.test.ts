import { describe, expect, test } from "bun:test";

import { mediaLibraryModule } from "../src/modules/media-library/module";
import {
  MEDIA_PERMISSION_ACTIVITY_CODE,
  MEDIA_PERMISSIONS,
  MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE,
  MEDIA_ENFORCEMENT_PERMISSIONS
} from "../src/modules/media-library/domain/media-permissions";

describe("MEDIA_PERMISSIONS", () => {
  test("declares one key per required media lifecycle action (including cancel, added by Issue #634 for aborting a not-yet-uploaded session)", () => {
    expect(Object.keys(MEDIA_PERMISSIONS).sort()).toEqual(
      [
        "attach",
        "cancel",
        "create",
        "delete",
        "detach",
        "purge",
        "read",
        "restore",
        "verify"
      ].sort()
    );
  });

  test("every media permission key follows the media_library.media.<action> shape (ADR-0036 ownership inversion — was news_portal.media.*)", () => {
    for (const value of Object.values(MEDIA_PERMISSIONS)) {
      expect(value).toMatch(
        new RegExp(
          `^media_library\\.${MEDIA_PERMISSION_ACTIVITY_CODE}\\.[a-z]+$`
        )
      );
    }
  });

  test("media_library.module.ts declares exactly these 9 media permissions", () => {
    expect(mediaLibraryModule.permissions).toBeDefined();
    const mediaPermissions = mediaLibraryModule.permissions?.filter(
      (permission) => permission.activityCode === MEDIA_PERMISSION_ACTIVITY_CODE
    );
    expect(mediaPermissions?.length).toBe(
      Object.keys(MEDIA_PERMISSIONS).length
    );
  });
});

describe("MEDIA_ENFORCEMENT_PERMISSIONS (ADR-0036 step 5a)", () => {
  test("declares only read + enable — one-way, no disable action ever", () => {
    expect(Object.keys(MEDIA_ENFORCEMENT_PERMISSIONS).sort()).toEqual([
      "enable",
      "read"
    ]);
  });

  test("every enforcement key follows the media_library.enforcement.<action> shape, under a SEPARATE activity code from media", () => {
    expect(MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE).toBe("enforcement");
    expect(MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE).not.toBe(
      MEDIA_PERMISSION_ACTIVITY_CODE
    );
    for (const value of Object.values(MEDIA_ENFORCEMENT_PERMISSIONS)) {
      expect(value).toMatch(
        new RegExp(
          `^media_library\\.${MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE}\\.[a-z]+$`
        )
      );
    }
  });

  test("there is no `disable` enforcement permission (one-way by construction)", () => {
    expect(Object.keys(MEDIA_ENFORCEMENT_PERMISSIONS)).not.toContain("disable");
  });

  test("media_library.module.ts declares exactly these 2 enforcement permissions", () => {
    const enforcementPermissions = mediaLibraryModule.permissions?.filter(
      (permission) =>
        permission.activityCode === MEDIA_ENFORCEMENT_PERMISSION_ACTIVITY_CODE
    );
    expect(enforcementPermissions?.length).toBe(
      Object.keys(MEDIA_ENFORCEMENT_PERMISSIONS).length
    );
  });
});
